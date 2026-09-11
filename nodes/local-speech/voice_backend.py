"""Seed-VC local runtime or the already configured local ComfyUI node."""
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse
import uuid


class VoiceConverter:
    def __init__(self, data, directory, progress):
        self.data, self.directory, self.progress = data, directory, progress
        self.seed = Path(data['seedVcDir']).resolve()
        self.module = None
        self.engine = 'Seed-VC' if (self.seed / 'inference.py').exists() else 'ComfyUI SeedVCNode'

    def run(self, source, reference, index):
        if self.engine == 'Seed-VC':
            return self.direct(source, reference, index)
        return self.comfy(source, reference, index)

    def direct(self, source, reference, index):
        import argparse
        import sys
        if self.module is None:
            self.progress('Đang nạp Seed-VC; lần đầu cần tải model')
            os.chdir(self.seed)
            sys.path.insert(0, str(self.seed))
            import inference
            self.module = inference
            load = inference.load_models
            loaded = []
            def once(args):
                if not loaded:
                    loaded.append(load(args))
                return loaded[0]
            inference.load_models = once
        out = self.directory / f'converted-{index}'; out.mkdir(exist_ok=True)
        args = argparse.Namespace(source=str(source), target=str(reference), output=str(out), diffusion_steps=10,
                                  length_adjust=1.0, inference_cfg_rate=.7, f0_condition=False, auto_f0_adjust=False,
                                  semi_tone_shift=0, checkpoint=None, config=None, fp16=False)
        self.module.main(args)
        outputs = list(out.glob('*.wav'))
        if len(outputs) != 1:
            raise RuntimeError('Seed-VC không tạo đúng một audio kết quả.')
        return outputs[0]

    def comfy(self, source, reference, index):
        import requests
        base = self.data['comfyUrl'].rstrip('/')
        # A local AI feature must never silently upload audio to an external URL.
        if urlparse(base).hostname not in ('localhost', '127.0.0.1', '::1'):
            raise RuntimeError('Voice local cần ComfyUI trên localhost hoặc cài Seed-VC local.')
        try:
            response = requests.get(base + '/object_info/SeedVCNode', timeout=5)
            response.raise_for_status()
            if 'SeedVCNode' not in response.json():
                raise ValueError('Thiếu SeedVCNode')
        except Exception as error:
            raise RuntimeError('Chưa có Seed-VC local. Chạy npm run setup:speech, hoặc mở ComfyUI có SeedVCNode trên localhost.') from error
        def upload(file):
            with open(file, 'rb') as handle:
                response = requests.post(base + '/upload/image', files={'image': (f'bcl-{uuid.uuid4()}.wav', handle, 'audio/wav')},
                                         data={'type': 'input', 'overwrite': 'false'}, timeout=60)
            response.raise_for_status()
            result = response.json()
            return '/'.join(filter(None, [result.get('subfolder'), result['name']]))
        graph = {'source': {'class_type': 'LoadAudio', 'inputs': {'audio': upload(source)}},
                 'target': {'class_type': 'LoadAudio', 'inputs': {'audio': upload(reference)}},
                 'voice': {'class_type': 'SeedVCNode', 'inputs': {'source': ['source', 0], 'target': ['target', 0],
                           'diffusion_steps': 10, 'length_adjust': 1.0, 'inference_cfg_rate': .7}},
                 'save': {'class_type': 'SaveAudio', 'inputs': {'audio': ['voice', 0], 'filename_prefix': f'bcl-voice/{uuid.uuid4()}'}}}
        response = requests.post(base + '/prompt', json={'prompt': graph}, timeout=30); response.raise_for_status()
        prompt_id = response.json()['prompt_id']
        for _ in range(1800):
            self.progress(f'Đang đổi giọng đoạn {index+1} bằng Seed-VC')
            response = requests.get(base + '/history/' + prompt_id, timeout=15); response.raise_for_status()
            result = response.json().get(prompt_id, {})
            if result.get('status', {}).get('status_str') == 'error':
                raise RuntimeError('SeedVCNode xử lý thất bại. Kiểm tra ComfyUI.')
            files = result.get('outputs', {}).get('save', {}).get('audio', [])
            if files:
                response = requests.get(base + '/view', params=files[0], timeout=60); response.raise_for_status()
                output = self.directory / f'comfy-{index}.flac'; output.write_bytes(response.content)
                return output
            time.sleep(1)
        raise RuntimeError('Seed-VC quá thời gian 30 phút cho một đoạn.')
