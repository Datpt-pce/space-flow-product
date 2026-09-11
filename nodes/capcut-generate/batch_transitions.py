"""Resolve BCL's pinned transitions from this machine's CapCut resources."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import urllib.request
from urllib.parse import urlsplit
import zipfile

CATALOG = {t['type']: t for t in json.loads((Path(__file__).resolve().parents[2] / 'shared/video-transition-catalog.json').read_text())}


def resource_root():
    return Path(os.environ.get('CAPCUT_EFFECTS_DIR') or Path(os.environ.get('LOCALAPPDATA', '')) / 'CapCut/User Data/Cache/effect').resolve()


def cached_metadata(effect_id):
    base = Path(os.environ.get('CAPCUT_RESOURCE_DB_DIR') or resource_root().parent / 'ressdk_db')
    for db in sorted(base.glob('*/rp.db'), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            with sqlite3.connect(db.resolve().as_uri() + '?mode=ro', uri=True, timeout=2) as conn:
                rows = conn.execute('SELECT response_body FROM http_cache WHERE response_body LIKE ?', ('%'+effect_id+'%',))
                def walk(value):
                    if isinstance(value, dict):
                        attr = value.get('common_attr', {})
                        if str(attr.get('effect_id')) == effect_id and attr.get('effect_type') == 19:
                            yield attr
                        for child in value.values(): yield from walk(child)
                    elif isinstance(value, list):
                        for child in value: yield from walk(child)
                for (body,) in rows:
                    yield from walk(json.loads(body))
        except (sqlite3.Error, ValueError, OSError):
            continue


def valid_bundle(directory, base):
    if not directory.resolve().is_relative_to(base) or directory.is_symlink():
        return False
    try:
        extra = json.loads((directory / 'extra.json').read_text(encoding='utf-8'))
        return 'transition' in extra and (directory / 'config.json').is_file()
    except (OSError, ValueError):
        return False


def allowed_url(url):
    parsed = urlsplit(url)
    return parsed.scheme == 'https' and not parsed.username and not parsed.password and parsed.port in (None, 443) and parsed.hostname and parsed.hostname.endswith(('.ibyteimg.com', '.byteoversea.com', '.ibytedtos.com'))


class ResourceRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_url(newurl): raise ValueError('Invalid CapCut resource redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def resolve_resource(kind):
    if kind not in CATALOG: raise ValueError('CapCut: transition chưa hỗ trợ: ' + str(kind))
    entry = CATALOG[kind]; effect_id = entry['effectId']; base = resource_root()
    folder = base / effect_id
    if folder.exists():
        for sub in sorted(folder.iterdir()):
            if not sub.name.endswith('_tmp') and valid_bundle(sub, base): return sub
    # Use only metadata already fetched by the local CapCut app. Never embed
    # signed URLs or account data in code, manifests or server responses.
    for attr in cached_metadata(effect_id):
        md5 = attr.get('md5', '')
        if not re.fullmatch('[a-fA-F0-9]{32}', md5): continue
        for url in attr.get('item_urls', []):
            if not isinstance(url, str) or not allowed_url(url): continue
            folder.mkdir(parents=True, exist_ok=True)
            if not folder.resolve().is_relative_to(base): raise ValueError('Invalid CapCut resource path')
            try:
                with tempfile.TemporaryDirectory(prefix='sf-resource-', dir=folder) as temporary:
                    staging = Path(temporary); archive = staging / 'resource.zip'
                    opener = urllib.request.build_opener(ResourceRedirect())
                    with opener.open(url, timeout=30) as response, archive.open('wb') as output:
                        total = 0
                        while chunk := response.read(1024*1024):
                            total += len(chunk)
                            if total > 100*1024*1024: raise ValueError('CapCut resource too large')
                            output.write(chunk)
                    if hashlib.md5(archive.read_bytes()).hexdigest().lower() != md5.lower(): raise ValueError('CapCut resource checksum mismatch')
                    unpacked = staging / 'bundle'; unpacked.mkdir()
                    with zipfile.ZipFile(archive) as bundle:
                        if sum(x.file_size for x in bundle.infolist()) > 300*1024*1024: raise ValueError('CapCut resource too large')
                        for info in bundle.infolist():
                            dest = (unpacked / info.filename).resolve()
                            if not dest.is_relative_to(unpacked) or (info.external_attr >> 16) & 0o170000 == 0o120000: raise ValueError('Invalid CapCut archive path')
                        bundle.extractall(unpacked)
                    if not valid_bundle(unpacked, base): raise ValueError('Invalid CapCut transition bundle')
                    target = folder / md5
                    if not target.exists(): os.rename(unpacked, target)
                    if valid_bundle(target, base): return target
            except (OSError, ValueError, zipfile.BadZipFile):
                continue
    raise ValueError('CapCut: chưa có resource ' + entry['name'] + '. Mở Transitions trong CapCut và tải hiệu ứng này rồi thử lại.')


def resource_files(directory):
    directory = directory.resolve()
    result = []
    for p in directory.rglob('*'):
        if p.is_symlink() or not p.resolve().is_relative_to(directory): raise ValueError('Invalid transition resource link')
        if p.is_file(): result.append(p)
    if sum(p.stat().st_size for p in result) > 300*1024*1024: raise ValueError('Transition resource too large')
    return result


def apply_transitions(document, doc, segments):
    for transition in document.get('transitions', []):
        kind = transition.get('type', 'crossfade')
        if kind not in CATALOG: raise ValueError('CapCut: transition chưa hỗ trợ: ' + str(kind))
        left = segments.get(transition['fromClipId']); right = segments.get(transition['toClipId'])
        if not left or not right or left[0] is not right[0] or left[0]['type'] != 'video':
            raise ValueError('CapCut: transition phải nối hai clip cùng track hình.')
        a, b = left[1], right[1]; duration = round(transition['durationMs']*1000)
        if a['target_timerange']['start']+a['target_timerange']['duration'] != b['target_timerange']['start'] or not 0 < duration <= min(a['target_timerange']['duration'], b['target_timerange']['duration']):
            raise ValueError('CapCut: transition có thời gian không hợp lệ.')
        import uuid
        entry = CATALOG[kind]
        # Preserve the resource's overlap mode; Clock wipe/Mix become hard cuts
        # when incorrectly forced into the non-overlap mode.
        material = {'id':str(uuid.uuid4()), 'type':'transition', 'name':entry.get('nativeName', entry['name']),
                    'effect_id':entry['effectId'], 'resource_id':entry['effectId'], 'third_resource_id':entry['effectId'],
                    'source_platform':1, 'path':'resources/transitions/'+entry['effectId'], 'duration':duration,
                    'is_overlap':entry['isOverlap'], 'platform':'all', 'category_id':'100000', 'category_name':'',
                    'request_id':'', 'is_ai_transition':False, 'video_path':'', 'task_id':''}
        doc['materials']['transitions'].append(material)
        a['extra_material_refs'].append(material['id'])
