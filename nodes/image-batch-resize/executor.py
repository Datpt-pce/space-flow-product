import sys
import json
import os
from datetime import datetime
from pathlib import Path
from PIL import Image

RATIOS = {
    "ratio_1_1":  (1, 1),
    "ratio_9_16": (9, 16),
    "ratio_16_9": (16, 9),
    "ratio_4_5":  (4, 5),
    "ratio_3_4":  (3, 4),
    "ratio_4_3":  (4, 3),
    "ratio_2_3":  (2, 3),
    "ratio_3_2":  (3, 2),
}


def scale_proportional(img, tw, th):
    ow, oh = img.size
    if tw and not th:
        r = tw / ow
        sz = (int(tw), int(oh * r))
    elif th and not tw:
        r = th / oh
        sz = (int(ow * r), int(th))
    else:
        r = min(tw / ow, th / oh)
        sz = (int(ow * r), int(oh * r))
    return img.resize(sz, Image.Resampling.LANCZOS)


def smart_crop_resize(img, rw, rh, base_px):
    w, h = img.size
    target_aspect = rw / rh
    current_aspect = w / h

    if current_aspect > target_aspect:
        new_w = int(target_aspect * h)
        left = (w - new_w) / 2
        crop_box = (left, 0, left + new_w, h)
    else:
        new_h = int(w / target_aspect)
        top = (h - new_h) / 2
        crop_box = (0, top, w, top + new_h)

    if rw >= rh:
        final_h = base_px
        final_w = int(base_px * (rw / rh))
    else:
        final_w = base_px
        final_h = int(base_px * (rh / rw))

    return img.crop(crop_box).resize((final_w, final_h), Image.Resampling.LANCZOS)


def prepare_img_for_jpg(img):
    if img.mode in ("RGBA", "P"):
        bg = Image.new("RGB", img.size, (255, 255, 255))
        mask = img.split()[3] if img.mode == "RGBA" else None
        bg.paste(img, mask=mask)
        return bg
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def main():
    payload = json.loads(sys.stdin.read())
    inputs = payload["inputs"]
    config = payload["config"]

    files_in = inputs.get("files_in", [])
    if not files_in:
        print(json.dumps({"error": "No input files"}))
        sys.exit(1)

    ext = config.get("output_format", "png")
    m_w = int(config.get("manual_width", 0))
    m_h = int(config.get("manual_height", 0))
    base_px = int(config.get("base_px", 1080))

    selected_ratios = [(k, v) for k, v in RATIOS.items() if config.get(k, False)]

    if not (m_w or m_h) and not selected_ratios:
        print(json.dumps({"error": "No resize mode selected. Set manual width/height or enable at least one ratio."}))
        sys.exit(1)

    valid_exts = ('.jpg', '.jpeg', '.png', '.bmp', '.webp')
    all_files = []
    for p in files_in:
        if os.path.isfile(p) and p.lower().endswith(valid_exts):
            all_files.append(p)
        elif os.path.isdir(p):
            for root, _, fnames in os.walk(p):
                for f in fnames:
                    if f.lower().endswith(valid_exts):
                        all_files.append(os.path.join(root, f))

    all_files = list(dict.fromkeys(all_files))  # deduplicate, preserve order

    if not all_files:
        print(json.dumps({"error": "No valid image files found in input"}))
        sys.exit(1)

    ts = datetime.now().strftime("%y%m%d")
    input_parent = str(Path(all_files[0]).parent)
    out_dir = os.path.join(input_parent, f"{ts}-space-image-batch-resize")
    os.makedirs(out_dir, exist_ok=True)

    save_kwargs = {"quality": 95} if ext == "jpg" else {}
    output_files = []

    for f_path in all_files:
        try:
            with Image.open(f_path) as img_orig:
                img_work = img_orig.copy()
                if ext == "jpg":
                    img_work = prepare_img_for_jpg(img_work)

                stem = Path(f_path).stem

                if m_w or m_h:
                    result = scale_proportional(img_work, m_w or None, m_h or None)
                    w, h = result.size
                    out_path = os.path.join(out_dir, f"{stem}-{w}x{h}.{ext}")
                    result.save(out_path, **save_kwargs)
                    output_files.append(out_path)

                for _key, (rw, rh) in selected_ratios:
                    result = smart_crop_resize(img_work, rw, rh, base_px)
                    w, h = result.size
                    out_path = os.path.join(out_dir, f"{stem}-{w}x{h}.{ext}")
                    result.save(out_path, **save_kwargs)
                    output_files.append(out_path)

        except Exception as e:
            print(f"[warn] Skipped {os.path.basename(f_path)}: {e}", file=sys.stderr)

    print(json.dumps({"files_out": output_files}))


if __name__ == "__main__":
    main()
