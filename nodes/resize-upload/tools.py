import sys
import os
import json

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from executor import (  # noqa: E402
    _asana_get, get_task_gid_from_url, find_progress_and_done_option,
    upload_output_to_gcs,
)
from datetime import datetime, timedelta


def fail(msg):
    # exit code != 0 makes spawnPython() reject using stderr (see backend/engine/runner.js) —
    # stdout is only parsed on a clean exit, so the message must go to stderr here.
    print(msg, file=sys.stderr)
    sys.exit(1)


HOST_MOUNT_PREFIX = "/host-fs/"


def is_host_mounted(path_str):
    # Chỉ đọc/ghi, không xoá dữ liệu trong các thư mục/ổ đĩa đã mount từ máy host
    # (%USERPROFILE%, các ổ đĩa, EXTRA_HOST_DIR_N) — xem docker-compose.yml.
    return path_str.replace("\\", "/").startswith(HOST_MOUNT_PREFIX)


def search_my_tasks(pat, workspace_gid, search_params):
    url = f"https://app.asana.com/api/1.0/workspaces/{workspace_gid}/tasks/search"
    search_params['opt_fields'] = "name,completed,permalink_url,memberships.project.name"
    return _asana_get(pat, url, params=search_params)


def action_asana_test(payload):
    pat = (payload.get("pat") or "").strip()
    if not pat:
        fail("Chưa nhập PAT.")
    _asana_get(pat, "https://app.asana.com/api/1.0/workspaces")
    print(json.dumps({"ok": True, "message": "PAT hợp lệ • Kết nối OK"}))


def action_asana_tasks(payload):
    pat = (payload.get("pat") or "").strip()
    if not pat:
        fail("Chưa nhập PAT.")
    workspaces = _asana_get(pat, "https://app.asana.com/api/1.0/workspaces")
    if not workspaces:
        fail("Không tìm thấy workspace.")
    workspace_gid = workspaces[0]["gid"]
    date_since = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    params = {
        "assignee.any": "me",
        "created_on.after": date_since,
        "completed": "false",
        "sort_by": "created_at",
    }
    tasks = search_my_tasks(pat, workspace_gid, params)
    out = []
    for task in tasks:
        project_name = "No Project"
        memberships = task.get("memberships", [])
        if memberships and memberships[0].get("project"):
            project_name = memberships[0]["project"].get("name", "No Project")
        out.append({
            "name": task.get("name", "Untitled"),
            "project": project_name,
            "permalink_url": task.get("permalink_url"),
        })
    print(json.dumps({"tasks": out}))


def action_asana_inspect(payload):
    pat = (payload.get("pat") or "").strip()
    task_gid = get_task_gid_from_url((payload.get("task_url") or "").strip())
    if not pat or not task_gid:
        fail("Nhập PAT và một Task URL hợp lệ.")

    task = _asana_get(pat, f"https://app.asana.com/api/1.0/tasks/{task_gid}",
                       params={"opt_fields": "memberships.project.gid,custom_fields"})

    fields_on_task = []
    for field in task.get("custom_fields", []):
        item = {
            "name": field.get("name", "N/A"),
            "gid": field.get("gid", "N/A"),
            "type": f"{field.get('resource_type')}/{field.get('type')}",
        }
        if field.get("enum_value"):
            item["value_name"] = field["enum_value"].get("name", "N/A")
            item["option_gid"] = field["enum_value"].get("gid", "N/A")
        fields_on_task.append(item)

    project_gids = sorted({m["project"]["gid"] for m in task.get("memberships", []) if "project" in m})
    project_fields = []
    for pg in project_gids:
        settings = _asana_get(
            pat, f"https://app.asana.com/api/1.0/projects/{pg}/custom_field_settings",
            params={"opt_fields": "custom_field,custom_field.name,custom_field.gid,custom_field.type,custom_field.enum_options"}
        )
        for s in settings:
            cf = s["custom_field"]
            entry = {"name": cf.get("name", "N/A"), "gid": cf.get("gid", "N/A"), "options": []}
            if cf.get("type") == "enum" and cf.get("enum_options"):
                entry["options"] = [{"name": o.get("name"), "gid": o.get("gid")} for o in cf["enum_options"]]
            project_fields.append(entry)

    print(json.dumps({"fields_on_task": fields_on_task, "project_fields": project_fields}))


def action_asana_auto_gid(payload):
    pat = (payload.get("pat") or "").strip()
    task_gid = get_task_gid_from_url((payload.get("task_url") or "").strip())
    if not pat or not task_gid:
        fail("Nhập PAT và Task URL hợp lệ.")
    field_gid, done_gid = find_progress_and_done_option(pat, task_gid)
    if field_gid and done_gid:
        print(json.dumps({"field_gid": field_gid, "option_gid": done_gid}))
    else:
        fail("Không tìm được field 'Progress/Status/Trạng thái' hoặc option 'Done'.")


def action_gcs_test(payload):
    bucket = (payload.get("bucket") or "").strip()
    creds = (payload.get("creds_json_path") or "").strip()
    if not bucket:
        fail("Chưa nhập Bucket.")
    try:
        upload_output_to_gcs(output_root=os.getcwd(), app_tag="test", bucket_name=bucket,
                              creds_json_path=creds, allowed_subfolders=[])
    except RuntimeError as e:
        if "Không có thư mục" in str(e):
            print(json.dumps({"ok": True, "message": f"Credentials OK • Bucket '{bucket}' hợp lệ"}))
            return
        fail(str(e))


def action_unc_test(payload):
    folder = (payload.get("folder") or "").strip()
    if not folder:
        fail("App chưa có UNC folder.")
    os.makedirs(folder, exist_ok=True)
    testfile = os.path.join(folder, ".permcheck.tmp")
    with open(testfile, "w", encoding="utf-8") as f:
        f.write("ok")
    if not is_host_mounted(folder):
        os.remove(testfile)
    print(json.dumps({"ok": True, "message": "Quyền ghi/đọc OK"}))


ACTIONS = {
    "asana_test": action_asana_test,
    "asana_tasks": action_asana_tasks,
    "asana_inspect": action_asana_inspect,
    "asana_auto_gid": action_asana_auto_gid,
    "gcs_test": action_gcs_test,
    "unc_test": action_unc_test,
}


def main():
    payload = json.loads(sys.stdin.read())
    action = payload.get("action")
    handler = ACTIONS.get(action)
    if not handler:
        fail(f"Unknown action: {action}")
    try:
        handler(payload)
    except SystemExit:
        raise
    except Exception as e:
        fail(str(e))


if __name__ == "__main__":
    main()
