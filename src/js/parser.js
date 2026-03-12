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

    // Build sounding lookup
    this.soundingsById = {};
    this._buildSoundingLookup();
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
      const coords = posEl && posEl.textContent ? posEl.textContent.trim().split(/\s+/) : [];

      boreholes.push({
        Name: name,
        ID: gmlId,
        Total_Depth: depth,
        Depth_Unit: depthUnit,
        Latitude: coords.length > 1 ? parseFloat(coords[1]) : null,
        Longitude: coords.length > 0 ? parseFloat(coords[0]) : null,
        Elevation: coords.length > 2 ? parseFloat(coords[2]) : null,
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
      const coords = posEl && posEl.textContent ? posEl.textContent.trim().split(/\s+/) : [];

      soundings.push({
        Name: info.name,
        ID: gmlId,
        Total_Depth: depth,
        Depth_Unit: depthUnit,
        Latitude: coords.length > 1 ? parseFloat(coords[1]) : null,
        Longitude: coords.length > 0 ? parseFloat(coords[0]) : null,
        Elevation: coords.length > 2 ? parseFloat(coords[2]) : null,
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
        const href = this._getXlinkHref(sfRef);
        if (href) borehole = href.replace('#', '').replace('Location_', '');
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
                propertyIndices[parseInt(index)] = pNameEl.textContent.toLowerCase();
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

            for (const [idx, propName] of Object.entries(propertyIndices)) {
              const vi = parseInt(idx) - 1;
              if (vi < values.length) {
                const val = parseFloat(values[vi]);
                if (isNaN(val)) continue;
                if (propName === 'qc' || propName === 'tip_resistance') {
                  rowData.Tip_Resistance_tsf = val;
                } else if (propName === 'fs' || propName === 'sleeve_friction') {
                  rowData.Sleeve_Friction_tsf = val;
                } else if (propName === 'u2' || propName === 'pore_pressure' || propName === 'pore_pressure_u2') {
                  rowData.Pore_Pressure_tsf = val;
                } else {
                  rowData[propName] = val;
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

  // --- Extract lithology ---

  extractLithology() {
    const lithData = [];

    for (const ls of this._findAll(this.root, 'LithologySystem')) {
      let borehole = 'Unknown';
      const sfRef = this._find(ls, 'samplingFeatureRef');
      if (sfRef) {
        const href = this._getXlinkHref(sfRef);
        if (href) borehole = href.replace('#', '').replace('Location_', '');
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
        const legendCode = this._getText(obs, 'legendCode') || '';
        const unitName = this._getText(obs, 'unitName') || '';

        if (topDepth !== null) {
          lithData.push({
            Borehole: borehole,
            Top_Depth_ft: topDepth,
            Bottom_Depth_ft: bottomDepth,
            USCS_Code: legendCode,
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

    for (const bh of this._findAll(this.root, 'Borehole')) {
      let borehole = 'Unknown';
      const nameEl = this._find(bh, 'name');
      if (nameEl && nameEl.textContent) borehole = nameEl.textContent.trim();

      for (const wsr of this._findAll(bh, 'WaterStrikeReading')) {
        const posEl = this._find(wsr, 'pos');
        if (posEl && posEl.textContent) {
          const waterDepth = parseFloat(posEl.textContent.trim());
          if (!isNaN(waterDepth)) {
            waterData.push({ Borehole: borehole, Water_Depth_ft: waterDepth });
          }
        }
      }
    }
    return waterData;
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

    const labTests = {};

    for (const test of this._findAll(this.root, 'Test')) {
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

      // If no known type matched, try to derive a label from the procedure element
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
        if (!testType) continue;
      }

      // Borehole reference
      let borehole = 'Unknown';
      const sfRef = this._find(test, 'samplingFeatureRef');
      if (sfRef) {
        const href = this._getXlinkHref(sfRef);
        if (href) borehole = href.replace('#', '').replace('Location_', '');
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

    // Depth unit — from first borehole or sounding totalMeasuredDepth
    const depthEl = this._find(this.root, 'totalMeasuredDepth');
    if (depthEl) {
      const uom = depthEl.getAttribute('uom');
      if (uom) {
        units.depth = uom;
        units.depthLabel = _cleanUnitLabel(uom);
      }
    }

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
        const coords = posEl && posEl.textContent ? posEl.textContent.trim().split(/\s+/) : [];

        features.push({
          Type: child.localName,
          Name: name,
          ID: gmlId,
          Total_Depth: depth,
          Depth_Unit: depthUnit,
          Latitude: coords.length > 1 ? parseFloat(coords[1]) : null,
          Longitude: coords.length > 0 ? parseFloat(coords[0]) : null,
          Elevation: coords.length > 2 ? parseFloat(coords[2]) : null,
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
