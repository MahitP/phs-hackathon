"""Run the SkyWindow backup backend (simulator/app.py) on port 8001, next to the Pi backend on 8000.

    python scripts/sim.py          ->  dashboard http://localhost:8001   scenarios http://localhost:8001/sim

It is a separate process with its own database (data/sim.db); it cannot touch the Raspberry Pi
backend's sensors, LCD, readings or stored data.
"""
import os
import ssl
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if sys.platform == "win32" and "REQUESTS_CA_BUNDLE" not in os.environ:  # same antivirus workaround as dev.py
    pem = ROOT / ".venv" / "winroots.pem"
    pem.parent.mkdir(exist_ok=True)
    pem.write_text("".join(ssl.DER_cert_to_PEM_cert(c) for store in ("ROOT", "CA")
                           for c, enc, _ in ssl.enum_certificates(store) if enc == "x509_asn"))
    os.environ["REQUESTS_CA_BUNDLE"] = str(pem)
port = os.environ.get("PORT", "8001")
sys.exit(subprocess.call([sys.executable, "-m", "uvicorn", "simulator.app:app", "--port", port], cwd=ROOT))
