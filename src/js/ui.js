/**
 * UI Controller — tab navigation, state management, drag-and-drop
 */

const AppState = {
  parser: null,
  boreholes: [],
  soundings: [],
  sptData: [],
  cptData: [],
  dissipationData: [],
  mwdData: [],
  lithology: [],
  waterTable: [],
  labTests: {},
  projectInfo: {},
  contents: null,          // Discovery results: what's in the file
  otherFeatures: [],       // Non-borehole/sounding sampling features
  units: { depth: 'ft', depthLabel: 'ft', cptQc: '', cptQcLabel: '', cptFs: '', cptFsLabel: '', cptU2: '', cptU2Label: '' },
  currentTab: 'overview',
  selectedBorehole: null,
  selectedSounding: null,
  currentXml: null,
  currentFileName: null,
  hasEmbeddedData: false,
  leafletMap: null,        // Leaflet instance — kept alive across tab switches
  crossSectionMap: null,   // Leaflet inset on the cross-section tab
  crossSectionLayers: null,
  crossSectionTransect: null,  // { startLat, startLon, endLat, endLon, source: 'fit'|'manual' }
};

// --- Unit helpers ---

/** Get display label for depth unit */
function du() { return AppState.units.depthLabel || 'ft'; }
/** Get display label for CPT qc unit */
function qcU() { return AppState.units.cptQcLabel || 'tsf'; }
/** Get display label for CPT fs unit */
function fsU() { return AppState.units.cptFsLabel || 'tsf'; }
/** Get display label for CPT u2 unit */
function u2U() { return AppState.units.cptU2Label || 'tsf'; }

// --- Initialization ---

function initApp() {
  // Check for embedded XML
  const embeddedXml = document.getElementById('embedded-diggs');
  if (embeddedXml && embeddedXml.textContent.trim()) {
    AppState.hasEmbeddedData = true;
    AppState.currentXml = embeddedXml.textContent;
    showLoading('Parsing embedded DIGGS data...');
    setTimeout(() => {
      parseAndRender(AppState.currentXml);
    }, 50);
  } else {
    showDropZone();
  }

  // Tab click handlers
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Header "Load new file" input
  document.getElementById('header-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
      AppState.currentFileName = file.name;
      readFile(file);
    }
    e.target.value = ''; // reset so same file can be re-selected
  });

  updateHeaderActions();

  // Show About on first visit (use localStorage to only show once)
  if (!localStorage.getItem('diggs-viewer-seen')) {
    openAbout();
    localStorage.setItem('diggs-viewer-seen', '1');
  }
}

// --- File loading ---

function showDropZone() {
  document.getElementById('drop-zone').style.display = 'flex';
  document.getElementById('main-content').style.display = 'none';

  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  });

  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) readFile(file);
  });
}

function readFile(file) {
  AppState.currentFileName = file.name;
  showLoading(`Parsing ${file.name}...`);
  const reader = new FileReader();
  reader.onload = e => {
    AppState.currentXml = e.target.result;
    parseAndRender(AppState.currentXml);
  };
  reader.onerror = () => showError('Failed to read file');
  reader.readAsText(file);
}

function showLoading(msg) {
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('main-content').style.display = 'none';
  const loading = document.getElementById('loading');
  loading.style.display = 'flex';
  loading.querySelector('.loading-text').textContent = msg || 'Loading...';
}

function showError(msg) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'flex';
  const dz = document.getElementById('drop-zone');
  const errDiv = dz.querySelector('.error-msg') || document.createElement('div');
  errDiv.className = 'error-msg';
  errDiv.textContent = msg;
  dz.appendChild(errDiv);
}

// --- Parsing & rendering ---

function parseAndRender(xmlString) {
  try {
    AppState.parser = new DIGGSParser(xmlString);
    AppState.contents = AppState.parser.discoverContents();
    AppState.units = AppState.parser.detectUnits();
    AppState.projectInfo = AppState.parser.extractProjectInfo();
    AppState.boreholes = AppState.parser.extractBoreholes();
    AppState.soundings = AppState.parser.extractSoundings();
    AppState.otherFeatures = AppState.parser.extractOtherSamplingFeatures();
    AppState.sptData = AppState.parser.extractSPTData();
    AppState.cptData = AppState.parser.extractCPTData();
    AppState.dissipationData = AppState.parser.extractDissipationTests();
    AppState.mwdData = AppState.parser.extractMWDData();
    AppState.lithology = AppState.parser.extractLithology();
    AppState.waterTable = AppState.parser.extractWaterTable();
    AppState.labTests = AppState.parser.extractLabTests();

    // Fix coordinates
    for (const bh of AppState.boreholes) {
      const [lat, lon] = getValidCoords(bh.Latitude, bh.Longitude);
      bh.Latitude = lat;
      bh.Longitude = lon;
    }
    for (const s of AppState.soundings) {
      const [lat, lon] = getValidCoords(s.Latitude, s.Longitude);
      s.Latitude = lat;
      s.Longitude = lon;
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';

    // Reset all lazy-render flags so tabs re-render with new data
    document.querySelectorAll('.tab-panel').forEach(p => delete p.dataset.rendered);

    // Enable/disable tabs based on data availability
    updateTabAvailability();
    updateHeaderActions();
    renderOverview();
    switchTab('overview');
  } catch (err) {
    console.error('Parse error:', err);
    showError('Failed to parse DIGGS XML: ' + err.message);
  }
}

function updateTabAvailability() {
  // Map requires coordinates AND online connectivity
  const hasCoords = [...AppState.boreholes, ...AppState.soundings, ...AppState.otherFeatures]
    .some(f => f.Latitude != null && f.Longitude != null);

  const tabs = {
    overview: true,
    map: hasCoords && navigator.onLine,
    spt: AppState.sptData.length > 0,
    cpt: AppState.cptData.length > 0,
    dissipation: AppState.dissipationData.length > 0,
    mwd: AppState.mwdData.length > 0,
    'boring-log': AppState.lithology.length > 0,
    'cross-section': AppState.lithology.length > 0 && _crossSectionBoreholes().length >= 2,
    'lab-tests': Object.keys(AppState.labTests).length > 0,
    interpretation: AppState.sptData.length > 0,
  };
  for (const [tab, hasData] of Object.entries(tabs)) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn) {
      btn.style.display = hasData ? '' : 'none';
    }
  }
}

// --- Tab switching ---

function switchTab(tabId) {
  AppState.currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));

  // Lazy render
  const panel = document.getElementById(`tab-${tabId}`);
  if (panel && !panel.dataset.rendered) {
    switch (tabId) {
      case 'overview': renderOverview(); break;
      case 'map': renderMap(); break;
      case 'spt': renderSPT(); break;
      case 'cpt': renderCPT(); break;
      case 'dissipation': renderDissipation(); break;
      case 'mwd': renderMWD(); break;
      case 'boring-log': renderBoringLog(); break;
      case 'cross-section': renderCrossSection(); break;
      case 'lab-tests': renderLabTests(); break;
      case 'interpretation': renderInterpretation(); break;
    }
    panel.dataset.rendered = '1';
  }

  // Re-render on tab switch for charts that need container dimensions
  if (tabId === 'spt' || tabId === 'cpt' || tabId === 'dissipation') {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
  }
  // Leaflet doesn't auto-detect that its container was display:none and is now
  // visible — tiles render gray / map measures wrong without invalidateSize.
  if (tabId === 'map' && AppState.leafletMap) {
    setTimeout(() => AppState.leafletMap.invalidateSize(), 50);
  }
  if (tabId === 'cross-section' && AppState.crossSectionMap) {
    setTimeout(() => AppState.crossSectionMap.invalidateSize(), 50);
  }
}

// --- Overview tab ---

