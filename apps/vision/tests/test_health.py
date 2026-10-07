from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_ok_on_cpu():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["device"] == "cpu"
    assert body["model"] is None
