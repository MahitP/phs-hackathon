"""AI announcement: turns the live state + forecast into one or two spoken sentences for a classroom.

Uses Google Gemini (free key from https://aistudio.google.com) when GEMINI_API_KEY is set;
otherwise falls back to a template so the demo never breaks.
"""
import os

import requests

from server.sky import compass

GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def best_window(sky):
    """Find the cleanest 2-hour stretch in the next 24h of the forecast (lowest mean AQI)."""
    if not sky or not sky.get("forecast"):
        return None
    f = sky["forecast"]
    times, aqi = f["time"], f["us_aqi"]
    now = (sky.get("time") or "")[:13]
    start = next((i for i, t in enumerate(times) if t[:13] >= now), 0)
    best = None
    for i in range(start, min(start + 23, len(times) - 1)):
        if aqi[i] is None or aqi[i + 1] is None:
            continue
        score = (aqi[i] + aqi[i + 1]) / 2
        if best is None or score < best[0]:
            best = (score, times[i], times[i + 1])
    if not best or best[0] > 50:  # only recommend airing out when the air is actually "good"
        return None
    return {"avg_aqi": round(best[0]), "start": best[1], "end": best[2]}


WIND_WORDS = {"N": "north", "NE": "northeast", "E": "east", "SE": "southeast", "S": "south",
              "SW": "southwest", "W": "west", "NW": "northwest", "?": "an unknown direction"}


def _facts(state):
    sky = state.get("sky") or {}
    v = state["verdict"]
    clar = state.get("clarity") or {}
    bw = best_window(sky)
    lines = [
        f"Verdict: {v['label']}",
        f"Reasons: {'; '.join(v['reasons'])}",
        f"Outdoor US AQI: {sky.get('us_aqi')}, PM2.5: {sky.get('pm2_5')} ug/m3, ozone: {sky.get('ozone')} ug/m3",
        f"Smoke haze (aerosol optical depth): {sky.get('aod')} (clear sky ~0.1, smoky > 0.7)",
        f"Wind: {sky.get('wind_speed')} km/h from the {compass(sky.get('wind_dir'))}",
        f"Cloud cover: {sky.get('cloud_cover')}%, UV index: {sky.get('uv_index')}",
        f"Direct sunbeam getting through the haze: {clar.get('haze_transmission')}%",
        f"Indoor stale index: {v['stale_index']}/100 (relative VOC sensor, not AQI)",
    ]
    if bw:
        lines.append(f"Cleanest 2-hour window in the next day: {bw['start'][11:16]}-{bw['end'][11:16]} "
                     f"(avg AQI {bw['avg_aqi']})")
    else:
        lines.append("No clean (AQI <= 50) 2-hour window in the next day's forecast")
    if state.get("replay"):
        lines.append(f"NOTE: this is a REPLAY of {state['replay']['label']}, at {state['replay']['clock']}")
    return "\n".join(lines)


PROMPT = """You are SkyWindow, a device at Princeton High School that tells classrooms whether to open
their windows. Using ONLY the facts below, write a short spoken announcement for a classroom: 1-3
sentences, under 45 words, friendly and clear. Give the window advice first, then the main reason
from the sky (haze/smoke, AQI or wind) and, if given, the best time to air the room out.
No markdown, no emojis, no made-up numbers.

FACTS:
{facts}
"""


def template_report(state):
    sky = state.get("sky") or {}
    v = state["verdict"]
    bw = best_window(sky)
    wind = f"Winds are {sky.get('wind_speed')} kilometers per hour from the {WIND_WORDS[compass(sky.get('wind_dir'))]}"
    advice = {
        "open": "the air outside is cleaner than in here, so open the windows.",
        "either": "inside and outside air are about the same, so windows are your call.",
        "shut": "the sky is hazy with pollution, so please keep the windows shut.",
        "ventilate": "the air in this room just spiked, so ventilate right away.",
        "warmup": "our sensors are still warming up.",
    }[v["key"]]
    text = f"SkyWindow update: {advice} Outdoor air quality index is {sky.get('us_aqi')}. {wind}."
    if bw and v["key"] != "warmup":
        if bw["start"][:13] == (sky.get("time") or "")[:13]:
            text += " Right now is the best time all day to air out."
        else:
            text += f" Best time to air out is around {bw['start'][11:16]}."
    return text


def generate(state):
    facts = _facts(state)
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return {"text": template_report(state), "engine": "template", "facts": facts}
    try:
        r = requests.post(
            GEMINI_URL.format(model=GEMINI_MODEL),
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": PROMPT.format(facts=facts)}]}]},
            timeout=20,
        )
        r.raise_for_status()
        text = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
        return {"text": text, "engine": GEMINI_MODEL, "facts": facts}
    except Exception as exc:
        print(f"[report] Gemini failed: {exc!r}; using template")
        return {"text": template_report(state), "engine": "template (fallback)", "facts": facts}
