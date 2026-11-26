"""Train and serve a compact historical-track cyclone forecast model.

This model is a research prototype. It learns track and intensity patterns from
historical best tracks; it is not an operational numerical weather model.
"""

from __future__ import annotations

import csv
import json
import math
import os
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
MODEL_DIR = ROOT / "models"
MODEL_PATH = MODEL_DIR / "cyclone_forecaster.joblib"
METADATA_PATH = MODEL_DIR / "model_metadata.json"
_MODEL_CACHE: dict | None = None
_MODEL_CACHE_MTIME: float | None = None
IBTRACS_URL = (
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-"
    "climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.NI.list.v04r01.csv"
)
IBTRACS_LOCAL_PATH = RAW_DIR / "ibtracs.NI.list.v04r01.csv"
LEADS = (24, 48, 72, 96)
TRAINING_END_YEAR = 2024  # Exclude recent provisional best-track seasons.
LAGS = (6, 12, 24)
FEATURE_NAMES = (
    "current_lat",
    "current_lon",
    "lat_change_6h",
    "lon_change_6h",
    "lat_change_12h",
    "lon_change_12h",
    "lat_change_24h",
    "lon_change_24h",
    "wind_now_kt",
    "wind_change_6h_kt",
    "wind_change_12h_kt",
    "pressure_now_hpa",
    "pressure_change_6h_hpa",
    "pressure_change_12h_hpa",
    "month_sin",
    "month_cos",
)


def _float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > -900 else None


def _nearest(points: list[dict], target: datetime, tolerance_hours: float = 1.51) -> dict | None:
    if not points:
        return None
    point = min(points, key=lambda item: abs((item["time"] - target).total_seconds()))
    return point if abs((point["time"] - target).total_seconds()) <= tolerance_hours * 3600 else None


