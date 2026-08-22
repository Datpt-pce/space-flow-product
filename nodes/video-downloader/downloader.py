import sys
import json
import os
import re
import requests
import yt_dlp
import gdown


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
    """Trích xuất file ID từ các dạng URL Google Drive phổ biến (dùng cho metadata.py)."""
    m = re.search(r'/file/d/([a-zA-Z0-9_-]+)', url)
    if m:
        return m.group(1)
    m = re.search(r'[?&]id=([a-zA-Z0-9_-]+)', url)
    if m:
        return m.group(1)
    return None


def download_gdrive_file(url, out_dir):
    """Tải file Google Drive công khai bằng gdown (tự xử lý trang xác nhận virus-scan/redirect)."""
    try:
        file_path = gdown.download(url=url, output=out_dir + os.sep, quiet=True)
    except Exception as e:
        raise ValueError(
            f"Tải Google Drive lỗi: {e} — nếu không phải do quyền chia sẻ, kiểm tra lại "
            f"link có phải link file (không phải folder) và chế độ 'Anyone with the link': {url}"
        )
    if not file_path:
        raise ValueError(
            f"File Google Drive yêu cầu đăng nhập hoặc không công khai — kiểm tra lại chế độ "
            f"chia sẻ 'Anyone with the link' của file: {url}"
        )
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

    if is_google_drive:
        try:
            file_path = download_gdrive_file(url, out_dir)
            print(json.dumps({'file_path': file_path}))
        except Exception as e:
            print(json.dumps({'error': str(e), 'file_path': ''}))
        return

    def _download_non_video(u):
        if is_pinterest:
            return download_pinterest_image(u, out_dir)
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
            if is_pinterest:
                file_path = _download_non_video(url)
            else:
                print(json.dumps({'error': 'Không tìm thấy file sau khi tải', 'file_path': ''}))
                return

        print(json.dumps({'file_path': file_path}))

    except Exception as e:
        msg = str(e)
        if is_pinterest and any(k in msg.lower() for k in _no_video_kw):
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
