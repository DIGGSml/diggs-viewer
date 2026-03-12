/**
 * Geotechnical Calculations
 * Port of features/interpretation/*.py
 */

const GeoCalc = {
  // --- SPT Correlations (spt_correlations.py) ---

  /** N60 correction: N60 = N × (Er/60) */
  calculateN60(nValue, hammerEfficiency) {
    if (nValue == null) return null;
    const er = hammerEfficiency || 60;
    return nValue * (er / 60);
  },

  /** (N1)60 normalization: CN = sqrt(Pa/σ'v) ≤ 2.0 */
  calculateN1_60(n60, effectiveStress) {
    if (n60 == null || effectiveStress == null || effectiveStress <= 0) return null;
    const Pa = 100; // kPa
    const CN = Math.min(Math.sqrt(Pa / effectiveStress), 2.0);
    return n60 * CN;
  },

  /** Friction angle: φ = 27.1 + 0.3×N60 - 0.00054×N60² */
  estimateFrictionAngle(n60, soilType) {
    if (n60 == null) return null;
    const st = (soilType || '').toUpperCase();
    if (st.includes('CL') || st.includes('CH') || st.includes('CLAY')) {
      return null; // Not applicable for clays
    }
    return 27.1 + 0.3 * n60 - 0.00054 * n60 * n60;
  },

  /** Relative density: Dr = 21 × √(N1)60 */
  estimateRelativeDensity(n1_60) {
    if (n1_60 == null || n1_60 < 0) return null;
    return 21 * Math.sqrt(n1_60);
  },

  /** Unit weight: γ = 16 + 0.1×N60 kN/m³ (sand) */
  estimateUnitWeight(n60, soilType) {
    if (n60 == null) return null;
    const st = (soilType || '').toUpperCase();
    if (st.includes('CL') || st.includes('CH') || st.includes('CLAY')) {
      return 17 + 0.05 * n60; // clay
    }
    return 16 + 0.1 * n60; // sand
  },

  /** Elastic modulus: Es = 500(N60+15) kPa (sand) */
  estimateElasticModulus(n60, soilType) {
    if (n60 == null) return null;
    const st = (soilType || '').toUpperCase();
    if (st.includes('CL') || st.includes('CH') || st.includes('CLAY')) {
      return 300 * (n60 + 6); // clay
    }
    return 500 * (n60 + 15); // sand
  },

  /** Undrained shear strength: Su = 29×N60^0.72 kPa (clay) */
  estimateUndrainedShearStrength(n60) {
    if (n60 == null || n60 <= 0) return null;
    return 29 * Math.pow(n60, 0.72);
  },

  /** Compression index: Cc = 0.5 - 0.01×N60 */
  estimateCompressionIndex(n60) {
    if (n60 == null) return null;
    return Math.max(0.5 - 0.01 * n60, 0.01);
  },

  /** Soil density classification */
  classifySoilDensity(n60, soilType) {
    if (n60 == null) return 'Unknown';
    const st = (soilType || '').toUpperCase();
    const isClay = st.includes('CL') || st.includes('CH') || st.includes('CLAY');

    if (isClay) {
      if (n60 < 2) return 'Very Soft';
      if (n60 < 4) return 'Soft';
      if (n60 < 8) return 'Medium Stiff';
      if (n60 < 15) return 'Stiff';
      if (n60 < 30) return 'Very Stiff';
      return 'Hard';
    } else {
      if (n60 < 4) return 'Very Loose';
      if (n60 < 10) return 'Loose';
      if (n60 < 30) return 'Medium Dense';
      if (n60 < 50) return 'Dense';
      return 'Very Dense';
    }
  },

  /** Calculate effective stress at depth */
  calculateEffectiveStress(depth, unitWeight, waterTableDepth) {
    const gammaW = 9.81;
    const gamma = unitWeight || 18;
    const wt = waterTableDepth || 999;
    const gammaSat = gamma + 1.5;

    if (depth <= wt) {
      return gamma * depth;
    }
    return gamma * wt + gammaSat * (depth - wt) - gammaW * (depth - wt);
  },

  // --- Bearing Capacity (bearing_capacity.py) ---

  /** Meyerhof (1956) direct SPT method */
  bearingMeyerhof(N, B, Df) {
    const kd = Math.min(1 + 0.33 * (Df / B), 1.33);
    if (B <= 1.22) {
      return 12 * N * kd;
    }
    return 8 * N * Math.pow((B + 0.305) / B, 2) * kd;
  },

  /** Bowles (1988) direct SPT method */
  bearingBowles(N, B, Df) {
    const kd = Math.min(1 + 0.33 * (Df / B), 1.33);
    if (B <= 1.22) {
      return 20 * N * kd;
    }
    return 12.5 * N * Math.pow((B + 0.305) / B, 2) * kd;
  },

  /** Terzaghi & Peck (1967) direct SPT method */
  bearingTerzaghiPeck(N, B, Df) {
    const kd = Math.min(1 + 0.33 * (Df / B), 1.33);
    if (B <= 1.22) {
      return N / 0.05;
    }
    return (N / 0.08) * Math.pow((B + 0.3) / B, 2) * kd;
  },

  /** Bearing capacity factors */
  bearingCapacityFactors(phi) {
    const phiRad = phi * Math.PI / 180;
    const Nq = Math.exp(Math.PI * Math.tan(phiRad)) * Math.pow(Math.tan(Math.PI / 4 + phiRad / 2), 2);
    const Nc = phi === 0 ? 5.14 : (Nq - 1) / Math.tan(phiRad);
    const Ng = 2 * (Nq + 1) * Math.tan(phiRad); // Vesic
    return { Nc, Nq, Ng };
  },

  /** Water table correction */
  waterTableCorrection(Dw, Df, B) {
    if (Dw <= Df) return 0.5;
    if (Dw < Df + B) return 0.5 + 0.5 * (Dw - Df) / B;
    return 1.0;
  },

  // --- Settlement (settlement.py) ---

  /** Meyerhof (1965) settlement */
  settlementMeyerhof(q, N60, B, Df) {
    const Fd = Math.min(1 + 0.33 * (Df / B), 1.33);
    if (B <= 1.22) {
      return (q * 25) / (12 * N60 * Fd);
    }
    return (q * Math.pow((B + 0.3) / B, 2) * 25) / (8 * N60 * Fd);
  },

  /** Burland & Burbidge (1985) settlement */
  settlementBurland(q, N60, B) {
    const Ic = 1.71 / Math.pow(N60, 1.4);
    const fs = 1.0; // simplified for square footing
    return fs * q * Math.pow(B, 0.7) * Ic;
  },

  /** 1-D Consolidation settlement */
  consolidationSettlement(Cc, e0, H, sigma_v0, delta_sigma) {
    if (sigma_v0 <= 0 || Cc <= 0) return 0;
    return (Cc * H / (1 + e0)) * Math.log10((sigma_v0 + delta_sigma) / sigma_v0);
  },

  // --- Liquefaction (liquefaction.py) ---

  /** SPT corrections for liquefaction */
  correctN160(N, hammerEfficiency, rodLength, boreholeDia) {
    // Rod length correction
    let Cr = 1.0;
    if (rodLength < 3) Cr = 0.75;
    else if (rodLength < 4) Cr = 0.80;
    else if (rodLength < 6) Cr = 0.85;
    else if (rodLength < 10) Cr = 0.95;

    // Borehole diameter
    let CB = 1.0;
    if (boreholeDia >= 200) CB = 1.15;
    else if (boreholeDia >= 150) CB = 1.05;

    const Ce = (hammerEfficiency || 60) / 60;
    return (Cr * Ce * CB * N) / 0.6 * 0.6; // simplified
  },

  /** Fines content correction (Youd et al., 2001) */
  finesCorrection(N1_60, FC) {
    let alpha, beta;
    if (FC < 5) { alpha = 0; beta = 1.0; }
    else if (FC < 35) {
      alpha = Math.exp(1.76 - 190 / (FC * FC));
      beta = 0.99 + Math.pow(FC, 1.5) / 1000;
    } else {
      alpha = 5; beta = 1.2;
    }
    return alpha + beta * N1_60;
  },

  /** Cyclic Stress Ratio */
  calculateCSR(amax, sigma_v, sigma_v_eff, depth, Mw) {
    // Stress reduction coefficient
    let rd;
    if (depth < 9.15) rd = 1 - 0.00765 * depth;
    else if (depth < 23) rd = 1.174 - 0.0267 * depth;
    else rd = Math.max(0.744 - 0.008 * depth, 0.5);

    // Magnitude scaling factor
    const MSF = Math.pow(10, 2.24) / Math.pow(Mw || 7.5, 2.56);

    return 0.65 * amax * (sigma_v / sigma_v_eff) * (rd / MSF);
  },

  /** Cyclic Resistance Ratio (Youd et al., 2001) */
  calculateCRR(N1_60cs) {
    if (N1_60cs >= 30) return 1.0;
    return 1 / (34 - N1_60cs) + N1_60cs / 135 + 50 / Math.pow(10 * N1_60cs + 45, 2) - 1 / 200;
  },

  /** Liquefaction Potential Index (Iwasaki) */
  calculateLPI(factorsOfSafety) {
    let lpi = 0;
    for (const { depth, FS, thickness } of factorsOfSafety) {
      if (depth >= 20) continue;
      const F = FS < 1 ? Math.max(1 - FS, 0) : 0;
      const w = Math.max(10 - 0.5 * depth, 0);
      lpi += F * w * thickness;
    }
    return lpi;
  },

  /** LPI classification */
  classifyLPI(lpi) {
    if (lpi <= 0) return { class: 'Non-Liquefiable', color: '#28a745' };
    if (lpi <= 5) return { class: 'Low', color: '#ffc107' };
    if (lpi <= 15) return { class: 'High', color: '#fd7e14' };
    return { class: 'Very High', color: '#dc3545' };
  },

  // --- Earth Pressure ---

  /** Rankine active earth pressure coefficient */
  Ka(phi) {
    const phiRad = phi * Math.PI / 180;
    return Math.pow(Math.tan(Math.PI / 4 - phiRad / 2), 2);
  },

  /** Rankine passive earth pressure coefficient */
  Kp(phi) {
    const phiRad = phi * Math.PI / 180;
    return Math.pow(Math.tan(Math.PI / 4 + phiRad / 2), 2);
  },

  /** At-rest earth pressure coefficient */
  K0(phi) {
    return 1 - Math.sin(phi * Math.PI / 180);
  },
};

