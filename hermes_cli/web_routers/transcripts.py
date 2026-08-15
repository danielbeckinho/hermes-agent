"""Dashboard transcript-autosave route."""

from typing import Optional

from fastapi import APIRouter, HTTPException

from hermes_cli.transcript_autosave import append_transcript_entry
from hermes_cli.web_deps import late
from hermes_cli.web_models import TranscriptAutosaveAppend

router = APIRouter()
_config_profile_scope = late("_config_profile_scope")


@router.post("/api/dashboard/transcript-autosave")
def transcript_autosave_endpoint(
    body: TranscriptAutosaveAppend, profile: Optional[str] = None
):
    try:
        with _config_profile_scope(body.profile or profile):
            append_transcript_entry(body.path, body.text, body.profile)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail="profile not found") from exc
    return {"ok": True}