function renderOverview() {
  const container = document.getElementById('tab-overview');
  const p = AppState.projectInfo;

  let html = '';

  // Project info
  if (p.name || p.description) {
    html += `<div class="project-info">`;
    if (p.name) html += `<h3>${escapeHtml(p.name)}</h3>`;
    if (p.description) html += `<p>${escapeHtml(p.description)}</p>`;
    html += `</div>`;
  }

  // Build summary metrics dynamically from what exists
  const metrics = [];
  const colors = ['#1c3d28', '#ff6b35', '#28a745', '#e83e8c', '#6f42c1', '#fd7e14', '#17a2b8', '#20c997'];
  let ci = 0;

  // Sampling features
  if (AppState.boreholes.length > 0) {
    metrics.push({ label: 'Boreholes', value: AppState.boreholes.length, color: colors[ci++ % colors.length] });
  }
  if (AppState.soundings.length > 0) {
    metrics.push({ label: 'CPT Soundings', value: AppState.soundings.length, color: colors[ci++ % colors.length] });
  }
  // Other sampling feature types
  if (AppState.otherFeatures.length > 0) {
    const byType = {};
    for (const f of AppState.otherFeatures) {
      byType[f.Type] = (byType[f.Type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(byType)) {
      // Format "TestPit" -> "Test Pits", "ExcavationSamplingFeature" -> "Excavations"
      const label = type.replace(/SamplingFeature$/, '').replace(/([A-Z])/g, ' $1').trim() + 's';
      metrics.push({ label, value: count, color: colors[ci++ % colors.length] });
    }
  }

  // Tests
  if (AppState.sptData.length > 0) {
    metrics.push({ label: 'SPT Tests', value: AppState.sptData.length, color: colors[ci++ % colors.length] });
  }
  if (AppState.cptData.length > 0) {
    metrics.push({ label: 'CPT Data Points', value: AppState.cptData.length, color: colors[ci++ % colors.length] });
  }
  if (AppState.dissipationData.length > 0) {
    metrics.push({ label: 'Dissipation (PPD) Tests', value: AppState.dissipationData.length, color: colors[ci++ % colors.length] });
  }
  if (AppState.mwdData.length > 0) {
    const mwdPoints = AppState.mwdData.reduce((s, r) => s + r.depths.length, 0);
    metrics.push({ label: 'MWD Data Points', value: mwdPoints, color: colors[ci++ % colors.length] });
  }

  // Other counts
  const allDepths = [
    ...AppState.boreholes.map(b => b.Total_Depth || 0),
    ...AppState.soundings.map(s => s.Total_Depth || 0),
    ...AppState.otherFeatures.map(f => f.Total_Depth || 0),
  ];
  if (allDepths.length > 0) {
    const maxDepth = Math.max(...allDepths);
    if (maxDepth > 0) metrics.push({ label: `Max Depth (${du()})`, value: maxDepth.toFixed(1), color: colors[ci++ % colors.length] });
  }
  if (AppState.lithology.length > 0) {
    metrics.push({ label: 'Soil Layers', value: AppState.lithology.length, color: colors[ci++ % colors.length] });
  }
  if (AppState.waterTable.length > 0) {
    metrics.push({ label: 'Water Table Records', value: AppState.waterTable.length, color: colors[ci++ % colors.length] });
  }
  const labTestCount = Object.values(AppState.labTests).reduce((s, a) => s + a.length, 0);
  if (labTestCount > 0) {
    metrics.push({ label: 'Lab Tests', value: labTestCount, color: colors[ci++ % colors.length] });
  }

  // Render metrics in rows of 4
  for (let i = 0; i < metrics.length; i += 4) {
    html += createMetricRow(metrics.slice(i, i + 4));
  }

  // File contents discovery — show what test types were found
  if (AppState.contents) {
    const tt = AppState.contents.testTypes;
    const testNames = Object.keys(tt);
    if (testNames.length > 0) {
      html += '<div class="section-title">Data Found in File</div>';
      html += '<div class="discovery-grid">';
      for (const [name, count] of Object.entries(tt)) {
        html += `<div class="discovery-item"><span class="discovery-count">${count}</span> ${escapeHtml(name)}</div>`;
      }
      html += '</div>';
    }
  }

  // Borehole table
  if (AppState.boreholes.length > 0) {
    html += createStyledTable(AppState.boreholes.map(({ ID, ...rest }) => rest), 'Boreholes', '#1c3d28');
    html += `<button class="download-btn" onclick="downloadCSV(AppState.boreholes, 'boreholes.csv')">Download Boreholes CSV</button>`;
  }

  // Soundings table
  if (AppState.soundings.length > 0) {
    html += createStyledTable(AppState.soundings, 'CPT Soundings', '#2a5a3a');
    html += `<button class="download-btn" onclick="downloadCSV(AppState.soundings, 'soundings.csv')">Download Soundings CSV</button>`;
  }

  // Other sampling features table
  if (AppState.otherFeatures.length > 0) {
    html += createStyledTable(AppState.otherFeatures, 'Other Sampling Features', '#1c3d28');
    html += `<button class="download-btn" onclick="downloadCSV(AppState.otherFeatures, 'sampling_features.csv')">Download CSV</button>`;
  }

  container.innerHTML = html;
}

// --- Map tab ---

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) { resolve(); return; }
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    css.crossOrigin = '';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.crossOrigin = '';
    js.onload = resolve;
    js.onerror = () => reject(new Error('Failed to load Leaflet — check your internet connection'));
    document.head.appendChild(js);
  });
}

// Borehole map-marker icon — embedded as a base64 PNG so the marker renders
// offline without a separate image request. Source: /home/boring.png (64x64).
const BORING_ICON_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABJUlEQVR42u2aXQ6CMBAG294EE0zw/meRRBI9Cj6REKMiuH+FmWeTyuy3sKWkBAAAAAAA4EDTdmPTdqPX+uXoBTi8gOwR+aXfPIY+707A1j7XlpGjXPj9dk0ppXQ6X0xF5CgVnwTMeZWhISFHifs7ARYiSpReXyNHco0S/eK1JVQ1B3xrE3cBVuPsXILEmlVOgpJJKDVVX2PtavcCUikoNVef3aBAEaoWINEGvA/YW++v3SeQAKkb0NZ+/LT/1648CZAWIFVJy+qLCLB8gckgFFXAlAKPNvg3gSRAuhKWKZC4/6gkwPOJ4CpgXhFtCVJPn6L5x7QkhD4X0JTwGPosPXeYng3+cvxlPXC5nQ4vHYZaTZqH/z7AHb4RYjMEAAAAAAAA5jwBLMCEr7DJ3VkAAAAASUVORK5CYII=';

function _boringIcon() {
  return L.icon({
    iconUrl: BORING_ICON_DATA_URI,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -14],
  });
}

// Inline SVG pin — no external image fetch, so markers render even if the
// Leaflet default-icon PNGs aren't reachable. Sized so the tip lands on
// the borehole location (iconAnchor = bottom-center).
function _boringPinIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
    <path d="M14 0 C6.27 0 0 6.27 0 14 c0 10.5 14 26 14 26 s14 -15.5 14 -26 C28 6.27 21.73 0 14 0 z"
          fill="${color}" stroke="#ffffff" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="5" fill="#ffffff"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: 'boring-pin',
    iconSize: [28, 40],
    iconAnchor: [14, 40],
    popupAnchor: [0, -36],
  });
}

// Switch to the Boring Log tab and select the named borehole. Wired from
// the map popup link so users can jump from a map pin to its boring log.
function openBoringLogForBorehole(name) {
  switchTab('boring-log');
  // renderBoringLog runs lazily; if the tab hadn't rendered yet, switchTab
  // just built the select. Either way the <select> exists now.
  const select = document.getElementById('bl-bh-select');
  if (select) {
    select.value = name;
    if (typeof updateBoringLog === 'function') updateBoringLog(name);
  }
}

// Resize the map container to fill the viewport below the header+tabs.
// Called on render and on window resize so layout stays responsive.
function _resizeMapContainer() {
  const el = document.getElementById('map-container');
  if (!el) return;
  const top = el.getBoundingClientRect().top;
  const h = Math.max(300, window.innerHeight - top - 8);
  el.style.height = h + 'px';
  if (AppState.leafletMap) AppState.leafletMap.invalidateSize();
}

