import copy
import csv
import json
import os
import sys
import uuid
import time
import shutil
from datetime import datetime
from dataclasses import dataclass, field
from typing import Callable

from video_utils import get_video_info, scan_media_files
from transition_catalog import TransitionDef


def _base_dir() -> str:
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


@dataclass
class TimelineConfig:
    name: str
    video_sources: list[str]    # mỗi phần tử là 1 folder hoặc 1 file; source[0] quyết định số clips
    music_folder: list[str]
    transitions: list[dict] = field(default_factory=list)
    text_template: bool = False
    text_path: str = ""
    music_volume_db: float = 0.0


_DRIVE_LETTERS = "DEFGHIJKLMNOPQRSTUVWXYZ"


def _to_host_path(container_path: str) -> str:
    # Khi chạy trong Docker product, các path đọc/scan trong container là dạng
    # /host-fs/... (xem docker-compose.yml), nhưng CapCut.exe đọc draft_content.json
    # NATIVE trên Windows host nên field "path" phải là path Windows thật. Quy đổi
    # ngược dựa trên các env HOST_USERPROFILE/HOST_DRIVE_X/EXTRA_HOST_DIR_N (cùng
    # nguồn dữ liệu mà backend/routes/files.js dùng để mount). No-op khi chạy dev
    # native (path không có prefix /host-fs/).
    p = container_path.replace("\\", "/")
    if not p.startswith("/host-fs/"):
        return container_path

    rest = p[len("/host-fs/"):]
    root, _, tail = rest.partition("/")
    if root == "home":
        prefix = os.environ.get("HOST_USERPROFILE", "")
    elif root.startswith("drive-") and root[6:].upper() in _DRIVE_LETTERS:
        prefix = os.environ.get(f"HOST_DRIVE_{root[6:].upper()}", "")
    elif root in ("extra1", "extra2", "extra3"):
        prefix = os.environ.get(f"EXTRA_HOST_DIR_{root[-1]}", "")
    else:
        prefix = ""
    if not prefix:
        return container_path
    return prefix.rstrip("\\/") + "\\" + tail.replace("/", "\\")


def _new_id() -> str:
    return str(uuid.uuid4())


def _make_transition_material(tdef: TransitionDef) -> dict:
    return tdef.to_material_dict(_new_id())


def _platform_block() -> dict:
    return {
        "os": "windows", "os_version": "", "app_id": 359289,
        "app_version": "8.6.0", "app_source": "cc",
        "device_id": "", "hard_disk_id": "", "mac_address": ""
    }


def _empty_materials() -> dict:
    return {
        "ai_translates": [], "audio_balances": [], "audio_effects": [],
        "audio_fades": [], "audio_pannings": [], "audio_pitch_shifts": [],
        "audio_track_indexes": [], "audios": [], "beats": [], "canvases": [],
        "chromas": [], "color_curves": [], "common_mask": [],
        "digital_human_model_dressing": [], "digital_humans": [], "drafts": [],
        "effects": [], "flowers": [], "green_screens": [], "handwrites": [],
        "hsl": [], "hsl_curves": [], "images": [], "log_color_wheels": [],
        "loudnesses": [], "manual_beautys": [], "manual_deformations": [],
        "material_animations": [], "material_colors": [], "multi_language_refs": [],
        "placeholder_infos": [], "placeholders": [], "plugin_effects": [],
        "primary_color_wheels": [], "realtime_denoises": [], "shapes": [],
        "smart_crops": [], "smart_relights": [], "sound_channel_mappings": [],
        "speeds": [], "stickers": [], "tail_leaders": [], "text_templates": [],
        "texts": [], "time_marks": [], "transitions": [], "video_effects": [],
        "video_radius": [], "video_shadows": [], "video_strokes": [],
        "video_trackings": [], "videos": [], "vocal_beautifys": [],
        "vocal_separations": []
    }


def _empty_keyframes() -> dict:
    return {
        "videos": [], "audios": [], "texts": [], "stickers": [],
        "filters": [], "adjusts": [], "handwrites": [], "effects": []
    }


def _config_block(combination_max_index: int = 1) -> dict:
    return {
        "video_mute": False, "record_audio_last_index": 1,
        "extract_audio_last_index": 1, "original_sound_last_index": 1,
        "combination_max_index": combination_max_index,
        "subtitle_recognition_id": "", "subtitle_taskinfo": [],
        "lyrics_recognition_id": "", "lyrics_taskinfo": [],
        "subtitle_sync": True, "lyrics_sync": True,
        "voice_change_sync": False, "sticker_max_index": 1,
        "adjust_max_index": 1, "material_save_mode": 0,
        "export_range": None, "maintrack_adsorb": True,
        "attachment_info": [], "zoom_info_params": None,
        "system_font_list": [], "multi_language_mode": "none",
        "multi_language_main": "none", "multi_language_current": "none",
        "multi_language_list": [], "subtitle_keywords_config": None,
        "use_float_render": False
    }


def _function_assistant() -> dict:
    return {
        "smart_rec_applied": False, "fixed_rec_applied": False,
        "auto_adjust": False, "auto_adjust_segid_list": [],
        "color_correction": False, "color_correction_segid_list": [],
        "enhance_quality": False, "smooth_slow_motion": False,
        "deflicker_segid_list": [], "video_noise_segid_list": [],
        "enhance_quality_segid_list": [], "smart_segid_list": [],
        "retouch": False, "retouch_segid_list": [],
        "enhande_voice": False, "enhance_voice_segid_list": [],
        "audio_noise_segid_list": [], "auto_caption": False,
        "auto_caption_segid_list": [], "auto_caption_template_id": "",
        "caption_opt": False, "caption_opt_segid_list": [],
        "eye_correction": False, "eye_correction_segid_list": [],
        "normalize_loudness": False, "normalize_loudness_segid_list": [],
        "normalize_loudness_audio_denoise_segid_list": [],
        "auto_adjust_fixed": False, "auto_adjust_fixed_value": 50,
        "color_correction_fixed": False, "color_correction_fixed_value": 50,
        "normalize_loudness_fixed": False, "enhande_voice_fixed": False,
        "retouch_fixed": False, "enhance_quality_fixed": False,
        "smooth_slow_motion_fixed": False, "fps": {"num": 0, "den": 1}
    }


