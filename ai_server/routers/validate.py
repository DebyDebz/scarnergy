"""Measurement validation and classification endpoints."""

from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

ELEMENT_TYPE_ENC = {
    "wall_height": 0, "wall_width": 1, "roof_length": 2, "roof_slope_run": 3,
    "opening_height": 4, "opening_width": 5, "floor_length": 6, "floor_width": 7, "depth": 8
}


class MeasurementIn(BaseModel):
    id: str
    value_mm: float
    measurement_type: Optional[str] = None
    session_id: Optional[str] = None
    element_id: Optional[str] = None
    measurement_rate: float = 1.0
    time_since_last: float = 10.0
    session_mean: float = 0.0
    session_std: float = 100.0


class ValidationResult(BaseModel):
    id: str
    is_anomaly: bool
    anomaly_score: float
    classifier_label: str
    classifier_confidence: float
    validation_result: str
    validation_message: Optional[str] = None


def build_features(m: MeasurementIn) -> list[float]:
    et_enc = ELEMENT_TYPE_ENC.get(m.measurement_type or "", 0)
    return [m.value_mm, m.measurement_rate, m.time_since_last,
            et_enc, m.session_mean or m.value_mm, m.session_std or 100.0]


@router.post("", response_model=ValidationResult)
async def validate_single(m: MeasurementIn, request: Request):
    models = request.app.state.models
    features = build_features(m)
    is_anomaly, score   = models.predict_anomaly(features)
    label, confidence   = models.predict_type(features)
    return ValidationResult(
        id=m.id,
        is_anomaly=is_anomaly,
        anomaly_score=score,
        classifier_label=label,
        classifier_confidence=confidence,
        validation_result="anomaly" if is_anomaly else "pass",
        validation_message=f"Anomaly score {score:.4f}" if is_anomaly else None,
    )


@router.post("/batch")
async def validate_batch(body: dict, request: Request):
    measurements = body.get("measurements", [])
    models = request.app.state.models
    results = []
    for m_dict in measurements:
        m = MeasurementIn(**m_dict)
        features = build_features(m)
        is_anomaly, score = models.predict_anomaly(features)
        label, confidence = models.predict_type(features)
        results.append({
            "id": m.id,
            "is_anomaly": is_anomaly,
            "anomaly_score": score,
            "classifier_label": label,
            "classifier_confidence": confidence,
            "validation_result": "anomaly" if is_anomaly else "pass",
        })
    return {"results": results, "processed": len(results)}
