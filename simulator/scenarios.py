"""Scenarios and the simulated sensors for the SkyWindow backup backend (see simulator/app.py).

Nothing in server/ or device/ imports this file. The backup runs as its own process with its own
database, so its values can never reach the Raspberry Pi backend or its stored readings.

Indoor readings come from the physics model in simulator/room.py, so they always change smoothly.
Outside air, weather and NASA fires are the same real data as the Pi backend, unless an outside
preset below deliberately overrides them.
"""
import threading
import time

from simulator.room import EVENTS, RoomModel

ROOM = RoomModel(mode="auto")

# presets that set their own sky also set their own fire situation, so they always show what they promise
NO_FIRES = {"available": True, "source": "scenario (no fires)", "within_50km": 0, "within_100km": 0,
            "within_300km": 0, "nearest": None, "upwind_count": 0, "upwind_frp_150km": 0.0, "smoke_risk": False,
            "largest_frp": 0}

SCENARIOS = {
    "live": {
        "label": "Real sky, school-day room",
        "about": "Outside air, weather and fires are the real live data. The room follows today's PHS bell schedule, in real time.",
        "room": "auto",
        "speed": 1,
    },
    "clean_stuffy": {
        "label": "Clean day, stuffy room",
        "about": "Clean sky (AQI 22) and a full classroom with the windows shut. With air this clean outside, SkyWindow "
                 "says OPEN THE WINDOW straight away; as CO2 builds, the reason changes to 'your room is staler than the sky'.",
        "room": "class",
        "sky": {"us_aqi": 22, "pm2_5": 4.1, "aod": 0.06, "ozone": 52},
        "fires": NO_FIRES,
    },
    "moderate_stuffy": {
        "label": "Moderate sky, class in session",
        "about": "Moderate sky (AQI 72) and a full classroom with the windows shut, fast-forwarded 30x. EITHER WAY while the "
                 "room is fresh; once CO2 is ~1,000 ppm above the room's cleanest air today (stale index 40, ~40 class-minutes) "
                 "the room is worse than the sky and it flips to "
                 "OPEN THE WINDOW. Press 'Window open' to watch it air out and go back to EITHER WAY.",
        "room": "class",
        "speed": 30,
        "sky": {"us_aqi": 72, "pm2_5": 21.5, "aod": 0.18, "ozone": 74},
        "fires": NO_FIRES,
    },
    "spike": {
        "label": "Chemical spike indoors",
        "about": "Hand sanitizer right next to the sensor: the reading surges within ~20 s, so VENTILATE NOW. As the vapour "
                 "clears it steps down (OPEN THE WINDOW while the room is still stale under a clean or moderate sky), then "
                 "back to normal in a few minutes. Under a smoky sky it stays KEEP IT SHUT and suggests a purifier instead.",
        "event": "sanitizer",
    },
    "smoke": {
        "label": "Wildfire smoke outside",
        "about": "Smoke over PHS: AQI 162, PM2.5 76, heavy haze, wind from the NW. Expect KEEP IT SHUT and a red alert.",
        "sky": {"us_aqi": 162, "pm2_5": 76.4, "aod": 1.24, "ozone": 118, "wind_dir": 320, "wind_speed": 16},
        "fires": NO_FIRES,
    },
    "fire": {
        "label": "Fire upwind, air still clean",
        "about": "A sizeable fire upwind of PHS with clean air for now. A stuffy room would normally mean OPEN, but smoke "
                 "could arrive: expect EITHER WAY and a Fire Watch.",
        "room": "class",
        "sky": {"us_aqi": 30, "pm2_5": 6.0, "aod": 0.09, "wind_dir": 300, "wind_speed": 18},
        "fires": {"available": True, "source": "scenario", "within_50km": 2, "within_100km": 5,
                  "within_300km": 9, "nearest": {"km": 38.0, "bearing": 300, "date": "scenario", "frp": 85.0,
                                                 "confidence": "high"},
                  "upwind_count": 4, "upwind_frp_150km": 140.0, "smoke_risk": True, "largest_frp": 85.0},
    },
    "warmup": {
        "label": "Sensor warming up",
        "about": "What the device shows in its first 2 minutes after power-on while the gas sensor heats up.",
        "warmup": True,
    },
}

_lock = threading.Lock()
_active = {"key": "live", "since": time.time()}


def set_scenario(key):
    if key not in SCENARIOS:
        raise KeyError(key)
    s = SCENARIOS[key]
    with _lock:
        _active.update(key=key, since=time.time())
    ROOM.clear_events()                   # each preset starts without the last one's leftover indoor events
    if s.get("room") or s.get("speed"):
        ROOM.set_mode(s.get("room"), s.get("speed"))  # the room drifts there naturally (CO2 mass balance)
    if s.get("event"):
        ROOM.trigger(s["event"], "near")  # a real-time pulse on top of the current room


def scenario():
    return SCENARIOS[_active["key"]]


def info():
    s = scenario()
    return {"scenario": _active["key"], "label": s["label"], "about": s["about"], "since": _active["since"],
            "overrides_sky": "sky" in s, "overrides_fires": s.get("fires") not in (None, NO_FIRES),
            "scenarios": [{"key": k, "label": v["label"], "about": v["about"]} for k, v in SCENARIOS.items()],
            "events": [{"key": k, "label": v["label"], "basis": v["basis"]} for k, v in EVENTS.items()],
            "room": ROOM.info()}


def apply_sky(sky):
    """Real sky data, with this preset's overrides layered on top (and flagged)."""
    over = scenario().get("sky")
    if not over:
        return sky
    base = dict(sky or {})
    base.setdefault("fetched_at", time.time())
    return {**base, **over, "sim_override": True}


def apply_fires(fire_info):
    return scenario().get("fires", fire_info)


class RealTimeTrend:
    """Keeps the server's rise-rate ("rising fast") rule at real-time pace while the room is fast-forwarded.

    The server smooths the air reading with an EMA once per tick before measuring its rise, so the same EMA
    is applied to the room's fast-forward offset: subtracting the raw offset would let the smoothing lag
    show up as a fake rise whenever the CO2 trend turns (e.g. opening the window at 30x)."""

    def __init__(self, room=None, alpha=0.3):
        self.room, self.alpha, self.ema = room or ROOM, alpha, None

    def adjust(self, smoothed_air):
        ff = self.room.ff_offset
        self.ema = ff if self.ema is None else self.alpha * ff + (1 - self.alpha) * self.ema
        return smoothed_air - self.ema


class SimSensors:
    """The backup's Grove air + light sensors, read from the room model. Never touches hardware."""

    mock = True       # keeps the dashboard's test buttons working
    feed = "backup"   # the dashboard labels this room reading "BACKUP FEED"
    offline = False
    error = None

    def __init__(self, room=None):
        self.room = room or ROOM
        self.started = time.time()

    # the dashboard's existing test buttons map onto real events
    def spike(self, seconds=20):
        self.room.trigger("sanitizer", "near")

    def cover(self, seconds=10):
        self.room.trigger("cover")

    def read_air(self):
        return self.room.read_air()

    def read_light(self):
        return self.room.read_light()

    def warming_up(self):
        return bool(scenario().get("warmup"))
