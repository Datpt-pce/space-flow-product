"""Isolated, version-pinned rendered-video handoff. No legacy draft writer calls."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

PROFILE_ROOT = Path(__file__).parent / 'profiles'


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.flush()
        os.fsync(output.fileno())


def file_hash(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def profile_for(build):
    if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', build):
        raise ValueError('Exact CapCut build is required')
    profile_path = PROFILE_ROOT / build / 'profile.json'
    if not profile_path.is_file():
        raise ValueError(f'Unsupported CapCut build: {build}; use the verified MP4 delivery')
    return read_json(profile_path)


def inventory():
    root = os.environ.get('CAPCUT_APPS_DIR')
    if not root and sys.platform == 'win32':
        root = str(Path(os.environ['LOCALAPPDATA']) / 'CapCut/Apps')
    if not root or not Path(root).is_dir():
        return []
    return sorted([p.name for p in Path(root).iterdir()
                   if p.is_dir() and re.fullmatch(r'\d+\.\d+\.\d+\.\d+', p.name)
                   and (p / 'CapCut.exe').is_file()], key=lambda v: tuple(map(int, v.split('.'))))


def capcut_running():
    if sys.platform != 'win32':
        raise ValueError('Install requires the Windows local agent; package generation works on other platforms')
    result = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq CapCut.exe', '/FO', 'CSV', '/NH'],
                            capture_output=True, check=True, creationflags=0x08000000)
    return b'capcut.exe' in result.stdout.lower()


def prepare_video_package(delivery, output_root, build, name, accept_flattening=False):
    profile = profile_for(build)
    if delivery.get('kind') != 'VerifiedVideo' or not re.fullmatch(r'[a-f0-9]{64}', delivery.get('sha256', '')):
        raise ValueError('Expected VerifiedVideo with path and SHA-256')
    if not accept_flattening:
        raise ValueError('Confirm rendered-video handoff: source tracks/effects cannot be edited separately in CapCut')
    if not name or len(name) > 100 or re.search(r'[<>:"/\\|?*\x00-\x1f]', name) or name in ['.', '..'] or name.endswith(('.', ' ')) or re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', name):
        raise ValueError('Invalid project name')
    source = Path(delivery['path']).resolve(strict=True)
    if file_hash(source) != delivery['sha256']:
        raise ValueError('Video no longer matches the verified delivery hash')
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)],
                           capture_output=True, check=True, **({'creationflags': 0x08000000} if sys.platform == 'win32' else {}))
    metadata = json.loads(probe.stdout)
    video = next((s for s in metadata['streams'] if s['codec_type'] == 'video'), None)
    if not video or video['codec_name'] != 'h264':
        raise ValueError('This profile accepts H.264 MP4 deliveries')
    duration = round(float(metadata['format']['duration']) * 1000000)
    fps_parts = video['avg_frame_rate'].split('/')
    fps = int(fps_parts[0]) / int(fps_parts[1])
    root = Path(output_root).resolve(); root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < source.stat().st_size * 2 + 1024 * 1024:
        raise ValueError('Insufficient free space for the staged package')
    package = root / ('sf-capcut-' + str(uuid.uuid4()))
    package.mkdir()
    template_root = PROFILE_ROOT / build
    doc = read_json(template_root / 'draft_content.json')
    refs = {}
    def reidentify(value):
        if isinstance(value, dict): return {k: reidentify(v) for k, v in value.items()}
        if isinstance(value, list): return [reidentify(v) for v in value]
        if isinstance(value, str) and re.fullmatch(r'[0-9A-Fa-f-]{36}', value):
            return refs.setdefault(value, str(uuid.uuid4()).upper())
        return value
    doc = reidentify(doc)
    target = package / name
    target.mkdir()
    media = target / 'media' / 'video.mp4'; media.parent.mkdir()
    shutil.copyfile(source, media)
    doc.update(name=name, duration=duration, fps=fps, create_time=0, update_time=0)
    doc['canvas_config'].update(width=video['width'], height=video['height'], ratio='original')
    segment = doc['tracks'][0]['segments'][0]
    segment['source_timerange'] = {'start': 0, 'duration': duration}
    segment['target_timerange'] = {'start': 0, 'duration': duration}
    material = doc['materials']['videos'][0]
    material.update(path='media/video.mp4', width=video['width'], height=video['height'], duration=duration,
                    material_name='video.mp4', unique_id=delivery['sha256'][:32],
                    has_audio=any(s['codec_type'] == 'audio' for s in metadata['streams']))
    project = reidentify(read_json(template_root / 'project.json'))
    project['main_timeline_id'] = doc['id']; project['timelines'][0].update(id=doc['id'], name=name)
    meta = reidentify(read_json(template_root / 'draft_meta_info.json'))
    meta.update(draft_name=name, draft_id=str(uuid.uuid4()).upper(), draft_fold_path='', draft_root_path='',
                draft_cover='', tm_duration=duration, draft_materials=[])
    write_json(target / 'draft_content.json', doc)
    write_json(target / 'draft_meta_info.json', meta)
    write_json(target / 'Timelines/project.json', project)
    write_json(target / f'Timelines/{doc["id"]}/draft_content.json', doc)
    report = {'kind': 'CapCutPackage', 'profileId': profile['id'], 'appBuild': build,
              'certified': profile['certified'], 'projectName': name, 'projectId': meta['draft_id'],
              'sourceVersion': delivery.get('versionId'), 'videoSha256': delivery['sha256'],
              'losses': ['Source tracks, captions, effects and keyframes are baked into one video'],
              'mode': 'rendered-video', 'acceptedFlattening': True}
    report['files'] = {str(p.relative_to(package)).replace('\\', '/'): file_hash(p)
                       for p in target.rglob('*') if p.is_file()}
    write_json(package / 'manifest.json', report)
    validate_package(package)
    return {'kind': 'CapCutPackage', 'path': str(package), 'report': report}


def validate_package(package):
    package = Path(package).resolve(strict=True)
    report = read_json(package / 'manifest.json')
    profile_for(report['appBuild'])
    if report.get('kind') != 'CapCutPackage': raise ValueError('Invalid package')
    for relative, expected in report['files'].items():
        candidate = (package / relative).resolve(strict=True)
        if not candidate.is_relative_to(package) or file_hash(candidate) != expected:
            raise ValueError('Package path/hash validation failed')
    project = (package / report['projectName']).resolve(strict=True)
    if project.parent != package: raise ValueError('Invalid project path')
    actual_files = set()
    for candidate in project.rglob('*'):
        if candidate.is_symlink() or not candidate.resolve().is_relative_to(project):
            raise ValueError('Package links are not allowed')
        if candidate.is_file(): actual_files.add(str(candidate.relative_to(package)).replace('\\', '/'))
    if actual_files != set(report['files']): raise ValueError('Unlisted or missing package files')
    doc = read_json(project / 'draft_content.json')
    if doc['materials']['videos'][0]['path'] != 'media/video.mp4': raise ValueError('Invalid packaged media reference')
    if file_hash(project / 'media/video.mp4') != report['videoSha256']: raise ValueError('Video hash mismatch')
    timeline_project = read_json(project / 'Timelines/project.json')
    if timeline_project['main_timeline_id'] != doc['id']: raise ValueError('Invalid main timeline reference')
    nested = read_json(project / f'Timelines/{doc["id"]}/draft_content.json')
    if nested != doc: raise ValueError('Timeline copies do not match')
    materials = {m['id'] for entries in doc['materials'].values() for m in entries}
    for track in doc['tracks']:
        for segment in track['segments']:
            if any(ref not in materials for ref in [segment['material_id'], *segment['extra_material_refs']]):
                raise ValueError('Unresolved material reference')
    return report


def process_alive(pid):
    if sys.platform == 'win32':
        import ctypes
        kernel = ctypes.windll.kernel32
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle: return kernel.GetLastError() != 87
        try:
            code = ctypes.c_ulong()
            return not kernel.GetExitCodeProcess(ctypes.c_void_p(handle), ctypes.byref(code)) or code.value == 259
        finally: kernel.CloseHandle(ctypes.c_void_p(handle))
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True


def recover_install(package, root, target, index):
    journal_path = package / 'installation.json'
    if not journal_path.exists(): return None
    journal = read_json(journal_path)
    if journal.get('target') != str(target) or not journal.get('installedFiles'):
        raise ValueError('Incomplete install journal; refusing to replace an existing project')
    if not target.is_dir(): return None
    current_hash = file_hash(index) if index.exists() else None
    if current_hash == journal['indexSha256']:
        # CapCut may have legitimately saved the installed project since installation.
        entries = read_json(index)['all_draft_store']
        if any(e.get('draft_id') == journal['projectId'] for e in entries): return True
    if current_hash != journal['indexBeforeSha256']:
        raise ValueError('CapCut index changed after interrupted install; existing data was preserved')
    expected_files = journal['installedFiles']
    actual_files = {str(p.relative_to(target)).replace('\\', '/'): file_hash(p) for p in target.rglob('*') if p.is_file() and not p.is_symlink()}
    if actual_files != expected_files or any(p.is_symlink() for p in target.rglob('*')):
        raise ValueError('Interrupted project changed; refusing to modify it')
    pending_index = root / journal['indexPending']
    if pending_index.parent != root or not pending_index.is_file() or file_hash(pending_index) != journal['indexSha256']:
        raise ValueError('Interrupted index staging is missing or changed')
    os.replace(pending_index, index)
    return True


def install_package(package, drafts_root, *, qualification=False):
    package = Path(package).resolve(strict=True)
    report = validate_package(package)
    profile = profile_for(report['appBuild'])
    if not profile['certified'] and not (qualification and report['projectName'].startswith('SFQualification-')):
        raise ValueError('Profile is not certified; package is available for qualification only')
    if report['appBuild'] not in inventory(): raise ValueError('Target CapCut build is not installed')
    if capcut_running(): raise ValueError('Close CapCut before installing the staged project')
    root = Path(drafts_root).resolve(strict=True)
    if not root.is_dir() or root.is_relative_to(package): raise ValueError('Invalid draft root')
    target = root / report['projectName']
    package_bytes = sum(p.stat().st_size for p in (package / report['projectName']).rglob('*') if p.is_file())
    if shutil.disk_usage(root).free < package_bytes + 1024 * 1024: raise ValueError('Insufficient free space for installation')
    index = root / 'root_meta_info.json'
    before = index.read_bytes() if index.exists() else None
    state = json.loads(before) if before else {'all_draft_store': [], 'draft_ids': 0, 'root_path': str(root).replace('\\', '/')}
    if not isinstance(state.get('all_draft_store'), list): raise ValueError('Invalid CapCut index; refusing to modify it')
    lock = root / '.space-flow-install.lock'
    if lock.exists():
        prior = read_json(lock)
        if prior.get('package') != str(package) or process_alive(prior['pid']):
            raise ValueError('Another CapCut installation holds the lock')
        # A process can die before reaching the commit journal. Its lock records
        # the unique staging names before any copy begins, so retry can reclaim
        # only those own files. Keep a pending index after rename for roll-forward.
        for field, prefix in [('pending', '.sf-install-'), ('indexPending', '.sf-index-')]:
            name = prior.get(field)
            if not isinstance(name, str) or not name.startswith(prefix): continue
            orphan = root / name
            if orphan.resolve().parent != root or orphan.is_symlink():
                raise ValueError('Invalid stale installation path')
            if field == 'indexPending' and target.exists(): continue
            if orphan.is_dir() and field == 'pending': shutil.rmtree(orphan)
            elif orphan.is_file(): orphan.unlink()
        lock.unlink()
    pending = root / ('.sf-install-' + str(uuid.uuid4()))
    index_pending = root / ('.sf-index-' + str(uuid.uuid4()))
    with open(lock, 'x', encoding='utf-8') as handle:
        json.dump({'pid': os.getpid(), 'package': str(package), 'pending': pending.name, 'indexPending': index_pending.name}, handle)
        handle.flush(); os.fsync(handle.fileno())
    moved = False
    committed = False
    try:
        if target.exists():
            if recover_install(package, root, target, index):
                return {'kind': 'CapCutInstalledProject', 'path': str(target), 'report': report}
            raise ValueError('Project already exists; existing drafts are never replaced')
        shutil.copytree(package / report['projectName'], pending)
        doc = read_json(pending / 'draft_content.json')
        doc['materials']['videos'][0]['path'] = str(target / 'media/video.mp4').replace('\\', '/')
        meta = read_json(pending / 'draft_meta_info.json')
        now = int(time.time() * 1000000)
        meta.update(draft_fold_path=str(target).replace('\\', '/'), draft_root_path=str(root).replace('\\', '/'), tm_draft_create=now, tm_draft_modified=now)
        write_json(pending / 'draft_content.json', doc)
        write_json(pending / f'Timelines/{doc["id"]}/draft_content.json', doc)
        write_json(pending / 'draft_meta_info.json', meta)
        entry = copy.deepcopy(meta)
        entry.update(draft_json_file=str(target / 'draft_content.json').replace('\\', '/'), streaming_edit_draft_ready=True)
        state['all_draft_store'].insert(0, entry)
        write_json(index_pending, state)
        if before is not None: (package / 'index-before-install.backup').write_bytes(before)
        if capcut_running() or (index.read_bytes() if index.exists() else None) != before:
            raise ValueError('CapCut/index changed during staging; retry after closing the app')
        write_json(package / 'installation.json', {
            'target': str(target), 'indexSha256': file_hash(index_pending), 'indexPending': index_pending.name,
            'indexBeforeSha256': hashlib.sha256(before).hexdigest() if before is not None else None,
            'installedFiles': {str(p.relative_to(pending)).replace('\\', '/'): file_hash(p) for p in pending.rglob('*') if p.is_file()},
            'projectId': report['projectId'], 'appBuild': report['appBuild'],
        })
        os.rename(pending, target); moved = True
        os.replace(index_pending, index)
        committed = True
        return {'kind': 'CapCutInstalledProject', 'path': str(target), 'report': report}
    except Exception:
        if moved and target.resolve().parent == root:
            shutil.rmtree(target)
            moved = False
        raise
    finally:
        if pending.exists() and pending.resolve().parent == root: shutil.rmtree(pending)
        # On a process interruption after rename, retain the verified pending index
        # for a guarded roll-forward on retry. Normal exceptions roll back above.
        if not moved or committed: index_pending.unlink(missing_ok=True)
        lock.unlink(missing_ok=True)


def main():
    payload = json.load(sys.stdin)
    operation = payload.get('operation')
    package_root = Path(__file__).resolve().parents[1] / '../backend/uploads/capcut-packages'
    package_root = package_root.resolve()
    if operation == 'inventory':
        builds = inventory()
        profiles = [read_json(p) for p in PROFILE_ROOT.glob('*/profile.json')]
        return {'installed': builds, 'profiles': profiles, 'canInstall': sys.platform == 'win32'}
    if operation == 'prepare':
        return prepare_video_package(payload['delivery'], package_root, payload['build'], payload['name'], payload.get('acceptFlattening') is True)
    if operation == 'install':
        package = Path(payload['packagePath']).resolve(strict=True)
        if package.parent != package_root: raise ValueError('Package is outside the agent staging directory')
        drafts = os.environ.get('CAPCUT_DRAFTS_DIR')
        if not drafts and sys.platform == 'win32': drafts = str(Path(os.environ['LOCALAPPDATA']) / 'CapCut/User Data/Projects/com.lveditor.draft')
        if not drafts: raise ValueError('CAPCUT_DRAFTS_DIR is required on this platform')
        return install_package(package, drafts)
    raise ValueError('Unknown CapCut adapter operation')


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
