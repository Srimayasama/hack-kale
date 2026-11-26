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
  busy: false,
};

const $ = (selector) => document.querySelector(selector);
const el = {
  fileNotice: $('#file-protocol-notice'), map: $('#odisha-map'),
  status: $('#data-status'), refresh: $('#refresh-button'), locationSelect: $('#location-select'),
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
}

populateLocations();
connectControls();
if (location.protocol === 'file:') el.fileNotice.hidden = false;
loadStormArchive();
refreshData().then(()=>initializeMap());
