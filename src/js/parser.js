/**
 * DIGGS XML Parser — JS port of core/diggs_parser.py
 * Parses DIGGS XML using browser DOMParser, extracts boreholes,
 * SPT data, CPT data, lithology, water table, and lab tests.
 */

class DIGGSParser {
  constructor(xmlString) {
    const dp = new DOMParser();
    this.doc = dp.parseFromString(xmlString, 'application/xml');
    this.root = this.doc.documentElement;

    // Detect namespaces
    this.diggs_ns = this.root.namespaceURI || 'http://diggsml.org/schema-dev';
    this.gml_ns = 'http://www.opengis.net/gml/3.2';
    this.xlink_ns = 'http://www.w3.org/1999/xlink';
    this.glr_ns = 'http://www.opengis.net/gml/3.3/lr';

    // Build sounding & borehole lookups so cross-referencing extractors
    // (SPT, lithology, lab tests) can resolve xlink hrefs to canonical names.
    this.soundingsById = {};
    this._buildSoundingLookup();
    this.boreholesById = {};
    this._buildBoreholeLookup();
  }

  // --- Helpers ---

  /** Find all descendants matching a local name (ignores namespace prefix) */
  _findAll(parent, localName) {
    const results = [];
    const iter = this.doc.createTreeWalker(
      parent, NodeFilter.SHOW_ELEMENT, null
    );
    let node;
    while ((node = iter.nextNode())) {
      if (node.localName === localName) results.push(node);
    }
    return results;
  }

  /** Find first descendant matching local name */
  _find(parent, localName) {
    const iter = this.doc.createTreeWalker(
      parent, NodeFilter.SHOW_ELEMENT, null
    );
    let node;
    while ((node = iter.nextNode())) {
      if (node.localName === localName) return node;
    }
    return null;
  }

  /** Find direct children matching local name */
  _findChildren(parent, localName) {
    const results = [];
    for (const child of parent.children) {
      if (child.localName === localName) results.push(child);
    }
    return results;
  }

  /** Get text content of first descendant with given local name */
  _getText(parent, localName) {
    const el = this._find(parent, localName);
    return el && el.textContent ? el.textContent.trim() : null;
  }

  /** Get xlink:href from element */
  _getXlinkHref(el) {
    return el.getAttributeNS(this.xlink_ns, 'href') || el.getAttribute('xlink:href') || '';
  }

  /** Get gml:id from element */
  _getGmlId(el) {
    return el.getAttributeNS(this.gml_ns, 'id') || el.getAttribute('gml:id') || '';
  }

  /**
   * Best-effort file-level depth unit (raw, uncleaned).
   *
   * CPT/PPD depths come from a `posList`/`pos` that references a linear
   * spatial reference system (`srsName="#SF_LSRS_…"`); the authoritative
   * unit for those linear-referenced depths lives in that LSRS's
   * `<LinearReferencingMethod><units>` (e.g. `m`). The older code derived the
   * depth label ONLY from a `<totalMeasuredDepth uom="…">`, so a file that
   * declared meters on the LRM but omitted the uom on totalMeasuredDepth
   * would fall through to the hardcoded `ft` default and mislabel depths as
   * feet — exactly the "depths reported in feet where uom is meters" bug.
   *
   * Resolution order: LRM units → totalMeasuredDepth uom → feet.
   * Cached after first resolution.
   */
  _fileDepthUnitRaw() {
    if (this._depthUnitRaw !== undefined) return this._depthUnitRaw;
    let unit = null;
    const lrm = this._find(this.root, 'LinearReferencingMethod');
    if (lrm) {
      const u = this._getText(lrm, 'units');
      if (u) unit = u;
    }
    if (!unit) {
      const depthEl = this._find(this.root, 'totalMeasuredDepth');
      if (depthEl) {
        const uom = depthEl.getAttribute('uom');
        if (uom) unit = uom;
      }
    }
    this._depthUnitRaw = unit || 'ft';
    return this._depthUnitRaw;
  }

  // --- Sounding lookup ---

  _buildSoundingLookup() {
    for (const sounding of this._findAll(this.root, 'Sounding')) {
      const gmlId = this._getGmlId(sounding);
      if (!gmlId) continue;
      const nameEl = this._find(sounding, 'name');
      const name = (nameEl && nameEl.textContent) ? nameEl.textContent.trim() : gmlId;
      this.soundingsById[gmlId] = { element: sounding, name, id: gmlId };
    }
  }

  _buildBoreholeLookup() {
    for (const bh of this._findAll(this.root, 'Borehole')) {
      const gmlId = this._getGmlId(bh);
      if (!gmlId) continue;
      const nameEl = this._find(bh, 'name');
      const name = (nameEl && nameEl.textContent) ? nameEl.textContent.trim() : gmlId;
      this.boreholesById[gmlId] = name;
    }
  }

