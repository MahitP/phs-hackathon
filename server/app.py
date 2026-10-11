"""SkyWindow server: sensor loop + LCD + REST API + dashboard.

    uvicorn server.app:app --host 0.0.0.0 --port 8000

Then open http://<pi-ip>:8000 on any phone on the same network.
"""
import collections
import contextlib
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")  # before modules that read env vars
if os.environ.get("SKYWINDOW_SIM") == "1":
    # SIMULATOR backend: never touch the real sensors/LCD and never write into the live device's database
    os.environ["SKYWINDOW_MOCK"] = "1"
    os.environ.setdefault("SKYWINDOW_DB", str(Path(__file__).resolve().parents[1] / "data" / "sim.db"))

from fastapi import Body, Depends, FastAPI, Header, HTTPException  # noqa: E402
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from device.hw import RollingMin, Smoother, get_sensors
from device.lcd import get_lcd
from ml.features import N_FEATURES, features
from server import clarity, fires as firewatch, report, sim, sky as skydata, store, voice
from server.decide import decide
from server.replay import Replay
from server.sky import LAT, LON, compass

ROOT = Path(__file__).resolve().parents[1]
AUTO_ANNOUNCE = os.environ.get("SKYWINDOW_AUTO_ANNOUNCE") == "1"
TOKEN = os.environ.get("SKYWINDOW_TOKEN") or None  # if set, POST endpoints need X-SkyWindow-Token
LOG_EVERY = 30  # seconds between history rows
RATE_WINDOW = 20  # seconds of history the rise rate is measured over
ANNOUNCE_MIN_GAP = 120  # seconds between automatic announcements (each one costs Gemini + ElevenLabs calls)
REPORT_COOLDOWN = 15  # seconds a report is reused for repeat requests while the verdict is unchanged
MOCK_ACTIONS = ("spike", "cover")

sensors = sim.SimSensors() if sim.ENABLED else get_sensors()
PEER_PORT = os.environ.get("SKYWINDOW_PEER_PORT")  # port of the other backend (live <-> simulator), for the switch link
lcd = get_lcd()
replay = Replay()
air_smooth, light_smooth = Smoother(0.3), Smoother(0.3)
air_window = collections.deque()  # (t, smoothed air) for the last RATE_WINDOW seconds
air_baseline = RollingMin()  # cleanest air in the last 24 h
state = {"verdict": None}
last_report = {}


def check_model(m):
    """Drop a model trained on a different feature vector instead of crashing every tick."""
    if getattr(m, "n_features_in_", N_FEATURES) != N_FEATURES:
        print(f"[app] ml/model.joblib expects {m.n_features_in_} features, not {N_FEATURES} - retrain it")
        return None
    return m


try:
    import joblib

    model = check_model(joblib.load(ROOT / "ml" / "model.joblib"))
    if model is not None:
        print("[app] loaded ml/model.joblib")
except Exception:
    model = None


def rate_per_min(now, value):
    air_window.append((now, value))
    while air_window and now - air_window[0][0] > RATE_WINDOW:
        air_window.popleft()
    t0, v0 = air_window[0]
    return 0.0 if now - t0 < 10 else (value - v0) / ((now - t0) / 60)


def sky_loop():
    while True:
        skydata.fetch_sky()  # cached 10 min, backs off 60 s after a failure
        time.sleep(30)


def fire_loop():
    while True:
        firewatch.fetch_fires(LAT, LON)  # cached for an hour inside
        time.sleep(600)


def sensor_loop():
    last_log, last_key, last_announce, saved_baseline = 0.0, None, 0.0, store.get_setting("air_baseline")
    if saved_baseline is not None:
        air_baseline.update(saved_baseline)
    while True:
        try:
            now = time.time()
            if sim.ENABLED and sim.consume_change():
                air_smooth.value = None  # jump straight to the new scenario's room level
                air_window.clear()
            air = air_smooth.update(sensors.read_air())
            light = light_smooth.update(sensors.read_light())
            rate = rate_per_min(now, air)
            warming = sensors.warming_up()

            if not warming:
                air_baseline.update(air, now)  # POST /api/calibrate to reset
            baseline = air_baseline.value
            if baseline is not None and baseline != saved_baseline:
                saved_baseline = baseline
                store.set_setting("air_baseline", baseline)

            replay_sky, replay_info = replay.current()
            sky = replay_sky or skydata.latest()  # never blocks on the network
            if sim.ENABLED and not replay_info:
                sky = sim.apply_sky(sky)  # real data unless the scenario overrides it
            when = None
            if replay_info:  # sun position for the replayed hour (EDT = UTC-4)
                when = datetime.fromisoformat(sky["time"]).replace(tzinfo=timezone.utc) + timedelta(hours=4)
            light_k = None if replay_info else store.get_setting("light_k")  # live sensor != 2023 sky
            clar = clarity.compute(LAT, LON, sky, light, light_k, when)
            if replay_info:
                # ERA5 sunlight for June 7 2023 barely drops under the smoke (86-96% "clear" at midday),
                # so it would contradict the orange sky; the dashboard shows haze transmission instead.
                clar["model_clarity"] = None
            fire_info = None if replay_info else firewatch.summarize(firewatch._cache["fires"], (sky or {}).get("wind_dir"))
            if sim.ENABLED and not replay_info:
                fire_info = sim.apply_fires(fire_info)
            verdict = decide(air, baseline, rate, sky, warming, fires=fire_info, prev=state["verdict"])

            event = None
            if model is not None and not warming:
                try:
                    sun = clar["sun_elevation"] if not replay_info else clarity.solar_elevation(LAT, LON)
                    event = str(model.predict([features(air, baseline, rate, light, sun)])[0])
                except Exception as exc:
                    print(f"[ml] {exc!r}")

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
                "sim": sim.info() if sim.ENABLED else None, "peer_port": PEER_PORT,
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
            if (AUTO_ANNOUNCE and last_key and verdict["key"] != last_key and verdict["key"] != "warmup"
                    and now - last_announce > ANNOUNCE_MIN_GAP):
                last_announce = now
                threading.Thread(target=announce, kwargs={"speak": True}, daemon=True).start()
            last_key = verdict["key"]
        except Exception as exc:
            print(f"[loop] {exc!r}")
        time.sleep(1)


