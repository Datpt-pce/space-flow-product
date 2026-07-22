from __future__ import annotations
import json
import math
import os
from dataclasses import dataclass, field, asdict


# ── Mapping effect_id → tên hiển thị đẹp (dùng khi scan không tìm thấy tên) ──
KNOWN_TRANSITION_NAMES: dict[str, str] = {
    "6724226861666144779": "Pull in",
    "6724226338418332167": "Zoom far",
    "7291211157254181377": "Shake",
    "7291923867235258882": "Lightning",
    "7340917662802776577": "Ripple",
    "7348749857038799362": "Flash white",
    "7413724853598949889": "Blur in",
    "7194814295517958657": "Slide left",
    "7194814374001775105": "Slide right",
    "7241034488325607937": "Fade",
    "7291210964177625602": "Wipe",
    "7291211079649624578": "Cross dissolve",
    "7291211157254082050": "Spin",
    "7291923766912290305": "Flash black",
    "7413724853598821889": "Blur out",
}


def _infer_anim_style(name: str) -> str:
    """Suy ra kiểu animation từ tên transition để vẽ preview."""
    n = name.lower()
    if any(k in n for k in ("pull", "zoom", "scale")):
        return "zoom"
    if "slide left" in n or "wipe left" in n:
        return "slide_left"
    if "slide right" in n or "wipe right" in n:
        return "slide_right"
    if "slide up" in n:
        return "slide_up"
    if "slide down" in n:
        return "slide_down"
    if "wipe" in n:
        return "wipe"
    if any(k in n for k in ("flash white", "flash")):
        return "flash"
    if "flash black" in n:
        return "flash_black"
    if "shake" in n:
        return "shake"
    if "lightning" in n or "electric" in n:
        return "lightning"
    if "blur" in n:
        return "blur_fade"
    if any(k in n for k in ("dissolve", "cross", "fade")):
        return "fade"
    if "spin" in n or "rotate" in n or "roll" in n:
        return "spin"
    if "ripple" in n or "wave" in n:
        return "ripple"
    return "fade"


@dataclass
class TransitionDef:
    effect_id: str
    name: str
    duration_us: int        # microseconds
    is_overlap: bool
    path: str               # hash subfolder path, "" nếu chưa download
    category_id: str = "100000"
    source_platform: int = 1
    anim_style: str = "fade"

    def to_material_dict(self, new_id: str) -> dict:
        return {
            "category_id": self.category_id,
            "category_name": "transitions",
            "duration": self.duration_us,
            "effect_id": self.effect_id,
            "id": new_id,
            "is_ai_transition": False,
            "is_overlap": self.is_overlap,
            "name": self.name,
            "path": self.path,
            "platform": "all",
            "request_id": "",
            "resource_id": self.effect_id,
            "source_platform": self.source_platform,
            "task_id": "",
            "third_resource_id": self.effect_id,
            "type": "transition",
            "video_path": "",
        }

    def as_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TransitionDef":
        fields = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in fields})


# ── Hardcoded fallback list (non-overlap only) ───────────────────────────────
# (effect_id, display_name, duration_us, is_overlap)
_HARDCODED_RAW: list[tuple] = [
    ("6724226861666144779", "Pull in",        466666,  False),
    ("6724226338418332167", "Zoom far",       1000000, False),
    ("7194814295517958657", "Slide left",     500000,  False),
    ("7194814374001775105", "Slide right",    500000,  False),
    ("7241034488325607937", "Fade",           700000,  False),
    ("7291210964177625602", "Wipe",           500000,  False),
    ("7291211079649624578", "Cross dissolve", 700000,  False),
    ("7291211157254082050", "Spin",           600000,  False),
]

HARDCODED_TRANSITIONS: list[TransitionDef] = [
    TransitionDef(
        effect_id=eid,
        name=name,
        duration_us=dur,
        is_overlap=overlap,
        path="",
        anim_style=_infer_anim_style(name),
    )
    for eid, name, dur, overlap in _HARDCODED_RAW
]


# ── Local cache scanner ──────────────────────────────────────────────────────
def _get_effect_cache_dir() -> str:
    mapped = os.environ.get("CAPCUT_EFFECTS_DIR", "")
    if mapped:
        return mapped
    local = os.environ.get("LOCALAPPDATA", "")
    return os.path.join(local, "CapCut", "User Data", "Cache", "effect")


def scan_local_transitions() -> list[TransitionDef]:
    """Scan CapCut effect cache, trả về danh sách transitions đã download."""
    base = _get_effect_cache_dir()
    if not os.path.isdir(base):
        return []

    results: list[TransitionDef] = []
    for effect_id in os.listdir(base):
        effect_dir = os.path.join(base, effect_id)
        if not os.path.isdir(effect_dir):
            continue
        for sub in os.listdir(effect_dir):
            if sub.endswith("_tmp"):
                continue
            subdir = os.path.join(effect_dir, sub)
            if not os.path.isdir(subdir):
                continue
            extra_path = os.path.join(subdir, "extra.json")
            if not os.path.exists(extra_path):
                continue
            try:
                with open(extra_path, encoding="utf-8") as f:
                    extra = json.load(f)
                if "transition" not in extra:
                    continue
                trans_data = extra["transition"]
                is_overlap = trans_data.get("isOverlap", False)
                if is_overlap:
                    continue
                default_dur_s = trans_data.get("defaultDura", 1.0)
                # Pull in dùng duration đặc biệt từ thực tế
                if effect_id == "6724226861666144779":
                    duration_us = 466666
                else:
                    duration_us = int(default_dur_s * 1_000_000)
                display_name = KNOWN_TRANSITION_NAMES.get(
                    effect_id, f"Effect ...{effect_id[-6:]}"
                )
                results.append(TransitionDef(
                    effect_id=effect_id,
                    name=display_name,
                    duration_us=duration_us,
                    is_overlap=is_overlap,
                    path=subdir.replace("\\", "/"),
                    anim_style=_infer_anim_style(display_name),
                ))
            except Exception:
                continue
    return results


def get_all_transitions() -> list[TransitionDef]:
    """Trả về non-overlap transitions đã được cache trong máy."""
    return scan_local_transitions()