  /**
   * Resolve an xlink:href that points to a Borehole into the canonical
   * borehole Name (`<name>` element text). The DIGGS spec lets authors pick
   * gml:id values freely (`Location_BH-1`, `BH-1`, `bh_loc_001`, etc.), so
   * lithology / SPT / lab records reference boreholes by gml:id while the
   * `<name>` element is what users actually identify the borehole as.
   * Returns the Name when the href resolves; falls back to the stripped href
   * so unmatched references still produce a stable string key (just not
   * necessarily a human-readable one).
   */
  _resolveBoreholeRef(href) {
    if (!href) return 'Unknown';
    const cleaned = href.replace(/^#/, '');
    if (this.boreholesById[cleaned]) return this.boreholesById[cleaned];
    // Some authors prefix gml:ids with `Location_` and reference the bare
    // form, or vice-versa — try both directions before giving up.
    const stripped = cleaned.replace(/^Location_/, '');
    if (this.boreholesById[stripped]) return this.boreholesById[stripped];
    if (this.boreholesById[`Location_${cleaned}`]) return this.boreholesById[`Location_${cleaned}`];
    return stripped;
  }

  /**
   * Parse a geographic `gml:pos` into {Latitude, Longitude, Elevation}.
   * Axis order is resolved in priority order:
   *   1. An `axisLabels` attribute on the pos element or an ancestor geometry
   *      (e.g. "Lat Lon H" per the EPSG:4326 registry definition, which
   *      Geosetta emits) — first label starting with "lat" means lat-first.
   *   2. Value ranges: a |value| > 90 can only be a longitude.
   *   3. EPSG:4326 registry axis order (lat lon elev). Note this default
   *      misreads undeclared legacy lon-first files whose longitude is
   *      within ±90 (e.g. the eastern US) — producers of such files should
   *      declare `axisLabels`.
   */
  _parseGeoPos(posEl) {
    const out = { Latitude: null, Longitude: null, Elevation: null };
    if (!posEl || !posEl.textContent) return out;
    const coords = posEl.textContent.trim().split(/\s+/).map(parseFloat);
    if (coords.length < 2 || coords.some(isNaN)) return out;

    let latFirst = null;
    let node = posEl;
    for (let hops = 0; node && hops < 4; node = node.parentElement, hops++) {
      const labels = node.getAttribute && node.getAttribute('axisLabels');
      if (labels) {
        latFirst = /^lat/i.test(labels.trim());
        break;
      }
    }
    if (latFirst === null) {
      if (Math.abs(coords[0]) > 90) latFirst = false;
      else if (Math.abs(coords[1]) > 90) latFirst = true;
      else latFirst = true; // EPSG:4326 registry order
    }

    out.Latitude = latFirst ? coords[0] : coords[1];
    out.Longitude = latFirst ? coords[1] : coords[0];
    if (coords.length > 2) out.Elevation = coords[2];
    return out;
  }

  // --- Extract boreholes ---

  extractBoreholes() {
    const boreholes = [];
    for (const bh of this._findAll(this.root, 'Borehole')) {
      const nameEl = this._find(bh, 'name');
      const name = nameEl && nameEl.textContent ? nameEl.textContent.trim() : 'Unknown';
      const gmlId = this._getGmlId(bh);

      const depthEl = this._find(bh, 'totalMeasuredDepth');
      const depth = depthEl && depthEl.textContent ? parseFloat(depthEl.textContent) : null;
      const depthUnit = depthEl ? (depthEl.getAttribute('uom') || 'ft') : 'ft';

      const posEl = this._find(bh, 'pos');
      const geo = this._parseGeoPos(posEl);

      boreholes.push({
        Name: name,
        ID: gmlId,
        Total_Depth: depth,
        Depth_Unit: depthUnit,
        Latitude: geo.Latitude,
        Longitude: geo.Longitude,
        Elevation: geo.Elevation,
      });
    }
    return boreholes;
  }

  // --- Extract soundings ---

  extractSoundings() {
    const soundings = [];
    for (const [gmlId, info] of Object.entries(this.soundingsById)) {
      const sounding = info.element;
      const depthEl = this._find(sounding, 'totalMeasuredDepth');
      const depth = depthEl && depthEl.textContent ? parseFloat(depthEl.textContent) : null;
      const depthUnit = depthEl ? (depthEl.getAttribute('uom') || 'ft') : 'ft';

      const posEl = this._find(sounding, 'pos');
      const geo = this._parseGeoPos(posEl);

      soundings.push({
        Name: info.name,
        ID: gmlId,
        Total_Depth: depth,
        Depth_Unit: depthUnit,
        Latitude: geo.Latitude,
        Longitude: geo.Longitude,
        Elevation: geo.Elevation,
      });
    }
    return soundings;
  }

  // --- Extract SPT data ---

  extractSPTData() {
    const sptData = [];

    for (const test of this._findAll(this.root, 'Test')) {
      // Check if it's an SPT test
      const dpt = this._find(test, 'DrivenPenetrationTest');
      if (!dpt) continue;

      // Test name
      let testName = 'Unknown';
      for (const child of test.children) {
        if (child.localName === 'name') {
          testName = child.textContent ? child.textContent.trim() : 'Unknown';
          break;
        }
      }

      // Borehole reference
      let borehole = 'Unknown';
      const sfRef = this._find(test, 'samplingFeatureRef');
      if (sfRef) {
        borehole = this._resolveBoreholeRef(this._getXlinkHref(sfRef));
      }

      // Depths from LinearExtent > posList
      let topDepth = null, bottomDepth = null;
      const linearExtent = this._find(test, 'LinearExtent');
      if (linearExtent) {
        const posList = this._find(linearExtent, 'posList');
        if (posList && posList.textContent) {
          const depths = posList.textContent.trim().split(/\s+/);
          if (depths.length >= 1) topDepth = parseFloat(depths[0]);
          if (depths.length >= 2) bottomDepth = parseFloat(depths[1]);
        }
      }

      // N-value from dataValues
      let nValue = null;
      const dataValuesEl = this._find(test, 'dataValues');
      if (dataValuesEl && dataValuesEl.textContent) {
        const val = parseFloat(dataValuesEl.textContent.trim());
        if (!isNaN(val)) nValue = Math.round(val);
      }

      // Blow counts and hammer efficiency from DrivenPenetrationTest
      const blowCounts = [];
      let hammerEfficiency = null;
      for (const child of this._findAll(dpt, 'blowCount')) {
        if (child.textContent) {
          const bc = parseInt(child.textContent);
          if (!isNaN(bc)) blowCounts.push(bc);
        }
      }
      const heEl = this._find(dpt, 'hammerEfficiency');
      if (heEl && heEl.textContent) {
        hammerEfficiency = parseFloat(heEl.textContent);
        if (isNaN(hammerEfficiency)) hammerEfficiency = null;
      }

      if (topDepth !== null) {
        sptData.push({
          Test_Name: testName,
          Borehole: borehole,
          Top_Depth_ft: topDepth,
          Bottom_Depth_ft: bottomDepth,
          N_Value: nValue,
          Blow_1: blowCounts.length > 0 ? blowCounts[0] : null,
          Blow_2: blowCounts.length > 1 ? blowCounts[1] : null,
          Blow_3: blowCounts.length > 2 ? blowCounts[2] : null,
          Hammer_Efficiency_pct: hammerEfficiency,
        });
      }
    }
    return sptData;
  }

  // --- Extract CPT data ---

  extractCPTData() {
    const cptData = [];

    for (const test of this._findAll(this.root, 'Test')) {
      // Check if it's a CPT test
      const cptProc = this._find(test, 'StaticConePenetrationTest');
      if (!cptProc) {
        // Also check for ConePenetration
        const cp = this._find(test, 'ConePenetration');
        if (!cp) continue;
      }

      // Sounding reference
      let soundingId = 'Unknown', soundingName = 'Unknown';
      const sfRef = this._find(test, 'samplingFeatureRef');
      if (sfRef) {
        const href = this._getXlinkHref(sfRef);
        if (href) {
          soundingId = href.replace('#', '');
          if (this.soundingsById[soundingId]) {
            soundingName = this.soundingsById[soundingId].name;
          } else {
            soundingName = soundingId.includes('_') ? soundingId.split('_').slice(1).join('_') : soundingId;
          }
        }
      }

      // Find TestResult elements
      for (const testResult of this._findAll(test, 'TestResult')) {
        // Get depths from MultiPointLocation > posList
        const depths = [];
        const mpl = this._find(testResult, 'MultiPointLocation');
        if (mpl) {
          const posList = this._find(mpl, 'posList');
          if (posList && posList.textContent) {
            for (const d of posList.textContent.trim().split(/\s+/)) {
              if (d.trim()) depths.push(parseFloat(d));
            }
          }
        }
        if (depths.length === 0) continue;

        // Find ResultSet
        for (const rs of this._findAll(testResult, 'ResultSet')) {
          // Build property index map
          const propertyIndices = {};
          for (const prop of this._findAll(rs, 'Property')) {
            const index = prop.getAttribute('index');
            if (index) {
              const pNameEl = this._find(prop, 'propertyName');
              if (pNameEl && pNameEl.textContent) {
                // propertyName is a display string (may include units); the stable
                // machine id lives in propertyClass codeSpace="...#tip_resistance"
                const pcEl = this._find(prop, 'propertyClass');
                const codeSpace = pcEl ? (pcEl.getAttribute('codeSpace') || '') : '';
                const code = codeSpace.includes('#')
                  ? codeSpace.split('#').pop().toLowerCase() : '';
                propertyIndices[parseInt(index)] = {
                  name: pNameEl.textContent.toLowerCase(),
                  code: code,
                };
              }
            }
          }

          // Get data values
          const dvEl = this._find(rs, 'dataValues');
          if (!dvEl || !dvEl.textContent) continue;

          const cs = dvEl.getAttribute('cs') || ',';
          const ts = dvEl.getAttribute('ts') || ' ';
          const dataText = dvEl.textContent.trim();

          // Split rows
          let rows;
          if (dataText.includes('\n') && dataText.includes(cs)) {
            rows = dataText.split('\n').map(r => r.trim()).filter(r => r);
          } else {
            rows = dataText.split(ts);
          }

          for (let i = 0; i < rows.length; i++) {
            if (!rows[i].trim()) continue;
            if (i >= depths.length) break;

            const values = rows[i].split(cs);
            const rowData = {
              Sounding_ID: soundingId,
              Sounding_Name: soundingName,
              Depth_ft: depths[i],
            };

            for (const [idx, prop] of Object.entries(propertyIndices)) {
              const vi = parseInt(idx) - 1;
              if (vi < values.length) {
                const val = parseFloat(values[vi]);
                if (isNaN(val)) continue;
                // Match on the stable propertyClass code first; fall back to
                // propertyName for files that don't populate codeSpace
                const key = prop.code || prop.name;
                if (key === 'qc' || key === 'tip_resistance') {
                  rowData.Tip_Resistance_tsf = val;
                } else if (key === 'fs' || key === 'sleeve_friction') {
                  rowData.Sleeve_Friction_tsf = val;
                } else if (key === 'u2' || key === 'pore_pressure' || key === 'pore_pressure_u2') {
                  rowData.Pore_Pressure_tsf = val;
                } else {
                  rowData[prop.name] = val;
                }
              }
            }
            cptData.push(rowData);
          }
        }
      }
    }

    // Unit conversions and derived values
    for (const row of cptData) {
      if (row.Tip_Resistance_tsf != null) {
        row.Tip_Resistance_MPa = row.Tip_Resistance_tsf * 0.09576;
      }
      if (row.Sleeve_Friction_tsf != null) {
        row.Sleeve_Friction_kPa = row.Sleeve_Friction_tsf * 95.76;
      }
      if (row.Pore_Pressure_tsf != null) {
        row.Pore_Pressure_kPa = row.Pore_Pressure_tsf * 95.76;
      }
      if (row.Tip_Resistance_tsf != null && row.Sleeve_Friction_tsf != null) {
        row.Friction_Ratio_pct = row.Tip_Resistance_tsf !== 0
          ? (row.Sleeve_Friction_tsf / row.Tip_Resistance_tsf * 100) : 0;
      }
    }

    return cptData;
  }

  // --- Extract CPT pore-pressure dissipation (PPD) tests ---
  //
  // A PPD test in DIGGS lives inside a <Test> alongside its parent CPT
  // sounding. Two halves matter:
  //   outcome  > TestResult > location/PointLocation/pos  → test depth
  //            > results (or <results xsi:nil="true"/>)    → scalar params
  //              (u0, apparent WT depth, U50, t50, ch)
  //   procedure> PorePressureDissipationTest
  //            > dissipationTimeSeries > TemporalResult
  //                > timeDomain/TimeIntervalList/timeIntervalList → time axis
  //                > results/ResultSet/dataValues              → u2 trace
  //
  // The 233-of-400 "NIL option" tests carry a valid trace but no calculated
  // parameters (results xsi:nil) — those still render as a dissipation curve.
  // Depths use the file depth unit (m here), NOT the hardcoded feet that the
  // production viewer was mislabeling. u2 trace carries its own uom
  // (e.g. ftH2O[39degF]) which we surface verbatim rather than assume tsf.
  extractDissipationTests() {
    const tests = [];
    const depthUnit = _cleanUnitLabel(this._fileDepthUnitRaw()) || this._fileDepthUnitRaw();

    // Map scalar-result propertyClass codes to output keys.
    const SCALAR_KEYS = {
      pore_pressure_equil: 'u0',
      water_depth: 'wt_depth',
      u50: 'u50',
      t50: 't50',
      coef_consolidation_horiz: 'ch',
    };

    for (const test of this._findAll(this.root, 'Test')) {
      const ppdEl = this._find(test, 'PorePressureDissipationTest');
      if (!ppdEl) continue;

      // Sounding reference
      let soundingId = 'Unknown', soundingName = 'Unknown';
      const sfRef = this._find(test, 'samplingFeatureRef');
      if (sfRef) {
        const href = this._getXlinkHref(sfRef);
        if (href) {
          soundingId = href.replace('#', '');
          if (this.soundingsById[soundingId]) {
            soundingName = this.soundingsById[soundingId].name;
          } else {
            soundingName = soundingId.includes('_')
              ? soundingId.split('_').slice(1).join('_') : soundingId;
          }
        }
      }

      const rec = {
        Sounding_ID: soundingId,
        Sounding_Name: soundingName,
        Depth: null,
        Depth_Unit: depthUnit,
        u0: null, u0_unit: '',
        wt_depth: null, wt_depth_unit: '',
        u50: null, u50_unit: '',
        t50: null, t50_unit: '',
        ch: null, ch_unit: '',
        hasResults: false,
        trace: null,
      };

      // --- outcome: depth + scalar results ---
      const outcomeEl = this._find(test, 'outcome');
      if (outcomeEl) {
        const posEl = this._find(outcomeEl, 'pos');
        if (posEl && posEl.textContent) {
          const d = parseFloat(posEl.textContent.trim().split(/\s+/)[0]);
          if (!isNaN(d)) rec.Depth = d;
        }

        const resultsEl = this._find(outcomeEl, 'results');
        const nil = resultsEl
          ? (resultsEl.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'nil')
             || resultsEl.getAttribute('xsi:nil'))
          : null;
        if (resultsEl && nil !== 'true') {
          const rs = this._find(resultsEl, 'ResultSet');
          if (rs) {
            // Build index → {code, uom} map from Property declarations.
            const propIndex = {};
            for (const prop of this._findAll(rs, 'Property')) {
              const idx = prop.getAttribute('index');
              if (!idx) continue;
              const pcEl = this._find(prop, 'propertyClass');
              const codeSpace = pcEl ? (pcEl.getAttribute('codeSpace') || '') : '';
              const code = codeSpace.includes('#')
                ? codeSpace.split('#').pop().toLowerCase() : '';
              const uomEl = this._find(prop, 'uom');
              const uom = uomEl && uomEl.textContent ? uomEl.textContent.trim() : '';
              propIndex[parseInt(idx)] = { code, uom };
            }

            const dvEl = this._find(rs, 'dataValues');
            if (dvEl && dvEl.textContent) {
              const cs = dvEl.getAttribute('cs') || ',';
              const values = dvEl.textContent.trim().split(cs);
              for (const [idxStr, meta] of Object.entries(propIndex)) {
                const key = SCALAR_KEYS[meta.code];
                if (!key) continue;
                const val = parseFloat(values[parseInt(idxStr) - 1]);
                if (isNaN(val)) continue;
                rec[key] = val;
                rec[`${key}_unit`] = _cleanUnitLabel(meta.uom) || meta.uom;
                rec.hasResults = true;
              }
            }
          }
        }
      }

      // --- procedure: dissipation trace (time vs u2) ---
      const tilEl = this._find(ppdEl, 'TimeIntervalList');
      const dvTrace = this._find(ppdEl, 'dataValues');
      if (tilEl && dvTrace) {
        const timeUnit = tilEl.getAttribute('unit') || 's';
        const tListEl = this._find(tilEl, 'timeIntervalList');
        const time = (tListEl && tListEl.textContent)
          ? tListEl.textContent.trim().split(/\s+/).map(parseFloat).filter(v => !isNaN(v))
          : [];
        const u2 = dvTrace.textContent.trim().split(/\s+/).map(parseFloat).filter(v => !isNaN(v));

        // u2 unit lives on the trace ResultSet's Property (pore_pressure_u2).
        let u2Unit = '';
        const u2UomEl = this._find(ppdEl, 'uom'); // estimatedIr uom is an attr, so this is the Property <uom>
        if (u2UomEl && u2UomEl.textContent) u2Unit = _cleanUnitLabel(u2UomEl.textContent.trim()) || u2UomEl.textContent.trim();

        if (time.length && u2.length) {
          const n = Math.min(time.length, u2.length);
          rec.trace = {
            time: time.slice(0, n),
            timeUnit,
            u2: u2.slice(0, n),
            u2Unit,
          };
        }
      }

      // Keep the test if it has either a trace or calculated results.
      if (rec.trace || rec.hasResults || rec.Depth != null) tests.push(rec);
    }

    return tests;
  }

