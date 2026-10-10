"""Train the indoor event classifier from samples labeled during the event.

Collect data with the dashboard's "Label" buttons (or POST /api/label) while doing things to
the sensor: e.g. "normal", "chemical" (hand sanitizer / marker / cleaner near it),
"breath" (breathing on it), "covered" (hand over the light sensor). Aim for 30+ per label.

    python ml/train.py

Writes ml/model.joblib, which the server loads automatically on next start.
"""
import sqlite3
import sys
from pathlib import Path

import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ml.features import features  # noqa: E402

rows = sqlite3.connect(ROOT / "data" / "skywindow.db").execute(
    "SELECT label, air, baseline, rate, light FROM labels").fetchall()
if len(rows) < 20:
    sys.exit(f"only {len(rows)} labeled samples - collect more first")

X = [features(air, base, rate, light) for _, air, base, rate, light in rows]
y = [r[0] for r in rows]
labels = sorted(set(y))
print("samples per label:", {l: y.count(l) for l in labels})

clf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=0)
if min(y.count(l) for l in labels) >= 5:
    scores = cross_val_score(clf, X, y, cv=5)
    print(f"5-fold cross-validated accuracy: {scores.mean():.2f} +/- {scores.std():.2f}")
clf.fit(X, y)
joblib.dump(clf, ROOT / "ml" / "model.joblib")
print("saved ml/model.joblib")
