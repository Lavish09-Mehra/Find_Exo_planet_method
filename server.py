from __future__ import annotations

import math
import time
import warnings
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

warnings.filterwarnings("ignore", message="X does not have valid feature names")

BASE_DIR = Path(__file__).resolve().parent
ARTIFACT_PATH = BASE_DIR / "exoplanet_model.pkl"

if not ARTIFACT_PATH.exists():
    raise SystemExit(f"Model artifact not found: {ARTIFACT_PATH}")

ARTIFACT = joblib.load(ARTIFACT_PATH)
MODEL = ARTIFACT["model"]
SCALER = ARTIFACT["scaler"]
COLUMNS: list[str] = [str(c) for c in ARTIFACT["columns"]]
CLASSES: list[str] = [str(c) for c in ARTIFACT["classes"]]

app = Flask(__name__)
app.json.sort_keys = False


# ---------------------------------------------------------------------------
# Display metadata
# ---------------------------------------------------------------------------

FEATURE_LABELS = {
    "pl_pnum": "Planets in system",
    "pl_orbper": "Orbital period",
    "pl_orbpererr1": "Period uncertainty (+)",
    "pl_orbpererr2": "Period uncertainty (-)",
    "pl_orbperlim": "Period limit flag",
    "pl_radj": "Planet radius",
    "pl_radjerr1": "Radius uncertainty (+)",
    "pl_radjerr2": "Radius uncertainty (-)",
    "pl_radjlim": "Radius limit flag",
    "pl_ttvflag": "TTV flag",
    "pl_kepflag": "Kepler flag",
    "pl_k2flag": "K2 flag",
    "pl_nnotes": "Archive notes",
    "ra": "Right ascension",
    "dec": "Declination",
    "st_optmag": "V-band magnitude",
    "st_optmagblend": "Blended photometry",
    "st_teff": "Effective temperature",
    "st_tefferr1": "Teff uncertainty (+)",
    "st_tefferr2": "Teff uncertainty (-)",
    "st_tefflim": "Teff limit flag",
    "st_mass": "Stellar mass",
    "st_masserr1": "Mass uncertainty (+)",
    "st_masserr2": "Mass uncertainty (-)",
    "st_masslim": "Mass limit flag",
    "st_rad": "Stellar radius",
    "st_raderr1": "Radius uncertainty (+)",
    "st_raderr2": "Radius uncertainty (-)",
    "st_optband_Kepler-band": "Kepler band",
    "st_optband_V (Johnson)": "V band (Johnson)",
}

FEATURE_NOTES = {
    "pl_pnum": "How many planets are known around this host.",
    "pl_orbper": "Time for one complete orbit, in days.",
    "pl_radj": "Radius of the planet, in Jupiter radii.",
    "st_teff": "Photospheric temperature of the host star, in kelvin.",
    "st_mass": "Host-star mass, in solar masses.",
    "st_rad": "Host-star radius, in solar radii.",
    "st_optmag": "Optical brightness of the host star. Lower is brighter.",
    "ra": "Right ascension of the host star, in degrees.",
    "dec": "Declination of the host star, in degrees.",
}

PRIMARY_FIELDS = [
    {
        "name": "pl_pnum",
        "label": "Planets in system",
        "short": "Planets",
        "unit": "",
        "min": 1,
        "max": 8,
        "step": 1,
        "decimals": 0,
        "group": "planet",
    },
    {
        "name": "pl_orbper",
        "label": "Orbital period",
        "short": "Period",
        "unit": "days",
        "min": 0.3,
        "max": 6000,
        "step": 0.1,
        "decimals": 2,
        "log": True,
        "group": "planet",
    },
    {
        "name": "pl_radj",
        "label": "Planet radius",
        "short": "Radius",
        "unit": "Rjup",
        "min": 0.05,
        "max": 15,
        "step": 0.01,
        "decimals": 2,
        "log": True,
        "group": "planet",
    },
    {
        "name": "st_teff",
        "label": "Effective temperature",
        "short": "Temperature",
        "unit": "K",
        "min": 2500,
        "max": 9000,
        "step": 50,
        "decimals": 0,
        "group": "star",
    },
    {
        "name": "st_mass",
        "label": "Stellar mass",
        "short": "Stellar mass",
        "unit": "Msun",
        "min": 0.08,
        "max": 3,
        "step": 0.01,
        "decimals": 2,
        "group": "star",
    },
    {
        "name": "st_rad",
        "label": "Stellar radius",
        "short": "Stellar radius",
        "unit": "Rsun",
        "min": 0.08,
        "max": 5,
        "step": 0.01,
        "decimals": 2,
        "group": "star",
    },
    {
        "name": "st_optmag",
        "label": "V-band magnitude",
        "short": "Brightness",
        "unit": "mag",
        "min": 3,
        "max": 18,
        "step": 0.1,
        "decimals": 2,
        "group": "star",
    },
    {
        "name": "ra",
        "label": "Right ascension",
        "short": "RA",
        "unit": "deg",
        "min": 0,
        "max": 360,
        "step": 0.1,
        "decimals": 2,
        "group": "sky",
    },
    {
        "name": "dec",
        "label": "Declination",
        "short": "Dec",
        "unit": "deg",
        "min": -90,
        "max": 90,
        "step": 0.1,
        "decimals": 2,
        "group": "sky",
    },
]

