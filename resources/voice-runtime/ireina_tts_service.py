from __future__ import annotations

import io
import os
import re
import threading
import traceback
import wave
from pathlib import Path

import numpy as np
import onnxruntime
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from style_bert_vits2.tts_model import TTSModel
from style_bert_vits2.constants import Languages
from style_bert_vits2.nlp import onnx_bert_models

os.environ.setdefault("NO_PROXY", "127.0.0.1,localhost")
RUNTIME_ROOT = Path(__file__).resolve().parent
VOICE_ROOT = RUNTIME_ROOT / "voice" / "ireina"
OUTPUT_ROOT = RUNTIME_ROOT / "recent-output"
MODEL_FILE = VOICE_ROOT / "ireina_e100_s16040.onnx"
CONFIG_FILE = VOICE_ROOT / "config.json"
STYLE_FILE = VOICE_ROOT / "style_vectors.npy"

for required_path in (MODEL_FILE, CONFIG_FILE, STYLE_FILE):
    if not required_path.is_file():
        raise RuntimeError(f"Required bundled voice asset is missing: {required_path.name}")


class SpeechRequest(BaseModel):
    model: str
    voice: str
    input: str = Field(min_length=1, max_length=600)
    response_format: str = "wav"
    speed: float = Field(default=0.9, ge=0.25, le=4.0)


app = FastAPI(title="FPNF bundled local TTS", docs_url=None, redoc_url=None)
model_lock = threading.RLock()
model: TTSModel | None = None
TAIL_PADDING_SECONDS = 0.28
BETWEEN_SENTENCE_SILENCE_SECONDS = 0.09
SILENCE_EDGE_SECONDS = 0.04
OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)


def split_japanese_sentences(text: str) -> list[str]:
    segments = [segment.strip() for segment in re.findall(r"[^。！？!?\n]+[。！？!?]*", text)]
    return [segment for segment in segments if segment]


def trim_generated_silence(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    if audio.ndim != 1 or audio.size == 0:
        return audio
    magnitude = np.abs(audio.astype(np.float32))
    peak = float(np.max(magnitude))
    if peak <= 0:
        return audio
    active = np.flatnonzero(magnitude >= max(48.0, peak * 0.003))
    if active.size == 0:
        return audio
    edge = int(sample_rate * SILENCE_EDGE_SECONDS)
    start = max(0, int(active[0]) - edge)
    end = min(audio.size, int(active[-1]) + edge + 1)
    return audio[start:end]


def retain_latest_output(wav_bytes: bytes, text: str) -> None:
    latest_wav = OUTPUT_ROOT / "最近一次.wav"
    previous_wav = OUTPUT_ROOT / "上一次.wav"
    latest_text = OUTPUT_ROOT / "最近一次.txt"
    previous_text = OUTPUT_ROOT / "上一次.txt"
    temporary_wav = OUTPUT_ROOT / "最近一次.wav.tmp"
    temporary_text = OUTPUT_ROOT / "最近一次.txt.tmp"
    temporary_wav.write_bytes(wav_bytes)
    temporary_text.write_text(text, encoding="utf-8")
    if latest_wav.exists():
        os.replace(latest_wav, previous_wav)
    if latest_text.exists():
        os.replace(latest_text, previous_text)
    os.replace(temporary_wav, latest_wav)
    os.replace(temporary_text, latest_text)


def encode_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    normalized = audio
    if normalized.dtype != np.int16:
        normalized = np.clip(normalized, -32768, 32767).astype(np.int16)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(normalized.tobytes())
    return output.getvalue()


def get_model() -> TTSModel:
    global model
    with model_lock:
        if model is None:
            available = onnxruntime.get_available_providers()
            providers = [
                provider
                for provider in ("DmlExecutionProvider", "CPUExecutionProvider")
                if provider in available
            ]
            if not providers:
                raise RuntimeError("No supported ONNX execution provider is available.")
            onnx_bert_models.load_tokenizer(Languages.JP)
            onnx_bert_models.load_model(Languages.JP, onnx_providers=providers)
            model = TTSModel(
                model_path=MODEL_FILE,
                config_path=CONFIG_FILE,
                style_vec_path=STYLE_FILE,
                device="cpu",
                onnx_providers=providers,
            )
            model.load()
        return model


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "voice": "ireina", "language": "ja-JP"}


@app.post("/v1/audio/speech")
def create_speech(request: SpeechRequest) -> Response:
    if request.model != "ireina" or request.voice != "ireina":
        raise HTTPException(status_code=400, detail="Only the bundled ireina voice is available.")
    if request.response_format != "wav":
        raise HTTPException(status_code=400, detail="Only WAV output is available.")
    text = request.input.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text must not be empty.")
    try:
        sentences = split_japanese_sentences(text) or [text]
        with model_lock:
            generated: list[np.ndarray] = []
            sample_rate = 44_100
            for sentence in sentences:
                sample_rate, sentence_audio = get_model().infer(
                    text=sentence,
                    language="JP",
                    style="Neutral",
                    length=1.0 / request.speed,
                    line_split=False,
                )
                generated.append(trim_generated_silence(sentence_audio, sample_rate))
        separator = np.zeros(
            int(sample_rate * BETWEEN_SENTENCE_SILENCE_SECONDS), dtype=generated[0].dtype
        )
        joined: list[np.ndarray] = []
        for index, sentence_audio in enumerate(generated):
            if index > 0:
                joined.append(separator)
            joined.append(sentence_audio)
        audio = np.concatenate(joined)
        audio = np.concatenate(
            (audio, np.zeros(int(sample_rate * TAIL_PADDING_SECONDS), dtype=audio.dtype))
        )
        wav_bytes = encode_wav(audio, sample_rate)
        retain_latest_output(wav_bytes, text)
        return Response(wav_bytes, media_type="audio/wav")
    except HTTPException:
        raise
    except Exception as error:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Local speech generation failed.") from error
