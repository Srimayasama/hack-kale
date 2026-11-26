# AtmosScale AI · Odisha Cyclone Lab

An educational static-site prototype for exploring cyclone-related weather and compound-flood context across coastal Odisha. The page connects directly to free public data APIs, includes a compact NOAA historical cyclone-track subset, and runs without a server framework or API key.

## Run locally

The live AI track feed needs the small Python server in this project. In the project folder, create an environment, install its packages, and start the server:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py
```

Then open `http://127.0.0.1:8000`. Do not open `index.html` directly with `file://`: the browser cannot fetch the local cyclone archive or live model feed, and OpenStreetMap's tile service requires a valid HTTP referrer. Internet access is needed for ECMWF guidance, weather APIs, map tiles, and Leaflet. See the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Dashboard features

- **Five coastal Odisha forecast points:** Ganjam, Puri, Jagatsinghpur, Kendrapara and Bhadrak, fetched together through Open-Meteo's hourly forecast API.
- **72-hour local timeline:** inspect precipitation, precipitation probability, 10 m wind gusts and mean sea-level pressure hour by hour. Switch the chart and download a CSV for the selected location.
- **Interactive map:** forecast markers move with the selected hour; marker colour can represent wind gust, rain, or precipitation probability. OpenStreetMap attribution remains visible.
- **Local comparison list:** compare 72-hour rain totals and maximum forecast gusts for all five grid points.
- **River-flow context:** two representative GloFAS v4 daily river-discharge series, with the 25th–75th percentile ensemble range.
- **Nearshore context:** a marine forecast near Puri showing significant wave height and modelled sea-level height.
- **Historical cyclone replay:** 65 named tracks from NOAA NCEI IBTrACS v04r01 North Indian Ocean data. The included subset covers named storms since 1980 that passed through the Bay of Bengal focus box. Selecting a storm draws its archived track on the map.
- **Live AI cyclone guidance:** the server downloads ECMWF AIFS ensemble tropical-cyclone tracks from the latest available model run, decodes forecast centre, central pressure and maximum 10 m wind, then displays member paths in the Bay and Odisha watch boxes.
- **Four-stage track outlook:** review the selected model system at +24, +48, +72 and +96 hours, with median centre coordinates, pressure, an indicative wind band and the number of member tracks passing within 150 km of five Odisha coastal reference points. The map marks the four centres and the selected system's ensemble paths. Generate a shareable vector outlook graphic and download it as a high-resolution PNG.
- **AtmosScale trained forecast:** the project includes a saved Extra Trees model trained on NOAA IBTrACS Bay of Bengal cyclone histories. It forecasts centre movement, WMO wind and pressure at four horizons, and estimates the 34-kt wind radius where labels are available. On a live AIFS candidate, the model uses the first 24 hours of AIFS track output as motion context and displays its later path beside AIFS. The map draws the model path and experimental wind-radius circles.
- **Model training and evaluation:** run `python ml/train.py` to download the official NOAA North Indian Ocean CSV (if needed), prepare Bay of Bengal examples, fit the model, and save its weights and holdout metrics under `models/`. Raw CSV downloads stay out of Git.
- **Satellite model status:** this trained version uses best-track motion and intensity history. It does not yet ingest satellite pixels or atmospheric reanalysis fields; those are planned inputs for a later model version.

## Data sources and limitations

