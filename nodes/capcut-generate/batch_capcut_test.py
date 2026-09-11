import copy
import json
from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch
import capcut_adapter as adapter
from batch_capcut import prepare_batch_package


class BatchCapcutTest(unittest.TestCase):
    def setUp(self):
        self.workspace = Path(__file__).resolve().parents[2]
        self.root = Path(tempfile.mkdtemp(prefix='batch-capcut-', dir=self.workspace / 'logs')).resolve()
        self.assets = {}
        # Packaging verifies byte identity, not codecs; media probing is done at import.
        for key, kind, ext in [('base', 'video', '.mp4'), ('overlay', 'image', '.png'), ('voice', 'audio', '.wav')]:
            p = self.root / (key + ext); p.write_bytes(('owned-' + key).encode())
            self.assets[key] = dict(path=str(p), hash=adapter.file_hash(p), name='Nguồn ' + key + ext,
                                    width=160, height=160, kind=kind, durationMs=6000, hasAudio=kind != 'image')
        clip = dict(sourceInMs=1000, sourceOutMs=6000, timelineInMs=0, timelineOutMs=5000,
                    speed=1, effects=[], keyframes=[], volume=.5, audioFadeInMs=500, audioFadeOutMs=500)
        doc = dict(fps=30, resolution=dict(width=160, height=160), transitions=[], tracks=[
            dict(name='PNG trên', type='video', order=3, clips=[dict(clip, assetId='overlay', sourceInMs=0, sourceOutMs=5000)]),
            dict(name='Video dưới', type='video', order=2, clips=[dict(clip, assetId='base')]),
            dict(name='Voice', type='audio', order=1, muted=True, clips=[dict(clip, assetId='voice')])])
        self.payload = dict(name='SFQualification-BCL-kiểm tra', sourceVersion='lab:2:hash', assets=self.assets,
                            timelines=[dict(name='Biến thể 1', document=doc), dict(name='Biến thể 2', document=copy.deepcopy(doc))])

    def tearDown(self):
        assert self.root.parent == (self.workspace / 'logs').resolve()
        shutil.rmtree(self.root)

    def package(self):
        return Path(prepare_batch_package(self.payload, self.root / 'staging')['path'])

    def test_native_layers_timing_audio_and_media_deduplication(self):
        package = self.package(); report = adapter.validate_package(package)
        self.assertEqual(report['mode'], 'editable-batch')
        self.assertEqual(report['format'], 'draft-content-v1')
        self.assertNotIn('appBuild', report)
        self.assertEqual(len(report['timelines']), 2)
        self.assertFalse(report['certified'])
        self.assertEqual(report['timelineCount'], 2)
        self.assertEqual(len(report['mediaHashes']), 3)
        root = package / self.payload['name']
        project = adapter.read_json(root / 'Timelines/project.json')
        self.assertEqual([t['name'] for t in project['timelines']], ['Biến thể 1', 'Biến thể 2'])
        for t in project['timelines']:
            doc = adapter.read_json(root / f'Timelines/{t["id"]}/draft_content.json')
            self.assertEqual(doc['duration'], 5000000)
            self.assertEqual([t['name'] for t in doc['tracks']], ['Video dưới', 'PNG trên', 'Voice'])
            fixture = adapter.read_json(adapter.PROFILE_ROOT / '9.4.0.4015/batch-fixture.json')
            self.assertEqual([t['flag'] for t in doc['tracks']], [t['flag'] for t in fixture['tracks']], 'every variant marks the PNG as an overlay')
            segments = [t['segments'][0] for t in doc['tracks']]
            self.assertEqual(segments[0]['source_timerange'], dict(start=1000000, duration=5000000))
            self.assertEqual(segments[1]['target_timerange'], dict(start=0, duration=5000000))
            self.assertEqual([s['volume'] for s in segments], [.5, .5, 0])
            self.assertEqual(doc['materials']['videos'][1]['type'], 'photo')
            self.assertEqual(doc['materials']['audios'][0]['type'], 'music', 'local files must not invoke Extract audio')
            self.assertEqual(doc['materials']['audio_fades'][0]['fade_in_duration'], 500000)
        for relative, hash_ in report['mediaHashes'].items():
            self.assertEqual(adapter.file_hash(root / relative), hash_)

    def test_invalid_feature_and_changed_source_never_create_package(self):
        for field, value in [('effects', [dict(type='blur')]), ('speed', 2), ('crop', dict(x=1))]:
            payload = copy.deepcopy(self.payload)
            payload['timelines'][1]['document']['tracks'][0]['clips'][0][field] = value
            with self.assertRaisesRegex(ValueError, 'chưa hỗ trợ'):
                prepare_batch_package(payload, self.root / 'staging')
            self.assertFalse((self.root / 'staging').exists())
        self.payload['assets']['base']['hash'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'đổi nội dung'): self.package()
        self.assertFalse((self.root / 'staging').exists())

    def test_editable_caption_track_without_media_reference(self):
        for timeline in self.payload['timelines']:
            timeline['document']['tracks'].append(dict(name='Captions', type='caption', order=4, clips=[
                dict(id='caption', sourceInMs=0, sourceOutMs=2000, timelineInMs=1000, timelineOutMs=3000,
                     text=dict(content='Xin chào 👋', fontSize=48, preset='outline', words=[dict(word='Xin',startMs=1000,endMs=1400)]))]))
        package = self.package()
        report = adapter.validate_package(package)
        for timeline in report['timelines']:
            doc = adapter.read_json(package / self.payload['name'] / f'Timelines/{timeline["id"]}/draft_content.json')
            track = next(t for t in doc['tracks'] if t['type'] == 'text')
            self.assertEqual(track['segments'][0]['target_timerange'], dict(start=1000000, duration=2000000))
            material = doc['materials']['texts'][0]
            self.assertEqual(track['segments'][0]['material_id'], material['id'])
            self.assertEqual(json.loads(material['content'])['text'], 'Xin chào 👋')
            self.assertEqual(json.loads(material['content'])['styles'][0]['range'][1], 11)
            self.assertEqual(material['border_alpha'], 1)
            self.assertEqual(material['type'], 'subtitle')
            self.assertEqual(material['check_flag'], 47)
            self.assertEqual(doc['new_version'], '187.0.0', 'rich text must not enter the old plain-text migration')
            self.assertEqual(material['words']['start_time'], [0])
            self.assertEqual(material['words']['end_time'], [400])
            self.assertEqual(json.loads(material['content'])['styles'][0]['strokes'][0]['mode'], 0)

    def test_tampering_is_rejected(self):
        package = self.package()
        next((package / self.payload['name'] / 'media').iterdir()).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'hash'): adapter.validate_package(package)

    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_install_relocates_every_timeline_and_preserves_existing_project(self, *_):
        package = self.package(); live = self.root / 'live'; live.mkdir()
        original = {'all_draft_store': [{'draft_id': 'other', 'draft_name': 'Existing'}], 'custom': 42}
        adapter.write_json(live / 'root_meta_info.json', original)
        result = adapter.install_package(package, live)
        target = Path(result['path'])
        index = adapter.read_json(live / 'root_meta_info.json')
        self.assertEqual(index['all_draft_store'][1], original['all_draft_store'][0])
        self.assertEqual(index['custom'], 42)
        for location in [target / 'draft_content.json', *target.glob('Timelines/*/draft_content.json')]:
            doc = adapter.read_json(location)
            for material in doc['materials']['videos'] + doc['materials']['audios']:
                path = Path(material['path'])
                self.assertTrue(path.is_absolute() and path.is_file() and path.is_relative_to(target / 'media'))
        self.assertEqual(adapter.install_package(package, live)['path'], str(target))

    @patch.object(adapter, 'profile_for', side_effect=AssertionError('No build profiles for direct drafts'))
    @patch.object(adapter, 'inventory', side_effect=AssertionError('No installed build gate for direct drafts'))
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_direct_draft_does_not_require_a_version(self, *_):
        package = self.package(); live = self.root / 'live'; live.mkdir()
        result = adapter.install_package(package, live)
        self.assertTrue((Path(result['path']) / 'draft_content.json').is_file())

    def test_render_copy_selects_second_timeline_without_changing_original(self):
        from capcut_render import render_copy, job_path
        self.payload['timelines'][1]['document']['tracks'][0]['clips'][0]['timelineOutMs'] = 3000
        self.payload['timelines'][1]['document']['tracks'][0]['clips'][0]['sourceOutMs'] = 3000
        self.payload['timelines'][1]['document']['tracks'].pop()  # no audio in selected variant
        package = self.package()
        before = {p: p.read_bytes() for p in package.rglob('*') if p.is_file()}
        project = adapter.read_json(package / self.payload['name'] / 'Timelines/project.json')
        selected = project['timelines'][1]['id']
        copy_root = self.root / 'render'
        report = render_copy(package, selected, copy_root, 'SFRender-test')
        self.assertEqual(report['timelineCount'], 1)
        self.assertEqual(len(report['mediaHashes']), 2, 'copy only selected timeline media')
        cloned = adapter.read_json(copy_root / 'SFRender-test/Timelines/project.json')
        self.assertEqual(cloned['main_timeline_id'], selected)
        self.assertEqual([t['id'] for t in cloned['timelines']], [selected])
        self.assertNotEqual(report['projectId'], adapter.read_json(package / 'manifest.json')['projectId'])
        self.assertTrue(all(p.read_bytes() == content for p, content in before.items()))
        with self.assertRaisesRegex(ValueError, 'không thuộc'): render_copy(package, 'foreign', self.root / 'bad', 'Invalid')
        self.assertFalse((self.root / 'bad').exists())
        with self.assertRaisesRegex(ValueError, 'Invalid render request'): job_path(package, '../escape')

    @patch('sys.platform', 'linux')
    def test_native_render_requires_windows_agent(self):
        from capcut_render import start
        with self.assertRaisesRegex(ValueError, 'agent Windows'): start('', '', '', '', '')

    def test_native_render_retry_and_dead_worker_status(self):
        import uuid
        from capcut_render import start, status, job_path, save_state
        package = self.package(); key = str(uuid.uuid4()); directory = job_path(package, key)
        directory.mkdir(parents=True)
        state = dict(id=key, timelineId='selected', outputDir='D:/Exports', status='completed', pid=123)
        save_state(directory, state)
        with patch('sys.platform', 'win32'), patch.object(adapter, 'capcut_running', side_effect=AssertionError('retry must reuse result')):
            self.assertEqual(start(package, key, 'selected', 'D:/Exports', ''), state)
            with self.assertRaisesRegex(ValueError, 'đã dùng'): start(package, key, 'other', 'D:/Exports', '')
        state['status'] = 'running'; save_state(directory, state)
        with patch.object(adapter, 'process_alive', return_value=False):
            self.assertEqual(status(package, key)['status'], 'failed')

    @patch.object(adapter, 'capcut_running', return_value=True)
    def test_live_install_never_writes_index_and_recovers_its_own_folder(self, *_):
        package = self.package(); live = self.root / 'live'; live.mkdir()
        index = live / 'root_meta_info.json'; index.write_text('native index owned by CapCut')
        result = adapter.install_package(package, live)
        self.assertEqual(index.read_text(), 'native index owned by CapCut')
        target = Path(result['path'])
        for location in [target / 'draft_content.json', *target.glob('Timelines/*/draft_content.json')]:
            doc = adapter.read_json(location)
            self.assertTrue(all(Path(m['path']).is_file() for m in doc['materials']['videos'] + doc['materials']['audios']))
        self.assertEqual(adapter.install_package(package, live)['path'], str(target))
        # Native edits remain untouched on an installation retry.
        (target / 'draft_content.json').write_text('native edit')
        self.assertEqual(adapter.install_package(package, live)['path'], str(target))
        self.assertEqual((target / 'draft_content.json').read_text(), 'native edit')
        (package / 'installation-live.json').unlink()
        with self.assertRaisesRegex(ValueError, 'already exists'): adapter.install_package(package, live)

    @patch.object(adapter, 'capcut_running', return_value=True)
    def test_live_install_failure_preserves_index_and_retry(self, *_):
        package = self.package(); live = self.root / 'live'; live.mkdir()
        index = live / 'root_meta_info.json'; index.write_text('unchanged')
        with patch('capcut_live_install.os.rename', side_effect=OSError('disk failure')):
            with self.assertRaisesRegex(OSError, 'disk failure'): adapter.install_package(package, live)
        self.assertEqual([p.name for p in live.iterdir()], ['root_meta_info.json'])
        self.assertEqual(index.read_text(), 'unchanged')
        self.assertTrue(Path(adapter.install_package(package, live)['path']).is_dir())

    def test_batch_worker_preserves_completed_results_after_failure(self):
        import uuid
        from capcut_render import worker, save_state, status
        package = self.package(); report = adapter.validate_package(package)
        key = str(uuid.uuid4()); directory = package / 'renders' / key; directory.mkdir(parents=True)
        drafts = self.root / 'drafts'; drafts.mkdir()
        ids = [t['id'] for t in report['timelines']]
        state = dict(id=key, pid=123, status='queued', outputDir=str(self.root), timelineIds=ids,
                     items=[dict(timelineId=id_, status='queued') for id_ in ids] + [dict(timelineId=ids[0], status='queued')])
        save_state(directory, state); (directory / 'ready').touch()
        adapter.write_json(directory / 'request.json', dict(package=str(package), drafts=str(drafts), app='CapCut'))
        with patch.object(adapter, 'install_package') as install, patch('capcut_render_ui.export_project', side_effect=[self.root / 'one.mp4', ValueError('UI changed')]) as export, patch('capcut_render.verify_output', return_value=dict(path='one.mp4', durationSeconds=5, bytes=10)):
            worker(directory)
        result = status(package, key)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual([i['status'] for i in result['items']], ['completed', 'failed', 'skipped'])
        self.assertEqual(result['items'][0]['result']['path'], 'one.mp4')
        self.assertEqual(install.call_count, 2); self.assertEqual(export.call_count, 2)
        self.assertFalse((drafts / '.space-flow-render.lock').exists())

    @patch('sys.platform', 'win32')
    def test_batch_start_rejects_invalid_selection_and_reuses_ordered_request(self):
        import uuid
        from capcut_render import start, job_path, save_state
        package = self.package(); key = str(uuid.uuid4())
        for selected in [[], None, ['same', 'same'], [None], ['missing'], ['one'] * 101]:
            with self.assertRaises(ValueError): start(package, key, selected, str(self.root), '')
        self.assertFalse(job_path(package, key).exists())
        directory = job_path(package, key); directory.mkdir(parents=True)
        state = dict(id=key, timelineIds=['second', 'first'], outputDir=str(self.root), status='completed', pid=123)
        save_state(directory, state)
        self.assertEqual(start(package, key, ['second', 'first'], str(self.root), ''), state)
        with self.assertRaisesRegex(ValueError, 'đã dùng'): start(package, key, ['first', 'second'], str(self.root), '')

    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_install_failure_rolls_back(self, *_):
        package = self.package(); live = self.root / 'live'; live.mkdir()
        adapter.write_json(live / 'root_meta_info.json', {'all_draft_store': []})
        before = (live / 'root_meta_info.json').read_bytes()
        with patch.object(adapter.os, 'replace', side_effect=OSError('disk failure')):
            with self.assertRaisesRegex(OSError, 'disk failure'): adapter.install_package(package, live)
        self.assertEqual((live / 'root_meta_info.json').read_bytes(), before)
        self.assertEqual([p.name for p in live.iterdir()], ['root_meta_info.json'])


