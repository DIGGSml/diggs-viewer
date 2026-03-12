/**
 * UI Controller — tab navigation, state management, drag-and-drop
 */

const AppState = {
  parser: null,
  boreholes: [],
  soundings: [],
  sptData: [],
  cptData: [],
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
      case 'boring-log': renderBoringLog(); break;
      case 'cross-section': renderCrossSection(); break;
      case 'lab-tests': renderLabTests(); break;
      case 'interpretation': renderInterpretation(); break;
    }
    panel.dataset.rendered = '1';
  }

  // Re-render on tab switch for charts that need container dimensions
  if (tabId === 'spt' || tabId === 'cpt') {
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
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
  const colors = ['#4680ff', '#ff6b35', '#28a745', '#e83e8c', '#6f42c1', '#fd7e14', '#17a2b8', '#20c997'];
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
    html += createStyledTable(AppState.boreholes, 'Boreholes', '#4680ff');
    html += `<button class="download-btn" onclick="downloadCSV(AppState.boreholes, 'boreholes.csv')">Download Boreholes CSV</button>`;
  }

  // Soundings table
  if (AppState.soundings.length > 0) {
    html += createStyledTable(AppState.soundings, 'CPT Soundings', '#ff6b35');
    html += `<button class="download-btn" onclick="downloadCSV(AppState.soundings, 'soundings.csv')">Download Soundings CSV</button>`;
  }

  // Other sampling features table
  if (AppState.otherFeatures.length > 0) {
    html += createStyledTable(AppState.otherFeatures, 'Other Sampling Features', '#6f42c1');
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

function renderMap() {
  const container = document.getElementById('tab-map');

  if (!navigator.onLine) {
    container.innerHTML = '<div class="map-offline-msg">Map requires an internet connection.<br>Connect to the internet and reload to see the map.</div>';
    return;
  }

  container.innerHTML = '<div id="map-container" style="height:550px;">Loading map...</div>';

  const featureColors = {
    Borehole: '#e74c3c',
    Sounding: '#3498db',
    Other: '#f39c12',
  };

  loadLeaflet().then(() => {
    const mapDiv = document.getElementById('map-container');
    mapDiv.innerHTML = '';

    const map = L.map(mapDiv);

    const street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    });
    street.addTo(map);
    L.control.layers({ 'Street': street, 'Satellite': satellite }, null, { position: 'topright' }).addTo(map);

    const markers = [];

    // Add boreholes
    for (const bh of AppState.boreholes) {
      if (bh.Latitude == null || bh.Longitude == null) continue;
      const m = L.circleMarker([bh.Latitude, bh.Longitude], {
        radius: 8, color: featureColors.Borehole, fillColor: featureColors.Borehole,
        fillOpacity: 0.7, weight: 2,
      }).addTo(map);
      m.bindPopup(`<strong>${escapeHtml(bh.Name)}</strong><br>Type: Borehole<br>Depth: ${bh.Total_Depth != null ? bh.Total_Depth.toFixed(1) + ' ' + du() : '—'}<br>Lat: ${bh.Latitude.toFixed(6)}<br>Lon: ${bh.Longitude.toFixed(6)}`);
      markers.push(m);
    }

    // Add soundings
    for (const s of AppState.soundings) {
      if (s.Latitude == null || s.Longitude == null) continue;
      const m = L.circleMarker([s.Latitude, s.Longitude], {
        radius: 8, color: featureColors.Sounding, fillColor: featureColors.Sounding,
        fillOpacity: 0.7, weight: 2,
      }).addTo(map);
      m.bindPopup(`<strong>${escapeHtml(s.Name)}</strong><br>Type: Sounding<br>Depth: ${s.Total_Depth != null ? s.Total_Depth.toFixed(1) + ' ' + du() : '—'}<br>Lat: ${s.Latitude.toFixed(6)}<br>Lon: ${s.Longitude.toFixed(6)}`);
      markers.push(m);
    }

    // Add other features
    for (const f of AppState.otherFeatures) {
      if (f.Latitude == null || f.Longitude == null) continue;
      const m = L.circleMarker([f.Latitude, f.Longitude], {
        radius: 8, color: featureColors.Other, fillColor: featureColors.Other,
        fillOpacity: 0.7, weight: 2,
      }).addTo(map);
      m.bindPopup(`<strong>${escapeHtml(f.Name)}</strong><br>Type: ${escapeHtml(f.Type)}<br>Depth: ${f.Total_Depth != null ? f.Total_Depth.toFixed(1) + ' ' + du() : '—'}<br>Lat: ${f.Latitude.toFixed(6)}<br>Lon: ${f.Longitude.toFixed(6)}`);
      markers.push(m);
    }

    // Fit bounds
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.15));
    } else {
      map.setView([39.8, -98.5], 4); // Center of US
    }

    // Legend
    const legendTypes = [];
    if (AppState.boreholes.some(b => b.Latitude != null)) legendTypes.push({ label: 'Borehole', color: featureColors.Borehole });
    if (AppState.soundings.some(s => s.Latitude != null)) legendTypes.push({ label: 'Sounding', color: featureColors.Sounding });
    if (AppState.otherFeatures.some(f => f.Latitude != null)) legendTypes.push({ label: 'Other', color: featureColors.Other });

    if (legendTypes.length > 1) {
      let legendHtml = '<div class="map-legend">';
      for (const t of legendTypes) {
        legendHtml += `<div class="map-legend-item"><span class="map-legend-swatch" style="background:${t.color}"></span>${t.label}</div>`;
      }
      legendHtml += '</div>';
      container.insertAdjacentHTML('beforeend', legendHtml);
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
    { label: 'Tests', value: filtered.length, color: '#4680ff' },
    { label: `Max Depth (${du()})`, value: maxD.toFixed(1), color: '#6f42c1' },
    { label: 'Min N-Value', value: nValues.length ? Math.min(...nValues) : '—', color: '#28a745' },
    { label: 'Max N-Value', value: nValues.length ? Math.max(...nValues) : '—', color: '#dc3545' },
    { label: 'Avg N-Value', value: nValues.length ? (nValues.reduce((a, b) => a + b, 0) / nValues.length).toFixed(1) : '—', color: '#fd7e14' },
    { label: 'Water Level', value: waterLevel, color: '#17a2b8' },
  ]);

  // Chart
  plotNValueProfile(filtered, 'spt-chart', borehole || null);

  // Table
  document.getElementById('spt-table').innerHTML = createStyledTable(filtered, `SPT Data${borehole ? ' — ' + borehole : ''}`, '#4680ff');
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
    { label: 'Data Points', value: filtered.length, color: '#4680ff' },
    { label: `Max Depth (${du()})`, value: depths.length ? Math.max(...depths).toFixed(1) : '—', color: '#6f42c1' },
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
  document.getElementById('cpt-table').innerHTML = createStyledTable(tableData, `CPT Data — ${soundingName}`, '#ff6b35', '400px');
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

  let html = '<div class="controls">';
  html += '<label>Boreholes (select 2+):</label>';
  html += '<select id="xs-bh-select" multiple style="min-width: 200px; height: 100px;">';
  for (const bh of boreholes) {
    html += `<option value="${escapeHtml(bh)}" selected>${escapeHtml(bh)}</option>`;
  }
  html += '</select>';
  html += '<button class="download-btn" onclick="updateCrossSection()" style="margin: 0;">Update</button>';
  html += '<button class="download-btn" onclick="printCrossSection()" style="margin: 0;">Print / Save PDF</button>';
  html += '</div>';
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
    return;
  }

  const svg = createCrossSectionSVG({
    boreholeNames: selected,
    boreholes: AppState.boreholes,
    lithology: AppState.lithology,
    waterTable: AppState.waterTable,
  });
  document.getElementById('cross-section-svg').innerHTML = svg;
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
  const colors = ['#4680ff', '#28a745', '#fd7e14', '#e83e8c', '#6f42c1', '#17a2b8'];
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
  document.getElementById('lab-table').innerHTML = createStyledTable(data, testType, '#6f42c1');
  plotLabTestProfile(data, 'lab-chart', testType);
}