  // --- Extract MWD (Measurement While Drilling) ---
  //
  // DIGGS layout: <measurement><MeasurementWhileDrilling><outcome><MWDResult>...
  // The MWDResult holds one ResultSet with N <Property index=...> declarations
  // and a single <dataValues cs="," ts=" "> block of time-ordered rows.
  // One column is the depth channel (propertyClass="measured_depth"); the rest
  // are sensor channels (ROP, RPM, torque, pressures, flow, accel, etc.).
  // Returns an array of records — one per borehole's MWD log — each with its
  // own channel set, since rigs record different channels.
  extractMWDData() {
    const mwdRecords = [];

    for (const mwd of this._findAll(this.root, 'MeasurementWhileDrilling')) {
      const mwdId = mwd.getAttribute('gml:id') || '';

      let borehole = 'Unknown';
      const sfRef = this._find(mwd, 'samplingFeatureRef');
      if (sfRef) borehole = this._resolveBoreholeRef(this._getXlinkHref(sfRef));

      const result = this._find(mwd, 'MWDResult');
      if (!result) continue;

      // Build property metadata in index order.
      const properties = [];
      for (const prop of this._findAll(result, 'Property')) {
        const idx = parseInt(prop.getAttribute('index'));
        if (isNaN(idx)) continue;
        const nullText = this._getText(prop, 'nullValue');
        properties.push({
          index: idx,
          name: this._getText(prop, 'propertyName') || `Property${idx}`,
          propertyClass: (this._getText(prop, 'propertyClass') || '').toLowerCase().trim(),
          uom: this._getText(prop, 'uom') || '',
          nullValue: nullText ? parseFloat(nullText) : null,
        });
      }
      if (properties.length === 0) continue;
      properties.sort((a, b) => a.index - b.index);

      // Identify the depth channel. Per the MWD schema this is propertyClass=measured_depth,
      // but fall back on a name match for non-conformant exporters.
      const depthProp = properties.find(p =>
        p.propertyClass === 'measured_depth' ||
        p.name.toLowerCase().trim() === 'depth'
      );

      // Parse dataValues block — same row/value splitting as CPT.
      const dvEl = this._find(result, 'dataValues');
      if (!dvEl || !dvEl.textContent) continue;
      const cs = dvEl.getAttribute('cs') || ',';
      const ts = dvEl.getAttribute('ts') || ' ';
      const dataText = dvEl.textContent.trim();
      let rows;
      if (dataText.includes('\n') && dataText.includes(cs)) {
        rows = dataText.split('\n').map(r => r.trim()).filter(r => r);
      } else {
        rows = dataText.split(ts).filter(r => r.trim());
      }

      // Optional timestamps (one per row).
      const timestamps = [];
      const tplText = this._getText(result, 'timePositionList');
      if (tplText) {
        for (const t of tplText.trim().split(/\s+/)) {
          if (t) timestamps.push(t);
        }
      }

      // Column-major: one array per channel, all aligned to depths[].
      const sensorChannels = properties.filter(p => p !== depthProp);
      const data = {};
      for (const ch of sensorChannels) data[_mwdChannelKey(ch)] = [];
      const depths = [];

      for (let i = 0; i < rows.length; i++) {
        const values = rows[i].split(cs);
        if (values.length < properties.length) continue;

        // Depth first — skip rows where depth is missing/null.
        let depthVal = null;
        if (depthProp) {
          const raw = parseFloat(values[depthProp.index - 1]);
          if (!isNaN(raw) && !_isMwdNull(raw, depthProp.nullValue)) {
            depthVal = raw;
          }
        }
        if (depthProp && depthVal == null) continue;

        depths.push(depthVal);
        for (const ch of sensorChannels) {
          const raw = parseFloat(values[ch.index - 1]);
          const v = (isNaN(raw) || _isMwdNull(raw, ch.nullValue)) ? null : raw;
          data[_mwdChannelKey(ch)].push(v);
        }
      }

      if (depths.length === 0) continue;

      mwdRecords.push({
        MWD_ID: mwdId,
        Borehole: borehole,
        depthUnit: depthProp ? depthProp.uom : '',
        depths,
        channels: sensorChannels.map(p => ({
          name: p.name,
          key: _mwdChannelKey(p),
          unit: p.uom,
          propertyClass: p.propertyClass,
        })),
        data,
        timestamps: timestamps.length === rows.length ? timestamps : [],
      });
    }

    return mwdRecords;
  }

