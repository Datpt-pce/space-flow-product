import sys
import os
import json
import re
import shutil
from datetime import datetime

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# Tái sử dụng logic ffmpeg/UNC/Asana từ node V1 (không copy lại) — riêng sizes_for_mode và
# distribute_to_apps được override/viết lại riêng cho V2 (xem bên dưới), không đụng file V1.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resize-upload'))
import executor as v1


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def progress(pct, msg=""):
    print(f"PROGRESS\t{pct}\t{msg}", file=sys.stderr, flush=True)


def row_result(row_id, status, unc_links=None, error=None):
    payload = {
        "row_id": row_id, "status": status,
        "unc_links": unc_links or [], "error": error,
    }
    print(f"ROWRESULT\t{json.dumps(payload)}", file=sys.stderr, flush=True)


class RowFailure(Exception):
    pass


def _row_fail(msg):
    # Thay cho v1.fail(): không in JSON lỗi ra stdout (sẽ phá JSON kết quả cuối cùng),
    # chỉ raise để dòng hiện tại bị bỏ qua và các dòng khác tiếp tục chạy.
    raise RowFailure(msg)


v1.fail = _row_fail


def sizes_for_mode_v2(m):
    # Bản riêng cho V2 — đồng bộ theo spec tham chiếu (video-resize-upnms/app.pyw): preset
    # 4_sizes_meta dùng _169 (16:9) thay vì _34 (3:4) như bản V1 đang dùng. V1 giữ nguyên,
    # không sửa nodes/resize-upload/executor.py.
    if m == "3_sizes":
        return [("_916", "1080:1920"), ("_169", "1920:1080"), ("_11", "1080:1080")]
    if m == "4_sizes_meta":
        return [("_916", "1080:1920"), ("_169", "1920:1080"), ("_11", "1080:1080"), ("_45", "1080:1350")]
    return [("_11", "1080:1080"), ("_23", "1080:1620"), ("_32", "1620:1080"), ("_34", "1080:1440"),
            ("_43", "1440:1080"), ("_45", "1080:1350"), ("_169", "1920:1080"), ("_916", "1080:1920")]


v1.sizes_for_mode = sizes_for_mode_v2


def build_row_config(row, base_config, extra_folders, settings):
    cfg = dict(base_config)
    input_folders = [v1._to_container_path(f) for f in (row.get('input_folders', []) or [])]
    for f in extra_folders:
        f = v1._to_container_path(f)
        if f not in input_folders:
            input_folders.append(f)
    cfg['input_folders'] = input_folders
    cfg['mode'] = row.get('mode', '8_sizes')
    cfg['rename_videos'] = bool(row.get('rename_videos', True))
    cfg['export_thumbnail'] = bool(row.get('export_thumbnail', True))
    cfg['use_unc'] = bool(row.get('use_unc', True))
    cfg['use_today_date'] = bool(row.get('use_today_date', True))
    cfg['custom_date'] = row.get('custom_date', '') or ''
    cfg['selected_apps'] = [row['app']] if row.get('app') else []
    cfg['task_urls'] = row.get('task_urls', '') or ''
    return cfg


def distribute_to_apps_v2(sources, thumb_subfolders_to_copy, config, custom_links, run_yymm, run_yymmdd):
    """Bản riêng cho V2 — chỉ copy nội bộ (UNC). Đích copy là path Google Drive desktop đã
    cài trên máy (cấu hình trong custom_links.json, cùng cơ chế path như UNC network trước
    đây) — Google Drive tự đồng bộ lên cloud, nên không còn gọi GCS API nữa."""
    selected_apps = sorted(set(config.get("selected_apps", []) or []))
    use_unc = bool(config.get("use_unc", True))
    export_thumbnail = bool(config.get("export_thumbnail", True))

    source_paths = [p for p, _ in sources]

    unc_links = []
    all_asana_parts = []

    for app_idx, tag in enumerate(selected_apps):
        app_cfg = custom_links.get(tag, {})
        internal_dest_root = (app_cfg.get("folder") or "").strip()

        if use_unc:
            v1.progress(75, f"App [{app_idx + 1}/{len(selected_apps)}] {tag}: Copy nội bộ…")
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

    return unc_links, all_asana_parts


