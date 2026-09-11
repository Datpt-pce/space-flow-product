"""Install BCL speech into an isolated local runtime, without changing system Python."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import urllib.request
import venv
import zipfile
import json
import shutil
import hashlib


def runtime_root():
    repo = Path(__file__).resolve().parents[2]
    return Path(os.environ.get('SF_UPLOADS_DIR') or (str(Path(os.environ['SF_DATA_DIR']) / 'uploads') if os.environ.get('SF_DATA_DIR') else str(repo / 'backend/uploads'))).resolve() / 'bcl-speech'


def ready(python, target):
    if not python.is_file() or not (target / 'inference.py').is_file() or not seed_ready(target):
        return False
    try:
        return subprocess.run([str(python), '-c', 'import faster_whisper, resemblyzer, torch, torchaudio, librosa, transformers, dac, hydra, onnxruntime'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def cuda_available():
    try:
        return subprocess.run(['nvidia-smi', '-L'], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False

SEED_REVISION = '51383efd921027683c89e5348211d93ff12ac2a8'


def seed_ready(target):
    try:
        return (target / '.sf-seed-revision').read_text(encoding='utf-8') == SEED_REVISION
    except OSError:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cpu', action='store_true', help='Install CPU-only PyTorch')
    parser.add_argument('--ensure', action='store_true', help='Reuse an already healthy runtime')
    args = parser.parse_args()
    root = runtime_root(); root.mkdir(parents=True, exist_ok=True)
    runtime = root / 'runtime'
    python = runtime / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    target = Path(os.environ.get('SEED_VC_DIR') or root / 'seed-vc').resolve()
    marker = root / 'runtime-version.json'
    version = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    try:
        installed_version = json.loads(marker.read_text(encoding='utf-8')).get('version') if marker.exists() else None
    except (OSError, ValueError):
        installed_version = 'invalid'
    if args.ensure and ready(python, target):
        # Adopt installations made before automatic setup was introduced.
        if installed_version in (None, version):
            marker.write_text(json.dumps({'version': version}), encoding='utf-8')
            print('BCL speech ready', flush=True)
            return
    if not (3, 10) <= sys.version_info[:2] <= (3, 12):
        if os.name != 'nt':
            raise RuntimeError('BCL speech requires Python 3.10–3.12.')
        # Existing Windows agents can have a newer global Python. Install a
        # compatible per-user interpreter without changing their default Python.
        candidate = Path(os.environ['LOCALAPPDATA']) / 'Programs/Python/Python312/python.exe'
        if not candidate.is_file():
            subprocess.run(['winget', 'install', '--id', 'Python.Python.3.12', '-e', '--scope', 'user', '--silent',
                            '--accept-package-agreements', '--accept-source-agreements'], check=True)
        subprocess.run([str(candidate), str(Path(__file__).resolve()), *sys.argv[1:]], check=True)
        return
    print('Installing local AI. First setup can take several minutes.', flush=True)
    if not python.is_file():
        venv.create(runtime, with_pip=True)
    def pip(*packages):
        subprocess.run([str(python), '-m', 'pip', 'install', *packages], check=True)
    pip('pip>=24', 'setuptools<81', 'wheel')
    pip('torch==2.4.1', 'torchaudio==2.4.1', '--index-url', 'https://download.pytorch.org/whl/' + ('cpu' if args.cpu or not cuda_available() else 'cu121'))
    pip('numpy==1.26.4', 'scipy==1.13.1', 'librosa==0.10.2', 'soundfile==0.12.1', 'webrtcvad-wheels==2.0.14',
        'faster-whisper==1.2.1', 'onnxruntime==1.20.1', 'requests', 'huggingface-hub>=0.28.1,<1', 'transformers==4.46.3',
        'munch==4.0.0', 'einops==0.8.0', 'pyyaml', 'hydra-core==1.3.2', 'accelerate', 'matplotlib', 'descript-audio-codec==1.0.0')
    # webrtcvad-wheels exposes the same module and avoids Windows C++ build tools.
    pip('--no-deps', 'resemblyzer==0.1.4')
    if not seed_ready(target) or not (target / 'inference.py').is_file():
        archive = root / 'seed-vc.zip'
        with urllib.request.urlopen(f'https://codeload.github.com/Plachtaa/seed-vc/zip/{SEED_REVISION}', timeout=60) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
        prefix = f'seed-vc-{SEED_REVISION}/'
        staging = root / 'seed-vc-staging'
        staging.mkdir(exist_ok=True)
        with zipfile.ZipFile(archive) as bundle:
            for entry in bundle.infolist():
                if entry.is_dir() or not entry.filename.startswith(prefix):
                    continue
                dest = (staging / entry.filename[len(prefix):]).resolve()
                if not dest.is_relative_to(staging.resolve()):
                    raise ValueError('Invalid archive path')
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(bundle.read(entry))
        shutil.copytree(staging, target, dirs_exist_ok=True)
        (target / '.sf-seed-revision').write_text(SEED_REVISION, encoding='utf-8')
        archive.unlink()
    subprocess.run([str(python), '-c', 'import faster_whisper, resemblyzer, torch; print("BCL speech ready. CUDA:", torch.cuda.is_available())'], check=True)
    if not ready(python, target):
        raise RuntimeError('Local AI runtime validation failed; retry setup.')
    marker.write_text(json.dumps({'version': version}), encoding='utf-8')
    print('Runtime:', python)
    print('Models download on first analysis/conversion. Audio stays local.')


if __name__ == '__main__':
    main()