  // --- Extract lithology ---

  extractLithology() {
    const lithData = [];

    for (const ls of this._findAll(this.root, 'LithologySystem')) {
      let borehole = 'Unknown';
      const sfRef = this._find(ls, 'samplingFeatureRef');
      if (sfRef) {
        borehole = this._resolveBoreholeRef(this._getXlinkHref(sfRef));
      }

      for (const obs of this._findAll(ls, 'LithologyObservation')) {
        let topDepth = null, bottomDepth = null;
        const le = this._find(obs, 'LinearExtent');
        if (le) {
          const posList = this._find(le, 'posList');
          if (posList && posList.textContent) {
            const depths = posList.textContent.trim().split(/\s+/);
            if (depths.length >= 1) topDepth = parseFloat(depths[0]);
            if (depths.length >= 2) bottomDepth = parseFloat(depths[1]);
          }
        }

        const description = this._getText(obs, 'lithDescription') || '';
        // USCS / soil-classification code: prefer the schema-canonical fields.
        // - classificationCode: USCS group name or symbol (codeSpace="USCS"). Schema-required if no lithDescription.
        // - classificationSymbol: group symbol specifically (e.g. "ML", "SC"). Common in ASTM D2488 exports.
        // - legendCode: graphic-pattern hint, NOT a classification field — but some non-conformant exporters
        //   (older state-DOT pipelines) put the USCS code here, so it's our last structured fallback.
        const uscsCode = this._getText(obs, 'classificationCode')
                      || this._getText(obs, 'classificationSymbol')
                      || this._getText(obs, 'legendCode')
                      || '';
        const unitName = this._getText(obs, 'unitName') || '';

        if (topDepth !== null) {
          lithData.push({
            Borehole: borehole,
            Top_Depth_ft: topDepth,
            Bottom_Depth_ft: bottomDepth,
            USCS_Code: uscsCode,
            Unit_Name: unitName,
            Description: description,
          });
        }
      }
    }
    return lithData;
  }

