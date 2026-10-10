"""Smoke Day replay: feeds June 7, 2023 (Canadian wildfire smoke over NJ) into the verdict engine
in place of the live sky, one historical hour every SECONDS_PER_HOUR seconds. Indoor sensors stay live.
"""
import json
import time
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "smoke_day_2023.json"
SECONDS_PER_HOUR = 4.0
START_HOUR = 8  # start the morning before the afternoon "orange sky" peak


class Replay:
    def __init__(self):
        self.started = None
        self.data = json.loads(DATA.read_text()) if DATA.exists() else None

    @property
    def active(self):
        return self.started is not None

    def start(self):
        if not self.data:
            raise RuntimeError("data/smoke_day_2023.json missing - run scripts/fetch_smoke_day.py")
        self.started = time.time()

    def stop(self):
        self.started = None

    def current(self):
        """Return (sky_dict, replay_info) for the replayed hour, or (None, None) when inactive."""
        if not self.active:
            return None, None
        hours = self.data["hours"]
        idx = START_HOUR + int((time.time() - self.started) / SECONDS_PER_HOUR)
        if idx >= len(hours):
            self.stop()
            return None, None
        h = hours[idx]
        sky = {**h, "is_day": 1 if 6 <= idx <= 20 else 0, "source": "replay", "stale": False,
               "forecast": {"time": [x["time"] for x in hours], "us_aqi": [x["us_aqi"] for x in hours],
                            "pm2_5": [x["pm2_5"] for x in hours], "aod": [x["aod"] for x in hours],
                            "cloud_cover": [x["cloud_cover"] for x in hours],
                            "wind_dir": [x["wind_dir"] for x in hours]}}
        info = {"label": self.data["label"], "clock": h["time"][11:16], "index": idx, "total": len(hours)}
        return sky, info