def _make_video_segment(material_id: str, src_start: float, src_dur: float,
                         tgt_start: float, tgt_dur: float, volume: float = 1.0) -> dict:
    return {
        "id": _new_id(), "material_id": material_id,
        "source_timerange": {"start": src_start, "duration": src_dur},
        "target_timerange": {"start": tgt_start, "duration": tgt_dur},
        "render_timerange": {"start": 0, "duration": 0},
        "desc": "", "state": 0, "speed": 1, "is_loop": False,
        "is_tone_modify": False, "reverse": False, "intensifies_audio": False,
        "cartoon": False, "volume": volume, "last_nonzero_volume": volume,
        "clip": {
            "scale": {"x": 1, "y": 1}, "rotation": 0,
            "transform": {"x": 0, "y": 0},
            "flip": {"vertical": False, "horizontal": False}, "alpha": 1
        },
        "uniform_scale": {"on": True, "value": 1},
        "extra_material_refs": [], "visible": True,
        "render_index": 0, "track_attribute": 0, "track_render_index": 0,
        "keyframe_refs": [], "common_keyframes": [], "lyric_keyframes": [],
        "group_id": "", "raw_segment_id": "", "is_placeholder": False,
        "source": "", "template_id": "", "template_scene": "default",
        "hdr_settings": {"mode": 1, "nits": 1000, "source_settings": 0},
        "enable_adjust": True, "enable_color_curves": True,
        "enable_color_wheels": True, "enable_hsl": False,
        "enable_hsl_curves": False, "enable_lut": False,
        "enable_color_match_adjust": False, "enable_color_correct_adjust": False,
        "enable_smart_color_adjust": False, "enable_adjust_mask": False,
        "enable_video_mask": False, "enable_mask_stroke": False,
        "enable_mask_shadow": False, "caption_info": None,
        "color_correct_alg_result": "", "digital_human_template_group_id": "",
        "responsive_layout": {
            "target_follow": "", "horizontal_pos_layout": 0,
            "vertical_pos_layout": 0, "adapt_type": 0,
            "position_reference": "none"
        }
    }


def _make_audio_segment(material_id: str, src_dur: float, speed_id: str,
                         tgt_start: float = 0, volume: float = 0.6) -> dict:
    seg = _make_video_segment(material_id, 0, src_dur, tgt_start, src_dur, volume)
    seg["extra_material_refs"] = [speed_id]
    seg["enable_adjust"] = False
    seg["enable_color_curves"] = False
    seg["enable_color_wheels"] = False
    return seg


def _make_video_material(filepath: str, info: dict) -> dict:
    name = os.path.basename(filepath)
    return {
        "id": _new_id(), "type": "video",
        "path": _to_host_path(filepath).replace("\\", "/"),
        "duration": info["duration"],
        "width": info["width"], "height": info["height"],
        "has_audio": True, "extra_type_option": 0,
        "material_name": name, "source": 0,
        "crop": {
            "upper_left_x": 0, "upper_left_y": 0,
            "upper_right_x": 1, "upper_right_y": 0,
            "lower_left_x": 0, "lower_left_y": 1,
            "lower_right_x": 1, "lower_right_y": 1
        },
        "crop_ratio": "free", "crop_scale": 1,
        "unique_id": "", "media_path": "", "local_id": "",
        "reverse_path": "", "intensifies_path": "",
        "reverse_intensifies_path": "", "intensifies_audio_path": "",
        "cartoon_path": "", "category_id": "", "category_name": "",
        "material_id": "", "material_url": "", "formula_id": "",
        "check_flag": 1,
        "stable": {"matrix_path": "", "time_range": None, "has_analyzed": False},
        "matting": {
            "flag": 0, "strokes": [], "reverse": False,
            "has_use_quick_brush": False, "has_use_mosaic": False,
            "interactiveSegmentationInfo": None
        },
        "video_algorithm": {
            "algorithms": [], "deflicker": None,
            "noise_reduction": None, "quality_enhance": None
        },
        "smart_motion": None, "is_unified_beauty_mode": False,
        "is_text_edit_overdub": False, "is_ai_generate_content": False,
        "aigc_type": "none", "is_copyright": False,
        "aigc_history_id": "", "aigc_item_id": "",
        "local_material_from": "", "smart_match_info": None,
        "beauty_face_preset_infos": [], "beauty_body_preset_id": "",
        "beauty_face_auto_preset": False, "beauty_face_auto_preset_infos": [],
        "beauty_body_auto_preset": False, "live_photo_timestamp": -1,
        "live_photo_cover_path": "", "content_feature_info": None,
        "corner_pin": None, "surface_trackings": [],
        "video_mask_stroke": None, "video_mask_shadow": None,
        "object_locked": None, "origin_material_id": "",
        "picture_from": "none", "picture_set_category_id": "",
        "picture_set_category_name": "", "team_id": "", "request_id": "",
        "has_sound_separated": False, "is_set_beauty_mode": False,
        "audio_fade": None, "multi_camera_info": None, "freeze": None
    }


def _make_audio_material(filepath: str, duration: float) -> dict:
    name = os.path.basename(filepath)
    return {
        "id": _new_id(), "type": "extract_music",
        "name": name, "material_name": name,
        "path": _to_host_path(filepath).replace("\\", "/"),
        "duration": duration,
        "category_name": "", "wave_points": [], "music_id": "",
        "app_id": 0, "text_id": "", "tone_type": "",
        "source_platform": 0, "video_id": "", "effect_id": "",
        "resource_id": "", "third_resource_id": "", "category_id": "",
        "intensifies_path": "", "formula_id": "", "check_flag": 1,
        "team_id": "", "local_material_id": "", "is_ugc": False
    }


def _make_speed_material() -> dict:
    return {"id": _new_id(), "type": "speed", "mode": 0, "speed": 1, "curve_speed": None}


def _make_canvas_color_material() -> dict:
    return {
        "id": _new_id(), "type": "canvas_color",
        "album_image": "", "blur": 0.0, "color": "",
        "image": "", "image_id": "", "image_name": "",
        "source_platform": 0, "team_id": ""
    }


def _make_compound_video_material(mat_id: str, name: str, duration_us: int,
                                   width: int, height: int) -> dict:
    """Video material with path='' and extra_type_option=2 for compound clips."""
    return {
        "id": mat_id, "type": "video",
        "path": "", "duration": duration_us,
        "width": width, "height": height,
        "has_audio": True, "extra_type_option": 2,
        "material_name": name, "source": 0,
        "unique_id": "", "media_path": "", "local_id": "",
        "reverse_path": "", "intensifies_path": "",
        "reverse_intensifies_path": "", "intensifies_audio_path": "",
        "cartoon_path": "", "category_id": "", "category_name": "",
        "material_id": "", "material_url": "", "formula_id": "",
        "check_flag": 62978047,
        "crop": {
            "upper_left_x": 0.0, "upper_left_y": 0.0,
            "upper_right_x": 1.0, "upper_right_y": 0.0,
            "lower_left_x": 0.0, "lower_left_y": 1.0,
            "lower_right_x": 1.0, "lower_right_y": 1.0
        },
        "crop_ratio": "free", "crop_scale": 1.0,
        "stable": {"stable_level": 0, "matrix_path": "", "time_range": {"start": 0, "duration": 0}},
        "matting": {
            "flag": 0, "path": "", "interactiveTime": [],
            "has_use_quick_brush": False, "strokes": [],
            "has_use_quick_eraser": False, "expansion": 0, "feather": 0,
            "reverse": False, "custom_matting_id": "",
            "enable_matting_stroke": False, "is_clould": False,
            "mask_video_path": "", "cloud_product_fps": 0.0
        },
        "video_algorithm": {"algorithms": [], "deflicker": None, "noise_reduction": None, "quality_enhance": None},
        "smart_motion": None, "is_unified_beauty_mode": False,
        "is_text_edit_overdub": False, "is_ai_generate_content": False,
        "aigc_type": "none", "is_copyright": True,
        "aigc_history_id": "", "aigc_item_id": "",
        "local_material_from": "", "smart_match_info": None,
        "beauty_face_preset_infos": [], "beauty_body_preset_id": "",
        "beauty_face_auto_preset": False, "beauty_face_auto_preset_infos": [],
        "beauty_body_auto_preset": False, "live_photo_timestamp": -1,
        "live_photo_cover_path": "", "content_feature_info": None,
        "corner_pin": None, "surface_trackings": [],
        "video_mask_stroke": None, "video_mask_shadow": None,
        "object_locked": None, "origin_material_id": "",
        "picture_from": "none", "picture_set_category_id": "",
        "picture_set_category_name": "", "team_id": "", "request_id": "",
        "has_sound_separated": False, "is_set_beauty_mode": False,
        "audio_fade": None, "multi_camera_info": None, "freeze": None
    }


