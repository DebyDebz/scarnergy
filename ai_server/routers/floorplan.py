"""Floor-plan detection endpoint (OpenCV-based, best-effort).

Accepts a floor-plan image and returns a normalised, editable-draft detection
of room boundary polygon(s) and elements (walls/doors/windows). Results are
approximate by design — the app pre-fills the manual wizard with them for the
inspector to review and adjust.
"""

from fastapi import APIRouter, UploadFile, File, Query, HTTPException
import logging

from cv.floorplan import detect

logger = logging.getLogger("scarnergy.ai")
router = APIRouter()


@router.post("/detect")
async def detect_floorplan(
    file: UploadFile = File(...),
    mode: str = Query("full", pattern="^(boundary|full)$"),
):
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty image upload")
    try:
        result = detect(contents, mode)
    except ValueError as e:
        # Undecodable / unsupported image — client should fall back to manual.
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:  # noqa: BLE001 — never 500 the client; degrade gracefully
        logger.exception("Floor-plan detection failed")
        return {"image_w": 0, "image_h": 0, "confidence": 0.0, "rooms": [], "error": str(e)}
    return result
