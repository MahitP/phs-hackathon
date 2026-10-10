"""Recent fires near PHS from NASA FIRMS (VIIRS satellite active-fire detections, last 7 days).

Public CSV, no API key. Every detection is a thermal hotspot: real wildfires, but also small
agricultural/brush burns and some industrial heat sources. So we drop low-confidence points, report
fire radiative power (FRP, in megawatts) as a size measure, and only call it a smoke risk when
sizeable fires are UPWIND of PHS (i.e. the wind is blowing from the fire toward us).
"""
import csv
import io
import math
import time

import requests

FIRMS_URL = ("https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/"
             "SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv")
RADIUS_KM = 300
CACHE_SECONDS = 3600
UPWIND_KM = 200  # how far upwind we care about
UPWIND_HALF_ANGLE = 45  # degrees either side of the wind's source direction
SMOKE_RISK_FRP = 30  # MW of upwind fire power within 150 km that counts as a smoke risk

_cache = {"at": 0.0, "fires": None}


def _km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    h = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def _bearing(lat1, lon1, lat2, lon2):
    """Compass bearing (degrees) from point 1 to point 2."""
    p = math.pi / 180
    y = math.sin((lon2 - lon1) * p) * math.cos(lat2 * p)
    x = math.cos(lat1 * p) * math.sin(lat2 * p) - math.sin(lat1 * p) * math.cos(lat2 * p) * math.cos((lon2 - lon1) * p)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def fetch_fires(lat, lon):
    """Fires within RADIUS_KM of (lat, lon), cached for an hour. Returns None if NASA is unreachable."""
    now = time.time()
    if _cache["fires"] is not None and now - _cache["at"] < CACHE_SECONDS:
        return _cache["fires"]
    try:
        r = requests.get(FIRMS_URL, timeout=60)
        r.raise_for_status()
        fires = []
        for row in csv.DictReader(io.StringIO(r.text)):
            if row.get("confidence") == "low":
                continue
            flat, flon = float(row["latitude"]), float(row["longitude"])
            d = _km(lat, lon, flat, flon)
            if d > RADIUS_KM:
                continue
            fires.append({"lat": flat, "lon": flon, "km": round(d, 1), "bearing": round(_bearing(lat, lon, flat, flon)),
                          "date": row["acq_date"], "time": row["acq_time"], "frp": float(row["frp"] or 0),
                          "confidence": row["confidence"], "daynight": row["daynight"]})
        fires.sort(key=lambda f: f["km"])
        _cache.update(at=now, fires=fires)
        return fires
    except Exception as exc:
        print(f"[fires] FIRMS fetch failed: {exc!r}")
        return _cache["fires"]


def summarize(fires, wind_from_deg):
    """Counts, nearest fire, and which fires are upwind given the wind's source direction."""
    if fires is None:
        return {"available": False}
    upwind = []
    if wind_from_deg is not None:
        for f in fires:
            diff = abs((f["bearing"] - wind_from_deg + 180) % 360 - 180)
            if diff <= UPWIND_HALF_ANGLE and f["km"] <= UPWIND_KM:
                upwind.append(f)
    near_upwind_frp = sum(f["frp"] for f in upwind if f["km"] <= 150)
    nearest = fires[0] if fires else None
    return {
        "available": True,
        "source": "NASA FIRMS VIIRS (S-NPP), last 7 days, nominal/high confidence",
        "within_50km": sum(1 for f in fires if f["km"] <= 50),
        "within_100km": sum(1 for f in fires if f["km"] <= 100),
        "within_300km": len(fires),
        "nearest": nearest,
        "upwind_count": len(upwind),
        "upwind_frp_150km": round(near_upwind_frp, 1),
        "smoke_risk": near_upwind_frp >= SMOKE_RISK_FRP,
        "largest_frp": max((f["frp"] for f in fires), default=0),
    }
