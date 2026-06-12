/**
 * SVG Boring Log Renderer
 * Port of utils/boring_log.py — generates professional boring logs as SVG
 */

const USCS_PATTERNS = {
  // Gravels
  GW:  { color: '#C4A574', hatch: 'circles',    edge: '#8B7355', label: 'Well-graded Gravel' },
  GP:  { color: '#D2B48C', hatch: 'circles',    edge: '#A0885A', label: 'Poorly-graded Gravel' },
  GM:  { color: '#8B7355', hatch: 'circles-diag', edge: '#6B5335', label: 'Silty Gravel' },
  GC:  { color: '#6B4226', hatch: 'circles-dash', edge: '#4B2206', label: 'Clayey Gravel' },
  // Sands
  SW:  { color: '#FFD700', hatch: 'dots',       edge: '#DAA520', label: 'Well-graded Sand' },
  SP:  { color: '#FFEC8B', hatch: 'dots',       edge: '#FFD700', label: 'Poorly-graded Sand' },
  SM:  { color: '#F5DEB3', hatch: 'dots-diag',  edge: '#DEB887', label: 'Silty Sand' },
  SC:  { color: '#DAA520', hatch: 'dots-dash',  edge: '#B8860B', label: 'Clayey Sand' },
  // Silts
  ML:  { color: '#90EE90', hatch: 'diag',       edge: '#66CC66', label: 'Low Plasticity Silt' },
  MH:  { color: '#32CD32', hatch: 'diag-dense', edge: '#228B22', label: 'High Plasticity Silt' },
  // Clays
  CL:  { color: '#E9967A', hatch: 'horiz',      edge: '#CD5C5C', label: 'Low Plasticity Clay' },
  CH:  { color: '#CD5C5C', hatch: 'horiz-dense', edge: '#8B3A3A', label: 'High Plasticity Clay' },
  'CL-ML': { color: '#F4A460', hatch: 'horiz-diag', edge: '#D2691E', label: 'Silty Clay' },
  // Organic
  OL:  { color: '#6B8E23', hatch: 'cross',      edge: '#556B2F', label: 'Organic Silt' },
  OH:  { color: '#556B2F', hatch: 'cross-dense', edge: '#2F4F4F', label: 'Organic Clay' },
  PT:  { color: '#2F4F4F', hatch: 'cross-dense', edge: '#1C3C3C', label: 'Peat' },
  TOPSOIL: { color: '#6B5335', hatch: 'cross-dense', edge: '#3B2C18', label: 'Topsoil' },
  // Fill / surface materials (DOT-style codes)
  FILL: { color: '#A9A9A9', hatch: 'plus',     edge: '#808080', label: 'Fill' },
  FL:   { color: '#A9A9A9', hatch: 'plus',     edge: '#808080', label: 'Fill' },
  ASPH: { color: '#3B3B3B', hatch: 'solid',    edge: '#1A1A1A', label: 'Asphalt' },
  CRA:  { color: '#A0A0A0', hatch: 'triangle', edge: '#606060', label: 'Crushed Stone' },
  // Rock / bedrock
  ROCK: { color: '#9090A0', hatch: 'brick',       edge: '#444455', label: 'Rock' },
  BR:   { color: '#9090A0', hatch: 'brick',       edge: '#444455', label: 'Bedrock' },
  WR:   { color: '#A89888', hatch: 'brick-cross', edge: '#553344', label: 'Weathered Rock' },
  DBS:  { color: '#5C5C70', hatch: 'vee',         edge: '#2A2A40', label: 'Diabase' },
  SS:   { color: '#D9C49E', hatch: 'brick',       edge: '#8B7355', label: 'Sandstone' },
  LS:   { color: '#E0E0DC', hatch: 'brick',       edge: '#999988', label: 'Limestone' },
  SH:   { color: '#7A7560', hatch: 'horiz-dense', edge: '#3D3A30', label: 'Shale' },
  // Neutral fallback for any code we don't recognise
  DEFAULT: { color: '#DCDCDC', hatch: 'none', edge: '#888888', label: 'Unclassified' },
};

