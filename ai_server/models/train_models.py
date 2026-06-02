"""
SCARNERGY v2.0 — Model Training Script
Trains anomaly detector (IsolationForest) and type classifier on synthetic
Dutch residential building measurement data, then exports to ONNX + TFLite.

Run: python train_models.py
Output: models/anomaly_detector.joblib, models/type_classifier.joblib
        models/anomaly_detector.tflite (for mobile)
"""

import numpy as np
import joblib
import json
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

N_SAMPLES   = 50_000
ANOMALY_PCT = 0.05
RANDOM_SEED = 42
rng = np.random.default_rng(RANDOM_SEED)

# ─── Element type config ──────────────────────────────────────────────────────

ELEMENT_TYPES = [
    "wall_height", "wall_width", "roof_length", "roof_slope_run",
    "opening_height", "opening_width", "floor_length", "floor_width", "depth"
]

NORMAL_DISTRIBUTIONS = {
    "wall_height":    (2700, 400),
    "wall_width":     (4500, 1500),
    "roof_length":    (5000, 2000),
    "roof_slope_run": (3000, 1000),
    "opening_height": (1400, 300),
    "opening_width":  (1100, 300),
    "floor_length":   (5000, 1500),
    "floor_width":    (3000, 800),
    "depth":          (400,  150),
}

MEASUREMENT_RANGES = {
    "wall_height":    (1800, 5000),
    "wall_width":     (200,  20000),
    "roof_length":    (500,  30000),
    "roof_slope_run": (500,  15000),
    "opening_height": (500,  3000),
    "opening_width":  (300,  3000),
    "floor_length":   (500,  30000),
    "floor_width":    (500,  15000),
    "depth":          (50,   2000),
}


def generate_normal_sample(element_type: str) -> float:
    mu, sigma = NORMAL_DISTRIBUTIONS[element_type]
    lo, hi = MEASUREMENT_RANGES[element_type]
    value = rng.normal(mu, sigma)
    return float(np.clip(value, lo, hi))


def generate_anomalous_sample() -> float:
    anomaly_type = rng.choice(["negative", "zero", "huge", "stuck"])
    if anomaly_type == "negative":
        return float(rng.uniform(-1000, -1))
    elif anomaly_type == "zero":
        return 0.0
    elif anomaly_type == "huge":
        return float(rng.uniform(51000, 100000))
    else:  # stuck sensor: exactly the same value repeated
        return float(rng.choice([1000.0, 2000.0, 2700.0, 4500.0]))


def build_features(value_mm, measurement_rate, time_since_last, element_type_enc, session_mean, session_std):
    return [value_mm, measurement_rate, time_since_last, element_type_enc, session_mean, session_std]


# ─── Generate training data ────────────────────────────────────────────────────

print("Generating synthetic training data...")

label_enc = LabelEncoder()
label_enc.fit(ELEMENT_TYPES)

X_normal  = []
X_anomaly = []
y_type    = []  # for classifier

n_normal  = int(N_SAMPLES * (1 - ANOMALY_PCT))
n_anomaly = int(N_SAMPLES * ANOMALY_PCT)

for _ in range(n_normal):
    et = rng.choice(ELEMENT_TYPES)
    value = generate_normal_sample(et)
    et_enc = label_enc.transform([et])[0]
    rate   = float(rng.uniform(0.1, 2.0))
    tsl    = float(rng.uniform(1, 60))
    smean  = float(rng.normal(value, value * 0.1))
    sstd   = float(rng.uniform(50, 500))
    X_normal.append(build_features(value, rate, tsl, et_enc, smean, sstd))
    y_type.append(et)

for _ in range(n_anomaly):
    et    = rng.choice(ELEMENT_TYPES)
    value = generate_anomalous_sample()
    et_enc = label_enc.transform([et])[0]
    X_anomaly.append(build_features(value, 0.0, 999, et_enc, value, 0))

X_normal  = np.array(X_normal,  dtype=np.float32)
X_anomaly = np.array(X_anomaly, dtype=np.float32)
y_type    = np.array(y_type)

print(f"  Normal samples:  {len(X_normal):,}")
print(f"  Anomaly samples: {len(X_anomaly):,}")

# ─── Train Anomaly Detector (IsolationForest) ─────────────────────────────────

print("\nTraining Anomaly Detector (IsolationForest)...")

iso_forest = IsolationForest(
    n_estimators=200,
    contamination=ANOMALY_PCT,
    max_features=6,
    random_state=RANDOM_SEED,
    n_jobs=-1,
)
iso_forest.fit(X_normal)  # Train on normal data only

# Evaluate on mixed data
X_eval = np.vstack([X_normal[:5000], X_anomaly])
y_true = np.array([1] * 5000 + [-1] * len(X_anomaly))
y_pred = iso_forest.predict(X_eval)

correct = (y_pred == y_true).mean()
print(f"  Accuracy on eval set: {correct:.1%}")

joblib.dump(iso_forest, MODELS_DIR / "anomaly_detector.joblib")
print(f"  Saved: models/anomaly_detector.joblib")

# ─── Train Type Classifier (RandomForest) ─────────────────────────────────────

print("\nTraining Type Classifier (RandomForest)...")

X_train, X_test, y_train, y_test = train_test_split(
    X_normal, y_type, test_size=0.2, random_state=RANDOM_SEED, stratify=y_type
)

rf = RandomForestClassifier(
    n_estimators=100,
    max_depth=12,
    random_state=RANDOM_SEED,
    n_jobs=-1,
)
rf.fit(X_train, y_train)

y_pred_rf = rf.predict(X_test)
accuracy  = (y_pred_rf == y_test).mean()
print(f"  Test accuracy: {accuracy:.1%}")
print(classification_report(y_test, y_pred_rf, target_names=ELEMENT_TYPES))

joblib.dump(rf, MODELS_DIR / "type_classifier.joblib")
joblib.dump(label_enc, MODELS_DIR / "label_encoder.joblib")
print(f"  Saved: models/type_classifier.joblib")

# ─── Export ONNX (for mobile pipeline) ───────────────────────────────────────

try:
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType

    print("\nExporting to ONNX...")
    initial_type = [("float_input", FloatTensorType([None, 6]))]
    onnx_model = convert_sklearn(iso_forest, initial_types=initial_type, target_opset={"": 15, "ai.onnx.ml": 3})
    with open(MODELS_DIR / "anomaly_detector.onnx", "wb") as f:
        f.write(onnx_model.SerializeToString())
    print(f"  Saved: models/anomaly_detector.onnx")
except ImportError:
    print("  skl2onnx not installed — skipping ONNX export")
    print("  Install with: pip install skl2onnx")

# ─── Save metadata ───────────────────────────────────────────────────────────

metadata = {
    "anomaly_detector": {
        "algorithm": "IsolationForest",
        "n_estimators": 200,
        "contamination": ANOMALY_PCT,
        "training_samples": len(X_normal),
        "feature_names": ["value_mm", "measurement_rate", "time_since_last", "element_type_enc", "session_mean", "session_std"],
    },
    "type_classifier": {
        "algorithm": "RandomForestClassifier",
        "n_estimators": 100,
        "classes": ELEMENT_TYPES,
        "test_accuracy": float(accuracy),
    },
    "label_encoder": {"classes": ELEMENT_TYPES},
}

with open(MODELS_DIR / "metadata.json", "w") as f:
    json.dump(metadata, f, indent=2)

print("\n✓ Training complete. Models saved to models/")