_DRAFT_PATH_PLACEHOLDER = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##"


def _safe_load_json(path: str) -> dict:
    """Tải JSON với fallback encoding khi UTF-8 fail."""
    encodings = ["utf-8", "utf-8-sig", "cp1252", "latin-1"]
    for enc in encodings:
        try:
            with open(path, encoding=enc) as f:
                return json.load(f)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    raise RuntimeError(f"Không thể đọc {path} với bất kỳ encoding nào")


def _load_text_overlay(csv_path: str) -> dict:
    """Đọc ref/text-overlay.csv → {hook_stem: text_content}."""
    result = {}
    try:
        with open(csv_path, newline="", encoding="utf-8-sig") as f:
            for row in csv.reader(f):
                if len(row) >= 2:
                    result[row[0].strip()] = row[1]
    except UnicodeDecodeError:
        with open(csv_path, newline="", encoding="latin-1") as f:
            for row in csv.reader(f):
                if len(row) >= 2:
                    result[row[0].strip()] = row[1]
    return result


def _load_text_templates(capcut_dir: str, config_path: str = "") -> list:
    """Load text templates từ ref/text-templates-data.json (snapshot).
    Fallback sang scan CapCut project nếu file không tồn tại.
    Mỗi phần tử: {"text_material": dict, "anim_material": dict|None}.
    """
    ref_dir = os.path.join(_base_dir(), "ref")
    data_path = os.path.join(ref_dir, "text-templates-data.json")

    # Ưu tiên đọc từ snapshot JSON (không phụ thuộc CapCut directory)
    if os.path.isfile(data_path):
        try:
            with open(data_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    # Fallback: scan CapCut project directory (cần text-templates.json config)
    if not config_path:
        config_path = os.path.join(ref_dir, "text-templates.json")

    capcut_project = "260527"
    target_names = [f"260527-AND-{i:02d}" for i in range(1, 6)]

    if os.path.isfile(config_path):
        try:
            with open(config_path, encoding="utf-8") as f:
                cfg = json.load(f)
            capcut_project = cfg.get("capcut_project", capcut_project)
            tpls = cfg.get("templates", [])
            if tpls:
                target_names = [t["id"] for t in tpls if t.get("id")]
        except Exception:
            pass

    project_dir = os.path.join(capcut_dir, capcut_project, "subdraft")
    if not os.path.isdir(project_dir):
        return []

    found = {name: None for name in target_names}

    for clip_id in os.listdir(project_dir):
        clip_dir = os.path.join(project_dir, clip_id)
        cfg_path = os.path.join(clip_dir, "sub_draft_config.json")
        if not os.path.isfile(cfg_path):
            continue
        try:
            cfg = _safe_load_json(cfg_path)
        except Exception:
            continue
        name = cfg.get("name", "")
        if name not in found:
            continue

        draft_path = os.path.join(clip_dir, "draft_content.json")
        if not os.path.isfile(draft_path):
            continue
        try:
            stub = _safe_load_json(draft_path)
        except Exception:
            continue

        drafts = stub.get("materials", {}).get("drafts", [])
        if not drafts:
            continue
        inline = drafts[0].get("draft", {})
        texts = inline.get("materials", {}).get("texts", [])
        if not texts:
            continue
        text_mat = texts[0]

        anim_id = None
        for track in inline.get("tracks", []):
            if track.get("type") == "text":
                segs = track.get("segments", [])
                if segs:
                    refs = segs[0].get("extra_material_refs", [])
                    if refs:
                        anim_id = refs[0]
                break

        anim_mat = None
        if anim_id:
            for mat in inline.get("materials", {}).get("material_animations", []):
                if mat.get("id") == anim_id:
                    anim_mat = mat
                    break

        found[name] = {"text_material": text_mat, "anim_material": anim_mat}

    return [found[n] for n in target_names if found[n] is not None]


def _rgb_to_hex(r: float, g: float, b: float) -> str:
    """Convert RGB [0-1] float to hex color like #RRGGBB."""
    r_int = int(round(r * 255))
    g_int = int(round(g * 255))
    b_int = int(round(b * 255))
    return f"#{r_int:02X}{g_int:02X}{b_int:02X}"


def _extract_text_properties(content_str: str) -> dict:
    """Extract text, color, font_size từ content JSON string.

    Returns dict với keys: text, color_hex, font_size
    """
    try:
        if isinstance(content_str, str):
            content_obj = json.loads(content_str)
        else:
            content_obj = content_str

        text = content_obj.get("text", "")
        font_size = 11.0
        color_hex = "#ffffff"

        styles = content_obj.get("styles", [])
        if styles:
            first_style = styles[0]
            font_size = first_style.get("size", 11.0)

            fill = first_style.get("fill", {})
            fill_content = fill.get("content", {})
            solid = fill_content.get("solid", {})
            color_rgb = solid.get("color", [1, 1, 1])
            if isinstance(color_rgb, list) and len(color_rgb) >= 3:
                color_hex = _rgb_to_hex(color_rgb[0], color_rgb[1], color_rgb[2])

        return {
            "text": text,
            "color_hex": color_hex,
            "font_size": font_size
        }
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        return {"text": "", "color_hex": "#ffffff", "font_size": 11.0}


def _build_content_obj(text: str, template_content_obj: dict) -> dict:
    """Tạo content object với text + normalized styles (không JSON string).
    Format yêu cầu: text key đứng TRƯỚC styles, không có alpha thừa trong fill/solid.
    """
    styles = template_content_obj.get("styles", [])
    normalized_styles = []
    for st in styles:
        fill_raw = st.get("fill", {})
        fill_content = fill_raw.get("content", {"render_type": "solid", "solid": {"color": [1, 1, 1]}})
        solid = fill_content.get("solid", {})
        normalized_fill = {
            "content": {
                "render_type": fill_content.get("render_type", "solid"),
                "solid": {"color": solid.get("color", [1, 1, 1])},
            }
        }
        font_raw = st.get("font", {})
        normalized_styles.append({
            "fill": normalized_fill,
            "font": {"path": font_raw.get("path", ""), "id": font_raw.get("id", "")},
            "size": st.get("size", 11),
            "useLetterColor": st.get("useLetterColor", True),
            "range": [0, len(text)],
        })
    return {"text": text, "styles": normalized_styles}


def _hex_to_rgb(hex_color: str) -> list:
    """Convert hex color like #RRGGBB to RGB [0-1] float list."""
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16) / 255.0
    g = int(hex_color[2:4], 16) / 255.0
    b = int(hex_color[4:6], 16) / 255.0
    return [r, g, b]