function _svgPatternDefs() {
  const defs = [];
  const ps = 10; // pattern size

  const patternTypes = {
    circles:      `<circle cx="5" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="0.8"/>`,
    'circles-diag': `<circle cx="3" cy="3" r="1.5" fill="none" stroke="currentColor" stroke-width="0.8"/><line x1="7" y1="0" x2="10" y2="3" stroke="currentColor" stroke-width="0.6"/>`,
    'circles-dash': `<circle cx="5" cy="3" r="1.5" fill="none" stroke="currentColor" stroke-width="0.8"/><line x1="0" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="0.6"/>`,
    dots:         `<circle cx="3" cy="3" r="1" fill="currentColor"/><circle cx="7" cy="7" r="1" fill="currentColor"/>`,
    'dots-diag':  `<circle cx="3" cy="3" r="1" fill="currentColor"/><line x1="7" y1="0" x2="10" y2="3" stroke="currentColor" stroke-width="0.6"/>`,
    'dots-dash':  `<circle cx="3" cy="3" r="1" fill="currentColor"/><line x1="0" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="0.6"/>`,
    diag:         `<line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" stroke-width="0.8"/>`,
    'diag-dense': `<line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" stroke-width="0.8"/><line x1="0" y1="5" x2="5" y2="0" stroke="currentColor" stroke-width="0.6"/>`,
    horiz:        `<line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="0.8"/>`,
    'horiz-dense':`<line x1="0" y1="3" x2="10" y2="3" stroke="currentColor" stroke-width="0.8"/><line x1="0" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="0.8"/>`,
    'horiz-diag': `<line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="0.8"/><line x1="0" y1="10" x2="10" y2="0" stroke="currentColor" stroke-width="0.5"/>`,
    cross:        `<line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="0.8"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="0.8"/>`,
    'cross-dense':`<line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1"/>`,
    plus:         `<line x1="5" y1="0" x2="5" y2="10" stroke="currentColor" stroke-width="0.8"/><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="0.8"/>`,
    // Brick — masonry pattern for rock / bedrock
    brick:        `<line x1="0" y1="0" x2="10" y2="0" stroke="currentColor" stroke-width="0.6"/><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="0.6"/><line x1="0" y1="10" x2="10" y2="10" stroke="currentColor" stroke-width="0.6"/><line x1="5" y1="0" x2="5" y2="5" stroke="currentColor" stroke-width="0.5"/><line x1="0" y1="5" x2="0" y2="10" stroke="currentColor" stroke-width="0.5"/>`,
    'brick-cross':`<line x1="0" y1="0" x2="10" y2="0" stroke="currentColor" stroke-width="0.5"/><line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" stroke-width="0.5"/><line x1="5" y1="0" x2="5" y2="5" stroke="currentColor" stroke-width="0.5"/><line x1="0" y1="5" x2="0" y2="10" stroke="currentColor" stroke-width="0.5"/><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="0.4"/>`,
    // Triangle — angular crushed stone
    triangle:     `<path d="M0,10 L5,0 L10,10 Z" fill="none" stroke="currentColor" stroke-width="0.6"/>`,
    // Vee — chevrons for igneous / diabase
    vee:          `<path d="M0,8 L5,2 L10,8" fill="none" stroke="currentColor" stroke-width="0.7"/>`,
    // Solid — no hatch, just the fill color (asphalt)
    solid:        ``,
    // None — keep the pattern present but empty (for the DEFAULT neutral fallback)
    none:         ``,
  };

  for (const [code, style] of Object.entries(USCS_PATTERNS)) {
    const hatch = style.hatch;
    const content = patternTypes[hatch] || patternTypes.horiz;
    defs.push(
      `<pattern id="pat-${code}" patternUnits="userSpaceOnUse" width="${ps}" height="${ps}" style="color:${style.edge}">${content}</pattern>`
    );
  }
  return defs.join('\n');
}

