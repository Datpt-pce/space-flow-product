"""Hierarchical V3 orchestration; codecs and resize presets come from V2."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from datetime import datetime
from uuid import uuid4

V2_PATH = Path(__file__).resolve().parent.parent / 'resize-upload-v2' / 'executor.py'
spec = importlib.util.spec_from_file_location('resize_upload_v2', V2_PATH)
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
v1 = v2.v1
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'}
LABEL = re.compile(r'A\d{2}B(?:[1-9]|1[0-2])C(?:[1-9]|[12]\d|3[01])D(?:\d|1\d|2[0-3])E(?:\d|[1-5]\d)F(?:\d|[1-5]\d)G[1-9]\d*')


def valid_label(value):
    if not LABEL.fullmatch(value):
        return False
    try:
        yy, month, day, hour, minute, second, _ = map(int, re.findall(r'\d+', value))
        datetime(2000 + yy, month, day, hour, minute, second)
        return True
    except ValueError:
        return False


def safe_segment(value):
    value = unicodedata.normalize('NFKD', value.replace('đ', 'd').replace('Đ', 'D'))
    value = value.encode('ascii', 'ignore').decode()
    value = re.sub(r'[^A-Za-z0-9-]+', '-', value).strip('-')
    if not value or len(value) > 100:
        raise ValueError('Tên theme/ngôn ngữ phải có chữ hoặc số, tối đa 100 ký tự')
    if re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])', value):
        value = 'folder-' + value
    return value


def language_code(value):
    name = safe_segment(value).upper()
    return {'ENGLISH': 'EN', 'VIETNAMESE': 'VI', 'TIENG-VIET': 'VI',
            'FRENCH': 'FR', 'JAPANESE': 'JA', 'KOREAN': 'KO',
            'GERMAN': 'DE', 'SPANISH': 'ES'}.get(name, name)


def path_value(value):
    if isinstance(value, dict):
        value = value.get('path') or value.get('value') or ''
    return Path(v1._to_container_path(str(value).strip().strip('"'))).resolve()


def scan(config, inputs=None, now=None):
    """Read-only scan. Reserve all user labels before generating any replacements."""
    now = now or (datetime.fromisoformat(config['label_timestamp']) if config.get('label_timestamp') else datetime.now())
    ids = set()
    for row in config.get('rows') or []:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'] or row['id'] in ids:
            raise ValueError('Mỗi dòng phải có id riêng')
        if not isinstance(row.get('input_folders'), list) or not isinstance(row.get('platforms'), list):
            raise ValueError('Dòng cần danh sách folder và nền tảng')
        ids.add(row['id'])
    rows, errors, warnings, snapshots = [], [], [], []
    sources = {}
    extra = (inputs or {}).get('folders_in') or []
    for row in config.get('rows') or []:
        if not row.get('selected'):
            continue
        row_id = row.get('id')
        result = {'row_id': row_id, 'themes': []}
        rows.append(result)
        roots = list(dict.fromkeys(str(path_value(p)) for p in (row.get('input_folders') or []) + extra if p))
        if not roots:
            errors.append({'row_id': row_id, 'message': 'Chưa chọn folder Theme'})
        seen_themes = set()
        for root_value in roots:
            root = Path(root_value)
            try:
                if not root.is_dir() or root.is_symlink():
                    raise ValueError(f'Folder Theme không tồn tại hoặc là liên kết: {root}')
                theme = safe_segment(root.name)
                if theme.lower() in seen_themes:
                    raise ValueError(f'Tên Theme bị trùng sau chuẩn hóa: {theme}')
                seen_themes.add(theme.lower())
                children = sorted(root.iterdir(), key=lambda p: p.name.casefold())
                if any(p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS for p in children):
                    raise ValueError(f'{root.name}: video phải nằm trong folder ngôn ngữ')
                langs = [p for p in children if p.is_dir() and not p.is_symlink()]
                if not langs:
                    raise ValueError(f'{root.name}: chưa có folder ngôn ngữ')
                theme_result = {'path': str(root), 'theme': theme, 'languages': []}
                result['themes'].append(theme_result)
                seen_langs = set()
                for folder in langs:
                    language = language_code(folder.name)
                    if language in seen_langs:
                        raise ValueError(f'{root.name}: ngôn ngữ bị trùng sau chuẩn hóa: {language}')
                    seen_langs.add(language)
                    children = sorted(folder.iterdir(), key=lambda p: p.name.casefold())
                    if any(p.is_dir() or p.is_symlink() for p in children):
                        raise ValueError(f'{folder}: chỉ đặt video trực tiếp dưới folder ngôn ngữ')
                    videos = []
                    for file in children:
                        if not file.is_file() or file.suffix.lower() not in VIDEO_EXTENSIONS:
                            continue
                        key = os.path.normcase(str(file.resolve()))
                        stat = file.stat()
                        snapshots.append((row_id, str(file), stat.st_size, stat.st_mtime_ns))
                        if key not in sources:
                            sources[key] = {'path': str(file), 'name': file.name, 'original_label': file.stem}
                        videos.append(sources[key])
                    theme_result['languages'].append({'path': str(folder), 'language': language, 'videos': videos, 'count': len(videos)})
                    snapshots.append((row_id, str(folder), len(videos)))
                    if len(videos) < 5:
                        warnings.append({'row_id': row_id, 'theme': theme, 'language': language,
                                         'count': len(videos), 'path': str(folder),
                                         'message': f'{root.name} / {folder.name}: {len(videos)}/5 video'})
            except (ValueError, OSError) as error:
                errors.append({'row_id': row_id, 'message': str(error)})

    reserved = {v['original_label'] for v in sources.values() if valid_label(v['original_label'])}
    used = set()
    prefix = f'A{now.year % 100:02}B{now.month}C{now.day}D{now.hour}E{now.minute}F{now.second}G'
    sequence = 1
    for video in sources.values():
        original = video['original_label']
        if valid_label(original) and original not in used:
            label = original
        else:
            while f'{prefix}{sequence}' in reserved or f'{prefix}{sequence}' in used:
                sequence += 1
            label = f'{prefix}{sequence}'
            sequence += 1
        used.add(label)
        video.update(label=label, renamed=label != original)
    fingerprint = hashlib.sha256(json.dumps(snapshots, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {'rows': rows, 'warnings': warnings, 'errors': errors, 'fingerprint': fingerprint, 'label_timestamp': now.isoformat()}


def desktop_folder():
    if os.environ.get('SF_DESKTOP_DIR'):
        return path_value(os.environ['SF_DESKTOP_DIR'])
    if os.name == 'nt':
        # Respect OneDrive/redirected Desktop instead of assuming USERPROFILE/Desktop.
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders') as key:
                return Path(os.path.expandvars(winreg.QueryValueEx(key, 'Desktop')[0]))
        except OSError:
            pass
    if os.environ.get('HOST_USERPROFILE'):
        return path_value(os.environ['HOST_USERPROFILE'] + '/Desktop')
    return Path.home() / 'Desktop'


def run_date(row):
    value = datetime.now().strftime('%y%m%d') if row.get('use_today_date', True) else row.get('custom_date', '')
    if not re.fullmatch(r'\d{6}', value):
        raise ValueError('Ngày phải đúng YYMMDD (ví dụ 260909)')
    try:
        datetime.strptime(value, '%y%m%d')
    except ValueError:
        raise ValueError(f'Ngày không tồn tại: {value}') from None
    return value


def copy_file(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Unique run roots + exclusive creation protect pre-existing files, including races.
    with destination.open('xb') as output, Path(source).open('rb') as input_file:
        shutil.copyfileobj(input_file, output)
    return str(destination)


def checked_child(target, root, protected_roots=()):
    root, target = Path(root).resolve(), Path(target).absolute()
    resolved = target.resolve()
    if resolved == root or root not in resolved.parents:
        raise ValueError(f'Từ chối thay thư mục ngoài đích đã chọn: {target}')
    for parent in [target, *target.parents]:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError(f'Từ chối thay thư mục liên kết: {target}')
    for source in protected_roots:
        source = Path(source).resolve()
        if resolved == source or resolved in source.parents or source in resolved.parents:
            raise ValueError(f'Thư mục xuất trùng hoặc lồng với Input: {target}')
    return target


def replace_group(source, destination, root, protected_roots):
    """Replace only the selected generated language group, never its parent/root.

    All rendering finished in a unique workspace before this is called. Remove
    the old group before copying new bytes so Drive cannot receive both versions.
    A failed copy is reported as failure; it never authorizes Asana completion.
    """
    destination = checked_child(destination, root, protected_roots)
    if source:
        source_path, destination_path = Path(source).resolve(), destination.resolve()
        if source_path == destination_path or source_path in destination_path.parents or destination_path in source_path.parents:
            raise ValueError(f'Đích copy trùng hoặc lồng với thư mục nguồn: {destination}')
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    lock = root / ('.v3-lock-' + hashlib.sha256(str(destination).casefold().encode()).hexdigest()[:20])
    try:
        lock.mkdir()
    except FileExistsError:
        raise ValueError(f'Nhóm này đang được xử lý bởi lần chạy khác: {destination}') from None
    try:
        checked_child(destination, root, protected_roots)
        if destination.is_dir():
            shutil.rmtree(destination)
        elif destination.exists():
            destination.unlink()
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source and Path(source).is_dir():
            shutil.copytree(source, destination)
        else:
            destination.mkdir()  # Empty language/disabled thumbnails also clears stale output.
    finally:
        checked_child(lock, root).rmdir()


def replace_flat_thumbnails(source, root, theme, code, language, protected_roots):
    """V2 contract: JPGs directly in the configured thumbnail root.

    Delete only the exact Theme/Code/Language filename family, including old
    auto-generated labels or sizes no longer selected. Other families survive.
    """
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    family = f'{theme}_{code}_{language}'
    lock = root / ('.v3-lock-' + hashlib.sha256(family.encode()).hexdigest()[:20])
    try:
        lock.mkdir()
    except FileExistsError:
        raise ValueError(f'Thumbnail đang được xử lý bởi lần chạy khác: {family}') from None
    try:
        pattern = re.compile(r'^' + re.escape(f'{theme}_{code}_') + r'.+_' + re.escape(language)
                             + r'_\d+_(?:\d+s_)?\d{6}\.jpg$', re.IGNORECASE)
        files = list(Path(source).glob('*.jpg')) if Path(source).is_dir() else []
        protected = [*protected_roots, str(source)]
        old = [file for file in root.iterdir() if pattern.fullmatch(file.name)]
        # Validate every destination before deleting anything.
        for file in old + [root / file.name for file in files]:
            checked_child(file, root, protected)
            if file.is_dir():
                raise ValueError(f'Đích thumbnail không phải file: {file}')
        for file in old:
            file.unlink()
        for file in files:
            copy_file(file, root / file.name)
    finally:
        checked_child(lock, root).rmdir()


def thumbnail(video, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(video), '-frames:v', '1', str(output)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=v1.CREATE_NO_WINDOW)
    if result.returncode or not output.is_file() or not output.stat().st_size:
        raise ValueError(f'Không tạo được thumbnail: {video}')


def metadata(file):
    proc = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                           'stream=width,height:format=duration', '-of', 'json', str(file)],
                          capture_output=True, text=True, creationflags=v1.CREATE_NO_WINDOW)
    if proc.returncode:
        raise ValueError(f'Không đọc được video: {file}')
    data = json.loads(proc.stdout)
    stream = data['streams'][0]
    w, h = stream['width'], stream['height']
    divisor = math.gcd(w, h)
    return f'{w // divisor}{h // divisor}', max(1, round(float(data['format']['duration'])))


def run(payload):
    config = payload.get('config') or {}
    output_folder = str(config.get('output_folder') or '').strip()
    if payload.get('action') != 'preview' and not config.get('test_mode', True) and not output_folder:
        raise ValueError('Chọn Output Folder trước khi chạy thật')
    preview = scan(config, payload.get('inputs'))
    if payload.get('action') == 'preview':
        return preview
    result = {'files_out': [], 'thumbnail_files': [], 'unc_links': [], 'rows': {}, 'warnings': preview['warnings']}
    if preview['warnings'] and config.get('short_video_ack') != preview['fingerprint']:
        result.update(needs_confirmation=True, preview=preview)
        for row in preview['rows']:
            entry = {'row_id': row['row_id'], 'status': 'warning', 'error': 'Có folder dưới 5 video. Kiểm tra Input rồi chọn Vẫn chạy tiếp.', 'unc_links': []}
            result['rows'][row['row_id']] = entry
            v2.row_result(row['row_id'], 'warning', error=entry['error'])
        return result

    catalog = payload.get('catalog') or {}
    test_mode = config.get('test_mode', True)
    test_root = path_value(config['test_output_folder']) if config.get('test_output_folder') else desktop_folder() / 'SpaceFlow-Resize-Upload-V3-Test'
    output_root = test_root if test_mode else path_value(output_folder)
    run_id = datetime.now().strftime('%y%m%d-%H%M%S-') + uuid4().hex[:12]
    protected_roots = [theme['path'] for row in preview['rows'] for theme in row['themes']]
    run_root = output_root / '.v3-work' / run_id
    checked_child(run_root, output_root, protected_roots)
    result['output_folder'] = str(output_root)
    rows = [r for r in config.get('rows') or [] if r.get('selected')]
    for idx, row in enumerate(rows):
        row_id = row.get('id')
        row_files, row_thumbs, links = [], [], []
        original_progress = v1.progress
        try:
            errors = [e['message'] for e in preview['errors'] if e['row_id'] == row_id]
            if errors:
                raise ValueError('; '.join(errors))
            app_id = row.get('app', '')
            app = catalog.get(app_id)
            if not app:
                raise ValueError('Chưa chọn App hợp lệ trong thư viện')
            platforms = list(dict.fromkeys(row.get('platforms') or []))
            if not platforms:
                raise ValueError('Chọn ít nhất một nền tảng')
            for key in platforms:
                platform = app.get('platforms', {}).get(key)
                if not platform or not re.fullmatch(r'[A-Za-z0-9-]{1,40}', platform.get('code', '')):
                    raise ValueError(f'{key}: chưa có mã app hợp lệ trong thư viện')
                if not test_mode and row.get('use_unc', True):
                    for field in ['folder'] + (['thumbnail_folder'] if row.get('export_thumbnail', True) else []):
                        value = platform.get(field, '').strip()
                        if not value or re.match(r'https?://', value, re.I):
                            raise ValueError(f'{key}: cần đường dẫn {field} đã đồng bộ trên máy')
            date = run_date(row)
            scanned_row = next(r for r in preview['rows'] if r['row_id'] == row_id)
            all_languages = [(theme, lang) for theme in scanned_row['themes'] for lang in theme['languages']]
            languages = [(theme, lang) for theme, lang in all_languages if lang['videos']]
            if not languages:
                raise ValueError('Không có video để xử lý trong dòng này')
            run_root.mkdir(parents=True, exist_ok=True)
            # Row ordinal prevents duplicate row/app destinations from colliding.
            row_root = run_root / f'{idx + 1:02}-{safe_segment(app_id)}'
            for lang_idx, (theme, lang) in enumerate(languages):
                def report(pct, message=''):
                    overall = (idx + (lang_idx + pct / 100) / len(languages)) / max(1, len(rows)) * 100
                    v2.progress(min(99, int(overall)), f'{app["name"]} / {theme["theme"]} / {lang["language"]}: {message}')
                v1.progress = report
                with tempfile.TemporaryDirectory(prefix='.v3-', dir=run_root) as temporary:
                    scratch = Path(temporary)
                    stage, resized = scratch / 'input', scratch / 'resized'
                    stage.mkdir()
                    upload_only = payload.get('run_mode') == 'upload_only'
                    if upload_only:
                        rendered = []
                        for video in lang['videos']:
                            size, duration = metadata(video['path'])
                            target = resized / 'input' / f'{video["label"]}_{size}_{duration}s_{date}{Path(video["path"]).suffix.lower()}'
                            copy_file(video['path'], target)
                            rendered.append(str(target))
                    else:
                        for video in lang['videos']:
                            target = stage / (video['label'] + '.mp4')
                            try:
                                os.link(video['path'], target)
                            except OSError:
                                shutil.copy2(video['path'], target)
                        cfg = {**config, 'input_folders': [str(stage)], 'output_folder': str(resized),
                               'mode': row.get('mode', '4_sizes_meta'), 'rename_videos': False,
                               'export_thumbnail': bool(row.get('export_thumbnail', True))}
                        rendered = v1.process_videos(cfg, {}, date_tag=date)
                    for file in rendered:
                        file = Path(file)
                        label, remainder = file.stem.split('_', 1)
                        # V1 omits duration when a sub-second clip rounds to zero.
                        # V3 always emits the complete seven-field filename.
                        if len(remainder.split('_')) == 2:
                            size, date_part = remainder.split('_')
                            remainder = f'{size}_{metadata(file)[1]}s_{date_part}'
                        thumb = resized / '_Thumbnail' / 'input' / (file.stem + '.jpg')
                        if row.get('export_thumbnail', True) and (not thumb.is_file() or not thumb.stat().st_size):
                            thumbnail(file, thumb)
                        for platform_id in platforms:
                            platform = app['platforms'][platform_id]
                            name = f'{theme["theme"]}_{platform["code"]}_{label}_{lang["language"]}_{remainder}'
                            folder = row_root / safe_segment(platform_id) / theme['theme'] / lang['language']
                            row_files.append(copy_file(file, folder / (name + file.suffix)))
                            if row.get('export_thumbnail', True):
                                row_thumbs.append(copy_file(thumb, row_root / safe_segment(platform_id) / '_Thumbnail' / theme['theme'] / lang['language'] / (name + '.jpg')))
            # Stable publication paths. Never distribute by scanning previous output.
            final_row_root = output_root / safe_segment(app_id)
            for platform_id in platforms:
                local = row_root / safe_segment(platform_id)
                final = final_row_root / safe_segment(platform_id)
                for theme, lang in all_languages:
                    relative = Path(theme['theme']) / lang['language']
                    replace_group(local / relative, final / relative, output_root, protected_roots)
                    replace_group(local / '_Thumbnail' / relative, final / '_Thumbnail' / relative, output_root, protected_roots)
            row_files = [str(final_row_root / Path(file).relative_to(row_root)) for file in row_files]
            row_thumbs = [str(final_row_root / Path(file).relative_to(row_root)) for file in row_thumbs]
            if not test_mode and row.get('use_unc', True):
                for platform_id in platforms:
                    platform = app['platforms'][platform_id]
                    local = row_root / safe_segment(platform_id)
                    drive_root = path_value(platform['folder'])
                    thumb_root = path_value(platform['thumbnail_folder']) if platform.get('thumbnail_folder') else None
                    for theme, lang in all_languages:
                        relative = Path(theme['theme']) / lang['language']
                        group = f'{theme["theme"]}_{platform["code"]}_{lang["language"]}'
                        destination = drive_root / date[:4] / date / group
                        replace_group(local / relative, destination, drive_root, protected_roots)
                        links.append(str(destination))
                        if thumb_root:
                            replace_flat_thumbnails(local / '_Thumbnail' / relative, thumb_root, theme['theme'], platform['code'], lang['language'], protected_roots)
                            if row.get('export_thumbnail', True):
                                links.append(str(thumb_root))
            if test_mode:
                links = [str(final_row_root)]
            if not test_mode and config.get('use_asana', True) and payload.get('run_mode', 'full') == 'full':
                urls = [u.strip() for u in row.get('task_urls', '').splitlines() if u.strip()]
                pat = (payload.get('settings') or {}).get('asana_pat_main', '')
                if urls and not pat:
                    raise ValueError('Chưa chọn Asana Credential')
                for url in urls:
                    gid = v1.get_task_gid_from_url(url)
                    if not gid:
                        raise ValueError('Asana task URL không hợp lệ')
                    v1.post_task_comment(pat, gid, '\n'.join(links) or str(final_row_root))
                    fg, og = config.get('asana_field_gid'), config.get('asana_option_gid')
                    if not fg or not og:
                        fg, og = v1.find_progress_and_done_option(pat, gid)
                    if fg and og:
                        v1.update_task_custom_field(pat, gid, fg, og)
            entry = {'row_id': row_id, 'status': 'done', 'unc_links': links, 'error': None}
        except Exception as error:
            entry = {'row_id': row_id, 'status': 'error', 'unc_links': links, 'error': str(error)}
            v2.log(f'Dòng {idx + 1}: {error}')
        finally:
            v1.progress = original_progress
        # Failed staging/publication must not advertise temporary files removed below.
        row_files = [file for file in row_files if run_root not in Path(file).parents]
        row_thumbs = [file for file in row_thumbs if run_root not in Path(file).parents]
        result['files_out'].extend(row_files)
        result['thumbnail_files'].extend(row_thumbs)
        result['unc_links'].extend(links)
        result['rows'][row_id] = entry
        v2.row_result(row_id, entry['status'], links, entry['error'])
    result['success'] = all(r['status'] == 'done' for r in result['rows'].values())
    if run_root.exists():
        checked_child(run_root, output_root, protected_roots)
        shutil.rmtree(run_root)
    try:
        checked_child(run_root.parent, output_root, protected_roots).rmdir()
    except OSError:
        pass  # Another run may still be using this parent; never delete its files.
    v2.progress(100, 'Hoàn tất' if result['success'] else 'Có dòng lỗi — xem kết quả')
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(run(json.loads(sys.stdin.read())), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
