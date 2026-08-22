"""Append-only transcript autosave under the active profile's transcript root."""

from pathlib import Path

from hermes_constants import get_hermes_home
from tools.path_security import has_traversal_component, validate_within_dir


def _profile_home(profile: str | None = None) -> Path:
    requested = (profile or "").strip()
    if not requested or requested.lower() == "current":
        return get_hermes_home()

    from hermes_cli import profiles

    try:
        profiles.validate_profile_name(requested)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    if not profiles.profile_exists(requested):
        raise ValueError(f"Profile '{requested}' does not exist.")
    return profiles.get_profile_dir(requested)


def transcripts_root(profile: str | None = None) -> Path:
    return _profile_home(profile) / "transcripts"


def append_transcript_entry(rel_path: str, text: str, profile: str | None = None) -> None:
    """Append non-empty text to a safe relative path, without logging it."""
    if not isinstance(rel_path, str) or not rel_path.strip():
        raise ValueError("path must not be empty")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("text must not be empty")
    path = Path(rel_path)
    if path.is_absolute():
        raise ValueError("path must be relative")
    if has_traversal_component(rel_path):
        raise ValueError("path must not contain '..' components")

    root = transcripts_root(profile)
    target = root / path
    error = validate_within_dir(target, root)
    if error:
        raise ValueError(error)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Re-check after creating parents so a pre-existing/supplied symlink cannot
    # redirect the append outside the profile transcript directory.
    error = validate_within_dir(target, root)
    if error:
        raise ValueError(error)
    with target.open("a", encoding="utf-8") as stream:
        stream.write(text.rstrip("\n") + "\n")
