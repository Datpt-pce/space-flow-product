import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import bootstrap
import setup


class BootstrapTest(unittest.TestCase):
    def test_seed_install_requires_completed_revision_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)
            (target/'inference.py').write_text('partial copy')
            self.assertFalse(setup.seed_ready(target))
            (target/'.sf-seed-revision').write_text('old')
            self.assertFalse(setup.seed_ready(target))
            (target/'.sf-seed-revision').write_text(setup.SEED_REVISION)
            self.assertTrue(setup.seed_ready(target))

    def test_install_then_worker_and_cancel(self):
        for cancelled in (False, True):
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);(root/'state.json').write_text('{"id":"test","status":"queued"}')
                if cancelled:(root/'cancel').touch()
                process=Mock();process.poll.return_value=0;process.returncode=0
                with patch.dict(os.environ,{'SF_UPLOADS_DIR':tmp}), patch.object(bootstrap.subprocess,'Popen',return_value=process) as install, patch.object(bootstrap.subprocess,'run',return_value=Mock(returncode=0)) as worker:
                    bootstrap.run(root)
                self.assertIn('--ensure',install.call_args.args[0])
                self.assertEqual(worker.call_count,0 if cancelled else 1)
                if cancelled:self.assertEqual(json.loads((root/'state.json').read_text(encoding='utf-8'))['status'],'cancelled')

    def test_failed_install_does_not_start_worker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'state.json').write_text('{"status":"queued"}')
            process=Mock();process.poll.return_value=1;process.returncode=1
            with patch.object(bootstrap.subprocess,'Popen',return_value=process),patch.object(bootstrap.subprocess,'run') as worker:
                bootstrap.run(root)
            worker.assert_not_called()
            self.assertEqual(json.loads((root/'state.json').read_text(encoding='utf-8'))['status'],'failed')

    def test_healthy_existing_runtime_skips_install(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ,{'SF_UPLOADS_DIR':tmp}),patch.object(setup,'ready',return_value=True),patch.object(setup.subprocess,'run') as command,patch('sys.argv',['setup.py','--ensure']):
            setup.main();setup.main()
            command.assert_not_called()
            self.assertTrue((Path(tmp)/'bcl-speech/runtime-version.json').exists())

    def test_cpu_detection_without_nvidia(self):
        with patch.object(setup.subprocess,'run',side_effect=FileNotFoundError):self.assertFalse(setup.cuda_available())


if __name__=='__main__':unittest.main()
