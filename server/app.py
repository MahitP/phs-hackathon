"""SkyWindow server: sensor loop + LCD + REST API + dashboard.

    uvicorn server.app:app --host 0.0.0.0 --port 8000

Then open http://<pi-ip>:8000 on any phone on the same network.
"""
import collections
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")  # before modules that read env vars

from fastapi import Body, FastAPI, HTTPException  # noqa: E402
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from device.hw import Smoother, get_sensors
from device.lcd import get_lcd
from ml.features import features
from server import clarity, fires as firewatch, report, store, voice
from server.decide import decide
from server.replay import Replay
from server.sky import LAT, LON, compass, fetch_sky

ROOT = Path(__file__).resolve().parents[1]
AUTO_ANNOUNCE = os.environ.get("SKYWINDOW_AUTO_ANNOUNCE") == "1"
LOG_EVERY = 30  # seconds between history rows

sensors = get_sensors()
lcd = get_lcd()
replay = Replay()
air_smooth, light_smooth = Smoother(0.3), Smoother(0.3)
air_window = collections.deque()  # (t, smoothed air) for the last 60s
state = {"verdict": None}
last_report = {}

try:
    import joblib

    model = joblib.load(ROOT / "ml" / "model.joblib")
    print("[app] loaded ml/model.joblib")
except Exception:
    model = None


def rate_per_min(now, value):
    air_window.append((now, value))
    while air_window and now - air_window[0][0] > 60:
        air_window.popleft()
    t0, v0 = air_window[0]
    return 0.0 if now - t0 < 10 else (value - v0) / ((now - t0) / 60)


def sky_loop():
    while True:
        fetch_sky()
        time.sleep(60)


def fire_loop():
    while True:
        firewatch.fetch_fires(LAT, LON)  # cached for an hour inside
        time.sleep(600)


def sensor_loop():
    last_log, last_key = 0.0, None
    while True:
        try:
            now = time.time()
            air = air_smooth.update(sensors.read_air())
            light = light_smooth.update(sensors.read_light())
            rate = rate_per_min(now, air)
            warming = sensors.warming_up()

            baseline = store.get_setting("air_baseline")
            if not warming and (baseline is None or air < baseline):
                baseline = air  # auto-baseline: cleanest air seen; POST /api/calibrate to reset
                store.set_setting("air_baseline", baseline)

            replay_sky, replay_info = replay.current()
            sky = replay_sky or fetch_sky()
            when = None
            if replay_info:  # sun position for the replayed hour (EDT = UTC-4)
                when = datetime.fromisoformat(sky["time"]).replace(tzinfo=timezone.utc) + timedelta(hours=4)
            light_k = None if replay_info else store.get_setting("light_k")  # live sensor != 2023 sky
            clar = clarity.compute(LAT, LON, sky, light, light_k, when)
            fire_info = None if replay_info else firewatch.summarize(firewatch._cache["fires"], (sky or {}).get("wind_dir"))
            verdict = decide(air, baseline, rate, sky, warming, fire_info)

            event = None
            if model is not None and not warming:
                event = str(model.predict([features(air, baseline, rate, light)])[0])

            # LCD: verdict on line 1, alternate subtitle / numbers on line 2
            if verdict["key"] == "warmup":
                line2 = verdict["lcd2"]
            elif int(now / 4) % 2 == 0:
                line2 = ("REPLAY " + replay_info["clock"]) if replay_info else verdict["lcd2"]
            else:
                aqi = (sky or {}).get("us_aqi")
                line2 = f"SkyAQI{str(aqi if aqi is not None else '?'):>4} In{verdict['stale_index']:>3}"  # 16 chars
            lcd.show(verdict["lcd1"], line2, verdict["rgb"])

            state.update({
                "time": now, "verdict": verdict, "sky": sky, "clarity": clar, "replay": replay_info,
                "event": event, "mock": sensors.mock, "fires": fire_info,
                "indoor": {"air": round(air, 1), "light": round(light, 1), "baseline": baseline,
                           "rate_per_min": round(rate, 1), "stale_index": verdict["stale_index"],
                           "warming_up": warming},
                "wind_compass": compass((sky or {}).get("wind_dir")),
                "sky_age_min": None if not sky or replay_info else round((now - sky["fetched_at"]) / 60, 1),
            })

            if not replay_info and now - last_log > LOG_EVERY:
                last_log = now
                store.log_reading({"air": air, "light": light, "stale_index": verdict["stale_index"],
                                   "rate": rate, "us_aqi": (sky or {}).get("us_aqi"),
                                   "pm2_5": (sky or {}).get("pm2_5"), "aod": (sky or {}).get("aod"),
                                   "verdict": verdict["key"]})
            if AUTO_ANNOUNCE and last_key and verdict["key"] != last_key and verdict["key"] != "warmup":
                threading.Thread(target=announce, kwargs={"speak": True}, daemon=True).start()
            last_key = verdict["key"]
        except Exception as exc:
            print(f"[loop] {exc!r}")
        time.sleep(1)


