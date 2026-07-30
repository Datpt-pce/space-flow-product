import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from capcut_generator import generate_project, TimelineConfig  # noqa: E402
from transition_catalog import scan_local_transitions, HARDCODED_TRANSITIONS  # noqa: E402


def _detect_capcut_dir() -> str:
    mapped = os.environ.get("CAPCUT_DRAFTS_DIR", "")
    if mapped:
        return mapped
    local_app = os.environ.get("LOCALAPPDATA", "")
    preferred = os.path.join(local_app, "CapCut", "User Data", "Projects", "com.lveditor.draft")
    fallback = os.path.join(local_app, "CapCut", "User Data", "Projects")
    return preferred if os.path.isdir(preferred) else fallback


_DRIVE_LETTERS = "DEFGHIJKLMNOPQRSTUVWXYZ"


def _to_container_path(raw_path: str) -> str:
    # Chiều ngược lại của _to_host_path trong capcut_generator.py: quy đổi 1 path
    # Windows do user dán tay (vd. "D:\Videos\a.mp4") sang path trong container Docker
    # (vd. "/host-fs/drive-d/Videos/a.mp4") trước khi đọc/scan file. No-op khi chạy dev
    # native trên Windows (không có mount /host-fs).
    if not raw_path or sys.platform.startswith("win"):
        return raw_path

    # HOST_USERPROFILE luôn nằm trên ổ C: — phải kiểm tra trước nhánh ổ đĩa D-Z bên
    # dưới, nếu không path người dùng sẽ không bao giờ khớp vì ổ C không nằm trong
    # danh sách ổ được mount riêng.
    user_profile = os.environ.get("HOST_USERPROFILE", "")
    if user_profile and raw_path.lower().startswith(user_profile.lower()):
        rest = raw_path[len(user_profile):].lstrip("\\/").replace("\\", "/")
        return f"/host-fs/home/{rest}" if rest else "/host-fs/home"

    p = raw_path.replace("\\", "/")
    if len(p) >= 2 and p[1] == ":" and p[0].upper() in _DRIVE_LETTERS:
        letter = p[0].upper()
        rest = p[2:].lstrip("/")
        if os.environ.get(f"HOST_DRIVE_{letter}"):
            return f"/host-fs/drive-{letter.lower()}/{rest}"

    return raw_path


def _resolve_transitions(names):
    if not names:
        return []
    catalog = {t.name: t for t in scan_local_transitions()}
    for t in HARDCODED_TRANSITIONS:
        catalog.setdefault(t.name, t)
    return [catalog[name].as_dict() for name in names if name in catalog]


def main():
    payload = json.loads(sys.stdin.read())
    config = payload.get("config", {})

    timelines_cfg = config.get("timelines") or []
    if not timelines_cfg:
        print(json.dumps({"error": "No timelines configured"}))
        sys.exit(1)

    capcut_dir = config.get("capcut_dir") or _detect_capcut_dir()
    if not os.path.isdir(capcut_dir):
        print(json.dumps({"error": f"CapCut projects directory not found: {capcut_dir}"}))
        sys.exit(1)

    timelines = []
    for i, t in enumerate(timelines_cfg):
        video_sources = [_to_container_path(v) for v in (t.get("video_sources") or [])]
        music_files = [_to_container_path(m) for m in (t.get("music_files") or [])]

        if not video_sources:
            print(json.dumps({"error": f"Timeline '{t.get('name', i + 1)}' has no video sources"}))
            sys.exit(1)

        transitions = []
        if t.get("transitions_enabled"):
            transitions = _resolve_transitions(t.get("transitions") or [])

        timelines.append(TimelineConfig(
            name=t.get("name") or f"timeline_{i + 1}",
            video_sources=video_sources,
            music_folder=music_files,
            transitions=transitions,
            text_template=bool(t.get("text_template", False)),
            text_path=t.get("text_path", ""),
            music_volume_db=float(t.get("music_volume_db", 0) or 0),
        ))

    def progress_cb(progress, msg):
        if progress is not None:
            percent = round(progress * 100)
            print(f"PROGRESS\t{percent}\t{msg or ''}", file=sys.stderr, flush=True)
        elif msg:
            print(msg, file=sys.stderr, flush=True)

    try:
        project_path = generate_project(timelines, capcut_dir, progress_cb=progress_cb)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    print(json.dumps({"project_path": project_path}))


if __name__ == "__main__":
    main()
