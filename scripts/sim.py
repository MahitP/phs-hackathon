"""Run the SkyWindow SIMULATOR backend (simulated indoor sensors, real outside data) on port 8001.

    python scripts/sim.py            ->  http://localhost:8001

It runs alongside the live device / scripts/dev.py on port 8000 and links back to it. See server/sim.py.
"""
import os
import runpy
from pathlib import Path

os.environ["SKYWINDOW_SIM"] = "1"
os.environ.setdefault("PORT", "8001")
os.environ.setdefault("SKYWINDOW_PEER_PORT", "8000")
runpy.run_path(str(Path(__file__).with_name("dev.py")), run_name="__main__")
