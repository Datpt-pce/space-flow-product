import sys
import os
import json
import shutil
import subprocess
from datetime import datetime

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import requests
import certifi

try:
    from google.cloud import storage
except Exception:
    storage = None

CREATE_NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

_DRIVE_LETTERS = "DEFGHIJKLMNOPQRSTUVWXYZ"


def _to_container_path(raw_path: str) -> str:
    # Quy đổi 1 path Windows do user dán tay (vd. "D:\Videos") sang path trong container
    # Docker (vd. "/host-fs/drive-d/Videos") trước khi đọc/ghi file. No-op khi chạy dev
    # native trên Windows. Xem mirror: nodes/capcut-generate/capcut_generator.py:_to_host_path
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


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def progress(pct, msg=""):
    print(f"PROGRESS\t{pct}\t{msg}", file=sys.stderr, flush=True)


def fail(msg):
    print(json.dumps({"error": msg}))
    sys.exit(1)


# ----------------- MISC HELPERS -----------------
def get_video_duration(path):
    try:
        cmd = [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
        duration = float(result.stdout.strip())
        return int(round(duration))
    except Exception:
        return 0


def sizes_for_mode(m):
    if m == "3_sizes":
        return [("_916", "1080:1920"), ("_169", "1920:1080"), ("_11", "1080:1080")]
    if m == "4_sizes_meta":
        return [("_34", "1080:1440"), ("_916", "1080:1920"), ("_45", "1080:1350"), ("_11", "1080:1080")]
    return [("_11", "1080:1080"), ("_23", "1080:1620"), ("_32", "1620:1080"), ("_34", "1080:1440"),
            ("_43", "1440:1080"), ("_45", "1080:1350"), ("_169", "1920:1080"), ("_916", "1080:1920")]


def parse_theme_codeapp_lang(folder_name):
    parts = folder_name.split("_")
    if len(parts) == 4:
        _yymmdd, theme, codeapp, language = parts
        return theme, codeapp, language
    if len(parts) == 3:
        theme, codeapp, language = parts
        return theme, codeapp, language
    return None


# ----------------- ASANA -----------------
import re as _re


def get_task_gid_from_url(url):
    matches = _re.findall(r"/(\d{10,})", url)
    return matches[-1] if matches else None


def _asana_get(pat, url, params=None):
    headers = {"Authorization": f"Bearer {pat}"}
    r = requests.get(url, headers=headers, params=params or {}, timeout=15, verify=certifi.where())
    r.raise_for_status()
    return r.json()["data"]


def post_task_comment(pat, task_gid, text_to_add):
    if not all([pat, task_gid, text_to_add]):
        return True
    url = f"https://app.asana.com/api/1.0/tasks/{task_gid}/stories"
    headers = {"Authorization": f"Bearer {pat}"}
    payload = {"data": {"text": text_to_add}}
    r = requests.post(url, headers=headers, json=payload, timeout=15, verify=certifi.where())
    r.raise_for_status()
    return True


def update_task_custom_field(pat, task_gid, field_gid, option_gid):
    if not all([pat, task_gid, field_gid, option_gid]):
        return True
    url = f"https://app.asana.com/api/1.0/tasks/{task_gid}"
    headers = {"Authorization": f"Bearer {pat}"}
    payload = {"data": {"custom_fields": {field_gid: option_gid}}}
    r = requests.put(url, headers=headers, json=payload, timeout=15, verify=certifi.where())
    r.raise_for_status()
    return True


def find_progress_and_done_option(pat, task_gid):
    task = _asana_get(pat, f"https://app.asana.com/api/1.0/tasks/{task_gid}",
                       params={"opt_fields": "memberships.project.gid"})
    project_gids = sorted({m["project"]["gid"] for m in task.get("memberships", []) if "project" in m})
    candidates = {"progress", "status", "trạng thái"}
    for pg in project_gids:
        settings = _asana_get(
            pat, f"https://app.asana.com/api/1.0/projects/{pg}/custom_field_settings",
            params={"opt_fields": "custom_field,custom_field.name,custom_field.gid,custom_field.type,custom_field.enum_options"}
        )
        for s in settings:
            cf = s["custom_field"]
            if cf and cf.get("type") == "enum" and cf.get("name", "").strip().lower() in candidates:
                field_gid = cf["gid"]
                done_gid = None
                for opt in (cf.get("enum_options") or []):
                    if opt.get("name", "").strip().lower() == "done":
                        done_gid = opt["gid"]
                        break
                if done_gid:
                    return field_gid, done_gid
    return None, None


# ----------------- GCS CORE -----------------
def gcs_upload_blob(bucket_name, source_file_name, destination_blob_name):
    if storage is None:
        raise RuntimeError("Chưa cài 'google-cloud-storage' (pip install google-cloud-storage)")
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_filename(source_file_name, if_generation_match=None)


def _iter_files_recursive(folder):
    for dirpath, _, filenames in os.walk(folder):
        for filename in filenames:
            yield os.path.join(dirpath, filename)


def upload_output_to_gcs(output_root, app_tag, bucket_name, creds_json_path="",
                          on_progress=None, allowed_subfolders=None, date_yymm="", date_yymmdd=""):
    if creds_json_path:
        p = os.path.abspath(os.path.expanduser(creds_json_path))
        if not os.path.isfile(p):
            raise RuntimeError(f"Không thấy file JSON credentials:\n{p}")
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = p

    ca_bundle = certifi.where()
    os.environ["REQUESTS_CA_BUNDLE"] = ca_bundle
    os.environ["SSL_CERT_FILE"] = ca_bundle

    subfolders = [d for d in (allowed_subfolders or []) if os.path.isdir(d)]
    if not subfolders:
        raise RuntimeError("Không có thư mục để tải lên GCS.")

    prefix = (app_tag or "uploads").strip()
    if date_yymm and date_yymmdd:
        prefix = f"{prefix}/{date_yymm}/{date_yymmdd}"

    total_files = sum(len(list(_iter_files_recursive(d))) for d in subfolders)
    done = 0
    links = []

    for sub_path in subfolders:
        topname = os.path.basename(sub_path)
        for fpath in _iter_files_recursive(sub_path):
            rel = os.path.relpath(fpath, output_root).replace("\\", "/")
            blob_name = f"{prefix}/{rel}"
            gcs_upload_blob(bucket_name, fpath, blob_name)
            done += 1
            if on_progress:
                on_progress(done, total_files, rel)
        sub_root = f"{prefix}/{topname}"
        links.append(f"https://console.cloud.google.com/storage/browser/{bucket_name}/{sub_root}?project=_")
    return links


# ----------------- RESIZE PIPELINE -----------------
def process_videos(config, out_reporter):
    output_folder = _to_container_path(config.get("output_folder", ""))
    mode = config.get("mode", "8_sizes")
    roots = list(config.get("input_folders", []))
    do_rename = bool(config.get("rename_videos", True))
    bg = config.get("bg_style", "color")
    color = config.get("color_color", "#FEFBE7")
    blur = config.get("blur_value", 30)
    export_thumbnail = bool(config.get("export_thumbnail", True))

    if not roots:
        fail("Chưa chọn thư mục Input!")
    if not output_folder:
        fail("Chưa chọn Output!")

    try:
        os.makedirs(output_folder, exist_ok=True)
    except Exception as e:
        fail(f"Không thể tạo Output:\n{output_folder}\n{e}")

    today_str = datetime.now().strftime("%y%m%d")
    skipped_root_folders = []
    last_root_topnames = {}
    root_parse = {}
    valid_roots = []

    for root_dir in roots:
        if not os.path.isdir(root_dir):
            continue
        top_name = os.path.basename(root_dir.rstrip("/\\"))
        if do_rename:
            parsed = parse_theme_codeapp_lang(top_name)
            if parsed is None:
                skipped_root_folders.append(top_name)
                continue
            theme, codeapp, language = parsed
            root_parse[root_dir] = parsed
            last_root_topnames[root_dir] = f"{theme}_{codeapp}_{language}"
        else:
            root_parse[root_dir] = None
            last_root_topnames[root_dir] = top_name
        valid_roots.append(root_dir)

    if skipped_root_folders:
        log(f"Bỏ qua (tên không đúng mẫu YYMMDD_Theme_CodeApp_Language): {', '.join(skipped_root_folders)}")

    files, file_roots = [], []
    for root_dir in valid_roots:
        for dirpath, _, filenames in os.walk(root_dir):
            for filename in filenames:
                if filename.lower().endswith((".mp4", ".mov", ".avi", ".mkv")):
                    files.append(os.path.join(dirpath, filename))
                    file_roots.append(root_dir)

    if not files:
        fail("Không có video trong các thư mục Input.")

    qual_preset, qual_crf = "ultrafast", "23"
    all_sizes = sizes_for_mode(mode)
    ops = len(files) * len(all_sizes)
    done = 0
    output_files = []

    for idx, path in enumerate(files):
        duration_sec = get_video_duration(path)
        dur_suffix = f"_{duration_sec}s" if duration_sec > 0 else ""

        base = os.path.splitext(os.path.basename(path))[0]
        this_root = file_roots[idx]
        rel_in_root = os.path.relpath(path, this_root)
        top_name = os.path.basename(this_root.rstrip("/\\"))
        rel_dir = os.path.dirname(rel_in_root)

        parsed = root_parse.get(this_root)
        if parsed:
            theme, codeapp, language = parsed
            out_top_name = f"{theme}_{codeapp}_{language}"
            out_base = f"{theme}_{codeapp}_{base}_{language}"
            date_suffix = f"_{today_str}"
        else:
            out_top_name = top_name
            out_base = base
            date_suffix = ""

        for suf, dims in all_sizes:
            done += 1
            pct = int(done / ops * 70)  # resize = 0-70% of total
            progress(pct, f"Resize {base}{suf} ({done}/{ops})")

            w, h = dims.split(":")
            final_output_dir = os.path.join(output_folder, out_top_name, rel_dir)
            os.makedirs(final_output_dir, exist_ok=True)

            out = os.path.join(final_output_dir, f"{out_base}{suf}{dur_suffix}{date_suffix}.mp4")

            cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", path]
            v = ["-c:v", "libx264", "-preset", qual_preset, "-crf", qual_crf, "-pix_fmt", "yuv420p"]
            a = ["-c:a", "aac", "-ar", "44100", "-b:a", "128k"]

            if bg == "color":
                vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={color},setsar=1,format=yuv420p"
                cmd += ["-vf", vf, *v, *a, "-map", "0:v:0", "-map", "0:a?", out]
            elif bg == "blur":
                fc = (f"[0:v]split=2[fg][bg];[bg]scale={w}:{h}:force_original_aspect_ratio=increase,"
                      f"crop={w}:{h},gblur=sigma={blur}[b];[fg]scale={w}:{h}:force_original_aspect_ratio=decrease[f];"
                      f"[b][f]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]")
                cmd += ["-filter_complex", fc, "-map", "[v]", "-map", "0:a?", *v, *a, out]
            elif bg == "scale_fill":
                vf = f"scale={w}:-1,crop={w}:{h},setsar=1,format=yuv420p"
                cmd += ["-vf", vf, *v, *a, "-map", "0:v:0", "-map", "0:a?", out]
            else:
                vf = f"scale={w}:{h}:force_original_aspect_ratio=decrease,setsar=1,format=yuv420p"
                cmd += ["-vf", vf, *v, *a, "-map", "0:v:0", "-map", "0:a?", out]

            try:
                result = subprocess.run(cmd, creationflags=CREATE_NO_WINDOW,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                if result.returncode != 0:
                    log(result.stderr.decode("utf-8", "ignore"))
                    fail(f"Lỗi FFmpeg khi xử lý {base}{suf}.")
            except FileNotFoundError:
                fail("Không tìm thấy ffmpeg trong PATH.")

            output_files.append(out)

            if export_thumbnail and os.path.exists(out):
                thumb_dir = os.path.join(output_folder, "_Thumbnail", out_top_name, rel_dir)
                os.makedirs(thumb_dir, exist_ok=True)
                thumb_path = os.path.join(thumb_dir, f"{out_base}{suf}{dur_suffix}{date_suffix}.jpg")
                thumb_cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", out,
                             "-vf", "select=eq(n\\,4)", "-vframes", "1", thumb_path]
                try:
                    subprocess.run(thumb_cmd, creationflags=CREATE_NO_WINDOW,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:
                    pass

    out_reporter["last_root_topnames"] = last_root_topnames
    return output_files


def pick_output_subfolders(output_root, topnames):
    picked = []
    for tn in topnames:
        p = os.path.join(output_root, tn)
        if os.path.isdir(p):
            picked.append(p)
    return picked


# ----------------- PHÂN PHỐI (UNC + GCS) -----------------
def distribute_to_apps(sources, thumb_subfolders_to_copy, config, settings, custom_links, run_yymm, run_yymmdd):
    """sources: list[(source_path, gcs_root)]. Copy UNC + upload GCS cho từng App đã chọn.
    gcs_root khác nhau theo mode (output_folder khi có resize, thư mục cha khi upload thẳng)."""
    selected_apps = sorted(set(config.get("selected_apps", []) or []))
    use_unc = bool(config.get("use_unc", True))
    use_gcs = bool(config.get("use_gcs", False))
    use_meta = bool(config.get("use_meta", True))
    use_google = bool(config.get("use_google", False))
    export_thumbnail = bool(config.get("export_thumbnail", True))
    gcs_google_parent = (config.get("gcs_google_parent_folder") or "Application Tools T1").strip()

    gcs_streams = settings.get("gcs_streams", {}) or {}
    creds_json = (settings.get("gcs_credentials_global") or "").strip() if use_gcs else ""

    source_paths = [p for p, _ in sources]
    gcs_groups = {}
    for p, root in sources:
        gcs_groups.setdefault(root, []).append(p)

    unc_links = []
    gcs_links = []
    gcs_had_error = False
    all_asana_parts = []

    for app_idx, tag in enumerate(selected_apps):
        app_cfg = custom_links.get(tag, {})
        internal_dest_root = (app_cfg.get("folder") or "").strip()

        if use_unc:
            progress(75, f"App [{app_idx + 1}/{len(selected_apps)}] {tag}: Copy nội bộ…")
            try:
                if internal_dest_root and source_paths:
                    app_unc_links = []
                    for source_path in source_paths:
                        folder_name = os.path.basename(source_path)
                        destination_path = os.path.join(internal_dest_root, run_yymm, run_yymmdd, folder_name)
                        os.makedirs(os.path.dirname(destination_path), exist_ok=True)
                        shutil.copytree(source_path, destination_path, dirs_exist_ok=True)
                        unc_links.append(destination_path)
                        app_unc_links.append(destination_path)
                    if app_unc_links:
                        all_asana_parts.append(f"📁 UNC [{tag}]:\n" + "\n".join(app_unc_links))
            except Exception as e:
                log(f"[UNC] [{tag}] Không thể copy nội bộ: {e}")

            if export_thumbnail and thumb_subfolders_to_copy:
                thumbnail_dest_root = (app_cfg.get("thumbnail_folder") or "").strip()
                if thumbnail_dest_root:
                    try:
                        os.makedirs(thumbnail_dest_root, exist_ok=True)
                        for source_path in thumb_subfolders_to_copy:
                            for dirpath, _, filenames in os.walk(source_path):
                                for fn in filenames:
                                    shutil.copy2(os.path.join(dirpath, fn), os.path.join(thumbnail_dest_root, fn))
                    except Exception as e:
                        log(f"[Thumbnail] [{tag}] Không thể copy thumbnail: {e}")

        if use_gcs and gcs_groups:
            streams = []
            if use_meta:
                mb = (gcs_streams.get("Meta") or "").strip()
                if mb:
                    streams.append(("Meta", mb, tag))
            if use_google:
                gb = (gcs_streams.get("Google") or "").strip()
                if gb:
                    streams.append(("Google", gb, f"{gcs_google_parent}/{tag}"))

            for sn, bucket, path_tag in streams:
                progress(80, f"App [{app_idx + 1}/{len(selected_apps)}] {tag}: GCS {sn}…")

                def _on_prog(d, t, r, _sn=sn):
                    progress(80, f"GCS {_sn}: {os.path.basename(r)[:40]} ({d}/{t})")

                for gcs_root, subfolders in gcs_groups.items():
                    try:
                        links = upload_output_to_gcs(
                            output_root=gcs_root, app_tag=path_tag, bucket_name=bucket,
                            creds_json_path=creds_json, on_progress=_on_prog,
                            allowed_subfolders=subfolders, date_yymm=run_yymm, date_yymmdd=run_yymmdd)
                        gcs_links.extend(links)
                        all_asana_parts.append(f"📦 GCS {sn} [{tag}]:\n" + "\n".join(links))
                    except Exception as e:
                        gcs_had_error = True
                        all_asana_parts.append(f"⚠️ GCS {sn} [{tag}]: LỖI UPLOAD - {e}")
                        log(f"[GCS] [{tag}/{sn}] Lỗi: {e}")

    return unc_links, gcs_links, gcs_had_error, all_asana_parts


# ----------------- MAIN -----------------
def main():
    payload = json.loads(sys.stdin.read())
    inputs = payload.get("inputs", {}) or {}
    config = payload.get("config", {}) or {}
    settings = payload.get("settings", {}) or {}
    custom_links = payload.get("custom_links", {}) or {}
    run_mode = payload.get("run_mode", "full")  # full | resize_upload | upload_only

    input_folders = [_to_container_path(f) for f in (config.get("input_folders", []) or [])]
    for f in (inputs.get("folders_in") or []):
        f = _to_container_path(f)
        if f not in input_folders:
            input_folders.append(f)
    config["input_folders"] = input_folders

    run_yymm = datetime.now().strftime("%y%m")
    run_yymmdd = datetime.now().strftime("%y%m%d")
    export_thumbnail = bool(config.get("export_thumbnail", True))

    if run_mode == "upload_only":
        progress(0, "Bước 1/2: Chuẩn bị nguồn…")
        files_out = []
        sources = [
            (f, os.path.dirname(f.rstrip("\\/")))
            for f in input_folders if os.path.isdir(f)
        ]
        thumb_subfolders_to_copy = []
    else:
        progress(0, "Bước 1/3: Đang render…" if run_mode == "full" else "Bước 1/2: Đang render…")
        resize_state = {}
        files_out = process_videos(config, resize_state)
        last_root_topnames = resize_state.get("last_root_topnames", {})

        output_folder = _to_container_path(config.get("output_folder", ""))
        allowed_topnames = list(last_root_topnames.values())
        subfolders_to_copy = pick_output_subfolders(output_folder, allowed_topnames)
        sources = [(p, output_folder) for p in subfolders_to_copy]

        thumb_subfolders_to_copy = []
        if export_thumbnail:
            thumbnail_src_root = os.path.join(output_folder, "_Thumbnail")
            thumb_subfolders_to_copy = pick_output_subfolders(thumbnail_src_root, allowed_topnames)

    progress(75, "Phân phối…")
    unc_links, gcs_links, gcs_had_error, all_asana_parts = distribute_to_apps(
        sources, thumb_subfolders_to_copy, config, settings, custom_links, run_yymm, run_yymmdd)

    if run_mode == "full" and config.get("use_asana", True):
        progress(95, "Bước 3/3: Cập nhật Asana…")
        pat = (settings.get("asana_pat_main") or "").strip()
        task_urls = [u for u in (config.get("task_urls", "") or "").strip().splitlines() if u.strip()]
        if pat and task_urls:
            if gcs_had_error:
                desc = "⚠️ CÓ LỖI GCS UPLOAD — KHÔNG SET DONE\n\n" + ("\n\n".join(all_asana_parts) if all_asana_parts else "")
            else:
                desc = "\n\n".join(all_asana_parts) if all_asana_parts else "Hoàn tất."
            for i, url in enumerate(task_urls):
                gid = get_task_gid_from_url(url)
                if not gid:
                    continue
                try:
                    post_task_comment(pat, gid, desc)
                    if not gcs_had_error:
                        fg = (config.get("asana_field_gid") or "").strip()
                        og = (config.get("asana_option_gid") or "").strip()
                        if not fg or not og:
                            fg, og = find_progress_and_done_option(pat, gid)
                        if fg and og:
                            update_task_custom_field(pat, gid, fg, og)
                except Exception as e:
                    log(f"[Asana] Không thể cập nhật task {url}: {e}")

    progress(100, "Hoàn tất!")
    print(json.dumps({"unc_links": unc_links, "gcs_links": gcs_links, "files_out": files_out}))


if __name__ == "__main__":
    main()
