#!/usr/bin/env python3
"""Local dashboard server with live ECMWF AIFS and AtmosScale ML endpoints."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import numpy as np
from eccodes.highlevel import BUFRMessage
from ecmwf.opendata import Client


ROOT = Path(__file__).resolve().parent
CACHE_SECONDS = 30 * 60
BAY_BOX = {"south": 4.0, "north": 25.0, "west": 78.0, "east": 100.0}
NORTH_BAY_BOX = {"south": 10.0, "north": 24.0, "west": 78.0, "east": 92.0}
ODISHA_WATCH_BOX = {"south": 14.0, "north": 23.0, "west": 80.0, "east": 90.0}
OUTLOOK_LEADS = (24, 48, 72, 96)
TRACK_NEAR_RADIUS_KM = 150.0
COASTAL_REFERENCE_POINTS = (
    {"name": "Ganjam · Gopalpur", "district": "Ganjam", "lat": 19.36, "lon": 84.98},
    {"name": "Puri", "district": "Puri", "lat": 19.813, "lon": 85.831},
    {"name": "Jagatsinghpur · Paradip", "district": "Jagatsinghpur", "lat": 20.267, "lon": 86.17},
    {"name": "Kendrapara coast", "district": "Kendrapara", "lat": 20.51, "lon": 86.42},
    {"name": "Bhadrak · Dhamra", "district": "Bhadrak", "lat": 21.055, "lon": 86.496},
)
cache_lock = threading.Lock()
cached_guidance: dict | None = None
cached_at = 0.0


def _flat_values(value):
    if value is None:
        return []
    array = np.ma.asarray(value)
    if array.ndim == 0:
        return [array.item()]
    return list(array.reshape(-1))


def _plain(value):
    if value is None or np.ma.is_masked(value):
        return None
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return value


def _rank_value(ranked: dict, rank: int, field: str, member_index: int):
    values = _flat_values(ranked.get(f"#{rank}#{field}"))
    if not values:
        return None
    value = values[member_index] if len(values) > 1 else values[0]
    return _plain(value)


def _wind_band(speed_kmh: float | None) -> str | None:
    """Give an indicative band using IMD wind thresholds as a reference."""
    if speed_kmh is None:
        return None
    if speed_kmh < 31:
        return "Low pressure area range"
    if speed_kmh < 50:
        return "Depression range"
    if speed_kmh < 62:
        return "Deep depression range"
    if speed_kmh < 89:
        return "Cyclonic storm range"
    if speed_kmh < 118:
        return "Severe cyclonic storm range"
    if speed_kmh < 168:
        return "Very severe cyclonic storm range"
    if speed_kmh < 222:
        return "Extremely severe cyclonic storm range"
    return "Super cyclonic storm range"


def _point_from_ranked(ranked: dict, member_index: int, lead: int, position_rank: int, scalar_rank: int, run_time: datetime) -> dict | None:
    lat = _rank_value(ranked, position_rank, "latitude", member_index)
    lon = _rank_value(ranked, position_rank, "longitude", member_index)
    if lat is None or lon is None:
        return None
    lat = float(lat)
    lon = float(lon)
    if not (-90 <= lat <= 90):
        return None
    if lon > 180:
        lon -= 360
    if not (-180 <= lon <= 180) or (abs(lat) < 0.01 and abs(lon) < 0.01):
        return None
    pressure_pa = _rank_value(ranked, scalar_rank, "pressureReducedToMeanSeaLevel", member_index)
    wind_ms = _rank_value(ranked, scalar_rank, "windSpeedAt10M", member_index)
    wind_kmh = None if wind_ms is None else float(wind_ms) * 3.6
    pressure_hpa = None if pressure_pa is None else float(pressure_pa) / 100
    return {
        "leadHours": int(lead),
        "validAt": (run_time + timedelta(hours=lead)).isoformat().replace("+00:00", "Z"),
        "lat": round(lat, 3),
        "lon": round(lon, 3),
        "windKmh": None if wind_kmh is None else round(wind_kmh, 1),
        "pressureHpa": None if pressure_hpa is None else round(pressure_hpa, 1),
    }


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    value = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 6371.0 * 2 * asin(sqrt(min(1.0, value)))


def _inside(point: dict, box: dict) -> bool:
    return (
        box["south"] <= point["lat"] <= box["north"]
        and box["west"] <= point["lon"] <= box["east"]
    )


def _run_time_from_header(header) -> datetime:
    return datetime(
        int(header["typicalYear"]),
        int(header["typicalMonth"]),
        int(header["typicalDay"]),
        int(header["typicalHour"]),
        int(header.get("typicalMinute", 0)),
        tzinfo=timezone.utc,
    )


def _read_tracks(path: str) -> tuple[datetime | None, dict[str, list[dict]]]:
    run_time = None
    grouped: dict[str, list[dict]] = {}
    with open(path, "rb") as source:
        while True:
            try:
                message = BUFRMessage(source)
            except EOFError:
                break
            with message:
                message.unpack()
                if run_time is None:
                    run_time = _run_time_from_header(message.header)
                ranked = message.data.as_dict(ranked=True)
                storm_ids = [_plain(value) for value in _flat_values(ranked.get("#1#stormIdentifier"))]
                member_ids = [_plain(value) for value in _flat_values(ranked.get("#1#ensembleMemberNumber"))]
                member_count = max(len(storm_ids), len(member_ids), int(message.header["numberOfSubsets"]))
                lead_ranks = sorted(
                    int(key.split("#")[1])
                    for key in ranked
                    if key.endswith("#timePeriod")
                )
                for member_index in range(member_count):
                    storm_id = storm_ids[member_index] if member_index < len(storm_ids) else (storm_ids[0] if storm_ids else "Unknown")
                    if not storm_id:
                        continue
                    points = []
                    # ECMWF's TC BUFR stores perturbed analysis centres at rank 2,
                    # then each forecast centre at ranks 4, 6, 8…; pressure and
                    # maximum 10 m wind are stored at ranks 1, 2, 3… respectively.
                    analysis = _point_from_ranked(ranked, member_index, 0, 2, 1, run_time)
                    if analysis:
                        points.append(analysis)
                    for period_rank in lead_ranks:
                        times = _flat_values(ranked.get(f"#{period_rank}#timePeriod"))
                        lead = _plain(times[member_index]) if member_index < len(times) else None
                        if lead is None:
                            continue
                        point = _point_from_ranked(
                            ranked,
                            member_index,
                            int(lead),
                            period_rank * 2 + 2,
                            period_rank + 1,
                            run_time,
                        )
                        if point:
                            points.append(point)

                    points.sort(key=lambda item: item["leadHours"])
                    member_id = member_ids[member_index] if member_index < len(member_ids) else member_index + 1
                    grouped.setdefault(str(storm_id), []).append({"member": int(member_id), "points": points})
    return run_time, grouped


def _region_path(points: list[dict], box: dict) -> list[dict]:
    return [point for point in points if _inside(point, box)]


def _forecast_stages(member_tracks: list[dict], run_time: datetime) -> list[dict]:
    stages = []
    for target_lead in OUTLOOK_LEADS:
        stage_points = [
            point
            for track in member_tracks
            for point in track["points"]
            if point["leadHours"] == target_lead
        ]
        if not stage_points:
            stages.append({"leadHours": target_lead, "validAt": (run_time + timedelta(hours=target_lead)).isoformat().replace("+00:00", "Z"), "members": 0})
            continue

        lat = float(np.median([point["lat"] for point in stage_points]))
        lon = float(np.median([point["lon"] for point in stage_points]))
        winds = [point["windKmh"] for point in stage_points if point.get("windKmh") is not None]
        pressures = [point["pressureHpa"] for point in stage_points if point.get("pressureHpa") is not None]

        nearby_places = []
        for place in COASTAL_REFERENCE_POINTS:
            distances = [_distance_km(point["lat"], point["lon"], place["lat"], place["lon"]) for point in stage_points]
            nearby_places.append({
                "district": place["district"],
                "name": place["name"],
                "memberTracksNear": sum(distance <= TRACK_NEAR_RADIUS_KM for distance in distances),
                "memberTracksTotal": len(distances),
                "medianDistanceKm": round(float(np.median(distances)), 1),
            })
        nearby_places.sort(key=lambda place: (-place["memberTracksNear"], place["medianDistanceKm"]))
        wind_kmh = round(float(np.median(winds)), 1) if winds else None
        stages.append({
            "leadHours": target_lead,
            "validAt": (run_time + timedelta(hours=target_lead)).isoformat().replace("+00:00", "Z"),
            "lat": round(lat, 3),
            "lon": round(lon, 3),
            "windKmh": wind_kmh,
            "pressureHpa": round(float(np.median(pressures)), 1) if pressures else None,
            "windBand": _wind_band(wind_kmh),
            "members": len(stage_points),
            "availableMemberTracks": len(member_tracks),
            "nearbyPlaces": nearby_places,
        })
    return stages


def _summarize_tracks(groups: dict[str, list[dict]], run_time: datetime, single_ids: set[str]) -> list[dict]:
    summaries = []
    for storm_id, member_tracks in groups.items():
        bay_tracks = []
        north_bay_tracks = []
        odisha_tracks = []
        bay_leads = []
        north_bay_leads = []
        odisha_leads = []
        lead_positions: dict[int, list[tuple[float, float]]] = {}
        all_candidate_positions: dict[int, list[dict]] = {}

        for track in member_tracks:
            bay_points = _region_path(track["points"], BAY_BOX)
            north_bay_points = _region_path(track["points"], NORTH_BAY_BOX)
            odisha_points = _region_path(track["points"], ODISHA_WATCH_BOX)
            if len(bay_points) >= 2:
                bay_tracks.append({"member": track["member"], "points": bay_points})
                for point in track["points"]:
                    all_candidate_positions.setdefault(point["leadHours"], []).append(point)
                bay_leads.extend(point["leadHours"] for point in bay_points)
                for point in bay_points:
                    lead_positions.setdefault(point["leadHours"], []).append(point)
            if len(north_bay_points) >= 2:
                north_bay_tracks.append({"member": track["member"], "points": north_bay_points})
                north_bay_leads.extend(point["leadHours"] for point in north_bay_points)
            if len(odisha_points) >= 2:
                odisha_tracks.append({"member": track["member"], "points": odisha_points})
                odisha_leads.extend(point["leadHours"] for point in odisha_points)

        if len(bay_tracks) < 2:
            continue

        median_path = []
        for lead, positions in sorted(lead_positions.items()):
            if len(positions) < 2:
                continue
            winds = [point["windKmh"] for point in positions if point.get("windKmh") is not None]
            pressures = [point["pressureHpa"] for point in positions if point.get("pressureHpa") is not None]
            median_path.append({
                "leadHours": lead,
                "validAt": (run_time + timedelta(hours=lead)).isoformat().replace("+00:00", "Z"),
                "lat": round(float(np.median([point["lat"] for point in positions])), 3),
                "lon": round(float(np.median([point["lon"] for point in positions])), 3),
                "windKmh": round(float(np.median(winds)), 1) if winds else None,
                "pressureHpa": round(float(np.median(pressures)), 1) if pressures else None,
                "members": len(positions),
            })

        context_path = []
        for lead, positions in sorted(all_candidate_positions.items()):
            winds = [point["windKmh"] for point in positions if point.get("windKmh") is not None]
            pressures = [point["pressureHpa"] for point in positions if point.get("pressureHpa") is not None]
            context_path.append({
                "leadHours": lead,
                "validAt": (run_time + timedelta(hours=lead)).isoformat().replace("+00:00", "Z"),
                "lat": round(float(np.median([point["lat"] for point in positions])), 3),
                "lon": round(float(np.median([point["lon"] for point in positions])), 3),
                "windKmh": round(float(np.median(winds)), 1) if winds else None,
                "pressureHpa": round(float(np.median(pressures)), 1) if pressures else None,
                "members": len(positions),
            })

        summaries.append({
            "stormId": storm_id,
            "availableMemberTracks": len(member_tracks),
            "bayPathCount": len(bay_tracks),
            "northBayPathCount": len(north_bay_tracks),
            "odishaPathCount": len(odisha_tracks),
            "bayLeadStart": min(bay_leads) if bay_leads else None,
            "bayLeadEnd": max(bay_leads) if bay_leads else None,
            "northBayLeadStart": min(north_bay_leads) if north_bay_leads else None,
            "northBayLeadEnd": max(north_bay_leads) if north_bay_leads else None,
            "odishaLeadStart": min(odisha_leads) if odisha_leads else None,
            "odishaLeadEnd": max(odisha_leads) if odisha_leads else None,
            "singleModelAlsoForecasts": storm_id in single_ids,
            "bayTracks": bay_tracks,
            "odishaTracks": odisha_tracks,
            "medianPath": median_path,
            "contextPath": context_path,
            "forecastStages": _forecast_stages(bay_tracks, run_time),
        })
    return sorted(summaries, key=lambda item: (-item["bayPathCount"], item["stormId"]))


def trained_forecast(storm_id: str) -> dict:
    """Run the saved historical ML model using the selected live AIFS candidate."""
    from ml.cyclone_forecaster import get_model_metadata, predict_live

    metadata = get_model_metadata()
    if metadata.get("status") != "trained":
        return {"status": "unavailable", "message": metadata.get("message", "Train the model before requesting a forecast.")}
    guidance = get_live_guidance()
    if guidance.get("status") not in {"ok", "stale"}:
        return {"status": "unavailable", "message": "Live AIFS context is not available, so the trained model has no current storm state to use."}
    storm = next((item for item in guidance.get("storms", []) if item.get("stormId") == storm_id), None)
    if not storm:
        return {"status": "unavailable", "message": "Select a current AIFS model system that has a Bay of Bengal track."}
    run_value = guidance.get("modelRun")
    if not run_value:
        return {"status": "unavailable", "message": "The AIFS model run time is missing."}
    run_time = datetime.fromisoformat(run_value.replace("Z", "+00:00"))
    try:
        payload = predict_live(storm.get("contextPath", []), run_time)
    except (ValueError, KeyError, FileNotFoundError) as error:
        return {"status": "unavailable", "message": str(error)}
    payload["stormId"] = storm_id
    payload["aifsModelRun"] = run_value
    return payload


def _retrieve_tracks(model: str, stream: str, run_time: datetime | None = None) -> tuple[datetime | None, dict[str, list[dict]]]:
    client = Client(
        source="ecmwf",
        model=model,
        maximum_retries=2,
        retry_after=5,
        use_server_retry_after=False,
    )
    suffix = "aifs-ens" if model == "aifs-ens" else "aifs-single"
    with tempfile.NamedTemporaryFile(prefix=f"atmoscale-{suffix}-", suffix=".bufr", delete=False) as temporary:
        target = temporary.name
    try:
        request = {"stream": stream, "type": "tf", "step": 360, "target": target}
        if run_time is not None:
            request["date"] = run_time.strftime("%Y-%m-%d")
            request["time"] = run_time.hour
        client.retrieve(**request)
        return _read_tracks(target)
    finally:
        try:
            os.unlink(target)
        except OSError:
            pass


def fetch_live_guidance() -> dict:
    run_time, ensemble_groups = _retrieve_tracks("aifs-ens", "enfo")
    if run_time is None:
        raise RuntimeError("ECMWF returned no AIFS ensemble track message for the latest run.")

    single_ids: set[str] = set()
    single_error = None
    try:
        single_run, single_groups = _retrieve_tracks("aifs-single", "oper", run_time)
        if single_run and single_run != run_time:
            raise RuntimeError("The AIFS single and ensemble files use different run times.")
        single_ids = set(single_groups)
    except Exception as error:  # Keep the ensemble product usable if its companion file is late.
        single_error = str(error)

    return {
        "status": "ok",
        "model": "ECMWF AIFS Ensemble",
        "modelRun": run_time.isoformat().replace("+00:00", "Z"),
        "retrievedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "forecastHorizonHours": 360,
        "bayBox": BAY_BOX,
        "northBayBox": NORTH_BAY_BOX,
        "odishaBox": ODISHA_WATCH_BOX,
        "trackNearRadiusKm": TRACK_NEAR_RADIUS_KM,
        "storms": _summarize_tracks(ensemble_groups, run_time, single_ids),
        "singleModelAvailable": single_error is None,
        "singleModelError": single_error,
        "attribution": "ECMWF AIFS open data · CC BY 4.0",
    }


def get_live_guidance(force: bool = False) -> dict:
    global cached_guidance, cached_at
    with cache_lock:
        if not force and cached_guidance and time.time() - cached_at < CACHE_SECONDS:
            return {**cached_guidance, "cacheAgeSeconds": int(time.time() - cached_at)}
        try:
            guidance = fetch_live_guidance()
        except Exception as error:
            if cached_guidance:
                return {
                    **cached_guidance,
                    "status": "stale",
                    "refreshError": str(error),
                    "cacheAgeSeconds": int(time.time() - cached_at),
                }
            return {"status": "error", "message": str(error)}
        cached_guidance = guidance
        cached_at = time.time()
        return {**guidance, "cacheAgeSeconds": 0}


class AtmosScaleHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/api/cyclone-guidance":
            force = "refresh=1" in parsed.query.split("&")
            payload = get_live_guidance(force=force)
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(200 if payload.get("status") != "error" else 503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/trained-forecast":
            query = parse_qs(parsed.query)
            storm_id = (query.get("stormId") or [""])[0]
            payload = trained_forecast(storm_id)
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(200 if payload.get("status") == "ok" else 503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), AtmosScaleHandler)
    print(f"AtmosScale AI is available at http://127.0.0.1:{port}")
    print("ECMWF AIFS guidance and the saved AtmosScale historical ML model load when requested by the page.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
