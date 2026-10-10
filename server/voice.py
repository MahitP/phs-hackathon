"""ElevenLabs text-to-speech for SkyWindow's spoken announcements.

Set ELEVENLABS_API_KEY (and optionally ELEVENLABS_VOICE_ID). Audio is cached by text hash in
data/audio/. If `mpg123` is installed on the Pi and a speaker is connected, play_local() plays it
out loud from the device itself.
"""
import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import requests

AUDIO_DIR = Path(__file__).resolve().parents[1] / "data" / "audio"
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
MODEL_ID = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")


def enabled():
    return bool(os.environ.get("ELEVENLABS_API_KEY"))


def synthesize(text):
    """Return a Path to an mp3 of `text`, or None if ElevenLabs isn't configured/failed."""
    if not enabled():
        return None
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path = AUDIO_DIR / (hashlib.sha1(f"{VOICE_ID}:{text}".encode()).hexdigest()[:16] + ".mp3")
    if path.exists():
        return path
    try:
        r = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}",
            headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"], "Content-Type": "application/json",
                     "Accept": "audio/mpeg"},
            json={"text": text, "model_id": MODEL_ID},
            timeout=30,
        )
        r.raise_for_status()
        path.write_bytes(r.content)
        return path
    except Exception as exc:
        print(f"[voice] ElevenLabs failed: {exc!r}")
        return None


def play_local(path):
    player = shutil.which("mpg123")
    if path and player:
        subprocess.Popen([player, "-q", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
