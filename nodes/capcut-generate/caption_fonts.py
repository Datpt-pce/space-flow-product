"""Resolve installed fonts by family, without treating a user font name as a path."""
import os
import subprocess
from pathlib import Path
from functools import lru_cache
from PIL import ImageFont


@lru_cache(maxsize=128)
def resolve_font(family='Arial'):
    override = os.environ.get('SF_CAPTION_FONT')
    if override and Path(override).is_file():
        return override
    if os.name == 'nt':
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, r'SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts') as key:
                    for i in range(winreg.QueryInfoKey(key)[1]):
                        name, filename, _ = winreg.EnumValue(key, i)
                        names = name.replace(' (TrueType)', '').replace(' (OpenType)', '').split(' & ')
                        if family.casefold() not in [n.casefold() for n in names]:
                            continue
                        for root in (Path(os.environ.get('WINDIR', 'C:/Windows'))/'Fonts', Path(os.environ.get('LOCALAPPDATA', ''))/'Microsoft/Windows/Fonts'):
                            candidate = root / filename
                            if candidate.is_file():
                                return str(candidate)
            except OSError:
                continue
        fallback = Path(os.environ.get('WINDIR', 'C:/Windows'))/'Fonts/arial.ttf'
    else:
        result = subprocess.run(['fc-match', '-f', '%{file}', '--', family], capture_output=True, text=True, timeout=15, check=True)
        if Path(result.stdout).is_file():
            return result.stdout
        fallback = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    if family != 'Arial':
        raise ValueError('Font chưa được cài trên agent: ' + family)
    if not fallback.is_file():
        raise ValueError('Không tìm thấy font captions trên agent.')
    return str(fallback)


def text_width(content, font_path, size):
    font = ImageFont.truetype(font_path, max(1, round(size*4)))
    return max((font.getlength(line)/4 for line in content.split('\n')), default=0)
