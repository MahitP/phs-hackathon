import pytest
from fastapi.testclient import TestClient

from server import app as appmod

# No `with TestClient(...)`: lifespan (sensor/sky threads) stays off; we drive state directly.
client = TestClient(appmod.app)


@pytest.fixture(autouse=True)
def no_token(monkeypatch):
    monkeypatch.setattr(appmod, "TOKEN", None)


def test_unknown_mock_action_is_404_not_500():
    assert client.post("/api/mock/explode").status_code == 404


def test_label_validation():
    assert client.post("/api/label", json={}).status_code == 400
    assert client.post("/api/label", json={"label": ""}).status_code == 400
    assert client.post("/api/label", json={"label": "x" * 100}).status_code == 400


def test_calibrate_validation():
    assert client.post("/api/calibrate", json={"what": "nope"}).status_code == 400
    assert client.post("/api/calibrate", json={"what": "air"}).status_code == 503  # no reading yet


def test_history_minutes_clamped():
    assert client.get("/api/history?minutes=999999").status_code == 200
    assert client.get("/api/history?minutes=-5").status_code == 200


def test_token_protects_writes_but_not_reads(monkeypatch):
    monkeypatch.setattr(appmod, "TOKEN", "s3cret")
    assert client.post("/api/replay", json={"on": False}).status_code == 401
    assert client.post("/api/replay", json={"on": False}, headers={"X-SkyWindow-Token": "s3cret"}).status_code == 200
    assert client.get("/api/history").status_code == 200


def test_report_cooldown_reuses_recent_report(monkeypatch):
    calls = []
    monkeypatch.setattr(appmod.report, "generate", lambda s: calls.append(1) or {"text": "hi", "engine": "t", "facts": ""})
    monkeypatch.setitem(appmod.state, "verdict", {"key": "open"})
    monkeypatch.setattr(appmod, "last_report", {})
    client.post("/api/report", json={})
    client.post("/api/report", json={})
    assert len(calls) == 1
    monkeypatch.setitem(appmod.state, "verdict", {"key": "shut"})  # verdict changed -> fresh report
    client.post("/api/report", json={})
    assert len(calls) == 2


def test_model_with_wrong_feature_count_is_ignored():
    class Old:
        n_features_in_ = 4

    assert appmod.check_model(Old()) is None
