"""Install a new BCL folder while CapCut owns its live project index."""
import json
import os
from pathlib import Path
import shutil
import time
import uuid

import capcut_adapter as adapter
from batch_capcut import relocate_batch


def install_live(package, drafts_root, report):
    root = Path(drafts_root).resolve(strict=True)
    if not root.is_dir() or root.is_relative_to(package): raise ValueError('Invalid draft root')
    target = root / report['projectName']
    journal = package / 'installation-live.json'
    if target.exists():
        if (journal.exists() and adapter.read_json(journal).get('target') == str(target)
                and not target.is_symlink()
                and adapter.read_json(target / 'draft_meta_info.json').get('draft_id') == report['projectId']):
            return {'kind': 'CapCutInstalledProject', 'path': str(target), 'report': report}
        raise ValueError('Project already exists; existing drafts are never replaced')
    size = sum(p.stat().st_size for p in (package / report['projectName']).rglob('*') if p.is_file())
    if shutil.disk_usage(root).free < size + 1024 * 1024: raise ValueError('Insufficient free space for installation')
    lock = root / '.space-flow-install.lock'
    if lock.exists():
        prior = adapter.read_json(lock)
        if prior.get('package') != str(package) or adapter.process_alive(prior['pid']):
            raise ValueError('Another CapCut installation holds the lock')
        # Never remove another installer's pending/index files.
        if prior.get('mode') != 'live-folder': raise ValueError('Retry the interrupted installation with CapCut closed')
        pending = root / prior['pending']
        if pending.resolve().parent != root or pending.is_symlink() or not pending.name.startswith('.sf-live-'):
            raise ValueError('Invalid stale installation path')
        if pending.exists(): shutil.rmtree(pending)
        lock.unlink()
    pending = root / ('.sf-live-' + str(uuid.uuid4()))
    with open(lock, 'x', encoding='utf-8') as handle:
        json.dump({'pid': os.getpid(), 'package': str(package), 'mode': 'live-folder', 'pending': pending.name}, handle)
        handle.flush(); os.fsync(handle.fileno())
    try:
        shutil.copytree(package / report['projectName'], pending)
        relocate_batch(pending, target)
        meta = adapter.read_json(pending / 'draft_meta_info.json')
        now = int(time.time() * 1000000)
        meta.update(draft_fold_path=str(target).replace('\\', '/'), draft_root_path=str(root).replace('\\', '/'),
                    tm_draft_create=now, tm_draft_modified=now)
        adapter.write_json(pending / 'draft_meta_info.json', meta)
        adapter.write_json(journal, {'target': str(target), 'projectId': report['projectId']})
        # Only publish the fully staged new folder. CapCut scans/registers it
        # on returning to Home; root_meta_info.json is never written here.
        os.rename(pending, target)
        return {'kind': 'CapCutInstalledProject', 'path': str(target), 'report': report}
    finally:
        if pending.exists() and pending.resolve().parent == root: shutil.rmtree(pending)
        lock.unlink(missing_ok=True)
