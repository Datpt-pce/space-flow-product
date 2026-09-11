"""Editable Batch Lab documents, packaged for the existing atomic installer."""
from pathlib import Path
import re
import shutil
import uuid
import json
import os
import batch_transitions
from caption_fonts import resolve_font, text_width

import capcut_adapter as adapter
from capcut_generator import _make_video_material, _make_audio_material, _make_video_segment, _make_speed_material, _build_draft_content, _empty_materials
from capcut_generator import _make_text_material, _make_text_segment


def caption_track(track, width, height, index):
    materials, segments = [], []
    presets = json.loads((Path(__file__).resolve().parents[2]/'shared/video-caption-presets.json').read_text(encoding='utf-8'))
    for cue in track['clips']:
        text = cue.get('text', {})
        if not text.get('content'):
            continue
        family = text.get('fontFamily', 'Arial')
        font = resolve_font(family)
        material = _make_text_material(text['content'], font)
        theme = next((p for p in presets if p['id'] == text.get('preset', 'box')), presets[-1])
        margin = max(.04, min(.2, text.get('safeMarginPct', 8)/100))
        size = min(text.get('fontSize', 32), height*(1-2*margin)/2.7)
        # Native font units are relative to canvas WIDTH (160 units), measured
        # against 640x360, 1920x1080 and 1080x1920 exports on CapCut 9.4.
        native_size = size*160/width
        material.update(type='subtitle', check_flag=63 if theme.get('background') else 47, font_size=native_size, font_path=font, font_name=family, add_type=1,
                        recognize_type=0, recognize_text=text['content'], border_color=theme.get('stroke', ''),
                        border_alpha=1.0 if theme.get('stroke') else 0.0, text_color=theme['color'],
                        background_style=1 if theme.get('background') else 0,
                        background_width=.28, background_height=.28,
                        background_color=theme.get('background', ''),
                        background_alpha=theme.get('alpha', 1) if theme.get('background') else 0.0,
                        line_max_width=1-2*margin, force_apply_line_max_width=False)
        content = json.loads(material['content'])
        content['styles'][0]['size'] = native_size
        rgb = lambda color: [int(color[i:i+2], 16)/255 for i in (1, 3, 5)]
        content['styles'][0]['fill']['content']['solid']['color'] = rgb(theme['color'])
        if theme.get('stroke'):
            # Native rich-text strokes, observed in local CapCut drafts.
            content['styles'][0]['strokes'] = [{'content': {'render_type':'solid', 'solid':{'color':rgb(theme['stroke'])}}, 'width':.06, 'mode':0}]
        # CapCut ranges use UTF-16 code units, including emoji/non-BMP text.
        content['styles'][0]['range'] = [0, len(text['content'].encode('utf-16-le'))//2]
        material['content'] = json.dumps(content, ensure_ascii=False)
        words = text.get('words', [])
        material['words'] = {'text':[w['word'] for w in words],
                             'start_time':[round(w['startMs']-cue['timelineInMs']) for w in words],
                             'end_time':[round(w['endMs']-cue['timelineInMs']) for w in words]}
        start, end = round(cue['timelineInMs']*1000), round(cue['timelineOutMs']*1000)
        segment = _make_text_segment(material['id'], start, end-start)
        row, column = text.get('position', 'bottom-center').split('-')
        block_height = size*(1.2*(text['content'].count('\n')+1)+.24)
        natural_width = max(1, text_width(text['content'], font, size))
        block_width = min(width*(1-2*margin), natural_width+size*.6)
        segment['clip']['scale']['x'] = min(1, (width*(1-2*margin)-size*.6)/natural_width)
        segment['clip']['transform']['y'] = 1-2*margin-block_height/height if row == 'top' else -1+2*margin+block_height/height if row == 'bottom' else 0
        segment['clip']['transform']['x'] = -1+2*margin+block_width/width if column == 'left' else 1-2*margin-block_width/width if column == 'right' else 0
        material['alignment'] = {'left':0, 'center':1, 'right':2}[column]
        segment.update(track_render_index=index, render_index=14000+index)
        materials.append(material); segments.append(segment)
    return {'id':str(uuid.uuid4()), 'name':track.get('name', 'Captions'), 'type':'text', 'flag':0, 'attribute':0, 'segments':segments}, materials


def native_document(document, assets, name):
    width, height = document['resolution']['width'], document['resolution']['height']
    doc = _build_draft_content(str(uuid.uuid4()), name, 0, [], _empty_materials(), width, height)
    # This is the native draft schema revision, not the app's marketing version.
    # Labeling rich-text content as 8.6.0 triggers CapCut's plain-text migration,
    # which renders the literal JSON instead of the caption.
    doc['new_version'] = '187.0.0'
    for key in ('platform', 'last_modified_platform'):
        doc[key]['app_version'] = '9.4.0'
    doc['fps'] = document['fps']
    # Native CapCut arrays run back to front; BCL keeps foreground first.
    tracks = sorted(document['tracks'], key=lambda t: (t['type'] == 'audio', t.get('order', 0)))
    visual_count = 0
    segments = {}
    for index, track in enumerate(tracks):
        if track.get('visible') is False:
            continue
        if track['type'] == 'caption':
            native, materials = caption_track(track, width, height, index)
            doc['materials']['texts'].extend(materials)
            if native['segments']:
                doc['tracks'].append(native)
                doc['duration'] = max(doc['duration'], max(s['target_timerange']['start']+s['target_timerange']['duration'] for s in native['segments']))
            continue
        if track['type'] not in ('video', 'audio', 'image'):
            raise ValueError('CapCut: track chưa hỗ trợ: ' + track['type'])
        native = {'id': str(uuid.uuid4()), 'type': 'audio' if track['type'] == 'audio' else 'video',
                  'name': track.get('name', ''), 'flag': 0, 'attribute': 0, 'segments': []}
        if native['type'] == 'video':
            # CapCut only repairs the active main timeline on first open. Every
            # other timeline must already mark overlay lanes explicitly.
            native['flag'] = 2 if visual_count else 0
            visual_count += 1
        for clip in track['clips']:
            if (not clip.get('assetId') or clip.get('shape') or clip.get('text') or clip.get('compoundRef')
                    or clip.get('effects') or clip.get('keyframes') or clip.get('mask') or clip.get('crop')
                    or clip.get('speed', 1) != 1 or clip.get('blendMode', 'normal') != 'normal'):
                raise ValueError('CapCut: clip có shape/text/effect/keyframe/mask/crop/speed chưa hỗ trợ. Dùng asset đã chuẩn bị hoặc bỏ chỉnh sửa đó.')
            asset = assets[clip['assetId']]
            start = round(clip['timelineInMs'] * 1000)
            end = round(clip['timelineOutMs'] * 1000)
            source_start = round(clip['sourceInMs'] * 1000)
            source_end = round(clip['sourceOutMs'] * 1000)
            if min(start, source_start) < 0 or end <= start or abs((source_end - source_start) - (end - start)) > 2:
                raise ValueError('CapCut: cửa sổ clip không hợp lệ.')
            audio = native['type'] == 'audio'
            material = (_make_audio_material(asset['path'], round(asset.get('durationMs', 0) * 1000)) if audio
                        else _make_video_material(asset['path'], {'duration': round(asset.get('durationMs', 0) * 1000),
                                                                 'width': asset['width'], 'height': asset['height']}))
            material['path'] = asset['path']
            material['material_name'] = asset['name']
            if audio:
                material['name'] = asset['name']
                # These are existing local audio files, not CapCut's Extract
                # audio operation (which can trigger an unrelated Pro prompt).
                material['type'] = 'music'
            else:
                material['has_audio'] = asset.get('hasAudio', False)
                if asset['kind'] == 'image':
                    material.update(type='photo', duration=source_end)
            doc['materials']['audios' if audio else 'videos'].append(material)
            volume = 0 if track.get('muted') else clip.get('volume', 1)
            segment = _make_video_segment(material['id'], source_start, source_end - source_start, start, end - start, volume)
            segment.update(render_index=0 if audio else index, track_render_index=index)
            transform = clip.get('transform', {})
            segment['clip'] = {'scale': {'x': transform.get('scaleX', 1), 'y': transform.get('scaleY', 1)},
                               'rotation': -transform.get('rotation', 0),
                               'transform': {'x': transform.get('x', 0) * 2 / width, 'y': -transform.get('y', 0) * 2 / height},
                               'flip': {'horizontal': False, 'vertical': False}, 'alpha': transform.get('opacity', 1)}
            speed = _make_speed_material()
            doc['materials']['speeds'].append(speed)
            segment['extra_material_refs'] = [speed['id']]
            fade_in, fade_out = round(clip.get('audioFadeInMs', 0) * 1000), round(clip.get('audioFadeOutMs', 0) * 1000)
            if (audio or material.get('has_audio')) and (fade_in or fade_out):
                fade = {'id': str(uuid.uuid4()), 'type': 'audio_fade', 'fade_in_duration': fade_in,
                        'fade_out_duration': fade_out, 'fade_type': 0}
                doc['materials']['audio_fades'].append(fade)
                segment['extra_material_refs'].append(fade['id'])
            native['segments'].append(segment)
            if clip.get('id'): segments[clip['id']] = (native, segment)
            doc['duration'] = max(doc['duration'], end)
        if native['segments']:
            doc['tracks'].append(native)
    if not doc['tracks']:
        raise ValueError('CapCut: timeline rỗng.')
    batch_transitions.apply_transitions(document, doc, segments)
    return doc


def prepare_batch_package(payload, output_root):
    name = payload['name']
    if (not isinstance(name, str) or not name or len(name) > 100 or re.search(r'[<>:"/\\|?*\x00-\x1f]', name)
            or name.endswith(('.', ' ')) or re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', name)):
        raise ValueError('Tên project CapCut không hợp lệ.')
    timelines, sources = payload['timelines'], payload['assets']
    if not isinstance(timelines, list) or not 1 <= len(timelines) <= 100 or not isinstance(sources, dict):
        raise ValueError('CapCut: cần từ 1 đến 100 timeline.')
    assets = {}
    for index, (asset_id, source) in enumerate(sources.items()):
        path = Path(source['path']).resolve(strict=True)
        if not re.fullmatch(r'[a-f0-9]{64}', source['hash']) or adapter.file_hash(path) != source['hash']:
            raise ValueError('Media đã đổi nội dung: ' + source['name'])
        assets[asset_id] = {**source, 'path': f'media/{index}{path.suffix.lower()}'}
    # Validate every variant before any package files are written.
    documents = [native_document(t['document'], assets, t['name']) for t in timelines]
    resources = {}
    for timeline in timelines:
        for transition in timeline['document'].get('transitions', []):
            kind = transition.get('type', 'crossfade')
            effect_id = batch_transitions.CATALOG[kind]['effectId']
            if effect_id not in resources:
                directory = batch_transitions.resolve_resource(kind).resolve()
                resources[effect_id] = (directory, batch_transitions.resource_files(directory))
    root = Path(output_root).resolve(); root.mkdir(parents=True, exist_ok=True)
    total = sum(Path(source['path']).stat().st_size for source in sources.values())
    total += sum(p.stat().st_size for _, files in resources.values() for p in files)
    if shutil.disk_usage(root).free < total * 2 + 1024 * 1024:
        raise ValueError('Không đủ dung lượng đóng gói CapCut.')
    package = root / ('sf-capcut-' + str(uuid.uuid4()))
    target = package / name
    (target / 'media').mkdir(parents=True)
    hashes = {}
    resource_hashes = {}
    try:
        for effect_id, (directory, files) in resources.items():
            for source in files:
                relative = 'resources/transitions/' + effect_id + '/' + source.relative_to(directory).as_posix()
                destination = target / relative; destination.parent.mkdir(parents=True, exist_ok=True)
                expected = adapter.file_hash(source)
                shutil.copyfile(source, destination)
                if adapter.file_hash(destination) != expected: raise ValueError('Transition resource changed while copying')
                resource_hashes[relative] = expected
        for asset_id, source in sources.items():
            relative = assets[asset_id]['path']
            shutil.copyfile(source['path'], target / relative)
            if adapter.file_hash(target / relative) != source['hash']:
                raise ValueError('Media thay đổi khi sao chép.')
            hashes[relative] = source['hash']
        project = {'id': str(uuid.uuid4()), 'main_timeline_id': documents[0]['id'], 'version': 0,
                   'create_time': 0, 'update_time': 0,
                   'config': {'color_space': -1, 'render_index_track_mode_on': False, 'use_float_render': False}}
        project['timelines'] = [{'id': d['id'], 'name': d['name'], 'create_time': 0, 'update_time': 0, 'is_marked_delete': False} for d in documents]
        meta = {'draft_name': name, 'draft_id': str(uuid.uuid4()), 'draft_fold_path': '', 'draft_root_path': '',
                'draft_cover': '', 'tm_duration': documents[0]['duration'], 'draft_materials': [],
                'draft_timeline_materials_size_': total, 'tm_draft_removed': 0, 'draft_is_invisible': False,
                'draft_type': '', 'draft_new_version': '', 'cloud_draft_sync': False}
        adapter.write_json(target / 'draft_content.json', documents[0])
        adapter.write_json(target / 'draft_meta_info.json', meta)
        adapter.write_json(target / 'Timelines/project.json', project)
        for doc in documents:
            adapter.write_json(target / f'Timelines/{doc["id"]}/draft_content.json', doc)
        report = {'kind': 'CapCutPackage', 'format': 'draft-content-v1',
                  'certified': False, 'mode': 'editable-batch', 'projectName': name, 'projectId': meta['draft_id'],
                  'timelineCount': len(documents), 'sourceVersion': payload['sourceVersion'], 'mediaHashes': hashes,
                  'resourceHashes': resource_hashes,
                  'timelines': [{'id': doc['id'], 'name': doc['name'], 'durationUs': doc['duration']} for doc in documents],
                  'losses': []}
        report['files'] = {str(p.relative_to(package)).replace('\\', '/'): adapter.file_hash(p) for p in target.rglob('*') if p.is_file()}
        adapter.write_json(package / 'manifest.json', report)
        adapter.validate_package(package)
        return {'kind': 'CapCutPackage', 'path': str(package), 'report': report}
    except Exception:
        if package.parent == root:
            shutil.rmtree(package)
        raise


def validate_batch_package(project, report):
    meta = adapter.read_json(project / 'Timelines/project.json')
    ids = [t['id'] for t in meta['timelines']]
    if len(meta['timelines']) != report['timelineCount'] or len(set(ids)) != len(ids) or meta['main_timeline_id'] not in ids:
        raise ValueError('Invalid timeline count')
    for relative, expected in report['mediaHashes'].items():
        media = (project / relative).resolve(strict=True)
        if not relative.startswith('media/') or not media.is_relative_to(project / 'media') or adapter.file_hash(media) != expected:
            raise ValueError('Invalid native media reference/hash')
    for relative, expected in report.get('resourceHashes', {}).items():
        resource = (project / relative).resolve(strict=True)
        if not relative.startswith('resources/transitions/') or not resource.is_relative_to(project / 'resources/transitions') or adapter.file_hash(resource) != expected:
            raise ValueError('Invalid transition resource/hash')
    for timeline in meta['timelines']:
        if not re.fullmatch(r'[a-fA-F0-9-]{36}', timeline['id']):
            raise ValueError('Invalid timeline ID')
        doc = adapter.read_json(project / f'Timelines/{timeline["id"]}/draft_content.json')
        if doc['id'] != timeline['id']:
            raise ValueError('Invalid timeline reference')
        if doc['id'] == meta['main_timeline_id'] and doc != adapter.read_json(project / 'draft_content.json'):
            raise ValueError('Timeline copies do not match')
        materials = {m['id'] for entries in doc['materials'].values() for m in entries}
        for material in doc['materials']['transitions']:
            prefix = 'resources/transitions/' + material['effect_id']
            if material['path'] != prefix or prefix+'/config.json' not in report.get('resourceHashes', {}) or prefix+'/extra.json' not in report.get('resourceHashes', {}):
                raise ValueError('Unpackaged transition resource')
        for material in doc['materials']['videos'] + doc['materials']['audios']:
            if material['path'] not in report['mediaHashes']:
                raise ValueError('Unpackaged native media')
        for track in doc['tracks']:
            for segment in track['segments']:
                if any(ref not in materials for ref in [segment['material_id'], *segment['extra_material_refs']]):
                    raise ValueError('Unresolved native material reference')


def relocate_batch(project, target):
    timelines = adapter.read_json(project / 'Timelines/project.json')
    for timeline in timelines['timelines']:
        location = project / f'Timelines/{timeline["id"]}/draft_content.json'
        doc = adapter.read_json(location)
        for material in doc['materials']['videos'] + doc['materials']['audios']:
            material['path'] = str(target / material['path']).replace('\\', '/')
        for material in doc['materials']['transitions']:
            material['path'] = str(target / material['path']).replace('\\', '/')
        adapter.write_json(location, doc)
        if timeline['id'] == timelines['main_timeline_id']:
            adapter.write_json(project / 'draft_content.json', doc)
