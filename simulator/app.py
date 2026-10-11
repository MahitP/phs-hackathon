"""SkyWindow simulator backend - a separate process from the Raspberry Pi backend.

    uvicorn simulator.app:app --host 0.0.0.0 --port 8001      (or: python scripts/sim.py)

It runs the unchanged live-device server code (server/app.py) inside ITS OWN process and swaps in:
  - simulated room sensors (simulator/scenarios.py) instead of the Grove ADC,
  - a console LCD instead of the real one,
  - its own database, data/sim.db.
Outside air, weather and NASA fires stay real unless the active scenario overrides them.

Because it is a different process, nothing here can change what the Raspberry Pi backend (port 8000)
reads, decides, shows or stores. Scenarios are picked on the operator page at /sim, not on the
public dashboard.
"""
import os
from pathlib import Path

from fastapi import Body, HTTPException
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parents[1]
# Must happen before the server modules are imported: they pick hardware and open the DB at import time.
os.environ["SKYWINDOW_MOCK"] = "1"  # never open the Grove ADC, LCD or GPIO
os.environ["SKYWINDOW_DB"] = str(ROOT / "data" / "sim.db")  # forced, never the Pi backend's database

from server import app as live  # noqa: E402  (this process's own copy of the server)
from simulator import scenarios  # noqa: E402


def _reset_smoothing():
    live.air_smooth.value = None  # jump straight to the new scenario's room level
    live.air_window.clear()


class _SkyWithScenario:
    """Real sky data from server/sky.py, with the active scenario's overrides layered on top."""

    def __init__(self, real):
        self._real = real

    def latest(self):
        return scenarios.apply_sky(self._real.latest())

    def __getattr__(self, name):  # fetch_sky, LAT, LON, ... pass straight through
        return getattr(self._real, name)


class _FiresWithScenario:
    """Real NASA FIRMS summary from server/fires.py unless the scenario sets its own fire situation."""

    def __init__(self, real):
        self._real = real

    def summarize(self, fires, wind_from_deg):
        return scenarios.apply_fires(self._real.summarize(fires, wind_from_deg))

    def __getattr__(self, name):  # fetch_fires, _cache, ... pass straight through
        return getattr(self._real, name)


live.sensors = scenarios.SimSensors(on_switch=_reset_smoothing)
live.skydata = _SkyWithScenario(live.skydata)
live.firewatch = _FiresWithScenario(live.firewatch)
app = live.app


def sim_info():
    return scenarios.info()


def sim_set(payload: dict = Body(...)):
    try:
        scenarios.set_scenario(payload.get("scenario"))
    except KeyError:
        raise HTTPException(400, f"unknown scenario; use one of {', '.join(scenarios.SCENARIOS)}")
    return scenarios.info()


def control_page():
    return FileResponse(Path(__file__).with_name("control.html"))


app.add_api_route("/api/sim", sim_info, methods=["GET"])
app.add_api_route("/api/sim", sim_set, methods=["POST"], dependencies=live.writes)
app.add_api_route("/sim", control_page, methods=["GET"], include_in_schema=False)
# the dashboard's static files are mounted at "/", which would swallow these paths: put ours first
_ours = app.router.routes[-3:]
del app.router.routes[-3:]
app.router.routes[0:0] = _ours