| Panel | Source | Resolution / meaning | Important limit |
| --- | --- | --- | --- |
| Weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Hourly numerical weather-model output at five requested coordinates | Grid points are not whole-district forecasts; provider data can be delayed or revised. Free API is for non-commercial use and requires attribution. |
| River flow | [Open-Meteo Flood API / GloFAS v4](https://open-meteo.com/en/docs/flood-api) | Daily simulated discharge and forecast ensemble percentiles at two model cells | About 5 km grid; a nearby river can be selected incorrectly, so confirm the cell against a gauge or river map. It is not an official flood warning. |
| Marine | [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) | Hourly wave height and sea-level height at one sea grid near Puri | Coastal sea-level accuracy is limited; it is not surge guidance, a tide-gauge observation, a navigation product, or an evacuation threshold. |
| Historical tracks | [NOAA NCEI IBTrACS v04r01](https://www.ncei.noaa.gov/products/international-best-track-archive) | Best-track positions from the North Indian Ocean basin | This is historical track data, not a forecast track. Recent records can be provisional; wind sources and quality vary across contributing agencies. |
| Live AI track guidance | [ECMWF AIFS Ensemble tropical cyclone tracks](https://www.ecmwf.int/en/forecasts/datasets/aifs-ens-tropical-cyclone-activity-including-genesis) | Real-time AI ensemble track output, with centre positions, central pressure and maximum 10 m wind; latest available run, up to 15 days | Ensemble members are guidance, not calibrated probabilities. Model storm IDs are not official cyclone names and do not guarantee cross-member storm identity. Follow IMD for official forecasts and warnings. |
| AtmosScale trained model | [NOAA NCEI IBTrACS v04r01](https://www.ncei.noaa.gov/products/international-best-track-archive) | Bay of Bengal historical positions, WMO wind/pressure, and sparse USA/JTWC 34-kt wind radii; final main tracks in 1980–2024 | Track-only learning; it does not use satellite imagery or environmental reanalysis yet. Wind-radius records are sparse and are not damage footprints. Live inference uses AIFS forecast points as an approximate motion-history seed. |
| Satellite imagery (planned) | [IMD INSAT satellite services](https://mausam.imd.gov.in/imd_latest/contents/satmet.php) and [NOAA HURSAT](https://www.ncei.noaa.gov/products/hurricane-satellite-data) | INSAT-3D/3DR products for current monitoring; historical HURSAT-B1 imagery for research and training | Satellite pixels are not ingested by this prototype. HURSAT-B1 ends in 2015, so it cannot stand in for a live feed or recent local training cases. |
| Map | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Interactive reference map tiles | Tiles load only as a viewer opens the map; attribution is displayed on the map. |

The compact track file is `data/ibtracs-bay-of-bengal.json`. It was derived from NOAA's North Indian Ocean CSV subset, keeps named tracks with at least one point inside 7–24°N and 78–94°E since 1980, and clips each retained path to the map display bounds. It retains time, location, WMO and USA wind fields, and WMO pressure where available. The displayed peak wind names the agency field used; wind averaging conventions differ across sources. Source file and access date are recorded in the JSON metadata.

Open-Meteo's free API is non-commercial and its data require CC BY 4.0 attribution. Keep the attribution shown in the website if you reuse it. Check [Open-Meteo's current terms](https://open-meteo.com/en/terms) before publishing or changing how the prototype is used.

## Train or retrain the model

The checked-in `models/cyclone_forecaster.joblib` is the trained model artifact used by the dashboard. To retrain it from the NOAA source, with the virtual environment active, run:

```sh
python ml/train.py
```

The script downloads the 27 MB North Indian Ocean IBTrACS CSV into the ignored `data/raw/` folder, filters Bay of Bengal main tracks through 2024, creates six-hour history windows, then trains separate regressors for 24, 48, 72 and 96 hours ahead. It saves a new model and its evaluation report under `models/`. NOAA best-track files include a units row after their column names; the loader handles that row.

Training uses 1980–2014 seasons; the later 2015–2024 seasons are held out by storm for evaluation. The current model has 178 training storms and 50 holdout storms with usable examples.

| Forecast lead | ML centre mean error | Linear-motion baseline | Wind MAE | Pressure MAE | 34-kt radius MAE |
| --- | ---: | ---: | ---: | ---: | ---: |
| +24 h | 149.5 km | 164.7 km | 10.1 kt | 6.1 hPa | 56.3 km |
| +48 h | 309.0 km | 377.9 km | 15.8 kt | 9.6 hPa | 53.8 km |
| +72 h | 455.0 km | 615.7 km | 17.1 kt | 11.1 hPa | 57.7 km |
| +96 h | 600.8 km | 854.9 km | 16.9 kt | 10.0 hPa | 60.0 km |

The centre model beat the simple linear-motion baseline on this held-out set, but its errors are still hundreds of kilometres at longer leads. These are prototype results, not a claim of operational accuracy. More detail and sample counts are stored in `models/model_metadata.json`.

## What the trained model does not claim

This is a track-history model, not a satellite-image classifier or a full physics-based forecast system. It predicts the path of a system already present in the AIFS cyclone guidance; it does not predict cyclone formation. It predicts centre, wind and pressure from cyclone history. It has no historical wind-radius labels for most storms, so the radius model is trained on a smaller USA/JTWC subset and is only an experimental 34-kt wind-radius estimate. A wind-radius circle is not an impact boundary, and nearby coastal points are only screening references. The live model's first 24 hours come from ECMWF AIFS; AtmosScale's learned forecast is generated beyond that context. Its hindcast errors are not calibrated uncertainty intervals or impact probabilities. Follow IMD and OSDMA for operational guidance.

## Next model improvements

The next useful upgrades are to add historical atmospheric predictors such as sea-surface temperature and steering winds; find archived forecasts so a local model can learn when AIFS errors are largest; add better-verified storm size labels; and later test satellite imagery for centre detection. Any added model should be compared against simple persistence and official forecast baselines on storms kept out of training.

## Publish with GitHub Pages

After the repository is pushed to GitHub, a static GitHub Pages copy can host the dashboard UI. The live ECMWF BUFR feed needs a server or a scheduled data-update workflow; GitHub Pages alone cannot run `server.py`.
