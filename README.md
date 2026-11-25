# Odisha Flood Timeline

A small, no-build-step web prototype for the HackKalp AI/ML cyclone project. It demonstrates a local view of when cyclone rainfall, coastal water, high tide, and river rise might overlap across sample coastal Odisha blocks.

## Run it locally

Open `index.html` in a browser, or serve this folder locally:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

The prototype uses plain HTML, CSS, and JavaScript. It has no package install, API key, external data feed, or build step.

## Try the controls

- Choose a sample timing scenario.
- Move the timeline from T+00 to T+24.
- Select a block from the list or the schematic map.
- Jump to that block's peak overlap window.
- Compare the four hazard signals and download the current scenario as CSV.

## What the score means

The 0–100 relative demo index combines four sample curves with fixed weights. It adds a small overlap boost when at least two sample signals are strong at the same hour. The score makes the interaction visible; it is not a calibrated probability, a trained ML model, or a flood forecast.

The map positions and all values are illustrative. The map is not georeferenced, no live IMD or OSDMA data is connected, and the site must not be used for safety decisions. Official warnings from IMD and OSDMA remain authoritative.

## Next steps for a real prototype

1. Choose a pilot area and obtain permission to use suitable historical forecast, gauge, tide, elevation, and satellite flood data.
2. Replace the sample curves with a reproducible historical-replay pipeline and record each source and timestamp.
3. Compare the approach with a simple baseline and report uncertainty before adding live feeds.
4. Replace the schematic with a validated GIS layer and show the spatial resolution supported by the data.

## Publish with GitHub Pages

This is a static site. After pushing the repository, open its **Settings → Pages**, choose the `main` branch and `/ (root)` as the source, then save. GitHub Pages will publish the files without a build command.