function renderMap() {
  const container = document.getElementById('tab-map');

  if (!navigator.onLine) {
    container.innerHTML = '<div class="map-offline-msg">Map requires an internet connection.<br>Connect to the internet and reload to see the map.</div>';
    return;
  }

  container.innerHTML = '<div id="map-container">Loading map...</div>';
  _resizeMapContainer();
  if (!AppState._mapResizeBound) {
    window.addEventListener('resize', _resizeMapContainer);
    AppState._mapResizeBound = true;
  }

  const featureColors = {
    Borehole: '#e74c3c',
    Sounding: '#3498db',
    Other: '#f39c12',
  };

  // Set of borehole names that actually have lithology — only those get a
  // "View boring log" link in the popup, since the Boring Log tab needs
  // lithology rows to render anything.
  const lithologyNames = new Set(AppState.lithology.map(l => l.Borehole));

  loadLeaflet().then(() => {
    const mapDiv = document.getElementById('map-container');
    mapDiv.innerHTML = '';

    // If a previous map instance is still around (e.g. user loaded a new file),
    // tear it down so it doesn't leak listeners and tile requests.
    if (AppState.leafletMap) {
      try { AppState.leafletMap.remove(); } catch (e) { /* already detached */ }
      AppState.leafletMap = null;
    }

    const map = L.map(mapDiv);
    AppState.leafletMap = map;
    _resizeMapContainer();

    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    });
    satellite.addTo(map);
    L.control.layers({ 'Satellite': satellite, 'Street': street }, null, { position: 'topright' }).addTo(map);

    // Build popup DOM (rather than HTML strings) so we can attach a real
    // click handler for the boring-log link without escaping names into
    // an onclick attribute.
    const _buildPopup = (feature, type) => {
      const el = document.createElement('div');
      const depth = feature.Total_Depth != null
        ? feature.Total_Depth.toFixed(1) + ' ' + du()
        : '—';
      el.innerHTML =
        `<strong>${escapeHtml(feature.Name)}</strong><br>` +
        `Type: ${escapeHtml(type)}<br>` +
        `Depth: ${depth}<br>` +
        `Lat: ${feature.Latitude.toFixed(6)}<br>` +
        `Lon: ${feature.Longitude.toFixed(6)}`;
      if (lithologyNames.has(feature.Name)) {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = 'View boring log →';
        link.style.cssText = 'display:inline-block; margin-top:8px; color:#1c3d28; font-weight:600; text-decoration:none;';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          map.closePopup();
          openBoringLogForBorehole(feature.Name);
        });
        el.appendChild(document.createElement('br'));
        el.appendChild(link);
      }
      return el;
    };

    const markers = [];
    // Boreholes (SPT) get the dedicated boring-target icon; soundings and
    // other features keep their type-colored SVG pins so the three are
    // visually distinct on the map.
    const boreholeIcon = _boringIcon();
    const soundingIcon = _boringPinIcon(featureColors.Sounding);
    const otherIcon = _boringPinIcon(featureColors.Other);

    // Add boreholes
    for (const bh of AppState.boreholes) {
      if (bh.Latitude == null || bh.Longitude == null) continue;
      const m = L.marker([bh.Latitude, bh.Longitude], { icon: boreholeIcon }).addTo(map);
      m.bindPopup(_buildPopup(bh, 'Borehole'));
      markers.push(m);
    }

    // Add soundings
    for (const s of AppState.soundings) {
      if (s.Latitude == null || s.Longitude == null) continue;
      const m = L.marker([s.Latitude, s.Longitude], { icon: soundingIcon }).addTo(map);
      m.bindPopup(_buildPopup(s, 'Sounding'));
      markers.push(m);
    }

    // Add other features
    for (const f of AppState.otherFeatures) {
      if (f.Latitude == null || f.Longitude == null) continue;
      const m = L.marker([f.Latitude, f.Longitude], { icon: otherIcon }).addTo(map);
      m.bindPopup(_buildPopup(f, f.Type || 'Other'));
      markers.push(m);
    }

    // Fit bounds
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.15));
    } else {
      map.setView([39.8, -98.5], 4); // Center of US
    }

    // Legend — Leaflet control so it overlays the map instead of pushing
    // the container shorter (we want the map at full viewport height).
    const legendTypes = [];
    if (AppState.boreholes.some(b => b.Latitude != null)) legendTypes.push({ label: 'Borehole', icon: true });
    if (AppState.soundings.some(s => s.Latitude != null)) legendTypes.push({ label: 'Sounding', color: featureColors.Sounding });
    if (AppState.otherFeatures.some(f => f.Latitude != null)) legendTypes.push({ label: 'Other', color: featureColors.Other });

    if (legendTypes.length > 1) {
      const legend = L.control({ position: 'bottomleft' });
      legend.onAdd = () => {
        const div = L.DomUtil.create('div', 'map-legend');
        let html = '';
        for (const t of legendTypes) {
          // Boreholes show the actual marker icon; soundings/other use a colored swatch.
          const mark = t.icon
            ? `<img class="map-legend-icon" src="${BORING_ICON_DATA_URI}" alt="">`
            : `<span class="map-legend-swatch" style="background:${t.color}"></span>`;
          html += `<div class="map-legend-item">${mark}${t.label}</div>`;
        }
        div.innerHTML = html;
        return div;
      };
      legend.addTo(map);
    }
  }).catch(err => {
    document.getElementById('map-container').innerHTML = `<div class="map-offline-msg">${escapeHtml(err.message)}</div>`;
  });
}

// --- SPT tab ---

function renderSPT() {
  const container = document.getElementById('tab-spt');
  const boreholes = [...new Set(AppState.sptData.map(s => s.Borehole))];

  let html = '<div class="controls">';
  html += '<label>Borehole: <select id="spt-bh-select">';
  for (const bh of boreholes) {
    html += `<option value="${escapeHtml(bh)}">${escapeHtml(bh)}</option>`;
  }
  html += '<option value="">All Boreholes</option>';
  html += '</select></label>';
  html += '</div>';

  html += '<div id="spt-metrics"></div>';
  html += '<div class="chart-container" id="spt-chart"></div>';
  html += '<div id="spt-table"></div>';
  html += `<button class="download-btn" onclick="downloadCSV(AppState.sptData, 'spt_data.csv')">Download SPT CSV</button>`;

  container.innerHTML = html;

  const select = document.getElementById('spt-bh-select');
  select.addEventListener('change', () => updateSPTView(select.value));
  updateSPTView(boreholes[0] || '');
}

function updateSPTView(borehole) {
  const filtered = borehole ? AppState.sptData.filter(s => s.Borehole === borehole) : AppState.sptData;

  // Metrics
  const nValues = filtered.map(s => s.N_Value).filter(v => v != null);
  const maxD = filtered.length > 0 ? Math.max(...filtered.map(s => s.Top_Depth_ft)) : 0;

  // Find water table for selected borehole
  let waterLevel = '—';
  if (borehole) {
    const wt = AppState.waterTable.find(w => w.Borehole === borehole);
    if (wt) waterLevel = wt.Water_Depth_ft.toFixed(1) + ' ' + du();
  }

  document.getElementById('spt-metrics').innerHTML = createMetricRow([
    { label: 'Tests', value: filtered.length, color: '#1c3d28' },
    { label: `Max Depth (${du()})`, value: maxD.toFixed(1), color: '#c8a84b' },
    { label: 'Min N-Value', value: nValues.length ? Math.min(...nValues) : '—', color: '#28a745' },
    { label: 'Max N-Value', value: nValues.length ? Math.max(...nValues) : '—', color: '#dc3545' },
    { label: 'Avg N-Value', value: nValues.length ? (nValues.reduce((a, b) => a + b, 0) / nValues.length).toFixed(1) : '—', color: '#fd7e14' },
    { label: 'Water Level', value: waterLevel, color: '#17a2b8' },
  ]);

  // Chart
  plotNValueProfile(filtered, 'spt-chart', borehole || null);

  // Table
  document.getElementById('spt-table').innerHTML = createStyledTable(filtered, `SPT Data${borehole ? ' — ' + borehole : ''}`, '#1c3d28');
}

// --- CPT tab ---