/**
 * Resolve a soil-classification code to its display style. Returns the style
 * object PLUS a `key` field that callers use to build the SVG pattern URL
 * (`url(#pat-${style.key})`) — important when the input code differs in case
 * from the canonical key (e.g., XML has "topsoil", table has "TOPSOIL").
 * Unknown codes fall through to a neutral grey DEFAULT instead of being
 * mis-rendered as CL.
 */
// DIGGS schema canon: <legendCode> is the graphic-pattern field, and the
// official DocumentationExample.xml uses lowercase descriptive names —
// "shale", "claystone", "asphalt", "silt" — not USCS-style symbols. This
// alias map lets the viewer accept both conventions so a DIGGS-compliant
// exporter and a USCS-symbol exporter both render correctly.
const LEGEND_ALIASES = {
  // soils
  'gravel': 'GP', 'sand': 'SP', 'silt': 'ML', 'clay': 'CL',
  'organic': 'OL', 'organicsoil': 'OL', 'peat': 'PT',
  'topsoil': 'TOPSOIL', 'top_soil': 'TOPSOIL',
  // mixed lithology from the DIGGS doc example — no canonical pattern,
  // map to the unclassified fallback rather than picking arbitrarily
  'gravelsandsiltclay': 'DEFAULT',
  // surface / fill
  'fill': 'FILL', 'asphalt': 'ASPH', 'asph': 'ASPH',
  'crushedstone': 'CRA', 'aggregate': 'CRA',
  // rock
  'rock': 'ROCK', 'bedrock': 'BR',
  'weatheredrock': 'WR', 'weathered_rock': 'WR', 'weathered': 'WR',
  'shale': 'SH', 'claystone': 'SH', 'siltstone': 'SH',
  'sandstone': 'SS', 'limestone': 'LS',
  'diabase': 'DBS', 'basalt': 'DBS', 'granite': 'DBS',
};

// Specific descriptors — first match wins. Order specific-to-general so
// "weathered rock" beats "rock", "sandstone" beats "sand", etc.
const SPECIFIC_KEYWORDS = [
  // rock-state and rock-type modifiers — must win over generic "rock"
  ['weathered rock', 'WR'], ['weathered', 'WR'],
  ['sandstone', 'SS'], ['limestone', 'LS'],
  ['claystone', 'SH'], ['siltstone', 'SH'], ['shale', 'SH'],
  ['diabase', 'DBS'], ['basalt', 'DBS'], ['granite', 'DBS'],
  ['bedrock', 'BR'], ['rock', 'ROCK'],
  // surface materials
  ['asphalt', 'ASPH'], ['topsoil', 'TOPSOIL'], ['top soil', 'TOPSOIL'],
  ['crushed stone', 'CRA'], ['aggregate', 'CRA'],
  ['fill', 'FILL'],
  // distinctive soils
  ['peat', 'PT'], ['organic', 'OL'],
];

// Generic soil nouns. Standard adjective-noun pattern: "silty CLAY" → clay
// is the classification. Use "last occurrence wins" so the head noun (which
// comes last in english) wins over modifiers.
const SOIL_NOUNS = [
  ['clay', 'CL'], ['silt', 'ML'], ['sand', 'SP'], ['gravel', 'GP'],
];

function _scanForCapsKeyword(d, list) {
  for (const [needle, key] of list) {
    if (d.includes(needle.toUpperCase())) return key;
  }
  return null;
}

function _scanForLastCapsNoun(d) {
  let bestPos = -1, bestKey = null;
  for (const [needle, key] of SOIL_NOUNS) {
    const p = d.lastIndexOf(needle.toUpperCase());
    if (p > bestPos) { bestPos = p; bestKey = key; }
  }
  return bestKey;
}

function _scanForLowercaseKeyword(dl, list) {
  for (const [needle, key] of list) {
    if (dl.includes(needle)) return key;
  }
  return null;
}

function _scanForLastLowercaseNoun(dl) {
  let bestPos = -1, bestKey = null;
  for (const [needle, key] of SOIL_NOUNS) {
    const p = dl.lastIndexOf(needle);
    if (p > bestPos) { bestPos = p; bestKey = key; }
  }
  return bestKey;
}

