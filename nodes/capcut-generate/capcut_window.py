"""Window-scoped CapCut interaction. No global mouse or keyboard input."""
import ctypes
from ctypes import wintypes as w
import json
from pathlib import Path
import subprocess


def windows(pid=None):
    user = ctypes.windll.user32
    result = []
    @ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
    def visit(handle, _):
        process = w.DWORD(); user.GetWindowThreadProcessId(handle, ctypes.byref(process))
        title, cls = ctypes.create_unicode_buffer(512), ctypes.create_unicode_buffer(256)
        user.GetWindowTextW(handle, title, 512); user.GetClassNameW(handle, cls, 256)
        if user.IsWindowVisible(handle) and (process.value == pid if pid else title.value == 'CapCut'):
            result.append({'handle': handle, 'pid': process.value, 'title': title.value, 'class': cls.value})
        return True
    user.EnumWindows(visit, 0)
    return result


def capture(handle, path):
    from PIL import Image
    user, gdi = ctypes.windll.user32, ctypes.windll.gdi32
    user.SetProcessDPIAware()
    rect = w.RECT(); user.GetWindowRect(handle, ctypes.byref(rect))
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width < 100 or height < 100: raise ValueError('CapCut window is hidden or too small')
    user.GetWindowDC.restype = w.HDC
    gdi.CreateCompatibleDC.argtypes = [w.HDC]; gdi.CreateCompatibleDC.restype = w.HDC
    gdi.CreateCompatibleBitmap.argtypes = [w.HDC, ctypes.c_int, ctypes.c_int]; gdi.CreateCompatibleBitmap.restype = w.HBITMAP
    gdi.SelectObject.argtypes = [w.HDC, w.HGDIOBJ]; gdi.SelectObject.restype = w.HGDIOBJ
    gdi.GetBitmapBits.argtypes = [w.HBITMAP, w.LONG, ctypes.c_void_p]
    gdi.DeleteObject.argtypes = [w.HGDIOBJ]; gdi.DeleteDC.argtypes = [w.HDC]
    user.PrintWindow.argtypes = [w.HWND, w.HDC, w.UINT]; user.ReleaseDC.argtypes = [w.HWND, w.HDC]
    dc = user.GetWindowDC(handle); memory = gdi.CreateCompatibleDC(dc)
    bitmap = gdi.CreateCompatibleBitmap(dc, width, height); previous = gdi.SelectObject(memory, bitmap)
    try:
        if not user.PrintWindow(handle, memory, 2): raise ValueError('Cannot capture CapCut window')
        data = ctypes.create_string_buffer(width * height * 4); gdi.GetBitmapBits(bitmap, len(data), data)
        Image.frombuffer('RGB', (width, height), data, 'raw', 'BGRX', 0, 1).save(path)
    finally:
        gdi.SelectObject(memory, previous); gdi.DeleteObject(bitmap); gdi.DeleteDC(memory); user.ReleaseDC(handle, dc)


def read_window(handle, directory, region=None, threshold=False):
    from PIL import Image, ImageOps
    path = Path(directory) / 'window.png'; capture(handle, path)
    with Image.open(path) as original:
        left, top, right, bottom = region or (0, 0, 1, 1)
        offset_x, offset_y = round(original.width * left), round(original.height * top)
        cropped = original.crop((offset_x, offset_y, round(original.width * right), round(original.height * bottom)))
        scale = min(3, 2500 / max(cropped.size))
        prepared = ImageOps.autocontrast(ImageOps.grayscale(cropped)).resize((round(cropped.width * scale), round(cropped.height * scale)))
        if threshold: prepared = prepared.point(lambda pixel: 255 if pixel > 160 else 0)
        prepared.save(path)
    proc = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                           str(Path(__file__).with_name('window_ocr.ps1')), '-ImagePath', str(path.resolve())],
                          capture_output=True, encoding='utf-8', timeout=30, creationflags=0x08000000)
    if proc.returncode: raise ValueError('Windows OCR: ' + proc.stderr[-1000:])
    lines = json.loads(proc.stdout)
    for line in lines:
        for word in line['words']:
            for key in ('x', 'y', 'width', 'height'): word[key] /= scale
            word['x'] += offset_x; word['y'] += offset_y
    return lines


def click(handle, x, y, double=False):
    user = ctypes.windll.user32
    # PrintWindow includes non-client borders; WM_MOUSE messages use client coords.
    rect = w.RECT(); user.GetWindowRect(handle, ctypes.byref(rect))
    point = w.POINT(rect.left + round(x), rect.top + round(y)); user.ScreenToClient(handle, ctypes.byref(point))
    position = (point.y << 16) | (point.x & 0xffff)
    user.SendMessageW(handle, 0x201, 1, position); user.SendMessageW(handle, 0x202, 0, position)
    if double:
        user.SendMessageW(handle, 0x203, 1, position); user.SendMessageW(handle, 0x202, 0, position)


def text_point(lines, text):
    for line in lines:
        if line['text'].strip().casefold() == text.casefold():
            words = line['words']; return (words[0]['x'] + words[-1]['x'] + words[-1]['width']) / 2, words[0]['y'] + words[0]['height'] / 2
    for line in lines:
        for word in line['words']:
            if word['text'].strip().casefold() == text.casefold(): return word['x'] + word['width'] / 2, word['y'] + word['height'] / 2
    return None
