"""SkyWindow SIMULATOR: a second backend that runs next to the live device.

Started with SKYWINDOW_SIM=1 (normally on port 8001, see scripts/sim.py and setup_pi.sh). It runs the
exact same server code as the live device, but:
  - the indoor sensors are simulated (it never touches the Grove ADC, the LCD or any GPIO),
  - it keeps its own database (data/sim.db), so simulated readings never mix with real ones,
  - outside air, weather and NASA fires are the same REAL data as the live device, unless the chosen
    scenario deliberately overrides them (e.g. "smoke outside"). Overridden values are flagged.

That makes every verdict demonstrable on demand even if a sensor, cable or the LCD fails, and it is
always labelled SIMULATOR on the dashboard so it is never mistaken for real readings.
"""
import math
import os
import random
import threading
import time

ENABLED = os.environ.get("SKYWINDOW_SIM") == "1"

# scenarios that set their own sky also set their own fire situation, so they always show what they promise
NO_FIRES = {"available": True, "source": "SIMULATED (no fires in this scenario)", "within_50km": 0, "within_100km": 0,
            "within_300km": 0, "nearest": None, "upwind_count": 0, "upwind_frp_150km": 0.0, "smoke_risk": False,
            "largest_frp": 0}

# indoor profiles: sensor units above the clean-air level (~80); stale index = rise / 250 * 100
SCENARIOS = {
    "live": {
        "label": "Normal classroom, real sky",
        "about": "Fresh-ish classroom air that drifts gently. Outside air and weather are the real live data.",
        "indoor": "classroom",
    },
    "clean_stuffy": {
        "label": "Clean day, stuffy room",
        "about": "The room has gone stale (stale index ~55) while the sky is clean (AQI 22). Expect OPEN THE WINDOW.",
        "indoor": "stuffy",
        "sky": {"us_aqi": 22, "pm2_5": 4.1, "aod": 0.06, "ozone": 52},
        "fires": NO_FIRES,
    },
    "spike": {
        "label": "Chemical spike indoors",
        "about": "Hand sanitizer or a cleaner near the sensor: the reading rises fast. Expect VENTILATE NOW (unless the sky is bad).",
        "indoor": "spike",
    },
    "smoke": {
        "label": "Wildfire smoke outside",
        "about": "Smoke over PHS: AQI 162, PM2.5 76, heavy haze, wind from the NW. Expect KEEP IT SHUT and a red alert.",
        "indoor": "classroom",
        "sky": {"us_aqi": 162, "pm2_5": 76.4, "aod": 1.24, "ozone": 118, "wind_dir": 320, "wind_speed": 16},
        "fires": NO_FIRES,
    },
    "fire": {
        "label": "Fire upwind, air still clean",
        "about": "A sizeable fire upwind of PHS. The room is stuffy and the sky is clean (would be OPEN), but smoke could arrive: expect EITHER WAY and a Fire Watch.",
        "indoor": "stuffy",
        "sky": {"us_aqi": 30, "pm2_5": 6.0, "aod": 0.09, "wind_dir": 300, "wind_speed": 18},
        "fires": {"available": True, "source": "SIMULATED fire scenario", "within_50km": 2, "within_100km": 5,
                  "within_300km": 9, "nearest": {"km": 38.0, "bearing": 300, "date": "simulated", "frp": 85.0,
                                                 "confidence": "high"},
                  "upwind_count": 4, "upwind_frp_150km": 140.0, "smoke_risk": True, "largest_frp": 85.0},
    },
    "warmup": {
        "label": "Sensor warming up",
        "about": "What the device shows in its first 2 minutes after power-on while the gas sensor heats up.",
        "indoor": "classroom",
        "warmup": True,
    },
}

_lock = threading.Lock()
_active = {"key": "live", "since": time.time(), "changed": True}


def set_scenario(key):
    if key not in SCENARIOS:
        raise KeyError(key)
    with _lock:
        _active.update(key=key, since=time.time(), changed=True)


def scenario():
    return SCENARIOS[_active["key"]]


def consume_change():
    """True once after each scenario switch: the server resets its smoothing so the jump to the new
    room level isn't mistaken for a sudden spike (the 'spike' scenario rises on its own)."""
    with _lock:
        changed, _active["changed"] = _active["changed"], False
    return changed


def info():
    s = scenario()
    return {"scenario": _active["key"], "label": s["label"], "about": s["about"], "since": _active["since"],
            "overrides_sky": "sky" in s, "overrides_fires": s.get("fires") not in (None, NO_FIRES),
            "scenarios": [{"key": k, "label": v["label"], "about": v["about"]} for k, v in SCENARIOS.items()]}


def apply_sky(sky):
    """Real sky data, with this scenario's overrides layered on top (and flagged)."""
    over = scenario().get("sky")
    if not over:
        return sky
    base = dict(sky or {})
    base.setdefault("fetched_at", time.time())
    return {**base, **over, "sim_override": True}


def apply_fires(fire_info):
    return scenario().get("fires", fire_info)


class SimSensors:
    """Simulated Grove air + light sensors following the active scenario. Never touches hardware."""

    mock = True  # also enables the dashboard's mock buttons
    sim = True

    def __init__(self):
        self.started = time.time()
        self.spike_until = 0.0
        self.cover_until = 0.0

    # dashboard mock buttons still work on top of any scenario
    def spike(self, seconds=20):
        self.spike_until = time.time() + seconds

    def cover(self, seconds=10):
        self.cover_until = time.time() + seconds

    def read_air(self):
        now = time.time()
        t = now - _active["since"]
        profile = scenario()["indoor"]
        if profile == "stuffy":
            rise = 138 + 6 * math.sin(t / 30)
        elif profile == "spike":
            # flat for 2 s, then a fast rise to +320 over ~25 s, held, then slowly easing off after 90 s
            rise = 15 if t < 2 else min(320, (t - 2) * 13) if t < 90 else max(60, 320 - (t - 90) * 2)
        else:  # classroom: gentle drift, stale index ~4-14
            rise = 22 + 13 * math.sin(2 * math.pi * t / 600)
        if now < self.spike_until:
            rise += 300 * math.sin(math.pi * min(1.0, (self.spike_until - now) / 20))
        return 80 + rise + random.uniform(-2, 2)

    def read_light(self):
        if time.time() < self.cover_until:
            return random.uniform(5, 15)
        lt = time.localtime()
        daylight = max(0.0, math.sin(math.pi * (lt.tm_hour + lt.tm_min / 60 - 6.5) / 13))
        return 40 + 650 * daylight + random.uniform(-8, 8)

    def warming_up(self):
        return bool(scenario().get("warmup"))
