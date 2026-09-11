import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import batch_transitions as transitions
from batch_capcut import native_document, prepare_batch_package, relocate_batch
from capcut_render import render_copy
import capcut_adapter as adapter


class TransitionTest(unittest.TestCase):
    def document(self, kind):
        return dict(fps=30, resolution=dict(width=160,height=160), tracks=[dict(type='video',order=0,clips=[
            dict(id='a',assetId='image',sourceInMs=0,sourceOutMs=3000,timelineInMs=0,timelineOutMs=3000),
            dict(id='b',assetId='image',sourceInMs=0,sourceOutMs=3000,timelineInMs=3000,timelineOutMs=6000)])],
            transitions=[dict(fromClipId='a',toClipId='b',durationMs=500,type=kind,timingMode='centered-v1')])

    def test_native_references_preserve_cut_and_duration(self):
        asset=dict(path='media/0.png',name='image',kind='image',width=160,height=160,durationMs=3000)
        for kind, entry in transitions.CATALOG.items():
            doc=native_document(self.document(kind),{'image':asset},'test')
            material=doc['materials']['transitions'][0];segments=doc['tracks'][0]['segments']
            self.assertEqual(material['effect_id'],entry['effectId'])
            self.assertIn(material['id'],segments[0]['extra_material_refs'])
            self.assertNotIn(material['id'],segments[1]['extra_material_refs'])
            self.assertEqual(material['duration'],500000)
            self.assertEqual(segments[1]['target_timerange']['start'],3000000)
            self.assertEqual(doc['duration'],6000000)
            self.assertEqual(doc['new_version'],'187.0.0')
            self.assertEqual(segments[0]['source_timerange'],dict(start=0,duration=3000000))
            self.assertEqual(material['is_overlap'],entry['isOverlap'])

    def test_package_resources_render_copy_relocation_and_tamper(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);bundle=root/'bundle';bundle.mkdir()
            (bundle/'extra.json').write_text('{"transition":{"isOverlap":true}}')
            (bundle/'config.json').write_text('{}')
            (bundle/'shader').write_bytes(b'fixture-shader')
            media=root/'image.png';media.write_bytes(b'image')
            assets={'image':dict(path=str(media),name='image',kind='image',width=160,height=160,durationMs=3000,hash=adapter.file_hash(media))}
            payload=dict(name='Transitions',sourceVersion='test',assets=assets,timelines=[dict(name='one',document=self.document('left')),dict(name='two',document=self.document('right'))])
            with patch.object(transitions,'resolve_resource',return_value=bundle):
                package=Path(prepare_batch_package(payload,root/'out')['path'])
            report=adapter.validate_package(package)
            self.assertEqual(len(report['resourceHashes']),6)
            cloned=render_copy(package,report['timelines'][1]['id'],root/'render','Render')
            self.assertEqual(len(cloned['resourceHashes']),3)
            target=root/'installed'
            relocate_batch(root/'render/Render',target)
            doc=adapter.read_json(root/'render/Render/draft_content.json')
            self.assertTrue(doc['materials']['transitions'][0]['path'].startswith(target.as_posix()))
            resource=next(iter(report['resourceHashes']))
            (package/'Transitions'/resource).write_text('tampered')
            with self.assertRaises(ValueError):adapter.validate_package(package)

    def test_missing_resource_and_untrusted_download(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict('os.environ',{'CAPCUT_EFFECTS_DIR':tmp}), patch.object(transitions,'cached_metadata',return_value=iter([])):
            with self.assertRaisesRegex(ValueError,'chưa có resource'):transitions.resolve_resource('left')
        for url in ['http://p16.ibyteimg.com/x','https://localhost/x','https://p16.ibyteimg.com.evil/x','https://a@p16.ibyteimg.com/x']:
            self.assertFalse(transitions.allowed_url(url))


if __name__ == '__main__':unittest.main()
