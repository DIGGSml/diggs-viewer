/**
 * Charts — Plotly wrappers for geotechnical visualizations
 * Port of utils/plotting.py and features/analysis.py chart logic
 */

const USCS_COLORS = {
  GW: '#C4A574', GP: '#D2B48C', GM: '#8B7355', GC: '#6B4226',
  SW: '#FFD700', SP: '#FFEC8B', SM: '#F5DEB3', SC: '#DAA520',
  ML: '#90EE90', MH: '#32CD32',
  CL: '#E9967A', CH: '#CD5C5C', 'CL-ML': '#F4A460',
  OL: '#6B8E23', OH: '#556B2F', PT: '#2F4F4F',
};

function getAxisStyle() {
  return {
    showgrid: true,
    gridcolor: 'rgba(0,0,0,0.1)',
    gridwidth: 1,
    showline: true,
    linecolor: 'rgba(0,0,0,0.3)',
    linewidth: 1,
    mirror: true,
    ticks: 'outside',
    tickcolor: 'rgba(0,0,0,0.3)',
  };
}

function getSoilColor(description, uscsCode) {
  if (uscsCode && USCS_COLORS[uscsCode]) return USCS_COLORS[uscsCode];
  if (!description) return '#808080';
  const d = description.toUpperCase();
  if (d.includes('GRAVEL')) return '#C4A574';
  if (d.includes('SAND')) return '#FFD700';
  if (d.includes('SILT')) return '#90EE90';
  if (d.includes('CLAY')) return '#E9967A';
  if (d.includes('ORGANIC') || d.includes('PEAT')) return '#556B2F';
  return '#808080';
}

// --- SPT N-Value vs Depth ---

function plotNValueProfile(sptData, containerId, boreholeName) {
  const filtered = boreholeName
    ? sptData.filter(d => d.Borehole === boreholeName)
    : sptData;

  if (filtered.length === 0) {
    document.getElementById(containerId).innerHTML = '<p class="no-data">No SPT data available</p>';
    return;
  }

  const axStyle = getAxisStyle();
  const traces = [];
  const colors = ['#4680ff', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#17a2b8',
                  '#e83e8c', '#6f42c1', '#fd7e14', '#20c997', '#343a40', '#6610f2'];

  if (boreholeName) {
    // Single borehole — sort by depth for clean line
    const sorted = [...filtered].sort((a, b) => a.Top_Depth_ft - b.Top_Depth_ft);
    traces.push({
      x: sorted.map(d => d.N_Value),
      y: sorted.map(d => d.Top_Depth_ft),
      mode: 'lines+markers',
      type: 'scatter',
      name: boreholeName,
      marker: { color: '#4680ff', size: 8, symbol: 'diamond' },
      line: { color: '#4680ff', width: 2 },
      hovertemplate: `N = %{x}<br>Depth = %{y:.1f} ${typeof du === 'function' ? du() : 'ft'}<extra></extra>`,
    });
  } else {
    // All boreholes — separate trace per borehole
    const boreholes = [...new Set(filtered.map(d => d.Borehole))];
    boreholes.forEach((bh, i) => {
      const bhData = filtered.filter(d => d.Borehole === bh).sort((a, b) => a.Top_Depth_ft - b.Top_Depth_ft);
      const c = colors[i % colors.length];
      traces.push({
        x: bhData.map(d => d.N_Value),
        y: bhData.map(d => d.Top_Depth_ft),
        mode: 'lines+markers',
        type: 'scatter',
        name: bh,
        marker: { color: c, size: 6, symbol: 'diamond' },
        line: { color: c, width: 1.5 },
        hovertemplate: `${bh}<br>N = %{x}<br>Depth = %{y:.1f} ${typeof du === 'function' ? du() : 'ft'}<extra></extra>`,
      });
    });
  }

  const titleText = boreholeName ? `SPT N-Value Profile — ${boreholeName}` : 'SPT N-Value Profile — All Boreholes';

  const layout = {
    title: { text: titleText, font: { size: 15 }, y: 0.98, x: 0.5, xanchor: 'center' },
    xaxis: {
      ...axStyle,
      title: { text: `N-Value (blows/${(typeof du === 'function' ? du() : 'ft')})`, standoff: 10 },
      side: 'top',
      rangemode: 'tozero',
    },
    yaxis: {
      ...axStyle,
      title: { text: `Depth (${typeof du === 'function' ? du() : 'ft'})`, standoff: 10 },
      autorange: 'reversed',
    },
    margin: { t: 80, b: 30, l: 70, r: 30 },
    plot_bgcolor: '#fff',
    paper_bgcolor: '#fff',
    height: 550,
    showlegend: !boreholeName,
    legend: { x: 1.02, y: 1, font: { size: 10 } },
  };

  Plotly.newPlot(containerId, traces, layout, { responsive: true, displayModeBar: true });
}

