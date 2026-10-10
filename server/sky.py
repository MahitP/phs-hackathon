"""The sky above you: live outdoor air + weather from Open-Meteo (free, no API key).

Data: Open-Meteo Air Quality API (CAMS models) and Forecast API. CC-BY 4.0, attribution
shown on the dashboard.
"""
import os
import time

import requests

LAT = float(os.environ.get("SKYWINDOW_LAT", "40.3487"))  # Princeton High School
LON = float(os.environ.get("SKYWINDOW_LON", "-74.6590"))
CACHE_SECONDS = 600

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WX_URL = "https://api.open-meteo.com/v1/forecast"
AQ_VARS = "us_aqi,pm2_5,pm10,ozone,dust,aerosol_optical_depth,uv_index"
WX_VARS = "temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,shortwave_radiation,is_day"

_cache = {"at": 0.0, "data": None}


def _get(url, params):
    r = requests.get(url, params=params, timeout=10)
    r.raise_for_status()
    return r.json()


def fetch_sky(force=False):
    """Return current sky conditions plus a 24h hourly forecast. Cached for 10 minutes;
    on network failure returns the last good data marked stale (or None)."""
    now = time.time()
    if not force and _cache["data"] and now - _cache["at"] < CACHE_SECONDS:
        return _cache["data"]
    try:
        base = {"latitude": LAT, "longitude": LON, "timezone": "auto", "forecast_days": 2}
        aq = _get(AQ_URL, {**base, "current": AQ_VARS, "hourly": "us_aqi,pm2_5,aerosol_optical_depth"})
        wx = _get(WX_URL, {**base, "current": WX_VARS, "hourly": "cloud_cover,wind_direction_10m,wind_speed_10m"})
        cur = {**aq["current"], **wx["current"]}
        data = {
            "time": cur.get("time"),
            "us_aqi": cur.get("us_aqi"),
            "pm2_5": cur.get("pm2_5"),
            "pm10": cur.get("pm10"),
            "ozone": cur.get("ozone"),
            "dust": cur.get("dust"),
            "aod": cur.get("aerosol_optical_depth"),
            "uv_index": cur.get("uv_index"),
            "temperature": cur.get("temperature_2m"),
            "cloud_cover": cur.get("cloud_cover"),
            "wind_speed": cur.get("wind_speed_10m"),
            "wind_dir": cur.get("wind_direction_10m"),
            "radiation": cur.get("shortwave_radiation"),
            "is_day": cur.get("is_day"),
            "forecast": {
                "time": aq["hourly"]["time"],
                "us_aqi": aq["hourly"]["us_aqi"],
                "pm2_5": aq["hourly"]["pm2_5"],
                "aod": aq["hourly"]["aerosol_optical_depth"],
                "cloud_cover": wx["hourly"]["cloud_cover"],
                "wind_dir": wx["hourly"]["wind_direction_10m"],
            },
            "source": "live",
            "fetched_at": now,
            "stale": False,
        }
        _cache.update(at=now, data=data)
        return data
    except Exception as exc:
        print(f"[sky] fetch failed: {exc!r}")
        if _cache["data"]:
            return {**_cache["data"], "stale": True}
        return None


def compass(deg):
    if deg is None:
        return "?"
    names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return names[int((deg % 360) / 45 + 0.5) % 8]


if __name__ == "__main__":
    import json

    d = fetch_sky()
    d = {k: v for k, v in d.items() if k != "forecast"} if d else d
    print(json.dumps(d, indent=2))
