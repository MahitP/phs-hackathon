"""SQLite log of readings + labeled samples for training the spike classifier."""
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "skywindow.db"
_lock = threading.Lock()


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.execute("""CREATE TABLE IF NOT EXISTS readings (
        ts REAL, air REAL, light REAL, stale_index INTEGER, rate REAL,
        us_aqi REAL, pm2_5 REAL, aod REAL, verdict TEXT)""")
    c.execute("""CREATE TABLE IF NOT EXISTS labels (
        ts REAL, label TEXT, air REAL, baseline REAL, rate REAL, light REAL)""")
    c.execute("""CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL)""")
    return c


_db = _conn()


def log_reading(row):
    with _lock:
        _db.execute("INSERT INTO readings VALUES (?,?,?,?,?,?,?,?,?)",
                    (time.time(), row["air"], row["light"], row["stale_index"], row["rate"],
                     row.get("us_aqi"), row.get("pm2_5"), row.get("aod"), row["verdict"]))
        _db.commit()


def history(minutes=60):
    since = time.time() - minutes * 60
    with _lock:
        rows = _db.execute("SELECT ts, air, light, stale_index, us_aqi, aod, verdict FROM readings "
                           "WHERE ts >= ? ORDER BY ts", (since,)).fetchall()
    keys = ["ts", "air", "light", "stale_index", "us_aqi", "aod", "verdict"]
    return [dict(zip(keys, r)) for r in rows]


def log_label(label, air, baseline, rate, light):
    with _lock:
        _db.execute("INSERT INTO labels VALUES (?,?,?,?,?,?)", (time.time(), label, air, baseline, rate, light))
        _db.commit()


def get_setting(key):
    with _lock:
        row = _db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else None


def set_setting(key, value):
    with _lock:
        _db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, value))
        _db.commit()