  // --- Extract water table ---

  extractWaterTable() {
    const waterData = [];
    const seen = new Set();
    const push = (borehole, depth) => {
      if (!borehole || borehole === 'Unknown' || isNaN(depth)) return;
      const key = `${borehole}__${depth}`;
      if (seen.has(key)) return;
      seen.add(key);
      waterData.push({ Borehole: borehole, Water_Depth_ft: depth });
    };

    // 1) Standard DIGGS: WaterStrikeReading nested inside Borehole.
    for (const bh of this._findAll(this.root, 'Borehole')) {
      let borehole = 'Unknown';
      const nameEl = this._find(bh, 'name');
      if (nameEl && nameEl.textContent) borehole = nameEl.textContent.trim();

      for (const wsr of this._findAll(bh, 'WaterStrikeReading')) {
        const posEl = this._find(wsr, 'pos');
        if (posEl && posEl.textContent) {
          push(borehole, parseFloat(posEl.textContent.trim()));
        }
      }
    }

    // 2) Geosetta/Caltrans-style: Tests whose identifier marks them as a
    //    groundwater observation. The depth lives in <dataValues> (and is
    //    mirrored in the LinearExtent pos). Examples:
    //      <gml:name>Depth to groundwater table observation</gml:name>
    //      <propertyClass codeSpace="geosetta">groundwater_depth</propertyClass>
    for (const test of this._findAll(this.root, 'Test')) {
      if (!this._isGroundwaterTest(test)) continue;

      let borehole = 'Unknown';
      const sfRef = this._find(test, 'samplingFeatureRef');
      if (sfRef) borehole = this._resolveBoreholeRef(this._getXlinkHref(sfRef));

      for (const tr of this._findAll(test, 'TestResult')) {
        let depth = NaN;
        // Prefer the value in <dataValues> — it's the semantic GW depth.
        const dvEl = this._find(tr, 'dataValues');
        if (dvEl && dvEl.textContent) {
          depth = parseFloat(dvEl.textContent.trim().split(/[\s,]+/)[0]);
        }
        // Fallback to the location pos when dataValues is missing.
        if (isNaN(depth)) {
          const locEl = this._find(tr, 'PointLocation') || this._find(tr, 'LinearExtent');
          const posEl = locEl && (this._find(locEl, 'pos') || this._find(locEl, 'posList'));
          if (posEl && posEl.textContent) {
            depth = parseFloat(posEl.textContent.trim().split(/\s+/)[0]);
          }
        }
        push(borehole, depth);
      }
    }
    return waterData;
  }

  /** True when a <Test> represents a groundwater-depth observation. */
  _isGroundwaterTest(test) {
    const directNameEls = this._findChildren(test, 'name');
    const gmlName = directNameEls.length && directNameEls[0].textContent
      ? directNameEls[0].textContent.toLowerCase() : '';
    if (gmlName.includes('groundwater') || gmlName.includes('water table')) return true;
    for (const prop of this._findAll(test, 'Property')) {
      const cls = (this._getText(prop, 'propertyClass') || '').toLowerCase();
      if (cls === 'groundwater_depth' || cls.includes('groundwater')) return true;
    }
    return false;
  }

  // --- Extract lab tests ---

