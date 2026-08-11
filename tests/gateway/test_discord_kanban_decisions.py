"""Discord ingress for durable Kanban decisions."""
from pathlib import Path
from types import SimpleNamespace

import pytest

from hermes_cli import kanban_db as kb
from plugins.platforms.discord import adapter as discord_adapter
from plugins.platforms.discord.adapter import DiscordAdapter


@pytest.fixture
def decision(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    with kb.connect_closing() as conn:
        task_id = kb.create_task(conn, title="choice", assignee="worker")
        with kb.write_txn(conn):
            conn.execute("UPDATE tasks SET status='blocked', block_kind='needs_input' WHERE id=?", (task_id,))
        record = kb.create_owner_decision(conn, task_id, owner_user_id="42", choices=["A"])
        assert kb.bind_decision_presentation(conn, record["id"], chat_id="7", message_id="9")
    return task_id


def _message(*, author="42", content="A", reference="9"):
    return SimpleNamespace(
        author=SimpleNamespace(id=author), id="10", content=content,
        channel=SimpleNamespace(id="7"),
        reference=SimpleNamespace(message_id=reference) if reference else None,
    )


def test_direct_owner_reply_resolves_and_is_consumed(decision):
    adapter = object.__new__(DiscordAdapter)
    assert adapter._try_resolve_kanban_decision_reply(_message()) is True
    with kb.connect_closing() as conn:
        assert kb.get_task(conn, decision).status == "ready"


def test_non_owner_or_non_reply_is_not_consumed(decision):
    adapter = object.__new__(DiscordAdapter)
    assert adapter._try_resolve_kanban_decision_reply(_message(author="43")) is False
    assert adapter._try_resolve_kanban_decision_reply(_message(reference=None)) is False
    with kb.connect_closing() as conn:
        assert kb.get_task(conn, decision).status == "blocked"


def test_persistent_decision_view_has_stable_button_ids():
    view_class = getattr(discord_adapter, "KanbanDecisionView", None)

    assert view_class is not None
    view = view_class("d_test", ["A", "B"])

    assert view.timeout is None
    assert [child.custom_id for child in view.children] == [
        "kanban-decision:d_test:A",
        "kanban-decision:d_test:B",
    ]


def test_pending_decision_view_is_registered_after_restart(decision):
    class Client:
        def __init__(self):
            self.views = []

        def add_view(self, view, *, message_id):
            self.views.append((view, message_id))

    adapter = object.__new__(DiscordAdapter)
    adapter._client = Client()
    adapter._register_pending_kanban_decision_views()

    assert len(adapter._client.views) == 1
    view, message_id = adapter._client.views[0]
    assert view.timeout is None
    assert message_id == 9
