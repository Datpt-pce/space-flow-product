import sys
import json
import os
import re
import mimetypes
import requests
import yt_dlp
from urllib.parse import unquote


def normalize_url(url):
    if 'douyin.com' in url:
        m = re.search(r'modal_id=(\d+)', url)
        if m:
            return f"https://www.douyin.com/video/{m.group(1)}"
    if 'facebook.com' in url:
        m = re.search(r'facebook\.com/\d+/posts/(\d+)', url)
        if m:
            return f"https://www.facebook.com/{m.group(1)}/"
    if 'pin.it/' in url:
        try:
            resp = requests.head(url, allow_redirects=True, timeout=10,
                                 headers={'User-Agent': 'Mozilla/5.0'})
            url = resp.url
        except Exception:
            pass
    return url


def _extract_image_url(html):
    for pattern in [
        r'<meta\s+property=["\']og:image["\']\s+content=["\'](https://[^"\']+)["\']',
        r'<meta\s+content=["\'](https://[^"\']+)["\']\s+property=["\']og:image["\']',
        r'"contentUrl"\s*:\s*"(https://[^"]+)"',
    ]:
        m = re.search(pattern, html)
        if m:
            return re.sub(r'/\d+x/', '/originals/', m.group(1))
    return None


def extract_gdrive_id(url):
    """Trích xuất file ID từ các dạng URL Google Drive phổ biến."""
    m = re.search(r'/file/d/([a-zA-Z0-9_-]+)', url)
    if m:
        return m.group(1)
    m = re.search(r'[?&]id=([a-zA-Z0-9_-]+)', url)
    if m:
        return m.group(1)
    return None


GDRIVE_DOWNLOAD_URL = 'https://drive.google.com/uc?export=download'


def _parse_confirm_form(html):
    action_m = re.search(r'action="([^"]+)"', html)
    if not action_m:
        return None, {}
    action = action_m.group(1).replace('&amp;', '&')
    params = {
        m.group(1): m.group(2)
        for m in re.finditer(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"', html)
    }
    return action, params


def _gdrive_filename(resp, file_id):
    cd = resp.headers.get('content-disposition', '')
    m = re.search(r"filename\*=UTF-8''([^;]+)", cd)
    if m:
        return unquote(m.group(1))
    m = re.search(r'filename="?([^";]+)"?', cd)
    if m:
        return m.group(1)
    ctype = resp.headers.get('content-type', '').split(';')[0].strip()
    ext = mimetypes.guess_extension(ctype) or '.bin'
    return f'gdrive_{file_id}{ext}'


def download_gdrive_file(url, out_dir):
    """Fallback tải file Google Drive công khai (ảnh hoặc file không phải video) bằng requests."""
    file_id = extract_gdrive_id(url)
    if not file_id:
        raise ValueError(f'Không nhận diện được file ID Google Drive: {url}')

    session = requests.Session()
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

    resp = session.get(GDRIVE_DOWNLOAD_URL, params={'id': file_id},
                        headers=headers, timeout=15, stream=True)
    resp.raise_for_status()
    ctype = resp.headers.get('content-type', '')

    if 'text/html' in ctype:
        html = resp.text
        confirm_token = next(
            (v for k, v in session.cookies.items() if k.startswith('download_warning_')), None
        )
        if confirm_token:
            resp = session.get(GDRIVE_DOWNLOAD_URL,
                                params={'id': file_id, 'confirm': confirm_token},
                                headers=headers, timeout=30, stream=True)
        else:
            action, params = _parse_confirm_form(html)
            if action:
                resp = session.get(action, params=params, headers=headers, timeout=30, stream=True)
            elif 'sign in' in html.lower() or 'accounts.google.com' in html:
                raise ValueError(f'File Google Drive cần đăng nhập (không công khai): {url}')
            else:
                raise ValueError(f'File Google Drive không khả dụng hoặc đã bị xoá: {url}')

        resp.raise_for_status()
        if 'text/html' in resp.headers.get('content-type', ''):
            raise ValueError(f'Không thể tải file Google Drive (có thể yêu cầu quyền truy cập): {url}')

    filename = re.sub(r'[\\/:*?"<>|]', '_', _gdrive_filename(resp, file_id))
    file_path = os.path.join(out_dir, filename)
    with open(file_path, 'wb') as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)
    return file_path