def _rebuild_content_with_properties(text: str, color_hex: str, font_size: float, template_content_obj: dict) -> dict:
    """Rebuild content object với text mới + color/font_size chính xác."""
    # CRITICAL: template_content_obj phải là dict với "text" + "styles" keys
    # Không phải JSON string!
    if isinstance(template_content_obj, str):
        template_content_obj = json.loads(template_content_obj)

    styles = template_content_obj.get("styles", [])
    if not styles:
        styles = [{
            "fill": {"content": {"render_type": "solid", "solid": {"color": _hex_to_rgb(color_hex)}}},
            "font": {"path": "C:/WINDOWS/Fonts/TikTokDisplay-Bold.otf", "id": ""},
            "size": font_size,
            "useLetterColor": True,
            "range": [0, len(text)],
        }]
    else:
        first_style = styles[0]
        first_style["size"] = font_size
        first_style["fill"] = {
            "content": {
                "render_type": "solid",
                "solid": {"color": _hex_to_rgb(color_hex)}
            }
        }
        first_style["range"] = [0, len(text)]

    # CRITICAL: return text as STRING, not as JSON!
    return {"text": text, "styles": styles}


def _make_text_material(text_content: str,
                         font_path: str = "C:/WINDOWS/Fonts/TikTokDisplay-Bold.otf") -> dict:
    """Tạo text material theo format CapCut PC 8.6.0 (dựa trên project 0209)."""
    n = len(text_content)
    content_obj = {
        "text": text_content,
        "styles": [{
            "fill": {"content": {"render_type": "solid", "solid": {"color": [1, 1, 1]}}},
            "font": {"path": font_path, "id": ""},
            "size": 11,
            "useLetterColor": True,
            "range": [0, n]
        }]
    }
    content_str = json.dumps(content_obj, ensure_ascii=False, separators=(',', ':'))
    return {
        "id": _new_id(), "type": "text", "name": _new_id(),
        "add_type": 1, "alignment": 1,
        "background_alpha": 1.0, "background_color": "", "background_fill": "",
        "background_height": 0.14, "background_horizontal_offset": 0.0,
        "background_round_radius": 0.0, "background_style": 0,
        "background_vertical_offset": 0.0, "background_width": 0.82,
        "base_content": "", "bold_width": 0.0,
        "border_alpha": 0.0, "border_color": "", "border_mode": 0, "border_width": 0.08,
        "caption_template_info": {
            "category_id": "", "category_name": "", "effect_id": "", "is_new": False,
            "path": "", "request_id": "", "resource_id": "", "resource_name": "",
            "source_platform": 0, "third_resource_id": ""
        },
        "check_flag": 23,
        "combo_info": {"text_templates": []},
        "content": content_str,
        "current_words": {"end_time": [], "start_time": [], "text": []},
        "cutoff_postfix": "", "enable_path_typesetting": False,
        "fixed_height": -1.0, "fixed_width": -1.0,
        "font_category_id": "", "font_category_name": "", "font_id": "",
        "font_name": "", "font_path": "", "font_resource_id": "",
        "font_size": 15.0, "font_source_platform": 0, "font_team_id": "",
        "font_third_resource_id": "", "font_title": "none", "font_url": "",
        "fonts": [], "force_apply_line_max_width": True, "global_alpha": 1.0,
        "group_id": "", "has_shadow": False, "initial_scale": 1.0, "inner_padding": -1.0,
        "is_batch_replace": False, "is_lyric_effect": False, "is_rich_text": False,
        "is_words_linear": False, "italic_degree": 0, "ktv_color": "", "language": "",
        "layer_weight": 1, "letter_spacing": 0.0, "line_feed": 1,
        "line_max_width": 0.82, "line_spacing": 0.02, "multi_language_current": "none",
        "offset_on_path": 0.0, "oneline_cutoff": False, "operation_type": 0,
        "original_size": [], "preset_category": "", "preset_category_id": "",
        "preset_has_set_alignment": False, "preset_id": "", "preset_index": 0,
        "preset_name": "", "recognize_task_id": "", "recognize_text": "",
        "recognize_type": 0, "relevance_segment": [],
        "shadow_alpha": 0.9, "shadow_angle": -45.0, "shadow_color": "",
        "shadow_distance": 5.0,
        "shadow_point": {"x": 0.6363961030678928, "y": -0.6363961030678928},
        "shadow_smoothing": 0.45, "shadow_thickness_projection_angle": 0.0,
        "shadow_thickness_projection_distance": 0.0,
        "shadow_thickness_projection_enable": False,
        "shape_clip_x": False, "shape_clip_y": False, "source_from": "",
        "ssml_content": "", "style_name": "", "sub_template_id": -1, "sub_type": 0,
        "subtitle_keywords": None, "subtitle_keywords_config": None,
        "subtitle_template_original_fontsize": 0.0,
        "text_alpha": 1.0, "text_color": "#ffffff", "text_curve": None,
        "text_exceeds_path_process_type": 0, "text_loop_on_path": False,
        "text_preset_resource_id": "", "text_size": 30, "text_to_audio_ids": [],
        "text_typesetting_path_index": 0, "text_typesetting_paths": None,
        "text_typesetting_paths_file": "", "translate_original_text": "",
        "tts_auto_update": False, "typesetting": 0, "underline": False,
        "underline_offset": 0.22, "underline_width": 0.05, "use_effect_default_color": False,
        "words": {"end_time": [], "start_time": [], "text": []}
    }


