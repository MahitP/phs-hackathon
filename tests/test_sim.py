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
BASELINE = 135.0  # the MP503's clean-air reading on the Grove HAT (room model AIR_BASE ~132 + a little CO2)


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


SPIKE_UNITS_PER_20S = 40 / 3  # server.decide SPIKE_RATE (40 units/min) over the server's 20 s rate window


def rise_over_20s(room, seconds, real_time_trend=True):
    """Largest 20 s rise the server's trend detector would see over the next `seconds` (1 Hz reads)."""
    vals, ema = [], None
    for _ in range(seconds):
        room.last -= 1                               # one real second passes
        for p in room.pulses:
            p["t0"] -= 1
        v = room.read_air() - (room.ff_offset if real_time_trend else 0.0)
        ema = v if ema is None else ema + 0.3 * (v - ema)   # the server's Smoother(0.3)
        vals.append(ema)
    return max(b - a for a, b in zip(vals, vals[20:])), vals


def test_fast_forward_never_looks_like_a_spike():
    r = room_at(co2=600, mode="class")
    r.set_mode(speed=30)
    rise, vals = rise_over_20s(r, 240)
    assert rise < SPIKE_UNITS_PER_20S                # the trend the device sees stays at real-time pace
    assert r.co2 > 1300                              # ...while the room itself really is fast-forwarded


def server_trend(room, seconds, flip=None):
    """The server's own pipeline: Smoother(0.3) on the reading, then its 20 s rise rate on RealTimeTrend."""
    smooth, trend, win, worst = hw.Smoother(0.3), scenarios.RealTimeTrend(room, 0.3), [], 0.0
    for t in range(seconds):
        if flip and t == flip[0]:
            room.set_mode(flip[1])
        room.last -= 1
        win.append((t, trend.adjust(smooth.update(room.read_air()))))
        win = [w for w in win if t - w[0] <= 20]
        if t - win[0][0] >= 10:
            worst = max(worst, (win[-1][1] - win[0][1]) / ((t - win[0][0]) / 60))
    return worst


def test_opening_the_window_at_30x_is_not_a_spike_either():
    r = room_at(co2=600, mode="class")
    r.set_mode(speed=30)
    assert server_trend(r, 300, flip=(150, "window")) < 40   # build-up, then the CO2 trend turns sharply


def test_events_across_the_room_arrive_slowly_through_room_air():
    r = room_at(mode="class")
    r.set_mode("empty")                              # no CO2 build-up, just the event
    r.co2 = 425
    before = r.read_air()
    r.trigger("cleaner", "room")
    rise, vals = rise_over_20s(r, 300)
    assert rise < SPIKE_UNITS_PER_20S                # no "rising fast" from across the room
    assert max(vals) - before > 25                   # but the room air does get noticeably worse


def test_events_run_in_real_time_even_when_the_room_is_fast_forwarded():
    r = room_at(co2=425, mode="window")
    r.set_mode(speed=30)
    before = r.read_air()
    r.trigger("cleaner", "room")
    rise, vals = rise_over_20s(r, 300)
    assert max(vals) - before > 15                   # the open window dilutes it, at real-time pace


def test_breath_or_marker_at_arms_length_barely_registers():
    for kind in ("breath", "marker"):
        r = room_at(co2=425, mode="empty")
        before = r.read_air()
        r.trigger(kind, "arm")
        rise, vals = rise_over_20s(r, 120)
        assert rise < SPIKE_UNITS_PER_20S, kind


def test_repeated_events_saturate_like_a_metal_oxide_sensor():
    r = room_at(co2=425, mode="empty")
    one = room_at(co2=425, mode="empty")
    for _ in range(6):
        r.trigger("sanitizer", "near")
    one.trigger("sanitizer", "near")
    age(r, 20); age(one, 20)
    many, single = r.read_air(), one.read_air()
    assert many < 1000 and many < single + 450       # response flattens out instead of adding up


def test_closed_class_goes_stale_and_an_open_window_keeps_it_fresh():
    baseline_co2 = 450                               # the room's cleanest air today (empty, aired out)
    stale = lambda co2: (co2 - baseline_co2) * room_mod.K_BIO / 100 / 250 * 100  # decide.stale_index
    closed = room_at(co2=650, mode="class")
    closed.set_mode(speed=60)
    for _ in range(8):                               # 8 x 5 s x 60 = 40 class-minutes
        closed.last -= 5
        closed.read_air()
    assert stale(closed.co2) >= 40                   # -> OPEN THE WINDOW even under a moderate sky
    window = room_at(co2=650, mode="window")
    window.set_mode(speed=60)
    for _ in range(30):
        window.last -= 5
        window.read_air()
    assert stale(window.co2) < 40                    # window open: the room stays about as fresh as outside


def test_switching_preset_clears_leftover_events():
    scenarios.ROOM.trigger("cleaner", "near")
    scenarios.set_scenario("live")
    assert scenarios.ROOM.pulses == []
    scenarios.set_scenario("spike")
    assert [p["kind"] for p in scenarios.ROOM.pulses] == ["sanitizer"]
    scenarios.set_scenario("live")


def test_moderate_sky_stuffy_room_opens_only_once_stale():
    fresh = verdict(room_at(co2=500), "moderate_stuffy")
    stuffy = verdict(room_at(co2=1900), "moderate_stuffy")
    assert fresh["key"] == "either" and stuffy["key"] == "open"


import simulator.room as room_mod  # noqa: E402


def test_warmup_preset():
    assert verdict(room_at(), "warmup")["key"] == "warmup"


def test_live_preset_keeps_real_outside_data():
    scenarios.set_scenario("live")
    assert scenarios.apply_sky(REAL_SKY) is REAL_SKY
    assert scenarios.apply_fires({"x": 1}) == {"x": 1}


def test_feed_labels_identify_the_source_without_the_word_simulated():
    assert scenarios.SimSensors.feed == "backup"
    assert getattr(hw.PiSensors, "feed", "pi") == "pi"  # the Pi backend's default
    web = "".join((ROOT / "web" / f).read_text(encoding="utf-8") for f in ("app/app.js", "app/local.js", "app.html"))
    assert "BACKUP FEED" in web and not re.search(r"simulat", web, re.I)
