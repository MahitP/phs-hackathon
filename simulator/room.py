"""Physics-based classroom model behind the backup backend's indoor readings (simulator only).

Produces what the Grove sensors on a Grove Base HAT would print (grove.py ADC.read, 0-1000):
  air   - Grove Air Quality v1.3 (Winsen MP503 metal-oxide VOC sensor) at the windowsill
  light - Grove Light Sensor v1.2 (LS06-S phototransistor) facing the window

Everything changes continuously - switching modes or triggering an event never makes the reading jump:
  * CO2 follows a single-zone mass balance  dC/dt = G*N/V - ACH*(C - C_out)  (occupancy + ventilation),
    and the MP503's response to people (bio-effluent VOCs, humidity) follows CO2.
  * Events (sanitizer, breath, marker, cleaner) have two parts: a vapour plume that reaches the sensor in
    seconds if the source is close (diluting roughly with distance squared), and the share that mixes into
    the room air, arriving over a few minutes and cleared at the current ventilation rate. Across the room,
    only the mixed share reaches the sensor, so it rises slowly instead of spiking.
  * The metal-oxide sensor's response flattens out at high concentrations, so stacked events saturate
    instead of adding up past the ADC's range.
  * "speed" fast-forwards only the slow room processes (CO2 build-up / clearing), so a 50-minute class
    can be shown in about two minutes; events (and their clearing from the room air) always run in real
    time. The trend the server measures (its "rising fast" spike rule) is kept at real-time pace via
    ff_offset, so fast-forwarding a filling classroom never looks like a chemical spike.

Research basis (see EVENTS[...]["basis"] and the README section "Backup backend"):
  sensor: Seeed wiki (indoor readings ~138-141 on a Pi), Winsen MP503 datasheet (10-1000 ppm alcohol),
          Winsen ZP01-MP503 (response <=20 s, recovery <=60 s, warm-up <=3 min)
  room:   classroom CO2 studies (school-hour averages 657-2,235 ppm, peaks ~3,000; opening windows -~1,000 ppm)
"""
import math
import random
import threading
import time
from datetime import datetime

from server import clarity

try:  # Princeton time for the bell schedule; Windows Python may lack the tz database, so fall back to local time
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:
    TZ = None
LAT, LON = 40.3587, -74.656

ROOM_V = 200.0          # m3 (about 70 m2 x 2.9 m)
CLASS_SIZE = 26         # 25 students + teacher
GEN_LPS = 0.0050        # L/s CO2 per seated person
C_OUT = 425.0           # ppm outdoors
ACH = {"closed": 1.2, "door": 3.0, "window": 7.0}   # air changes per hour
AIR_BASE = 132.0        # MP503 on a Grove Base HAT reads ~132-141 in ordinary indoor air (Seeed wiki)
# ADC units per +100 ppm CO2 of people (bio-effluent VOCs + humidity) - assumption, set so a closed classroom
# reaches the server's "stale" index (40 = +100 units) ~1,000 ppm above its cleanest air (~1,400-1,700 ppm),
# around where classroom guidance says to air out
K_BIO = 10.0
NOISE = 2.0
SATURATE = 800.0        # MOS response flattens out: units above clean air approach this (ADC tops out at 1000)
MIX_S = 240.0           # s for vapour released in the room to mix through ~200 m3 of still classroom air

# distance from the sensor -> (share of the near-field plume that reaches it, how much later it peaks)
# the plume dilutes roughly with distance squared (~0.3 m -> ~1 m is about a tenth); across the room only
# the share that mixes into the room air reaches the sensor
DISTANCE = {"near": (1.0, 1.0), "arm": (0.1, 2.0), "room": (0.0, 1.0)}

EVENTS = {
    "sanitizer": {
        "label": "Hand sanitizer",
        "peak": 650, "rise_s": 22, "fall_s": 45, "tail": 0.03, "room_mix": True,  # 3 mL ethanol mixed in 200 m3 ~ 4 ppm
        "basis": "Ethanol evaporates from skin with a ~12 s half-life; hands dry in 24-67 s (1-3 mL); vapour near the "
                 "hands peaks at ~20-30 s at thousands of ppm. MP503 responds in <=20 s, recovers in <=60 s.",
    },
    "breath": {
        "label": "Someone breathing on it",
        "peak": 70, "rise_s": 4, "fall_s": 22, "tail": 0.0, "room_mix": False,
        "basis": "Exhaled breath is 89-97% RH with acetone (0.3-1 ppm) and traces of ethanol; metal-oxide sensors respond "
                 "immediately and humidity acts as a reducing gas that raises the signal.",
    },
    "marker": {
        "label": "Dry-erase / permanent marker",
        "peak": 110, "rise_s": 30, "fall_s": 90, "tail": 0.15, "room_mix": True,
        "basis": "Alcohols are the main emissions of dry-erase markers; permanent and dry-erase markers emit >400x the "
                 "VOCs of washable markers (101 markers tested).",
    },
    "cleaner": {
        "label": "Spray cleaner / disinfectant",
        "peak": 320, "rise_s": 15, "fall_s": 60, "tail": 0.20, "room_mix": True,
        "basis": "Ethanol-based sprays push indoor ethanol above 1,000 ug/m3; levels fall back to background over about "
                 "an hour, set mainly by ventilation.",
    },
}

# PHS 2026-27 normal bell schedule (minutes after midnight); used by the "auto" room mode
BELLS = [(430, 480), (485, 535), (540, 590), (595, 645), (650, 710), (745, 795), (800, 850)]  # P5 class before lunch 5c
LUNCH_5C = (710, 740)


