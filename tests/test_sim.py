"""The simulator backend: every scenario must produce the verdict it promises, it must never touch
hardware, and the live device must refuse scenario commands."""
import time

from server import sim
from server.decide import decide
from tests.test_api import client

REAL_SKY = {"us_aqi": 64, "pm2_5": 19.0, "aod": 0.15, "wind_dir": 60, "fetched_at": time.time()}
BASELINE = 80.0


def run(key, sky=REAL_SKY, seconds=0.0, rate=0.0):
    sim.set_scenario(key)
    sim._active["since"] -= seconds  # pretend the scenario has been running for a while
    sensors = sim.SimSensors()
    air = sensors.read_air()
    return decide(air, BASELINE, rate, sim.apply_sky(sky), sensors.warming_up(), fires=sim.apply_fires(None))


def test_clean_day_stuffy_room_opens():
    assert run("clean_stuffy")["key"] == "open"


def test_smoke_outside_keeps_shut_and_is_flagged():
    sim.set_scenario("smoke")
    sky = sim.apply_sky(REAL_SKY)
    assert sky["sim_override"] and sky["us_aqi"] > 100
    assert run("smoke")["key"] == "shut"


def test_fire_upwind_turns_open_into_either():
    v = run("fire")
    assert v["key"] == "either"
    assert any("upwind" in r for r in v["reasons"])


def test_spike_rises_fast_enough_to_ventilate():
    sim.set_scenario("spike")
    sim._active["since"] -= 10
    s = sim.SimSensors()
    a = s.read_air()
    sim._active["since"] -= 6
    b = s.read_air()
    rate = (b - a) / (6 / 60)
    assert run("spike", seconds=16, rate=rate)["key"] == "ventilate"


def test_warmup_scenario():
    assert run("warmup")["key"] == "warmup"


def test_live_scenario_keeps_real_sky():
    sim.set_scenario("live")
    assert sim.apply_sky(REAL_SKY) is REAL_SKY
    assert sim.apply_fires({"x": 1}) == {"x": 1}


def test_scenario_switch_is_reported_once():
    sim.set_scenario("live")
    assert sim.consume_change() is True
    assert sim.consume_change() is False


def test_simulated_sensors_never_touch_hardware():
    s = sim.SimSensors()
    assert s.mock and s.sim
    assert 0 < s.read_air() < 1000 and s.read_light() >= 0


def test_live_device_refuses_scenarios():
    assert client.get("/api/sim").status_code == 404
    assert client.post("/api/sim", json={"scenario": "smoke"}).status_code == 404
