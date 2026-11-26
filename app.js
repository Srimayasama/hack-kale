const locations = [
  { id: 'ganjam', name: 'Ganjam · Gopalpur coast', district: 'Ganjam', lat: 19.36, lon: 84.98 },
  { id: 'puri', name: 'Puri · Puri coast', district: 'Puri', lat: 19.813, lon: 85.831 },
  { id: 'jagatsinghpur', name: 'Jagatsinghpur · Paradip coast', district: 'Jagatsinghpur', lat: 20.267, lon: 86.17 },
  { id: 'kendrapara', name: 'Kendrapara · delta coast', district: 'Kendrapara', lat: 20.51, lon: 86.42 },
  { id: 'bhadrak', name: 'Bhadrak · Dhamra coast', district: 'Bhadrak', lat: 21.055, lon: 86.496 },
];

const riverPoints = {
  mahanadi: { label: 'Mahanadi · near Cuttack', lat: 20.45, lon: 85.87 },
  brahmani: { label: 'Brahmani · near Jenapur', lat: 20.8, lon: 86.25 },
};

const chartVariables = {
  rain: { label: 'Precipitation total during the preceding hour', unit: 'mm', key: 'precipitation', color: '#dc7655', mapKey: 'precipitation' },
  gust: { label: 'Wind gust at 10 metres above ground', unit: 'km/h', key: 'wind_gusts_10m', color: '#d2a13e', mapKey: 'wind_gusts_10m' },
  pressure: { label: 'Mean sea-level pressure', unit: 'hPa', key: 'pressure_msl', color: '#8273aa', mapKey: 'pressure_msl' },
};

const state = {
  forecasts: [],
  marine: null,
  rivers: [],
  tracks: [],
  selectedLocationId: 'puri',
  selectedHour: 12,
  chartVariable: 'gust',
  selectedStormId: '',
  mapMetric: 'gust',
  map: null,
  stationLayers: new Map(),
  trackLayer: null,
  aifsGuidance: null,
  aifsLayer: null,
  selectedAifsStormId: '',
  aifsMapTouched: false,
  busy: false,
};

const $ = (selector) => document.querySelector(selector);
const el = {
  fileNotice: $('#file-protocol-notice'), map: $('#odisha-map'),
  status: $('#data-status'), refresh: $('#refresh-button'), locationSelect: $('#location-select'),
  aifsStatus: $('#aifs-status'), aifsContent: $('#aifs-guidance-content'), aifsRunLabel: $('#aifs-run-label'),
  aifsRefresh: $('#aifs-refresh-button'), aifsTrackToggle: $('#aifs-track-toggle'),
  aifsStageOutlook: $('#aifs-stage-outlook'), aifsScenario: $('#aifs-scenario-select'), aifsStageGrid: $('#aifs-stage-grid'),
  aifsStageVisual: $('#aifs-stage-visual'), aifsDownloadImage: $('#aifs-download-image'),
  forecastTime: $('#forecast-time'), forecastIssue: $('#forecast-issue'), lastUpdated: $('#last-updated'),
  rain: $('#metric-rain'), gust: $('#metric-gust'), pressure: $('#metric-pressure'), probability: $('#metric-probability'),
  mapMetric: $('#map-metric'), mapLegend: $('#map-legend'), locationList: $('#location-list'),
  selectedLocationLabel: $('#selected-location-label'), slider: $('#hour-slider'), hourReadout: $('#hour-readout'),
  chart: $('#forecast-chart'), chartCaption: $('#chart-caption'), selectedGrid: $('#selected-grid'),
  download: $('#download-button'), riverSelect: $('#river-select'), riverCurrent: $('#river-current'), riverChart: $('#river-chart'),
  marineWave: $('#marine-wave'), marineLevel: $('#marine-level'), marineChart: $('#marine-chart'),
  stormSelect: $('#storm-select'), stormFacts: $('#storm-facts'), stormNote: $('#storm-note'), trackToggle: $('#track-toggle'),
};

function number(value, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function locationData() {
  return state.forecasts.find((item) => item.location.id === state.selectedLocationId) ?? null;
}

function parseLocalTime(value) {
  if (!value) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const date = new Date(hasZone ? value : `${value}+05:30`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function formatTime(value, options = {}) {
  const date = typeof value === 'string' ? parseLocalTime(value) : value;
  if (!date) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...options }).format(date);
}

function setStatus(kind, text) {
  el.status.classList.toggle('loading', kind === 'loading');
  el.status.classList.toggle('error', kind === 'error');
  el.status.querySelector('span').textContent = text;
}

function multiResult(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.hourly)) return json.hourly;
  return json ? [json] : [];
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (json?.error) throw new Error(json.reason || 'The data provider returned an error.');
  return json;
}

