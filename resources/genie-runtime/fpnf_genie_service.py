"""Fixed local Genie voice service. No model download, path input or file-output API."""
import asyncio
import contextlib
import io
import json
import logging
import os
import queue
from pathlib import Path
import secrets
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

TOKEN = os.environ.get("FPNF_GENIE_SESSION_TOKEN", "")
DATA_ROOT = Path(os.environ["GENIE_DATA_DIR"]).resolve()
VOICE_ROOT = Path(os.environ["FPNF_GENIE_VOICE_ROOT"]).resolve()
VOICE_ID = os.environ.get("FPNF_GENIE_VOICE_ID", "mika")
VOICE_LANGUAGES = {"mika": "Japanese", "feibi": "Chinese", "thirtyseven": "English"}
WARMUP_TEXTS = {"mika": "こんにちは。", "feibi": "你好，很高兴见到你。", "thirtyseven": "Hello, it is nice to meet you."}
LANGUAGE_ROOT = Path(os.environ.get("FPNF_GENIE_LANGUAGE_ROOT", str(DATA_ROOT))).resolve()
os.environ["HUBERT_MODEL_DIR"] = str(DATA_ROOT / "chinese-hubert-base")
os.environ["SV_MODEL"] = str(DATA_ROOT / "speaker_encoder.onnx")
os.environ["ROBERTA_MODEL_DIR"] = str(DATA_ROOT / "chinese-roberta-wwm-ext-large")
os.environ["English_G2P_DIR"] = str(LANGUAGE_ROOT / "EnglishG2P")
os.environ["Chinese_G2P_DIR"] = str(LANGUAGE_ROOT / "ChineseG2P")
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
    character_name: str = Field(pattern="^(mika|feibi|thirtyseven)$")
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
    if VOICE_ID not in VOICE_LANGUAGES or len(TOKEN) < 32 or not DATA_ROOT.is_dir() or not VOICE_ROOT.is_dir():
        raise RuntimeError("Missing managed resources")
    if VOICE_ID == "feibi":
        # jieba_fast 0.53 has no CPython 3.12 Windows wheel. Use its original MIT
        # Python implementation with the same public segmentation/posseg API.
        import jieba
        import jieba.posseg
        sys.modules["jieba_fast"] = jieba
        sys.modules["jieba_fast.posseg"] = jieba.posseg
    # Environment is fixed before importing Genie; never call its download helpers.
    import genie_tts
    from genie_tts.Core.Inference import tts_client
    from genie_tts.Core.TTSPlayer import tts_player
    install_genie_terminal_fix(tts_client)
    install_genie_session_fix(tts_player)
    logging.disable(logging.CRITICAL)
    engine = genie_tts
    language = VOICE_LANGUAGES[VOICE_ID]
    engine.load_character(VOICE_ID, str(VOICE_ROOT / "tts_models"), language)
    prompt = json.loads((VOICE_ROOT / "prompt_wav.json").read_text(encoding="utf-8"))["Normal"]
    audio = (VOICE_ROOT / "prompt_wav" / prompt["wav"]).resolve()
    if not audio.is_relative_to(VOICE_ROOT) or not audio.is_file():
        raise RuntimeError("Invalid managed reference audio")
    engine.set_reference_audio(VOICE_ID, str(audio), prompt["text"], language)


def looks_like_inhale(samples, index, frame, ceiling) -> bool:
    """Whether one 10 ms frame carries the acoustic signature of an inhale.

    Measured on the fixed samples in .release/genie-multivoice: a breath sits far
    below the utterance, carries no pitch, and puts its energy well above the
    voiced range without reaching the very high band that unvoiced consonants
    occupy. Every condition has to hold at once, so a quiet voiced tail (low
    centroid), a word onset (too loud) and an English s/f (too much 4 kHz and up)
    each fail on their own.
    """
    import numpy as np
    window = samples[index * frame:(index + 1) * frame].astype(np.float64) / 32768
    if len(window) < frame or float(np.sqrt(np.mean(window * window))) >= ceiling:
        return False
    centered = window - window.mean()
    energy = float((centered * centered).sum())
    if energy < 1e-12:
        return False
    acf = np.correlate(centered, centered, mode='full')[frame - 1:]
    if float(np.max(acf[64:320]) / (acf[0] + 1e-12)) >= .5:
        return False
    spectrum = np.abs(np.fft.rfft(centered * np.hanning(frame))) ** 2
    freqs = np.fft.rfftfreq(frame, 1 / 32000)
    total = float(spectrum.sum()) + 1e-18
    if float((spectrum * freqs).sum() / total) <= 1200:
        return False
    return float(spectrum[freqs >= 4000].sum() / total) < .35