def download_pinterest_image(url, out_dir):
    """Fallback tải image-only Pinterest pin bằng requests."""
    headers = {
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/120.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'en-US,en;q=0.9',
    }
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    img_url = _extract_image_url(resp.text)
    if not img_url:
        raise ValueError(f"Không tìm thấy ảnh trong pin: {url}")

    pin_id_m = re.search(r'/pin/(\d+)', url)
    pin_id = pin_id_m.group(1) if pin_id_m else 'unknown'
    ext_m = re.search(r'\.(jpg|jpeg|png|gif|webp)', img_url, re.IGNORECASE)
    ext = (ext_m.group(1).lower() if ext_m else 'jpg').replace('jpeg', 'jpg')

    file_path = os.path.join(out_dir, f'pin_{pin_id}.{ext}')
    img_resp = requests.get(img_url, headers=headers, timeout=30, stream=True)
    img_resp.raise_for_status()
    with open(file_path, 'wb') as f:
        for chunk in img_resp.iter_content(chunk_size=8192):
            f.write(chunk)
    return file_path


class SilentLogger:
    def debug(self, msg): pass
    def info(self, msg): pass
    def warning(self, msg): sys.stderr.write(f"[yt-dlp] {msg}\n")
    def error(self, msg): sys.stderr.write(f"[yt-dlp ERROR] {msg}\n")


def find_by_id(out_dir, video_id):
    """Tìm file đã download bằng video_id trong tên file."""
    if not video_id or not os.path.isdir(out_dir):
        return ''
    matches = [
        os.path.join(out_dir, f)
        for f in os.listdir(out_dir)
        if f'[{video_id}]' in f
        and not (f.endswith('.part') or f.endswith('.ytdl') or f.endswith('.json'))
    ]
    return max(matches, key=os.path.getmtime) if matches else ''


def main():
    payload = json.loads(sys.stdin.read())
    url = normalize_url(payload['url'].strip())
    out_dir = payload['output_dir']
    fmt = payload.get('format', 'best')

    fmt_map = {
        'mp4': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'mp3': 'bestaudio/best',
        'best': 'best',
    }

    base_opts = {
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'logger': SilentLogger(),
    }

    ydl_opts = {
        **base_opts,
        'format': fmt_map.get(fmt, 'best'),
        'outtmpl': os.path.join(out_dir, '%(title).60s [%(id)s].%(ext)s'),
        'nooverwrites': True,
    }
    if fmt == 'mp3':
        ydl_opts['postprocessors'] = [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3'}]

    is_pinterest = 'pinterest.com' in url or 'pin.it' in url
    is_google_drive = 'drive.google.com' in url
    _no_video_kw = ('no video', 'no suitable', 'unsupported url', 'no media')

    def _download_non_video(u):
        if is_pinterest:
            return download_pinterest_image(u, out_dir)
        if is_google_drive:
            return download_gdrive_file(u, out_dir)
        return ''

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        video_id = (info or {}).get('id', '')
        rd = (info or {}).get('requested_downloads', [])
        file_path = rd[0].get('filepath', '') if rd else ''
        if not file_path:
            file_path = find_by_id(out_dir, video_id)

        if not file_path:
            if is_pinterest or is_google_drive:
                file_path = _download_non_video(url)
            else:
                print(json.dumps({'error': 'Không tìm thấy file sau khi tải', 'file_path': ''}))
                return

        print(json.dumps({'file_path': file_path}))

    except Exception as e:
        msg = str(e)
        if (is_pinterest or is_google_drive) and any(k in msg.lower() for k in _no_video_kw):
            try:
                file_path = _download_non_video(url)
                print(json.dumps({'file_path': file_path}))
                return
            except Exception as img_err:
                msg = str(img_err)

        if 'cookies' in msg.lower() or 'login' in msg.lower() or 'logged' in msg.lower():
            msg = f'Cần đăng nhập/cookies: {url}'
        elif 'Private video' in msg:
            msg = f'Video private: {url}'
        elif 'not available' in msg.lower():
            msg = f'Video không khả dụng: {url}'
        print(json.dumps({'error': msg, 'file_path': ''}))


if __name__ == '__main__':
    main()