DEFAULT_PROFILE = {
    "pl_pnum": 1,
    "pl_orbper": 300.0,
    "pl_radj": 1.0,
    "st_teff": 5700.0,
    "st_mass": 1.0,
    "st_rad": 1.0,
    "st_optmag": 8.0,
    "ra": 291.0,
    "dec": 44.5,
}

PRESETS = [
    {
        "id": "hot-jupiter",
        "name": "Hot Jupiter",
        "hint": "Short period \u00b7 giant planet",
        "values": {
            "pl_pnum": 1,
            "pl_orbper": 3.5,
            "pl_radj": 1.2,
            "st_teff": 5800.0,
            "st_mass": 1.05,
            "st_rad": 1.1,
            "st_optmag": 11.0,
            "ra": 290.0,
            "dec": 40.0,
        },
    },
    {
        "id": "rv-target",
        "name": "RV target",
        "hint": "Bright star \u00b7 long period",
        "values": {
            "pl_pnum": 2,
            "pl_orbper": 1790.0,
            "pl_radj": 1.61,
            "st_teff": 6111.0,
            "st_mass": 0.73,
            "st_rad": 0.95,
            "st_optmag": 6.92,
            "ra": 272.8,
            "dec": -19.73,
        },
    },
    {
        "id": "wide-orbit",
        "name": "Wide-orbit giant",
        "hint": "Very long period \u00b7 bright",
        "values": {
            "pl_pnum": 1,
            "pl_orbper": 5379.0,
            "pl_radj": 7.14,
            "st_teff": 6911.0,
            "st_mass": 1.59,
            "st_rad": 0.74,
            "st_optmag": 4.33,
            "ra": 301.1,
            "dec": -59.1,
        },
    },
    {
        "id": "kepler-field",
        "name": "Kepler candidate",
        "hint": "Faint star \u00b7 compact orbit",
        "values": {
            "pl_pnum": 1,
            "pl_orbper": 12.0,
            "pl_radj": 0.24,
            "st_teff": 5600.0,
            "st_mass": 0.95,
            "st_rad": 0.92,
            "st_optmag": 14.7,
            "ra": 291.4,
            "dec": 44.2,
        },
    },
]

CLASS_META = {
    "Transit": {
        "label": "Transit",
        "color": "#2457d6",
        "tagline": "A periodic dip in the star's light.",
        "description": (
            "The planet crosses in front of its host star, dimming it on a "
            "regular cadence. The model associates short periods, faint survey "
            "fields and compact orbits with this method."
        ),
    },
    "Radial Velocity": {
        "label": "Radial velocity",
        "color": "#b5472b",
        "tagline": "A repeating wobble in spectral lines.",
        "description": (
            "The star's spectrum shifts as it orbits the common centre of mass. "
            "Bright, long-period targets dominate this class in the archive."
        ),
    },
    "Other": {
        "label": "Other",
        "color": "#6b7168",
        "tagline": "Microlensing, imaging, timing, or a rarer route.",
        "description": (
            "A catch-all for discovery methods outside the two dominant "
            "photometric and spectroscopic channels."
        ),
    },
}

SWEEPS = {
    "pl_orbper": {
        "label": "Orbital period",
        "unit": "days",
        "min": 0.3,
        "max": 6000.0,
        "scale": "log",
    },
    "pl_radj": {
        "label": "Planet radius",
        "unit": "Rjup",
        "min": 0.05,
        "max": 15.0,
        "scale": "log",
    },
    "st_optmag": {
        "label": "V magnitude",
        "unit": "mag",
        "min": 3.0,
        "max": 18.0,
        "scale": "linear",
    },
    "st_teff": {
        "label": "Temperature",
        "unit": "K",
        "min": 2500.0,
        "max": 9000.0,
        "scale": "linear",
    },
    "st_mass": {
        "label": "Stellar mass",
        "unit": "Msun",
        "min": 0.08,
        "max": 3.0,
        "scale": "linear",
    },
}


# ---------------------------------------------------------------------------
# Artifact introspection
# ---------------------------------------------------------------------------


def _feature_importance() -> list[dict[str, Any]]:
    """Share of tree splits that use each feature (a lightweight proxy)."""

    counts = np.zeros(len(COLUMNS), dtype=float)
    try:
        for iteration in MODEL._predictors:
            for tree in iteration:
                nodes = tree.nodes
                is_leaf = nodes["is_leaf"].astype(bool)
                for feature_index in nodes["feature_idx"][~is_leaf]:
                    counts[int(feature_index)] += 1
    except Exception:
        return []

    total = counts.sum()
    if not total:
        return []

    ranked = np.argsort(-counts)
    out = []
    for index in ranked:
        if counts[index] <= 0:
            continue
        out.append(
            {
                "feature": COLUMNS[index],
                "label": FEATURE_LABELS.get(COLUMNS[index], COLUMNS[index]),
                "share": float(counts[index] / total),
            }
        )
    return out


