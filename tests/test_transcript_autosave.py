"""Transcript autosave path and append security tests."""

import os

import pytest

from hermes_cli.transcript_autosave import append_transcript_entry


@pytest.fixture
def hermes_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    return tmp_path


def test_appends_utf8_line_and_creates_parents(hermes_home):
    append_transcript_entry("notes/session.txt", "héllo wörld")
    assert (hermes_home / "transcripts/notes/session.txt").read_text(encoding="utf-8") == "héllo wörld\n"


def test_appends_each_entry_once(hermes_home):
    append_transcript_entry("log.txt", "first")
    append_transcript_entry("log.txt", "second")
    assert (hermes_home / "transcripts/log.txt").read_text() == "first\nsecond\n"


@pytest.mark.parametrize("path", ["", "   ", "/etc/passwd", "../escape", "a/../../escape"])
def test_rejects_invalid_paths(path, hermes_home):
    with pytest.raises(ValueError):
        append_transcript_entry(path, "text")


def test_rejects_symlink_escape(hermes_home):
    root = hermes_home / "transcripts"
    root.mkdir()
    outside = hermes_home / "outside"
    outside.mkdir()
    os.symlink(outside, root / "evil")
    with pytest.raises(ValueError):
        append_transcript_entry("evil/session.txt", "text")


def test_rejects_empty_text(hermes_home):
    with pytest.raises(ValueError):
        append_transcript_entry("log.txt", " ")


def test_named_profile_uses_its_transcript_root(tmp_path, monkeypatch):
    from hermes_cli import profiles

    profile_home = tmp_path / "profile"
    monkeypatch.setattr(profiles, "validate_profile_name", lambda name: None)
    monkeypatch.setattr(profiles, "profile_exists", lambda name: name == "writer")
    monkeypatch.setattr(profiles, "get_profile_dir", lambda name: profile_home)

    append_transcript_entry("daily.txt", "olá", profile="writer")

    assert (profile_home / "transcripts/daily.txt").read_text(encoding="utf-8") == "olá\n"
