const scenarios = {
  coastal: {
    label: 'Cyclone + high tide',
    offset: { rain: 0, surge: 0, tide: 0, river: 0 },
  },
  'rain-first': {
    label: 'Heavy rain arrives first',
    offset: { rain: -4, surge: -1, tide: 1, river: 2 },
  },
  'river-lag': {
    label: 'River peak arrives later',
    offset: { rain: 0, surge: 0, tide: 0, river: 5 },
  },
};

const hazards = [
  { id: 'rain', label: 'Heavy rain', short: 'RAIN', color: '#d76d4c', spread: 4.7, weight: 0.25 },
  { id: 'surge', label: 'Coastal water', short: 'COAST', color: '#8071a8', spread: 4.2, weight: 0.32 },
  { id: 'tide', label: 'High tide', short: 'TIDE', color: '#4b8db8', spread: 5.2, weight: 0.18 },
  { id: 'river', label: 'River rise', short: 'RIVER', color: '#0e9b94', spread: 6.1, weight: 0.25 },
];

const blocks = [
  { id: 'puri', name: 'Puri', region: 'Coastal · Mahanadi basin', x: 454, y: 264, rain: { peak: 10, amp: 78 }, surge: { peak: 12, amp: 91 }, tide: { peak: 12, amp: 84 }, river: { peak: 15, amp: 70 } },
  { id: 'jagatsinghpur', name: 'Jagatsinghpur', region: 'Coastal · Mahanadi delta', x: 493, y: 219, rain: { peak: 12, amp: 86 }, surge: { peak: 14, amp: 79 }, tide: { peak: 12, amp: 85 }, river: { peak: 16, amp: 80 } },
  { id: 'kendrapara', name: 'Kendrapara', region: 'Delta · Brahmani–Baitarani', x: 527, y: 173, rain: { peak: 14, amp: 75 }, surge: { peak: 15, amp: 68 }, tide: { peak: 12, amp: 81 }, river: { peak: 17, amp: 86 } },
  { id: 'bhadrak', name: 'Bhadrak', region: 'Coastal · Baitarani basin', x: 565, y: 130, rain: { peak: 15, amp: 72 }, surge: { peak: 17, amp: 62 }, tide: { peak: 15, amp: 73 }, river: { peak: 18, amp: 76 } },
  { id: 'ganjam', name: 'Ganjam', region: 'Coastal · Southern Odisha', x: 418, y: 316, rain: { peak: 8, amp: 72 }, surge: { peak: 10, amp: 81 }, tide: { peak: 10, amp: 78 }, river: { peak: 13, amp: 62 } },
];

const riskLevels = [
  { label: 'LOW', color: '#21877d', pale: '#e5f4f2' },
  { label: 'WATCH', color: '#ad8128', pale: '#fbf3df' },
  { label: 'ELEVATED', color: '#c66543', pale: '#faeee9' },
  { label: 'HIGH', color: '#a84948', pale: '#f8e9e8' },
];

const controls = {
  scenario: document.querySelector('#scenario-select'),
  slider: document.querySelector('#time-slider'),
  timeReadout: document.querySelector('#time-readout'),
  peakButton: document.querySelector('#peak-button'),
  blockList: document.querySelector('#block-list'),
  markers: document.querySelector('#map-markers'),
  timeline: document.querySelector('#hazard-timeline'),
  summaryBlock: document.querySelector('#summary-block'),
  summaryRisk: document.querySelector('#summary-risk'),
  summaryWindow: document.querySelector('#summary-window'),
  timelineBlock: document.querySelector('#timeline-block'),
  timelineHour: document.querySelector('#timeline-hour'),
  detailBlock: document.querySelector('#detail-block'),
  riskPill: document.querySelector('#risk-pill'),
  signalCopy: document.querySelector('#signal-copy'),
  signalList: document.querySelector('#signal-list'),
  downloadButton: document.querySelector('#download-button'),
};

let selectedBlockId = 'puri';

function currentScenario() {
  return scenarios[controls.scenario.value] ?? scenarios.coastal;
}

