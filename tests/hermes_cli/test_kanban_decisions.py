"""Durable owner-decision ledger regressions."""
import sqlite3
from pathlib import Path

import pytest

from hermes_cli import kanban_db as kb


@pytest.fixture
def conn(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    with kb.connect_closing() as connection:
        yield connection


def _held_task(conn):
    task_id = kb.create_task(conn, title="needs a choice", assignee="worker")
    with kb.write_txn(conn):
        conn.execute(
            "UPDATE tasks SET status='blocked', block_kind='needs_input' WHERE id=?",
            (task_id,),
        )
    return task_id


def test_decision_is_durable_and_only_resolves_bound_held_task(conn):
    held = _held_task(conn)
    other = _held_task(conn)
    decision = kb.create_owner_decision(conn, held, owner_user_id="42", choices=["A", "B"])
    assert kb.get_task(conn, held).status == "blocked"
    assert kb.bind_decision_presentation(conn, decision["id"], chat_id="7", message_id="9")
    result = kb.resolve_discord_decision(
        conn, decision["id"], task_id=held, chat_id="7", message_id="9",
        resolver_user_id="42", choice="A", response_message_id="10", response_kind="button",
    )
    assert result["resolved"] is True
    assert conn.execute(
        "SELECT response_kind FROM kanban_decisions WHERE id=?", (decision["id"],)
    ).fetchone()["response_kind"] == "button"
    assert kb.get_task(conn, held).status == "ready"
    assert kb.get_task(conn, other).status == "blocked"
    assert kb.claim_task(conn, held, claimer="dispatcher") is not None
    assert kb.resolve_discord_decision(
        conn, decision["id"], task_id=held, chat_id="7", message_id="9",
        resolver_user_id="42", choice="A", response_message_id="10",
    )["resolved"] is False


@pytest.mark.parametrize("owner,choices", [("name", ["A"]), ("４２", ["A"]), ("42", ["A", "A"]), ("42", [])])
def test_decision_creation_validates_owner_and_choices(conn, owner, choices):
    with pytest.raises(ValueError):
        kb.create_owner_decision(conn, _held_task(conn), owner_user_id=owner, choices=choices)


def test_wrong_owner_and_binding_leave_decision_held(conn):
    task_id = _held_task(conn)
    decision = kb.create_owner_decision(conn, task_id, owner_user_id="42", choices=["A"])
    assert kb.bind_decision_presentation(conn, decision["id"], chat_id="7", message_id="9")
    for kwargs in (
        {"resolver_user_id": "43", "chat_id": "7", "message_id": "9"},
        {"resolver_user_id": "42", "chat_id": "8", "message_id": "9"},
    ):
        assert not kb.resolve_discord_decision(
            conn, decision["id"], task_id=task_id, choice="A", response_message_id="10", **kwargs,
        )["resolved"]
    assert kb.get_task(conn, task_id).status == "blocked"


@pytest.mark.parametrize("chat_id,message_id", [("channel", "9"), ("7", "message"), ("７", "9")])
def test_decision_presentation_requires_numeric_discord_ids(conn, chat_id, message_id):
    decision = kb.create_owner_decision(
        conn, _held_task(conn), owner_user_id="42", choices=["A"],
    )

    with pytest.raises(ValueError, match="numeric"):
        kb.bind_decision_presentation(
            conn, decision["id"], chat_id=chat_id, message_id=message_id,
        )


def test_pending_decision_blocks_manual_promotion_until_cancelled(conn):
    task_id = _held_task(conn)
    decision = kb.create_owner_decision(conn, task_id, owner_user_id="42", choices=["A"])
    assert kb.promote_task(conn, task_id, actor="operator")[0] is False
    assert kb.cancel_owner_decision(conn, decision["id"], reason="replaced")
    assert kb.promote_task(conn, task_id, actor="operator")[0] is True


def test_pending_decision_cannot_be_completed(conn):
    task_id = _held_task(conn)
    kb.create_owner_decision(conn, task_id, owner_user_id="42", choices=["A"])
    assert kb.complete_task(conn, task_id, result="bypass") is False
    assert kb.get_task(conn, task_id).status == "blocked"


@pytest.mark.parametrize("status", ["ready", "review", "todo", "triage"])
def test_pending_decision_blocks_raw_status_bypass(conn, status):
    task_id = _held_task(conn)
    kb.create_owner_decision(conn, task_id, owner_user_id="42", choices=["A"])

    with pytest.raises(sqlite3.IntegrityError, match="pending owner decision"):
        conn.execute("UPDATE tasks SET status=? WHERE id=?", (status, task_id))

    assert kb.get_task(conn, task_id).status == "blocked"
