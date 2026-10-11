"""Run SkyWindow on a laptop with simulated sensors + console LCD.

    python scripts/dev.py            ->  http://localhost:8000

On Windows, antivirus HTTPS scanning (e.g. Norton) breaks Python's certificate checks, so we
export the Windows trusted roots to a PEM file and point `requests` at it.
"""
import os
import ssl
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("SKYWINDOW_MOCK", "1")
os.environ.setdefault("SKYWINDOW_PEER_PORT", "8001")  # link to the simulator (scripts/sim.py)

if sys.platform == "win32" and "REQUESTS_CA_BUNDLE" not in os.environ:
    pem = ROOT / ".venv" / "winroots.pem"
    pem.parent.mkdir(exist_ok=True)
    certs = [ssl.DER_cert_to_PEM_cert(c) for store in ("ROOT", "CA")
             for c, enc, _ in ssl.enum_certificates(store) if enc == "x509_asn"]
    pem.write_text("".join(certs))
    os.environ["REQUESTS_CA_BUNDLE"] = str(pem)

port = os.environ.get("PORT", "8000")
sys.exit(subprocess.call([sys.executable, "-m", "uvicorn", "server.app:app", "--port", port], cwd=ROOT))