// --- CPT 5-Panel Profile ---

function plotCPTProfile(cptData, containerId, soundingName) {
  const filtered = soundingName
    ? cptData.filter(d => d.Sounding_Name === soundingName)
    : cptData;

  if (filtered.length === 0) {
    document.getElementById(containerId).innerHTML = '<p class="no-data">No CPT data available</p>';
    return;
  }

  const depths = filtered.map(d => d.Depth_ft);
  const axStyle = getAxisStyle();
  const _du = typeof du === 'function' ? du() : 'ft';
  const _qcU = typeof qcU === 'function' ? qcU() : 'tsf';
  const _fsU = typeof fsU === 'function' ? fsU() : 'tsf';
  const _u2U = typeof u2U === 'function' ? u2U() : 'tsf';
  const yaxis = { ...axStyle, title: `Depth (${_du})`, autorange: 'reversed' };

  // SBT zone colors for Ic plot
  const sbtZones = [
    { name: 'Gravelly Sand', max: 1.31, color: 'rgba(255,165,0,0.15)' },
    { name: 'Sand', max: 2.05, color: 'rgba(210,180,140,0.15)' },
    { name: 'Sand Mixture', max: 2.60, color: 'rgba(144,238,144,0.15)' },
    { name: 'Silt Mixture', max: 2.95, color: 'rgba(0,128,128,0.15)' },
    { name: 'Clay', max: 3.60, color: 'rgba(100,149,237,0.15)' },
    { name: 'Organic/Peat', max: 5.0, color: 'rgba(128,0,128,0.15)' },
  ];

  // Calculate Ic if we have qc and Rf
  const icValues = filtered.map(d => {
    if (d.Tip_Resistance_tsf != null && d.Friction_Ratio_pct != null && d.Tip_Resistance_tsf > 0) {
      const Pa = 1.058; // 1 atm in tsf
      const Qt = d.Tip_Resistance_tsf / Pa;
      const logQt = Math.log10(Qt > 0 ? Qt : 0.001);
      const logRf = Math.log10(d.Friction_Ratio_pct > 0 ? d.Friction_Ratio_pct : 0.001);
      return Math.sqrt(Math.pow(3.47 - logQt, 2) + Math.pow(logRf + 1.22, 2));
    }
    return null;
  });

  const panels = [];
  const hasQc = filtered.some(d => d.Tip_Resistance_tsf != null);
  const hasFs = filtered.some(d => d.Sleeve_Friction_tsf != null);
  const hasU2 = filtered.some(d => d.Pore_Pressure_tsf != null);
  const hasRf = filtered.some(d => d.Friction_Ratio_pct != null);
  const hasIc = icValues.some(v => v != null);

  if (hasQc) panels.push({ key: 'Tip_Resistance_tsf', title: `qc (${_qcU})`, color: '#e74c3c' });
  if (hasFs) panels.push({ key: 'Sleeve_Friction_tsf', title: `fs (${_fsU})`, color: '#2ecc71' });
  if (hasU2) panels.push({ key: 'Pore_Pressure_tsf', title: `u2 (${_u2U})`, color: '#3498db' });
  if (hasRf) panels.push({ key: 'Friction_Ratio_pct', title: 'Rf (%)', color: '#f39c12' });
  if (hasIc) panels.push({ key: '_ic', title: 'Ic (SBT Index)', color: '#9b59b6' });

  if (panels.length === 0) {
    document.getElementById(containerId).innerHTML = '<p class="no-data">No CPT parameters found</p>';
    return;
  }

  // Create subplots container
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'cpt-grid';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(${panels.length}, 1fr)`;
  grid.style.gap = '8px';
  container.appendChild(grid);

  panels.forEach((panel, idx) => {
    const div = document.createElement('div');
    div.id = `${containerId}-panel-${idx}`;
    grid.appendChild(div);

    const vals = panel.key === '_ic' ? icValues : filtered.map(d => d[panel.key]);

    const trace = {
      x: vals,
      y: depths,
      mode: 'lines',
      type: 'scatter',
      fill: 'tozerox',
      fillcolor: panel.color.replace(')', ',0.2)').replace('rgb', 'rgba'),
      line: { color: panel.color, width: 1.5 },
      hovertemplate: `${panel.title}: %{x:.2f}<br>Depth: %{y:.1f} ${_du}<extra></extra>`,
    };

    const shapes = [];
    if (panel.key === '_ic') {
      let prevMax = 0;
      for (const zone of sbtZones) {
        shapes.push({
          type: 'rect', xref: 'x', yref: 'paper',
          x0: prevMax, x1: zone.max, y0: 0, y1: 1,
          fillcolor: zone.color, line: { width: 0 },
          layer: 'below',
        });
        prevMax = zone.max;
      }
    }

    const layout = {
      title: { text: panel.title, font: { size: 12 } },
      xaxis: { ...axStyle, title: '', rangemode: panel.key === '_ic' ? undefined : 'tozero',
               range: panel.key === '_ic' ? [0, 5] : undefined },
      yaxis: { ...yaxis, title: idx === 0 ? `Depth (${_du})` : '', showticklabels: idx === 0 },
      margin: { t: 40, b: 30, l: idx === 0 ? 60 : 20, r: 10 },
      plot_bgcolor: '#fff',
      paper_bgcolor: '#fff',
      height: 500,
      shapes,
      showlegend: false,
    };

    Plotly.newPlot(div.id, [trace], layout, { responsive: true, displayModeBar: false });
  });
}

// --- Lab test depth profile ---

function plotLabTestProfile(labData, containerId, testType, valueKey) {
  if (!labData || labData.length === 0) {
    document.getElementById(containerId).innerHTML = '<p class="no-data">No lab test data</p>';
    return;
  }

  const depths = labData.map(d => d.Depth_ft).filter(d => d != null);
  const values = labData.map(d => {
    for (const k of Object.keys(d)) {
      if (k !== 'Borehole' && k !== 'Depth_ft' && typeof d[k] === 'number') return d[k];
    }
    return null;
  });

  const axStyle = getAxisStyle();
  const trace = {
    x: values,
    y: depths,
    type: 'bar',
    orientation: 'h',
    marker: { color: values.map(v => `rgba(70, 128, 255, ${Math.min(1, (v || 0) / (Math.max(...values.filter(x=>x!=null)) || 1))})`) },
  };

  const layout = {
    title: { text: `${testType} — Depth Profile`, font: { size: 14 } },
    xaxis: { ...axStyle, title: valueKey || testType },
    yaxis: { ...axStyle, title: `Depth (${typeof du === 'function' ? du() : 'ft'})`, autorange: 'reversed' },
    margin: { t: 50, b: 40, l: 60, r: 30 },
    plot_bgcolor: '#fff',
    paper_bgcolor: '#fff',
    height: 400,
  };

  Plotly.newPlot(containerId, [trace], layout, { responsive: true });
}
