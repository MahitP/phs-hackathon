"""Backup backend (simulator/) vs the Raspberry Pi backend (server/ + device/).

The separation rules: the Pi backend never imports the simulator, never falls back to made-up sensor
readings, and doesn't expose scenario controls. Every scenario must produce the verdict it promises."""
import re
import time
from pathlib import Path

from device import hw
from server.decide import decide
from simulator import scenarios
from tests.test_api import client

ROOT = Path(__file__).resolve().parents[1]
REAL_SKY = {"us_aqi": 64, "pm2_5": 19.0, "aod": 0.15, "wind_dir": 60, "fetched_at": time.time()}
BASELINE = 80.0


# ---------- separation ----------
def test_pi_backend_never_imports_the_simulator():
    for folder in ("server", "device", "ml"):
        for f in (ROOT / folder).glob("*.py"):
            assert not re.search(r"\bsimulator\b|\bscenarios\b", f.read_text(encoding="utf-8")), f


def test_pi_sensors_go_offline_instead_of_inventing_readings(monkeypatch):
    monkeypatch.delenv("SKYWINDOW_MOCK", raising=False)
    s = hw.get_sensors()  # no Grove HAT on a test machine
    assert isinstance(s, hw.PiSensors) and not s.mock
    assert s.read_air() is None and s.read_light() is None and s.offline and s.error


def test_mock_only_when_explicitly_requested(monkeypatch):
    monkeypatch.setenv("SKYWINDOW_MOCK", "1")
    assert hw.get_sensors().mock is True


def test_pi_backend_has_no_scenario_controls():
    assert client.get("/api/sim").status_code in (404, 405)
    assert client.post("/api/sim", json={"scenario": "smoke"}).status_code in (404, 405)


# ---------- room physics + presets ----------
from simulator.room import RoomModel  # noqa: E402


def room_at(co2=650.0, mode="class"):
    r = RoomModel(mode=mode)
    r.co2 = co2
    return r


def age(room, seconds):
    """Pretend every active event started `seconds` ago."""
    for p in room.pulses:
        p["t0"] -= seconds


def verdict(room, key="live", rate=0.0):
    scenarios.set_scenario(key)
    return decide(room.read_air(), BASELINE + 15, rate, scenarios.apply_sky(REAL_SKY), scenarios.scenario().get("warmup", False),
                  fires=scenarios.apply_fires(None))


def test_clean_day_stuffy_room_opens():
    assert verdict(room_at(co2=1800), "clean_stuffy")["key"] == "open"


def test_smoke_outside_keeps_shut():
    scenarios.set_scenario("smoke")
    assert scenarios.apply_sky(REAL_SKY)["us_aqi"] > 100
    assert verdict(room_at(), "smoke")["key"] == "shut"


def test_fire_upwind_turns_open_into_either():
    v = verdict(room_at(co2=1800), "fire")
    assert v["key"] == "either" and any("upwind" in r for r in v["reasons"])


def test_sanitizer_near_surges_within_20_seconds_then_fades():
    r = room_at()
    before = r.read_air()
    r.trigger("sanitizer", "near")
    age(r, 20)
    peak = r.read_air()
    assert peak - before > 350                       # surges toward the MP503's upper range
    rate = (peak - before) / (20 / 60)
    assert verdict(r, rate=rate)["key"] == "ventilate"
    age(r, 300)
    assert r.read_air() - before < 80                # mostly gone after ~5 minutes


def test_events_scale_with_distance_and_type():
    def bump(kind, dist):
        r = room_at()
        b = r.read_air()
        r.trigger(kind, dist)
        age(r, 25)
        return r.read_air() - b
    assert bump("sanitizer", "near") > bump("sanitizer", "arm") > bump("sanitizer", "room")
    assert bump("sanitizer", "near") > bump("cleaner", "near") > bump("marker", "near") > bump("breath", "near") > 20


def test_mode_switches_never_jump():
    r = room_at(co2=1900)
    a = r.read_air()
    for mode in ("window", "empty", "door", "class", "auto"):
        r.set_mode(mode)
        b = r.read_air()
        assert abs(b - a) < 15, mode                 # only noise; CO2 itself changes gradually
        a = b


def test_window_clears_co2_like_the_studies():
    r = room_at(co2=2000, mode="window")
    r.set_mode(speed=60)
    for _ in range(15):                              # 15 x 5 s x 60 = 75 simulated minutes
        r.last -= 5
        r.read_air()
    assert 2000 - r.co2 > 1000 and r.co2 < 900      # studies: opening windows cuts CO2 by ~1,000 ppm (class still inside)


def test_full_class_builds_co2_into_the_measured_range():
    r = room_at(co2=500, mode="class")
    r.set_mode(speed=60)
    for _ in range(10):                              # 50 simulated minutes
        r.last -= 5
        r.read_air()
    assert 1300 < r.co2 < 2400                       # studies: school-hour averages 657-2,235 ppm, peaks ~3,000


def test_warmup_preset():
    assert verdict(room_at(), "warmup")["key"] == "warmup"


def test_live_preset_keeps_real_outside_data():
    scenarios.set_scenario("live")
    assert scenarios.apply_sky(REAL_SKY) is REAL_SKY
    assert scenarios.apply_fires({"x": 1}) == {"x": 1}


def test_feed_labels_identify_the_source_without_the_word_simulated():
    assert scenarios.SimSensors.feed == "backup"
    assert getattr(hw.PiSensors, "feed", "pi") == "pi"  # the Pi backend's default
    web = (ROOT / "web" / "app.js").read_text(encoding="utf-8") + (ROOT / "web" / "index.html").read_text(encoding="utf-8")
    assert "BACKUP FEED" in web and not re.search(r"simulat", web, re.I)
