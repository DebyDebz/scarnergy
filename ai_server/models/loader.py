"""Model loader — loads joblib artifacts at startup."""

import joblib
import logging
from pathlib import Path
from typing import Optional
import numpy as np

logger = logging.getLogger("scarnergy.models")
MODELS_DIR = Path(__file__).parent


class ModelRegistry:
    def __init__(self):
        self.loaded: dict = {}
        self.anomaly_detector = None
        self.type_classifier  = None
        self.label_encoder    = None

    def load_all(self):
        for name, filename in [
            ("anomaly_detector", "anomaly_detector.joblib"),
            ("type_classifier",  "type_classifier.joblib"),
            ("label_encoder",    "label_encoder.joblib"),
        ]:
            path = MODELS_DIR / filename
            if path.exists():
                setattr(self, name, joblib.load(path))
                self.loaded[name] = str(path)
                logger.info(f"Loaded {name} from {path}")
            else:
                logger.warning(f"Model not found: {path} — run models/train_models.py first")

    def predict_anomaly(self, features: list[float]) -> tuple[bool, float]:
        """Returns (is_anomaly, score). Score: more negative = more anomalous."""
        if not self.anomaly_detector:
            return False, 0.0
        X = np.array([features], dtype=np.float32)
        pred  = self.anomaly_detector.predict(X)[0]   # 1=normal, -1=anomaly
        score = self.anomaly_detector.score_samples(X)[0]
        return pred == -1, float(score)

    def predict_type(self, features: list[float]) -> tuple[str, float]:
        """Returns (measurement_type, confidence)."""
        if not self.type_classifier or not self.label_encoder:
            return "unknown", 0.0
        X     = np.array([features], dtype=np.float32)
        proba = self.type_classifier.predict_proba(X)[0]
        idx   = int(np.argmax(proba))
        label = self.label_encoder.classes_[idx]
        return str(label), float(proba[idx])
