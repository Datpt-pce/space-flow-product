import subprocess
import json
import os
import shutil
import sys


def _exe_path(name: str) -> str:
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, name)
    override = os.environ.get("FFPROBE_PATH", "")
    if override:
        return override
    on_path = shutil.which(os.path.splitext(name)[0])
    if on_path:
        return on_path
    return rf"C:\ffmpeg\bin\{name}"


FFPROBE = _exe_path('ffprobe.exe')


def get_duration(filepath: str) -> float:
    """Return video/audio duration in seconds using ffprobe."""
    cmd = [
        FFPROBE, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json",
        filepath
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {filepath}: {result.stderr}")
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def get_video_info(filepath: str) -> dict:
    """Return width, height, duration for a video file."""
    cmd = [
        FFPROBE, "-v", "error",
        "-show_entries", "stream=width,height,codec_type",
        "-show_entries", "format=duration",
        "-of", "json",
        filepath
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {filepath}: {result.stderr}")
    data = json.loads(result.stdout)
    duration = float(data["format"]["duration"])
    width, height = 720, 1280
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            width = stream.get("width", 720)
            height = stream.get("height", 1280)
            break
    return {"width": width, "height": height, "duration": duration}


def _natural_key(name: str):
    import re
    parts = re.split(r"(\d+)", name)
    return [int(p) if p.isdigit() else p.lower() for p in parts]


def scan_media_files(sources: list[str]) -> list[str]:
    """Return naturally-sorted list of video/audio files from folders and/or individual files."""
    exts = {".mp4", ".mov", ".avi", ".mkv", ".mp3", ".m4a", ".aac", ".wav"}
    files = []
    for src in sources:
        if os.path.isdir(src):
            for name in sorted(os.listdir(src), key=_natural_key):
                if os.path.splitext(name)[1].lower() in exts:
                    files.append(os.path.join(src, name))
        elif os.path.isfile(src) and os.path.splitext(src)[1].lower() in exts:
            files.append(src)
    return files