def run_row(cfg, settings, custom_links, run_mode, row_label, base_pct, span):
    """Lặp lại orchestration của v1.main() cho 1 dòng, với progress được co giãn
    vào khoảng [base_pct, base_pct+span] của tổng tiến trình."""

    def scaled_progress(pct, msg=""):
        orig_progress(min(99, int(base_pct + pct / 100 * span)), f"[{row_label}] {msg}")

    orig_progress = v1.progress
    v1.progress = scaled_progress
    try:
        if cfg.get('use_today_date', True):
            run_yymm = datetime.now().strftime("%y%m")
            run_yymmdd = datetime.now().strftime("%y%m%d")
        else:
            custom = (cfg.get('custom_date') or '').strip()
            if not re.fullmatch(r"\d{6}", custom):
                v1.fail(f"Ngày tuỳ chỉnh không hợp lệ: '{custom}'. Phải gõ đúng 6 chữ số theo định dạng YYMMDD (vd: 260724).")
            run_yymm, run_yymmdd = custom[:4], custom
        export_thumbnail = bool(cfg.get("export_thumbnail", True))

        if run_mode == "upload_only":
            files_out = []
            sources = [
                (f, os.path.dirname(f.rstrip("\\/")))
                for f in cfg.get("input_folders", []) if os.path.isdir(f)
            ]
            thumb_subfolders_to_copy = []
        else:
            resize_state = {}
            files_out = v1.process_videos(cfg, resize_state, date_tag=run_yymmdd)
            last_root_topnames = resize_state.get("last_root_topnames", {})

            output_folder = v1._to_container_path(cfg.get("output_folder", ""))
            allowed_topnames = list(last_root_topnames.values())
            subfolders_to_copy = v1.pick_output_subfolders(output_folder, allowed_topnames)
            sources = [(p, output_folder) for p in subfolders_to_copy]

            thumb_subfolders_to_copy = []
            if export_thumbnail:
                thumbnail_src_root = os.path.join(output_folder, "_Thumbnail")
                thumb_subfolders_to_copy = v1.pick_output_subfolders(thumbnail_src_root, allowed_topnames)

        unc_links, all_asana_parts = distribute_to_apps_v2(
            sources, thumb_subfolders_to_copy, cfg, custom_links, run_yymm, run_yymmdd)

        if run_mode == "full" and cfg.get("use_asana", True):
            pat = (settings.get("asana_pat_main") or "").strip()
            task_urls = [u for u in (cfg.get("task_urls", "") or "").strip().splitlines() if u.strip()]
            if pat and task_urls:
                desc = "\n\n".join(all_asana_parts) if all_asana_parts else "Hoàn tất."
                for url in task_urls:
                    gid = v1.get_task_gid_from_url(url)
                    if not gid:
                        continue
                    try:
                        v1.post_task_comment(pat, gid, desc)
                        fg = (cfg.get("asana_field_gid") or "").strip()
                        og = (cfg.get("asana_option_gid") or "").strip()
                        if not fg or not og:
                            fg, og = v1.find_progress_and_done_option(pat, gid)
                        if fg and og:
                            v1.update_task_custom_field(pat, gid, fg, og)
                    except Exception as e:
                        log(f"[Asana] [{row_label}] Không thể cập nhật task {url}: {e}")

        return files_out, unc_links
    finally:
        v1.progress = orig_progress


def main():
    payload = json.loads(sys.stdin.read())
    inputs = payload.get("inputs", {}) or {}
    config = payload.get("config", {}) or {}
    settings = payload.get("settings", {}) or {}
    custom_links = payload.get("custom_links", {}) or {}
    run_mode = payload.get("run_mode", "full")  # full | upload_only

    # Folder từ input port (nếu có) được thêm vào input của MỌI dòng đang chọn.
    extra_folders = list(inputs.get("folders_in") or [])

    base_config = {k: v for k, v in config.items() if k != "rows"}
    rows = [r for r in (config.get("rows") or []) if r.get("selected")]

    if not rows:
        progress(100, "Không có dòng nào được chọn")
        print(json.dumps({"unc_links": [], "files_out": [], "rows": {}}))
        return

    all_files, all_unc = [], []
    all_rows_result = {}
    row_count = len(rows)

    for idx, row in enumerate(rows):
        app_label = row.get("app") or f"dòng {idx + 1}"
        row_label = f"{idx + 1}/{row_count} {app_label}"
        base_pct = int(idx / row_count * 100)
        span = 100 / row_count
        progress(base_pct, f"Bắt đầu [{row_label}]")
        row_id = row.get("id")
        try:
            row_cfg = build_row_config(row, base_config, extra_folders, settings)
            files_out, unc_links = run_row(
                row_cfg, settings, custom_links, run_mode, row_label, base_pct, span)
            all_files.extend(files_out)
            all_unc.extend(unc_links)
            all_rows_result[row_id] = {
                "row_id": row_id, "status": "done",
                "unc_links": unc_links, "error": None,
            }
            row_result(row_id, "done", unc_links)
        except Exception as e:
            log(f"[{row_label}] Lỗi: {e} — bỏ qua dòng này, tiếp tục dòng kế tiếp.")
            all_rows_result[row_id] = {
                "row_id": row_id, "status": "error",
                "unc_links": [], "error": str(e),
            }
            row_result(row_id, "error", error=str(e))

    progress(100, "Hoàn tất!")
    print(json.dumps({"unc_links": all_unc, "files_out": all_files, "rows": all_rows_result}))


if __name__ == "__main__":
    main()
