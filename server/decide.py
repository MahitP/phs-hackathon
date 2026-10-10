"""Verdict engine: should the window be open?

Indoor side - the Grove Air Quality v1.3 is a VOC/gas sensor with RELATIVE output, so we
never call it AQI. We turn it into a 0-100 "stale index" = how far above the room's
clean-air baseline it is, plus a "spike" flag when it rises fast (cleaners, markers,
cooking, sanitizer).

Outdoor side - real US AQI, PM2.5 and aerosol optical depth (smoke haze) from Open-Meteo.
"""

INDOOR_SPAN = 250.0  # sensor units above baseline that map to stale index 100
SPIKE_RATE = 40.0  # sensor units per minute that count as a sudden spike
SPIKE_INDEX = 70  # stale index that counts as a spike even if it rose slowly

VERDICTS = {
    "open": {"label": "OPEN THE WINDOW", "lcd1": "OPEN THE WINDOW", "lcd2": "Sky is cleaner", "rgb": (0, 200, 60),
             "color": "#16a34a"},
    "either": {"label": "EITHER WAY", "lcd1": "EITHER WAY", "lcd2": "In ~ out", "rgb": (230, 170, 0),
               "color": "#d97706"},
    "shut": {"label": "KEEP IT SHUT", "lcd1": "KEEP IT SHUT", "lcd2": "Sky is hazy", "rgb": (230, 0, 0),
             "color": "#dc2626"},
    "ventilate": {"label": "VENTILATE NOW", "lcd1": "VENTILATE NOW!", "lcd2": "Indoor spike", "rgb": (150, 0, 220),
                  "color": "#9333ea"},
    "warmup": {"label": "WARMING UP", "lcd1": "SkyWindow", "lcd2": "Warming up...", "rgb": (60, 120, 255),
               "color": "#2563eb"},
}


def aqi_category(aqi):
    """Official U.S. EPA AQI category name."""
    if aqi is None:
        return "no data"
    for limit, name in ((50, "good"), (100, "moderate"), (150, "unhealthy for sensitive groups"),
                        (200, "unhealthy"), (300, "very unhealthy")):
        if aqi <= limit:
            return name
    return "hazardous"


def stale_index(reading, baseline):
    if baseline is None:
        return 0
    return int(max(0.0, min(100.0, 100 * (reading - baseline) / INDOOR_SPAN)))


def outdoor_level(sky):
    """'good' | 'moderate' | 'bad' | 'unknown' plus the reason."""
    if not sky:
        return "unknown", "no sky data"
    aqi = sky.get("us_aqi")
    pm = sky.get("pm2_5")
    aod = sky.get("aod")
    if (aqi is not None and aqi > 100) or (pm is not None and pm > 35.4):
        return "bad", f"outdoor AQI {aqi} ({aqi_category(aqi)}), PM2.5 {pm} ug/m3"
    if aod is not None and aod > 0.7:
        return "bad", f"heavy haze overhead (aerosol optical depth {aod})"
    if aqi is not None and aqi > 50:
        return "moderate", f"outdoor AQI {aqi} (moderate)"
    return "good", f"outdoor AQI {aqi} ({aqi_category(aqi)})"


def decide(indoor_reading, baseline, rate_per_min, sky, warming_up=False, fires=None):
    if warming_up:
        key, reasons, idx = "warmup", ["air sensor heater warming up (2 min)"], 0
        return _pack(key, reasons, idx, "unknown")
    idx = stale_index(indoor_reading, baseline)
    level, why_out = outdoor_level(sky)
    spike = rate_per_min > SPIKE_RATE or idx >= SPIKE_INDEX
    reasons = [why_out, f"indoor stale index {idx}/100" + (" (rising fast!)" if rate_per_min > SPIKE_RATE else "")]

    if level == "bad":
        key = "shut"
        if spike:
            reasons.append("indoor spike too - run a purifier or fan instead of opening the window")
    elif spike:
        key = "ventilate"
    elif level == "good" and idx >= 25:
        key = "open"
    elif level == "good":
        key = "open"
        reasons.append("both sides are clean - fresh air is a bonus")
    else:
        key = "either"

    # NASA satellite fire detections upwind: the air is measured clean now, but smoke could arrive
    if fires and fires.get("smoke_risk"):
        reasons.append(f"{fires['upwind_count']} satellite fire detections upwind "
                       f"({fires['upwind_frp_150km']} MW within 150 km) - smoke could drift in")
        if key == "open":
            key = "either"
    return _pack(key, reasons, idx, level)


def _pack(key, reasons, idx, level):
    v = VERDICTS[key]
    return {"key": key, "label": v["label"], "lcd1": v["lcd1"], "lcd2": v["lcd2"], "rgb": v["rgb"],
            "color": v["color"], "reasons": reasons, "stale_index": idx, "outdoor_level": level}
