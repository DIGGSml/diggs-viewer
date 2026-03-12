/**
 * Fence Diagram Cross-Section
 * Port of utils/subsurface_3d.py — create_cross_section_figure
 * Renders a 2D fence diagram as SVG connecting soil layers between boreholes
 */

/**
 * Calculate cumulative distances between boreholes from lat/lon
 * Uses simple Euclidean approximation (111km/deg lat, 85km/deg lon)
 */
function _calcBoreholeDistances(boreholeOrder, boreholes) {
  const distances = [0];
  for (let i = 1; i < boreholeOrder.length; i++) {
    const prev = boreholes.find(b => b.Name === boreholeOrder[i - 1]);
    const curr = boreholes.find(b => b.Name === boreholeOrder[i]);
    if (prev && curr && prev.Latitude != null && curr.Latitude != null) {
      const dlat = (curr.Latitude - prev.Latitude) * 111000;
      const dlon = (curr.Longitude - prev.Longitude) * 85000;
      distances.push(distances[i - 1] + Math.sqrt(dlat * dlat + dlon * dlon));
    } else {
      // No coords — space evenly at 100m
      distances.push(distances[i - 1] + 100);
    }
  }
  return distances;
}

/**
 * Correlate lithology layers between two adjacent boreholes.
 * Collects all depth boundaries and forms trapezoid bands.
 */
function _correlateLayers(bh1, bh2) {
  const bands = [];
  const boundaries = new Set([0]);
  for (const l of bh1.layers) {
    boundaries.add(l.top);
    boundaries.add(l.bottom);
  }
  for (const l of bh2.layers) {
    boundaries.add(l.top);
    boundaries.add(l.bottom);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);

  for (let i = 0; i < sorted.length - 1; i++) {
    const dTop = sorted[i];
    const dBot = sorted[i + 1];
    const dMid = (dTop + dBot) / 2;

    let uscs1 = null, uscs2 = null, desc1 = '', desc2 = '';
    for (const l of bh1.layers) {
      if (l.top <= dMid && dMid < l.bottom) { uscs1 = l.uscs; desc1 = l.desc; break; }
    }
    for (const l of bh2.layers) {
      if (l.top <= dMid && dMid < l.bottom) { uscs2 = l.uscs; desc2 = l.desc; break; }
    }

    const uscs = uscs1 || uscs2;
    if (!uscs) continue;

    bands.push({
      dTop, dBot, uscs,
      desc: desc1 || desc2,
      zTop1: bh1.elev - dTop, zBot1: bh1.elev - dBot,
      zTop2: bh2.elev - dTop, zBot2: bh2.elev - dBot,
      x1: bh1.dist, x2: bh2.dist,
    });
  }
  return bands;
}

/**
 * Build the cross-section SVG
 * @param {Object} opts
 * @param {string[]} opts.boreholeNames — ordered list of borehole names
 * @param {Array} opts.boreholes — full borehole data array
 * @param {Array} opts.lithology — all lithology records
 * @param {Array} opts.waterTable — water table records
 * @returns {string} SVG markup
 */