class CaptionPresentationTest(unittest.TestCase):
    def test_native_font_units_background_flag_and_nine_anchors(self):
        from batch_capcut import caption_track
        for width, height in [(640,360),(1920,1080),(1080,1920)]:
            for row in ['top','middle','bottom']:
                for column in ['left','center','right']:
                    cue=dict(timelineInMs=0,timelineOutMs=1000,text=dict(content='Editable\nCaptions',fontSize=24,fontFamily='Arial',preset='yellow-box',position=row+'-'+column,safeMarginPct=10))
                    track,materials=caption_track(dict(clips=[cue]),width,height,0)
                    material=materials[0]
                    self.assertEqual(material['check_flag'] & 16,16)
                    self.assertAlmostEqual(material['font_size'],24*160/width)
                    self.assertEqual(json.loads(material['content'])['styles'][0]['size'],material['font_size'])
                    self.assertEqual(material['font_name'],'Arial')
                    transform=track['segments'][0]['clip']['transform']
                    self.assertEqual(transform['x'] == 0,column == 'center')
                    self.assertEqual(transform['y'] == 0,row == 'middle')
                    self.assertEqual(transform['y'] > 0,row == 'top')

    def test_ocr_only_repairs_characters_impossible_in_generated_hex_id(self):
        from capcut_render_ui import render_label_point
        def line(text):
            return dict(text=text,words=[dict(text=text,x=1,y=2,width=20,height=10)])
        self.assertEqual(render_label_point([line('SFRender-a39fOcaS-001')],'SFRender-a39f0ca5-001'),(11,7))
        self.assertIsNone(render_label_point([line('SFRender-a39fbca5-001')],'SFRender-a39f8ca5-001'))
        self.assertIsNone(render_label_point([line('SFRender-a39fOcaS-001')]*2,'SFRender-a39f0ca5-001'))
        self.assertIsNone(render_label_point([line('Other project a39f0ca5')],'SFRender-a39f0ca5-001'))


if __name__ == '__main__': unittest.main()
