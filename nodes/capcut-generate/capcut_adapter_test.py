import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import capcut_adapter as adapter


class AdapterTest(unittest.TestCase):
    def setUp(self):
        self.workspace = Path(__file__).resolve().parents[2]
        self.root = Path(tempfile.mkdtemp(prefix='capcut-adapter-', dir=self.workspace / 'logs')).resolve()
        self.source = self.workspace / 'ref-item/1.mp4'
        self.delivery = {'kind': 'VerifiedVideo', 'path': str(self.source), 'sha256': adapter.file_hash(self.source)}
        self.package = Path(adapter.prepare_video_package(self.delivery, self.root / 'staging', '9.4.0.4015', 'SFQualification-kiểm tra', True)['path'])
        self.live = self.root / 'Live drafts'; self.live.mkdir()
        self.index = self.live / 'root_meta_info.json'
        self.before = b'{"all_draft_store":[{"draft_id":"existing","draft_name":"User draft"}],"custom":123}'
        self.index.write_bytes(self.before)

    def tearDown(self):
        assert self.root.parent == (self.workspace / 'logs').resolve()
        shutil.rmtree(self.root)

    def test_typed_input_hash_and_loss_gate(self):
        for delivery, accepted in [(dict(self.delivery, kind='file'), True),
                                   (dict(self.delivery, sha256='0' * 64), True), (self.delivery, False)]:
            with self.assertRaises(ValueError):
                adapter.prepare_video_package(delivery, self.root, '9.4.0.4015', 'invalid', accepted)
        with self.assertRaises(ValueError): adapter.profile_for('latest')
        self.assertEqual(adapter.validate_package(self.package)['mode'], 'rendered-video')

    def test_tampering_and_unlisted_files_block(self):
        extra = self.package / 'SFQualification-kiểm tra/unlisted.json'
        extra.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'Unlisted'): adapter.validate_package(self.package)
        extra.unlink()
        doc = self.package / 'SFQualification-kiểm tra/draft_content.json'
        doc.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'hash'): adapter.validate_package(self.package)

    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=True)
    def test_running_app_blocks_before_mutation(self, *_):
        with self.assertRaisesRegex(ValueError, 'Close CapCut'):
            adapter.install_package(self.package, self.live, qualification=True)
        self.assertEqual(self.index.read_bytes(), self.before)
        self.assertEqual(len(list(self.live.iterdir())), 1)

    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_install_preserves_existing_index_and_retries_idempotently(self, *_):
        result = adapter.install_package(self.package, self.live, qualification=True)
        index = adapter.read_json(self.index)
        self.assertEqual(index['custom'], 123)
        self.assertEqual(index['all_draft_store'][1]['draft_id'], 'existing')
        target = Path(result['path'])
        doc = adapter.read_json(target / 'draft_content.json')
        self.assertEqual(Path(doc['materials']['videos'][0]['path']), target / 'media/video.mp4')
        self.assertEqual((self.package / 'index-before-install.backup').read_bytes(), self.before)
        after = self.index.read_bytes()
        self.assertEqual(adapter.install_package(self.package, self.live, qualification=True)['path'], str(target))
        self.assertEqual(self.index.read_bytes(), after)

    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_interrupted_index_commit_recovers_without_touching_existing_drafts(self, *_):
        with patch.object(adapter.os, 'replace', side_effect=KeyboardInterrupt('simulated process interruption')):
            with self.assertRaises(KeyboardInterrupt): adapter.install_package(self.package, self.live)
        self.assertEqual(self.index.read_bytes(), self.before)
        result = adapter.install_package(self.package, self.live)
        self.assertTrue(Path(result['path']).is_dir())
        state = adapter.read_json(self.index)
        self.assertEqual(state['custom'], 123)
        self.assertEqual(len(state['all_draft_store']), 2)
        self.assertEqual(state['all_draft_store'][1]['draft_id'], 'existing')

    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_interrupted_install_refuses_external_index_changes(self, *_):
        with patch.object(adapter.os, 'replace', side_effect=KeyboardInterrupt()):
            with self.assertRaises(KeyboardInterrupt): adapter.install_package(self.package, self.live)
        changed = b'{"all_draft_store":[],"external":true}'
        self.index.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'index changed'): adapter.install_package(self.package, self.live)
        self.assertEqual(self.index.read_bytes(), changed)

    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_index_commit_failure_rolls_back_new_draft(self, *_):
        with patch.object(adapter.os, 'replace', side_effect=OSError('injected index failure')):
            with self.assertRaisesRegex(OSError, 'injected'):
                adapter.install_package(self.package, self.live, qualification=True)
        self.assertEqual(self.index.read_bytes(), self.before)
        self.assertEqual([p.name for p in self.live.iterdir()], ['root_meta_info.json'])

    @patch.object(adapter, 'process_alive', return_value=False)
    @patch.object(adapter, 'inventory', return_value=['9.4.0.4015'])
    @patch.object(adapter, 'capcut_running', return_value=False)
    def test_stale_lock_recovers_copy_interrupted_before_journal(self, *_):
        pending = self.live / ('.sf-install-' + str(adapter.uuid.uuid4()))
        pending.mkdir(); (pending / 'partial-copy').write_text('interrupted')
        index_pending = self.live / ('.sf-index-' + str(adapter.uuid.uuid4()))
        index_pending.write_text('{}')
        adapter.write_json(self.live / '.space-flow-install.lock', {
            'pid': 999999, 'package': str(self.package), 'pending': pending.name, 'indexPending': index_pending.name})
        result = adapter.install_package(self.package, self.live)
        self.assertFalse(pending.exists()); self.assertFalse(index_pending.exists())
        self.assertTrue(Path(result['path']).exists())
        self.assertEqual(adapter.read_json(self.index)['all_draft_store'][1]['draft_id'], 'existing')


if __name__ == '__main__': unittest.main()
