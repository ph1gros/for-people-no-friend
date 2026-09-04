"""Fixed local Genie/Mika service. No model download, path input or file-output API."""
import asyncio
import contextlib
import io
import json
import logging
import os
import queue
from pathlib import Path
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

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


def install_genie_session_fix(player):
    """Discard cancelled work after joining workers, before any new session.

    Genie 2.0.2 start_session starts workers before clearing their queues. After
    stop(), a restarted worker can consume a cancelled sentence before that clear.
    Drain only the stopped player's queues; never drop text from an active session.
    """
    if getattr(player, '_fpnf_session_fix', False):
        return
    stop = player.stop

    def stop_and_discard_pending():
        stop()
        with player._api_lock:
            for pending in (player._text_queue, player._audio_queue):
                while True:
                    try:
                        pending.get_nowait()
                    except queue.Empty:
                        break

    player.stop = stop_and_discard_pending
    player._fpnf_session_fix = True


def load_engine():
    global engine
    if len(TOKEN) < 32 or not DATA_ROOT.is_dir() or not VOICE_ROOT.is_dir():
        raise RuntimeError("Missing managed resources")
    # Environment is fixed before importing Genie; never call its download helpers.
    import genie_tts
    from genie_tts.Core.Inference import tts_client
    from genie_tts.Core.TTSPlayer import tts_player
    install_genie_terminal_fix(tts_client)
    install_genie_session_fix(tts_player)
    logging.disable(logging.CRITICAL)
    engine = genie_tts
    engine.load_character("mika", str(VOICE_ROOT / "tts_models"), "Japanese")
    prompt = json.loads((VOICE_ROOT / "prompt_wav.json").read_text(encoding="utf-8"))["Normal"]
    audio = (VOICE_ROOT / "prompt_wav" / prompt["wav"]).resolve()
    if not audio.is_relative_to(VOICE_ROOT) or not audio.is_file():
        raise RuntimeError("Invalid managed reference audio")
    engine.set_reference_audio("mika", str(audio), prompt["text"], "Japanese")


def suppress_pause_noise(audio: bytes) -> bytes:
    """Attenuate low-level noise in long pauses, without cutting speech samples.

    This is a conservative energy gate, not a breath classifier. Quiet clips are
    left untouched. Strong speech keeps its original samples, plus 120 ms before
    and 200 ms after it to protect consonants and word releases. Short gaps stay
    intact. Never change duration, pitch, reference audio or model weights.
    """
    import numpy as np
    if len(audio) % 2 or len(audio) < 32000:
        return audio
    samples = np.frombuffer(audio, dtype='<i2')
    frame = 320  # 10 ms at the fixed 32 kHz Genie output rate
    count = len(samples) // frame
    windows = samples[:count * frame].reshape(count, frame).astype(np.float64) / 32768
    rms = np.sqrt(np.mean(windows * windows, axis=1))
    reference = float(np.percentile(rms, 90))
    if reference < .02:
        return audio
    threshold = max(.012, min(.04, reference * .12))
    strong = rms >= threshold
    # Isolated spikes are not sufficient evidence of speech.
    anchors = np.zeros(count, dtype=bool)
    edges = np.flatnonzero(np.diff(np.r_[False, strong, False]))
    for start, end in zip(edges[::2], edges[1::2]):
        if end - start >= 4:
            anchors[start:end] = True
    if not anchors.any():
        return audio
    gaps = np.flatnonzero(np.diff(np.r_[False, ~anchors, False]))
    gain = np.ones(len(samples), dtype=np.float64)
    for start, end in zip(gaps[::2], gaps[1::2]):
        if end - start < 45:
            continue
        left = (start + (20 if start else 0)) * frame
        right = (end - (12 if end < count else 0)) * frame
        if right <= left:
            continue
        gain[left:right] = .03
        fade = min(800, (right - left) // 2)
        ramp = .03 + .97 * (1 + np.cos(np.linspace(0, np.pi, fade))) / 2
        gain[left:left + fade] = ramp
        gain[right - fade:right] = ramp[::-1]
    return (samples.astype(np.float64) * gain).astype('<i2').tobytes()


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
        return suppress_pause_noise(audio)
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


class SessionAuthorization:
    """Preserve the ASGI receive channel so synthesis can observe disconnects.

    BaseHTTPMiddleware wraps receive in a cancellation scope, which can hide a
    queued http.disconnect from Request.is_disconnected(). Authentication must
    inspect headers without consuming or wrapping the request body/channel.
    """
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope['type'] == 'http':
            headers = Headers(scope=scope)
            if headers.get('origin') or len(TOKEN) < 32 or not secrets.compare_digest(headers.get('x-fpnf-session', ''), TOKEN):
                await Response(status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SessionAuthorization)


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
