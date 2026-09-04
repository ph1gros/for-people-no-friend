"""Fixed local Genie/Mika service. No model download, path input or file-output API."""
import asyncio
import contextlib
import io
import json
import logging
import os
from pathlib import Path
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError

TOKEN = os.environ.get("FPNF_GENIE_SESSION_TOKEN", "")
DATA_ROOT = Path(os.environ["GENIE_DATA_DIR"]).resolve()
VOICE_ROOT = Path(os.environ["FPNF_GENIE_VOICE_ROOT"]).resolve()
os.environ["HUBERT_MODEL_DIR"] = str(DATA_ROOT / "chinese-hubert-base")
os.environ["SV_MODEL"] = str(DATA_ROOT / "speaker_encoder.onnx")
os.environ["ROBERTA_MODEL_DIR"] = str(DATA_ROOT / "chinese-roberta-wwm-ext-large")
os.environ["English_G2P_DIR"] = str(DATA_ROOT / "English")
os.environ["Chinese_G2P_DIR"] = str(DATA_ROOT / "Chinese")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
MAX_AUDIO = 16 * 1024 * 1024 - 44
engine = None
ready = False
failed = False
lock = asyncio.Lock()


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    character_name: str = Field(pattern="^mika$")
    text: str = Field(min_length=1, max_length=600)
    split_sentence: bool = True


def install_genie_terminal_fix(client):
    """Exclude Genie 2.0.2's EOS-to-zero placeholder from vocoder input.

    That final zero is inserted by t2s_cpu, not a generated speech token.
    Decoding it adds a 40 ms tail for this V2ProPlus voice. Keep every preceding
    token (including valid zeroes); never trim PCM by duration or loudness.
    """
    if getattr(client, '_fpnf_terminal_fix', False):
        return
    decode = client.t2s_cpu

    def decode_speech_tokens(*args, **kwargs):
        tokens = decode(*args, **kwargs)
        if tokens is None:
            return None
        if tokens.ndim != 3 or tokens.shape[:2] != (1, 1) or tokens.shape[-1] < 2 or tokens[0, 0, -1] != 0:
            raise RuntimeError('Unexpected Genie decoder terminal contract')
        return tokens[..., :-1]

    client.t2s_cpu = decode_speech_tokens
    client._fpnf_terminal_fix = True


def load_engine():
    global engine
    if len(TOKEN) < 32 or not DATA_ROOT.is_dir() or not VOICE_ROOT.is_dir():
        raise RuntimeError("Missing managed resources")
    # Environment is fixed before importing Genie; never call its download helpers.
    import genie_tts
    from genie_tts.Core.Inference import tts_client
    install_genie_terminal_fix(tts_client)
    logging.disable(logging.CRITICAL)
    engine = genie_tts
    engine.load_character("mika", str(VOICE_ROOT / "tts_models"), "Japanese")
    prompt = json.loads((VOICE_ROOT / "prompt_wav.json").read_text(encoding="utf-8"))["Normal"]
    audio = (VOICE_ROOT / "prompt_wav" / prompt["wav"]).resolve()
    if not audio.is_relative_to(VOICE_ROOT) or not audio.is_file():
        raise RuntimeError("Invalid managed reference audio")
    engine.set_reference_audio("mika", str(audio), prompt["text"], "Japanese")


async def generate(text: str, split: bool = True) -> bytes:
    output = io.BytesIO()
    try:
        async with asyncio.timeout(60):
            async for chunk in engine.tts_async("mika", text, play=False, split_sentence=split, save_path=None):
                if output.tell() + len(chunk) > MAX_AUDIO:
                    raise RuntimeError("Audio limit")
                output.write(chunk)
        audio = output.getvalue()
        if not audio or len(audio) % 2:
            raise RuntimeError("Empty or invalid PCM")
        return audio
    except BaseException:
        if engine is not None:
            engine.stop()
        raise


async def prepare():
    global ready, failed
    try:
        async with lock:
            await asyncio.to_thread(load_engine)
            await generate("こんにちは。", False)
        ready = True
    except Exception:
        failed = True


@asynccontextmanager
async def lifespan(_app):
    task = asyncio.create_task(prepare())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    if engine is not None:
        engine.stop()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def authorize(request: Request, call_next):
    if request.headers.get("origin") or len(TOKEN) < 32 or not secrets.compare_digest(request.headers.get("x-fpnf-session", ""), TOKEN):
        return Response(status_code=403)
    return await call_next(request)


@app.get("/ready")
async def readiness():
    return {"status": "ready" if ready else "failed" if failed else "starting", "engine": "genie-tts", "voice": "mika"}


@app.post("/tts")
async def tts(request: Request):
    if not ready:
        raise HTTPException(503, "Voice is not ready")
    if lock.locked():
        raise HTTPException(409, "Speech is busy")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 8192:
            raise HTTPException(413, "Request is too large")
    try:
        value = SpeechRequest.model_validate_json(body)
    except ValidationError:
        raise HTTPException(400, "Invalid speech request") from None
    if not value.text.strip():
        raise HTTPException(400, "Empty text")
    async with lock:
        task = asyncio.create_task(generate(value.text, value.split_sentence))
        try:
            while not task.done():
                if await request.is_disconnected():
                    task.cancel()
                    raise HTTPException(499, "Cancelled")
                await asyncio.wait({task}, timeout=0.1)
            return Response(await task, media_type="application/octet-stream")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, "Speech synthesis failed") from None
        finally:
            if not task.done():
                task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
