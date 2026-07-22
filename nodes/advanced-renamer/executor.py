import sys
import json
import os


def process_logic(text, method, item):
    m_type = method.get('type')
    p = method.get('params', {})
    try:
        if m_type == "Add":
            content = p.get('text', '')
            idx = p.get('index', 0)
            pos = (len(text) - idx) if p.get('backwards', False) else idx
            pos = max(0, min(pos, len(text)))
            return text[:pos] + content + text[pos:]

        elif m_type == "Swap":
            sep = p.get('separator', '')
            if not sep or sep not in text:
                return text
            parts = text.split(sep)
            if len(parts) < 2:
                return text
            occ = p.get('occurrence', '1st')
            if occ == "All (Reverse)":
                return sep.join(reversed(parts))
            target_idx = {"1st": 0, "2nd": 1, "3rd": 2, "Last": len(parts) - 1}.get(occ, -1)
            if 0 <= target_idx < len(parts):
                moved = parts.pop(target_idx)
                parts.append(moved)
                return sep.join(parts)
            return text

        elif m_type == "ListReplace":
            for row in p.get('table_data', []):
                find, rep = row[0], row[1] if len(row) > 1 else ''
                if find:
                    text = text.replace(find, rep)
            return text

        elif m_type == "FolderName":
            sep = p.get('separator', '')
            root_path = item.get('root_path')
            if not root_path:
                return text
            full_path = os.path.normpath(item['full_path'])
            root_path = os.path.normpath(root_path)
            if full_path == root_path:
                return text
            rel = os.path.relpath(full_path, root_path)
            root_name = os.path.basename(root_path)
            rel_parts = rel.split(os.sep)
            parts = [root_name] + rel_parts
            return sep.join(parts)
    except Exception:
        return text
    return text


def calculate_new_name_file(original_name, item, file_methods):
    res = original_name
    for m in file_methods:
        if not m.get('active', True):
            continue
        p = m.get('params', {})
        base, ext = os.path.splitext(res)
        apply_to = p.get('apply_to', 'Name')
        target = base if apply_to == 'Name' else ext if apply_to == 'Extension' else res
        new_target = process_logic(target, m, item)
        if apply_to == 'Name':
            res = new_target + ext
        elif apply_to == 'Extension':
            res = base + new_target
        else:
            res = new_target
    return res


def calculate_new_name_folder(original_name, item, folder_methods):
    res = original_name
    applied = False
    for m in folder_methods:
        if not m.get('active', True):
            continue
        res = process_logic(res, m, item)
        applied = True
    if not applied:
        res = process_logic(res, {'type': 'FolderName', 'params': {'separator': '_'}}, item)
    return res


def build_items(base_path, dropped_items):
    items = []
    seen = set()

    def add_item(path, is_dir, root_path):
        path = os.path.normpath(path)
        if path in seen:
            return
        seen.add(path)
        items.append({
            'full_path': path,
            'directory': os.path.dirname(path),
            'original_name': os.path.basename(path),
            'is_dir': is_dir,
            'root_path': root_path,
        })

    for di in dropped_items:
        name = di.get('name')
        if not name:
            continue
        p = os.path.normpath(os.path.join(base_path, name))
        if os.path.isdir(p):
            add_item(p, True, p)
            for root, dirs, files in os.walk(p):
                dirs.sort()
                for d in dirs:
                    add_item(os.path.join(root, d), True, p)
                for fn in sorted(files):
                    add_item(os.path.join(root, fn), False, p)
        elif os.path.isfile(p):
            add_item(p, False, None)

    return items


def main():
    payload = json.loads(sys.stdin.read())
    config = payload.get("config", {})

    base_path = (config.get("base_path") or '').strip()
    if not base_path:
        print(json.dumps({"error": "Vui lòng nhập thư mục gốc (base_path)."}))
        sys.exit(1)
    if not os.path.isdir(base_path):
        print(json.dumps({"error": f"Thư mục gốc không tồn tại: {base_path}"}))
        sys.exit(1)

    dropped_items = config.get("dropped_items") or []
    if not dropped_items:
        print(json.dumps({"error": "Chưa có file/folder nào được kéo vào (dropped_items rỗng)."}))
        sys.exit(1)

    file_methods = config.get("file_methods") or []
    folder_methods = config.get("folder_methods") or []
    apply_changes = bool(config.get("apply_changes", False))

    items = build_items(base_path, dropped_items)
    if not items:
        print(json.dumps({"error": "Không tìm thấy file/folder nào khớp với dropped_items trong base_path."}))
        sys.exit(1)

    for item in items:
        if item['is_dir']:
            item['new_name'] = calculate_new_name_folder(item['original_name'], item, folder_methods)
        else:
            item['new_name'] = calculate_new_name_file(item['original_name'], item, file_methods)

    # Đổi tên sâu nhất trước để tránh làm hỏng path con khi rename path cha
    sorted_items = sorted(items, key=lambda it: -it['full_path'].count(os.sep))

    mapping = []
    files_out = []
    for item in sorted_items:
        old_path = item['full_path']
        changed = item['new_name'] != item['original_name']
        new_path = os.path.join(item['directory'], item['new_name']) if changed else old_path
        applied = False

        if changed and apply_changes:
            try:
                os.rename(old_path, new_path)
                applied = True
            except Exception as e:
                print(f"[warn] Không đổi tên được {old_path}: {e}", file=sys.stderr)
                new_path = old_path

        mapping.append({
            "old_path": old_path,
            "new_path": new_path,
            "is_dir": item['is_dir'],
            "changed": changed,
            "applied": applied,
        })
        files_out.append(new_path if applied else old_path)

    print(json.dumps({"files_out": files_out, "mapping": mapping}))


if __name__ == "__main__":
    main()