def announce(speak=False):
    global last_report
    key = state["verdict"]["key"]
    if last_report and last_report.get("verdict_key") == key and time.time() - last_report["at"] < REPORT_COOLDOWN:
        rep = last_report  # repeat request: don't pay for another Gemini + ElevenLabs call
        audio = voice.AUDIO_DIR / Path(rep["audio_url"]).name if rep.get("audio_url") else None
    else:
        rep = report.generate(state)
        audio = voice.synthesize(rep["text"])
        rep = {**rep, "audio_url": f"/api/audio/{audio.name}" if audio else None, "verdict_key": key,
               "at": time.time()}
        last_report = rep  # swap in one step so /api/now never sees a half-written report
    if speak:
        voice.play_local(audio)
    return rep


def require_token(x_skywindow_token: Optional[str] = Header(default=None)):
    if TOKEN and not secrets.compare_digest(x_skywindow_token or "", TOKEN):
        raise HTTPException(401, "SkyWindow token required: open the dashboard as http://<pi-ip>:8000/?token=...")


@contextlib.asynccontextmanager
async def lifespan(_app):
    threading.Thread(target=sky_loop, daemon=True).start()
    threading.Thread(target=sensor_loop, daemon=True).start()
    threading.Thread(target=fire_loop, daemon=True).start()
    yield


app = FastAPI(title="SkyWindow", lifespan=lifespan)
writes = [Depends(require_token)]


@app.middleware("http")
async def revalidate_site_files(request, call_next):
    """Make browsers re-check our own HTML/JS/CSS on every load so an updated Pi never serves a
    stale mix of old and new files; the large vendor/ bundle may still be cached."""
    response = await call_next(request)
    if not request.url.path.startswith(("/api", "/vendor/")):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.get("/api/now")
def api_now():
    if not state["verdict"]:
        raise HTTPException(503, "starting up")
    return {**state, "last_report": last_report or None, "voice_enabled": voice.enabled()}


@app.get("/api/history")
def api_history(minutes: int = 60):
    return store.history(max(1, min(minutes, 24 * 60)))


@app.post("/api/report", dependencies=writes)
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


@app.post("/api/replay", dependencies=writes)
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


@app.post("/api/calibrate", dependencies=writes)
def api_calibrate(payload: dict = Body(default={})):
    """what=air: current reading becomes the clean-air baseline (do it with the window open).
    what=light: current light reading is matched to the sky's current sunlight."""
    what = payload.get("what", "air")
    if what not in ("air", "light"):
        raise HTTPException(400, 'what must be "air" or "light"')
    ind = state.get("indoor") or {}
    if ind.get("air") is None:
        raise HTTPException(503, "no sensor reading yet")
    if what == "air":
        store.set_setting("air_baseline", air_baseline.reset(ind["air"]))
        return {"air_baseline": ind["air"]}
    k = clarity.calibrate_k(ind.get("light", 0), LAT, LON, (skydata.latest() or {}).get("radiation"))
    if k is None:
        raise HTTPException(400, "not enough daylight to calibrate the light sensor")
    store.set_setting("light_k", k)
    return {"light_k": k}


@app.post("/api/label", dependencies=writes)
def api_label(payload: dict = Body(...)):
    label = payload.get("label")
    if not isinstance(label, str) or not 0 < len(label.strip()) <= 32:
        raise HTTPException(400, "label must be a non-empty string of at most 32 characters")
    ind = state.get("indoor") or {}
    store.log_label(label.strip(), ind.get("air"), ind.get("baseline"), ind.get("rate_per_min"),
                    ind.get("light"))
    return {"ok": True}


@app.get("/api/sim")
def api_sim():
    if not sim.ENABLED:
        raise HTTPException(404, "this is the live device; the simulator runs as a separate backend (SKYWINDOW_SIM=1)")
    return sim.info()


@app.post("/api/sim", dependencies=writes)
def api_sim_set(payload: dict = Body(...)):
    if not sim.ENABLED:
        raise HTTPException(404, "this is the live device; scenarios only exist on the simulator")
    try:
        sim.set_scenario(payload.get("scenario"))
    except KeyError:
        raise HTTPException(400, f"unknown scenario; use one of {', '.join(sim.SCENARIOS)}")
    return sim.info()


@app.post("/api/mock/{action}", dependencies=writes)
def api_mock(action: str):
    if action not in MOCK_ACTIONS:
        raise HTTPException(404, f"unknown mock action; use one of {', '.join(MOCK_ACTIONS)}")
    if not sensors.mock:
        raise HTTPException(400, "real sensors attached - do it for real!")
    getattr(sensors, action)()
    return {"ok": True}


app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