function renderCPT() {
  const container = document.getElementById('tab-cpt');
  const soundings = [...new Set(AppState.cptData.map(d => d.Sounding_Name))];

  let html = '<div class="controls">';
  html += '<label>Sounding: <select id="cpt-sounding-select">';
  for (const s of soundings) {
    html += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`;
  }
  html += '</select></label>';
  html += '</div>';

  html += '<div id="cpt-metrics"></div>';
  html += '<div class="chart-container" id="cpt-chart"></div>';
  html += '<div id="cpt-sbt-legend"></div>';
  html += '<div id="cpt-table"></div>';
  html += `<button class="download-btn" onclick="downloadCSV(AppState.cptData, 'cpt_data.csv')">Download CPT CSV</button>`;

  container.innerHTML = html;

  const select = document.getElementById('cpt-sounding-select');
  select.addEventListener('change', () => updateCPTView(select.value));
  if (soundings.length > 0) updateCPTView(soundings[0]);
}

function updateCPTView(soundingName) {
  const filtered = AppState.cptData.filter(d => d.Sounding_Name === soundingName);

  // Metrics
  const qcVals = filtered.map(d => d.Tip_Resistance_tsf).filter(v => v != null);
  const fsVals = filtered.map(d => d.Sleeve_Friction_tsf).filter(v => v != null);
  const u2Vals = filtered.map(d => d.Pore_Pressure_tsf).filter(v => v != null);
  const rfVals = filtered.map(d => d.Friction_Ratio_pct).filter(v => v != null);
  const depths = filtered.map(d => d.Depth_ft);

  document.getElementById('cpt-metrics').innerHTML = createMetricRow([
    { label: 'Data Points', value: filtered.length, color: '#1c3d28' },
    { label: `Max Depth (${du()})`, value: depths.length ? Math.max(...depths).toFixed(1) : '—', color: '#c8a84b' },
    { label: `Avg qc (${qcU()})`, value: qcVals.length ? (qcVals.reduce((a, b) => a + b, 0) / qcVals.length).toFixed(1) : '—', color: '#e74c3c' },
    { label: `Avg fs (${fsU()})`, value: fsVals.length ? (fsVals.reduce((a, b) => a + b, 0) / fsVals.length).toFixed(3) : '—', color: '#2ecc71' },
    { label: 'Avg Rf (%)', value: rfVals.length ? (rfVals.reduce((a, b) => a + b, 0) / rfVals.length).toFixed(2) : '—', color: '#f39c12' },
    { label: `Max qc (${qcU()})`, value: qcVals.length ? Math.max(...qcVals).toFixed(1) : '—', color: '#dc3545' },
  ]);

  // Chart
  plotCPTProfile(AppState.cptData, 'cpt-chart', soundingName);

  // SBT Legend
  const sbtZones = [
    { name: 'Gravelly Sand', range: 'Ic < 1.31', color: 'rgba(255,165,0,0.3)' },
    { name: 'Sand', range: '1.31–2.05', color: 'rgba(210,180,140,0.3)' },
    { name: 'Sand Mixture', range: '2.05–2.60', color: 'rgba(144,238,144,0.3)' },
    { name: 'Silt Mixture', range: '2.60–2.95', color: 'rgba(0,128,128,0.3)' },
    { name: 'Clay', range: '2.95–3.60', color: 'rgba(100,149,237,0.3)' },
    { name: 'Organic/Peat', range: 'Ic > 3.60', color: 'rgba(128,0,128,0.3)' },
  ];
  let legendHtml = '<div class="sbt-legend"><strong>SBT Classification (Robertson, 1990)</strong><div class="sbt-items">';
  for (const z of sbtZones) {
    legendHtml += `<div class="sbt-item"><span class="sbt-swatch" style="background:${z.color}"></span>${z.name} (${z.range})</div>`;
  }
  legendHtml += '</div></div>';
  document.getElementById('cpt-sbt-legend').innerHTML = legendHtml;

  // Table (show subset of columns)
  const tableData = filtered.map(d => {
    const row = {};
    row[`Depth (${du()})`] = d.Depth_ft;
    row[`qc (${qcU()})`] = d.Tip_Resistance_tsf;
    row[`fs (${fsU()})`] = d.Sleeve_Friction_tsf;
    row[`u2 (${u2U()})`] = d.Pore_Pressure_tsf;
    row['Rf (%)'] = d.Friction_Ratio_pct;
    return row;
  });
  document.getElementById('cpt-table').innerHTML = createStyledTable(tableData, `CPT Data — ${soundingName}`, '#2a5a3a', '400px');
}

// --- Dissipation (CPT pore-pressure dissipation) tab ---
//
// Mirrors the CPT tab structure: a sounding picker up top, then a per-test
// picker, a u2-vs-time trace chart, and a summary table of the calculated
// parameters (u0, apparent WT depth, U50, t50, ch). Depths render in the
// file's depth unit (m for the ConeTec export) and the u2 trace in its own
// declared unit — the whole point of this tab is that nothing is silently
// assumed to be feet/tsf.
function renderDissipation() {
  const container = document.getElementById('tab-dissipation');
  const data = AppState.dissipationData;

  // Soundings that actually have PPD tests, in first-seen order.
  const soundings = [...new Set(data.map(d => d.Sounding_Name))];

  let html = '<div class="controls">';
  html += '<label>Sounding: <select id="ppd-sounding-select">';
  for (const s of soundings) {
    const n = data.filter(d => d.Sounding_Name === s).length;
    html += `<option value="${escapeHtml(s)}">${escapeHtml(s)} (${n} test${n === 1 ? '' : 's'})</option>`;
  }
  html += '</select></label>';
  html += '<label style="margin-left:16px;">Test depth: <select id="ppd-test-select"></select></label>';
  html += '</div>';

  html += '<div id="ppd-metrics"></div>';
  html += '<div class="chart-container" id="ppd-chart"></div>';
  html += '<div id="ppd-table"></div>';
  html += `<button class="download-btn" onclick="downloadDissipationCSV()">Download Dissipation CSV</button>`;

  container.innerHTML = html;

  const soundingSelect = document.getElementById('ppd-sounding-select');
  soundingSelect.addEventListener('change', () => updateDissipationView(soundingSelect.value));
  if (soundings.length > 0) updateDissipationView(soundings[0]);
}

/** Tests for the selected sounding, sorted by depth (nulls last). */
function _ppdTestsForSounding(soundingName) {
  return AppState.dissipationData
    .filter(d => d.Sounding_Name === soundingName)
    .sort((a, b) => (a.Depth == null ? Infinity : a.Depth) - (b.Depth == null ? Infinity : b.Depth));
}

function updateDissipationView(soundingName) {
  const tests = _ppdTestsForSounding(soundingName);
  const depthU = tests[0] && tests[0].Depth_Unit ? tests[0].Depth_Unit : du();

  // Metrics
  const depths = tests.map(t => t.Depth).filter(v => v != null);
  const wts = tests.map(t => t.wt_depth).filter(v => v != null);
  const wtU = (tests.find(t => t.wt_depth_unit) || {}).wt_depth_unit || depthU;
  document.getElementById('ppd-metrics').innerHTML = createMetricRow([
    { label: 'PPD Tests', value: tests.length, color: '#1c3d28' },
    { label: `Depth Range (${depthU})`, value: depths.length ? `${Math.min(...depths).toFixed(2)}–${Math.max(...depths).toFixed(2)}` : '—', color: '#c8a84b' },
    { label: 'With Params', value: tests.filter(t => t.hasResults).length, color: '#2ecc71' },
    { label: `Mean WT (${wtU})`, value: wts.length ? (wts.reduce((a, b) => a + b, 0) / wts.length).toFixed(2) : '—', color: '#3498db' },
  ]);

  // Per-test picker (value = index into the sorted list)
  const testSelect = document.getElementById('ppd-test-select');
  let opts = '';
  tests.forEach((t, i) => {
    const d = t.Depth != null ? `${t.Depth.toFixed(2)} ${depthU}` : `test ${i + 1}`;
    const tag = t.trace ? (t.hasResults ? '' : ' · trace only') : ' · no trace';
    opts += `<option value="${i}">${escapeHtml(d)}${tag}</option>`;
  });
  testSelect.innerHTML = opts;
  testSelect.onchange = () => plotDissipationTrace(tests[parseInt(testSelect.value)], 'ppd-chart');

  // First test's trace
  if (tests.length > 0) plotDissipationTrace(tests[0], 'ppd-chart');
  else document.getElementById('ppd-chart').innerHTML = '<p class="no-data">No dissipation tests</p>';

  // Summary table for the sounding
  const u0U = (tests.find(t => t.u0_unit) || {}).u0_unit || 'kPa';
  const u50U = (tests.find(t => t.u50_unit) || {}).u50_unit || 'kPa';
  const t50U = (tests.find(t => t.t50_unit) || {}).t50_unit || 's';
  const chU = (tests.find(t => t.ch_unit) || {}).ch_unit || 'cm2/min';
  const tableData = tests.map(t => {
    const row = {};
    row[`Depth (${depthU})`] = t.Depth;
    row[`u0 (${u0U})`] = t.u0;
    row[`Apparent WT (${wtU})`] = t.wt_depth;
    row[`U50 (${u50U})`] = t.u50;
    row[`t50 (${t50U})`] = t.t50;
    row[`ch (${chU})`] = t.ch;
    row['Trace pts'] = t.trace ? t.trace.time.length : 0;
    return row;
  });
  document.getElementById('ppd-table').innerHTML =
    createStyledTable(tableData, `Dissipation Tests — ${soundingName}`, '#2a5a3a', '400px');
}

/** Flatten all PPD tests into a CSV-friendly table (one row per test). */
function downloadDissipationCSV() {
  const rows = AppState.dissipationData.map(t => ({
    Sounding: t.Sounding_Name,
    Depth: t.Depth,
    Depth_Unit: t.Depth_Unit,
    u0: t.u0, u0_unit: t.u0_unit,
    Apparent_WT: t.wt_depth, WT_unit: t.wt_depth_unit,
    U50: t.u50, U50_unit: t.u50_unit,
    t50: t.t50, t50_unit: t.t50_unit,
    ch: t.ch, ch_unit: t.ch_unit,
    trace_points: t.trace ? t.trace.time.length : 0,
    u2_unit: t.trace ? t.trace.u2Unit : '',
  }));
  downloadCSV(rows, 'dissipation_tests.csv');
}

// --- MWD tab ---
//
// Mirrors the CPT tab: borehole picker on top, summary metrics row,
// then a multi-panel depth profile (one panel per recorded channel).
// MWD logs carry their own units (m, bar, rpm, etc.) — don't pull from
// AppState.units, since those track the file's SPT/CPT convention which
// is usually feet.
function renderMWD() {
  const container = document.getElementById('tab-mwd');
  const records = AppState.mwdData;

  let html = '<div class="controls">';
  html += '<label>MWD Log: <select id="mwd-record-select">';
  for (const r of records) {
    const label = `${r.Borehole}${r.MWD_ID && r.MWD_ID !== r.Borehole ? ` (${r.MWD_ID})` : ''}`;
    html += `<option value="${escapeHtml(r.MWD_ID)}">${escapeHtml(label)}</option>`;
  }
  html += '</select></label>';
  html += '</div>';

  html += '<div id="mwd-metrics"></div>';
  html += '<div class="chart-container" id="mwd-chart"></div>';
  html += '<div id="mwd-table"></div>';

  container.innerHTML = html;

  const select = document.getElementById('mwd-record-select');
  select.addEventListener('change', () => updateMWDView(select.value));
  if (records.length > 0) updateMWDView(records[0].MWD_ID);
}

function updateMWDView(mwdId) {
  const record = AppState.mwdData.find(r => r.MWD_ID === mwdId) || AppState.mwdData[0];
  if (!record) return;

  // Summary metrics.
  const validDepths = record.depths.filter(d => d != null && !isNaN(d));
  const maxDepth = validDepths.length ? Math.max(...validDepths) : null;
  const depthLabel = record.depthUnit ? `Max Depth (${record.depthUnit})` : 'Max Depth';
  const metrics = [
    { label: 'Data Points', value: record.depths.length, color: '#1c3d28' },
    { label: depthLabel, value: maxDepth != null ? maxDepth.toFixed(2) : '—', color: '#c8a84b' },
    { label: 'Channels', value: record.channels.length, color: '#2ecc71' },
  ];

  // Channel-level summaries: average and max of non-null values. Skip channels
  // that are entirely null or all-zero (e.g. flow rate on dry drilling).
  for (const ch of record.channels) {
    const vals = (record.data[ch.key] || []).filter(v => v != null && !isNaN(v));
    if (vals.length === 0) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const label = `Avg ${ch.name}${ch.unit ? ` (${ch.unit})` : ''}`;
    metrics.push({ label, value: avg.toFixed(2), color: '#e67e22' });
  }
  document.getElementById('mwd-metrics').innerHTML = createMetricRow(metrics);

  // Depth-profile chart.
  plotMWDProfile(record, 'mwd-chart');

  // Show a small sample table — full table would be 5000+ rows. Take first 50
  // points (typically the spudding sequence near surface, useful for QA).
  const sampleN = Math.min(50, record.depths.length);
  const tableData = [];
  const depthHdr = record.depthUnit ? `Depth (${record.depthUnit})` : 'Depth';
  for (let i = 0; i < sampleN; i++) {
    const row = { '#': i + 1, [depthHdr]: record.depths[i] };
    for (const ch of record.channels) {
      const hdr = `${ch.name}${ch.unit ? ` (${ch.unit})` : ''}`;
      row[hdr] = record.data[ch.key] ? record.data[ch.key][i] : null;
    }
    tableData.push(row);
  }
  const title = `MWD Sample — ${record.Borehole} (first ${sampleN} of ${record.depths.length} rows)`;
  document.getElementById('mwd-table').innerHTML = createStyledTable(tableData, title, '#2a6b3f', '400px');
}

// --- Boring Log tab ---

function renderBoringLog() {
  const container = document.getElementById('tab-boring-log');
  const boreholes = [...new Set(AppState.lithology.map(l => l.Borehole))];

  let html = '<div class="controls">';
  html += '<label>Borehole: <select id="bl-bh-select">';
  for (const bh of boreholes) {
    html += `<option value="${escapeHtml(bh)}">${escapeHtml(bh)}</option>`;
  }
  html += '</select></label>';
  html += `<button class="download-btn" onclick="printBoringLog()">Print / Save PDF</button>`;
  html += '</div>';
  html += '<div id="boring-log-svg"></div>';

  container.innerHTML = html;

  const select = document.getElementById('bl-bh-select');
  select.addEventListener('change', () => updateBoringLog(select.value));
  if (boreholes.length > 0) updateBoringLog(boreholes[0]);
}

function updateBoringLog(borehole) {
  const lithology = AppState.lithology.filter(l => l.Borehole === borehole);
  const sptData = AppState.sptData.filter(s => s.Borehole === borehole);
  const waterTable = AppState.waterTable.find(w => w.Borehole === borehole);
  const boreholeData = AppState.boreholes.find(b =>
    b.Name === borehole || b.ID === borehole || b.ID === `Location_${borehole}`
  );

  // Filter lab tests for this borehole
  const labTests = {};
  for (const [type, tests] of Object.entries(AppState.labTests)) {
    const filtered = tests.filter(t => t.Borehole === borehole);
    if (filtered.length > 0) labTests[type] = filtered;
  }

  const svg = createBoringLogSVG({ boreholeData, sptData, lithology, waterTable, labTests });
  document.getElementById('boring-log-svg').innerHTML = svg;
}

function printBoringLog() {
  const svgContent = document.getElementById('boring-log-svg').innerHTML;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Boring Log</title><style>
    body { margin: 0; padding: 20px; }
    svg { max-width: 100%; height: auto; }
    @media print { body { padding: 0; } }
  </style></head><body>${svgContent}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// --- Cross Section tab ---

/** Get boreholes that have lithology data */
function _crossSectionBoreholes() {
  return [...new Set(AppState.lithology.map(l => l.Borehole))];
}

function renderCrossSection() {
  const container = document.getElementById('tab-cross-section');
  const boreholes = _crossSectionBoreholes();

  if (boreholes.length < 2) {
    container.innerHTML = '<p class="no-data">Need at least 2 boreholes with lithology data for a cross-section</p>';
    return;
  }

  // Tear down any prior section-path map — its DOM is about to be replaced.
  if (AppState.crossSectionMap) {
    try { AppState.crossSectionMap.remove(); } catch (e) { /* already detached */ }
    AppState.crossSectionMap = null;
    AppState.crossSectionLayers = null;
  }
  // Fresh panel → forget any prior transect so the new render starts from a
  // best-fit on the current data (matters after a new XML upload).
  AppState.crossSectionTransect = null;

  let html = '<div class="controls">';
  html += '<label>Boreholes (select 2+):</label>';
  html += '<select id="xs-bh-select" multiple style="min-width: 200px; height: 100px;">';
  for (const bh of boreholes) {
    html += `<option value="${escapeHtml(bh)}" selected>${escapeHtml(bh)}</option>`;
  }
  html += '</select>';
  html += '<button class="download-btn" onclick="updateCrossSection()" style="margin: 0;">Update</button>';
  html += '<button class="download-btn" onclick="resetCrossSectionTransect()" style="margin: 0;">Reset to fit</button>';
  html += '<button class="download-btn" onclick="printCrossSection()" style="margin: 0;">Print / Save PDF</button>';
  html += '</div>';
  // Section path inset map — shows the polyline through selected boreholes
  // in selection order, so users can see the actual path the section follows.
  html += '<div id="xs-map-note" style="font-size:12px;color:#666;margin-top:8px;"></div>';
  html += '<div id="xs-map-container" style="height:280px;width:100%;margin:8px 0 16px;border:1px solid #dee2e6;border-radius:4px;background:#f8f9fa;"></div>';
  html += '<div id="cross-section-svg"></div>';

  // USCS legend
  html += '<div class="sbt-legend"><strong>Soil Classification (USCS)</strong><div class="sbt-items">';
  const uscsInUse = new Set();
  for (const l of AppState.lithology) {
    if (l.USCS_Code) uscsInUse.add(l.USCS_Code);
  }
  for (const code of [...uscsInUse].sort()) {
    const style = USCS_PATTERNS[code];
    if (style) {
      html += `<div class="sbt-item"><span class="sbt-swatch" style="background:${style.color}"></span>${code} — ${style.label}</div>`;
    }
  }
  html += '</div></div>';

  container.innerHTML = html;
  updateCrossSection();
}

function updateCrossSection() {
  const select = document.getElementById('xs-bh-select');
  const selected = [...select.selectedOptions].map(o => o.value);

  if (selected.length < 2) {
    document.getElementById('cross-section-svg').innerHTML = '<p class="no-data">Select at least 2 boreholes</p>';
    _updateCrossSectionMap([]);
    return;
  }

  // Drop a stale best-fit so the new selection gets re-fitted. A user-dragged
  // (source: 'manual') transect persists across selection changes.
  if (AppState.crossSectionTransect && AppState.crossSectionTransect.source === 'fit') {
    AppState.crossSectionTransect = null;
  }

  const svg = createCrossSectionSVG({
    boreholeNames: selected,
    boreholes: AppState.boreholes,
    lithology: AppState.lithology,
    waterTable: AppState.waterTable,
  });
  document.getElementById('cross-section-svg').innerHTML = svg;
  _updateCrossSectionMap(selected);
}

function resetCrossSectionTransect() {
  AppState.crossSectionTransect = null;
  updateCrossSection();
}

/**
 * Render / update the inset Leaflet map showing the section path.
 * Selected boreholes are drawn as numbered markers; a polyline connects them
 * in selection order so the actual section path is explicit (the SVG's
 * X-axis is the polyline length, not a straight-line distance).
 */
function _updateCrossSectionMap(selectedNames) {
  const mapDiv = document.getElementById('xs-map-container');
  const noteDiv = document.getElementById('xs-map-note');
  if (!mapDiv) return;

  if (!navigator.onLine) {
    mapDiv.innerHTML = '<div class="map-offline-msg" style="padding:24px;text-align:center;color:#666;">Section-path preview requires an internet connection.</div>';
    if (noteDiv) noteDiv.textContent = '';
    return;
  }

  const points = selectedNames
    .map((name, i) => {
      const bh = AppState.boreholes.find(b => b.Name === name);
      if (!bh || bh.Latitude == null || bh.Longitude == null) return null;
      return { name, lat: bh.Latitude, lon: bh.Longitude, order: i + 1 };
    })
    .filter(p => p);

  const missing = selectedNames.length - points.length;
  if (noteDiv) {
    noteDiv.textContent = missing > 0
      ? `Note: ${missing} selected borehole${missing > 1 ? 's' : ''} ha${missing > 1 ? 've' : 's'} no coordinates — shown on the section at synthetic 100 m spacing but not on the map.`
      : '';
  }

  if (points.length < 2) {
    mapDiv.innerHTML = '<div class="map-offline-msg" style="padding:24px;text-align:center;color:#666;">Select 2+ boreholes with coordinates to preview the section path.</div>';
    if (AppState.crossSectionMap) {
      try { AppState.crossSectionMap.remove(); } catch (e) { /* already detached */ }
      AppState.crossSectionMap = null;
      AppState.crossSectionLayers = null;
    }
    return;
  }

  loadLeaflet().then(() => {
    // Build (or reuse) the map. The "still in DOM" check covers the case where
    // the cross-section panel was re-rendered (e.g. new XML loaded) and the
    // old map's container was clobbered by innerHTML replacement.
    const stale = AppState.crossSectionMap &&
                  !mapDiv.contains(AppState.crossSectionMap.getContainer());
    if (stale) {
      try { AppState.crossSectionMap.remove(); } catch (e) { /* already detached */ }
      AppState.crossSectionMap = null;
      AppState.crossSectionLayers = null;
    }

    if (!AppState.crossSectionMap) {
      mapDiv.innerHTML = '';  // clear any prior placeholder text
      const map = L.map(mapDiv, { scrollWheelZoom: false });
      const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      });
      const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      });
      satellite.addTo(map);
      L.control.layers({ 'Satellite': satellite, 'Street': street }, null, { position: 'topright' }).addTo(map);
      AppState.crossSectionMap = map;
      AppState.crossSectionLayers = L.layerGroup().addTo(map);
    }

    AppState.crossSectionLayers.clearLayers();

    const transect = AppState.crossSectionTransect;

    if (transect) {
      const lineStart = L.latLng(transect.startLat, transect.startLon);
      const lineEnd = L.latLng(transect.endLat, transect.endLon);
      const transectLine = L.polyline([lineStart, lineEnd], {
        color: '#c8a84b', weight: 3, opacity: 0.95, dashArray: '8,4',
      }).addTo(AppState.crossSectionLayers);

      const handleIcon = L.divIcon({
        className: 'xs-transect-handle',
        html: '<div style="background:#1c3d28;border:2px solid #fff;width:14px;height:14px;box-shadow:0 1px 3px rgba(0,0,0,0.4);cursor:move;"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      for (const [latlng, isStart] of [[lineStart, true], [lineEnd, false]]) {
        const handle = L.marker(latlng, { icon: handleIcon, draggable: true, zIndexOffset: 1000 })
          .addTo(AppState.crossSectionLayers);
        handle.on('drag', e => {
          const ll = e.target.getLatLng();
          const coords = transectLine.getLatLngs();
          coords[isStart ? 0 : 1] = ll;
          transectLine.setLatLngs(coords);
        });
        handle.on('dragend', e => {
          const ll = e.target.getLatLng();
          const cur = AppState.crossSectionTransect;
          AppState.crossSectionTransect = {
            startLat: isStart ? ll.lat : cur.startLat,
            startLon: isStart ? ll.lng : cur.startLon,
            endLat:   isStart ? cur.endLat   : ll.lat,
            endLon:   isStart ? cur.endLon   : ll.lng,
            source: 'manual',
          };
          updateCrossSection();
        });
      }
    }

    // Numbered borehole markers (numbered by multi-select selection order,
    // not transect position — so the numbers may not read left-to-right
    // along the section line, and that is intentional).
    for (const p of points) {
      const icon = L.divIcon({
        className: 'xs-section-marker',
        html: `<div style="background:#fff;border:2px solid #e74c3c;border-radius:50%;width:24px;height:24px;font-size:11px;font-weight:bold;color:#e74c3c;text-align:center;line-height:20px;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${p.order}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([p.lat, p.lon], { icon })
        .bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>Selection position: ${p.order} of ${points.length}`)
        .addTo(AppState.crossSectionLayers);
    }

    // Fit only on a fresh fit (initial load or reset). After a drag the user's
    // current view should be preserved.
    if (!transect || transect.source === 'fit') {
      const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
      if (transect) {
        bounds.extend([transect.startLat, transect.startLon]);
        bounds.extend([transect.endLat, transect.endLon]);
      }
      AppState.crossSectionMap.fitBounds(bounds.pad(0.25));
    }
  }).catch(err => {
    mapDiv.innerHTML = `<div class="map-offline-msg" style="padding:24px;text-align:center;color:#666;">Section-path preview unavailable: ${escapeHtml(err.message)}</div>`;
  });
}

function printCrossSection() {
  const svgContent = document.getElementById('cross-section-svg').innerHTML;
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Cross Section</title><style>
    body { margin: 0; padding: 20px; }
    svg { max-width: 100%; height: auto; }
    @media print { body { padding: 0; } }
  </style></head><body>${svgContent}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// --- Lab Tests tab ---

function renderLabTests() {
  const container = document.getElementById('tab-lab-tests');
  const testTypes = Object.keys(AppState.labTests);

  if (testTypes.length === 0) {
    container.innerHTML = '<p class="no-data">No laboratory test data available</p>';
    return;
  }

  // Test type summary cards
  const colors = ['#1c3d28', '#28a745', '#fd7e14', '#e83e8c', '#6f42c1', '#17a2b8'];
  let html = createMetricRow(testTypes.map((t, i) => ({
    label: t, value: AppState.labTests[t].length + ' tests', color: colors[i % colors.length],
  })));

  html += '<div class="controls">';
  html += '<label>Test Type: <select id="lab-type-select">';
  for (const t of testTypes) {
    html += `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`;
  }
  html += '</select></label>';
  html += '</div>';

  html += '<div id="lab-chart"></div>';
  html += '<div id="lab-table"></div>';

  container.innerHTML = html;

  const select = document.getElementById('lab-type-select');
  select.addEventListener('change', () => updateLabView(select.value));
  updateLabView(testTypes[0]);
}

function updateLabView(testType) {
  const data = AppState.labTests[testType] || [];
  document.getElementById('lab-table').innerHTML = createStyledTable(data, testType, '#2a5a3a');
  plotLabTestProfile(data, 'lab-chart', testType);
}

// --- Interpretation tab ---

function _wtForBorehole(borehole) {
  const wt = AppState.waterTable.find(w => w.Borehole === borehole);
  return wt && wt.Water_Depth_ft != null ? wt.Water_Depth_ft : null;
}

function renderInterpretation() {
  const container = document.getElementById('tab-interpretation');
  const boreholes = [...new Set(AppState.sptData.map(s => s.Borehole))];

  const initialWT = boreholes.length ? _wtForBorehole(boreholes[0]) : null;
  const wtValueAttr = initialWT != null ? `value="${initialWT}"` : 'value="10"';

  let html = '<div class="controls">';
  html += '<label>Borehole: <select id="interp-bh-select">';
  for (const bh of boreholes) {
    html += `<option value="${escapeHtml(bh)}">${escapeHtml(bh)}</option>`;
  }
  html += '</select></label>';
  html += `<label>Water Table (${du()}): <input type="number" id="interp-wt" ${wtValueAttr} step="0.5" min="0" style="width: 80px;" title="Auto-filled from borehole reading when available; edit to override"></label>`;
  html += '<label>Hammer Eff. (%): <input type="number" id="interp-he" value="" placeholder="Auto" step="1" min="0" max="100" style="width: 80px;"></label>';
  html += '<button class="download-btn" onclick="recalcInterpretation()">Recalculate</button>';
  html += '</div>';

  html += '<div id="interp-results"></div>';
  container.innerHTML = html;

  const select = document.getElementById('interp-bh-select');
  const wtInput = document.getElementById('interp-wt');
  // Track whether the user has overridden the auto-fill; if so, don't clobber.
  wtInput.dataset.userEdited = '0';
  wtInput.addEventListener('input', () => { wtInput.dataset.userEdited = '1'; });

  select.addEventListener('change', () => {
    if (wtInput.dataset.userEdited !== '1') {
      const wt = _wtForBorehole(select.value);
      wtInput.value = wt != null ? wt : 10;
    }
    recalcInterpretation();
  });
  recalcInterpretation();
}

function recalcInterpretation() {
  const borehole = document.getElementById('interp-bh-select').value;
  const wtInput = document.getElementById('interp-wt').value;
  const heInput = document.getElementById('interp-he').value;
  const waterTable = wtInput ? parseFloat(wtInput) : 10;
  const hammerEff = heInput ? parseFloat(heInput) : null;

  const sptData = AppState.sptData.filter(s => s.Borehole === borehole);
  const lithology = AppState.lithology.filter(l => l.Borehole === borehole);

  const results = runSPTCorrelations(sptData, lithology, waterTable, hammerEff);

  const resultsDiv = document.getElementById('interp-results');
  if (results.length === 0) {
    resultsDiv.innerHTML = '<p class="no-data">No SPT data for this borehole</p>';
    return;
  }

  // Pick reporting units to match the file's depth unit. SPT correlations
  // return γ in kN/m³ and Es/Su in kPa; convert for imperial files.
  const imperial = du() !== 'm';
  const gammaLabel = imperial ? 'γ (pcf)' : 'γ (kN/m³)';
  const esLabel    = imperial ? 'Es (tsf)' : 'Es (kPa)';
  const suLabel    = imperial ? 'Su (tsf)' : 'Su (kPa)';
  const KNM3_TO_PCF = 6.36588;
  const KPA_TO_TSF = 0.01044;
  const fmtGamma = v => v == null ? '—' : (imperial ? (v * KNM3_TO_PCF).toFixed(1) : v.toFixed(1));
  const fmtEs    = v => v == null ? '—' : (imperial ? (v * KPA_TO_TSF).toFixed(2) : v.toFixed(0));
  const fmtSu    = v => v == null ? '—' : (imperial ? (v * KPA_TO_TSF).toFixed(2) : v.toFixed(1));

  // Format for table display
  const tableData = results.map(r => ({
    [`Depth (${du()})`]: r.depth,
    'N': r.N,
    'N60': r.N60 != null ? r.N60.toFixed(1) : '—',
    '(N1)60': r.N1_60 != null ? r.N1_60.toFixed(1) : '—',
    'USCS': r.USCS,
    'Classification': r.density,
    'φ (°)': r.phi != null ? r.phi.toFixed(1) : '—',
    'Dr (%)': r.Dr != null ? r.Dr.toFixed(1) : '—',
    [gammaLabel]: fmtGamma(r.gamma),
    [esLabel]: fmtEs(r.Es),
    [suLabel]: fmtSu(r.Su),
  }));

  let html = createStyledTable(tableData, `SPT Correlations — ${borehole}`, '#2a5a3a');
  html += `<button class="download-btn" onclick="downloadCSV(${JSON.stringify(tableData).replace(/"/g, '&quot;')}, 'spt_correlations.csv')">Download CSV</button>`;

  // Bearing capacity quick estimates — hidden per request; restore by uncommenting.
  // const avgN = results.reduce((s, r) => s + (r.N || 0), 0) / results.length;
  // html += '<div class="section-title">Quick Bearing Capacity Estimates (B=1.5m, Df=1.0m)</div>';
  // const B = 1.5, Df = 1.0;
  // html += createMetricRow([
  //   { label: 'Meyerhof (kPa)', value: GeoCalc.bearingMeyerhof(avgN, B, Df).toFixed(0), color: '#e74c3c' },
  //   { label: 'Bowles (kPa)', value: GeoCalc.bearingBowles(avgN, B, Df).toFixed(0), color: '#2ecc71' },
  //   { label: 'Terzaghi-Peck (kPa)', value: GeoCalc.bearingTerzaghiPeck(avgN, B, Df).toFixed(0), color: '#3498db' },
  // ]);

  resultsDiv.innerHTML = html;
}