def _make_text_segment(material_id: str, start_us: int, duration_us: int,
                        anim_id: str = None) -> dict:
    """Tạo text segment, phủ toàn bộ hook duration."""
    return {
        "id": _new_id(),
        "material_id": material_id,
        "target_timerange": {"start": start_us, "duration": duration_us},
        "source_timerange": None,
        "render_timerange": {"start": 0, "duration": 0},
        "clip": {
            "alpha": 1.0,
            "flip": {"horizontal": False, "vertical": False},
            "rotation": 0.0,
            "scale": {"x": 1.0, "y": 1.0},
            "transform": {"x": 0.0, "y": 0.0},
        },
        "caption_info": None,
        "cartoon": False,
        "color_correct_alg_result": "",
        "common_keyframes": [],
        "desc": "",
        "digital_human_template_group_id": "",
        "enable_adjust": False,
        "enable_adjust_mask": False,
        "enable_color_correct_adjust": False,
        "enable_color_curves": True,
        "enable_color_match_adjust": False,
        "enable_color_wheels": True,
        "enable_hsl": False,
        "enable_hsl_curves": True,
        "enable_lut": False,
        "enable_mask_shadow": False,
        "enable_mask_stroke": False,
        "enable_smart_color_adjust": False,
        "enable_video_mask": True,
        "extra_material_refs": [anim_id] if anim_id else [],
        "group_id": "",
        "hdr_settings": None,
        "intensifies_audio": False,
        "is_loop": False,
        "is_placeholder": False,
        "is_tone_modify": False,
        "keyframe_refs": [],
        "last_nonzero_volume": 1.0,
        "lyric_keyframes": None,
        "raw_segment_id": "",
        "render_index": 14000,
        "responsive_layout": {
            "enable": False,
            "horizontal_pos_layout": 0,
            "size_layout": 0,
            "target_follow": "",
            "vertical_pos_layout": 0,
        },
        "reverse": False,
        "source": "segmentsourcenormal",
        "speed": 1.0,
        "state": 0,
        "template_id": "",
        "template_scene": "default",
        "track_attribute": 0,
        "track_render_index": 2,
        "uniform_scale": {"on": True, "value": 1.0},
        "visible": True,
        "volume": 1.0,
    }


def _build_draft_content(draft_id: str, name: str, duration: float,
                          tracks: list, materials: dict,
                          width: int = 1080, height: int = 1920) -> dict:
    return {
        "id": draft_id, "version": 360000, "new_version": "8.6.0",
        "name": name, "duration": duration,
        "create_time": 0, "update_time": 0,
        "fps": 30, "is_drop_frame_timecode": False, "color_space": -1,
        "config": _config_block(),
        "canvas_config": {"ratio": "original", "width": width, "height": height, "background": None},
        "tracks": tracks,
        "materials": materials,
        "keyframes": _empty_keyframes(),
        "keyframe_graph_list": [], "relationships": [],
        "time_marks": None, "lyrics_effects": [],
        "path": "", "source": "default", "draft_type": "video",
        "cover": None, "static_cover_image_path": "", "retouch_cover": None,
        "free_render_index_mode_on": False, "render_index_track_mode_on": True,
        "group_container": None, "mutable_config": None, "extra_info": None,
        "function_assistant_info": _function_assistant(),
        "uneven_animation_template_info": {
            "composition": "", "content": "", "order": "",
            "sub_template_info_list": []
        },
        "smart_ads_info": {"page_from": "", "routine": "", "draft_url": ""},
        "last_modified_platform": _platform_block(),
        "platform": _platform_block()
    }