def _parse_ibtracs(path: Path) -> dict[str, list[dict]]:
    """Read the official two-header-row NOAA CSV and retain Bay of Bengal tracks."""
    groups: dict[str, list[dict]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8-sig") as source:
        rows = csv.DictReader(source)
        next(rows, None)  # NOAA's units row follows the column-name row.
        for row in rows:
            try:
                season = int(row.get("SEASON", ""))
                time = datetime.strptime(row["ISO_TIME"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except (KeyError, ValueError):
                continue
            if season < 1980 or season > TRAINING_END_YEAR:
                continue
            if row.get("BASIN") != "NI" or row.get("SUBBASIN") != "BB":
                continue
            track_type = (row.get("TRACK_TYPE") or "").strip().lower()
            if "provisional" in track_type or (track_type and track_type != "main"):
                continue
            lat, lon = _float(row.get("LAT")), _float(row.get("LON"))
            if lat is None or lon is None or not (0 <= lat <= 35 and 65 <= lon <= 110):
                continue
            # WMO_WIND is the North Indian Ocean responsible agency's wind
            # estimate (normally IMD's 3-minute mean), kept separate from USA_WIND.
            wind = _float(row.get("WMO_WIND"))
            pressure = _float(row.get("WMO_PRES"))
            # USA quadrant radii are useful for an experimental size model, but
            # are sparse and use the USA/JTWC 34-kt wind-radius convention.
            radii = [_float(row.get(f"USA_R34_{quadrant}")) for quadrant in ("NE", "SE", "SW", "NW")]
            valid_radii = [radius for radius in radii if radius is not None and 0 < radius <= 600]
            r34_nm = float(np.mean(valid_radii)) if valid_radii else None
            item = {
                "time": time,
                "lat": lat,
                "lon": lon,
                "windKt": wind,
                "pressureHpa": pressure,
                "r34Km": None if r34_nm is None else r34_nm * 1.852,
                "distanceToLandKm": _float(row.get("DIST2LAND")),
                "season": season,
                "sid": row.get("SID", ""),
                "name": row.get("NAME", ""),
            }
            groups[item["sid"]].append(item)
    for points in groups.values():
        points.sort(key=lambda item: item["time"])
    return {sid: points for sid, points in groups.items() if len(points) >= 5}


def _feature_row(points: list[dict], anchor: dict) -> list[float]:
    now = anchor["time"]
    values: dict[str, float] = {
        "current_lat": anchor["lat"],
        "current_lon": anchor["lon"],
        "wind_now_kt": anchor.get("windKt"),
        "pressure_now_hpa": anchor.get("pressureHpa"),
        "month_sin": math.sin(2 * math.pi * now.month / 12),
        "month_cos": math.cos(2 * math.pi * now.month / 12),
    }
    lag_points: dict[int, dict | None] = {}
    for lag in LAGS:
        previous = _nearest(points, now - timedelta(hours=lag))
        lag_points[lag] = previous
        values[f"lat_change_{lag}h"] = None if previous is None else anchor["lat"] - previous["lat"]
        values[f"lon_change_{lag}h"] = None if previous is None else anchor["lon"] - previous["lon"]
    for lag in (6, 12):
        previous = lag_points[lag]
        values[f"wind_change_{lag}h_kt"] = (
            None if previous is None or anchor.get("windKt") is None or previous.get("windKt") is None
            else anchor["windKt"] - previous["windKt"]
        )
        values[f"pressure_change_{lag}h_hpa"] = (
            None if previous is None or anchor.get("pressureHpa") is None or previous.get("pressureHpa") is None
            else anchor["pressureHpa"] - previous["pressureHpa"]
        )
    return [np.nan if values.get(name) is None else float(values[name]) for name in FEATURE_NAMES]


def make_training_rows(groups: dict[str, list[dict]]) -> tuple[dict[int, list[dict]], dict]:
    by_lead: dict[int, list[dict]] = {lead: [] for lead in LEADS}
    storms_with_rows: set[str] = set()
    radius_storms: set[str] = set()
    for sid, points in groups.items():
        for anchor in points:
            # Use standard six-hour synoptic anchors to limit near-duplicate rows.
            if anchor["time"].hour % 6 != 0:
                continue
            if any(_nearest(points, anchor["time"] - timedelta(hours=lag)) is None for lag in LAGS):
                continue
            features = _feature_row(points, anchor)
            for lead in LEADS:
                target = _nearest(points, anchor["time"] + timedelta(hours=lead))
                if target is None:
                    continue
                by_lead[lead].append({
                    "sid": sid,
                    "season": anchor["season"],
                    "features": features,
                    "latDelta": target["lat"] - anchor["lat"],
                    "lonDelta": target["lon"] - anchor["lon"],
                    "windKt": target.get("windKt"),
                    "pressureHpa": target.get("pressureHpa"),
                    "r34Km": target.get("r34Km"),
                    "anchor": anchor,
                    "target": target,
                })
                storms_with_rows.add(sid)
                if target.get("r34Km") is not None:
                    radius_storms.add(sid)
    summary = {
        "stormCount": len(storms_with_rows),
        "radiusStormCount": len(radius_storms),
        "rowsByLead": {str(lead): len(rows) for lead, rows in by_lead.items()},
        "radiusRowsByLead": {
            str(lead): sum(row["r34Km"] is not None for row in rows)
            for lead, rows in by_lead.items()
        },
    }
    return by_lead, summary


def _new_model() -> Any:
    return make_pipeline(
        SimpleImputer(strategy="median", add_indicator=True),
        ExtraTreesRegressor(
            n_estimators=140,
            max_depth=14,
            min_samples_leaf=4,
            max_features=0.9,
            n_jobs=-1,
            random_state=42,
        ),
    )


def _haversine_km(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    lat_a, lon_a, lat_b, lon_b = map(math.radians, (lat_a, lon_a, lat_b, lon_b))
    dlat, dlon = lat_b - lat_a, lon_b - lon_a
    value = math.sin(dlat / 2) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(min(1.0, value)))


def _mae(actual: list[float], predicted: list[float]) -> float | None:
    if not actual:
        return None
    return float(np.mean(np.abs(np.asarray(actual) - np.asarray(predicted))))


def train_model(csv_path: Path = IBTRACS_LOCAL_PATH) -> dict:
    """Fit a storm-held-out Extra Trees model and write its bundle and metadata."""
    if not csv_path.exists():
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        print(f"Downloading official NOAA IBTrACS North Indian Ocean data to {csv_path}")
        urllib.request.urlretrieve(IBTRACS_URL, csv_path)
    groups = _parse_ibtracs(csv_path)
    rows_by_lead, data_summary = make_training_rows(groups)
    if not any(rows_by_lead.values()):
        raise RuntimeError("No trainable Bay of Bengal examples were found in the IBTrACS file.")

    seasons = sorted({point["season"] for points in groups.values() for point in points})
    split_index = max(1, min(len(seasons) - 1, int(len(seasons) * 0.78)))
    holdout_start_year = seasons[split_index]
    bundle: dict[str, Any] = {"leads": LEADS, "featureNames": FEATURE_NAMES, "models": {}, "metrics": {}}
    metric_rows: dict[str, dict] = {}
    train_sids: set[str] = set()
    test_sids: set[str] = set()

    for lead, rows in rows_by_lead.items():
        train_rows = [row for row in rows if row["season"] < holdout_start_year]
        test_rows = [row for row in rows if row["season"] >= holdout_start_year]
        train_sids.update(row["sid"] for row in train_rows)
        test_sids.update(row["sid"] for row in test_rows)
        if len(train_rows) < 40 or len(test_rows) < 10:
            raise RuntimeError(f"Not enough samples for a storm-separated {lead} h training/evaluation split.")
        X_train = np.asarray([row["features"] for row in train_rows], dtype=float)
        X_test = np.asarray([row["features"] for row in test_rows], dtype=float)

        center_y = np.asarray([[row["latDelta"], row["lonDelta"]] for row in train_rows], dtype=float)
        center_model = _new_model().fit(X_train, center_y)
        center_pred = center_model.predict(X_test)
        center_errors = [
            _haversine_km(
                row["anchor"]["lat"] + float(pred[0]),
                row["anchor"]["lon"] + float(pred[1]),
                row["target"]["lat"],
                row["target"]["lon"],
            )
            for row, pred in zip(test_rows, center_pred)
        ]
        motion_baseline_errors = [
            _haversine_km(
                row["anchor"]["lat"] + float(row["features"][FEATURE_NAMES.index("lat_change_6h")]) * lead / 6,
                row["anchor"]["lon"] + float(row["features"][FEATURE_NAMES.index("lon_change_6h")]) * lead / 6,
                row["target"]["lat"],
                row["target"]["lon"],
            )
            for row in test_rows
        ]
        models = {"center": center_model}
        metrics = {
            "centerMeanErrorKm": float(np.mean(center_errors)),
            "centerMedianErrorKm": float(np.median(center_errors)),
            "linearMotionBaselineMeanErrorKm": float(np.mean(motion_baseline_errors)),
            "testExamples": len(test_rows),
        }

        for target_name, metric_name, unit, minimum in (
            ("windKt", "windMaeKt", "kt", 30),
            ("pressureHpa", "pressureMaeHpa", "hPa", 30),
            ("r34Km", "r34MaeKm", "km", 60),
        ):
            target_train = [row for row in train_rows if row.get(target_name) is not None]
            target_test = [row for row in test_rows if row.get(target_name) is not None]
            if len(target_train) < minimum or len(target_test) < 5:
                metrics[metric_name] = None
                continue
            regressor = _new_model().fit(
                np.asarray([row["features"] for row in target_train], dtype=float),
                np.asarray([row[target_name] for row in target_train], dtype=float),
            )
            predicted = np.asarray(regressor.predict(np.asarray([row["features"] for row in target_test], dtype=float))).reshape(-1)
            actual = [float(row[target_name]) for row in target_test]
            metrics[metric_name] = _mae(actual, predicted)
            metrics[f"{metric_name}Examples"] = len(target_test)
            if target_name == "windKt":
                persistence = [row["anchor"].get("windKt") for row in target_test]
                pairs = [(float(value), float(row[target_name])) for value, row in zip(persistence, target_test) if value is not None]
                metrics["windPersistenceMaeKt"] = _mae([target for _, target in pairs], [value for value, _ in pairs]) if pairs else None
            elif target_name == "pressureHpa":
                persistence = [row["anchor"].get("pressureHpa") for row in target_test]
                pairs = [(float(value), float(row[target_name])) for value, row in zip(persistence, target_test) if value is not None]
                metrics["pressurePersistenceMaeHpa"] = _mae([target for _, target in pairs], [value for value, _ in pairs]) if pairs else None
            models[target_name] = regressor

        bundle["models"][str(lead)] = models
        metric_rows[str(lead)] = metrics

    trained_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    metadata = {
        "status": "trained",
        "modelName": "AtmosScale Bay of Bengal Extra Trees",
        "algorithm": "Extra Trees regression with median imputation",
        "trainedAt": trained_at,
        "source": "NOAA NCEI IBTrACS v04r01 North Indian Ocean CSV; Bay of Bengal sub-basin; final main tracks, 1980–2024",
        "trainingEndYear": TRAINING_END_YEAR,
        "holdoutStartYear": holdout_start_year,
        "stormCount": data_summary["stormCount"],
        "filteredArchiveStormCount": len(groups),
        "trainStormCount": len(train_sids),
        "holdoutStormCount": len(test_sids),
        "dataSummary": data_summary,
        "metrics": metric_rows,
        "features": list(FEATURE_NAMES),
        "targets": ["centre latitude/longitude", "WMO wind", "WMO pressure", "USA/JTWC 34-kt wind radius where present"],
        "limitations": [
            "Track-only model: it does not use live satellite pixels or atmospheric reanalysis fields.",
            "Wind labels follow North Indian Ocean WMO reports and can have varying averaging conventions.",
            "34-kt wind-radius labels come from USA/JTWC fields and are sparse; the radius is not a damage boundary.",
            "The live seed uses ECMWF AIFS forecast points as a motion history proxy, not observed past fixes.",
            "Held-out errors are research diagnostics, not calibrated confidence bounds or warning thresholds.",
        ],
    }
    bundle["metadata"] = metadata
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, MODEL_PATH, compress=3)
    METADATA_PATH.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def get_model_metadata() -> dict:
    if not METADATA_PATH.exists():
        return {"status": "not-trained", "message": "Run python ml/train.py to train the model."}
    try:
        return json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "not-trained", "message": "Model metadata could not be read; retrain the model."}


def _model_bundle() -> dict:
    global _MODEL_CACHE, _MODEL_CACHE_MTIME
    if not MODEL_PATH.exists():
        raise FileNotFoundError("The AtmosScale trained model is not installed. Run python ml/train.py first.")
    modified_at = MODEL_PATH.stat().st_mtime
    if _MODEL_CACHE is not None and _MODEL_CACHE_MTIME == modified_at:
        return _MODEL_CACHE
    _MODEL_CACHE = joblib.load(MODEL_PATH)
    _MODEL_CACHE_MTIME = modified_at
    return _MODEL_CACHE


def _live_feature_row(points: list[dict], anchor_lead: int = 24) -> list[float]:
    """Map AIFS member/median points to the historical model's lag features."""
    def point_at(lead: int) -> dict | None:
        if not points:
            return None
        ordered = sorted(points, key=lambda item: float(item.get("leadHours", 10_000)))
        exact = min(ordered, key=lambda item: abs(float(item.get("leadHours", 10_000)) - lead))
        if abs(float(exact.get("leadHours", 10_000)) - lead) <= 3.1:
            return exact
        before = [point for point in ordered if float(point.get("leadHours", -1)) < lead]
        after = [point for point in ordered if float(point.get("leadHours", 10_000)) > lead]
        if not before or not after:
            return None
        low, high = before[-1], after[0]
        low_lead, high_lead = float(low["leadHours"]), float(high["leadHours"])
        if high_lead - low_lead > 12 or not (low_lead < lead < high_lead):
            return None
        fraction = (lead - low_lead) / (high_lead - low_lead)
        estimated = {"leadHours": lead}
        for key in ("lat", "lon", "windKmh", "pressureHpa"):
            left, right = _float(low.get(key)), _float(high.get(key))
            estimated[key] = None if left is None or right is None else left + fraction * (right - left)
        return estimated

    anchor = point_at(anchor_lead)
    if anchor is None:
        raise ValueError("The live track does not contain a usable +24-hour context point.")
    previous = {lag: point_at(anchor_lead - lag) for lag in LAGS}
    if any(previous[lag] is None for lag in LAGS):
        raise ValueError("The live track needs points near +0, +12, +18 and +24 hours before ML can forecast.")

    def wind_kt(point: dict | None) -> float | None:
        value = _float(None if point is None else point.get("windKmh"))
        return None if value is None else value / 1.852

    def pressure(point: dict | None) -> float | None:
        return _float(None if point is None else point.get("pressureHpa"))

    current_wind, current_pressure = wind_kt(anchor), pressure(anchor)
    timestamp_value = anchor.get("validAt")
    try:
        timestamp = datetime.fromisoformat(str(timestamp_value).replace("Z", "+00:00")) if timestamp_value else datetime.now(timezone.utc)
    except ValueError:
        timestamp = datetime.now(timezone.utc)
    values: dict[str, float | None] = {
        "current_lat": _float(anchor.get("lat")),
        "current_lon": _float(anchor.get("lon")),
        "wind_now_kt": current_wind,
        "pressure_now_hpa": current_pressure,
        "month_sin": math.sin(2 * math.pi * timestamp.month / 12),
        "month_cos": math.cos(2 * math.pi * timestamp.month / 12),
    }
    for lag, prior in previous.items():
        values[f"lat_change_{lag}h"] = float(anchor["lat"]) - float(prior["lat"])
        values[f"lon_change_{lag}h"] = float(anchor["lon"]) - float(prior["lon"])
    for lag in (6, 12):
        prior = previous[lag]
        prior_wind, prior_pressure = wind_kt(prior), pressure(prior)
        values[f"wind_change_{lag}h_kt"] = None if current_wind is None or prior_wind is None else current_wind - prior_wind
        values[f"pressure_change_{lag}h_hpa"] = None if current_pressure is None or prior_pressure is None else current_pressure - prior_pressure
    return [np.nan if values.get(name) is None else float(values[name]) for name in FEATURE_NAMES]


def _imd_wind_band(speed_kmh: float | None) -> str | None:
    if speed_kmh is None:
        return None
    if speed_kmh < 31:
        return "Depression range"
    if speed_kmh < 50:
        return "Deep depression range"
    if speed_kmh < 62:
        return "Cyclonic storm range"
    if speed_kmh < 89:
        return "Severe cyclonic storm range"
    if speed_kmh < 118:
        return "Very severe cyclonic storm range"
    if speed_kmh < 168:
        return "Extremely severe cyclonic storm range"
    return "Super cyclonic storm range"


def predict_live(points: list[dict], run_time: datetime) -> dict:
    """Forecast 24–96 h beyond the first 24 h of live AIFS track context."""
    bundle = _model_bundle()
    metadata = bundle["metadata"]
    X = np.asarray([_live_feature_row(points)], dtype=float)
    anchor = min(points, key=lambda item: abs(float(item.get("leadHours", 10_000)) - 24))
    anchor_lead = int(anchor.get("leadHours", 24))
    stages = []
    for model_lead in LEADS:
        models = bundle["models"][str(model_lead)]
        center_delta = np.asarray(models["center"].predict(X)[0], dtype=float)
        lat = max(-90.0, min(90.0, float(anchor["lat"]) + center_delta[0]))
        lon = ((float(anchor["lon"]) + center_delta[1] + 180) % 360) - 180
        wind_kt = None if "windKt" not in models else max(0.0, float(np.asarray(models["windKt"].predict(X)).reshape(-1)[0]))
        pressure = None if "pressureHpa" not in models else float(np.asarray(models["pressureHpa"].predict(X)).reshape(-1)[0])
        radius_km = None if "r34Km" not in models else max(0.0, float(np.asarray(models["r34Km"].predict(X)).reshape(-1)[0]))
        lead_from_run = anchor_lead + model_lead
        stages.append({
            "leadHours": lead_from_run,
            "modelLeadHours": model_lead,
            "validAt": (run_time + timedelta(hours=lead_from_run)).isoformat().replace("+00:00", "Z"),
            "lat": round(lat, 3),
            "lon": round(lon, 3),
            "windKmh": None if wind_kt is None else round(wind_kt * 1.852, 1),
            "pressureHpa": None if pressure is None else round(pressure, 1),
            "windBand": _imd_wind_band(None if wind_kt is None else wind_kt * 1.852),
            "r34RadiusKm": None if radius_km is None else round(radius_km, 1),
            "centerHoldoutMeanErrorKm": metadata["metrics"][str(model_lead)].get("centerMeanErrorKm"),
            "linearMotionBaselineMeanErrorKm": metadata["metrics"][str(model_lead)].get("linearMotionBaselineMeanErrorKm"),
            "r34HoldoutMaeKm": metadata["metrics"][str(model_lead)].get("r34MaeKm"),
        })
    return {
        "status": "ok",
        "modelName": metadata["modelName"],
        "trainedAt": metadata["trainedAt"],
        "holdoutStartYear": metadata["holdoutStartYear"],
        "trainingStormCount": metadata["trainStormCount"],
        "holdoutStormCount": metadata["holdoutStormCount"],
        "anchorLeadHours": anchor_lead,
        "stages": stages,
        "metrics": metadata["metrics"],
        "limitations": metadata["limitations"],
        "source": metadata["source"],
    }


def training_main() -> None:
    metadata = train_model()
    print(f"Trained {metadata['modelName']}")
    print(f"Usable storms: {metadata['stormCount']} total · {metadata['trainStormCount']} training · {metadata['holdoutStormCount']} holdout")
    print(f"Holdout seasons start: {metadata['holdoutStartYear']}")
    for lead, metrics in metadata["metrics"].items():
        print(
            f"+{lead} h: centre mean error {metrics['centerMeanErrorKm']:.1f} km "
            f"(linear motion {metrics['linearMotionBaselineMeanErrorKm']:.1f} km) · "
            f"wind MAE {metrics['windMaeKt'] if metrics['windMaeKt'] is not None else 'n/a'} kt · "
            f"pressure MAE {metrics['pressureMaeHpa'] if metrics['pressureMaeHpa'] is not None else 'n/a'} hPa · "
            f"34-kt radius MAE {metrics['r34MaeKm'] if metrics['r34MaeKm'] is not None else 'n/a'} km"
        )
    print(f"Saved model to {MODEL_PATH}")
    print(f"Saved metadata to {METADATA_PATH}")