function signalAt(block, hazard, hour) {
  const scenario = currentScenario();
  const peak = block[hazard.id].peak + scenario.offset[hazard.id];
  const distance = (hour - peak) / hazard.spread;
  const curve = block[hazard.id].amp * Math.exp(-0.5 * distance * distance);
  return Math.round(Math.min(100, 4 + curve));
}

function scoreAt(block, hour) {
  const values = hazards.map((hazard) => signalAt(block, hazard, hour));
  const weighted = hazards.reduce((total, hazard, index) => total + values[index] * hazard.weight, 0);
  const simultaneous = values.filter((value) => value >= 58).length;
  const overlapBoost = Math.max(0, simultaneous - 1) * 5;
  return Math.min(100, Math.round(weighted + overlapBoost));
}

function riskFor(score) {
  if (score >= 72) return riskLevels[3];
  if (score >= 53) return riskLevels[2];
  if (score >= 32) return riskLevels[1];
  return riskLevels[0];
}

function peakWindow(block) {
  const values = Array.from({ length: 25 }, (_, hour) => ({ hour, score: scoreAt(block, hour) }));
  const peak = values.reduce((best, item) => item.score > best.score ? item : best, values[0]);
  const threshold = Math.max(48, peak.score - 12);
  const window = values.filter((item) => item.score >= threshold);
  const start = window[0]?.hour ?? peak.hour;
  const end = window.at(-1)?.hour ?? peak.hour;
  return { peak: peak.hour, score: peak.score, start, end };
}

function formatHour(hour) {
  return `T+${String(hour).padStart(2, '0')}`;
}

function selectedBlock() {
  return blocks.find((block) => block.id === selectedBlockId) ?? blocks[0];
}

function renderBlockList(hour) {
  const ordered = [...blocks].sort((a, b) => scoreAt(b, hour) - scoreAt(a, hour));
  controls.blockList.innerHTML = ordered.map((block) => {
    const score = scoreAt(block, hour);
    const risk = riskFor(score);
    return `<button class="block-row ${block.id === selectedBlockId ? 'selected' : ''}" type="button" role="listitem" data-block="${block.id}" aria-pressed="${block.id === selectedBlockId}" style="--row-color:${risk.color}">
      <span class="block-tone" aria-hidden="true"></span>
      <span><span class="block-name">${block.name}</span><span class="block-region">${block.region}</span></span>
      <span class="block-score"><strong>${score}</strong><small>${risk.label}</small></span>
    </button>`;
  }).join('');
  controls.blockList.querySelectorAll('[data-block]').forEach((button) => {
    button.addEventListener('click', () => selectBlock(button.dataset.block));
  });
}

function renderMapMarkers(hour) {
  controls.markers.innerHTML = blocks.map((block) => {
    const risk = riskFor(scoreAt(block, hour));
    const title = `${block.name}: ${risk.label.toLowerCase()} sample index ${scoreAt(block, hour)} out of 100. Select to inspect.`;
    return `<g class="map-marker ${block.id === selectedBlockId ? 'selected' : ''}" data-block="${block.id}" tabindex="0" role="button" aria-label="${title}" style="--marker-color:${risk.color}">
      <title>${title}</title>
      <circle class="marker-halo" cx="${block.x}" cy="${block.y}" r="15"></circle>
      <circle class="marker-core" cx="${block.x}" cy="${block.y}" r="7"></circle>
      <text class="marker-label" x="${block.x + 12}" y="${block.y + 4}">${block.name}</text>
    </g>`;
  }).join('');
  controls.markers.querySelectorAll('[data-block]').forEach((marker) => {
    marker.addEventListener('click', () => selectBlock(marker.dataset.block));
    marker.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectBlock(marker.dataset.block);
      }
    });
  });
}

