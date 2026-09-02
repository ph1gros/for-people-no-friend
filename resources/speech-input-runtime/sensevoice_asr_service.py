from __future__ import annotations

import logging
import os
import re
import sys
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile


SERVICE_ROOT = Path(__file__).resolve().parent
PACKAGE_ROOT = Path(
    os.environ.get("FPNF_ASR_PACKAGE_ROOT", SERVICE_ROOT / "python-packages")
).resolve()
MODEL_ROOT = Path(
    os.environ.get("FPNF_ASR_MODEL_ROOT", SERVICE_ROOT / "models")
).resolve()
TEMP_ROOT = Path(
    os.environ.get("FPNF_ASR_TEMP_ROOT", SERVICE_ROOT / "tmp")
).resolve()
MAX_AUDIO_BYTES = 2 * 1024 * 1024
SUPPORTED_TYPES = {"audio/wav", "audio/x-wav", "audio/wave"}
TAG_PATTERN = re.compile(r"<\|[^|<>]+\|>")

if PACKAGE_ROOT.is_dir():
    sys.path.insert(0, str(PACKAGE_ROOT))
MODEL_ROOT.mkdir(parents=True, exist_ok=True)
TEMP_ROOT.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MODELSCOPE_CACHE", str(MODEL_ROOT / "modelscope"))
os.environ.setdefault("HF_HOME", str(MODEL_ROOT / "huggingface"))
os.environ.setdefault("NO_PROXY", "127.0.0.1,localhost")
logging.getLogger("funasr").setLevel(logging.WARNING)

app = FastAPI(title="Local Chinese speech recognition", docs_url=None, redoc_url=None)
model_lock = threading.RLock()
loaded_model = None
model_provider = "unavailable"


def create_model(device: str):
    from funasr import AutoModel

    return AutoModel(
        model="iic/SenseVoiceSmall",
        device=device,
        disable_update=True,
    )


def get_model():
    global loaded_model, model_provider
    with model_lock:
        if loaded_model is not None:
            return loaded_model
        try:
            loaded_model = create_model("cuda:0")
            model_provider = "cuda:0"
        except Exception:
            print("FPNF_ASR_PROVIDER_FALLBACK cpu", file=sys.stderr, flush=True)
            loaded_model = create_model("cpu")
            model_provider = "cpu"
        return loaded_model


def extract_text(result: object) -> str:
    if not isinstance(result, list) or not result or not isinstance(result[0], dict):
        return ""
    value = result[0].get("text", "")
    if not isinstance(value, str):
        return ""
    return TAG_PATTERN.sub("", value).strip()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": "SenseVoiceSmall", "language": "zh-CN"}


@app.get("/ready")
def ready() -> dict[str, str]:
    try:
        get_model()
    except Exception as error:
        raise HTTPException(status_code=503, detail="Local speech recognition is not ready.") from error
    return {
        "status": "ready",
        "model": "SenseVoiceSmall",
        "language": "zh-CN",
        "provider": model_provider,
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(alias="model"),
    language: str = Form(default="zh-CN"),
) -> dict[str, str]:
    if model_name != "SenseVoiceSmall":
        raise HTTPException(status_code=400, detail="Only SenseVoiceSmall is available.")
    language_map = {"zh": "zh", "zh-CN": "zh", "ja": "ja", "ja-JP": "ja"}
    recognition_language = language_map.get(language)
    if recognition_language is None:
        raise HTTPException(status_code=400, detail="Only Chinese and Japanese are enabled.")
    if file.content_type not in SUPPORTED_TYPES:
        raise HTTPException(status_code=415, detail="Only WAV audio is accepted.")

    audio = await file.read(MAX_AUDIO_BYTES + 1)
    await file.close()
    if len(audio) == 0 or len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio is empty or too large.")
    if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise HTTPException(status_code=400, detail="The WAV file is invalid.")

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=TEMP_ROOT,
            suffix=".wav",
            prefix="utterance-",
            delete=False,
        ) as temporary_file:
            temporary_file.write(audio)
            temporary_path = Path(temporary_file.name)
        with model_lock:
            result = get_model().generate(
                input=str(temporary_path),
                cache={},
                language=recognition_language,
                use_itn=True,
                batch_size_s=60,
            )
        text = extract_text(result)
        if not text:
            raise HTTPException(status_code=422, detail="No speech was recognized.")
        return {"text": text}
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail="Local speech recognition failed.") from error
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
