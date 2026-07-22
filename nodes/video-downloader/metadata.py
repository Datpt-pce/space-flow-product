import sys
import json
import re
import requests
import yt_dlp

from downloader import normalize_url, _extract_image_url, extract_gdrive_id


def _extract_title(html):
    m = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\']([^"\']+)["\']', html)
    return m.group(1) if m else ''


class SilentLogger:
    def debug(self, msg): pass
    def info(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): pass


def fetch_via_scrape(url):
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
    thumbnail = _extract_image_url(resp.text)
    title = _extract_title(resp.text)
    if not thumbnail:
        raise ValueError('Không tìm thấy thumbnail')
    return {'url': url, 'thumbnail': thumbnail, 'title': title}


def fetch_gdrive_metadata(file_id):
    thumbnail = f'https://drive.google.com/thumbnail?id={file_id}&sz=w400'
    title = ''
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        resp = requests.get(f'https://drive.google.com/file/d/{file_id}/view',
                             headers=headers, timeout=10)
        m = re.search(r'<title>(.*?)</title>', resp.text, re.IGNORECASE | re.DOTALL)
        if m:
            title = re.sub(r'\s*-\s*Google Drive\s*$', '', m.group(1).strip())
    except Exception:
        pass
    return {'thumbnail': thumbnail, 'title': title}


def main():
    payload = json.loads(sys.stdin.read())
    orig_url = payload['url'].strip()
    url = normalize_url(orig_url)
    is_google_drive = 'drive.google.com' in url

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'logger': SilentLogger(),
        'skip_download': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        thumbnail = (info or {}).get('thumbnail', '')
        title = (info or {}).get('title', '')
        if thumbnail:
            print(json.dumps({'url': orig_url, 'thumbnail': thumbnail, 'title': title}))
            return
        raise ValueError('yt-dlp không trả về thumbnail')
    except Exception:
        if is_google_drive:
            file_id = extract_gdrive_id(url)
            if file_id:
                meta = fetch_gdrive_metadata(file_id)
                print(json.dumps({'url': orig_url, 'thumbnail': meta['thumbnail'], 'title': meta['title']}))
                return
        try:
            result = fetch_via_scrape(url)
            result['url'] = orig_url
            print(json.dumps(result))
        except Exception as scrape_err:
            print(json.dumps({'url': orig_url, 'error': str(scrape_err)}))


if __name__ == '__main__':
    main()