/**
 * Run full SPT correlation analysis for a borehole
 */
function runSPTCorrelations(sptData, lithology, waterTableDepth, hammerEfficiency) {
  const results = [];
  const wt = waterTableDepth || 999;

  for (const spt of sptData) {
    const n60 = GeoCalc.calculateN60(spt.N_Value, hammerEfficiency || spt.Hammer_Efficiency_pct);
    if (n60 == null) continue;

    // Find USCS code for this depth
    let uscsCode = '';
    if (lithology) {
      for (const l of lithology) {
        if (spt.Top_Depth_ft >= l.Top_Depth_ft && spt.Top_Depth_ft < (l.Bottom_Depth_ft || Infinity)) {
          uscsCode = l.USCS_Code || '';
          break;
        }
      }
    }

    const gamma = GeoCalc.estimateUnitWeight(n60, uscsCode);
    // Convert depth to meters for stress calc
    const _du = typeof du === 'function' ? du() : 'ft';
    const toM = _du === 'm' ? 1 : 0.3048;
    const depthM = spt.Top_Depth_ft * toM;
    const wtM = wt * toM;
    const effStress = GeoCalc.calculateEffectiveStress(depthM, gamma, wtM);
    const n1_60 = GeoCalc.calculateN1_60(n60, effStress);

    results.push({
      depth: spt.Top_Depth_ft,
      N: spt.N_Value,
      N60: n60,
      N1_60: n1_60,
      USCS: uscsCode,
      density: GeoCalc.classifySoilDensity(n60, uscsCode),
      phi: GeoCalc.estimateFrictionAngle(n60, uscsCode),
      Dr: n1_60 ? GeoCalc.estimateRelativeDensity(n1_60) : null,
      gamma: gamma,
      Es: GeoCalc.estimateElasticModulus(n60, uscsCode),
      Su: GeoCalc.estimateUndrainedShearStrength(n60),
      Cc: GeoCalc.estimateCompressionIndex(n60),
    });
  }
  return results;
}
