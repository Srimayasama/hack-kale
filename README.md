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
- **AI/ML project workflow:** the page outlines how INSAT imagery could feed cyclone detection, morphology classification and short-range track/intensity guidance. It clearly labels satellite ingestion and trained inference as not yet implemented.

## Data sources and limitations

| Panel | Source | Resolution / meaning | Important limit |
| --- | --- | --- | --- |
| Weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Hourly numerical weather-model output at five requested coordinates | Grid points are not whole-district forecasts; provider data can be delayed or revised. Free API is for non-commercial use and requires attribution. |
| River flow | [Open-Meteo Flood API / GloFAS v4](https://open-meteo.com/en/docs/flood-api) | Daily simulated discharge and forecast ensemble percentiles at two model cells | About 5 km grid; a nearby river can be selected incorrectly, so confirm the cell against a gauge or river map. It is not an official flood warning. |
| Marine | [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) | Hourly wave height and sea-level height at one sea grid near Puri | Coastal sea-level accuracy is limited; it is not surge guidance, a tide-gauge observation, a navigation product, or an evacuation threshold. |
| Historical tracks | [NOAA NCEI IBTrACS v04r01](https://www.ncei.noaa.gov/products/international-best-track-archive) | Best-track positions from the North Indian Ocean basin | This is historical track data, not a forecast track. Recent records can be provisional; wind sources and quality vary across contributing agencies. |
| Live AI track guidance | [ECMWF AIFS Ensemble tropical cyclone tracks](https://www.ecmwf.int/en/forecasts/datasets/aifs-ens-tropical-cyclone-activity-including-genesis) | Real-time AI ensemble track output, with centre positions, central pressure and maximum 10 m wind; latest available run, up to 15 days | Ensemble members are guidance, not calibrated probabilities. Model storm IDs are not official cyclone names and do not guarantee cross-member storm identity. Follow IMD for official forecasts and warnings. |
| Satellite imagery (planned) | [IMD INSAT satellite services](https://mausam.imd.gov.in/imd_latest/contents/satmet.php) and [NOAA HURSAT](https://www.ncei.noaa.gov/products/hurricane-satellite-data) | INSAT-3D/3DR products for current monitoring; historical HURSAT-B1 imagery for research and training | Satellite pixels are not ingested by this prototype. HURSAT-B1 ends in 2015, so it cannot stand in for a live feed or recent local training cases. |
| Map | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Interactive reference map tiles | Tiles load only as a viewer opens the map; attribution is displayed on the map. |

The compact track file is `data/ibtracs-bay-of-bengal.json`. It was derived from NOAA's North Indian Ocean CSV subset, keeps named tracks with at least one point inside 7–24°N and 78–94°E since 1980, and clips each retained path to the map display bounds. It retains time, location, WMO and USA wind fields, and WMO pressure where available. The displayed peak wind names the agency field used; wind averaging conventions differ across sources. Source file and access date are recorded in the JSON metadata.

Open-Meteo's free API is non-commercial and its data require CC BY 4.0 attribution. Keep the attribution shown in the website if you reuse it. Check [Open-Meteo's current terms](https://open-meteo.com/en/terms) before publishing or changing how the prototype is used.

## What it does not claim

The site displays a live external AI-model track ensemble, but does not train an Odisha-specific satellite classifier or identify cyclones directly from satellite pixels. The four-stage outlook shows ensemble median centres and coastal reference points within a 150 km track-proximity screen; it is not a validated affected-area footprint, landfall forecast or impact probability. Its wind bands compare ECMWF maximum 10 m model wind with IMD threshold ranges, but the wind definitions differ, so the bands are not official IMD classifications. A model showing no Odisha track is not a guarantee that no cyclone will form. Follow IMD and OSDMA for operational guidance.

## A sensible next implementation step

Add a reproducible historical-replay and validation pipeline: pair archived weather forecasts with verified gauge, tide and observed inundation data; define measurable local outcomes; compare with a simple baseline; and report uncertainty and failure cases. Only after that should the project present an Odisha-specific model or a new alert feature.

## Publish with GitHub Pages

After the repository is pushed to GitHub, a static GitHub Pages copy can host the dashboard UI. The live ECMWF BUFR feed needs a server or a scheduled data-update workflow; GitHub Pages alone cannot run `server.py`.