function _getSoilStyle(uscsCode, description) {
  // 1. Exact match (handles case-sensitive forms like "CL-ML")
  if (uscsCode && USCS_PATTERNS[uscsCode]) {
    return { ...USCS_PATTERNS[uscsCode], key: uscsCode };
  }
  // 2. Case-insensitive code match
  if (uscsCode) {
    const upper = String(uscsCode).trim().toUpperCase();
    if (USCS_PATTERNS[upper]) return { ...USCS_PATTERNS[upper], key: upper };
    // 3. DIGGS-canonical legend-code alias (lowercase, stripped of spaces/dashes)
    const norm = String(uscsCode).trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (LEGEND_ALIASES[norm]) {
      const key = LEGEND_ALIASES[norm];
      return { ...USCS_PATTERNS[key], key };
    }
  }
  // 4. Description scan — two-phase. Caps-first because the head noun is
  // typically uppercased in geotechnical descriptions ("silty CLAY").
  if (description) {
    const d = String(description);
    // 4a. Caps specifics (rock, peat, asphalt, etc.) — first match wins
    let key = _scanForCapsKeyword(d, SPECIFIC_KEYWORDS);
    if (key) return { ...USCS_PATTERNS[key], key };
    // 4b. Caps soil nouns — last occurrence wins (head-noun convention)
    key = _scanForLastCapsNoun(d);
    if (key) return { ...USCS_PATTERNS[key], key };
    // 4c. No caps in the description — fall back to lowercase scans
    const dl = d.toLowerCase();
    key = _scanForLowercaseKeyword(dl, SPECIFIC_KEYWORDS);
    if (key) return { ...USCS_PATTERNS[key], key };
    key = _scanForLastLowercaseNoun(dl);
    if (key) return { ...USCS_PATTERNS[key], key };
  }
  return { ...USCS_PATTERNS.DEFAULT, key: 'DEFAULT' };
}

function _wrapText(text, maxChars) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line.length + w.length + 1 > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Create a professional boring log SVG
 * @param {Object} opts - { boreholeData, sptData, lithology, waterTable, labTests }
 * @returns {string} SVG markup
 */
