"""
Локальный STT-сервер на faster-whisper.

Слушает микрофон, режет речь на фразы по паузам и печатает каждую распознанную
фразу в stdout как JSON-строку: {"type":"line","text":"...","lang":"ru"}.
Электрон читает stdout и показывает расшифровку. Ничего не отправляется в сеть —
распознавание идёт локально.
"""

import sys
import json
import queue

import numpy as np


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


try:
    import sounddevice as sd
    from faster_whisper import WhisperModel
except Exception as e:  # noqa: BLE001
    emit({"type": "error", "text": "Не установлены зависимости STT: " + str(e)})
    sys.exit(1)

SAMPLE_RATE = 16000
FRAME_SEC = 0.03
BLOCK = int(SAMPLE_RATE * FRAME_SEC)
SILENCE_HANG = 0.7        # сек тишины, чтобы закрыть фразу
MIN_SPEECH = 0.4          # мин. длина фразы (сек) для распознавания
ENERGY_THRESHOLD = 0.008  # порог RMS; подстрой под свой микрофон
MODEL_SIZE = "small"      # "medium" / "large-v3" — точнее, но медленнее и тяжелее

model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

audio_q = queue.Queue()


def on_audio(indata, _frames, _time, _status):
    audio_q.put(indata[:, 0].copy())


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))) + 1e-12)


def transcribe(audio):
    # language=None → автоопределение (умеет и русский, и английский)
    segments, info = model.transcribe(audio, language=None, beam_size=1, vad_filter=True)
    text = "".join(s.text for s in segments).strip()
    if text:
        emit({"type": "line", "text": text, "lang": info.language})


def main():
    buf = []
    speaking = False
    silence = 0.0

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                        blocksize=BLOCK, callback=on_audio):
        emit({"type": "ready"})
        while True:
            block = audio_q.get()
            if rms(block) > ENERGY_THRESHOLD:
                speaking = True
                silence = 0.0
                buf.append(block)
            elif speaking:
                buf.append(block)
                silence += FRAME_SEC
                if silence >= SILENCE_HANG:
                    audio = np.concatenate(buf)
                    buf, speaking, silence = [], False, 0.0
                    if len(audio) / SAMPLE_RATE >= MIN_SPEECH:
                        try:
                            transcribe(audio)
                        except Exception as e:  # noqa: BLE001
                            emit({"type": "error", "text": "Ошибка распознавания: " + str(e)})


if __name__ == "__main__":
    main()