def _build_compound_clip(clip_name: str, subdraft_dir: str,
                          videos: list[tuple[str, dict]],   # [(path, info), ...]
                          music_path: str | None, music_dur: float | None,
                          config: TimelineConfig = None,
                          clip_index: int = 0,
                          text_template_data: dict = None,
                          text_content: str = None) -> dict:
    """Build a compound clip (subdraft) and write files. Returns materials for main timeline."""
    # clip_id = folder name = inline_draft.id (all three must match)
    clip_id = _new_id()
    combination_id = _new_id()  # separate UUID, not the folder name
    stub_id = _new_id()         # subdraft file's own id, different from clip_id
    draft_mat_id = _new_id()    # shared between subdraft and main timeline

    clip_dir = os.path.join(subdraft_dir, clip_id)
    os.makedirs(clip_dir, exist_ok=True)

    MICRO = 1_000_000
    vid_durs_us = [int(info["duration"] * MICRO) for _, info in videos]
    compound_dur_us = sum(vid_durs_us)
    compound_dur = compound_dur_us / MICRO
    music_dur_us = int(min(music_dur, compound_dur) * MICRO) if music_path else 0

    # === Inline draft content (actual video/audio inside compound clip) ===
    inner_mats = _empty_materials()
    vid_mats = [_make_video_material(p, {**info, "duration": d_us})
                for (p, info), d_us in zip(videos, vid_durs_us)]
    inner_speed = _make_speed_material()
    inner_mats["videos"] = vid_mats
    inner_mats["speeds"] = [inner_speed]

    if music_path:
        audio_mat = _make_audio_material(music_path, music_dur_us)
        inner_mats["audios"] = [audio_mat]

    # Build sequential video segments
    cursor = 0
    segs = []
    for mat, dur_us in zip(vid_mats, vid_durs_us):
        seg = _make_video_segment(mat["id"], 0, dur_us, cursor, dur_us)
        segs.append(seg)
        cursor += dur_us

    if config and config.transitions and len(segs) > 1:
        for seg_idx, seg in enumerate(segs[:-1]):  # apply between each consecutive pair
            tdef_raw = config.transitions[seg_idx % len(config.transitions)]
            tdef = TransitionDef.from_dict(tdef_raw)
            trans = _make_transition_material(tdef)
            inner_mats["transitions"].append(trans)
            seg.setdefault("extra_material_refs", []).append(trans["id"])

    inner_video_track = {
        "id": _new_id(), "type": "video", "flag": 0, "attribute": 0,
        "segments": segs
    }

    if music_path:
        vol_linear = 10 ** (config.music_volume_db / 20) if config else 0.6
        audio_seg = _make_audio_segment(audio_mat["id"], music_dur_us, inner_speed["id"],
                                        volume=vol_linear)
        inner_audio_track = {
            "id": _new_id(), "type": "audio", "flag": 0, "attribute": 0,
            "segments": [audio_seg]
        }
        inner_tracks = [inner_video_track, inner_audio_track]
    else:
        inner_tracks = [inner_video_track]

    if text_content:
        first_dur_us = vid_durs_us[0]  # text covers first source duration
        if text_template_data:
            text_mat = copy.deepcopy(text_template_data["text_material"])
            text_mat["id"] = _new_id()
            raw = text_mat["content"]
            content_obj = json.loads(raw) if isinstance(raw, str) else raw
            # Rebuild content: giữ nguyên template styles (với strokes), chỉ update text
            # CRITICAL: update range để cover toàn bộ text thực (template có range [0, 25] cho placeholder)
            text_len = len(text_content)
            new_styles = [{**s, "range": [0, text_len]} for s in content_obj.get("styles", [])]
            new_content_obj = {"text": text_content, "styles": new_styles}
            new_content_str = json.dumps(new_content_obj, ensure_ascii=False, separators=(',', ':'))
            text_mat["content"] = new_content_str
            text_mat["is_rich_text"] = False
            # Giữ nguyên text_color và font_size từ template
        else:
            text_mat = _make_text_material(text_content)

        inner_mats["texts"].append(text_mat)

        anim_id = None
        if text_template_data and text_template_data.get("anim_material"):
            anim_mat = copy.deepcopy(text_template_data["anim_material"])
            anim_mat["id"] = _new_id()
            inner_mats["material_animations"].append(anim_mat)
            anim_id = anim_mat["id"]

        text_seg = _make_text_segment(text_mat["id"], 0, first_dur_us, anim_id)
        text_track = {"id": _new_id(), "type": "text", "flag": 0, "attribute": 0,
                      "segments": [text_seg]}
        if music_path:
            inner_tracks = [inner_video_track, text_track, inner_audio_track]
        else:
            inner_tracks = [inner_video_track, text_track]

    # Use last video's dimensions for compound clip container (backward compat)
    last_info = videos[-1][1]

    # inline_draft.id MUST equal clip_id (= folder name)
    inline_draft = _build_draft_content(
        clip_id, clip_name, compound_dur_us,
        inner_tracks, inner_mats,
        width=last_info["width"], height=last_info["height"]
    )

    # === Draft material — shared between subdraft stub and main timeline ===
    draft_material = {
        "id": draft_mat_id,
        "type": "combination",
        "name": "",
        "formula_id": "",
        "category_id": "",
        "category_name": "",
        "combination_id": combination_id,
        "combination_type": "none",
        "draft_file_path": f"{_DRAFT_PATH_PLACEHOLDER}\\subdraft\\{clip_id}\\draft_content.json",
        "draft_cover_path": f"{_DRAFT_PATH_PLACEHOLDER}\\subdraft\\{clip_id}\\draft_cover.jpg",
        "draft_config_path": f"{_DRAFT_PATH_PLACEHOLDER}\\subdraft\\{clip_id}\\sub_draft_config.json",
        "precompile_combination": False,
        "aimusic_mv_template_info": None,
        "draft": inline_draft
    }

    # === Subdraft stub file ===
    # Has one video track pointing to a compound-clip video material (path="")
    # plus the shared draft_material in materials.drafts
    video_mat_sub = _make_compound_video_material(_new_id(), clip_name, compound_dur_us,
                                                   last_info["width"], last_info["height"])
    speed_sub = _make_speed_material()
    canvas_sub = _make_canvas_color_material()

    stub_seg = _make_video_segment(video_mat_sub["id"], 0, compound_dur_us, 0, compound_dur_us)
    stub_seg["extra_material_refs"] = [draft_mat_id, speed_sub["id"], canvas_sub["id"]]
    stub_video_track = {
        "id": _new_id(), "type": "video", "flag": 0, "attribute": 0,
        "segments": [stub_seg]
    }

    stub_mats = _empty_materials()
    stub_mats["videos"] = [video_mat_sub]
    stub_mats["drafts"] = [draft_material]
    stub_mats["speeds"] = [speed_sub]
    stub_mats["canvases"] = [canvas_sub]

    stub_content = _build_draft_content(stub_id, clip_name, 0,
                                         [stub_video_track], stub_mats,
                                         width=0, height=0)

    with open(os.path.join(clip_dir, "draft_content.json"), "w", encoding="utf-8") as f:
        json.dump(stub_content, f, ensure_ascii=False, indent=2)

    now_ts = int(time.time())
    sub_config = {
        "id": clip_id, "project_id": clip_id,
        "name": clip_name, "type": "video", "source": "timeline",
        "is_from_sub_draft": True, "is_from_multi_timeline": False,
        "draft_json_file": "draft_content.json",
        "cover_path": "draft_cover.jpg",
        "cover_width": last_info["width"], "cover_height": last_info["height"],
        "rough_cut_duration": compound_dur_us, "rough_cut_start": 0,
        "create_time": now_ts, "import_time_ms": now_ts * 1000,
        "audio_path": ""
    }
    with open(os.path.join(clip_dir, "sub_draft_config.json"), "w", encoding="utf-8") as f:
        json.dump(sub_config, f, ensure_ascii=False, indent=2)

    # === Main timeline materials (separate video mat and speed/canvas from subdraft) ===
    video_mat_main = _make_compound_video_material(_new_id(), clip_name, compound_dur_us,
                                                    last_info["width"], last_info["height"])
    speed_main = _make_speed_material()
    canvas_main = _make_canvas_color_material()

    return {
        "draft_mat_id": draft_mat_id,
        "draft_material": draft_material,
        "video_mat_main": video_mat_main,
        "speed_main": speed_main,
        "canvas_main": canvas_main,
        "clip_id": clip_id,
        "clip_dir": clip_dir,
        "compound_dur": compound_dur,
    }


def _get_project_name(capcut_dir: str) -> str:
    date_str = datetime.now().strftime("%y%m%d")
    base = date_str
    idx = 1
    while os.path.exists(os.path.join(capcut_dir, base)):
        idx += 1
        base = f"{date_str}-{idx}"
    return base


