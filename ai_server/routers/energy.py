"""Energy label prediction endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

LABEL_ORDER = ["A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"]


class EnergyInput(BaseModel):
    zone_id: Optional[str] = None
    wall_rc: float = 0.0
    roof_rc: float = 0.0
    floor_rc: float = 0.0
    window_u: float = 2.8
    installation_efficiency: float = 0.85
    construction_year: Optional[int] = None
    gross_area_m2: Optional[float] = None


@router.post("/predict")
async def predict_energy_label(data: EnergyInput):
    total_rc = data.wall_rc + data.roof_rc + data.floor_rc

    # NTA 8800-inspired simplified label assignment
    if   total_rc >= 12 and data.window_u <= 0.8:  label = "A++++"
    elif total_rc >= 9  and data.window_u <= 1.0:  label = "A+++"
    elif total_rc >= 7  and data.window_u <= 1.2:  label = "A++"
    elif total_rc >= 5  and data.window_u <= 1.5:  label = "A+"
    elif total_rc >= 3.5:                           label = "A"
    elif total_rc >= 2.5:                           label = "B"
    elif total_rc >= 1.5:                           label = "C"
    elif total_rc >= 1.0:                           label = "D"
    elif total_rc >= 0.5:                           label = "E"
    elif total_rc > 0:                              label = "F"
    else:                                           label = "G"

    # Estimated primary energy demand (kWh/m²·yr) — simplified
    base_demand = max(0, 300 - total_rc * 20 + data.window_u * 15)
    eff_factor  = max(0.5, data.installation_efficiency)
    primary_energy = base_demand / eff_factor

    return {
        "zone_id": data.zone_id,
        "energy_label": label,
        "primary_energy_demand_kwh_m2_yr": round(primary_energy, 1),
        "total_rc": round(total_rc, 3),
        "window_u": data.window_u,
        "label_index": LABEL_ORDER.index(label),
        "confidence": "rule_based",
    }
