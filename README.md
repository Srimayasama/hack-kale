# AtmosScale AI · Odisha Cyclone Lab

An educational static-site prototype for exploring cyclone-related weather and compound-flood context across coastal Odisha. The page connects directly to free public data APIs, includes a compact NOAA historical cyclone-track subset, and runs without a server framework or API key.

## Run locally

Open this folder in a terminal and start any simple static web server. For example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`. A web server is needed so the browser can load the local cyclone archive JSON. Internet access is needed for forecast data, the map tiles, and Leaflet.

## Dashboard features

- **Five coastal Odisha forecast points:** Ganjam, Puri, Jagatsinghpur, Kendrapara and Bhadrak, fetched together through Open-Meteo's hourly forecast API.
- **72-hour local timeline:** inspect precipitation, precipitation probability, 10 m wind gusts and mean sea-level pressure hour by hour. Switch the chart and download a CSV for the selected location.
- **Interactive map:** forecast markers move with the selected hour; marker colour can represent wind gust, rain, or precipitation probability. OpenStreetMap attribution remains visible.
- **Local comparison list:** compare 72-hour rain totals and maximum forecast gusts for all five grid points.
- **River-flow context:** two representative GloFAS v4 daily river-discharge series, with the 25th–75th percentile ensemble range.
- **Nearshore context:** a marine forecast near Puri showing significant wave height and modelled sea-level height.
- **Historical cyclone replay:** 65 named tracks from NOAA NCEI IBTrACS v04r01 North Indian Ocean data. The included subset covers named storms since 1980 that passed through the Bay of Bengal focus box. Selecting a storm draws its archived track on the map.

## Data sources and limitations

| Panel | Source | Resolution / meaning | Important limit |
| --- | --- | --- | --- |
| Weather | [Open-Meteo Forecast API](https://open-meteo.com/en/docs) | Hourly numerical weather-model output at five requested coordinates | Grid points are not whole-district forecasts; provider data can be delayed or revised. Free API is for non-commercial use and requires attribution. |
| River flow | [Open-Meteo Flood API / GloFAS v4](https://open-meteo.com/en/docs/flood-api) | Daily simulated discharge and forecast ensemble percentiles at two model cells | About 5 km grid; a nearby river can be selected incorrectly, so confirm the cell against a gauge or river map. It is not an official flood warning. |
| Marine | [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) | Hourly wave height and sea-level height at one sea grid near Puri | Coastal sea-level accuracy is limited; it is not surge guidance, a tide-gauge observation, a navigation product, or an evacuation threshold. |
| Historical tracks | [NOAA NCEI IBTrACS v04r01](https://www.ncei.noaa.gov/products/international-best-track-archive) | Best-track positions from the North Indian Ocean basin | This is historical track data, not a forecast track. Recent records can be provisional; wind sources and quality vary across contributing agencies. |
| Map | [OpenStreetMap](https://www.openstreetmap.org/copyright) | Interactive reference map tiles | Tiles load only as a viewer opens the map; attribution is displayed on the map. |

The compact track file is `data/ibtracs-bay-of-bengal.json`. It was derived from NOAA's North Indian Ocean CSV subset, keeps named tracks with at least one point inside 7–24°N and 78–94°E since 1980, and clips each retained path to the map display bounds. It retains time, location, WMO and USA wind fields, and WMO pressure where available. The displayed peak wind names the agency field used; wind averaging conventions differ across sources. Source file and access date are recorded in the JSON metadata.

Open-Meteo's free API is non-commercial and its data require CC BY 4.0 attribution. Keep the attribution shown in the website if you reuse it. Check [Open-Meteo's current terms](https://open-meteo.com/en/terms) before publishing or changing how the prototype is used.

## What it does not claim

This website does not identify a forming cyclone, calculate a cyclone's future path or landfall, issue a district warning, estimate a flood probability, or combine the separate data products into a calibrated risk score. The hourly weather forecast is not an official cyclone bulletin. Follow the India Meteorological Department (IMD) and Odisha State Disaster Management Authority (OSDMA) for operational guidance.

## A sensible next implementation step

Add a reproducible historical-replay and validation pipeline: pair archived weather forecasts with verified gauge, tide and observed inundation data; define measurable local outcomes; compare with a simple baseline; and report uncertainty and failure cases. Only after that should the project present an Odisha-specific model or a new alert feature.

## Publish with GitHub Pages

After the repository is pushed to GitHub, open **Settings → Pages**, choose the `main` branch and `/ (root)` as the source, then save. No build command is needed.