def generate_project(timelines: list[TimelineConfig], capcut_dir: str,
                     progress_cb: Callable[[float, str], None] = None) -> str:
    """Generate a CapCut project with multiple timelines. Returns project folder path."""

    def log(msg):
        if progress_cb:
            progress_cb(None, msg)

    project_name = _get_project_name(capcut_dir)
    project_dir = os.path.join(capcut_dir, project_name)
    os.makedirs(project_dir, exist_ok=True)
    subdraft_dir = os.path.join(project_dir, "subdraft")
    os.makedirs(subdraft_dir, exist_ok=True)

    log(f"Tạo project: {project_name}")

    # Load text templates (dùng chung cho tất cả timelines)
    text_templates = []
    if any(tl.text_template for tl in timelines):
        text_templates = _load_text_templates(capcut_dir)
        if not text_templates:
            log("[WARN] Không tìm thấy text template từ project 260527")

    timeline_data = []
    total_clips = sum(
        len(scan_media_files([tl.video_sources[0]])) if tl.video_sources else 0
        for tl in timelines
    )
    done_clips = 0
    media_paths = set()  # Track unique media files for size calculation

    for tl_idx, tl in enumerate(timelines):
        # Scan mỗi source riêng để giữ đúng thứ tự, source[0] quyết định số clips
        source_lists = [scan_media_files([src]) for src in tl.video_sources]
        source_lists = [s for s in source_lists if s]  # bỏ source rỗng

        if not source_lists:
            log(f"[WARN] Timeline '{tl.name}': không có file video, bỏ qua")
            continue

        musics = scan_media_files(tl.music_folder)
        n_clips = len(source_lists[0])

        src_info = " + ".join(str(len(s)) for s in source_lists)
        music_info = f"{len(musics)} nhạc" if musics else "không có nhạc"
        log(f"Timeline '{tl.name}': {n_clips} clips, sources=[{src_info}], {music_info}")

        # Load text overlay per-timeline (dùng text_path riêng hoặc fallback về default .csv)
        text_overlay = {}
        if tl.text_template:
            ref_dir = os.path.join(_base_dir(), "ref")
            default_path = os.path.join(ref_dir, "text-overlay.csv")
            effective_path = tl.text_path or default_path
            if os.path.exists(effective_path):
                text_overlay = _load_text_overlay(effective_path)

        # Build compound clips
        main_mats = _empty_materials()
        segments = []
        tl_cursor = 0.0  # seconds, cumulative position in this timeline

        for i in range(n_clips):
            # Pick one file from each source, cycling shorter sources
            clip_videos = [(src[i % len(src)], get_video_info(src[i % len(src)]))
                           for src in source_lists]
            music_path = musics[i % len(musics)] if musics else None

            # Track unique media paths for size calculation
            media_paths.update(os.path.abspath(v[0]) for v in clip_videos)
            if music_path:
                media_paths.add(os.path.abspath(music_path))

            clip_name = f"{project_name}-{tl.name}-{i+1:02d}"
            names = " + ".join(os.path.basename(v[0]) for v in clip_videos)
            log(f"  Clip {i+1}/{n_clips}: {names}")

            music_dur = None
            if music_path:
                if music_path.lower().endswith((".mp4", ".mov", ".avi", ".mkv")):
                    music_dur = get_video_info(music_path)["duration"]
                else:
                    from video_utils import get_duration
                    music_dur = get_duration(music_path)

            text_template_data = None
            text_content_val = None
            if tl.text_template:
                first_path = clip_videos[0][0]  # first source = hook for text key
                hook_stem = os.path.splitext(os.path.basename(first_path))[0]
                text_content_val = text_overlay.get(hook_stem) or text_overlay.get(str(i + 1), "")
                if text_templates:
                    text_template_data = text_templates[i % len(text_templates)]
                log(f"  [TEXT] key={str(i+1)!r} | text={text_content_val!r} | tpl={'yes' if text_template_data else 'default'}")

            clip_result = _build_compound_clip(
                clip_name, subdraft_dir,
                clip_videos,
                music_path, music_dur,
                config=tl,
                clip_index=i,
                text_template_data=text_template_data,
                text_content=text_content_val
            )

            # Add compound clip materials to main timeline
            main_mats["videos"].append(clip_result["video_mat_main"])
            main_mats["drafts"].append(clip_result["draft_material"])
            main_mats["speeds"].append(clip_result["speed_main"])
            main_mats["canvases"].append(clip_result["canvas_main"])

            # Segment: material_id = video material (path=""), draft in extra_material_refs
            compound_dur = clip_result["compound_dur"]  # seconds
            compound_dur_us = int(compound_dur * 1_000_000)
            tgt_start_us = int(tl_cursor * 1_000_000)
            seg = _make_video_segment(
                clip_result["video_mat_main"]["id"],
                0, compound_dur_us,
                tgt_start_us, compound_dur_us
            )
            seg["extra_material_refs"] = [
                clip_result["draft_mat_id"],
                clip_result["speed_main"]["id"],
                clip_result["canvas_main"]["id"],
            ]
            segments.append(seg)
            tl_cursor += compound_dur

            done_clips += 1
            if progress_cb:
                progress_cb(done_clips / total_clips if total_clips > 0 else 1, None)

        # Main timeline duration = last_start_us + last_dur_s
        if segments:
            last_seg = segments[-1]
            tl_duration = last_seg["target_timerange"]["start"] + last_seg["target_timerange"]["duration"]
        else:
            tl_duration = 0

        video_track = {
            "id": _new_id(), "type": "video", "flag": 0, "attribute": 0,
            "segments": segments
        }

        tl_id = _new_id()
        tl_content = _build_draft_content(tl_id, tl.name, tl_duration,
                                           [video_track], main_mats)
        tl_content["config"]["combination_max_index"] = n_clips

        timeline_data.append({
            "id": tl_id,
            "name": tl.name,
            "content": tl_content,
            "duration": tl_duration
        })

    # Calculate total media size
    total_size = sum(os.path.getsize(p) for p in media_paths if os.path.exists(p))

    # Write main draft_content.json (first timeline)
    if not timeline_data:
        raise RuntimeError("Không có timeline nào được tạo thành công")

    now_us = int(time.time() * 1_000_000)
    first_tl = timeline_data[0]
    main_content = first_tl["content"]
    with open(os.path.join(project_dir, "draft_content.json"), "w", encoding="utf-8") as f:
        json.dump(main_content, f, ensure_ascii=False, indent=2)

    # Write Timelines folder for multi-timeline support
    timelines_dir = os.path.join(project_dir, "Timelines")
    os.makedirs(timelines_dir, exist_ok=True)

    layout_dock_items = []
    pc_timeline_content = {
        "reference_lines_config": {
            "horizontal_lines": [0.748868778280543, 0.25],
            "is_lock": True,
            "is_visible": True,
            "vertical_lines": []
        },
        "safe_area_type": 0
    }

    for i, tl_data in enumerate(timeline_data):
        tl_dir = os.path.join(timelines_dir, tl_data["id"])
        os.makedirs(tl_dir, exist_ok=True)
        with open(os.path.join(tl_dir, "draft_content.json"), "w", encoding="utf-8") as f:
            json.dump(tl_data["content"], f, ensure_ascii=False, indent=2)

        # Required sub-folders mirroring CapCut's own project structure
        os.makedirs(os.path.join(tl_dir, "attachment", "patch"), exist_ok=True)
        os.makedirs(os.path.join(tl_dir, "common_attachment"), exist_ok=True)

        _write_json(os.path.join(tl_dir, "attachment_pc_common.json"), {})
        _write_json(os.path.join(tl_dir, "attachment_editing.json"), {})
        _write_json(os.path.join(tl_dir, "common_attachment", "attachment_pc_timeline.json"),
                    pc_timeline_content)

        layout_dock_items.append({
            "dockIndex": i,
            "ratio": 1.0 / len(timeline_data),
            "timelineIds": [tl_data["id"]],
            "timelineNames": [tl_data["name"]]
        })

    # CapCut requires this rich format to know which timeline to open first
    main_tl_id = timeline_data[0]["id"]
    tl_project = {
        "config": {
            "color_space": -1,
            "render_index_track_mode_on": False,
            "use_float_render": False
        },
        "create_time": now_us,
        "id": _new_id(),
        "main_timeline_id": main_tl_id,
        "timelines": [
            {
                "create_time": now_us,
                "id": tl_data["id"],
                "is_marked_delete": False,
                "name": tl_data["name"],
                "update_time": now_us
            }
            for tl_data in timeline_data
        ],
        "update_time": now_us,
        "version": 0
    }
    _write_json(os.path.join(timelines_dir, "project.json"), tl_project)
    _write_json(os.path.join(project_dir, "timeline_layout.json"), {
        "dockItems": layout_dock_items,
        "layoutOrientation": 1
    })

    # Write meta info
    meta = {
        "cloud_draft_cover": False, "cloud_draft_sync": False,
        "cloud_package_completed_time": "", "draft_cloud_capcut_purchase_info": "",
        "draft_cloud_last_action_download": False, "draft_cloud_package_type": "",
        "draft_cloud_purchase_info": "", "draft_cloud_template_id": "",
        "draft_cloud_tutorial_info": "", "draft_cloud_videocut_purchase_info": "",
        "draft_cover": "draft_cover.jpg", "draft_deeplink_url": "",
        "draft_enterprise_info": {
            "draft_enterprise_extra": "", "draft_enterprise_id": "",
            "draft_enterprise_name": "", "enterprise_material": []
        },
        "draft_fold_path": project_dir.replace("\\", "/"),
        "draft_id": first_tl["id"],
        "draft_is_ae_produce": False, "draft_is_ai_packaging_used": False,
        "draft_is_ai_shorts": False, "draft_is_ai_translate": False,
        "draft_is_article_video_draft": False, "draft_is_cloud_temp_draft": False,
        "draft_is_from_deeplink": "false", "draft_is_invisible": False,
        "draft_is_pippit_draft": False, "draft_is_web_article_video": False,
        "draft_materials": [
            {"type": 0, "value": []}, {"type": 1, "value": []},
            {"type": 2, "value": []}, {"type": 3, "value": []},
            {"type": 6, "value": []}, {"type": 7, "value": []},
            {"type": 8, "value": []}
        ],
        "draft_materials_copied_info": [],
        "draft_name": project_name,
        "draft_need_rename_folder": False, "draft_new_version": "",
        "draft_removable_storage_device": "",
        "draft_root_path": capcut_dir.replace("\\", "/"),
        "draft_segment_extra_info": [], "draft_timeline_materials_size_": total_size,
        "draft_type": "", "draft_web_article_video_enter_from": "",
        "tm_draft_cloud_completed": "", "tm_draft_cloud_entry_id": -1,
        "tm_draft_cloud_modified": 0, "tm_draft_cloud_parent_entry_id": -1,
        "tm_draft_cloud_space_id": -1, "tm_draft_cloud_user_id": -1,
        "tm_draft_create": now_us, "tm_draft_modified": now_us,
        "tm_draft_removed": 0, "tm_duration": first_tl["duration"]
    }
    _write_json(os.path.join(project_dir, "draft_meta_info.json"), meta)

    # Stub files
    _write_json(os.path.join(project_dir, "attachment_pc_common.json"), {})
    _write_json(os.path.join(project_dir, "attachment_editing.json"), {})
    _write_json(os.path.join(project_dir, "draft_agency_config.json"), {})
    _write_json(os.path.join(project_dir, "draft_biz_config.json"), {})
    _write_json(os.path.join(project_dir, "performance_opt_info.json"), {
        "manual_cancle_precombine_segs": None,
        "need_auto_precombine_segs": None
    })
    os.makedirs(os.path.join(project_dir, "common_attachment"), exist_ok=True)
    _write_json(os.path.join(project_dir, "common_attachment", "attachment_pc_timeline.json"),
                pc_timeline_content)

    _register_in_draft_info(capcut_dir, meta, total_size)
    log(f"✅ Tạo project thành công: {project_name} ({total_clips} clips)")
    return project_dir