  extractLabTests() {
    const testTypeMap = {
      WaterContentTest: 'Water Content',
      AtterbergLimitsTest: 'Atterberg Limits',
      LabDensityTest: 'Lab Density',
      ParticleSizeTest: 'Particle Size',
      PocketPenetrometerTest: 'Pocket Penetrometer',
      TriaxialTest: 'Triaxial',
      VaneShearTest: 'Vane Shear',
      PressuremeterTest: 'Pressuremeter',
      DilatometerTest: 'Dilatometer',
      PermeabilityTest: 'Permeability',
      ConsolidationTest: 'Consolidation',
      DirectShearTest: 'Direct Shear',
      UnconfinedCompressionTest: 'Unconfined Compression',
      CBRTest: 'CBR',
      CompactionTest: 'Compaction',
      HydrometerTest: 'Hydrometer',
      SieveTest: 'Sieve Analysis',
      SpecificGravityTest: 'Specific Gravity',
      OrganicContentTest: 'Organic Content',
      pHTest: 'pH',
      MoistureContentTest: 'Moisture Content',
      SwellTest: 'Swell',
      CollapseTest: 'Collapse',
      ResistivityTest: 'Resistivity',
    };

    // Skip types that have dedicated extractors
    const skipProcedures = new Set([
      'DrivenPenetrationTest',
      'StaticConePenetrationTest',
      'ConePenetration',
    ]);

    const triaxialNameMap = {
      undrained_shear_strength: 'Undrained_Shear_Strength',
      'Peak Undrained Shear Strength': 'Undrained_Shear_Strength',
      shear_strength_undrained: 'Undrained_Shear_Strength',
      'cohesion intercept': 'Cohesion',
      'Peak Cohesion': 'Cohesion',
      cohesion_peak: 'Cohesion',
      'peak friction angle': 'Friction_Angle',
      'Peak Angle of Internal Friction': 'Friction_Angle',
      friction_angle_peak: 'Friction_Angle',
      deviator_stress: 'Deviator_Stress',
      confining_pressure: 'Confining_Pressure',
      axial_strain: 'Axial_Strain',
    };

    // Map gml:name (test identifier) to canonical test type. Used when a Test
    // has no <procedure> element — common in Geosetta / VDOT exports where the
    // test identifier lives in <gml:name> instead of a typed procedure element.
    const gmlNameToTestType = {
      water_content_natural: 'Water Content',
      water_content: 'Water Content',
      moisture_content: 'Moisture Content',
      liquid_limit: 'Atterberg Limits',
      plastic_limit: 'Atterberg Limits',
      plasticity_index: 'Atterberg Limits',
      atterberg_limits: 'Atterberg Limits',
      dry_density: 'Lab Density',
      wet_density: 'Lab Density',
      bulk_density: 'Lab Density',
      percent_fines: 'Percent Fines',
      fines_content: 'Percent Fines',
      specific_gravity: 'Specific Gravity',
      organic_content: 'Organic Content',
      ph: 'pH',
      unconfined_compression: 'Unconfined Compression',
      undrained_shear_strength: 'Triaxial',
      pocket_penetrometer: 'Pocket Penetrometer',
    };

    const labTests = {};

    // Borehole-resolution fallbacks for lab tests that don't carry a
    // samplingFeatureRef directly. Two-step strategy:
    //
    //   1. sample → borehole lookup, built from <SamplingActivity> elements
    //      (and any standalone <Sample>/<SoilSample> elements with a
    //      samplingFeatureRef of their own). Lab tests reference samples by
    //      gml:id via <sampleRef>, and the SamplingActivity's
    //      samplingFeatureRef points at the borehole.
    //
    //   2. Single-borehole fallback. Geosetta and several DOT exporters write
    //      lab tests with sampleRef hrefs that point to Sample IDs that don't
    //      exist as elements anywhere in the document — the chain is dangling.
    //      In a single-borehole file we can still attribute the tests to the
    //      one borehole that's there. For multi-borehole files with dangling
    //      sample chains we leave the borehole as 'Unknown' (better visible
    //      and unjoined than silently dropped).
    const sampleToBorehole = {};
    const _registerSampleIds = (parent, bhName) => {
      const w = this.doc.createTreeWalker(parent, NodeFilter.SHOW_ELEMENT, null);
      let n;
      while ((n = w.nextNode())) {
        const id = this._getGmlId(n);
        if (id && !sampleToBorehole[id]) sampleToBorehole[id] = bhName;
      }
    };
    for (const sa of this._findAll(this.root, 'SamplingActivity')) {
      const sfRef = this._find(sa, 'samplingFeatureRef');
      if (!sfRef) continue;
      const bh = this._resolveBoreholeRef(this._getXlinkHref(sfRef));
      if (bh && bh !== 'Unknown') _registerSampleIds(sa, bh);
    }
    for (const tag of ['Sample', 'SoilSample', 'RockSample']) {
      for (const s of this._findAll(this.root, tag)) {
        const id = this._getGmlId(s);
        if (!id || sampleToBorehole[id]) continue;
        const sfRef = this._find(s, 'samplingFeatureRef');
        if (sfRef) {
          const bh = this._resolveBoreholeRef(this._getXlinkHref(sfRef));
          if (bh && bh !== 'Unknown') sampleToBorehole[id] = bh;
        }
      }
    }
    const allBoreholes = this._findAll(this.root, 'Borehole');
    const onlyBoreholeName = allBoreholes.length === 1
      ? this._resolveBoreholeRef('#' + this._getGmlId(allBoreholes[0]))
      : null;

    for (const test of this._findAll(this.root, 'Test')) {
      // Groundwater-depth observations are surfaced via extractWaterTable()
      // (boring-log WT line, cross-section, SPT card). Skip here so they
      // don't double-display as a lab-test row.
      if (this._isGroundwaterTest(test)) continue;

      let testType = null;
      let procedureElem = null;

      // Identify test type by looking for procedure elements
      const walker = this.doc.createTreeWalker(test, NodeFilter.SHOW_ELEMENT, null);
      let node;
      let isSkipped = false;
      while ((node = walker.nextNode())) {
        if (node.localName && skipProcedures.has(node.localName)) {
          isSkipped = true;
          break;
        }
        for (const [tn, tc] of Object.entries(testTypeMap)) {
          if (node.localName && node.localName.includes(tn)) {
            testType = tc;
            procedureElem = node;
            break;
          }
        }
        if (testType) break;
      }
      if (isSkipped) continue;

      // If no known procedure-element type matched, try to derive a label from
      // the procedure element itself.
      if (!testType) {
        const proc = this._find(test, 'procedure');
        if (proc && proc.children.length > 0) {
          const procName = proc.children[0].localName || '';
          if (procName) {
            // "SomeTestName" -> "Some Test Name"
            testType = procName.replace(/Test$/, '').replace(/([A-Z])/g, ' $1').trim();
            procedureElem = proc.children[0];
          }
        }
      }

      // Final fallback: read the test's <gml:name> text. Geosetta / VDOT
      // exports identify lab tests this way (e.g. <gml:name>liquid_limit</gml:name>)
      // with no <procedure> element at all.
      if (!testType) {
        const directNameEls = this._findChildren(test, 'name');
        const gmlName = directNameEls.length && directNameEls[0].textContent
          ? directNameEls[0].textContent.trim() : '';
        if (gmlName) {
          const lookup = gmlName.toLowerCase().replace(/\s+/g, '_');
          if (gmlNameToTestType[lookup]) {
            testType = gmlNameToTestType[lookup];
          } else {
            // Unknown identifier — present it as a human-readable label.
            testType = gmlName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        }
      }
      if (!testType) continue;

      // Borehole reference — try samplingFeatureRef, then sampleRef → sample
      // lookup, then single-borehole fallback for files with broken chains.
      let borehole = 'Unknown';
      const sfRef = this._find(test, 'samplingFeatureRef');
      if (sfRef) {
        borehole = this._resolveBoreholeRef(this._getXlinkHref(sfRef));
      }
      if (!borehole || borehole === 'Unknown') {
        const sampRef = this._find(test, 'sampleRef');
        if (sampRef) {
          const sampleId = this._getXlinkHref(sampRef).replace(/^#/, '');
          if (sampleToBorehole[sampleId]) borehole = sampleToBorehole[sampleId];
        }
      }
      if ((!borehole || borehole === 'Unknown') && onlyBoreholeName) {
        borehole = onlyBoreholeName;
      }

      // Find TestResult
      for (const tr of this._findAll(test, 'TestResult')) {
        // Depth
        let depth = null;
        const locEl = this._find(tr, 'PointLocation') || this._find(tr, 'LinearExtent');
        if (locEl) {
          const posEl = this._find(locEl, 'pos') || this._find(locEl, 'posList');
          if (posEl && posEl.textContent) {
            depth = parseFloat(posEl.textContent.trim().split(/\s+/)[0]);
            if (isNaN(depth)) depth = null;
          }
        }

        // ResultSet
        for (const rs of this._findAll(tr, 'ResultSet')) {
          const propertyInfo = {};
          for (const prop of this._findAll(rs, 'Property')) {
            const index = prop.getAttribute('index');
            if (!index) continue;
            const propName = this._getText(prop, 'propertyName') || '';
            const propClass = this._getText(prop, 'propertyClass') || '';
            const uom = this._getText(prop, 'uom') || '';
            propertyInfo[parseInt(index)] = {
              name: propName || propClass,
              class: propClass,
              uom,
            };
          }

          const record = { Borehole: borehole, Depth_ft: depth };

          const dvEl = this._find(rs, 'dataValues');
          if (dvEl && dvEl.textContent && dvEl.textContent.trim()) {
            const cs = dvEl.getAttribute('cs') || ',';
            const values = dvEl.textContent.trim().split(cs);

            for (const [idx, prop] of Object.entries(propertyInfo)) {
              const vi = parseInt(idx) - 1;
              if (vi < values.length) {
                const val = values[vi].trim();
                if (!val) continue;
                let colName = triaxialNameMap[prop.name] || triaxialNameMap[prop.class] || prop.name;
                if (prop.uom) colName = `${colName} (${prop.uom})`;
                const numVal = parseFloat(val);
                record[colName] = isNaN(numVal) ? val : numVal;
              }
            }
          }

          // Triaxial extra properties from procedure element
          if (testType === 'Triaxial' && procedureElem) {
            const ttEl = this._find(procedureElem, 'triaxialTestType');
            if (ttEl && ttEl.textContent) record.Test_Type = ttEl.textContent.trim();
            const cpEl = this._find(procedureElem, 'totalCellPressureDuringShearStage');
            if (cpEl && cpEl.textContent) {
              const v = parseFloat(cpEl.textContent.trim());
              if (!isNaN(v)) record['Cell_Pressure (psi)'] = v;
            }
            const mfEl = this._find(procedureElem, 'modeOfFailure');
            if (mfEl && mfEl.textContent) record.Failure_Mode = mfEl.textContent.trim();
          }

          if (Object.keys(record).length > 2) {
            if (!labTests[testType]) labTests[testType] = [];
            labTests[testType].push(record);
          }
        }
      }
    }

    // Some exporters split Atterberg results across three separate Tests at
    // the same depth (one each for LL, PL, PI). Merge them so the lab table
    // shows one row per (borehole, depth) instead of three sparse rows.
    if (labTests['Atterberg Limits']) {
      const merged = new Map();
      for (const r of labTests['Atterberg Limits']) {
        const key = `${r.Borehole}__${r.Depth_ft}`;
        if (!merged.has(key)) merged.set(key, { ...r });
        else Object.assign(merged.get(key), r);
      }
      labTests['Atterberg Limits'] = [...merged.values()];

      // Derive Plastic Limit when the source only reports LL and PI. Geosetta
      // exports often emit PL as "N/A" even though PL = LL − PI is exact.
      const isNum = v => typeof v === 'number' && !isNaN(v);
      for (const row of labTests['Atterberg Limits']) {
        const keys = Object.keys(row);
        const llKey = keys.find(k => k.toLowerCase().includes('liquid'));
        const piKey = keys.find(k => k.toLowerCase().includes('plasticity'));
        const plKey = keys.find(k => k.toLowerCase().includes('plastic limit'));
        if (llKey && piKey && isNum(row[llKey]) && isNum(row[piKey])) {
          const target = plKey || 'Plastic Limit';
          if (!isNum(row[target])) {
            row[target] = row[llKey] - row[piKey];
          }
        }
      }
    }

    return labTests;
  }

  // --- Detect units from the file ---

  detectUnits() {
    const units = {
      depth: 'ft',
      depthLabel: 'ft',
      cptQc: '',
      cptQcLabel: '',
      cptFs: '',
      cptFsLabel: '',
      cptU2: '',
      cptU2Label: '',
    };

    // Depth unit — prefer the linear-referencing method's declared units
    // (authoritative for the CPT/PPD posList depths), then fall back to a
    // totalMeasuredDepth uom, then feet. See _fileDepthUnitRaw().
    const rawDepthUnit = this._fileDepthUnitRaw();
    units.depth = rawDepthUnit;
    units.depthLabel = _cleanUnitLabel(rawDepthUnit) || rawDepthUnit;

    // CPT units — from Property elements in the first CPT test
    for (const test of this._findAll(this.root, 'Test')) {
      const cptProc = this._find(test, 'StaticConePenetrationTest') || this._find(test, 'ConePenetration');
      if (!cptProc) continue;

      for (const prop of this._findAll(test, 'Property')) {
        const pName = this._getText(prop, 'propertyName');
        const uomEl = this._find(prop, 'uom');
        const uom = uomEl && uomEl.textContent ? uomEl.textContent.trim() : '';
        if (!pName || !uom) continue;

        const pLower = pName.toLowerCase();
        if (pLower === 'qc' || pLower === 'tip_resistance') {
          units.cptQc = uom;
          units.cptQcLabel = _cleanUnitLabel(uom);
        } else if (pLower === 'fs' || pLower === 'sleeve_friction') {
          units.cptFs = uom;
          units.cptFsLabel = _cleanUnitLabel(uom);
        } else if (pLower === 'u2' || pLower === 'pore_pressure' || pLower === 'pore_pressure_u2') {
          units.cptU2 = uom;
          units.cptU2Label = _cleanUnitLabel(uom);
        }
      }
      // Only need first CPT test
      if (units.cptQc) break;
    }

    return units;
  }

  // --- Extract project info ---

  extractProjectInfo() {
    const project = this._find(this.root, 'Project');
    if (!project) return {};
    return {
      name: this._getText(project, 'name') || '',
      description: this._getText(project, 'description') || '',
      id: this._getGmlId(project),
    };
  }

  // --- Discover what's in the file ---

  /**
   * Walk the XML and inventory all sampling features and test types.
   * Returns { samplingFeatures: { type: count }, testTypes: { type: count } }
   */
  discoverContents() {
    const samplingFeatures = {};
    const testTypes = {};

    // Sampling features are children of <samplingFeature> wrapper elements
    for (const sf of this._findAll(this.root, 'samplingFeature')) {
      for (const child of sf.children) {
        const name = child.localName;
        if (name) samplingFeatures[name] = (samplingFeatures[name] || 0) + 1;
      }
    }

    // Also count top-level element types if samplingFeature wrappers aren't used
    if (Object.keys(samplingFeatures).length === 0) {
      const knownFeatures = ['Borehole', 'Sounding', 'TestPit', 'Trench',
        'ExcavationSamplingFeature', 'WellSamplingFeature', 'MonitoringPoint'];
      for (const name of knownFeatures) {
        const count = this._findAll(this.root, name).length;
        if (count > 0) samplingFeatures[name] = count;
      }
    }

    // Test types — look at procedure elements inside Test
    const knownProcedures = {
      DrivenPenetrationTest: 'SPT',
      StaticConePenetrationTest: 'CPT',
      ConePenetration: 'CPT',
      WaterContentTest: 'Water Content',
      AtterbergLimitsTest: 'Atterberg Limits',
      LabDensityTest: 'Lab Density',
      ParticleSizeTest: 'Particle Size',
      PocketPenetrometerTest: 'Pocket Penetrometer',
      TriaxialTest: 'Triaxial',
      VaneShearTest: 'Vane Shear',
      PressuremeterTest: 'Pressuremeter',
      DilatometerTest: 'Dilatometer',
      PermeabilityTest: 'Permeability',
      ConsolidationTest: 'Consolidation',
      DirectShearTest: 'Direct Shear',
      UnconfinedCompressionTest: 'Unconfined Compression',
    };

    for (const test of this._findAll(this.root, 'Test')) {
      const walker = this.doc.createTreeWalker(test, NodeFilter.SHOW_ELEMENT, null);
      let node;
      let found = false;
      while ((node = walker.nextNode())) {
        if (!node.localName) continue;
        // Check known procedures
        for (const [procName, label] of Object.entries(knownProcedures)) {
          if (node.localName.includes(procName)) {
            testTypes[label] = (testTypes[label] || 0) + 1;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        // Unknown test — try to get a label from the procedure element
        const proc = this._find(test, 'procedure');
        if (proc && proc.children.length > 0) {
          const procType = proc.children[0].localName || 'Unknown Test';
          testTypes[procType] = (testTypes[procType] || 0) + 1;
        } else {
          testTypes['Other Test'] = (testTypes['Other Test'] || 0) + 1;
        }
      }
    }

    // Lithology
    const lithCount = this._findAll(this.root, 'LithologySystem').length;

    return { samplingFeatures, testTypes, hasLithology: lithCount > 0 };
  }

  // --- Extract generic sampling features ---

  /**
   * Extract any sampling feature type (TestPit, Trench, etc.) with basic metadata.
   * Excludes Borehole and Sounding which have dedicated extractors.
   */
  extractOtherSamplingFeatures() {
    const features = [];
    const skip = new Set(['Borehole', 'Sounding']);

    for (const sf of this._findAll(this.root, 'samplingFeature')) {
      for (const child of sf.children) {
        if (!child.localName || skip.has(child.localName)) continue;

        const nameEl = this._find(child, 'name');
        const name = nameEl && nameEl.textContent ? nameEl.textContent.trim() : 'Unknown';
        const gmlId = this._getGmlId(child);

        const depthEl = this._find(child, 'totalMeasuredDepth');
        const depth = depthEl && depthEl.textContent ? parseFloat(depthEl.textContent) : null;
        const depthUnit = depthEl ? (depthEl.getAttribute('uom') || 'ft') : 'ft';

        const posEl = this._find(child, 'pos');
        const geo = this._parseGeoPos(posEl);

        features.push({
          Type: child.localName,
          Name: name,
          ID: gmlId,
          Total_Depth: depth,
          Depth_Unit: depthUnit,
          Latitude: geo.Latitude,
          Longitude: geo.Longitude,
          Elevation: geo.Elevation,
        });
      }
    }
    return features;
  }
}

// --- Unit label cleanup ---

const UNIT_DISPLAY_MAP = {
  'ft': 'ft',
  'm': 'm',
  'meter': 'm',
  'meters': 'm',
  'metre': 'm',
  'metres': 'm',
  '%': '%',
  'kPa': 'kPa',
  'kpa': 'kPa',
  'MPa': 'MPa',
  'mpa': 'MPa',
  'psi': 'psi',
  'tsf': 'tsf',
  'tonf[US]/ft2': 'tsf',
  'ton/ft2': 'tsf',
  'ksf': 'ksf',
  'kN/m2': 'kPa',
  'MN/m2': 'MPa',
  'bar': 'bar',
  'atm': 'atm',
  'kg/cm2': 'kg/cm\u00B2',
  'cm': 'cm',
  'mm': 'mm',
  'in': 'in',
  'pcf': 'pcf',
  'kN/m3': 'kN/m\u00B3',
  'lb/ft3': 'pcf',
};

function _cleanUnitLabel(rawUnit) {
  if (!rawUnit) return '';
  // Try exact match first
  if (UNIT_DISPLAY_MAP[rawUnit]) return UNIT_DISPLAY_MAP[rawUnit];
  // Try case-insensitive
  const lower = rawUnit.toLowerCase();
  for (const [k, v] of Object.entries(UNIT_DISPLAY_MAP)) {
    if (k.toLowerCase() === lower) return v;
  }
  // Fall back to raw string, cleaned up
  return rawUnit.replace(/\[US\]/g, '').replace(/\[.*?\]/g, '');
}

// --- MWD channel helpers ---
//
// Map an MWD <Property> into a stable JS-safe key. Prefer the schema's
// propertyClass (e.g. "penetration_rate") since it's machine-readable and
// stable across files; fall back to the propertyName slug for non-conformant
// exports that omit propertyClass.
function _mwdChannelKey(prop) {
  const cls = (prop.propertyClass || '').trim();
  if (cls) return cls;
  return (prop.name || 'channel')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// True if a parsed numeric matches the property's declared null sentinel
// (e.g. 9999 with reason="missing"). Uses a small epsilon since the file
// declares the sentinel as text.
function _isMwdNull(value, nullSentinel) {
  if (nullSentinel == null) return false;
  return Math.abs(value - nullSentinel) < 1e-9;
}

// --- Coordinate validation (from data_uploader.py) ---

function getValidCoords(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return [null, null];
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) {
    return [lon, lat]; // swapped
  } else if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return [lat, lon];
  }
  return [null, null];
}
