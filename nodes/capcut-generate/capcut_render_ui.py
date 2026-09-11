"""Export via CapCut's local UI; labels and window identity bound each action."""
import ctypes
from ctypes import wintypes as w
from pathlib import Path
import subprocess
import time
import re

from capcut_window import capture, click, read_window, text_point, windows


def render_label_point(lines, label):
    exact = [line for line in lines if line['text'].strip().casefold() == label.casefold()]
    if len(exact) == 1:
        return text_point(exact, exact[0]['text'])
    if not re.fullmatch(r'SFRender-[a-f0-9]{8}-\d{3}', label):
        return None
    matches = []
    for line in lines:
        candidate = re.fullmatch(r'SFRender-([a-fA-F0-9OSIl]{8})-(\d{3})', line['text'].strip(), re.IGNORECASE)
        if not candidate:
            continue
        # Only characters impossible in a hexadecimal ID may be corrected.
        # Never guess between two valid digits (e.g. b/8), or use partial names.
        key = candidate[1].translate(str.maketrans('OoSsIiLl', '00551111')).lower()
        if f'SFRender-{key}-{candidate[2]}' == label:
            matches.append(line)
    return text_point(matches, matches[0]['text']) if len(matches) == 1 else None


def await_window(pid, predicate, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        found = next((win for win in windows(pid) if predicate(win)), None)
        if found: return found
        time.sleep(.5)
    raise ValueError('Không thấy cửa sổ CapCut cần thao tác. Giữ màn hình mở và dùng giao diện CapCut English.')


def await_label(handle, directory, label, region=None, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        regions = [region]
        if region is None and label.startswith('SFRender-'):
            # Read the compact Home project list at 3x before giving up.
            regions.append((.15, .55, .7, 1))
        for crop in regions:
            for threshold in (False, True):
                lines = read_window(handle, directory, crop, threshold)
                point = render_label_point(lines, label)
                if point: return point, lines
        time.sleep(1)
    raise ValueError('Không nhận diện được nút ' + label + '. Giữ cửa sổ CapCut mở, giao diện English, rồi thử lại.')


def choose_folder(pid, export, lines, output, directory):
    from PIL import Image
    point = text_point(lines, 'Export to')
    if not point: raise ValueError('Không thấy thư mục xuất CapCut.')
    # Locate the square folder button at the right of the identified path row.
    capture(export, directory / 'controls.png')
    with Image.open(directory / 'controls.png') as image:
        width = image.width
    click(export, width - 30, point[1])
    picker = await_window(pid, lambda win: win['class'] == '#32770')
    user = ctypes.windll.user32
    controls = []
    @ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    def visit(handle, _):
        cls = ctypes.create_unicode_buffer(128); user.GetClassNameW(handle, cls, 128)
        if user.IsWindowVisible(handle): controls.append((handle, cls.value, user.GetDlgCtrlID(handle)))
        return True
    user.EnumChildWindows(picker['handle'], visit, 0)
    edits = [h for h, cls, _ in controls if cls == 'Edit']
    buttons = [h for h, cls, control_id in controls if cls == 'Button' and control_id == 1]
    if len(edits) != 1 or len(buttons) != 1: raise ValueError('Không nhận diện được bộ chọn thư mục CapCut.')
    user.SendMessageW(edits[0], 0x000c, 0, str(output))  # WM_SETTEXT on native folder field
    user.SendMessageW(buttons[0], 0x00f5, 0, 0)
    time.sleep(.5)
    if any(win['handle'] == picker['handle'] for win in windows(pid)): raise ValueError('CapCut chưa chấp nhận thư mục xuất.')


def disable_cloud_sync(handle, lines, directory):
    from PIL import Image
    label = next((line for line in lines if line['text'] == 'Sync exported videos to space'), None)
    if not label: raise ValueError('Không xác định được tùy chọn lưu cục bộ của CapCut; chưa bấm Export.')
    word = label['words'][0]
    height = word['height']; x, y = word['x'] - height, word['y'] + height / 2
    for attempt in range(2):
        capture(handle, directory / 'controls.png')
        with Image.open(directory / 'controls.png') as image:
            pixels = list(image.crop((round(x-height*.3), round(y-height*.3), round(x+height*.3), round(y+height*.3))).convert('RGB').getdata())
        # An unchecked box has a uniform dark interior; a check mark or accent
        # has bright/colored pixels. Never export while the state is uncertain.
        levels = [max(pixel) for pixel in pixels]
        if max(levels) < 140 and max(levels) - min(levels) < 45: return
        if attempt == 0 and max(levels) > 180: click(handle, x, y); time.sleep(.3)
        else: break
    raise ValueError('Tắt “Sync exported videos to space” trong CapCut rồi thử lại.')


def export_project(app, name, output_dir, directory, phase):
    output = output_dir / (name + '.mp4')
    if output.exists(): raise ValueError('File MP4 đã tồn tại; tạo lượt render mới để tránh ghi đè.')
    home = project_home(app, directory, name)
    pid = home['pid']
    ctypes.windll.user32.ShowWindow(home['handle'], 9)
    point, _ = await_label(home['handle'], directory, name, timeout=60)
    click(home['handle'], *point, double=True)
    editor = await_window(pid, lambda win: win['class'].endswith('WindowIcon') and win['handle'] != home['handle'])
    point, _ = await_label(editor['handle'], directory, 'Export', (.5, 0, 1, .15), timeout=60)
    click(editor['handle'], *point)
    dialog = await_window(pid, lambda win: win['title'] == 'Export-' + name)
    _, lines = await_label(dialog['handle'], directory, 'Export to')
    if not text_point(lines, name) or not text_point(lines, 'mp4'):
        raise ValueError('CapCut cần tên file của bản render và Format mp4. Chưa xuất file.')
    disable_cloud_sync(dialog['handle'], lines, directory)
    choose_folder(pid, dialog['handle'], lines, output_dir, directory)
    point, _ = await_label(dialog['handle'], directory, 'Export')
    phase('CapCut đang xuất MP4')
    click(dialog['handle'], *point)
    deadline = time.monotonic() + 7200
    while time.monotonic() < deadline:
        if not any(win['handle'] == dialog['handle'] for win in windows(pid)):
            raise ValueError('Cửa sổ Export đã đóng trước khi xác nhận MP4 hoàn tất.')
        lines = read_window(dialog['handle'], directory)
        saved = any('Video is saved to your desktop or laptop' in line['text'] for line in lines)
        if saved and output.is_file():
            close = text_point(lines, 'Close')
            if not close: raise ValueError('Không nhận diện được nút Close sau khi xuất.')
            click(dialog['handle'], *close)
            # Leave the editor alive. The next installed folder is discovered
            # when project_home returns this editor to Home, using the same PID.
            return output
        time.sleep(2)
    raise ValueError('CapCut chưa hoàn tất sau 2 giờ. Kiểm tra cửa sổ Export trên máy agent.')


def project_home(app, directory, name):
    candidates = [win for win in windows() if win['class'].endswith('WindowIcon')]
    if len(candidates) > 1: raise ValueError('Có nhiều cửa sổ CapCut. Giữ một phiên để render.')
    if not candidates:
        process = subprocess.Popen([app], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        current = await_window(process.pid, lambda win: win['class'].endswith('WindowIcon'))
    else:
        current = candidates[0]
    ctypes.windll.user32.ShowWindow(current['handle'], 9)
    lines = read_window(current['handle'], directory)
    if text_point(lines, 'Create project'):
        if text_point(lines, name): return current
        # CapCut has no exposed refresh command. A native empty editor round
        # trip requests a rescan without editing the live index or restarting.
        click(current['handle'], *text_point(lines, 'Create project'))
        current = await_window(current['pid'], lambda win: win['class'].endswith('WindowIcon') and win['handle'] != current['handle'])
    await_label(current['handle'], directory, 'Export', (.5, 0, 1, .15), timeout=60)
    # Refuse a modal/export in progress rather than closing someone else's job.
    if any(win['title'].startswith('Export-') or win['class'] == '#32770' for win in windows(current['pid'])):
        raise ValueError('CapCut đang mở hộp thoại hoặc xuất video. Hoàn tất thao tác đó trước.')
    ctypes.windll.user32.PostMessageW(current['handle'], 0x10, 0, 0)
    home = await_window(current['pid'], lambda win: win['class'].endswith('WindowIcon') and win['handle'] != current['handle'])
    await_label(home['handle'], directory, 'Create project')
    return home
