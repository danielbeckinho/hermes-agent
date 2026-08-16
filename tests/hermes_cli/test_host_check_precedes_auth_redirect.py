"""Host validation must wrap the dashboard auth redirect."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hermes_cli import web_server
from hermes_cli.dashboard_auth import clear_providers, register_provider
from tests.hermes_cli.conftest_dashboard_auth import StubAuthProvider


@pytest.fixture
def canary_app():
    clear_providers()
    register_provider(StubAuthProvider())
    previous = {
        key: getattr(web_server.app.state, key, None)
        for key in ("bound_host", "bound_port", "auth_required", "allowed_hosts")
    }
    web_server.app.state.bound_host = "100.81.246.101"
    web_server.app.state.bound_port = 9119
    web_server.app.state.auth_required = True
    web_server.app.state.allowed_hosts = frozenset({"node-01.tail6ba6bf.ts.net"})
    yield TestClient(web_server.app, base_url="http://100.81.246.101:9119")
    clear_providers()
    for key, value in previous.items():
        setattr(web_server.app.state, key, value)


def test_invalid_host_rejected_before_auth_redirect(canary_app):
    response = canary_app.get("/", headers={"Host": "evil.example"}, follow_redirects=False)

    assert response.status_code == 400
    assert "Invalid Host header" in response.json()["detail"]


def test_allowed_alias_reaches_normal_auth_response(canary_app):
    response = canary_app.get(
        "/",
        headers={"Host": "node-01.tail6ba6bf.ts.net"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert "/login" in response.headers.get("location", "")