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
  // Fill
  FILL:{ color: '#A9A9A9', hatch: 'plus',       edge: '#808080', label: 'Fill' },
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

function _getSoilStyle(uscsCode) {
  return USCS_PATTERNS[uscsCode] || USCS_PATTERNS.CL;
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
  const pxPerFt = 6;
  const bodyH = maxDepth * pxPerFt;
  const totalH = headerH + colHeaderH + bodyH + 40;
  const W = 900;
  const bodyTop = headerH + colHeaderH;

  // Column positions
  const cols = {
    depth:  { x: 0,   w: 50 },
    thick:  { x: 50,  w: 50 },
    desc:   { x: 100, w: 220 },
    legend: { x: 320, w: 60 },
    b1:     { x: 380, w: 40 },
    b2:     { x: 420, w: 40 },
    b3:     { x: 460, w: 40 },
    nTotal: { x: 500, w: 50 },
    nPlot:  { x: 550, w: 180 },
    wc:     { x: 730, w: 55 },
    ll:     { x: 785, w: 55 },
    pl:     { x: 840, w: 60 },
  };

  const maxN = Math.max(50, ...sptData.map(s => s.N_Value || 0));
  const nScale = cols.nPlot.w / maxN;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" width="${W}" style="font-family: Arial, sans-serif; font-size: 10px; background: white;">`;
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
    svg += `<text x="10" y="56" font-size="11" fill="#1a73e8">Water Table: ${waterDepth.toFixed(1)} ${_du}</text>`;
  }
  svg += `<text x="250" y="56" font-size="11">Hammer: ${sptData.length > 0 && sptData[0].Hammer_Efficiency_pct ? sptData[0].Hammer_Efficiency_pct + '% efficiency' : '—'}</text>`;

  // --- Column headers ---
  const headers = [
    { col: 'depth', text: `Depth\n(${_du})` },
    { col: 'thick', text: `Thick\n(${_du})` },
    { col: 'desc',  text: 'Soil Description' },
    { col: 'legend', text: 'USCS' },
    { col: 'b1', text: 'B1' },
    { col: 'b2', text: 'B2' },
    { col: 'b3', text: 'B3' },
    { col: 'nTotal', text: 'N' },
    { col: 'nPlot',  text: `N-Value (0–${maxN})` },
    { col: 'wc', text: 'WC%' },
    { col: 'll', text: 'LL%' },
    { col: 'pl', text: 'PL%' },
  ];

  svg += `<rect x="0" y="${headerH}" width="${W}" height="${colHeaderH}" fill="#4680ff" stroke="#dee2e6"/>`;
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

    const style = _getSoilStyle(layer.USCS_Code);
    const lc = cols.legend;

    // Legend column: fill + pattern
    svg += `<rect x="${lc.x}" y="${y1}" width="${lc.w}" height="${h}" fill="${style.color}" opacity="0.6"/>`;
    svg += `<rect x="${lc.x}" y="${y1}" width="${lc.w}" height="${h}" fill="url(#pat-${layer.USCS_Code || 'CL'})" opacity="0.8"/>`;
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

    // Blow counts
    if (s.Blow_1 != null) svg += `<text x="${cols.b1.x + cols.b1.w/2}" y="${y + 4}" text-anchor="middle" font-size="9">${s.Blow_1}</text>`;
    if (s.Blow_2 != null) svg += `<text x="${cols.b2.x + cols.b2.w/2}" y="${y + 4}" text-anchor="middle" font-size="9">${s.Blow_2}</text>`;
    if (s.Blow_3 != null) svg += `<text x="${cols.b3.x + cols.b3.w/2}" y="${y + 4}" text-anchor="middle" font-size="9">${s.Blow_3}</text>`;

    // N-value text
    if (s.N_Value != null) {
      svg += `<text x="${cols.nTotal.x + cols.nTotal.w/2}" y="${y + 4}" text-anchor="middle" font-size="9" font-weight="bold">${s.N_Value}</text>`;
      nPoints.push({ x: cols.nPlot.x + Math.min(s.N_Value, maxN) * nScale, y });
    }
  }

  // N-value line plot
  if (nPoints.length > 1) {
    const pathD = nPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    svg += `<path d="${pathD}" fill="none" stroke="#4680ff" stroke-width="1.5"/>`;
  }
  for (const p of nPoints) {
    svg += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#4680ff"/>`;
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
    svg += `<line x1="0" y1="${wy}" x2="${W}" y2="${wy}" stroke="#1a73e8" stroke-width="1" stroke-dasharray="6,3"/>`;
    svg += `<polygon points="${cols.depth.x + 5},${wy} ${cols.depth.x + 15},${wy - 8} ${cols.depth.x + 15},${wy + 8}" fill="#1a73e8"/>`;
    svg += `<text x="${cols.depth.x + 20}" y="${wy + 4}" font-size="8" fill="#1a73e8" font-weight="bold">WT ${waterDepth.toFixed(1)} ${_du}</text>`;
  }

  // --- Lab data columns ---
  if (labTests) {
    const wcData = labTests['Water Content'] || [];
    const attData = labTests['Atterberg Limits'] || [];

    for (const wc of wcData) {
      if (wc.Depth_ft == null) continue;
      const y = bodyTop + wc.Depth_ft * pxPerFt;
      // Find water content value — look for key containing 'water' or 'moisture' or 'wc'
      for (const [k, v] of Object.entries(wc)) {
        if (k === 'Borehole' || k === 'Depth_ft') continue;
        if (typeof v === 'number') {
          svg += `<text x="${cols.wc.x + cols.wc.w/2}" y="${y + 4}" text-anchor="middle" font-size="8">${v.toFixed(1)}</text>`;
          break;
        }
      }
    }

    for (const att of attData) {
      if (att.Depth_ft == null) continue;
      const y = bodyTop + att.Depth_ft * pxPerFt;
      for (const [k, v] of Object.entries(att)) {
        if (typeof v !== 'number') continue;
        const kl = k.toLowerCase();
        if (kl.includes('liquid') || kl.includes('ll')) {
          svg += `<text x="${cols.ll.x + cols.ll.w/2}" y="${y + 4}" text-anchor="middle" font-size="8">${v.toFixed(1)}</text>`;
        } else if (kl.includes('plastic') || kl.includes('pl')) {
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