// --- Report generation ---

function generateReport() {
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — please allow pop-ups for this page.'); return; }

  const projName = AppState.projectInfo.name ? escapeHtml(AppState.projectInfo.name) : 'Untitled Project';
  const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // --- Collect summary metrics ---
  const metrics = [];
  if (AppState.boreholes.length > 0) metrics.push(['Boreholes', AppState.boreholes.length]);
  if (AppState.soundings.length > 0) metrics.push(['CPT Soundings', AppState.soundings.length]);
  if (AppState.sptData.length > 0) metrics.push(['SPT Tests', AppState.sptData.length]);
  if (AppState.cptData.length > 0) metrics.push(['CPT Data Points', AppState.cptData.length]);
  if (AppState.mwdData.length > 0) {
    const mwdPoints = AppState.mwdData.reduce((s, r) => s + r.depths.length, 0);
    metrics.push(['MWD Data Points', mwdPoints]);
  }

  const allDepths = [
    ...AppState.boreholes.map(b => b.Total_Depth || 0),
    ...AppState.soundings.map(s => s.Total_Depth || 0),
  ];
  if (allDepths.length > 0) {
    const maxDepth = Math.max(...allDepths);
    if (maxDepth > 0) metrics.push([`Max Depth (${du()})`, maxDepth.toFixed(1)]);
  }
  if (AppState.lithology.length > 0) metrics.push(['Soil Layers', AppState.lithology.length]);
  if (AppState.waterTable.length > 0) metrics.push(['Water Table Records', AppState.waterTable.length]);
  const labTestCount = Object.values(AppState.labTests).reduce((s, a) => s + a.length, 0);
  if (labTestCount > 0) metrics.push(['Lab Tests', labTestCount]);

  let metricsHtml = '';
  if (metrics.length > 0) {
    metricsHtml = '<h2>Summary</h2><table class="report-table"><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>';
    for (const [label, value] of metrics) {
      metricsHtml += `<tr><td>${label}</td><td>${value}</td></tr>`;
    }
    metricsHtml += '</tbody></table>';
  }

  // --- Borehole table ---
  let boreholeHtml = '';
  if (AppState.boreholes.length > 0) {
    const cols = Object.keys(AppState.boreholes[0]);
    boreholeHtml = '<div class="page-break"></div><h2>Boreholes</h2><table class="report-table"><thead><tr>';
    for (const c of cols) boreholeHtml += `<th>${escapeHtml(c)}</th>`;
    boreholeHtml += '</tr></thead><tbody>';
    for (const row of AppState.boreholes) {
      boreholeHtml += '<tr>';
      for (const c of cols) {
        const v = row[c];
        boreholeHtml += `<td>${v != null ? escapeHtml(String(v)) : '—'}</td>`;
      }
      boreholeHtml += '</tr>';
    }
    boreholeHtml += '</tbody></table>';
  }

  // --- SPT summary table ---
  let sptHtml = '';
  if (AppState.sptData.length > 0) {
    sptHtml = '<div class="page-break"></div><h2>SPT Data</h2><table class="report-table"><thead><tr>';
    sptHtml += `<th>Borehole</th><th>Depth (${du()})</th><th>N-Value</th>`;
    sptHtml += '</tr></thead><tbody>';
    for (const s of AppState.sptData) {
      sptHtml += `<tr><td>${escapeHtml(s.Borehole)}</td><td>${s.Top_Depth_ft != null ? s.Top_Depth_ft : '—'}</td><td>${s.N_Value != null ? s.N_Value : '—'}</td></tr>`;
    }
    sptHtml += '</tbody></table>';
  }

  // --- Boring log SVG (first borehole) ---
  let boringLogHtml = '';
  if (AppState.lithology.length > 0) {
    const firstBh = [...new Set(AppState.lithology.map(l => l.Borehole))][0];
    const lithology = AppState.lithology.filter(l => l.Borehole === firstBh);
    const sptData = AppState.sptData.filter(s => s.Borehole === firstBh);
    const waterTable = AppState.waterTable.find(w => w.Borehole === firstBh);
    const boreholeData = AppState.boreholes.find(b =>
      b.Name === firstBh || b.ID === firstBh || b.ID === `Location_${firstBh}`
    );
    const labTests = {};
    for (const [type, tests] of Object.entries(AppState.labTests)) {
      const filtered = tests.filter(t => t.Borehole === firstBh);
      if (filtered.length > 0) labTests[type] = filtered;
    }
    try {
      const svg = createBoringLogSVG({ boreholeData, sptData, lithology, waterTable, labTests });
      boringLogHtml = `<div class="page-break"></div><h2>Boring Log — ${escapeHtml(firstBh)}</h2><div class="svg-container">${svg}</div>`;
    } catch (e) {
      console.warn('Could not generate boring log SVG for report:', e);
    }
  }

  // --- Cross section SVG ---
  let crossSectionHtml = '';
  if (AppState.lithology.length > 0) {
    const csBhs = _crossSectionBoreholes();
    if (csBhs.length >= 2) {
      try {
        const svg = createCrossSectionSVG({
          boreholeNames: csBhs,
          boreholes: AppState.boreholes,
          lithology: AppState.lithology,
          waterTable: AppState.waterTable,
        });
        crossSectionHtml = `<div class="page-break"></div><h2>Cross Section</h2><div class="svg-container">${svg}</div>`;
      } catch (e) {
        console.warn('Could not generate cross section SVG for report:', e);
      }
    }
  }

  // --- Write the report document ---
  w.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>DIGGS Data Report — ${projName}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #222;
    margin: 0;
    padding: 40px 50px;
    line-height: 1.5;
  }
  h1 { font-size: 24px; margin: 0 0 4px 0; }
  .report-date { color: #666; font-size: 14px; margin-bottom: 30px; }
  h2 {
    font-size: 18px;
    border-bottom: 2px solid #333;
    padding-bottom: 4px;
    margin-top: 30px;
  }
  .report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin-top: 10px;
  }
  .report-table th, .report-table td {
    border: 1px solid #ccc;
    padding: 6px 10px;
    text-align: left;
  }
  .report-table th {
    background: #f5f5f5;
    font-weight: bold;
  }
  .report-table tr:nth-child(even) { background: #fafafa; }
  .svg-container { text-align: center; margin: 15px 0; }
  .svg-container svg { max-width: 100%; height: auto; }
  .page-break { page-break-before: always; }

  @media print {
    body { padding: 20px; }
    .page-break { page-break-before: always; }
    .report-table { font-size: 11px; }
    .report-table th, .report-table td { padding: 4px 6px; }
  }
</style>
</head>
<body>
  <h1>DIGGS Data Report — ${projName}</h1>
  <div class="report-date">${reportDate}</div>
  ${metricsHtml}
  ${boreholeHtml}
  ${sptHtml}
  ${boringLogHtml}
  ${crossSectionHtml}
</body>
</html>`);
  w.document.close();
  setTimeout(() => w.print(), 800);
}

// --- Header toolbar actions ---

function updateHeaderActions() {
  const container = document.getElementById('header-actions');
  const hasData = AppState.currentXml != null;

  let html = '';

  if (hasData && AppState.currentFileName) {
    html += `<span class="file-name-badge" title="${escapeHtml(AppState.currentFileName)}">${escapeHtml(AppState.currentFileName)}</span>`;
  }

  // Open file
  html += `<button class="header-btn" onclick="document.getElementById('header-file-input').click()" title="Open a DIGGS XML file">`;
  html += `<svg viewBox="0 0 24 24"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>`;
  html += 'Open File';
  html += `</button>`;

  if (hasData) {
    // Export DIGGS XML
    html += `<button class="header-btn" onclick="extractXML()" title="Export the raw DIGGS XML data">`;
    html += `<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
    html += 'Export DIGGS XML';
    html += `</button>`;

    // Save shareable file
    html += `<button class="header-btn primary" onclick="saveAsHTML()" title="Save as a single file anyone can open — no software needed">`;
    html += `<svg viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>`;
    html += 'Save Shareable File';
    html += `</button>`;

    // Generate report
    html += `<button class="header-btn" onclick="generateReport()" title="Generate a printable PDF report">`;
    html += `<svg viewBox="0 0 24 24"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z"/></svg>`;
    html += 'Generate Report';
    html += `</button>`;

    // Validate DIGGS (online only)
    if (navigator.onLine) {
      html += `<button class="header-btn" id="validate-btn" onclick="validateDIGGS()" title="Validate this DIGGS file against the official schema (requires internet)">`;
      html += `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
      html += 'Validate';
      html += `</button>`;
    }
  }

  // About button — always visible
  html += `<button class="about-btn" onclick="openAbout()" title="About DIGGS Viewer">i</button>`;

  container.innerHTML = html;
}

// --- Feature 1: Extract raw XML ---

function extractXML() {
  if (!AppState.currentXml) return;

  // Derive filename
  let filename = 'diggs_data.xml';
  if (AppState.currentFileName) {
    filename = AppState.currentFileName;
    if (!filename.toLowerCase().endsWith('.xml') && !filename.toLowerCase().endsWith('.diggs')) {
      filename += '.xml';
    }
  } else if (AppState.projectInfo.name) {
    filename = AppState.projectInfo.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.xml';
  }

  const blob = new Blob([AppState.currentXml], { type: 'application/xml;charset=utf-8' });
  triggerDownload(blob, filename);
}

// --- Feature 2: Save as self-contained HTML ---

function saveAsHTML() {
  if (!AppState.currentXml) return;

  // Get the full HTML source of this document
  const docClone = document.documentElement.cloneNode(true);

  // Find the embedded-diggs script tag in the clone and replace its content
  const embedTag = docClone.querySelector('#embedded-diggs');
  if (embedTag) {
    // Clear existing content and set new XML
    embedTag.textContent = AppState.currentXml;
  }

  // Remove any runtime state: clear rendered tab content so it re-parses on open
  docClone.querySelectorAll('.tab-panel').forEach(panel => {
    panel.innerHTML = '';
    panel.removeAttribute('data-rendered');
  });

  // Reset visibility state
  const dropZone = docClone.querySelector('#drop-zone');
  if (dropZone) dropZone.style.display = 'none';
  const mainContent = docClone.querySelector('#main-content');
  if (mainContent) mainContent.style.display = 'none';
  const loading = docClone.querySelector('#loading');
  if (loading) loading.style.display = '';

  // Clear Plotly chart containers (they contain large SVGs in the live DOM)
  docClone.querySelectorAll('.js-plotly-plot').forEach(el => el.remove());

  // Build the full HTML string
  const htmlString = '<!DOCTYPE html>\n' + docClone.outerHTML;

  // Derive filename
  let filename = 'viewer.html';
  if (AppState.currentFileName) {
    const stem = AppState.currentFileName.replace(/\.[^.]+$/, '');
    filename = stem + '_viewer.html';
  } else if (AppState.projectInfo.name) {
    filename = AppState.projectInfo.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '_viewer.html';
  }

  const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
  triggerDownload(blob, filename);
}

// --- Download helper ---

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// --- DIGGS Validator ---

const DIGGS_VALIDATOR_URL = 'https://diggs.geosetta.org/api/diggs/validate';

async function validateDIGGS() {
  if (!AppState.currentXml) return;

  const btn = document.getElementById('validate-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" style="animation: spin 0.8s linear infinite"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg> Validating...`;
  }

  // Show or create result container
  let resultContainer = document.getElementById('validation-result');
  if (!resultContainer) {
    resultContainer = document.createElement('div');
    resultContainer.id = 'validation-result';
    resultContainer.className = 'validator-container';
    resultContainer.style.position = 'fixed';
    resultContainer.style.top = '50%';
    resultContainer.style.left = '50%';
    resultContainer.style.transform = 'translate(-50%, -50%)';
    resultContainer.style.zIndex = '1001';
    resultContainer.style.maxWidth = '600px';
    resultContainer.style.width = '90%';
    resultContainer.style.maxHeight = '80vh';
    resultContainer.style.overflowY = 'auto';
    resultContainer.style.boxShadow = '0 8px 32px rgba(0,0,0,0.3)';
    document.body.appendChild(resultContainer);

    // Add overlay
    const overlay = document.createElement('div');
    overlay.id = 'validation-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;';
    overlay.onclick = closeValidation;
    document.body.appendChild(overlay);
  }

  resultContainer.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div><p style="margin-top:12px;color:#666;">Validating against DIGGS schema...</p></div>';
  resultContainer.style.display = 'block';
  document.getElementById('validation-overlay').style.display = 'block';

  try {
    const xmlBlob = new Blob([AppState.currentXml], { type: 'application/xml' });
    const formData = new FormData();
    formData.append('file', xmlBlob, AppState.currentFileName || 'diggs_data.xml');

    const response = await fetch(DIGGS_VALIDATOR_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    renderValidationResult(result);
  } catch (err) {
    resultContainer.innerHTML = `
      <div class="validator-result error">
        <h3>Validation Failed</h3>
        <p>${escapeHtml(err.message)}</p>
        <p style="font-size:12px;margin-top:8px;">Check your internet connection and try again.</p>
      </div>
      <button onclick="closeValidation()" style="margin-top:12px;padding:8px 16px;border:1px solid #ccc;border-radius:4px;background:white;cursor:pointer;">Close</button>`;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Validate`;
    }
  }
}

function renderValidationResult(result) {
  const container = document.getElementById('validation-result');
  const isValid = result.valid === true;

  // Parse the XML report for individual messages
  let messages = [];
  if (result.xml_report) {
    try {
      const parser = new DOMParser();
      const reportDoc = parser.parseFromString(result.xml_report, 'application/xml');
      const msgElements = reportDoc.querySelectorAll('message');
      msgElements.forEach(msg => {
        const severity = msg.querySelector('severity');
        const text = msg.querySelector('text');
        if (text) {
          messages.push({
            severity: severity ? severity.textContent.trim() : 'INFO',
            text: text.textContent.trim(),
          });
        }
      });
    } catch (e) {
      // Fall back to raw text
    }
  }

  const errors = messages.filter(m => m.severity === 'ERROR');
  const warnings = messages.filter(m => m.severity === 'WARNING');

  let html = `<div class="validator-result ${isValid ? 'valid' : 'invalid'}">`;
  html += `<h3>${isValid ? 'Validation Passed' : 'Validation Issues Found'}</h3>`;

  if (isValid) {
    html += '<p>This DIGGS file is valid according to the official schema.</p>';
  } else {
    if (errors.length > 0) html += `<p>${errors.length} error${errors.length > 1 ? 's' : ''} found.</p>`;
    if (warnings.length > 0) html += `<p>${warnings.length} warning${warnings.length > 1 ? 's' : ''} found.</p>`;
  }

  if (messages.length > 0) {
    html += '<div class="validator-messages">';
    for (const m of messages) {
      const cls = m.severity === 'ERROR' ? 'msg-error' : m.severity === 'WARNING' ? 'msg-warning' : 'msg-info';
      html += `<div class="${cls}"><strong>${escapeHtml(m.severity)}:</strong> ${escapeHtml(m.text)}</div>`;
    }
    html += '</div>';
  }

  html += '</div>';
  html += `<div style="margin-top:12px;display:flex;gap:8px;">`;
  html += `<button onclick="closeValidation()" style="padding:8px 16px;border:1px solid #ccc;border-radius:4px;background:white;cursor:pointer;">Close</button>`;
  html += `</div>`;

  container.innerHTML = html;
}

function closeValidation() {
  const r = document.getElementById('validation-result');
  const o = document.getElementById('validation-overlay');
  if (r) r.remove();
  if (o) o.remove();
}

// --- About modal ---

function openAbout() {
  document.getElementById('about-modal').classList.add('visible');
}

function closeAbout() {
  document.getElementById('about-modal').classList.remove('visible');
}

// --- Init on DOM ready ---
document.addEventListener('DOMContentLoaded', initApp);
