/**
 * HTML Table Renderer
 * Port of utils/tables.py
 */

function createStyledTable(data, title, headerColor, maxHeight) {
  if (!data || data.length === 0) return '<p class="no-data">No data available</p>';

  headerColor = headerColor || '#4680ff';
  maxHeight = maxHeight || '500px';

  const columns = Object.keys(data[0]);

  let html = `<div class="styled-table-wrapper">`;
  html += `<div class="table-header" style="background: linear-gradient(135deg, ${headerColor}, ${headerColor}cc);">`;
  html += `<span class="table-title">${escapeHtml(title)}</span>`;
  html += `<span class="table-count">${data.length} entries</span>`;
  html += `</div>`;
  html += `<div class="table-scroll" style="max-height: ${maxHeight}; overflow-y: auto;">`;
  html += `<table class="data-table">`;

  // Header
  html += '<thead><tr>';
  for (const col of columns) {
    html += `<th>${escapeHtml(col)}</th>`;
  }
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    html += `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">`;
    for (const col of columns) {
      const val = row[col];
      html += `<td>${formatValue(val, col)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  return html;
}

function formatValue(val, colName) {
  if (val == null || val === '' || (typeof val === 'number' && isNaN(val))) return '—';
  if (typeof val === 'number') {
    const cl = (colName || '').toLowerCase();
    if (cl.includes('lat') || cl.includes('lon') || cl.includes('coord')) {
      return val.toFixed(6);
    }
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(2);
  }
  return escapeHtml(String(val));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function createMetricCard(label, value, color, icon) {
  color = color || '#4680ff';
  const displayVal = value != null ? value : '—';
  return `<div class="metric-card" style="border-left: 4px solid ${color};">
    <div class="metric-value" style="color: ${color}">${escapeHtml(String(displayVal))}</div>
    <div class="metric-label">${escapeHtml(label)}</div>
  </div>`;
}

function createMetricRow(metrics) {
  let html = '<div class="metric-row">';
  for (const m of metrics) {
    html += createMetricCard(m.label, m.value, m.color);
  }
  html += '</div>';
  return html;
}

/** Generate CSV and trigger download */
function downloadCSV(data, filename) {
  if (!data || data.length === 0) return;
  const columns = Object.keys(data[0]);
  let csv = columns.join(',') + '\n';
  for (const row of data) {
    csv += columns.map(c => {
      const v = row[c];
      if (v == null) return '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    }).join(',') + '\n';
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'data.csv';
  a.click();
  URL.revokeObjectURL(url);
}
