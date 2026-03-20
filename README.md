# DIGGS Viewer

A self-contained HTML viewer for **DIGGS** (Data Interchange for Geotechnical and Geoenvironmental Specialists) XML files. Open it, see your data — no installs, no server, no internet required.

## Quick Start

**No install required** — download [`viewer.html`](viewer.html) from this repo, open it in your browser, and drag-and-drop a DIGGS XML file.

## Building from Source

Use `build.py` to bundle a DIGGS XML file into a self-contained HTML viewer that anyone can open:

```bash
# Build a viewer with embedded data
python3 build.py --xml path/to/file.xml

# Build a blank viewer (drag-and-drop mode)
python3 build.py
```

## Features

- **Self-contained** — one HTML file, works offline, no dependencies
- **Dynamic** — only shows tabs and sections for data types present in the file
- **Unit-aware** — detects units from XML `uom` attributes (ft, m, tsf, kPa, etc.)

### Data Tabs
- **Overview** — project info, summary metrics, data inventory
- **Map** — interactive Leaflet map with street/satellite toggle (online only)
- **SPT Analysis** — N-value vs depth charts, per-borehole filtering
- **CPT Analysis** — 5-panel profiles (qc, fs, u2, Rf, Ic) with SBT classification
- **Boring Log** — SVG boring logs with USCS soil patterns, blow counts, lab data columns
- **Cross Section** — fence diagram connecting soil layers between boreholes
- **Lab Tests** — tables and depth profiles for all lab test types
- **Interpretation** — SPT correlations, bearing capacity estimates

### Tools
- **Open File** — load a new DIGGS XML at any time
- **Export DIGGS XML** — extract the raw XML back out
- **Save Shareable File** — save a new self-contained HTML with the current data
- **Generate Report** — print-optimized report with tables, boring logs, and cross-sections
- **Validate** — check the file against the official DIGGS schema via [diggs.geosetta.org](https://diggs.geosetta.org) (online only)

## Project Structure

```
src/
  index.html              # App shell with placeholders
  css/styles.css           # All styling
  js/
    parser.js              # DIGGS XML parser
    charts.js              # Plotly chart wrappers
    boring-log.js          # SVG boring log renderer
    cross-section.js       # Fence diagram renderer
    tables.js              # HTML table helpers
    calculations.js        # Geotechnical calculations
    ui.js                  # Tab navigation, state, drag-and-drop
  vendor/
    plotly-basic.min.js    # Plotly basic bundle (~1MB)
build.py                   # Bundles src/ into a single HTML file
```

## Credits

Based on **DIGGS Analyzer** by **Ground Decoder** (University of Utah), winner of the 2026 DIGGS Student Hackathon.

**Team:** Ripon Chandra Malo (Lead), Dr. Tong Qiu, Dr. Kami Mohammadi

Maintained by **DIGGS** — [github.com/DIGGSml/DIGGS_standalone_viewer](https://github.com/DIGGSml/DIGGS_standalone_viewer)
