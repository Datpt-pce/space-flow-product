"""Native CapCut exports, one immutable converted timeline per isolated project."""
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid

import capcut_adapter as adapter


def render_copy(package, timeline_id, directory, name):
    report = adapter.validate_package(package)
    if report.get('mode') != 'editable-batch': raise ValueError('Cần project BCL đã convert.')
    source = Path(package) / report['projectName']
    project = adapter.read_json(source / 'Timelines/project.json')
    selected = next((t for t in project['timelines'] if t['id'] == timeline_id), None)
    if not selected: raise ValueError('Timeline không thuộc project đã convert.')
    doc = adapter.read_json(source / f'Timelines/{timeline_id}/draft_content.json')
    target = Path(directory) / name
    (target / 'media').mkdir(parents=True)
    used_media = {material['path'] for material in doc['materials']['videos'] + doc['materials']['audios']}
    for relative in used_media:
        shutil.copyfile(source / relative, target / relative)
    used_resources = {material['path'] for material in doc['materials']['transitions']}
    resource_hashes = {relative: value for relative, value in report.get('resourceHashes', {}).items()
                       if any(relative.startswith(prefix + '/') for prefix in used_resources)}
    for relative in resource_hashes:
        (target / relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, target / relative)
    project.update(id=str(uuid.uuid4()), main_timeline_id=timeline_id, timelines=[selected])
    meta = adapter.read_json(source / 'draft_meta_info.json')
    meta.update(draft_name=name, draft_id=str(uuid.uuid4()), tm_duration=doc['duration'])
    adapter.write_json(target / 'draft_content.json', doc)
    adapter.write_json(target / 'Timelines/project.json', project)
    adapter.write_json(target / f'Timelines/{timeline_id}/draft_content.json', doc)
    adapter.write_json(target / 'draft_meta_info.json', meta)
    report = copy.deepcopy(report)
    report['mediaHashes'] = {relative: value for relative, value in report['mediaHashes'].items() if relative in used_media}
    report['resourceHashes'] = resource_hashes
    report.update(format='draft-content-v1', projectName=name, projectId=meta['draft_id'], timelineCount=1,
                  timelines=[{'id': timeline_id, 'name': selected['name'], 'durationUs': doc['duration']}])
    report['files'] = {str(p.relative_to(directory)).replace('\\', '/'): adapter.file_hash(p) for p in target.rglob('*') if p.is_file()}
    adapter.write_json(Path(directory) / 'manifest.json', report)
    adapter.validate_package(directory)
    return report


def job_path(package, key):
    if not isinstance(key, str) or not re.fullmatch(r'[a-f0-9-]{36}', key): raise ValueError('Invalid render request ID')
    root = Path(package).resolve(strict=True)
    directory = (root / 'renders' / key).resolve()
    if not directory.is_relative_to(root): raise ValueError('Invalid render directory')
    return directory


def save_state(directory, state):
    pending = directory / 'state.pending.json'
    adapter.write_json(pending, state)
    os.replace(pending, directory / 'state.json')


def status(package, key):
    directory = job_path(package, key)
    state = adapter.read_json(directory / 'state.json')
    if state['status'] in ('queued', 'running') and not adapter.process_alive(state['pid']):
        state.update(status='failed', error='Tiến trình render đã dừng. Tạo lượt render mới.')
        for item in state.get('items', []):
            if item['status'] == 'running': item.update(status='failed', error=state['error'])
            elif item['status'] == 'queued': item['status'] = 'skipped'
    return state


def executable():
    override = os.environ.get('CAPCUT_EXECUTABLE')
    if override:
        return str(Path(override).resolve(strict=True))
    builds = adapter.inventory()
    root = Path(os.environ.get('CAPCUT_APPS_DIR') or Path(os.environ['LOCALAPPDATA']) / 'CapCut/Apps')
    if not builds: raise ValueError('Không tìm thấy CapCut trên máy agent.')
    return str((root / builds[-1] / 'CapCut.exe').resolve(strict=True))


