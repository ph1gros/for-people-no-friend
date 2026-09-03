from __future__ import annotations

import io
import os
import re
import threading
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile


SERVICE_ROOT = Path(__file__).resolve().parent
MODEL_ROOT = Path(
    os.environ.get("FPNF_ASR_MODEL_ROOT", SERVICE_ROOT / "models" / "sensevoice")
).resolve()
MODEL_PATH = MODEL_ROOT / "model.int8.onnx"
TOKENS_PATH = MODEL_ROOT / "tokens.txt"
MAX_AUDIO_BYTES = 2 * 1024 * 1024
SUPPORTED_TYPES = {"audio/wav", "audio/x-wav", "audio/wave"}
TAG_PATTERN = re.compile(r"<\|[^|<>]+\|>")
LANGUAGE_MAP = {"zh": "zh", "zh-CN": "zh", "ja": "ja", "ja-JP": "ja"}
PROVIDER = "sherpa-onnx-cpu"

app = FastAPI(title="Local speech recognition", docs_url=None, redoc_url=None)
recognizer_lock = threading.RLock()
recognizers: dict[str, sherpa_onnx.OfflineRecognizer] = {}


def validate_assets() -> None:
    if not MODEL_PATH.is_file() or not TOKENS_PATH.is_file():
        raise RuntimeError("The bundled speech recognition model is incomplete.")


def create_recognizer(language: str) -> sherpa_onnx.OfflineRecognizer:
    validate_assets()
    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=str(MODEL_PATH),
        tokens=str(TOKENS_PATH),
        num_threads=max(1, min(4, os.cpu_count() or 1)),
        sample_rate=16000,
        feature_dim=80,
        provider="cpu",
        language=language,
        use_itn=True,
    )


def get_recognizer(language: str) -> sherpa_onnx.OfflineRecognizer:
    with recognizer_lock:
        recognizer = recognizers.get(language)
        if recognizer is None:
            recognizer = create_recognizer(language)
            recognizers[language] = recognizer
        return recognizer


def decode_wav(audio: bytes) -> tuple[int, np.ndarray]:
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav_file:
            if wav_file.getcomptype() != "NONE" or wav_file.getsampwidth() != 2:
                raise ValueError("Only uncompressed 16-bit PCM WAV is accepted.")
            channels = wav_file.getnchannels()
            if channels not in (1, 2):
                raise ValueError("Only mono or stereo WAV is accepted.")
            sample_rate = wav_file.getframerate()
            if not 8000 <= sample_rate <= 96000:
                raise ValueError("The WAV sample rate is unsupported.")
            frames = wav_file.readframes(wav_file.getnframes())
    except (EOFError, wave.Error) as error:
        raise ValueError("The WAV file is invalid.") from error

    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels == 2:
        samples = samples.reshape(-1, 2).mean(axis=1, dtype=np.float32)
    if samples.size == 0:
        raise ValueError("The WAV file contains no audio.")
    return sample_rate, np.ascontiguousarray(samples)


def recognize(audio: bytes, language: str) -> str:
    sample_rate, samples = decode_wav(audio)
    with recognizer_lock:
        recognizer = get_recognizer(language)
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate, samples)
        recognizer.decode_stream(stream)
        text = stream.result.text
    return TAG_PATTERN.sub("", text).strip()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": "SenseVoiceSmall", "language": "zh-CN"}


@app.get("/ready")
def ready() -> dict[str, str]:
    try:
        get_recognizer("zh")
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail="Local speech recognition is not ready.",
        ) from error
    return {
        "status": "ready",
        "model": "SenseVoiceSmall",
        "language": "zh-CN",
        "provider": PROVIDER,
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(alias="model"),
    language: str = Form(default="zh-CN"),
) -> dict[str, str]:
    if model_name != "SenseVoiceSmall":
        raise HTTPException(status_code=400, detail="Only SenseVoiceSmall is available.")
    recognition_language = LANGUAGE_MAP.get(language)
    if recognition_language is None:
        raise HTTPException(status_code=400, detail="Only Chinese and Japanese are enabled.")
    if file.content_type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=415, detail="Only WAV audio is accepted.")

    audio = await file.read(MAX_AUDIO_BYTES + 1)
    await file.close()
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio is empty or too large.")
    try:
        text = recognize(audio, recognition_language)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="Local speech recognition failed.") from error
    if not text:
        raise HTTPException(status_code=422, detail="No speech was recognized.")
    return {"text": text}
