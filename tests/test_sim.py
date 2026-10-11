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


# ---------- scenarios ----------
def run(key, sky=REAL_SKY, seconds=0.0, rate=0.0):
    scenarios.set_scenario(key)
    scenarios._active["since"] -= seconds  # pretend the scenario has been running for a while
    sensors = scenarios.SimSensors()
    air = sensors.read_air()
    return decide(air, BASELINE, rate, scenarios.apply_sky(sky), sensors.warming_up(), fires=scenarios.apply_fires(None))


def test_clean_day_stuffy_room_opens():
    assert run("clean_stuffy")["key"] == "open"


def test_smoke_outside_keeps_shut():
    scenarios.set_scenario("smoke")
    assert scenarios.apply_sky(REAL_SKY)["us_aqi"] > 100
    assert run("smoke")["key"] == "shut"


def test_fire_upwind_turns_open_into_either():
    v = run("fire")
    assert v["key"] == "either" and any("upwind" in r for r in v["reasons"])


def test_spike_rises_fast_enough_to_ventilate():
    scenarios.set_scenario("spike")
    scenarios._active["since"] -= 10
    s = scenarios.SimSensors()
    a = s.read_air()
    scenarios._active["since"] -= 6
    rate = (s.read_air() - a) / (6 / 60)
    assert run("spike", seconds=16, rate=rate)["key"] == "ventilate"


def test_warmup_scenario():
    assert run("warmup")["key"] == "warmup"


def test_live_scenario_keeps_real_data():
    scenarios.set_scenario("live")
    assert scenarios.apply_sky(REAL_SKY) is REAL_SKY
    assert scenarios.apply_fires({"x": 1}) == {"x": 1}


def test_scenario_switch_resets_smoothing_once():
    calls = []
    s = scenarios.SimSensors(on_switch=lambda: calls.append(1))
    scenarios.set_scenario("live")
    s.read_air()
    s.read_air()
    assert calls == [1]


def test_feed_labels_identify_the_source_without_the_word_simulated():
    assert scenarios.SimSensors.feed == "backup"
    assert getattr(hw.PiSensors, "feed", "pi") == "pi"  # the Pi backend's default
    web = "".join((ROOT / "web" / f).read_text(encoding="utf-8") for f in ("app/app.js", "app/local.js", "app.html"))
    assert "BACKUP FEED" in web and not re.search(r"simulat", web, re.I)