function createCrossSectionSVG(opts) {
  const { boreholeNames, boreholes, lithology, waterTable } = opts;
  if (!boreholeNames || boreholeNames.length < 2) {
    return '<p class="no-data">Select at least 2 boreholes for a cross-section</p>';
  }

  const _du = typeof du === 'function' ? du() : 'ft';

  // Build profile data per borehole
  const distances = _calcBoreholeDistances(boreholeNames, boreholes);
  const profiles = boreholeNames.map((name, i) => {
    const bh = boreholes.find(b => b.Name === name);
    const layers = lithology
      .filter(l => l.Borehole === name)
      .sort((a, b) => a.Top_Depth_ft - b.Top_Depth_ft)
      .map(l => ({
        top: l.Top_Depth_ft,
        bottom: l.Bottom_Depth_ft || l.Top_Depth_ft,
        uscs: l.USCS_Code || 'CL',
        desc: l.Description || '',
      }));
    const elev = bh && bh.Elevation != null ? bh.Elevation : 0;
    const wt = waterTable ? waterTable.find(w => w.Borehole === name) : null;
    const waterElev = wt ? elev - wt.Water_Depth_ft : null;
    return { name, dist: distances[i], elev, layers, waterElev };
  });

  // Determine coordinate ranges
  const allElevs = [];
  for (const p of profiles) {
    allElevs.push(p.elev);
    for (const l of p.layers) {
      allElevs.push(p.elev - l.bottom);
    }
    if (p.waterElev != null) allElevs.push(p.waterElev);
  }
  const maxDist = Math.max(...profiles.map(p => p.dist));
  const minElev = Math.min(...allElevs);
  const maxElev = Math.max(...allElevs);
  const elevRange = maxElev - minElev || 1;

  // SVG layout
  const margin = { top: 60, bottom: 50, left: 70, right: 30 };
  const W = 900;
  const H = 500;
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;
  const padElev = elevRange * 0.08;
  const zMin = minElev - padElev;
  const zMax = maxElev + padElev;
  const zRange = zMax - zMin;
  const padDist = maxDist * 0.05 || 10;
  const dMin = -padDist;
  const dMax = maxDist + padDist;
  const dRange = dMax - dMin;

  // Coordinate transforms
  const xOf = d => margin.left + ((d - dMin) / dRange) * plotW;
  const yOf = z => margin.top + ((zMax - z) / zRange) * plotH;

  // Column width in data units
  const colW = dRange * 0.025;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" style="font-family: Arial, sans-serif; font-size: 10px; background: white;">`;
  svg += `<defs>${_svgPatternDefs()}</defs>`;

  // Clip path for plot area
  svg += `<clipPath id="plot-clip"><rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}"/></clipPath>`;

  // --- Title ---
  svg += `<text x="${W / 2}" y="22" text-anchor="middle" font-size="14" font-weight="bold">Subsurface Cross-Section</text>`;
  svg += `<text x="${W / 2}" y="38" text-anchor="middle" font-size="11" fill="#666">${boreholeNames.join(' — ')}</text>`;

  // --- Axes ---
  // Y-axis (elevation)
  svg += `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#333" stroke-width="1"/>`;
  svg += `<text x="${margin.left - 45}" y="${margin.top + plotH / 2}" text-anchor="middle" font-size="11" transform="rotate(-90, ${margin.left - 45}, ${margin.top + plotH / 2})">Elevation (${_du})</text>`;

  const nTicksY = 8;
  const elevStep = _niceStep(elevRange, nTicksY);
  for (let z = Math.ceil(zMin / elevStep) * elevStep; z <= zMax; z += elevStep) {
    const y = yOf(z);
    svg += `<line x1="${margin.left - 5}" y1="${y}" x2="${margin.left}" y2="${y}" stroke="#333" stroke-width="0.8"/>`;
    svg += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#eee" stroke-width="0.5"/>`;
    svg += `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="9" fill="#333">${z.toFixed(0)}</text>`;
  }

  // X-axis (distance)
  svg += `<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#333" stroke-width="1"/>`;
  svg += `<text x="${margin.left + plotW / 2}" y="${H - 8}" text-anchor="middle" font-size="11">Distance (m)</text>`;

  const nTicksX = 6;
  const distStep = _niceStep(maxDist || 100, nTicksX);
  for (let d = 0; d <= maxDist + distStep * 0.5; d += distStep) {
    const x = xOf(d);
    svg += `<line x1="${x}" y1="${margin.top + plotH}" x2="${x}" y2="${margin.top + plotH + 5}" stroke="#333" stroke-width="0.8"/>`;
    svg += `<text x="${x}" y="${margin.top + plotH + 17}" text-anchor="middle" font-size="9" fill="#333">${d.toFixed(0)}</text>`;
  }

  // --- Correlated layer bands (trapezoids between boreholes) ---
  svg += `<g clip-path="url(#plot-clip)">`;
  for (let i = 0; i < profiles.length - 1; i++) {
    const bands = _correlateLayers(profiles[i], profiles[i + 1]);
    for (const b of bands) {
      const style = _getSoilStyle(b.uscs);
      const x1 = xOf(b.x1 + colW / 2);
      const x2 = xOf(b.x2 - colW / 2);
      const points = [
        `${x1},${yOf(b.zTop1)}`,
        `${x2},${yOf(b.zTop2)}`,
        `${x2},${yOf(b.zBot2)}`,
        `${x1},${yOf(b.zBot1)}`,
      ].join(' ');
      svg += `<polygon points="${points}" fill="${style.color}" opacity="0.5"/>`;
      svg += `<polygon points="${points}" fill="url(#pat-${b.uscs})" opacity="0.4"/>`;
      svg += `<polygon points="${points}" fill="none" stroke="${style.edge}" stroke-width="0.3"/>`;
    }
  }

  // --- Borehole columns ---
  for (const p of profiles) {
    const xL = xOf(p.dist - colW / 2);
    const xR = xOf(p.dist + colW / 2);
    const w = xR - xL;

    for (const l of p.layers) {
      const yT = yOf(p.elev - l.top);
      const yB = yOf(p.elev - l.bottom);
      const h = yB - yT;
      if (h <= 0) continue;
      const style = _getSoilStyle(l.uscs);
      svg += `<rect x="${xL}" y="${yT}" width="${w}" height="${h}" fill="${style.color}" opacity="0.8"/>`;
      svg += `<rect x="${xL}" y="${yT}" width="${w}" height="${h}" fill="url(#pat-${l.uscs})" opacity="0.7"/>`;
    }

    // Column outline
    if (p.layers.length > 0) {
      const topElev = p.elev - Math.min(...p.layers.map(l => l.top));
      const botElev = p.elev - Math.max(...p.layers.map(l => l.bottom));
      svg += `<rect x="${xL}" y="${yOf(topElev)}" width="${w}" height="${yOf(botElev) - yOf(topElev)}" fill="none" stroke="#333" stroke-width="1.2"/>`;
    }

    // Borehole label
    svg += `<text x="${xOf(p.dist)}" y="${yOf(p.elev) - 8}" text-anchor="middle" font-size="9" font-weight="bold" fill="#333">${escapeXml(p.name)}</text>`;
  }

  // --- Ground surface line ---
  if (profiles.length > 1) {
    const groundPath = profiles.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.dist)} ${yOf(p.elev)}`).join(' ');
    svg += `<path d="${groundPath}" fill="none" stroke="#228B22" stroke-width="2.5"/>`;
  }

  // --- Water table line ---
  const waterPts = profiles.filter(p => p.waterElev != null);
  if (waterPts.length >= 2) {
    const wtPath = waterPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(p.dist)} ${yOf(p.waterElev)}`).join(' ');
    svg += `<path d="${wtPath}" fill="none" stroke="#1E90FF" stroke-width="2" stroke-dasharray="8,4"/>`;
    for (const p of waterPts) {
      const x = xOf(p.dist);
      const y = yOf(p.waterElev);
      svg += `<polygon points="${x},${y} ${x - 5},${y - 8} ${x + 5},${y - 8}" fill="#1E90FF"/>`;
    }
  } else if (waterPts.length === 1) {
    const y = yOf(waterPts[0].waterElev);
    svg += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#1E90FF" stroke-width="1.5" stroke-dasharray="8,4"/>`;
    const x = xOf(waterPts[0].dist);
    svg += `<polygon points="${x},${y} ${x - 5},${y - 8} ${x + 5},${y - 8}" fill="#1E90FF"/>`;
  }

  svg += `</g>`; // end clip

  // --- Legend ---
  const uscsInUse = new Set();
  for (const p of profiles) {
    for (const l of p.layers) uscsInUse.add(l.uscs);
  }
  const legendItems = [...uscsInUse].sort();
  const legendY = H - 2;
  // Only show if we have room and items
  if (legendItems.length > 0 && legendItems.length <= 12) {
    const itemW = Math.min(80, plotW / legendItems.length);
    const startX = margin.left;
    // Legend rendered outside SVG in HTML for better layout
  }

  svg += '</svg>';
  return svg;
}

/** Pick a "nice" step size for axis ticks */
function _niceStep(range, maxTicks) {
  const rough = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / mag;
  let nice;
  if (frac <= 1.5) nice = 1;
  else if (frac <= 3) nice = 2;
  else if (frac <= 7) nice = 5;
  else nice = 10;
  return nice * mag;
}
