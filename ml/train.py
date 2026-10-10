"""Train the indoor event classifier from samples labeled during the event.

Collect data with the dashboard's "Label" buttons (or POST /api/label) while doing things to
the sensor: e.g. "normal", "chemical" (hand sanitizer / marker / cleaner near it),
"breath" (breathing on it), "covered" (hand over the light sensor). Aim for 30+ per label,
spread over at least 2 separate sessions per label (e.g. sanitizer now, again 10 minutes later).

    python ml/train.py

Writes ml/model.joblib, which the server loads automatically on next start.

Accuracy is cross-validated by *session*: clicks of one label in a row are near-identical
1 Hz readings of the same event, so a random split would test on copies of the training data
and overstate accuracy.
"""
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ml.features import features  # noqa: E402
from server.clarity import solar_elevation  # noqa: E402
from server.sky import LAT, LON  # noqa: E402
from server.store import DB_PATH  # noqa: E402

SESSION_GAP = 60  # seconds between clicks that start a new labeling session


def sessions(rows):
    """Group id per (ts, label) row (sorted by ts): a new session starts when the label changes
    or after a SESSION_GAP pause."""
    ids, sid = [], -1
    for i, (ts, label) in enumerate(rows):
        if i == 0 or label != rows[i - 1][1] or ts - rows[i - 1][0] > SESSION_GAP:
            sid += 1
        ids.append(sid)
    return ids


def main():
    import joblib
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import StratifiedGroupKFold, cross_val_score

    rows = sqlite3.connect(DB_PATH).execute(
        "SELECT ts, label, air, baseline, rate, light FROM labels ORDER BY ts").fetchall()
    if len(rows) < 20:
        sys.exit(f"only {len(rows)} labeled samples - collect more first")

    X = [features(air, base, rate, light, solar_elevation(LAT, LON, datetime.fromtimestamp(ts, timezone.utc)))
         for ts, _, air, base, rate, light in rows]
    y = [r[1] for r in rows]
    groups = sessions([(r[0], r[1]) for r in rows])
    labels = sorted(set(y))
    per_label = {l: len({g for g, lab in zip(groups, y) if lab == l}) for l in labels}
    print("samples per label:", {l: y.count(l) for l in labels})
    print("sessions per label:", per_label)

    clf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=0)
    folds = min(5, min(per_label.values()))
    if folds >= 2:
        scores = cross_val_score(clf, X, y, groups=groups, cv=StratifiedGroupKFold(n_splits=folds))
        print(f"{folds}-fold session-grouped accuracy: {scores.mean():.2f} +/- {scores.std():.2f}")
    else:
        print("label every class in at least 2 separate sessions to get an honest accuracy estimate")
    clf.fit(X, y)
    joblib.dump(clf, ROOT / "ml" / "model.joblib")
    print("saved ml/model.joblib")


if __name__ == "__main__":
    main()
