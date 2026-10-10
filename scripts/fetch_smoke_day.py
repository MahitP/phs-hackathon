"""Download the June 7, 2023 Canadian-wildfire smoke day over Princeton, NJ from Open-Meteo
(historical CAMS air-quality model + ERA5 weather archive) into web/smoke_day_2023.json (bundled with the site).

    python scripts/fetch_smoke_day.py
"""
import json
from pathlib import Path

import requests

LAT, LON = 40.3587, -74.6560
DAY = "2023-06-07"
OUT = Path(__file__).resolve().parents[1] / "web" / "smoke_day_2023.json"

aq = requests.get("https://air-quality-api.open-meteo.com/v1/air-quality", params={
    "latitude": LAT, "longitude": LON, "start_date": DAY, "end_date": DAY, "timezone": "America/New_York",
    "hourly": "us_aqi,pm2_5,pm10,ozone,dust,aerosol_optical_depth,uv_index"}, timeout=20).json()["hourly"]
wx = requests.get("https://archive-api.open-meteo.com/v1/archive", params={
    "latitude": LAT, "longitude": LON, "start_date": DAY, "end_date": DAY, "timezone": "America/New_York",
    "hourly": "temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,shortwave_radiation"},
    timeout=20).json()["hourly"]

hours = []
for i, t in enumerate(aq["time"]):
    hours.append({
        "time": t, "us_aqi": aq["us_aqi"][i], "pm2_5": aq["pm2_5"][i], "pm10": aq["pm10"][i],
        "ozone": aq["ozone"][i], "dust": aq["dust"][i], "aod": aq["aerosol_optical_depth"][i],
        "uv_index": aq["uv_index"][i], "temperature": wx["temperature_2m"][i],
        "cloud_cover": wx["cloud_cover"][i], "wind_speed": wx["wind_speed_10m"][i],
        "wind_dir": wx["wind_direction_10m"][i], "radiation": wx["shortwave_radiation"][i],
    })
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(json.dumps({"label": "Smoke Day - June 7, 2023 (Princeton, NJ)",
                           "source": "Open-Meteo historical CAMS air quality + ERA5 weather",
                           "hours": hours}, indent=1))
print(f"wrote {OUT} ({len(hours)} hours); peak AQI {max(h['us_aqi'] for h in hours)}, "
      f"peak AOD {max(h['aod'] for h in hours)}")