function createBoringLogSVG(opts) {
  const { boreholeData, sptData, lithology, waterTable, labTests } = opts;
  const _du = typeof du === 'function' ? du() : 'ft';
  if (!lithology || lithology.length === 0) return '<p class="no-data">No lithology data for boring log</p>';

  const maxDepth = Math.max(
    ...lithology.map(l => l.Bottom_Depth_ft || l.Top_Depth_ft),
    ...sptData.map(s => s.Top_Depth_ft || 0)
  );

  // Layout constants
  const headerH = 80;
  const colHeaderH = 30;
  const pxPerFt = maxDepth > 0 ? Math.max(6, Math.min(20, 500 / maxDepth)) : 6;
  const bodyH = maxDepth * pxPerFt;
  const totalH = headerH + colHeaderH + bodyH + 40;
  const bodyTop = headerH + colHeaderH;

  // --- Detect which optional columns have data ---
  const hasBlows = sptData.some(s => s.Blow_1 != null || s.Blow_2 != null || s.Blow_3 != null);
  const wcRows = (labTests && labTests['Water Content']) || [];
  const attRows = (labTests && labTests['Atterberg Limits']) || [];
  const hasWc = wcRows.some(r => Object.entries(r).some(([k, v]) =>
      k !== 'Borehole' && k !== 'Depth_ft' && typeof v === 'number'));
  const _attHasKey = (att, needles) => Object.entries(att).some(([k, v]) => {
    if (typeof v !== 'number') return false;
    const kl = k.toLowerCase();
    return needles.some(n => kl.includes(n));
  });
  const hasLL = attRows.some(r => _attHasKey(r, ['liquid', 'll']));
  const hasPL = attRows.some(r => _attHasKey(r, ['plastic', 'pl']));

  // Column spec: (name, baseWidth, present). Lithology is always present here
  // because of the early-return above; depth/desc/nTotal/nPlot are always shown.
  const colSpec = [
    { name: 'depth',  width: 50,  present: true },
    { name: 'thick',  width: 50,  present: true },
    { name: 'desc',   width: 220, present: true },
    { name: 'legend', width: 60,  present: true },
    { name: 'b1',     width: 40,  present: hasBlows },
    { name: 'b2',     width: 40,  present: hasBlows },
    { name: 'b3',     width: 40,  present: hasBlows },
    { name: 'nTotal', width: 50,  present: true },
    { name: 'nPlot',  width: 180, present: true },
    { name: 'wc',     width: 55,  present: hasWc },
    { name: 'll',     width: 55,  present: hasLL },
    { name: 'pl',     width: 60,  present: hasPL },
  ];

  // Redistribute width freed by absent columns: 70% to description, 30% to N-value plot
  const freed = colSpec.filter(c => !c.present).reduce((s, c) => s + c.width, 0);
  const bonus = { desc: freed * 0.7, nPlot: freed * 0.3 };

  const cols = {};
  let _cx = 0;
  for (const c of colSpec) {
    if (!c.present) continue;
    const w = c.width + (bonus[c.name] || 0);
    cols[c.name] = { x: _cx, w };
    _cx += w;
  }
  const W = _cx;

  const maxN = Math.max(50, ...sptData.map(s => s.N_Value || 0));
  const nScale = cols.nPlot.w / maxN;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" preserveAspectRatio="xMidYMin meet" style="display:block; width:100%; height:auto; font-family: Arial, sans-serif; font-size: 10px; background: white;">`;
  svg += `<defs>${_svgPatternDefs()}</defs>`;

  // --- Header ---
  const bhName = boreholeData ? boreholeData.Name : '';
  const bhDepth = boreholeData ? boreholeData.Total_Depth : maxDepth;
  const bhElev = boreholeData ? boreholeData.Elevation : '';
  const waterDepth = waterTable ? waterTable.Water_Depth_ft : null;

  svg += `<rect x="0" y="0" width="${W}" height="${headerH}" fill="#f8f9fa" stroke="#dee2e6"/>`;
  svg += `<text x="10" y="20" font-weight="bold" font-size="14">BORING LOG</text>`;
  svg += `<text x="10" y="38" font-size="11">Borehole: ${bhName}</text>`;
  svg += `<text x="250" y="38" font-size="11">Total Depth: ${bhDepth != null ? bhDepth.toFixed(1) : '—'} ${_du}</text>`;
  svg += `<text x="500" y="38" font-size="11">Elevation: ${bhElev != null ? parseFloat(bhElev).toFixed(1) : '—'} ${_du}</text>`;
  if (waterDepth != null) {
    svg += `<text x="10" y="56" font-size="11" fill="#c8a84b">Water Table: ${waterDepth.toFixed(1)} ${_du}</text>`;
  }
  svg += `<text x="250" y="56" font-size="11">Hammer: ${sptData.length > 0 && sptData[0].Hammer_Efficiency_pct ? sptData[0].Hammer_Efficiency_pct + '% efficiency' : '—'}</text>`;

  // Logo at top-right of header — same image as the viewer header so it shows
  // up in the print/PDF output. Read the data URI from the already-injected
  // .app-logo element so this works for both the default DIGGS logo and any
  // custom logo uploaded via /api/viewer/wrap.
  const _logoImg = typeof document !== 'undefined' ? document.querySelector('.app-logo') : null;
  const _logoSrc = _logoImg && _logoImg.src ? _logoImg.src : '';
  if (_logoSrc) {
    const _lw = 160, _lh = 60;
    const _lx = W - _lw - 10, _ly = (headerH - _lh) / 2;
    svg += `<image href="${_logoSrc}" x="${_lx}" y="${_ly}" width="${_lw}" height="${_lh}" preserveAspectRatio="xMaxYMid meet"/>`;
  }

  // --- Column headers ---
  const headers = [
    { col: 'depth', text: `Depth\n(${_du})` },
    { col: 'thick', text: `Thick\n(${_du})` },
    { col: 'desc',  text: 'Material Description' },
    { col: 'legend', text: 'Graphic' },
    { col: 'b1', text: 'B1' },
    { col: 'b2', text: 'B2' },
    { col: 'b3', text: 'B3' },
    { col: 'nTotal', text: 'N' },
    { col: 'nPlot',  text: `N-Value (0–${maxN})` },
    { col: 'wc', text: 'WC%' },
    { col: 'll', text: 'LL%' },
    { col: 'pl', text: 'PL%' },
  ].filter(h => cols[h.col]);

  svg += `<rect x="0" y="${headerH}" width="${W}" height="${colHeaderH}" fill="#1c3d28" stroke="#dee2e6"/>`;
  for (const h of headers) {
    const c = cols[h.col];
    svg += `<text x="${c.x + c.w/2}" y="${headerH + 18}" text-anchor="middle" fill="white" font-size="9" font-weight="bold">${h.text}</text>`;
  }

  // --- Grid lines ---
  for (let d = 0; d <= maxDepth; d += 5) {
    const y = bodyTop + d * pxPerFt;
    const isLabel = d % 10 === 0;
    svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${isLabel ? '#ccc' : '#eee'}" stroke-width="${isLabel ? 0.8 : 0.4}"/>`;
    if (isLabel) {
      svg += `<text x="${cols.depth.x + cols.depth.w/2}" y="${y + 4}" text-anchor="middle" font-size="9" fill="#666">${d}</text>`;
    }
  }

  // Column borders
  for (const c of Object.values(cols)) {
    svg += `<line x1="${c.x}" y1="${headerH}" x2="${c.x}" y2="${totalH - 40}" stroke="#dee2e6" stroke-width="0.5"/>`;
  }
  svg += `<line x1="${W}" y1="${headerH}" x2="${W}" y2="${totalH - 40}" stroke="#dee2e6" stroke-width="0.5"/>`;

  // --- Lithology layers ---
  for (const layer of lithology) {
    const y1 = bodyTop + layer.Top_Depth_ft * pxPerFt;
    const y2 = bodyTop + (layer.Bottom_Depth_ft || layer.Top_Depth_ft) * pxPerFt;
    const h = y2 - y1;
    if (h <= 0) continue;

    const style = _getSoilStyle(layer.USCS_Code, layer.Description);
    const lc = cols.legend;

    // Legend column: fill + pattern
    svg += `<rect x="${lc.x}" y="${y1}" width="${lc.w}" height="${h}" fill="${style.color}" opacity="0.6"/>`;
    svg += `<rect x="${lc.x}" y="${y1}" width="${lc.w}" height="${h}" fill="url(#pat-${style.key})" opacity="0.8"/>`;
    svg += `<rect x="${lc.x}" y="${y1}" width="${lc.w}" height="${h}" fill="none" stroke="${style.edge}" stroke-width="0.5"/>`;

    // USCS code label
    svg += `<text x="${lc.x + lc.w/2}" y="${y1 + h/2 + 4}" text-anchor="middle" font-size="8" font-weight="bold">${layer.USCS_Code || ''}</text>`;

    // Thickness
    const thick = (layer.Bottom_Depth_ft || layer.Top_Depth_ft) - layer.Top_Depth_ft;
    svg += `<text x="${cols.thick.x + cols.thick.w/2}" y="${y1 + h/2 + 4}" text-anchor="middle" font-size="9">${thick.toFixed(1)}</text>`;

    // Description (wrapped text)
    const descLines = _wrapText(layer.Description, 30);
    const lineH = 12;
    const startY = y1 + Math.max(4, (h - descLines.length * lineH) / 2) + 10;
    for (let i = 0; i < descLines.length && startY + i * lineH < y2 - 2; i++) {
      svg += `<text x="${cols.desc.x + 5}" y="${startY + i * lineH}" font-size="8.5" fill="#333">${escapeXml(descLines[i])}</text>`;
    }
  }

  // --- SPT data ---
  const nPoints = [];
  for (const s of sptData) {
    const y = bodyTop + s.Top_Depth_ft * pxPerFt;

    // Blow counts (only if the columns exist)
    if (cols.b1 && s.Blow_1 != null) svg += `<text x="${cols.b1.x + cols.b1.w/2}" y="${y + 4}" text-anchor="middle" font-size="9">${s.Blow_1}</text>`;
    if (cols.b2 && s.Blow_2 != null) svg += `<text x="${cols.b2.x + cols.b2.w/2}" y="${y + 4}" text-anchor="middle" font-size="9">${s.Blow_2}</text>`;
    if (cols.b3 && s.Blow_3 != null) svg += `<text x="${cols.b3.x + cols.b3.w/2}" y="${y + 4}" text-anchor="middle" font-size="9">${s.Blow_3}</text>`;

    // N-value text
    if (s.N_Value != null) {
      svg += `<text x="${cols.nTotal.x + cols.nTotal.w/2}" y="${y + 4}" text-anchor="middle" font-size="9" font-weight="bold">${s.N_Value}</text>`;
      nPoints.push({ x: cols.nPlot.x + Math.min(s.N_Value, maxN) * nScale, y });
    }
  }

  // N-value line plot
  if (nPoints.length > 1) {
    const pathD = nPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    svg += `<path d="${pathD}" fill="none" stroke="#1c3d28" stroke-width="1.5"/>`;
  }
  for (const p of nPoints) {
    svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#1c3d28"/>`;
  }

  // N-value axis ticks
  for (let n = 0; n <= maxN; n += 10) {
    const x = cols.nPlot.x + n * nScale;
    svg += `<line x1="${x}" y1="${bodyTop}" x2="${x}" y2="${bodyTop + bodyH}" stroke="#eee" stroke-width="0.3"/>`;
    svg += `<text x="${x}" y="${bodyTop - 3}" text-anchor="middle" font-size="7" fill="#999">${n}</text>`;
  }

  // --- Water table indicator ---
  if (waterDepth != null) {
    const wy = bodyTop + waterDepth * pxPerFt;
    svg += `<line x1="0" y1="${wy}" x2="${W}" y2="${wy}" stroke="#c8a84b" stroke-width="1" stroke-dasharray="6,3"/>`;
    svg += `<polygon points="${cols.depth.x + 5},${wy} ${cols.depth.x + 15},${wy - 8} ${cols.depth.x + 15},${wy + 8}" fill="#c8a84b"/>`;
    svg += `<text x="${cols.depth.x + 20}" y="${wy + 4}" font-size="8" fill="#c8a84b" font-weight="bold">WT ${waterDepth.toFixed(1)} ${_du}</text>`;
  }

  // --- Lab data columns ---
  if (labTests) {
    const wcData = labTests['Water Content'] || [];
    const attData = labTests['Atterberg Limits'] || [];

    if (cols.wc) {
      for (const wc of wcData) {
        if (wc.Depth_ft == null) continue;
        const y = bodyTop + wc.Depth_ft * pxPerFt;
        for (const [k, v] of Object.entries(wc)) {
          if (k === 'Borehole' || k === 'Depth_ft') continue;
          if (typeof v === 'number') {
            svg += `<text x="${cols.wc.x + cols.wc.w/2}" y="${y + 4}" text-anchor="middle" font-size="8">${v.toFixed(1)}</text>`;
            break;
          }
        }
      }
    }

    for (const att of attData) {
      if (att.Depth_ft == null) continue;
      const y = bodyTop + att.Depth_ft * pxPerFt;
      for (const [k, v] of Object.entries(att)) {
        if (typeof v !== 'number') continue;
        const kl = k.toLowerCase();
        if (cols.ll && (kl.includes('liquid') || kl.includes('ll'))) {
          svg += `<text x="${cols.ll.x + cols.ll.w/2}" y="${y + 4}" text-anchor="middle" font-size="8">${v.toFixed(1)}</text>`;
        } else if (cols.pl && (kl.includes('plastic') || kl.includes('pl'))) {
          svg += `<text x="${cols.pl.x + cols.pl.w/2}" y="${y + 4}" text-anchor="middle" font-size="8">${v.toFixed(1)}</text>`;
        }
      }
    }
  }

  svg += '</svg>';
  return svg;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
