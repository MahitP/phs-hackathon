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
STALE_INDEX = 40  # stale index at which the room is worse than a "moderate" sky, so open up
# Hysteresis: a level or verdict, once entered, is only left after the reading clears the threshold
# by this margin, so values hovering at a boundary don't flip the LCD (or re-trigger the captain).
HYST = {"aqi": 5, "pm2_5": 3.0, "aod": 0.05, "index": 10}

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


def stale_index(reading, baseline):
    if baseline is None:
        return 0
    return int(max(0.0, min(100.0, 100 * (reading - baseline) / INDOOR_SPAN)))


def outdoor_level(sky, prev=None):
    """'good' | 'moderate' | 'bad' | 'unknown' plus the reason. `prev` is the last level (hysteresis)."""
    if not sky:
        return "unknown", "no sky data"
    aqi = sky.get("us_aqi")
    pm = sky.get("pm2_5")
    aod = sky.get("aod")
    bad = 1 if prev == "bad" else 0  # margins only apply while leaving a worse level
    mod = 1 if prev in ("bad", "moderate") else 0
    if (aqi is not None and aqi > 100 - bad * HYST["aqi"]) or (pm is not None and pm > 35.4 - bad * HYST["pm2_5"]):
        return "bad", f"outdoor AQI {aqi}, PM2.5 {pm} ug/m3"
    if aod is not None and aod > 0.7 - bad * HYST["aod"]:
        return "bad", f"heavy haze overhead (aerosol optical depth {aod})"
    if aqi is not None and aqi > 50 - mod * HYST["aqi"]:
        return "moderate", f"outdoor AQI {aqi} (moderate)"
    return "good", f"outdoor AQI {aqi}"


def decide(indoor_reading, baseline, rate_per_min, sky, warming_up=False, prev=None):
    """`prev` is the previous verdict dict; passing it in gives the thresholds hysteresis."""
    if warming_up:
        key, reasons, idx = "warmup", ["air sensor heater warming up (2 min)"], 0
        return _pack(key, reasons, idx, "unknown")
    prev_key = prev["key"] if prev else None
    idx = stale_index(indoor_reading, baseline)
    level, why_out = outdoor_level(sky, prev["outdoor_level"] if prev else None)
    rising = rate_per_min > SPIKE_RATE
    spike = rising or idx >= SPIKE_INDEX - (HYST["index"] if prev_key == "ventilate" else 0)
    stale = idx >= STALE_INDEX - (HYST["index"] if prev_key == "open" else 0)
    reasons = [why_out, f"indoor stale index {idx}/100" + (" (rising fast!)" if rising else "")]

    if level == "bad":
        key = "shut"
        if spike:
            reasons.append("indoor spike too - run a purifier or fan instead of opening the window")
    elif spike:
        key = "ventilate"
    elif level == "good":
        key = "open"
        reasons.append("your room is staler than the sky - let it in" if idx >= 25
                       else "both sides are clean - fresh air is a bonus")
    elif level == "moderate" and stale:
        key = "open"
        reasons.append("your room is staler than the moderate sky - air it out for a few minutes")
    else:
        key = "either"
        if level == "moderate":
            reasons.append("inside and outside are about the same")
    return _pack(key, reasons, idx, level)


def _pack(key, reasons, idx, level):
    v = VERDICTS[key]
    return {"key": key, "label": v["label"], "lcd1": v["lcd1"], "lcd2": v["lcd2"], "rgb": v["rgb"],
            "color": v["color"], "reasons": reasons, "stale_index": idx, "outdoor_level": level}