function renderTimeline(block, hour) {
  const rows = hazards.map((hazard) => {
    const cells = Array.from({ length: 9 }, (_, index) => {
      const tick = index * 3;
      const intensity = signalAt(block, hazard, tick);
      const opacity = (0.2 + (intensity / 100) * 0.78).toFixed(2);
      const nearestTick = Math.round(hour / 3) * 3;
      const title = `${hazard.label} at ${formatHour(tick)}: ${intensity} illustrative intensity`;
      return `<span class="hazard-cell ${tick === nearestTick ? 'current' : ''}" style="--cell-color:${hazard.color};--cell-opacity:${opacity}" title="${title}"></span>`;
    }).join('');
    return `<div class="hazard-row"><span class="hazard-name">${hazard.label}</span><div class="hazard-cells">${cells}<span class="time-cursor" style="left:${(hour / 24) * 100}%"></span></div></div>`;
  }).join('');
  controls.timeline.innerHTML = `${rows}<div class="hazard-axis"><span></span><div class="axis-ticks"><span>T+00</span><span>T+06</span><span>T+12</span><span>T+18</span><span>T+24</span></div></div>`;
  controls.timeline.setAttribute('aria-label', `Illustrative hazard intensities for ${block.name} at ${formatHour(hour)}. Higher filled cells indicate stronger sample signals.`);
}

function renderSignals(block, hour) {
  const score = scoreAt(block, hour);
  const risk = riskFor(score);
  const values = Object.fromEntries(hazards.map((hazard) => [hazard.id, signalAt(block, hazard, hour)]));
  const strong = hazards.filter((hazard) => values[hazard.id] >= 58).map((hazard) => hazard.label.toLowerCase());
  controls.signalCopy.textContent = strong.length >= 2
    ? `${strong.slice(0, -1).join(', ')}${strong.length > 2 ? ',' : ''} and ${strong.at(-1)} are strong together in this sample window.`
    : 'Few sample drivers peak together at this hour. Move the timeline to compare the overlap window.';
  controls.riskPill.textContent = `${risk.label} · ${score}/100`;
  controls.riskPill.style.setProperty('--risk-color', risk.color);
  controls.riskPill.style.setProperty('--risk-pale', risk.pale);
  controls.signalList.innerHTML = hazards.map((hazard) => {
    const value = values[hazard.id];
    return `<div class="signal-item" style="--signal-color:${hazard.color};--value:${value}%">
      <span>${hazard.label.toUpperCase()}</span>
      <div class="signal-value-row"><strong>${value}</strong><small>/ 100</small></div>
      <div class="signal-meter" aria-hidden="true"><i></i></div>
    </div>`;
  }).join('');
}

function update() {
  const hour = Number(controls.slider.value);
  const block = selectedBlock();
  const score = scoreAt(block, hour);
  const risk = riskFor(score);
  const window = peakWindow(block);

  controls.timeReadout.textContent = `${formatHour(hour)} hours`;
  controls.summaryBlock.textContent = block.name;
  controls.summaryRisk.textContent = `${score} / 100`;
  controls.summaryWindow.textContent = `${formatHour(window.start)}–${formatHour(window.end)}`;
  controls.timelineBlock.textContent = block.name;
  controls.timelineHour.textContent = formatHour(hour);

  renderBlockList(hour);
  renderMapMarkers(hour);
  renderTimeline(block, hour);
  renderSignals(block, hour);
}

function selectBlock(blockId) {
  if (!blocks.some((block) => block.id === blockId)) return;
  selectedBlockId = blockId;
  document.querySelector('#detail-block').textContent = selectedBlock().name;
  update();
}

controls.slider.addEventListener('input', update);
controls.scenario.addEventListener('change', update);

controls.peakButton.addEventListener('click', () => {
  controls.slider.value = String(peakWindow(selectedBlock()).peak);
  update();
});

controls.downloadButton.addEventListener('click', () => {
  const hour = Number(controls.slider.value);
  const rows = [
    ['Scenario', 'Block', 'Hour', ...hazards.map((hazard) => hazard.label), 'Relative demo index'],
    ...blocks.map((block) => [
      currentScenario().label,
      block.name,
      formatHour(hour),
      ...hazards.map((hazard) => signalAt(block, hazard, hour)),
      scoreAt(block, hour),
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `odisha-flood-demo-${controls.scenario.value}-${formatHour(hour).toLowerCase()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

update();
