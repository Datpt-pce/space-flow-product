"""Keep setup and the worker under one durable agent job/PID lock."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from setup import runtime_root
from worker import write_json


def run(directory):
    directory = Path(directory)
    state_path = directory / 'state.json'
    def phase(text, status='running'):
        state = json.loads(state_path.read_text(encoding='utf-8'))
        write_json(state_path, {**state, 'status': status, 'phase': text})
    def cancelled():
        return (directory / 'cancel').exists()
    root = runtime_root()
    python = os.environ.get('SPEECH_PYTHON_EXECUTABLE') or str(root / 'runtime' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'))
    flags = {'creationflags': 0x08000000} if os.name == 'nt' else {}
    try:
        if not os.environ.get('SPEECH_PYTHON_EXECUTABLE'):
            phase('Đang kiểm tra / tự cài AI local. Lần đầu có thể mất vài phút…')
            with (directory / 'setup.log').open('a', encoding='utf-8') as log:
                proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name('setup.py')), '--ensure'], stdout=log, stderr=log, **flags)
                # Do not kill pip midway through installing a wheel. Cancellation
                # stops admission to the model worker once setup reaches a safe exit.
                while proc.poll() is None:
                    if cancelled():
                        phase('Đang hoàn tất bước cài đặt trước khi hủy…')
                    time.sleep(.5)
                if proc.returncode:
                    raise RuntimeError('Không cài được AI local. Kiểm tra mạng/dung lượng rồi bấm chạy lại. Chi tiết: ' + str(directory / 'setup.log'))
        if cancelled():
            phase('Đã hủy', 'cancelled')
            return
        phase('AI đã sẵn sàng · đang tải model / xử lý')
        result = subprocess.run([python, str(Path(__file__).with_name('worker.py')), str(directory)], **flags)
        if result.returncode:
            raise RuntimeError('AI worker đã dừng; thử lại tác vụ.')
    except Exception as error:
        state = json.loads(state_path.read_text(encoding='utf-8'))
        write_json(state_path, {**state, 'status': 'failed', 'error': str(error)})


if __name__ == '__main__':
    run(sys.argv[1])
