import pytest

from server import sky

AQ = {"current": {"time": "2026-10-10T12:00", "us_aqi": 30, "pm2_5": 5, "pm10": 8, "ozone": 60, "dust": 0,
                  "aerosol_optical_depth": 0.1, "uv_index": 3},
      "hourly": {"time": ["2026-10-10T12:00"], "us_aqi": [30], "pm2_5": [5], "aerosol_optical_depth": [0.1]}}
WX = {"current": {"temperature_2m": 15, "cloud_cover": 20, "wind_speed_10m": 9, "wind_direction_10m": 315,
                  "shortwave_radiation": 400, "is_day": 1},
      "hourly": {"cloud_cover": [20], "wind_direction_10m": [315], "wind_speed_10m": [9]}}


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    monkeypatch.setattr(sky, "_cache", {"at": 0.0, "tried": 0.0, "data": None, "stale": False})
    clock = {"t": 1_000_000.0}
    monkeypatch.setattr(sky.time, "time", lambda: clock["t"])
    return clock


def fake_get(calls, fail=False):
    def _get(url, params):
        calls.append(url)
        if fail:
            raise OSError("network down")
        return AQ if "air-quality" in url else WX
    return _get


def test_latest_never_touches_the_network(monkeypatch):
    calls = []
    monkeypatch.setattr(sky, "_get", fake_get(calls))
    assert sky.latest() is None
    assert calls == []


def test_fetch_caches_for_ten_minutes(monkeypatch, fresh_cache):
    calls = []
    monkeypatch.setattr(sky, "_get", fake_get(calls))
    assert sky.fetch_sky()["us_aqi"] == 30
    fresh_cache["t"] += 300
    sky.fetch_sky()
    assert len(calls) == 2  # one AQ + one weather request, no refetch inside the cache window
    assert sky.latest()["stale"] is False


def test_failure_backs_off_and_marks_last_good_data_stale(monkeypatch, fresh_cache):
    calls = []
    monkeypatch.setattr(sky, "_get", fake_get(calls))
    sky.fetch_sky()
    fresh_cache["t"] += sky.CACHE_SECONDS + 1
    monkeypatch.setattr(sky, "_get", fake_get(calls, fail=True))
    assert sky.fetch_sky()["stale"] is True
    n = len(calls)
    fresh_cache["t"] += 5
    sky.fetch_sky()  # within RETRY_SECONDS: no new attempt
    assert len(calls) == n
    fresh_cache["t"] += sky.RETRY_SECONDS
    sky.fetch_sky()
    assert len(calls) == n + 1


def test_data_goes_stale_if_nobody_refreshes_it(monkeypatch, fresh_cache):
    monkeypatch.setattr(sky, "_get", fake_get([]))
    sky.fetch_sky()
    fresh_cache["t"] += 2 * sky.CACHE_SECONDS + 1
    assert sky.latest()["stale"] is True