function makeURL(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function loadWeather() {
  const url = makeURL('https://api.open-meteo.com/v1/forecast', {
    latitude: locations.map((item) => item.lat).join(','),
    longitude: locations.map((item) => item.lon).join(','),
    hourly: 'precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,pressure_msl',
    forecast_hours: '72', timezone: 'Asia/Kolkata', wind_speed_unit: 'kmh',
  });
  const rows = multiResult(await fetchJSON(url));
  if (rows.length < locations.length) throw new Error('Weather response did not include all five locations.');
  state.forecasts = locations.map((location, index) => ({ location, grid: { lat: rows[index].latitude, lon: rows[index].longitude }, hourly: rows[index].hourly || {} }));
  const timeAxis = state.forecasts[0]?.hourly?.time || [];
  if (timeAxis.length) {
    const now = Date.now();
    state.selectedHour = timeAxis.reduce((bestIndex, value, index) => {
      const parsed = parseLocalTime(value)?.getTime() ?? Infinity;
      const best = parseLocalTime(timeAxis[bestIndex])?.getTime() ?? Infinity;
      return Math.abs(parsed - now) < Math.abs(best - now) ? index : bestIndex;
    }, 0);
    el.slider.value = String(state.selectedHour);
  }
}

async function loadRiverFlow() {
  const points = Object.values(riverPoints);
  const url = makeURL('https://flood-api.open-meteo.com/v1/flood', {
    latitude: points.map((item) => item.lat).join(','), longitude: points.map((item) => item.lon).join(','),
    daily: 'river_discharge,river_discharge_mean,river_discharge_p25,river_discharge_p75', forecast_days: '7', timezone: 'GMT',
  });
  const rows = multiResult(await fetchJSON(url));
  state.rivers = Object.entries(riverPoints).map(([id, point], index) => ({ id, point, grid: { lat: rows[index]?.latitude, lon: rows[index]?.longitude }, daily: rows[index]?.daily || {} }));
}

async function loadMarine() {
  const url = makeURL('https://marine-api.open-meteo.com/v1/marine', {
    latitude: '19.76', longitude: '85.78', hourly: 'wave_height,sea_level_height_msl', forecast_hours: '72',
    timezone: 'Asia/Kolkata', cell_selection: 'sea',
  });
  state.marine = await fetchJSON(url);
}

async function refreshData() {
  if (state.busy) return;
  state.busy = true;
  el.refresh.disabled = true;
  setStatus('loading', 'REFRESHING FORECASTS');
  const results = await Promise.allSettled([loadWeather(), loadRiverFlow(), loadMarine()]);
  const labels = ['weather', 'river flow', 'marine'];
  const failed = results.flatMap((result, index) => result.status === 'rejected' ? [`${labels[index]}: ${result.reason?.message || 'unavailable'}`] : []);
  if (state.forecasts.length) {
    setStatus(failed.length ? 'error' : 'ok', failed.length ? 'PARTIAL DATA' : 'LIVE MODEL DATA');
    const now = new Date();
    el.lastUpdated.textContent = `Browser refresh: ${formatTime(now)} IST${failed.length ? ` · ${failed.length} feed${failed.length > 1 ? 's' : ''} unavailable` : ''}`;
    el.forecastIssue.textContent = failed.length ? `Some sources did not respond: ${failed.join(' · ')}` : 'Latest provider run · all times shown in Odisha local time';
    renderAll();
  } else {
    setStatus('error', 'WEATHER FEED UNAVAILABLE');
    el.forecastIssue.textContent = `Could not load weather forecast. ${failed.join(' · ')}. Try Refresh data or check your internet connection.`;
    el.lastUpdated.textContent = 'Weather data unavailable; retry from the refresh button.';
  }
  state.busy = false;
  el.refresh.disabled = false;
}

function locationAtIndex(index) {
  const data = locationData();
  if (!data?.hourly?.time?.length) return {};
  const actual = Math.min(Math.max(0, index), data.hourly.time.length - 1);
  return Object.fromEntries(['time', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_gusts_10m', 'pressure_msl'].map((key) => [key, data.hourly[key]?.[actual] ?? null]));
}

function setSelectedLocation(id) {
  if (!locations.some((item) => item.id === id)) return;
  state.selectedLocationId = id;
  el.locationSelect.value = id;
  renderAll();
}

function currentVariableValue(forecast, key) {
  const values = forecast?.hourly?.[key] || [];
  const present = values.map(Number).filter(Number.isFinite);
  return present.length ? present : [];
}

function populateLocations() {
  el.locationSelect.innerHTML = locations.map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
  el.locationSelect.value = state.selectedLocationId;
}

function renderMetricCards(point) {
  el.rain.textContent = number(point.precipitation);
  el.gust.textContent = number(point.wind_gusts_10m);
  el.pressure.textContent = number(point.pressure_msl, 0);
  el.probability.textContent = number(point.precipitation_probability, 0);
  el.forecastTime.textContent = point.time ? formatTime(point.time, { weekday: 'short', year: 'numeric' }) : 'Forecast time unavailable';
}

function renderLocationList() {
  const ranked = [...state.forecasts].map((forecast) => {
    const rain = currentVariableValue(forecast, 'precipitation');
    const gust = currentVariableValue(forecast, 'wind_gusts_10m');
    const peakRain = rain.reduce((sum, item) => sum + item, 0);
    const peakGust = gust.length ? Math.max(...gust) : null;
    return { forecast, peakRain, peakGust };
  }).sort((a, b) => (b.peakGust ?? -Infinity) - (a.peakGust ?? -Infinity));
  el.locationList.innerHTML = ranked.map(({ forecast, peakRain, peakGust }) => {
    const selected = forecast.location.id === state.selectedLocationId;
    return `<button class="location-row ${selected ? 'selected' : ''}" type="button" data-location="${forecast.location.id}" aria-pressed="${selected}">
      <span class="row-tone" style="--row-tone:${selected ? '#0b8e88' : '#b8c6cc'}"></span>
      <span><span class="row-name">${forecast.location.district}</span><span class="row-sub">72h rain ${number(peakRain, 0)} mm</span></span>
      <span class="row-values"><strong>${number(peakGust, 0)}</strong><small>km/h peak gust</small></span>
    </button>`;
  }).join('') || '<div class="loading-row">No location data is available.</div>';
  el.locationList.querySelectorAll('[data-location]').forEach((button) => button.addEventListener('click', () => setSelectedLocation(button.dataset.location)));
}

function drawWeatherChart() {
  const forecast = locationData();
  const variable = chartVariables[state.chartVariable];
  el.chartCaption.textContent = `${variable.label} · ${variable.unit}`;
  if (!forecast?.hourly?.time?.length) {
    el.chart.innerHTML = '<text x="450" y="130" text-anchor="middle" class="chart-axis-label">Waiting for hourly forecast data</text>';
    return;
  }
  const times = forecast.hourly.time;
  const raw = forecast.hourly[variable.key] || [];
  const values = raw.map((value) => value === null ? null : Number(value));
  drawLineChart(el.chart, { times, values, color: variable.color, selectedIndex: state.selectedHour, digits: state.chartVariable === 'pressure' ? 0 : 1, floor: state.chartVariable === 'pressure' ? undefined : 0 });
  el.selectedGrid.textContent = `Forecast grid centre: ${number(forecast.grid.lat, 2)}° N, ${number(forecast.grid.lon, 2)}° E`;
}

function drawLineChart(svg, { times, values, color, selectedIndex = 0, digits = 1, floor }) {
  const width = 900, height = 270, left = 53, right = 22, top = 16, bottom = 31;
  const plotW = width - left - right, plotH = height - top - bottom;
  const valid = values.filter(Number.isFinite);
  if (!valid.length) {
    svg.innerHTML = '<text x="450" y="135" text-anchor="middle" class="chart-axis-label">No values are available for this time series.</text>';
    return;
  }
  let min = Math.min(...valid), max = Math.max(...valid);
  if (min === max) { min -= Math.max(1, Math.abs(min) * .08); max += Math.max(1, Math.abs(max) * .08); }
  if (floor !== undefined) min = Math.max(floor, min);
  const pad = (max - min) * .13; min = floor === undefined ? min - pad : Math.max(floor, min - pad); max += pad;
  const x = (i) => left + (i / Math.max(1, values.length - 1)) * plotW;
  const y = (v) => top + ((max - v) / (max - min)) * plotH;
  const paths = [];
  let segment = [];
  values.forEach((value, index) => {
    if (Number.isFinite(value)) segment.push([index, value]);
    else if (segment.length) { paths.push(segment); segment = []; }
  });
  if (segment.length) paths.push(segment);
  const linePaths = paths.map((points) => points.map(([i, v], index) => `${index ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' '));
  const longest = paths.reduce((best, item) => item.length > best.length ? item : best, []);
  const areaPath = longest.length ? `${longest.map(([i,v],index) => `${index ? 'L':'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} L${x(longest.at(-1)[0]).toFixed(1)},${(top+plotH).toFixed(1)} L${x(longest[0][0]).toFixed(1)},${(top+plotH).toFixed(1)} Z` : '';
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index / 4));
  const yGrid = ticks.map((value) => `<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-axis-label" x="${left-9}" y="${y(value)+3}" text-anchor="end">${number(value,digits)}</text>`).join('');
  const xIndices = Array.from(new Set([0, Math.round((values.length-1)/3), Math.round((values.length-1)*2/3), values.length-1]));
  const xTicks = xIndices.map((i) => `<text class="chart-axis-label small" x="${x(i)}" y="${height-8}" text-anchor="${i===0?'start':i===values.length-1?'end':'middle'}">${formatTime(times[i],{day:'numeric',month:'short',hour:'numeric'})}</text>`).join('');
  const cursorIndex = Math.min(Math.max(0, selectedIndex), values.length-1);
  const cursorValue = values[cursorIndex];
  const cursor = `<line class="chart-cursor" x1="${x(cursorIndex)}" x2="${x(cursorIndex)}" y1="${top}" y2="${top+plotH}"/>${Number.isFinite(cursorValue) ? `<circle class="chart-point" cx="${x(cursorIndex)}" cy="${y(cursorValue)}" r="5" fill="${color}"/>` : ''}`;
  svg.innerHTML = `${yGrid}${xTicks}${areaPath ? `<path class="chart-area" fill="${color}" d="${areaPath}"/>` : ''}${linePaths.map((path) => `<path class="chart-line" stroke="${color}" d="${path}"/>`).join('')}${cursor}`;
}

function colorFor(value, extent) {
  if (!Number.isFinite(value)) return '#aab7bd';
  const ratio = extent.max === extent.min ? .5 : Math.max(0, Math.min(1, (value - extent.min) / (extent.max - extent.min)));
  const stops = [[91,190,179],[224,185,83],[211,100,73]];
  const scaled = ratio * 2, first = Math.floor(scaled), fraction = scaled - first;
  const a = stops[Math.min(first, 1)], b = stops[Math.min(first+1,2)];
  return `rgb(${a.map((channel,index)=>Math.round(channel+(b[index]-channel)*fraction)).join(',')})`;
}

function renderMapMarkers() {
  if (!state.map) return;
  const field = state.mapMetric === 'rain' ? 'precipitation' : state.mapMetric === 'probability' ? 'precipitation_probability' : 'wind_gusts_10m';
  const values = state.forecasts.map((forecast) => forecast.hourly?.[field]?.[state.selectedHour]).filter((value) => value !== null && Number.isFinite(Number(value))).map(Number);
  const extent = { min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 1 };
  const units = { gust: 'km/h gust', rain: 'mm rain', probability: '% probability' };
  el.mapLegend.querySelector('span').textContent = `${units[state.mapMetric]} · selected hour`;
  state.forecasts.forEach((forecast) => {
    const value = forecast.hourly?.[field]?.[state.selectedHour];
    const marker = state.stationLayers.get(forecast.location.id);
    if (!marker) return;
    const color = colorFor(Number(value), extent);
    marker.setStyle({ color, fillColor: color, fillOpacity: .78, weight: forecast.location.id === state.selectedLocationId ? 3 : 2, radius: forecast.location.id === state.selectedLocationId ? 10 : 8 });
    marker.setPopupContent(`<strong>${forecast.location.district} · ${units[state.mapMetric]}</strong><br>${number(value)} at ${formatTime(forecast.hourly.time?.[state.selectedHour])}<br><span>Forecast grid ${number(forecast.grid.lat,2)}°N, ${number(forecast.grid.lon,2)}°E</span>`);
    if (forecast.location.id === state.selectedLocationId) marker.bringToFront();
  });
}

function initializeMap() {
  if (location.protocol === 'file:') {
    el.map.innerHTML = '<div class="map-file-message"><span class="map-file-icon">↗</span><strong>Open the HTTP version to load this map</strong><p>OpenStreetMap tiles require a normal webpage address. Use <a href="http://127.0.0.1:8000">the local server preview</a>; instructions are shown above.</p></div>';
    el.trackToggle.disabled = true;
    el.aifsTrackToggle.disabled = true;
    return;
  }
  if (state.map) return;
  if (!window.L) {
    el.map.innerHTML = '<div class="map-file-message"><strong>The interactive map library did not load.</strong><p>Check your internet connection and refresh the page.</p></div>';
    return;
  }
  state.map = L.map('odisha-map', { zoomControl: true, scrollWheelZoom: false, preferCanvas: true }).setView([20.3, 86.4], 6.8);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
  }).addTo(state.map);
  state.forecasts.forEach((forecast) => {
    const marker = L.circleMarker([forecast.location.lat, forecast.location.lon], { radius: 8, weight: 2, color: '#0b8e88', fillColor: '#0b8e88', fillOpacity: .8 });
    marker.addTo(state.map).bindPopup('Forecast data loading…');
    marker.on('click', () => setSelectedLocation(forecast.location.id));
    state.stationLayers.set(forecast.location.id, marker);
  });
  renderMapMarkers();
  drawAifsTracks();
}

function formatLead(hours) {
  if (!Number.isFinite(Number(hours))) return '—';
  const value = Number(hours);
  if (value < 24) return `+${value} h`;
  const days = value / 24;
  return `+${Number.isInteger(days) ? days : days.toFixed(1)} d`;
}

function formatCoordinate(value, positive, negative) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${Math.abs(numeric).toFixed(2)}°${numeric < 0 ? negative : positive}`;
}

function renderAifsStageGraphic(storm) {
  const width = 1440, height = 720;
  const map = { x: 80, y: 132, width: 730, height: 500, west: 78, east: 100, south: 4, north: 26 };
  const project = (lon, lat) => [
    map.x + ((lon - map.west) / (map.east - map.west)) * map.width,
    map.y + ((map.north - lat) / (map.north - map.south)) * map.height,
  ];
  const runLabel = state.aifsGuidance?.modelRun
    ? formatTime(state.aifsGuidance.modelRun, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Latest available run';
  const stages = storm.forecastStages || [];
  const coast = [[84.5,17.4],[84.7,18.2],[85.0,18.8],[85.3,19.3],[85.8,19.8],[86.2,20.3],[86.6,20.8],[87.0,21.2],[87.5,21.8],[88.0,22.4],[88.5,23.1],[89.0,23.9],[89.4,24.8],[89.7,25.6]];
  const coastLine = coast.map(([lon,lat], index) => `${index ? 'L' : 'M'}${project(lon,lat).map((value)=>value.toFixed(1)).join(',')}`).join(' ');
  const landPath = `${coastLine} L${project(100,25.6).join(',')} L${project(100,17.4).join(',')} Z`;
  const gridLons = [78,82,86,90,94,98];
  const gridLats = [4,8,12,16,20,24];
  const gridMarkup = [
    ...gridLons.map((lon) => {
      const [x] = project(lon, map.south);
      return `<line x1="${x}" y1="${map.y}" x2="${x}" y2="${map.y + map.height}" stroke="#d5e5e7" stroke-width="1"/><text x="${x}" y="${map.y + map.height + 23}" text-anchor="middle" class="axis">${lon}°E</text>`;
    }),
    ...gridLats.map((lat) => {
      const [,y] = project(map.west, lat);
      return `<line x1="${map.x}" y1="${y}" x2="${map.x + map.width}" y2="${y}" stroke="#d5e5e7" stroke-width="1"/><text x="${map.x - 12}" y="${y + 4}" text-anchor="end" class="axis">${lat}°N</text>`;
    }),
  ].join('');
  const memberMarkup = (storm.bayTracks || []).map((track) => {
    const points = (track.points || []).filter((point) => point.lon >= map.west && point.lon <= map.east && point.lat >= map.south && point.lat <= map.north);
    if (points.length < 2) return '';
    const line = points.map((point,index) => `${index ? 'L' : 'M'}${project(point.lon,point.lat).map((value)=>value.toFixed(1)).join(',')}`).join(' ');
    return `<path d="${line}" fill="none" stroke="#4e92a0" stroke-width="1.7" opacity=".17"/>`;
  }).join('');
  const medianPoints = (storm.medianPath || []).filter((point) => point.lon >= map.west && point.lon <= map.east && point.lat >= map.south && point.lat <= map.north);
  const medianMarkup = medianPoints.length > 1
    ? `<path d="${medianPoints.map((point,index)=>`${index?'L':'M'}${project(point.lon,point.lat).map((value)=>value.toFixed(1)).join(',')}`).join(' ')}" fill="none" stroke="#0b8e88" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
    : '';
  const stageMarkup = stages.map((stage,index) => {
    if (stage.lat === undefined || stage.lon === undefined) return '';
    const [x,y] = project(stage.lon,stage.lat);
    return `<g><circle cx="${x}" cy="${y}" r="15" fill="#0b8e88" stroke="#fff" stroke-width="4"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="stage-index">${index + 1}</text></g>`;
  }).join('');
  const points = locations.map((place) => {
    const active = stages.some((stage) => (stage.nearbyPlaces || []).some((item) => item.district === place.district && item.memberTracksNear > 0));
    const [x,y] = project(place.lon,place.lat);
    const color = active ? '#d59b38' : '#fff';
    const stroke = active ? '#fff' : '#0b8e88';
    return `<circle cx="${x}" cy="${y}" r="7" fill="${color}" stroke="${stroke}" stroke-width="3"><title>${escapeHTML(place.district)}${active ? ' · near at least one forecast stage' : ' · coastal reference point'}</title></circle>`;
  }).join('');
  const stageRows = stages.map((stage,index) => {
    const y = 164 + index * 113;
    const center = stage.lat === undefined ? 'No centre available at this lead' : `${formatCoordinate(stage.lat,'N','S')} · ${formatCoordinate(stage.lon,'E','W')}`;
    const nearby = (stage.nearbyPlaces || []).filter((place) => place.memberTracksNear > 0).slice(0, 2);
    const nearText = nearby.length
      ? `Near-track: ${nearby.map((place)=>`${escapeHTML(place.district)} ${number(place.memberTracksNear,0)}/${number(place.memberTracksTotal,0)}`).join(' · ')}`
      : 'No listed coastal point in the 150 km screen';
    return `<g>
      <rect x="866" y="${y}" width="524" height="104" rx="12" fill="#fff" stroke="#dce8e9"/>
      <circle cx="893" cy="${y + 25}" r="15" fill="#e4f4f2"/><text x="893" y="${y + 30}" text-anchor="middle" class="row-index">${index + 1}</text>
      <text x="920" y="${y + 24}" class="row-title">${escapeHTML(formatLead(stage.leadHours))} <tspan class="row-date">· ${escapeHTML(formatTime(stage.validAt,{weekday:'short',day:'numeric',month:'short'}))}</tspan></text>
      <text x="920" y="${y + 46}" class="row-center">${escapeHTML(center)}</text>
      <text x="920" y="${y + 65}" class="row-class">${escapeHTML(stage.windBand || 'Intensity unavailable')}</text>
      <text x="920" y="${y + 82}" class="row-meta">${number(stage.windKmh,0)} km/h · ${number(stage.pressureHpa,0)} hPa · ${number(stage.members,0)}/${number(stage.availableMemberTracks,0)} Bay paths</text>
      <text x="920" y="${y + 97}" class="row-near">${nearText}</text>
    </g>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Four-stage ECMWF AIFS cyclone track outlook for Odisha">
    <style>
      text{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.title{font-size:27px;font-weight:850;fill:#182a41;letter-spacing:-.7px}.subtitle{font-size:12px;font-weight:650;fill:#718291}.eyebrow{font-size:10px;font-weight:850;letter-spacing:1.7px;fill:#0b8e88}.axis{font-size:10px;font-weight:750;fill:#647885}.maplabel{font-size:12px;font-weight:850;letter-spacing:1.2px;fill:#6d9095;opacity:.86}.paneltitle{font-size:13px;font-weight:850;letter-spacing:1.1px;fill:#182a41}.row-index{font-size:12px;font-weight:900;fill:#0b8e88}.row-title{font-size:14px;font-weight:850;fill:#182a41}.row-date{font-size:10px;font-weight:650;fill:#8895a0}.row-center{font-size:12px;font-weight:800;fill:#30495d}.row-class{font-size:10px;font-weight:850;fill:#237c75}.row-meta{font-size:10px;font-weight:700;fill:#687c89}.row-near{font-size:9px;font-weight:750;fill:#9a6f26}.legend{font-size:10px;font-weight:700;fill:#526b77}.foot{font-size:9px;font-weight:650;fill:#82919a}.stage-index{font-size:12px;font-weight:900;fill:#fff}
    </style>
    <rect width="100%" height="100%" rx="18" fill="#f7fafb"/>
    <text x="48" y="43" class="eyebrow">ATMOSCALE AI · ODISHA CYCLONE LAB</text>
    <text x="48" y="78" class="title">Four-stage cyclone track outlook</text>
    <text x="48" y="101" class="subtitle">ECMWF AIFS ensemble · model system ${escapeHTML(storm.stormId)} · run ${escapeHTML(runLabel)} IST</text>
    <rect x="50" y="115" width="790" height="550" rx="14" fill="#e9f5f6" stroke="#d5e5e7"/>
    <rect x="${map.x}" y="${map.y}" width="${map.width}" height="${map.height}" rx="4" fill="#dceff2"/>
    ${gridMarkup}
    <path d="${landPath}" fill="#e4efdf" stroke="none"/>
    <path d="${coastLine}" fill="none" stroke="#91a998" stroke-width="2.5"/>
    <text x="${project(92,23.3)[0]}" y="${project(92,23.3)[1]}" class="maplabel">INDIA · SCHEMATIC COAST</text>
    <text x="${project(91.4,14)[0]}" y="${project(91.4,14)[1]}" class="maplabel">BAY OF BENGAL</text>
    ${memberMarkup}${medianMarkup}${points}${stageMarkup}
    <circle cx="98" cy="649" r="5" fill="#0b8e88"/><text x="111" y="653" class="legend">Coastal reference point</text>
    <circle cx="250" cy="649" r="5" fill="#d59b38"/><text x="263" y="653" class="legend">Near a member track at a forecast stage</text>
    <line x1="500" y1="649" x2="526" y2="649" stroke="#0b8e88" stroke-width="3"/><text x="534" y="653" class="legend">Ensemble median path</text>
    <rect x="850" y="115" width="550" height="550" rx="14" fill="#eef4f5" stroke="#dfe8e9"/>
    <text x="874" y="145" class="paneltitle">FORECAST CENTRE · INTENSITY · COASTAL PROXIMITY</text>
    ${stageRows}
    <text x="50" y="696" class="foot">Nearby means a forecast member centre falls within 150 km of a reference point. This is not an impact boundary or an official warning.</text>
    <text x="1390" y="696" text-anchor="end" class="foot">Wind band is indicative, not an IMD classification.</text>
  </svg>`;
  el.aifsStageVisual.innerHTML = svg;
}

function renderAifsStages() {
  const storms = state.aifsGuidance?.storms || [];
  const storm = storms.find((item) => item.stormId === state.selectedAifsStormId) || storms[0];
  if (!storm) {
    el.aifsStageOutlook.hidden = true;
    return;
  }
  state.selectedAifsStormId = storm.stormId;
  el.aifsStageOutlook.hidden = false;
  el.aifsScenario.value = storm.stormId;
  const stages = storm.forecastStages || [];
  renderAifsStageGraphic(storm);
  el.aifsStageGrid.innerHTML = stages.map((stage, index) => {
    const stageNumber = String(index + 1).padStart(2, '0');
    if (!Number.isFinite(Number(stage.lat)) || !Number.isFinite(Number(stage.lon))) {
      return `<article class="aifs-stage-card aifs-stage-empty">
        <div class="aifs-stage-top"><span class="aifs-stage-number">${stageNumber}</span><span class="aifs-stage-lead">${escapeHTML(formatLead(stage.leadHours))}</span></div>
        <p class="aifs-stage-date">${escapeHTML(formatTime(stage.validAt, { weekday: 'short', day: 'numeric', month: 'short' }))}</p>
        <strong class="aifs-stage-missing">No matching forecast centre</strong>
        <p class="aifs-stage-small">This model system has no track point at this lead.</p>
      </article>`;
    }
    const nearby = (stage.nearbyPlaces || []).filter((place) => Number(place.memberTracksNear) > 0).slice(0, 3);
    const nearbyMarkup = nearby.length
      ? `<div class="aifs-nearby-list">${nearby.map((place) => `<span>${escapeHTML(place.district)} <b>${number(place.memberTracksNear, 0)}/${number(place.memberTracksTotal, 0)}</b></span>`).join('')}</div>`
      : `<p class="aifs-stage-small">No listed coast point is within 150 km of a member track. Nearest: ${escapeHTML(stage.nearbyPlaces?.[0]?.district || 'unavailable')} (${number(stage.nearbyPlaces?.[0]?.medianDistanceKm, 0)} km median distance).</p>`;
    return `<article class="aifs-stage-card">
      <div class="aifs-stage-top"><span class="aifs-stage-number">${stageNumber}</span><span class="aifs-stage-lead">${escapeHTML(formatLead(stage.leadHours))}</span></div>
      <p class="aifs-stage-date">${escapeHTML(formatTime(stage.validAt, { weekday: 'short', day: 'numeric', month: 'short' }))}</p>
      <div class="aifs-stage-center"><span>ENSEMBLE MEDIAN CENTRE</span><strong>${escapeHTML(formatCoordinate(stage.lat, 'N', 'S'))} · ${escapeHTML(formatCoordinate(stage.lon, 'E', 'W'))}</strong></div>
      <div class="aifs-stage-class"><span>INDICATIVE INTENSITY CLASS</span><strong>${escapeHTML(stage.windBand || 'Unavailable')}</strong></div>
      <div class="aifs-stage-metrics"><span>Peak 10 m wind <b>${number(stage.windKmh, 0)} km/h</b></span><span>Central pressure <b>${number(stage.pressureHpa, 0)} hPa</b></span></div>
      <div class="aifs-stage-nearby"><span>COASTAL POINTS NEAR THE TRACK <small>${number(stage.members, 0)}/${number(stage.availableMemberTracks, 0)} Bay paths at this lead</small></span>${nearbyMarkup}</div>
    </article>`;
  }).join('') || '<div class="aifs-empty-state"><strong>Four-stage outlook unavailable for this model system.</strong><p>Try another model scenario or refresh the guidance.</p></div>';
}

async function downloadAifsForecastImage() {
  const svg = el.aifsStageVisual.querySelector('svg');
  if (!svg) return;
  const button = el.aifsDownloadImage;
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Preparing PNG…';
  let sourceUrl = '';
  try {
    const svgBlob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    sourceUrl = URL.createObjectURL(svgBlob);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Could not render the forecast graphic.'));
      image.src = sourceUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 2880;
    canvas.height = 1440;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas export is unavailable in this browser.');
    context.fillStyle = '#f7fafb';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
    const safeId = String(state.selectedAifsStormId || 'cyclone').replace(/[^a-z0-9-]/gi, '-');
    const link = document.createElement('a');
    const pngUrl = URL.createObjectURL(png);
    link.href = pngUrl;
    link.download = `atmosscale-${safeId}-4-stage-outlook.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
  } catch (error) {
    window.alert(`Could not create the PNG image: ${error.message}`);
  } finally {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

function renderAifsGuidance(payload) {
  state.aifsGuidance = payload;
  const status = payload.status === 'stale' ? 'stale' : payload.status === 'ok' ? 'ok' : 'error';
  el.aifsStatus.className = `aifs-status ${status === 'ok' ? '' : status}`;
  el.aifsStatus.querySelector('span').textContent = status === 'ok' ? 'LIVE AIFS GUIDANCE' : status === 'stale' ? 'CACHED AIFS GUIDANCE' : 'AIFS FEED UNAVAILABLE';

  if (payload.modelRun) {
    el.aifsRunLabel.textContent = `AIFS run: ${formatTime(payload.modelRun, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} IST · forecast up to 15 days`;
  }

  const storms = Array.isArray(payload.storms) ? payload.storms : [];
  const hasPaths = status !== 'error' && storms.some((storm) => Array.isArray(storm.bayTracks) && storm.bayTracks.length);
  el.aifsTrackToggle.disabled = !hasPaths;
  if (!hasPaths) el.aifsTrackToggle.checked = false;
  else if (!state.aifsMapTouched) el.aifsTrackToggle.checked = true;

  if (status === 'error') {
    el.aifsStageOutlook.hidden = true;
    el.aifsContent.innerHTML = `<div class="aifs-empty-state"><strong>Live AI guidance could not load.</strong><p>${escapeHTML(payload.message || 'Start the local project server, check the internet connection, and refresh.')}</p></div>`;
    drawAifsTracks();
    return;
  }

  if (!storms.length) {
    el.aifsStageOutlook.hidden = true;
    const staleNote = payload.refreshError ? `<p>Refresh issue: ${escapeHTML(payload.refreshError)}</p>` : '';
    el.aifsContent.innerHTML = `<div class="aifs-empty-state"><strong>No AIFS ensemble track candidate crosses the Bay of Bengal box in this model run.</strong><p>This describes one model run. It does not guarantee that no cyclone will form. Check IMD bulletins for official monitoring.</p>${staleNote}</div>`;
    drawAifsTracks();
    return;
  }

  const cards = storms.slice(0, 4).map((storm) => {
    const id = escapeHTML(storm.stormId || 'Unlabelled');
    const available = Number(storm.availableMemberTracks) || 0;
    const bay = Number(storm.bayPathCount) || 0;
    const north = Number(storm.northBayPathCount) || 0;
    const odisha = Number(storm.odishaPathCount) || 0;
    const leadRange = storm.bayLeadStart === null || storm.bayLeadStart === undefined
      ? 'No valid lead range'
      : `${formatLead(storm.bayLeadStart)} to ${formatLead(storm.bayLeadEnd)}`;
    const modelAgreement = storm.singleModelAlsoForecasts
      ? 'This model ID also appears in the AIFS single forecast.'
      : payload.singleModelAvailable
        ? 'Ensemble signal only: the AIFS single forecast does not show the same model ID in this run.'
        : 'The AIFS single forecast comparison is unavailable for this run.';
    return `<article class="aifs-system-card">
      <div class="aifs-system-head"><div><span class="aifs-system-kicker">MODEL SYSTEM ID</span><strong class="aifs-system-id">${id}</strong></div><span class="aifs-model-badge">Not an official storm name</span></div>
      <div class="aifs-stats">
        <div class="aifs-stat"><strong>${bay}<small> / ${available}</small></strong><span>available member tracks cross the Bay box</span></div>
        <div class="aifs-stat"><strong>${north}</strong><span>tracks reach the north Bay box</span></div>
        <div class="aifs-stat"><strong>${odisha}</strong><span>tracks enter the Odisha watch box</span></div>
      </div>
      <p class="aifs-system-note">Bay track lead range: <strong>${escapeHTML(leadRange)}</strong>. ${escapeHTML(modelAgreement)}</p>
    </article>`;
  }).join('');
  const staleNote = payload.refreshError ? `<p class="aifs-run-note">Showing the last successful run because refresh failed: ${escapeHTML(payload.refreshError)}</p>` : '';
  const description = `<p class="aifs-run-note">AIFS member counts describe this model’s track spread; they are not calibrated probabilities. The Bay box is 4–25°N, 78–100°E; the Odisha watch box is 14–23°N, 80–90°E. Follow IMD and OSDMA for official warnings.</p>`;
  el.aifsContent.innerHTML = `<div class="aifs-system-grid">${cards}</div>${description}${staleNote}`;
  const selectable = storms.slice(0, 4);
  if (!selectable.some((storm) => storm.stormId === state.selectedAifsStormId)) state.selectedAifsStormId = selectable[0].stormId;
  el.aifsScenario.innerHTML = selectable.map((storm) => `<option value="${escapeHTML(storm.stormId)}">${escapeHTML(storm.stormId)} · ${storm.bayPathCount}/${storm.availableMemberTracks} Bay paths</option>`).join('');
  renderAifsStages();
  drawAifsTracks();
}

async function loadAifsGuidance(force = false) {
  if (location.protocol === 'file:') {
    renderAifsGuidance({ status: 'error', message: 'Open the dashboard using python3 server.py so it can reach the live AIFS service.' });
    return;
  }
  el.aifsRefresh.disabled = true;
  el.aifsStatus.className = 'aifs-status loading';
  el.aifsStatus.querySelector('span').textContent = force ? 'REFRESHING AIFS' : 'LOADING AIFS';
  el.aifsContent.innerHTML = '<div class="aifs-loading-row"><span class="loading-spinner" aria-hidden="true"></span><span>Fetching current ECMWF AIFS cyclone-track guidance…</span></div>';
  try {
    const response = await fetch(`/api/cyclone-guidance${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok && payload.status !== 'stale') throw new Error(payload.message || `HTTP ${response.status}`);
    renderAifsGuidance(payload);
  } catch (error) {
    renderAifsGuidance({ status: 'error', message: `${error.message}. Start the local project server and try again.` });
  } finally {
    el.aifsRefresh.disabled = false;
  }
}

function drawAifsTracks() {
  if (state.map && state.aifsLayer) state.map.removeLayer(state.aifsLayer);
  state.aifsLayer = null;
  if (!state.map || !el.aifsTrackToggle.checked || !state.aifsGuidance?.storms?.length) return;

  const storm = state.aifsGuidance.storms.find((item) => item.stormId === state.selectedAifsStormId) || state.aifsGuidance.storms[0];
  if (!storm) return;
  const layer = L.layerGroup();
  const boundsPoints = [];
  (storm.bayTracks || []).forEach((track) => {
    const coordinates = track.points.map((point) => [point.lat, point.lon]);
    if (coordinates.length < 2) return;
    boundsPoints.push(...coordinates);
    L.polyline(coordinates, { color: '#3f809d', weight: 1.5, opacity: .24 })
      .bindTooltip(`${storm.stormId} · AIFS ensemble member ${track.member}`).addTo(layer);
  });
  const centre = storm.medianPath || [];
  if (centre.length >= 2) {
    const coordinates = centre.map((point) => [point.lat, point.lon]);
    boundsPoints.push(...coordinates);
    L.polyline(coordinates, { color: '#0b8e88', weight: 3, opacity: .95 })
      .bindTooltip(`${storm.stormId} · AIFS ensemble median path (not an official forecast)`).addTo(layer);
  }
  (storm.forecastStages || []).forEach((stage, index) => {
    if (!Number.isFinite(Number(stage.lat)) || !Number.isFinite(Number(stage.lon))) return;
    const marker = L.marker([stage.lat, stage.lon], {
      icon: L.divIcon({ className: 'aifs-stage-div-icon', html: `<span>${index + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      keyboard: true,
    });
    marker.bindTooltip(`${storm.stormId} · Stage ${index + 1} · ${formatLead(stage.leadHours)}`)
      .bindPopup(`<strong>${storm.stormId} · ${formatLead(stage.leadHours)}</strong><br>Ensemble median centre: ${formatCoordinate(stage.lat, 'N', 'S')}, ${formatCoordinate(stage.lon, 'E', 'W')}<br>Indicative wind band: ${escapeHTML(stage.windBand || 'unavailable')}<br>Peak model 10 m wind: ${number(stage.windKmh, 0)} km/h`)
      .addTo(layer);
    boundsPoints.push([stage.lat, stage.lon]);
  });
  if (!boundsPoints.length) return;
  layer.addTo(state.map);
  state.aifsLayer = layer;
  state.map.fitBounds(L.latLngBounds(boundsPoints).pad(.06), { maxZoom: 7 });
}

function renderRiverChart() {
  const river = state.rivers.find((item) => item.id === el.riverSelect.value) || state.rivers[0];
  if (!river?.daily?.time?.length) {
    el.riverCurrent.textContent = '—';
    el.riverChart.innerHTML = '<text x="325" y="105" text-anchor="middle" class="chart-axis-label">River-flow feed unavailable</text>';
    return;
  }
  const time = river.daily.time;
  const mean = river.daily.river_discharge_mean || river.daily.river_discharge || [];
  const p25 = river.daily.river_discharge_p25 || mean;
  const p75 = river.daily.river_discharge_p75 || mean;
  el.riverCurrent.textContent = number(mean[0], 0);
  const width=650,height=205,left=51,right=13,top=14,bottom=27,plotW=width-left-right,plotH=height-top-bottom;
  const all=[...mean,...p25,...p75].map(Number).filter(Number.isFinite);
  if (!all.length) { el.riverChart.innerHTML='<text x="325" y="105" text-anchor="middle" class="chart-axis-label">No discharge data returned</text>'; return; }
  let min=Math.min(0,...all),max=Math.max(...all); if(min===max)max=min+1;
  const x=i=>left+(i/Math.max(1,time.length-1))*plotW;
  const y=v=>top+(max-Number(v))/(max-min)*plotH;
  const upper=p75.map((v,i)=>[i,v]).filter(([,v])=>Number.isFinite(Number(v)));
  const lower=p25.map((v,i)=>[i,v]).filter(([,v])=>Number.isFinite(Number(v)));
  const band=upper.length&&lower.length?`${upper.map(([i,v],n)=>`${n?'L':'M'}${x(i)},${y(v)}`).join(' ')} ${lower.reverse().map(([i,v])=>`L${x(i)},${y(v)}`).join(' ')} Z`:'';
  const line=mean.map((v,i)=>[i,v]).filter(([,v])=>Number.isFinite(Number(v))).map(([i,v],n)=>`${n?'L':'M'}${x(i)},${y(v)}`).join(' ');
  const ticks=Array.from({length:4},(_,i)=>min+(max-min)*i/3);
  const grid=ticks.map(v=>`<line class="chart-grid" x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis-label" x="${left-8}" y="${y(v)+3}" text-anchor="end">${number(v,0)}</text>`).join('');
  const labels=time.map((date,i)=>`<text class="chart-axis-label small" x="${x(i)}" y="${height-8}" text-anchor="middle">${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN',{timeZone:'UTC',day:'numeric',month:'short'})}</text>`).join('');
  el.riverChart.innerHTML=`${grid}${band?`<path d="${band}" fill="rgba(11,142,136,.18)" stroke="none"/>`:''}<path class="chart-line" stroke="#0b8e88" d="${line}"/>${mean.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#0b8e88" stroke="white" stroke-width="2"><title>${time[i]} · ${number(v,0)} m³/s · ${number(p25[i],0)}–${number(p75[i],0)} m³/s central ensemble range</title></circle>`).join('')}${labels}`;
  $('#river-current').parentElement.querySelector('span').textContent=`m³/s · ${time[0]} UTC day`;
  el.riverChart.setAttribute('aria-label',`${river.point.label}: daily river discharge and the 25th to 75th percentile model ensemble range.`);
}

function renderMarine() {
  const hourly = state.marine?.hourly;
  if (!hourly?.time?.length) {
    el.marineWave.textContent='—'; el.marineLevel.textContent='—';
    el.marineChart.innerHTML='<text x="325" y="80" text-anchor="middle" class="chart-axis-label">Marine forecast feed unavailable</text>';
    return;
  }
  const index=Math.min(state.selectedHour,hourly.time.length-1);
  el.marineWave.textContent=number(hourly.wave_height?.[index]);
  el.marineLevel.textContent=number(hourly.sea_level_height_msl?.[index]);
  drawLineChart(el.marineChart,{times:hourly.time,values:(hourly.wave_height||[]).map((v)=>v===null?null:Number(v)),color:'#438db8',selectedIndex:index,digits:1,floor:0});
}

function renderStormSelect() {
  if (!state.tracks.length) return;
  const sorted=[...state.tracks].sort((a,b)=>b.season-a.season || a.name.localeCompare(b.name));
  el.stormSelect.innerHTML=sorted.map((track)=>`<option value="${track.id}">${track.season} · ${track.name}</option>`).join('');
  if (!state.selectedStormId || !state.tracks.some((track)=>track.id===state.selectedStormId)) state.selectedStormId=sorted[0].id;
  el.stormSelect.value=state.selectedStormId;
  renderStormDetails();
}

function selectedStorm() { return state.tracks.find((track)=>track.id===state.selectedStormId) || null; }

function renderStormDetails() {
  const track=selectedStorm();
  if (!track) return;
  const points=track.points||[];
  const first=parseLocalTime(points[0]?.time.replace(' ','T'));
  const last=parseLocalTime(points.at(-1)?.time.replace(' ','T'));
  const days=first&&last?Math.max(1,Math.ceil((last-first)/86400000)):null;
  const windValue=track.peakWindKt===null?'—':`${number(track.peakWindKt,0)} kt · ${track.peakWindAgency||'agency not listed'}`;
  el.stormFacts.innerHTML=`<div class="storm-fact"><span>SEASON</span><strong>${track.season}</strong></div><div class="storm-fact"><span>TRACK / DURATION</span><strong>${points.length} points · ${days??'—'} days</strong></div><div class="storm-fact"><span>PEAK REPORTED WIND</span><strong>${windValue}</strong></div>`;
  el.stormNote.textContent=`${track.name} · ${formatTime(points[0]?.time.replace(' ','T'),{day:'numeric',month:'short',year:'numeric'})} to ${formatTime(points.at(-1)?.time.replace(' ','T'),{day:'numeric',month:'short',year:'numeric'})}. Track line is reconstructed from NOAA NCEI IBTrACS positions; recent points may be provisional and reported wind uses the displayed agency field.`;
  drawSelectedTrack();
}

function drawSelectedTrack() {
  if (!state.map || !el.trackToggle.checked) return;
  if (state.trackLayer) state.map.removeLayer(state.trackLayer);
  const track=selectedStorm();
  if (!track?.points?.length) return;
  const points=track.points.map((point)=>[point.lat,point.lon]);
  const group=L.layerGroup();
  L.polyline(points,{color:'#cb6248',weight:3,opacity:.86,dashArray:track.season>=2025?'7 5':null}).addTo(group);
  const start=track.points[0],end=track.points.at(-1);
  L.circleMarker([start.lat,start.lon],{radius:4,color:'#fff',weight:2,fillColor:'#d5a747',fillOpacity:1}).bindTooltip(`Start · ${formatTime(start.time.replace(' ','T'),{day:'numeric',month:'short',year:'numeric'})}`).addTo(group);
  L.circleMarker([end.lat,end.lon],{radius:6,color:'#fff',weight:2,fillColor:'#cb6248',fillOpacity:1}).bindTooltip(`${track.name} · last archive position`).addTo(group);
  group.addTo(state.map);
  state.trackLayer=group;
}

function renderAll() {
  const data=locationData();
  const point=locationAtIndex(state.selectedHour);
  if (data) {
    renderMetricCards(point);
    el.selectedLocationLabel.textContent=data.location.district;
    el.hourReadout.textContent=point.time?formatTime(point.time,{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';
    drawWeatherChart();
    renderLocationList();
    renderMapMarkers();
  }
  renderRiverChart();
  renderMarine();
}

function downloadForecastCSV() {
  const forecast=locationData();
  if (!forecast?.hourly?.time?.length) { window.alert('The weather forecast is unavailable right now. Refresh the data and try again.'); return; }
  const keys=['time','precipitation','precipitation_probability','wind_speed_10m','wind_gusts_10m','pressure_msl'];
  const headers=['Local time (Asia/Kolkata)','Precipitation mm','Precipitation probability %','Wind speed km/h','Wind gust km/h','Mean sea-level pressure hPa'];
  const rows=[headers,...forecast.hourly.time.map((time,index)=>keys.map((key)=>key==='time'?time:forecast.hourly[key]?.[index]??''))];
  const csv=rows.map((row)=>row.map((value)=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const blob=new Blob([`\uFEFF${csv}`],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url; link.download=`atmosscale-${forecast.location.id}-72h-forecast.csv`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

async function loadStormArchive() {
  try {
    const archive=await fetchJSON('data/ibtracs-bay-of-bengal.json');
    state.tracks=archive.tracks||[];
    renderStormSelect();
  } catch (error) {
    el.stormSelect.innerHTML='<option>Archive unavailable</option>';
    el.stormFacts.innerHTML='<div class="storm-fact"><span>STORM ARCHIVE</span><strong>Unavailable</strong></div>';
    el.stormNote.textContent=location.protocol==='file:'
      ? 'Open the HTTP version of this project to load the local NOAA historical track archive.'
      : `Historical track data did not load: ${error.message}`;
  }
}

function connectControls() {
  el.locationSelect.addEventListener('change',(event)=>setSelectedLocation(event.target.value));
  el.slider.addEventListener('input',()=>{state.selectedHour=Number(el.slider.value);renderAll();});
  document.querySelectorAll('.chart-tab').forEach((button)=>button.addEventListener('click',()=>{
    state.chartVariable=button.dataset.variable;
    document.querySelectorAll('.chart-tab').forEach((tab)=>tab.classList.toggle('active',tab===button));
    drawWeatherChart();
  }));
  el.refresh.addEventListener('click',refreshData);
  el.download.addEventListener('click',downloadForecastCSV);
  el.mapMetric.addEventListener('change',()=>{state.mapMetric=el.mapMetric.value;renderMapMarkers();});
  el.riverSelect.addEventListener('change',renderRiverChart);
  el.trackToggle.addEventListener('change',()=>{
    if (!el.trackToggle.checked) { if(state.trackLayer) state.map.removeLayer(state.trackLayer); state.trackLayer=null; }
    else drawSelectedTrack();
  });
  el.stormSelect.addEventListener('change',(event)=>{
    state.selectedStormId=event.target.value;
    if (!el.trackToggle.checked) el.trackToggle.checked=true;
    renderStormDetails();
  });
  el.aifsRefresh.addEventListener('click',()=>loadAifsGuidance(true));
  el.aifsDownloadImage.addEventListener('click',downloadAifsForecastImage);
  el.aifsTrackToggle.addEventListener('change',()=>{state.aifsMapTouched=true;drawAifsTracks();});
  el.aifsScenario.addEventListener('change',(event)=>{
    state.selectedAifsStormId=event.target.value;
    renderAifsStages();
    drawAifsTracks();
  });
}

populateLocations();
connectControls();
if (location.protocol === 'file:') el.fileNotice.hidden = false;
loadStormArchive();
loadAifsGuidance();
refreshData().then(()=>initializeMap());