// --- Interpretation tab ---

function renderInterpretation() {
  const container = document.getElementById('tab-interpretation');
  const boreholes = [...new Set(AppState.sptData.map(s => s.Borehole))];

  let html = '<div class="controls">';
  html += '<label>Borehole: <select id="interp-bh-select">';
  for (const bh of boreholes) {
    html += `<option value="${escapeHtml(bh)}">${escapeHtml(bh)}</option>`;
  }
  html += '</select></label>';
  html += `<label>Water Table (${du()}): <input type="number" id="interp-wt" value="10" step="0.5" min="0" style="width: 80px;"></label>`;
  html += '<label>Hammer Eff. (%): <input type="number" id="interp-he" value="" placeholder="Auto" step="1" min="0" max="100" style="width: 80px;"></label>';
  html += '<button class="download-btn" onclick="recalcInterpretation()">Recalculate</button>';
  html += '</div>';

  html += '<div id="interp-results"></div>';
  container.innerHTML = html;

  const select = document.getElementById('interp-bh-select');
  select.addEventListener('change', () => recalcInterpretation());
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
    'γ (kN/m³)': r.gamma != null ? r.gamma.toFixed(1) : '—',
    'Es (kPa)': r.Es != null ? r.Es.toFixed(0) : '—',
    'Su (kPa)': r.Su != null ? r.Su.toFixed(1) : '—',
  }));

  let html = createStyledTable(tableData, `SPT Correlations — ${borehole}`, '#6f42c1');
  html += `<button class="download-btn" onclick="downloadCSV(${JSON.stringify(tableData).replace(/"/g, '&quot;')}, 'spt_correlations.csv')">Download CSV</button>`;

  // Bearing capacity quick estimates
  const avgN = results.reduce((s, r) => s + (r.N || 0), 0) / results.length;
  html += '<div class="section-title">Quick Bearing Capacity Estimates (B=1.5m, Df=1.0m)</div>';
  const B = 1.5, Df = 1.0;
  html += createMetricRow([
    { label: 'Meyerhof (kPa)', value: GeoCalc.bearingMeyerhof(avgN, B, Df).toFixed(0), color: '#e74c3c' },
    { label: 'Bowles (kPa)', value: GeoCalc.bearingBowles(avgN, B, Df).toFixed(0), color: '#2ecc71' },
    { label: 'Terzaghi-Peck (kPa)', value: GeoCalc.bearingTerzaghiPeck(avgN, B, Df).toFixed(0), color: '#3498db' },
  ]);

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