def announce(speak=False):
    rep = report.generate(state)
    audio = voice.synthesize(rep["text"])
    rep["audio_url"] = f"/api/audio/{audio.name}" if audio else None
    if speak:
        voice.play_local(audio)
    last_report.clear()
    last_report.update(rep, at=time.time())
    return rep


app = FastAPI(title="SkyWindow")


@app.on_event("startup")
def _start():
    threading.Thread(target=sky_loop, daemon=True).start()
    threading.Thread(target=sensor_loop, daemon=True).start()
    threading.Thread(target=fire_loop, daemon=True).start()


@app.get("/api/now")
def api_now():
    if not state["verdict"]:
        raise HTTPException(503, "starting up")
    return {**state, "last_report": last_report or None, "voice_enabled": voice.enabled()}


@app.get("/api/history")
def api_history(minutes: int = 60):
    return store.history(minutes)


@app.post("/api/report")
def api_report(payload: dict = Body(default={})):
    if not state["verdict"]:
        raise HTTPException(503, "starting up")
    return announce(speak=bool(payload.get("speak")))


@app.get("/api/audio/{name}")
def api_audio(name: str):
    path = voice.AUDIO_DIR / Path(name).name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="audio/mpeg")


@app.post("/api/replay")
def api_replay(payload: dict = Body(default={})):
    if payload.get("on", True):
        try:
            replay.start()
        except RuntimeError as exc:
            raise HTTPException(400, str(exc))
    else:
        replay.stop()
    return {"replay": replay.active}


@app.get("/api/fires")
def api_fires():
    fires = firewatch.fetch_fires(LAT, LON)
    if fires is None:
        raise HTTPException(503, "NASA FIRMS unavailable")
    return {"summary": firewatch.summarize(fires, (state.get("sky") or {}).get("wind_dir")), "fires": fires}


@app.post("/api/calibrate")
def api_calibrate(payload: dict = Body(default={})):
    """what=air: current reading becomes the clean-air baseline (do it with the window open).
    what=light: current light reading is matched to the sky's current sunlight."""
    what = payload.get("what", "air")
    ind = state.get("indoor") or {}
    if what == "air":
        store.set_setting("air_baseline", ind.get("air"))
        return {"air_baseline": ind.get("air")}
    k = clarity.calibrate_k(ind.get("light", 0), LAT, LON, (state.get("sky") or {}).get("radiation"))
    if k is None:
        raise HTTPException(400, "not enough daylight to calibrate the light sensor")
    store.set_setting("light_k", k)
    return {"light_k": k}


@app.post("/api/label")
def api_label(payload: dict = Body(...)):
    ind = state.get("indoor") or {}
    store.log_label(payload["label"], ind.get("air"), ind.get("baseline"), ind.get("rate_per_min"),
                    ind.get("light"))
    return {"ok": True}


@app.post("/api/mock/{action}")
def api_mock(action: str):
    if not sensors.mock:
        raise HTTPException(400, "real sensors attached - do it for real!")
    {"spike": sensors.spike, "cover": sensors.cover}[action]()
    return {"ok": True}


app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