def _make_index_entry(meta: dict, project_dir: str, materials_size: int = 0) -> dict:
    """Tạo entry theo format root_meta_info.json của CapCut PC."""
    cover_full = os.path.join(project_dir, "draft_cover.jpg").replace("\\", "/")
    json_full   = os.path.join(project_dir, "draft_content.json").replace("\\", "/")
    return {
        "cloud_draft_cover": False,
        "cloud_draft_sync": False,
        "draft_cloud_last_action_download": False,
        "draft_cloud_purchase_info": "",
        "draft_cloud_template_id": "",
        "draft_cloud_tutorial_info": "",
        "draft_cloud_videocut_purchase_info": "",
        "draft_cover": cover_full,
        "draft_fold_path": meta.get("draft_fold_path", project_dir.replace("\\", "/")),
        "draft_id": meta.get("draft_id", ""),
        "draft_is_ai_shorts": False,
        "draft_is_cloud_temp_draft": False,
        "draft_is_invisible": False,
        "draft_is_web_article_video": False,
        "draft_json_file": json_full,
        "draft_name": meta.get("draft_name", ""),
        "draft_new_version": "",
        "draft_root_path": meta.get("draft_root_path", ""),
        "draft_timeline_materials_size": materials_size,
        "draft_type": "",
        "draft_web_article_video_enter_from": "",
        "streaming_edit_draft_ready": True,
        "tm_draft_cloud_completed": "",
        "tm_draft_cloud_entry_id": -1,
        "tm_draft_cloud_modified": 0,
        "tm_draft_cloud_parent_entry_id": -1,
        "tm_draft_cloud_space_id": -1,
        "tm_draft_cloud_user_id": -1,
        "tm_draft_create": meta.get("tm_draft_create", 0),
        "tm_draft_modified": meta.get("tm_draft_modified", 0),
        "tm_draft_removed": 0,
        "tm_duration": meta.get("tm_duration", 0),
    }


def _register_in_draft_info(capcut_dir: str, meta: dict, materials_size: int = 0):
    """Thêm project vào root_meta_info.json — file index CapCut dùng để list projects."""
    info_path = os.path.join(capcut_dir, "root_meta_info.json")
    project_dir = meta.get("draft_fold_path", "").replace("/", os.sep)

    if os.path.exists(info_path):
        try:
            root = _safe_load_json(info_path)
        except Exception:
            root = {}
    else:
        root = {}

    root.setdefault("root_path", capcut_dir.replace("\\", "/"))
    root.setdefault("draft_ids", 0)
    store: list = root.setdefault("all_draft_store", [])

    # Xóa entry cũ nếu trùng draft_id hoặc tên
    draft_id   = meta.get("draft_id", "")
    draft_name = meta.get("draft_name", "")
    store[:] = [e for e in store
                if e.get("draft_id") != draft_id and e.get("draft_name") != draft_name]

    entry = _make_index_entry(meta, project_dir, materials_size)
    store.insert(0, entry)  # mới nhất lên đầu

    _write_json(info_path, root)


def rebuild_draft_info(capcut_dir: str) -> int:
    """Scan toàn bộ thư mục Projects và rebuild root_meta_info.json.
    Trả về số project được đăng ký."""
    if not os.path.isdir(capcut_dir):
        return 0

    entries = []
    for name in os.listdir(capcut_dir):
        proj_path = os.path.join(capcut_dir, name)
        meta_path = os.path.join(proj_path, "draft_meta_info.json")
        if not os.path.isdir(proj_path) or not os.path.exists(meta_path):
            continue
        try:
            meta = _safe_load_json(meta_path)
            entry = _make_index_entry(meta, proj_path)
            entries.append((meta.get("tm_draft_create", 0), entry))
        except Exception:
            pass

    entries.sort(key=lambda x: x[0], reverse=True)
    store = [e for _, e in entries]

    root = {
        "all_draft_store": store,
        "draft_ids": 0,
        "root_path": capcut_dir.replace("\\", "/"),
    }
    _write_json(os.path.join(capcut_dir, "root_meta_info.json"), root)
    return len(store)


def _write_json(path: str, data: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