class RoomModel:
    def __init__(self, mode="auto", speed=1.0):
        self._lock = threading.Lock()
        self.mode, self.speed = mode, speed
        self.co2 = 650.0
        self.pulses = []          # active event pulses
        self.cover_until = 0.0
        self.ff_offset = 0.0      # how far fast-forwarding has moved the reading beyond real-time pace (ADC units)
        self.last = time.time()
        self.drift_phase = random.uniform(0, 6.28)
        self.log = []             # recent events, newest first (for the operator page)

    # ---------------- controls ----------------
    def set_mode(self, mode=None, speed=None):
        with self._lock:
            if mode is not None:
                if mode not in ("auto", "class", "empty", "window", "door"):
                    raise ValueError(mode)
                self.mode = mode
            if speed is not None:
                self.speed = max(1.0, min(60.0, float(speed)))

    def trigger(self, kind, distance="near"):
        if kind == "cover":
            self.cover_until = time.time() + 10
            self._note("Hand over the light sensor")
            return
        if kind == "clear":
            self.clear_events()
            self._note("Cleared indoor events")
            return
        if kind not in EVENTS:
            raise KeyError(kind)
        e = EVENTS[kind]
        share, lag = DISTANCE.get(distance, DISTANCE["near"])
        mixed = e["tail"] if e["room_mix"] else 0.0
        with self._lock:
            self.pulses.append({"kind": kind, "t0": time.time(), "plume": e["peak"] * (1 - mixed) * share,
                                "mixed": e["peak"] * mixed, "rise": e["rise_s"] * lag, "fall": e["fall_s"] * lag})
            del self.pulses[:-12]  # the oldest ones have long faded by then
        self._note(f"{e['label']} ({distance})")

    def clear_events(self):
        with self._lock:
            self.pulses = []

    def _note(self, text):
        self.log.insert(0, {"t": time.time(), "text": text})
        del self.log[12:]

    # ---------------- state ----------------
    def occupancy_and_ventilation(self, now=None):
        mode = self.mode
        if mode == "class":
            return CLASS_SIZE, "closed"
        if mode == "empty":
            return 0, "closed"
        if mode == "window":
            return CLASS_SIZE, "window"
        if mode == "door":
            return CLASS_SIZE, "door"
        # auto: follow today's PHS bell schedule in Princeton time
        lt = datetime.fromtimestamp(now or time.time(), TZ) if TZ else datetime.fromtimestamp(now or time.time())
        m = lt.hour * 60 + lt.minute
        if lt.weekday() >= 5:
            return 0, "closed"
        if any(a <= m < b for a, b in BELLS):
            return CLASS_SIZE, "closed"
        if LUNCH_5C[0] <= m < LUNCH_5C[1]:
            return 0, "door"
        if 425 <= m < 855:
            return 12, "door"  # passing time
        return 0, "closed"

    def _step(self, now):
        dt = max(0.0, min(5.0, now - self.last)) * self.speed  # cap gaps so a stall can't teleport the room
        self.last = now
        n, vent = self.occupancy_and_ventilation(now)
        gen = n * GEN_LPS / 1000.0 / ROOM_V * 1e6            # ppm per second
        dco2 = dt * (gen - ACH[vent] / 3600.0 * (self.co2 - C_OUT))
        self.co2 += dco2
        # the part of this change that only happened because of fast-forwarding (for the real-time trend)
        self.ff_offset += K_BIO * dco2 / 100.0 * (1 - 1 / self.speed)
        return n, vent

    def _pulses(self, now, vent):
        total, keep = 0.0, []
        k_vent = ACH[vent] / 3600.0                            # room air is cleared at the ventilation rate (events: real time)
        k_mix = 1 / MIX_S
        for p in self.pulses:
            age = max(0.0, now - p["t0"])
            # plume: reaches the sensor within its rise time, then the sensor recovers as it passes
            plume = p["plume"] * (1 - math.exp(-age / (p["rise"] / 2.0))) * math.exp(-max(0.0, age - p["rise"]) / p["fall"])
            # mixed share: spreads through the room over MIX_S while ventilation removes it
            if abs(k_mix - k_vent) < 1e-9:
                mixed = p["mixed"] * k_mix * age * math.exp(-k_mix * age)
            else:
                mixed = p["mixed"] * k_mix / (k_mix - k_vent) * (math.exp(-k_vent * age) - math.exp(-k_mix * age))
            v = plume + mixed
            total += v
            if v > 0.5 or age < max(p["rise"] * 2, MIX_S):
                keep.append(p)
        self.pulses = keep
        return SATURATE * (1 - math.exp(-total / SATURATE))

    def read_air(self):
        now = time.time()
        with self._lock:
            n, vent = self._step(now)
            ev = self._pulses(now, vent)
            drift = 4.0 * math.sin(2 * math.pi * (now / 36000.0) + self.drift_phase)  # slow temp/humidity drift
            v = AIR_BASE + drift + K_BIO * (self.co2 - C_OUT) / 100.0 + ev + random.gauss(0, NOISE)
        return max(0.0, min(1000.0, v))

    def read_light(self):
        now = time.time()
        if now < self.cover_until:
            return random.uniform(5, 15)
        elev = clarity.solar_elevation(LAT, LON)
        lux_window = 0.07 * clarity.clear_sky_ghi(elev) * 105 * 0.75 + (57 if 7 <= (datetime.now(TZ) if TZ else datetime.now()).hour < 15 else 0)
        return max(0.0, min(1000.0, 1000 * (1 - math.exp(-lux_window / 900.0)) + random.gauss(0, 4)))

    def info(self):
        n, vent = self.occupancy_and_ventilation()
        return {"mode": self.mode, "speed": self.speed, "co2_ppm": round(self.co2), "occupancy": n, "ventilation": vent,
                "active_events": [p["kind"] for p in self.pulses],
                "log": [{"ago_s": round(time.time() - e["t"]), "text": e["text"]} for e in self.log]}