def find_short_pause_breaths(samples, start, end, count, reference, frame):
    """Runs of inhale-like frames inside one pause that is too short for the main gate.

    The 450 ms gate exists so ordinary short gaps are never touched, and it stays.
    But a fast speaker never produces a gap that long: every pause in the fixed
    thirtyseven sample is under 300 ms, so the gate is a no-op for that voice and
    both of its breaths survive. This looks inside the short pauses only, and only
    where the pause is bounded by speech on both sides, keeps the 40 ms guards, and
    demands 80 ms of unbroken inhale-like frames before touching anything.
    """
    if start == 0 or end >= count or end - start < 16:
        return []
    ceiling = reference * .06
    flags = [looks_like_inhale(samples, index, frame, ceiling) for index in range(start + 4, end - 4)]
    spans, index = [], 0
    while index < len(flags):
        if not flags[index]:
            index += 1
            continue
        stop = index
        while stop + 1 < len(flags) and flags[stop + 1]:
            stop += 1
        if stop - index + 1 >= 8:
            spans.append(((start + 4 + index) * frame, (start + 4 + stop + 1) * frame))
        index = stop + 1
    return spans


def suppress_pause_noise(audio: bytes, *, tighten_tail: bool = False,
                         short_pause_breath: bool = False) -> bytes:
    """Attenuate low-level noise in pauses, without cutting speech samples.

    This is a conservative energy gate, not a breath classifier. Quiet clips are
    left untouched. Strong speech keeps its original samples, plus 120 ms before
    and 200 ms after it to protect consonants and word releases. Short gaps stay
    intact. Feibi can shorten the 200 ms guard only for very weak, nonperiodic,
    low-frequency tails in an already established long pause. Voiced releases
    and high-frequency consonants retain the original guard. Thirtyseven can
    additionally reach inside sub-450 ms pauses, but only for runs that satisfy
    every condition in looks_like_inhale. Never change duration, pitch, reference
    audio or model weights.
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

    def attenuate(left, right):
        if right <= left:
            return
        gain[left:right] = .03
        fade = min(800, (right - left) // 2)
        ramp = .03 + .97 * (1 + np.cos(np.linspace(0, np.pi, fade))) / 2
        gain[left:left + fade] = ramp
        gain[right - fade:right] = ramp[::-1]

    for start, end in zip(gaps[::2], gaps[1::2]):
        if end - start < 45:
            if short_pause_breath:
                for left, right in find_short_pause_breaths(
                        samples, start, end, count, reference, frame):
                    attenuate(left, right)
            continue
        left = (start + (20 if start else 0)) * frame
        right = (end - (12 if end < count else 0)) * frame
        if tighten_tail and start and right > left:
            # The reported Feibi breath is inside the old 200 ms guard, about
            # 40 ms after the final vowel. Do not globally lower the speech gate.
            candidate = (start + 4) * frame
            ceiling = min(.004, reference * .03)
            for position in range(candidate, left, frame):
                window = samples[position:position + frame*4].astype(np.float64)/32768
                energy = float(np.mean(window*window))
                if energy < 1e-10:
                    continue
                centered = window-window.mean()
                acf = np.correlate(centered, centered, mode='full')[len(window)-1:]
                periodicity = float(np.max(acf[64:320])/(acf[0]+1e-12))
                spectrum = np.abs(np.fft.rfft(centered*np.hanning(len(window))))**2
                high_frequency = float(spectrum[140:].sum()/(spectrum.sum()+1e-12))
                if energy > ceiling**2 or periodicity >= .5 or high_frequency >= .35:
                    candidate = position + len(window)
            left = min(left, candidate)
        attenuate(left, right)
    return (samples.astype(np.float64) * gain).astype('<i2').tobytes()


async def generate(text: str, split: bool = True) -> bytes:
    output = io.BytesIO()
    try:
        async with asyncio.timeout(60):
            async for chunk in engine.tts_async(VOICE_ID, text, play=False, split_sentence=split, save_path=None):
                if output.tell() + len(chunk) > MAX_AUDIO:
                    raise RuntimeError("Audio limit")
                output.write(chunk)
        audio = output.getvalue()
        if not audio or len(audio) % 2:
            raise RuntimeError("Empty or invalid PCM")
        # Scoped per voice on purpose. Feibi and Mika were measured against the same
        # conditions and their short pauses clear them only narrowly, and their raw
        # pre-gate audio was never captured, so widening this without new evidence
        # would risk a regression on output the user has already accepted.
        return suppress_pause_noise(audio, tighten_tail=VOICE_ID == 'feibi',
                                    short_pause_breath=VOICE_ID == 'thirtyseven')
    except BaseException:
        if engine is not None:
            engine.stop()
        raise


async def prepare():
    global ready, failed
    try:
        async with lock:
            await asyncio.to_thread(load_engine)
            await generate(WARMUP_TEXTS[VOICE_ID], False)
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
    return {"status": "ready" if ready else "failed" if failed else "starting", "engine": "genie-tts", "voice": VOICE_ID}


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
    if value.character_name != VOICE_ID:
        raise HTTPException(400, "Voice does not match this managed service")
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
