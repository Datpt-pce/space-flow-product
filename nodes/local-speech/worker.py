"""Local BCL speech jobs. Source media never leaves this machine."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import wave


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    os.replace(temporary, path)


def ffmpeg(arguments):
    result = subprocess.run([os.environ.get('FFMPEG_PATH', 'ffmpeg'), '-hide_banner', '-loglevel', 'error', '-y', *map(str, arguments)],
                            capture_output=True, creationflags=0x08000000 if os.name == 'nt' else 0)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace')[-1500:])


def split_words(words, max_chars=42, max_ms=3500):
    """Sentence-like cues. Keep word timestamps, never overlap adjacent cues."""
    cues, current = [], []
    def flush():
        if not current:
            return
        cues.append({'id': f'cue-{len(cues)+1}', 'startMs': current[0]['startMs'], 'endMs': current[-1]['endMs'],
                     'content': ''.join(w['word'] for w in current).strip(), 'words': list(current),
                     'speaker': 'speaker-1', 'action': 'keep'})
        current.clear()
    for word in words:
        if word['endMs'] <= word['startMs']:
            continue
        if current and (sum(len(w['word']) for w in current) + len(word['word']) > max_chars
                        or word['endMs'] - current[0]['startMs'] > max_ms
                        or word['startMs'] - current[-1]['endMs'] > 500):
            flush()
        current.append(word)
        if word['word'].rstrip().endswith(('.', '!', '?', '。', '！', '？')):
            flush()
    flush()
    # A soft line limit should not leave a final word flashing for 200 ms.
    for index in range(len(cues)-1, 0, -1):
        cue, previous = cues[index], cues[index-1]
        if (cue['endMs']-cue['startMs'] < 700 or len(cue['content']) < 8) and cue['startMs']-previous['endMs'] < 200 \
                and len(previous['content'])+len(cue['content'])+1 <= max_chars+18:
            previous['words'].extend(cue['words'])
            previous['content'] = ''.join(w['word'] for w in previous['words']).strip()
            previous['endMs'] = cue['endMs']
            cues.pop(index)
    return cues


def analyze(data, directory, progress):
    from faster_whisper import WhisperModel
    model_name = os.environ.get('SPEECH_WHISPER_MODEL', 'small')
    cache_key = hashlib.sha256(json.dumps([4, data['sourceHash'], data['language'], model_name], separators=(',', ':')).encode()).hexdigest()
    cache = Path(data['cacheDir']); cache.mkdir(parents=True, exist_ok=True)
    cached = cache / (cache_key + '.json')
    if cached.exists():
        return {**json.loads(cached.read_text(encoding='utf-8')), 'cached': True}
    progress('Đang đọc audio')
    audio = directory / 'analysis.wav'
    ffmpeg(['-i', data['path'], '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio])
    progress('Đang nạp model nhận dạng; lần đầu cần tải model')
    model = WhisperModel(model_name, device='cpu', compute_type='int8', download_root=str(cache / 'models'), cpu_threads=4)
    segments, info = model.transcribe(str(audio), language=None if data['language'] == 'auto' else data['language'],
                                     vad_filter=True, word_timestamps=True, condition_on_previous_text=False, beam_size=5)
    words, previous = [], 0
    for segment in segments:
        progress('Đang nhận dạng lời nói', min(80, round(segment.end * 1000 / max(1, data['durationMs']) * 80)))
        for word in segment.words or []:
            start = max(previous, round(word.start * 1000))
            end = min(round(word.end * 1000), round(data['durationMs']))
            if end > start:
                words.append({'word': word.word, 'startMs': start, 'endMs': end})
                previous = end
    del model
    cues = split_words(words)
    warnings = []
    if cues:
        progress('Đang gợi ý nhóm người nói', 85)
        try:
            assign_speakers(audio, cues)
        except ImportError:
            warnings.append('Chưa có model phân nhóm giọng. Các câu được gán Người nói 1; có thể sửa nhóm thủ công.')
    else:
        warnings.append('Không nhận ra lời nói. Chọn đúng ngôn ngữ hoặc kiểm tra audio nguồn.')
    result = {'cues': cues, 'language': info.language, 'warnings': warnings,
              'model': model_name, 'sourceHash': data['sourceHash'], 'cached': False}
    write_json(cached, result)
    return result


def assign_speakers(audio, cues):
    import numpy as np
    from resemblyzer import VoiceEncoder
    # preprocess_wav trims silences, which would destroy source coordinates.
    # Load without silence trimming for the actual timed slices.
    import soundfile as sf
    wav, rate = sf.read(str(audio), dtype='float32')
    encoder = VoiceEncoder(device='cpu', verbose=False)
    centers, counts = [], []
    for cue in cues:
        start, end = int(cue['startMs'] * rate / 1000), int(cue['endMs'] * rate / 1000)
        segment = wav[start:end]
        if len(segment) < rate * 1.2:
            cue['speaker'] = 'unknown'
            continue
        embedding = encoder.embed_utterance(segment)
        scores = [float(np.dot(embedding, center)) for center in centers]
        best = int(np.argmax(scores)) if scores else -1
        if best < 0 or scores[best] < .72:
            best = len(centers); centers.append(embedding); counts.append(1)
        else:
            center = centers[best] * counts[best] + embedding
            centers[best] = center / np.linalg.norm(center); counts[best] += 1
        cue['speaker'] = f'speaker-{best+1}'


def replace_regions(original, replacements, rate):
    """Only selected sample ranges change. Crossfades stay inside those ranges."""
    import numpy as np
    output = original.copy()
    for start_ms, end_ms, converted in replacements:
        start, end = round(start_ms * rate / 1000), round(end_ms * rate / 1000)
        if not 0 <= start < end <= len(original) or len(converted) != end-start:
            raise ValueError('Audio đổi giọng không khớp số mẫu nguồn.')
        blend = min(round(rate * .02), (end-start)//2)
        converted = converted.astype('float64')
        if blend:
            ramp = np.linspace(0, 1, blend)[:, None]
            converted[:blend] = original[start:start+blend]*(1-ramp) + converted[:blend]*ramp
            converted[-blend:] = converted[-blend:]*(1-ramp) + original[end-blend:end]*ramp
        output[start:end] = np.clip(np.round(converted), -32768, 32767).astype('int16')
    return output


def convert(data, directory, progress):
    import numpy as np
    from voice_backend import VoiceConverter
    progress('Đang chuẩn bị audio gốc và giọng mẫu')
    base, reference = directory / 'original.wav', directory / 'reference.wav'
    # Video and embedded audio can end at slightly different timestamps. Pad
    # only the missing tail so the replacement covers the same source window.
    samples = round(data['durationMs'] * 48)
    ffmpeg(['-i', data['path'], '-vn', '-af', f'aresample=48000,apad,atrim=end_sample={samples}',
            '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', base])
    ffmpeg(['-i', data['referencePath'], '-ss', data['referenceStartMs']/1000, '-t', (data['referenceEndMs']-data['referenceStartMs'])/1000,
            '-vn', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', reference])
    with wave.open(str(base), 'rb') as stream:
        rate = stream.getframerate()
        original = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').reshape(-1, 2).copy()
    converter = VoiceConverter(data, directory, progress)
    # Merge adjacent selected cues to preserve speech context across sentence boundaries.
    regions = []
    for cue in data['speech']['cues']:
        if cue['action'] != 'convert':
            continue
        if regions and abs(regions[-1][1]-cue['startMs']) < .01:
            regions[-1][1] = cue['endMs']
        else:
            regions.append([cue['startMs'], cue['endMs']])
    replacements = []
    for index, (start, end) in enumerate(regions):
        progress(f'Đang đổi giọng đoạn {index+1}/{len(regions)}', round(index/max(1,len(regions))*95))
        source = directory / f'region-{index}.wav'
        ffmpeg(['-i', base, '-ss', start/1000, '-t', (end-start)/1000, '-ac', '1', '-ar', '24000', source])
        converted = converter.run(source, reference, index)
        normalized = directory / f'normalized-{index}.wav'
        ffmpeg(['-i', converted, '-ar', rate, '-ac', '2', '-c:a', 'pcm_s16le', normalized])
        with wave.open(str(normalized), 'rb') as stream:
            count = stream.getnframes()
        desired = round(end*rate/1000) - round(start*rate/1000)
        ratio = count/desired
        if not .5 <= ratio <= 2:
            raise RuntimeError('Model trả thời lượng lệch quá nhiều. Chia lại đoạn voice và thử lại.')
        fitted = directory / f'fitted-{index}.wav'
        ffmpeg(['-i', normalized, '-af', f'atempo={ratio},apad,atrim=end_sample={desired}', '-c:a', 'pcm_s16le', fitted])
        with wave.open(str(fitted), 'rb') as stream:
            samples = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').reshape(-1, 2)
        replacements.append((start, end, samples))
    result = replace_regions(original, replacements, rate)
    output = directory / 'voice.wav'
    with wave.open(str(output), 'wb') as stream:
        stream.setnchannels(2); stream.setsampwidth(2); stream.setframerate(rate); stream.writeframes(result.astype('<i2').tobytes())
    return {'outputPath': str(output), 'outputHash': file_hash(output), 'sourceHash': data['sourceHash'],
            'durationMs': len(result)*1000/rate, 'sampleCount': len(result), 'convertedRegions': len(regions), 'engine': converter.engine}


def main(directory):
    data = json.loads((directory / 'input.json').read_text(encoding='utf-8'))
    def progress(phase, percent=0):
        if (directory / 'cancel').exists():
            raise InterruptedError('Đã hủy tác vụ.')
        write_json(directory / 'state.json', {'id': data['id'], 'status': 'running', 'phase': phase, 'percent': percent, 'updatedAt': time.time()})
    try:
        progress('Đang kiểm tra nội dung nguồn')
        if file_hash(data['path']) != data['sourceHash']:
            raise ValueError('Nội dung nguồn đã đổi. Nhập lại media.')
        if data['task'] == 'convert' and file_hash(data['referencePath']) != data['referenceHash']:
            raise ValueError('Giọng mẫu đã đổi. Chọn lại media.')
        result = analyze(data, directory, progress) if data['task'] == 'analyze' else convert(data, directory, progress)
        progress('Đang xác minh kết quả', 100)
        if file_hash(data['path']) != data['sourceHash']:
            raise ValueError('Nguồn thay đổi trong lúc AI đang chạy.')
        if data['task'] == 'convert' and file_hash(data['referencePath']) != data['referenceHash']:
            raise ValueError('Giọng mẫu thay đổi trong lúc AI đang chạy.')
        write_json(directory / 'state.json', {'id': data['id'], 'status': 'completed', 'percent': 100, **result})
    except Exception as error:
        write_json(directory / 'state.json', {'id': data['id'], 'status': 'cancelled' if isinstance(error, InterruptedError) else 'failed', 'error': str(error)})
        raise


if __name__ == '__main__':
    main(Path(sys.argv[1]).resolve())