def _safe_float(value: Any) -> float:
    if value is None or value == "":
        return math.nan
    try:
        number = float(value)
    except (TypeError, ValueError):
        return math.nan
    return number if math.isfinite(number) else math.nan


def _build_row(features: dict[str, Any] | None) -> dict[str, float]:
    """Map a partial payload onto the full 30-column row.

    Anything the user has not supplied stays NaN. HistGradientBoosting was
    trained with native missing-value support, so missing optional measurements
    are genuine information rather than zeros.
    """

    features = features or {}
    row: dict[str, float] = {column: math.nan for column in COLUMNS}
    for column in COLUMNS:
        if column in features:
            row[column] = _safe_float(features[column])

    # Paired uncertainties: the archive stores negative lower errors.
    pairs = {
        "pl_orbpererr1": "pl_orbpererr2",
        "pl_radjerr1": "pl_radjerr2",
        "st_tefferr1": "st_tefferr2",
        "st_masserr1": "st_masserr2",
        "st_raderr1": "st_raderr2",
    }
    for upper, lower in pairs.items():
        if upper in features and lower not in features:
            value = _safe_float(features[upper])
            row[lower] = -value if math.isfinite(value) else math.nan

    return row


def _predict_rows(rows: list[dict[str, float]]) -> np.ndarray:
    frame = pd.DataFrame(rows, columns=COLUMNS)
    scaled = SCALER.transform(frame)
    scaled_frame = pd.DataFrame(scaled, columns=COLUMNS)
    return MODEL.predict_proba(scaled_frame)


def _model_info() -> dict[str, Any]:
    size_mb = ARTIFACT_PATH.stat().st_size / (1024 * 1024)
    return {
        "estimator": type(MODEL).__name__,
        "iterations": int(getattr(MODEL, "n_iter_", 0)),
        "features": int(getattr(MODEL, "n_features_in_", len(COLUMNS))),
        "classes": len(CLASSES),
        "learning_rate": float(getattr(MODEL, "learning_rate", 0.0)),
        "max_leaf_nodes": int(getattr(MODEL, "max_leaf_nodes", 0)),
        "random_state": getattr(MODEL, "random_state", None),
        "artifact": ARTIFACT_PATH.name,
        "artifact_size_mb": round(size_mb, 2),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/meta")
def meta():
    return jsonify(
        {
            "model": _model_info(),
            "classes": [
                {
                    "key": name,
                    **CLASS_META.get(
                        name,
                        {
                            "label": name,
                            "color": "#6b7168",
                            "tagline": "",
                            "description": "",
                        },
                    ),
                }
                for name in CLASSES
            ],
            "primaryFields": PRIMARY_FIELDS,
            "defaults": DEFAULT_PROFILE,
            "presets": PRESETS,
            "sweeps": SWEEPS,
            "importance": _feature_importance()[:10],
        }
    )


@app.post("/api/predict")
def predict():
    started = time.perf_counter()
    payload = request.get_json(silent=True) or {}
    features = payload.get("features") or {}
    row = _build_row(features)
    probabilities = _predict_rows([row])[0]

    entries = [
        {"label": label, "value": float(value)}
        for label, value in zip(CLASSES, probabilities)
    ]
    best = max(entries, key=lambda item: item["value"])
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    return jsonify(
        {
            "prediction": best["label"],
            "confidence": best["value"],
            "probabilities": entries,
            "elapsed_ms": round(elapsed_ms, 2),
            "inputs_used": int(
                sum(1 for value in row.values() if math.isfinite(value))
            ),
            "total_inputs": len(COLUMNS),
        }
    )


@app.post("/api/sweep")
def sweep():
    payload = request.get_json(silent=True) or {}
    feature = payload.get("feature")
    if feature not in SWEEPS:
        return jsonify({"error": "Unknown sweep feature"}), 400

    spec = SWEEPS[feature]
    features = payload.get("features") or {}
    points = max(12, min(int(payload.get("points", 48)), 120))

    if spec["scale"] == "log":
        values = np.geomspace(spec["min"], spec["max"], points)
    else:
        values = np.linspace(spec["min"], spec["max"], points)

    rows = []
    for value in values:
        current = dict(features)
        current[feature] = float(value)
        rows.append(_build_row(current))

    probabilities = _predict_rows(rows)
    series = {
        label: [float(v) for v in probabilities[:, index]]
        for index, label in enumerate(CLASSES)
    }

    return jsonify(
        {
            "feature": feature,
            "values": [float(v) for v in values],
            "series": series,
            "meta": spec,
        }
    )


@app.get("/health")
def health():
    return jsonify({"status": "ok", "artifact": ARTIFACT_PATH.name})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