def start(package, key, timeline_id, output_dir, drafts):
    if sys.platform != 'win32': raise ValueError('Render CapCut cần agent Windows có CapCut và màn hình đang đăng nhập.')
    timeline_ids = [timeline_id] if isinstance(timeline_id, str) else timeline_id
    if (not isinstance(timeline_ids, list) or not 1 <= len(timeline_ids) <= 100
            or any(not isinstance(t, str) for t in timeline_ids) or len(set(timeline_ids)) != len(timeline_ids)):
        raise ValueError('Chọn từ 1 đến 100 timeline, không trùng lặp.')
    directory = job_path(package, key)
    if (directory / 'state.json').exists():
        prior = status(package, key)
        if prior.get('timelineIds', [prior.get('timelineId')]) != timeline_ids or prior['outputDir'] != output_dir: raise ValueError('Render request đã dùng cho timeline/thư mục khác.')
        return prior
    report = adapter.validate_package(package)
    if not all(any(t['id'] == id_ for t in report.get('timelines', [])) for id_ in timeline_ids): raise ValueError('Timeline không thuộc bản convert này. Convert lại project cũ để render.')
    app = executable()
    output = Path(output_dir)
    if not output.is_absolute() or not output.is_dir(): raise ValueError('Chọn thư mục xuất MP4 có sẵn trên máy agent.')
    directory.mkdir(parents=True, exist_ok=False)
    names = {t['id']: t['name'] for t in report['timelines']}
    state = {'id': key, 'timelineId': timeline_ids[0], 'timelineIds': timeline_ids, 'outputDir': output_dir,
             'items': [{'timelineId': id_, 'name': names[id_], 'status': 'queued'} for id_ in timeline_ids],
             'status': 'queued', 'phase': 'Đang chuẩn bị render', 'pid': os.getpid()}
    save_state(directory, state)
    adapter.write_json(directory / 'request.json', {'package': str(Path(package).resolve()), 'drafts': str(drafts), 'app': app})
    try:
        with open(directory / 'worker.log', 'ab') as log:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), str(directory)], stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=log, creationflags=0x08000000,
                                       env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
        # Worker owns state updates after a small launch barrier.
        state['pid'] = process.pid
        save_state(directory, state)
        (directory / 'ready').touch()
        return state
    except Exception as error:
        state.update(status='failed', error=str(error)); save_state(directory, state)
        raise


def verify_output(path, duration_us):
    flags = {'creationflags': 0x08000000} if sys.platform == 'win32' else {}
    probe = subprocess.run([os.environ.get('FFPROBE_PATH', 'ffprobe'), '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path)],
                           capture_output=True, text=True, timeout=60, **flags)
    if probe.returncode: raise ValueError('CapCut chưa xuất được MP4 hợp lệ.')
    data = json.loads(probe.stdout)
    duration = float(data['format']['duration'])
    if not any(s['codec_type'] == 'video' for s in data['streams']) or abs(duration - duration_us / 1e6) > max(.25, duration_us / 1e6 * .02):
        raise ValueError('MP4 không khớp thời lượng timeline đã chọn.')
    decoded = subprocess.run([os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-v', 'error', '-xerror', '-i', str(path), '-f', 'null', '-'],
                             capture_output=True, text=True, timeout=max(120, duration * 2), **flags)
    if decoded.returncode: raise ValueError('MP4 xuất từ CapCut bị lỗi khi giải mã.')
    return {'path': str(path), 'sha256': adapter.file_hash(path), 'bytes': path.stat().st_size, 'durationSeconds': duration, 'engine': 'capcut'}


def worker(directory):
    for _ in range(100):
        if (directory / 'ready').exists(): break
        time.sleep(.1)
    state = adapter.read_json(directory / 'state.json')
    if 'items' not in state:
        state['items'] = [{'timelineId': state['timelineId'], 'status': 'queued'}]
    request = adapter.read_json(directory / 'request.json')
    lock = Path(request['drafts']) / '.space-flow-render.lock'
    acquired = False
    try:
        if lock.exists() and not adapter.process_alive(adapter.read_json(lock)['pid']): lock.unlink()
        with open(lock, 'x', encoding='utf-8') as handle: json.dump({'pid': os.getpid()}, handle)
        acquired = True
        def phase(message):
            state.update(status='running', phase=message); save_state(directory, state)
        from capcut_render_ui import export_project
        for index, item in enumerate(state['items']):
            item['status'] = 'running'
            phase(f'{index + 1}/{len(state["items"])} · Đang chuẩn bị timeline riêng')
            name = f'SFRender-{state["id"][:8]}-{index + 1:03d}'
            item_dir = directory / str(index + 1)
            report = render_copy(request['package'], item['timelineId'], item_dir / 'project', name)
            adapter.install_package(item_dir / 'project', request['drafts'])
            def item_phase(message): phase(f'{index + 1}/{len(state["items"])} · {message}')
            item_phase('Đang mở timeline trong CapCut')
            output = export_project(request['app'], name, Path(state['outputDir']), item_dir, item_phase)
            item_phase('Đang kiểm tra MP4')
            item.update(status='completed', result=verify_output(output, report['timelines'][0]['durationUs']))
            save_state(directory, state)
        state.update(status='completed', phase='Đã xuất MP4 bằng CapCut')
        if len(state['items']) == 1: state['result'] = state['items'][0]['result']
    except Exception as error:
        state.update(status='failed', error=str(error))
        for item in state.get('items', []):
            if item['status'] == 'running': item.update(status='failed', error=str(error))
            elif item['status'] == 'queued': item['status'] = 'skipped'
    finally:
        save_state(directory, state)
        if acquired: lock.unlink(missing_ok=True)


if __name__ == '__main__':
    worker(Path(sys.argv[1]).resolve(strict=True))
