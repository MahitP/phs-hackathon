import os
import sys
import tempfile
from pathlib import Path

# Must be set before server modules are imported: they open the DB and pick sensors at import time.
os.environ["SKYWINDOW_MOCK"] = "1"
os.environ["SKYWINDOW_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("ELEVENLABS_API_KEY", None)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
