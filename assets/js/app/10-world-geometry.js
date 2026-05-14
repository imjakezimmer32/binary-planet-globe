// ── Noise ─────────────────────────────────────────────────────────
function noise3(x, y, z) {
  return (
    Math.sin(x * 1.731 + y * 2.571 + z * 0.913) * 0.500 +
    Math.sin(x * 3.127 + z * 1.234 + y * 0.456) * 0.250 +
    Math.sin(y * 4.321 + z * 2.876 + x * 1.111) * 0.125 +
    Math.sin(x * 7.654 + y * 5.432 + z * 3.210) * 0.063 +
    Math.sin(x * 13.10 + z * 11.30 + y * 9.170) * 0.031
  );
}

// ── Globe geometry ────────────────────────────────────────────────
function getLiquidState(wl, baseR) {
  const signedLevel = Math.max(-1, Math.min(1, wl));
  // Shared slider spectrum: + side is water, - side is lava.
  const hasWater = signedLevel > 0.0001;
  const hasLava = signedLevel < -0.0001;
  const strength = Math.abs(signedLevel);
  const hasLiquid = strength > 0.0001;
  const liquidScale = 0.80 + strength * 0.42;
  return {
    signedLevel,
    hasWater,
    hasLava,
    hasLiquid,
    strength,
    liquidScale,
    liquidR: baseR * liquidScale,
  };
}

function fracUnit(x) {
  return x - Math.floor(x);
}
/** Deterministic unit vector from seed (stable across rebuilds). */
function hashDir3(seed, salt) {
  const x = fracUnit(Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453);
  const y = fracUnit(Math.sin(seed * 269.5 + salt * 419.2) * 23421.8761);
  const z = fracUnit(Math.sin(seed * 419.3 + salt * 913.4) * 91234.1234);
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

const GEOGRAPHY_STYLE_OPTIONS = [
  { id: 'natural', label: 'Natural' },
  { id: 'pangaea', label: 'Pangaea' },
  { id: 'archipelago', label: 'Islands' },
  { id: 'dual', label: 'Two lands' },
  { id: 'polar', label: 'Polar' },
  { id: 'rift', label: 'Rift' },
  { id: 'atolls', label: 'Atolls' },
];
const GEOGRAPHY_STYLE_STORAGE_KEY = 'astrabound-planet-geography-style';
const DEFAULT_GEOGRAPHY_STYLE = 'natural';

function normalizeGeographyStyle(id) {
  if (!id) return DEFAULT_GEOGRAPHY_STYLE;
  return GEOGRAPHY_STYLE_OPTIONS.some(o => o.id === id) ? id : DEFAULT_GEOGRAPHY_STYLE;
}

function getGlobalGeographyStyle() {
  try {
    return normalizeGeographyStyle(localStorage.getItem(GEOGRAPHY_STYLE_STORAGE_KEY));
  } catch (e) {
    return DEFAULT_GEOGRAPHY_STYLE;
  }
}

function setGlobalGeographyStyle(id) {
  const n = normalizeGeographyStyle(id);
  try {
    localStorage.setItem(GEOGRAPHY_STYLE_STORAGE_KEY, n);
  } catch (e) { /* ignore */ }
  return n;
}

/**
 * Radial terrain displacement before × peakScale (same numeric scale as the
 * classic two-octave noise). Each geography preset is its own recipe — not
 * the same noise with a tiny additive bias.
 */
function globeTerrainDisplacement(nx, ny, nz, seed, geographyStyle) {
  const s = seed;
  const sty = normalizeGeographyStyle(geographyStyle);

  if (sty === 'natural') {
    return noise3(nx * 1.7 + s, ny * 1.7 + s, nz * 1.7 + s) * 0.14
      + noise3(nx * 4.0 + s, ny * 4.0 + s, nz * 4.0 + s) * 0.04;
  }

  let h = 0;

  switch (sty) {
    case 'pangaea': {
      const [ax, ay, az] = hashDir3(s, 101);
      const u = nx * ax + ny * ay + nz * az;
      const cap = Math.pow(Math.max(0, u + 0.22) / 1.22, 0.55);
      const uplift = 0.22 * cap * (0.48 + 0.52 * noise3(nx * 0.14 + s * 0.1, ny * 0.14 + s * 0.14, nz * 0.14 + s * 0.09));
      const abyss = -0.11 * Math.pow(Math.max(0, -u), 1.15);
      const detail = noise3(nx * 3.1 + s, ny * 3.1 + s, nz * 3.1 + s) * 0.042;
      h = uplift + abyss + detail;
      break;
    }
    case 'archipelago': {
      const plate = noise3(nx * 0.52 + s, ny * 0.52 + s * 0.33, nz * 0.52 + s * 0.61);
      const ridge = Math.pow(Math.max(0, 1 - Math.abs(plate)), 2.35);
      const speck = Math.abs(noise3(nx * 8.5 + s, ny * 8.5 + s * 0.7, nz * 8.5 + s * 0.45));
      const swell = noise3(nx * 0.18 + s, ny * 0.18 + s, nz * 0.18 + s) * 0.028;
      h = -0.11 + swell + 0.095 * ridge * (0.28 + speck) + noise3(nx * 4.2 + s, ny * 4.2 + s, nz * 4.2 + s) * 0.036;
      break;
    }
    case 'dual': {
      const [ax, ay, az] = hashDir3(s, 207);
      const d = nx * ax + ny * ay + nz * az;
      const lobe = Math.exp(-6.4 * (d - 0.66) * (d - 0.66)) + Math.exp(-6.4 * (d + 0.66) * (d + 0.66));
      h = 0.16 * lobe - 0.035 + noise3(nx * 3.6 + s, ny * 3.6 + s, nz * 3.6 + s) * 0.04;
      break;
    }
    case 'polar': {
      const [px, py, pz] = hashDir3(s, 309);
      const L = Math.abs(nx * px + ny * py + nz * pz);
      const caps = 0.21 * Math.pow(L, 1.75);
      const tropics = -0.1 * (1 - L) * (1 - L);
      h = caps + tropics + noise3(nx * 2.9 + s, ny * 2.9 + s, nz * 2.9 + s) * 0.038;
      break;
    }
    case 'rift': {
      const [rx, ry, rz] = hashDir3(s, 401);
      const u = nx * rx + ny * ry + nz * rz;
      const spine = Math.exp(-24 * u * u);
      const serr = (1 - Math.abs(noise3(nx * 5.8 + s, ny * 5.8 + s, nz * 5.8 + s))) * 0.09;
      h = 0.15 * spine + serr - 0.065 + noise3(nx * 2.3 + s, ny * 2.3 + s, nz * 2.3 + s) * 0.032;
      break;
    }
    case 'atolls': {
      const [qx, qy, qz] = hashDir3(s, 503);
      const L = nx * qx + ny * qy + nz * qz;
      const t = Math.abs(L);
      const ring = Math.exp(-48 * (t - 0.5) * (t - 0.5));
      const w = noise3(nx * 2.0 + s, ny * 2.0 + s * 0.55, nz * 2.0 + s * 0.33);
      h = -0.095 * (1 - ring) + 0.125 * ring * (0.32 + 0.68 * w * w) + noise3(nx * 7.5 + s, ny * 7.5 + s, nz * 7.5 + s) * 0.03;
      break;
    }
    default:
      h = noise3(nx * 1.7 + s, ny * 1.7 + s, nz * 1.7 + s) * 0.14
        + noise3(nx * 4.0 + s, ny * 4.0 + s, nz * 4.0 + s) * 0.04;
  }

  return Math.max(-0.26, Math.min(0.3, h));
}

function buildGlobe(radius, detail, seed, ps, wl, geographyStyle) {
  // ps = peakScale, wl = waterLevel (explicit per-planet)
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const arr = geo.attributes.position.array;
  const liquid = getLiquidState(wl, radius);
  const hasLiquid = liquid.hasLiquid;
  const liquidR = liquid.liquidR;
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const ox = arr[i*3], oy = arr[i*3+1], oz = arr[i*3+2];
    const len = Math.sqrt(ox*ox + oy*oy + oz*oz);
    const nx = ox/len, ny = oy/len, nz = oz/len;
    const d = globeTerrainDisplacement(nx, ny, nz, seed, geographyStyle) * ps;
    // Clamp low terrain only when a liquid exists so 0 stays dry.
    const rawR = radius * (1 + d);
    const r = hasLiquid ? Math.max(rawR, liquidR) : rawR;
    arr[i*3] = nx*r; arr[i*3+1] = ny*r; arr[i*3+2] = nz*r;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// ── Elevation colour ramps ─────────────────────────────────────────
// WET palette: vegetation appears, with no lava colors while water exists.
const PALETTE_WET = [
  [-0.200, [0.070, 0.065, 0.070]],  // deep basalt
  [-0.180, [0.090, 0.085, 0.090]],  // dark basalt
  [-0.130, [0.120, 0.110, 0.105]],  // rocky lowland
  [-0.100, [0.180, 0.175, 0.170]],  // dark grey
  [-0.030, [0.300, 0.205, 0.120]],  // brown sub-floor
  [ 0.000, [0.290, 0.175, 0.090]],  // shore brown
  [ 0.040, [0.105, 0.320, 0.062]],  // lowland green
  [ 0.140, [0.080, 0.220, 0.040]],  // highland green
  [ 0.165, [0.330, 0.190, 0.090]],  // treeline brown
  [ 0.182, [0.370, 0.365, 0.355]],  // rock grey
  [ 0.200, [0.940, 0.940, 0.930]],  // peak white
];
// DRY palette: no water → no green, still no baked-in lava tones.
const PALETTE_DRY = [
  [-0.200, [0.120, 0.100, 0.080]],  // deep dry basin
  [-0.180, [0.150, 0.120, 0.095]],  // dark rust-brown
  [-0.130, [0.190, 0.150, 0.110]],  // lowland earth
  [-0.100, [0.230, 0.175, 0.120]],  // dark tan
  [-0.030, [0.310, 0.195, 0.105]],  // brown
  [ 0.000, [0.310, 0.195, 0.105]],  // dusty brown (same — no shore distinction)
  [ 0.040, [0.462, 0.312, 0.155]],  // sandy tan   (was green)
  [ 0.140, [0.382, 0.240, 0.110]],  // dusty brown (was highland green)
  [ 0.165, [0.330, 0.190, 0.090]],  // brown
  [ 0.182, [0.370, 0.365, 0.355]],  // rock grey
  [ 0.200, [0.940, 0.940, 0.930]],  // peak white
];
function elevColor(ne, pal) {
  if (ne <= pal[0][0]) return pal[0][1];
  for (let i = 1; i < pal.length; i++) {
    if (ne <= pal[i][0]) {
      const t = (ne - pal[i-1][0]) / (pal[i][0] - pal[i-1][0]);
      const a = pal[i-1][1], b = pal[i][1];
      return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
    }
  }
  return pal[pal.length-1][1];
}
function blendPaletteNamed(wetAmt, dryPal, wetPal) {
  if (wetAmt >= 1) return wetPal;
  if (wetAmt <= 0) return dryPal;
  return wetPal.map((e, i) => [
    e[0],
    e[1].map((c, j) => c * wetAmt + dryPal[i][1][j] * (1 - wetAmt))
  ]);
}
function blendPalette(wet) {
  return blendPaletteNamed(wet, PALETTE_DRY, PALETTE_WET);
}

// Extra terrain palettes (same elevation knots as PALETTE_WET / PALETTE_DRY).
const PALETTE_FROST_WET = [
  [-0.200, [0.045, 0.055, 0.075]],
  [-0.180, [0.060, 0.075, 0.095]],
  [-0.130, [0.085, 0.105, 0.125]],
  [-0.100, [0.120, 0.145, 0.165]],
  [-0.030, [0.160, 0.195, 0.215]],
  [ 0.000, [0.150, 0.210, 0.235]],
  [ 0.040, [0.055, 0.260, 0.300]],
  [ 0.140, [0.040, 0.360, 0.400]],
  [ 0.165, [0.200, 0.240, 0.255]],
  [ 0.182, [0.420, 0.445, 0.465]],
  [ 0.200, [0.920, 0.955, 0.980]],
];
const PALETTE_FROST_DRY = [
  [-0.200, [0.070, 0.075, 0.085]],
  [-0.180, [0.095, 0.100, 0.110]],
  [-0.130, [0.130, 0.135, 0.145]],
  [-0.100, [0.165, 0.175, 0.185]],
  [-0.030, [0.210, 0.220, 0.230]],
  [ 0.000, [0.220, 0.225, 0.235]],
  [ 0.040, [0.240, 0.255, 0.270]],
  [ 0.140, [0.280, 0.295, 0.310]],
  [ 0.165, [0.300, 0.310, 0.325]],
  [ 0.182, [0.380, 0.395, 0.410]],
  [ 0.200, [0.900, 0.930, 0.950]],
];
const PALETTE_DESERT_WET = [
  [-0.200, [0.080, 0.055, 0.045]],
  [-0.180, [0.110, 0.075, 0.055]],
  [-0.130, [0.150, 0.105, 0.075]],
  [-0.100, [0.200, 0.140, 0.095]],
  [-0.030, [0.280, 0.195, 0.110]],
  [ 0.000, [0.300, 0.210, 0.120]],
  [ 0.040, [0.180, 0.260, 0.100]],
  [ 0.140, [0.140, 0.220, 0.080]],
  [ 0.165, [0.260, 0.180, 0.090]],
  [ 0.182, [0.400, 0.360, 0.300]],
  [ 0.200, [0.960, 0.930, 0.880]],
];
const PALETTE_DESERT_DRY = [
  [-0.200, [0.100, 0.070, 0.050]],
  [-0.180, [0.130, 0.090, 0.065]],
  [-0.130, [0.175, 0.120, 0.085]],
  [-0.100, [0.220, 0.155, 0.105]],
  [-0.030, [0.300, 0.200, 0.120]],
  [ 0.000, [0.310, 0.205, 0.125]],
  [ 0.040, [0.420, 0.300, 0.155]],
  [ 0.140, [0.380, 0.260, 0.130]],
  [ 0.165, [0.320, 0.200, 0.105]],
  [ 0.182, [0.400, 0.370, 0.330]],
  [ 0.200, [0.950, 0.910, 0.820]],
];
const PALETTE_ALIEN_WET = [
  [-0.200, [0.060, 0.040, 0.090]],
  [-0.180, [0.090, 0.050, 0.120]],
  [-0.130, [0.120, 0.060, 0.150]],
  [-0.100, [0.160, 0.080, 0.190]],
  [-0.030, [0.220, 0.100, 0.240]],
  [ 0.000, [0.200, 0.120, 0.260]],
  [ 0.040, [0.050, 0.280, 0.220]],
  [ 0.140, [0.040, 0.420, 0.320]],
  [ 0.165, [0.280, 0.200, 0.120]],
  [ 0.182, [0.400, 0.350, 0.420]],
  [ 0.200, [0.880, 0.720, 0.980]],
];
const PALETTE_ALIEN_DRY = [
  [-0.200, [0.090, 0.050, 0.100]],
  [-0.180, [0.120, 0.065, 0.130]],
  [-0.130, [0.160, 0.080, 0.165]],
  [-0.100, [0.200, 0.100, 0.200]],
  [-0.030, [0.260, 0.130, 0.220]],
  [ 0.000, [0.270, 0.135, 0.225]],
  [ 0.040, [0.320, 0.180, 0.260]],
  [ 0.140, [0.280, 0.150, 0.240]],
  [ 0.165, [0.240, 0.120, 0.200]],
  [ 0.182, [0.380, 0.340, 0.400]],
  [ 0.200, [0.820, 0.760, 0.900]],
];
const PALETTE_VOLCANIC_WET = [
  [-0.200, [0.030, 0.028, 0.030]],
  [-0.180, [0.050, 0.035, 0.032]],
  [-0.130, [0.080, 0.050, 0.040]],
  [-0.100, [0.120, 0.065, 0.045]],
  [-0.030, [0.180, 0.090, 0.050]],
  [ 0.000, [0.200, 0.100, 0.055]],
  [ 0.040, [0.080, 0.140, 0.055]],
  [ 0.140, [0.060, 0.110, 0.045]],
  [ 0.165, [0.220, 0.090, 0.040]],
  [ 0.182, [0.320, 0.280, 0.260]],
  [ 0.200, [0.950, 0.880, 0.820]],
];
const PALETTE_VOLCANIC_DRY = [
  [-0.200, [0.050, 0.035, 0.030]],
  [-0.180, [0.080, 0.050, 0.038]],
  [-0.130, [0.120, 0.070, 0.048]],
  [-0.100, [0.160, 0.090, 0.055]],
  [-0.030, [0.220, 0.120, 0.070]],
  [ 0.000, [0.230, 0.125, 0.072]],
  [ 0.040, [0.380, 0.200, 0.090]],
  [ 0.140, [0.340, 0.160, 0.080]],
  [ 0.165, [0.280, 0.120, 0.065]],
  [ 0.182, [0.350, 0.320, 0.300]],
  [ 0.200, [0.920, 0.860, 0.780]],
];
const PALETTE_TWILIGHT_WET = [
  [-0.200, [0.055, 0.045, 0.070]],
  [-0.180, [0.075, 0.055, 0.090]],
  [-0.130, [0.100, 0.070, 0.115]],
  [-0.100, [0.130, 0.090, 0.145]],
  [-0.030, [0.180, 0.120, 0.175]],
  [ 0.000, [0.200, 0.130, 0.190]],
  [ 0.040, [0.090, 0.200, 0.150]],
  [ 0.140, [0.060, 0.160, 0.120]],
  [ 0.165, [0.220, 0.150, 0.140]],
  [ 0.182, [0.380, 0.340, 0.360]],
  [ 0.200, [0.920, 0.880, 0.900]],
];
const PALETTE_TWILIGHT_DRY = [
  [-0.200, [0.080, 0.055, 0.090]],
  [-0.180, [0.110, 0.075, 0.115]],
  [-0.130, [0.145, 0.100, 0.145]],
  [-0.100, [0.180, 0.125, 0.175]],
  [-0.030, [0.240, 0.165, 0.210]],
  [ 0.000, [0.250, 0.170, 0.215]],
  [ 0.040, [0.300, 0.200, 0.240]],
  [ 0.140, [0.260, 0.175, 0.210]],
  [ 0.165, [0.220, 0.150, 0.185]],
  [ 0.182, [0.360, 0.320, 0.350]],
  [ 0.200, [0.880, 0.820, 0.860]],
];

const TERRAIN_PAINTS = {
  earth: {
    wet: PALETTE_WET,
    dry: PALETTE_DRY,
    waterDeep: [0.06, 0.46, 0.56],
    waterAqua: [0.20, 0.78, 0.76],
    waterSand: [0.84, 0.75, 0.50],
    landSand: [0.87, 0.78, 0.55],
    atmoWater: 0x44aaff,
    atmoLava: 0xff3c1a,
  },
  frost: {
    wet: PALETTE_FROST_WET,
    dry: PALETTE_FROST_DRY,
    waterDeep: [0.02, 0.12, 0.28],
    waterAqua: [0.15, 0.55, 0.72],
    waterSand: [0.70, 0.82, 0.88],
    landSand: [0.78, 0.88, 0.92],
    atmoWater: 0x66c8ff,
    atmoLava: 0xff5522,
  },
  desert: {
    wet: PALETTE_DESERT_WET,
    dry: PALETTE_DESERT_DRY,
    waterDeep: [0.08, 0.22, 0.20],
    waterAqua: [0.22, 0.48, 0.42],
    waterSand: [0.72, 0.62, 0.38],
    landSand: [0.82, 0.70, 0.42],
    atmoWater: 0x88c4aa,
    atmoLava: 0xff4400,
  },
  alien: {
    wet: PALETTE_ALIEN_WET,
    dry: PALETTE_ALIEN_DRY,
    waterDeep: [0.05, 0.15, 0.35],
    waterAqua: [0.25, 0.85, 0.75],
    waterSand: [0.55, 0.35, 0.85],
    landSand: [0.65, 0.45, 0.90],
    atmoWater: 0x9933ff,
    atmoLava: 0xff00aa,
  },
  volcanic: {
    wet: PALETTE_VOLCANIC_WET,
    dry: PALETTE_VOLCANIC_DRY,
    waterDeep: [0.12, 0.04, 0.03],
    waterAqua: [0.45, 0.12, 0.06],
    waterSand: [0.35, 0.22, 0.12],
    landSand: [0.42, 0.28, 0.14],
    atmoWater: 0x4488aa,
    atmoLava: 0xff2200,
  },
  twilight: {
    wet: PALETTE_TWILIGHT_WET,
    dry: PALETTE_TWILIGHT_DRY,
    waterDeep: [0.08, 0.05, 0.22],
    waterAqua: [0.28, 0.18, 0.55],
    waterSand: [0.55, 0.38, 0.62],
    landSand: [0.62, 0.48, 0.68],
    atmoWater: 0xc94dff,
    atmoLava: 0xff3366,
  },
};

const TERRAIN_STYLE_STORAGE_KEY = 'astrabound-planet-terrain-style';
const DEFAULT_TERRAIN_STYLE = 'earth';
const TERRAIN_STYLE_OPTIONS = [
  { id: 'earth', label: 'Earth' },
  { id: 'frost', label: 'Ice' },
  { id: 'desert', label: 'Desert' },
  { id: 'alien', label: 'Alien' },
  { id: 'volcanic', label: 'Volcanic' },
  { id: 'twilight', label: 'Twilight' },
];

function normalizeTerrainStyle(id) {
  if (!id || !TERRAIN_PAINTS[id]) return DEFAULT_TERRAIN_STYLE;
  return id;
}

function getGlobalTerrainStyle() {
  try {
    return normalizeTerrainStyle(localStorage.getItem(TERRAIN_STYLE_STORAGE_KEY));
  } catch (e) {
    return DEFAULT_TERRAIN_STYLE;
  }
}

function setGlobalTerrainStyle(id) {
  const n = normalizeTerrainStyle(id);
  try {
    localStorage.setItem(TERRAIN_STYLE_STORAGE_KEY, n);
  } catch (e) { /* ignore quota / private mode */ }
  return n;
}

function colorizeGlobe(geo, baseR, ps, wl, planetSeed, terrainStyle) {
  // ps = peakScale, wl = waterLevel — explicit per-planet, not global
  planetSeed = planetSeed == null ? 0 : planetSeed;
  ps = Math.max(ps, 0.001);
  const paint = TERRAIN_PAINTS[normalizeTerrainStyle(terrainStyle)];
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const faceCount = pos.count / 3;
  const liquid = getLiquidState(wl, baseR);
  const hasWater = liquid.hasWater;
  const hasLava = liquid.hasLava;
  const hasLiquid = liquid.hasLiquid;
  const liquidStrength = liquid.strength;
  const liquidR = liquid.liquidR;
  const liquidEps = hasLiquid ? liquidR * 0.0018 : 0;
  const lavaGlowInnerPos = [];
  const lavaGlowInnerCol = [];
  const lavaGlowOuterPos = [];
  const lavaGlowOuterCol = [];
  const WATER_DEEP = paint.waterDeep;
  const WATER_AQUA = paint.waterAqua;
  const WATER_SAND = paint.waterSand;
  const LAND_SAND = paint.landSand;
  const LAVA_BLACK = [0.08, 0.08, 0.09];
  const LAVA_RED_HOT = [0.96, 0.14, 0.05];
  const LAVA_RED_MID = [0.78, 0.09, 0.04];
  const LAVA_RED_DEEP = [0.42, 0.05, 0.03];
  const LAVA_CRUST_DARK = [0.048, 0.038, 0.037];
  const LAVA_YELLOW = [1.00, 0.88, 0.18];
  const shoreBand = Math.max(baseR * 0.055, liquidEps * 10);
  const landShoreBand = shoreBand * 1.55;
  const lavaBand = shoreBand * 1.08;
  // Lava crust patches: angular scale from radius; strength grows with slider (bigger lava seas).
  const lavaCrustSeed = planetSeed * 0.314 + 7.11;
  const lavaPatchFreq = 3.9 / Math.max(baseR, 0.11);
  const lavaSpotStrength = 0.50 + Math.min(liquidStrength / 0.28, 1) * 0.75;

  function mix3(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    return [
      a[0] + (b[0] - a[0]) * k,
      a[1] + (b[1] - a[1]) * k,
      a[2] + (b[2] - a[2]) * k
    ];
  }

  // Blend palette: green fades in as water amount rises on the + side.
  const wet = hasWater ? Math.min(Math.max(liquidStrength / 0.20, 0), 1) : 0;
  const pal = blendPaletteNamed(wet, paint.dry, paint.wet);

  // Pass 1: find terrain (non-liquid) elevation range for palette stretching
  let minNe = Infinity, maxNe = -Infinity;
  for (let f = 0; f < faceCount; f++) {
    let sumE = 0;
    let liquidVerts = 0;
    for (let v = 0; v < 3; v++) {
      const i = f*3+v, x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const rr = Math.sqrt(x*x + y*y + z*z);
      sumE += rr;
      if (rr <= liquidR + liquidEps) liquidVerts++;
    }
    if (liquidVerts > 0) continue;
    const ne = (sumE / 3 / baseR - 1) / ps;
    if (ne < minNe) minNe = ne;
    if (ne > maxNe) maxNe = ne;
  }
  if (!Number.isFinite(minNe) || !Number.isFinite(maxNe)) {
    minNe = -0.2;
    maxNe = 0.2;
  }
  const pMin = pal[0][0], pMax = pal[pal.length-1][0];
  const negScale = minNe < 0 ? pMin / minNe : 1;
  const posScale = maxNe > 0 ? pMax / maxNe : 1;

  // Pass 2: colorize terrain and liquid polygons on this same mesh
  for (let f = 0; f < faceCount; f++) {
    let sumE = 0;
    let liquidVerts = 0;
    const faceR = [0, 0, 0];
    const faceIdx = [0, 0, 0];
    for (let v = 0; v < 3; v++) {
      const i = f*3+v, x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const rr = Math.sqrt(x*x + y*y + z*z);
      sumE += rr;
      faceR[v] = rr;
      faceIdx[v] = i;
      if (rr <= liquidR + liquidEps) liquidVerts++;
    }
    const isLiquidFace = liquidVerts > 0;
    const ne     = (sumE / 3 / baseR - 1) / ps;
    const mapped = ne < 0 ? ne * negScale : ne * posScale;
    let r, g, b;
    if (isLiquidFace && hasWater) {
      // Ocean-side teal, mid-shore aqua, and land-edge sand gradient.
      for (let v = 0; v < 3; v++) {
        const i = faceIdx[v];
        const rr = faceR[v];
        const shoreT = Math.max(0, Math.min(1, (rr - liquidR) / shoreBand));
        const c = shoreT < 0.58
          ? mix3(WATER_DEEP, WATER_AQUA, shoreT / 0.58)
          : mix3(WATER_AQUA, WATER_SAND, (shoreT - 0.58) / 0.42);
        col[i*3] = c[0];
        col[i*3+1] = c[1];
        col[i*3+2] = c[2];
      }
      continue;
    } else if (isLiquidFace && hasLava) {
      // Face-centered crust noise: per-vertex noise on huge low-LOD triangles looked glitchy / sparkly from far away.
      let fnx = 0, fny = 0, fnz = 0, avgShoreT = 0;
      for (let v = 0; v < 3; v++) {
        const ii = faceIdx[v];
        const rrv = faceR[v];
        const px = pos.getX(ii), py = pos.getY(ii), pz = pos.getZ(ii);
        const invR = rrv > 1e-8 ? 1 / rrv : 1;
        fnx += px * invR;
        fny += py * invR;
        fnz += pz * invR;
        const st = Math.max(0, Math.min(1, (rrv - liquidR) / lavaBand));
        avgShoreT += st;
      }
      const fl = Math.hypot(fnx, fny, fnz);
      const finv = fl > 1e-8 ? 1 / fl : 1;
      fnx *= finv;
      fny *= finv;
      fnz *= finv;
      avgShoreT /= 3;
      const fWide = lavaPatchFreq * (0.78 + liquidStrength * 0.28);
      const fTight = fWide * 2.9;
      const nWide = noise3(
        fnx * fWide + lavaCrustSeed,
        fny * fWide + lavaCrustSeed * 1.07,
        fnz * fWide + lavaCrustSeed * 0.93
      );
      const nTight = noise3(
        fnx * fTight + lavaCrustSeed + 2.1,
        fny * fTight + lavaCrustSeed - 1.4,
        fnz * fTight + lavaCrustSeed + 0.55
      );
      const nBlend = nWide * 0.68 + nTight * 0.32;
      const spotMask = Math.max(0, Math.min(1, (-0.12 - nBlend) / 0.50));
      const spotShape = Math.pow(spotMask, 1.22);
      const inDeepLava = Math.pow(1 - avgShoreT, 0.72 + liquidStrength * 0.28);
      const spotAmtFace = Math.min(1, spotShape * inDeepLava * lavaSpotStrength * 0.82);

      // Lava: yellow core -> hot red -> deep red -> dark crust (extra red in the mid bands).
      for (let v = 0; v < 3; v++) {
        const i = faceIdx[v];
        const rr = faceR[v];
        const shoreT = Math.max(0, Math.min(1, (rr - liquidR) / lavaBand));
        let c;
        if (shoreT < 0.36) {
          c = mix3(LAVA_YELLOW, LAVA_RED_HOT, shoreT / 0.36);
        } else if (shoreT < 0.70) {
          c = mix3(LAVA_RED_HOT, LAVA_RED_MID, (shoreT - 0.36) / 0.34);
        } else {
          c = mix3(LAVA_RED_MID, LAVA_BLACK, (shoreT - 0.70) / 0.30);
        }

        c = mix3(c, LAVA_CRUST_DARK, spotAmtFace);
        c = mix3(c, LAVA_RED_DEEP, spotAmtFace * 0.36);

        col[i*3] = c[0];
        col[i*3+1] = c[1];
        col[i*3+2] = c[2];

        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        // Double additive red polygon shells: inner crimson sheet + outer hot rim.
        const glowDim = 1 - spotAmtFace * 0.78;
        const innerGlow = mix3(
          [0.30, 0.03, 0.02],
          [0.98, 0.16, 0.07],
          Math.pow(1 - shoreT, 0.62)
        );
        const outerGlow = mix3(
          [0.48, 0.05, 0.03],
          [1.0, 0.42, 0.12],
          Math.pow(1 - shoreT, 0.88)
        );
        lavaGlowInnerPos.push(px, py, pz);
        lavaGlowInnerCol.push(innerGlow[0] * glowDim, innerGlow[1] * glowDim, innerGlow[2] * glowDim);
        lavaGlowOuterPos.push(px, py, pz);
        lavaGlowOuterCol.push(outerGlow[0] * glowDim, outerGlow[1] * glowDim, outerGlow[2] * glowDim);
      }
      continue;
    } else {
      [r,g,b] = elevColor(mapped, pal);
      if (hasWater) {
        // Land-facing shoreline tint: blend terrain into sand near sea level.
        for (let v = 0; v < 3; v++) {
          const i = faceIdx[v];
          const rr = faceR[v];
          const edgeT = Math.max(0, Math.min(1, (rr - liquidR) / landShoreBand));
          const sandBlend = Math.pow(1 - edgeT, 1.18) * 0.92;
          const c = mix3([r, g, b], LAND_SAND, sandBlend);
          col[i*3] = c[0];
          col[i*3+1] = c[1];
          col[i*3+2] = c[2];
        }
        continue;
      }
    }
    for (let v = 0; v < 3; v++) {
      col[(f*3+v)*3]=r; col[(f*3+v)*3+1]=g; col[(f*3+v)*3+2]=b;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Radial shell for glow meshes: must be large enough in world units to avoid z-fighting
  // the terrain at medium camera distance (camera far plane is very large).
  const lavaGlowShell = 0.0015 + Math.min(0.007, baseR * 0.0025);
  const lavaGlowOuterMul = 2.08;
  return {
    lavaGlow: lavaGlowInnerPos.length > 0 ? [
      { positions: lavaGlowInnerPos, colors: lavaGlowInnerCol, scale: 1 + lavaGlowShell, opacity: 0.46 },
      {
        positions: lavaGlowOuterPos,
        colors: lavaGlowOuterCol,
        scale: 1 + lavaGlowShell * lavaGlowOuterMul,
        opacity: 0.34
      }
    ] : null
  };
}

/**
 * Terrain uses non-indexed triangles (for per-face vertex colors). Default face normals plus
 * flat shading make each facet a single Lambert shade, so a moving point light looks like it
 * only "hits" polygon edges. Merge normals at identical positions for smooth falloff.
 */
function applySmoothVertexNormalsForNonIndexedTerrain(geo) {
  const pos = geo.attributes.position;
  if (!pos || pos.count < 3) return;
  const triCount = Math.floor(pos.count / 3);
  const bucket = new Map();
  const p0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const fn = new THREE.Vector3();

  for (let f = 0; f < triCount; f++) {
    const i0 = f * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    p0.fromBufferAttribute(pos, i0);
    v1.fromBufferAttribute(pos, i1);
    v2.fromBufferAttribute(pos, i2);
    e1.subVectors(v1, p0);
    e2.subVectors(v2, p0);
    fn.crossVectors(e1, e2);
    if (fn.lengthSq() < 1e-22) continue;
    fn.normalize();
    for (const vi of [i0, i1, i2]) {
      const k = `${pos.getX(vi)},${pos.getY(vi)},${pos.getZ(vi)}`;
      let a = bucket.get(k);
      if (!a) {
        a = [0, 0, 0];
        bucket.set(k, a);
      }
      a[0] += fn.x;
      a[1] += fn.y;
      a[2] += fn.z;
    }
  }

  const nArr = new Float32Array(pos.count * 3);
  for (let f = 0; f < triCount; f++) {
    for (let k = 0; k < 3; k++) {
      const vi = f * 3 + k;
      const key = `${pos.getX(vi)},${pos.getY(vi)},${pos.getZ(vi)}`;
      const a = bucket.get(key);
      const len = Math.hypot(a[0], a[1], a[2]) || 1;
      const inv = 1 / len;
      nArr[vi * 3] = a[0] * inv;
      nArr[vi * 3 + 1] = a[1] * inv;
      nArr[vi * 3 + 2] = a[2] * inv;
    }
  }
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nArr, 3));
}

// ── Planet factory ────────────────────────────────────────────────
function createPlanet(baseR, detailInit, seed, axisTilt, initState) {
  const pivot = new THREE.Group();
  const spin  = new THREE.Group();
  spin.rotation.z = axisTilt;
  pivot.add(spin);
  let built = [], pickables = [], vegMeshes = [];

  // Per-planet state — independent of any global
  const state = Object.assign(
    {
      peakScale: 1.0,
      waterLevel: 0.48,
      size: 1.0,
      terrainStyle: getGlobalTerrainStyle(),
      geographyStyle: getGlobalGeographyStyle(),
      planetSeed: seed,
      axisTilt: axisTilt,
    },
    initState || {}
  );
  state.terrainStyle = normalizeTerrainStyle(state.terrainStyle);
  state.geographyStyle = normalizeGeographyStyle(state.geographyStyle);
  state.planetSeed = Number.isFinite(Number(state.planetSeed)) ? Number(state.planetSeed) : seed;
  state.axisTilt = Number.isFinite(Number(state.axisTilt)) ? Number(state.axisTilt) : axisTilt;
  spin.rotation.z = state.axisTilt;

  let lastBuiltSz = Math.max(state.size ?? 1, 0.05);

  function build(d, opts) {
    const skipVeg = opts?.skipVeg ?? false;
    if (!skipVeg && typeof VEG !== 'undefined') { VEG.clearVegetation(spin, vegMeshes); vegMeshes = []; }
    built.forEach(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
      spin.remove(c);
    });
    built = [];

    const ps = state.peakScale, wl = state.waterLevel;
    // World shell lives in spin-local space at full radius (no pivot scale) so facet size
    // tracks LOD only — avoids stretching the same mesh with pivot.scale = size.
    const sz = Math.max(state.size ?? 1, 0.05);
    lastBuiltSz = sz;
    const shellR = baseR * sz;
    const liquidState = getLiquidState(wl, shellR);
    // Keep lava readable at long camera ranges by not dropping to ultra-low geometry detail.
    const buildDetail = liquidState.hasLava ? Math.max(4, d) : d;

    const psd = state.planetSeed;
    const idxGeo  = buildGlobe(shellR, buildDetail, psd, ps, wl, state.geographyStyle);
    const flatGeo = idxGeo.toNonIndexed();
    const colorMeta = colorizeGlobe(flatGeo, shellR, ps, wl, psd, state.terrainStyle);
    applySmoothVertexNormalsForNonIndexedTerrain(flatGeo);

    // Depth pre-pass: back-faces seal silhouette and stabilize rendering.
    const depthBack = new THREE.Mesh(flatGeo,
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.BackSide })
    );
    depthBack.renderOrder = 0;

    // MeshLambert computes direct lights per *vertex* (vLightFront); interpolating that
    // across large triangles is wrong for a nearby point light — face centers look dark.
    // MeshStandard evaluates punctual lights per fragment (roughness 1 ≈ matte).
    const terrain = new THREE.Mesh(flatGeo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: false,
      roughness: 1,
      metalness: 0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    terrain.renderOrder = 0;
    const lavaGlowMeshes = (() => {
      if (!colorMeta?.lavaGlow) return null;
      const layers = Array.isArray(colorMeta.lavaGlow) ? colorMeta.lavaGlow : [colorMeta.lavaGlow];
      return layers.map((layer, li) => {
        const glowGeo = new THREE.BufferGeometry();
        glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(layer.positions, 3));
        glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(layer.colors, 3));
        const glowMat = new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: layer.opacity != null ? layer.opacity : 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -5 - li * 3,
          polygonOffsetUnits: -5 - li * 3
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);
        glowGeo.computeBoundingSphere();
        glowMesh.scale.setScalar(layer.scale != null ? layer.scale : 1.0032);
        glowMesh.frustumCulled = false;
        glowMesh.renderOrder = 1 + li * 0.02;
        return glowMesh;
      });
    })();

    const _tp = TERRAIN_PAINTS[state.terrainStyle] || TERRAIN_PAINTS.earth;
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(shellR * 1.10, 24, 24),
      new THREE.MeshBasicMaterial({
        color: liquidState.hasLava ? _tp.atmoLava : _tp.atmoWater,
        transparent: true,
        opacity: liquidState.hasLava ? (0.05 + liquidState.strength * 0.09) : 0.06,
        side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    atmo.renderOrder = 3;

    built = [depthBack, terrain];
    if (lavaGlowMeshes) lavaGlowMeshes.forEach(m => built.push(m));
    built.push(atmo);
    pickables = [terrain];
    spin.add(...built);
    if (!skipVeg && typeof VEG !== 'undefined') {
      vegMeshes = VEG.spawnVegetationOnPlanet(spin, flatGeo, shellR, state.peakScale, state.waterLevel, psd, 1);
    }
  }

  build(detailInit);
  return {
    pivot, spin, state,
    baseRadius: baseR,
    rebuild:  build,
    setWater: () => {},
    getTerrainMesh: () => pickables[0] || null,
    getPickables: () => pickables,
    setVegVisible: v => { vegMeshes.forEach(m => { m.visible = v; }); },
    // Scale spin uniformly during drag — no geometry rebuild, snaps to 1 on full rebuild.
    setScalePreview: (newSize) => { spin.scale.setScalar(Math.max(newSize, 0.05) / lastBuiltSz); },
    clearScalePreview: () => { spin.scale.setScalar(1); },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SOL SYSTEM PLANETS (read this before changing terrain / “polygon size” behavior)
//
// • The two bodies you see orbiting each other at Sol are `p1` and `p2` below.
//   They are THREE groups (`p1.pivot` / `p2.pivot`) parented under `sysGroup`
//   (binary COM), which itself orbits the sun. Same objects appear as
//   `managedPlanets[0].obj` and `managedPlanets[1].obj` (see registerPlanet in
//   20-planet-management.js).
//
// • Terrain = displaced icosphere from createPlanet → buildGlobe (noise moves
//   vertices along the radius). Geography presets replace the height recipe via
//   globeTerrainDisplacement (not the same classic noise with a tiny offset).
//   For *resizing* the planet, icosahedron detail is chosen so subdivisions track
//   shell radius (~constant mean edge length in world units; triangle count grows
//   with area). See terrainDetailForManagedPlanet.
//
// • “SCALE” on the HUD (curScale / targetScale) moves the *camera orbit radius*
//   (see updateCamera in 00-core-camera-walk.js); it does not resize planet
//   meshes. Per-planet size is `state.size` in the planet editor.
//
// • Other star systems on the galaxy map use small decorative meshes in
//   40-galaxy.js (IcosahedronGeometry) — not the same code path as Sol’s p1/p2.
// ═══════════════════════════════════════════════════════════════════════════

// ── System group: binary COM sits here, planets are children ──────
const sysGroup = new THREE.Group();
scene.add(sysGroup);

// Same baseRadius so the starting pair share the same LOD-vs-radius curve.
var p1 = createPlanet(1.00, 7, 0.00,  0.22);
var p2 = createPlanet(1.00, 7, 5.37, -0.38);
sysGroup.add(p1.pivot, p2.pivot);

// ── Orbit trails (in sysGroup local space = binary-relative) ──────
const TRAIL_LEN = 520;
function makeTrail(opts) {
  const cfg = Object.assign({ len: TRAIL_LEN, color: 0xffffff, opacity: 0.60 }, opts || {});
  const positions = new Float32Array(cfg.len * 3);
  const colors    = new Float32Array(cfg.len * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo,
    new THREE.LineBasicMaterial({
      color: cfg.color,
      vertexColors: true,
      transparent: true,
      opacity: cfg.opacity
    })
  );
  line.renderOrder = 0;
  scene.add(line);
  return { positions, colors, line, count: 0, max: cfg.len };
}
function pushTrail(t, x, y, z) {
  const { positions: p, colors: c } = t;
  const N = t.max || TRAIL_LEN;
  if (t.count < N) {
    // Trail still filling — append point and recompute gradient (n changes each frame).
    p[t.count*3]=x; p[t.count*3+1]=y; p[t.count*3+2]=z;
    t.count++;
    const n = t.count;
    for (let i = 0; i < n; i++) {
      const v = n < 2 ? 1 : i / (n - 1);
      c[i*3]=v; c[i*3+1]=v; c[i*3+2]=v;
    }
    t.line.geometry.attributes.color.needsUpdate = true;
  } else {
    // Trail is full — shift positions only. Colors are always the same fixed linear
    // gradient [0, 1/(N-1), ..., 1] so they never need updating once the trail is full.
    p.copyWithin(0, 3);
    p[(N-1)*3]=x; p[(N-1)*3+1]=y; p[(N-1)*3+2]=z;
  }
  t.line.geometry.setDrawRange(0, t.count);
  t.line.geometry.attributes.position.needsUpdate = true;
}
const trail1 = makeTrail(), trail2 = makeTrail();

// Gravity link thread between the two planets
const linkPos = new Float32Array(6);
const linkGeo = new THREE.BufferGeometry();
linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
const linkLine = new THREE.Line(linkGeo,
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, depthTest: false })
);
scene.add(linkLine);

// ── Binary planet physics (positions relative to binary COM) ──────
// G=1, M1=3, M2=1.5, sep=3.5, T_binary ≈ 19 sim-s at 1× warp
const G=1, BASE_M1=3, BASE_M2=1.5, SEP=3.5, BASE_MT=BASE_M1+BASE_M2;
const SOLAR_MU = 4.6;
const SUN_ORBIT_MIN_R = 4.2;
const SUN_ORBIT_MAX_R = 48.0;
const ORBIT_SOFTENING = 0.06;
const MAX_BOUND_SPEED_FACTOR = 0.95;
const body = [
  { pos: new THREE.Vector3(-(BASE_M2/BASE_MT)*SEP, 0, 0), vel: new THREE.Vector3() },
  { pos: new THREE.Vector3( (BASE_M1/BASE_MT)*SEP, 0, 0), vel: new THREE.Vector3() },
];
let binaryPhase = 0;
let binaryPrevMass1 = BASE_M1;
let binaryPrevMass2 = BASE_M2;

function applyBinaryPairState(m1, m2, phaseAdvance = 0) {
  const mt = Math.max(m1 + m2, 1e-6);
  const omega = Math.sqrt(G * mt / Math.pow(SEP, 3));
  binaryPhase += phaseAdvance * omega;
  const c = Math.cos(binaryPhase);
  const s = Math.sin(binaryPhase);
  const tx = -s;
  const tz = c;
  const r1 = (m2 / mt) * SEP;
  const r2 = (m1 / mt) * SEP;
  body[0].pos.set(-c * r1, 0, -s * r1);
  body[1].pos.set( c * r2, 0,  s * r2);
  body[0].vel.set(tx * -r1 * omega, 0, tz * -r1 * omega);
  body[1].vel.set(tx *  r2 * omega, 0, tz *  r2 * omega);
}

function refreshBinaryPairForMassChange(m1, m2) {
  const dx = body[1].pos.x - body[0].pos.x;
  const dz = body[1].pos.z - body[0].pos.z;
  if (dx*dx + dz*dz > 1e-10) binaryPhase = Math.atan2(dz, dx);
  applyBinaryPairState(m1, m2, 0);
}

applyBinaryPairState(BASE_M1, BASE_M2, 0);

// ── Binary COM orbit around sun ───────────────────────────────────
// The binary system as a whole orbits the sun (at origin).
// SUN_ORBIT: orbit radius in physics units.
// COM_OMEGA: angular velocity, rad/sim-s → period ≈ 126 sim-s (≈6.5× binary period).
const SUN_ORBIT = 20;
const COM_OMEGA = 0.012;
let comAngle = 0;

// ── Dial wiring ───────────────────────────────────────────────────
const SCALE_MIN = 1.0, SCALE_MAX = 400;
const SCALE_BASE_MULT = 3.0; // User request: legacy 3x should read as new 1x.
const SCALE_LOG = Math.log(SCALE_MAX / SCALE_MIN);
// Legacy zoom tier for `curDetail` (new planets' first build hint); terrain subdivisions use shell radius.
const PLANET_DETAIL_ZERO_UI = 15.0;
const PLANET_VIEW_DETAIL_CAP = 7;
function scaleUiToWorld(s) { return s * SCALE_BASE_MULT; }
function scaleWorldToUi(s) { return s / SCALE_BASE_MULT; }
function sliderToScale(v) { return scaleUiToWorld(SCALE_MIN * Math.exp(SCALE_LOG * v)); }
function scaleToDetail(worldScale) {
  const s = scaleWorldToUi(worldScale);
  // User tuning: tier steps vs solar zoom (see updateDynamicCameraFar). Not used for terrain facet LOD anymore.
  if (s >= PLANET_DETAIL_ZERO_UI) return 0;
  if (s >= 10.0) return 1;
  if (s >= 8.0)  return 2;
  if (s >= 6.0)  return 3;
  if (s >= 4.8)  return 4;
  if (s >= 3.6)  return 5;
  if (s >= 2.8)  return 6;
  if (s >= 2.1)  return 7;
  if (s >= 1.6)  return 8;
  if (s >= 1.2)  return 9;
  return 10;
}

let targetScale = scaleUiToWorld(1.0), curScale = scaleUiToWorld(1.0), timeWarp = 1.0, curDetail = scaleToDetail(scaleUiToWorld(1.0));
let sunSpin = 0;
let planetsRenderable = true;

const $ = id => document.getElementById(id);
const TIME_WARP_UI_MAX = 200;
const dialScale = $('dial-scale'), lblScale = $('lbl-scale');
const dialWarp  = $('dial-warp'),  lblWarp  = $('lbl-warp');
if (dialWarp) dialWarp.max = String(TIME_WARP_UI_MAX);

function scaleLabelText(s) {
  return `SCALE  ${scaleWorldToUi(s).toFixed(2)}×`;
}

function desiredDetailForCurrentView(scaleValue) {
  return cameraMode === 'planet' ? PLANET_VIEW_DETAIL_CAP : scaleToDetail(scaleValue);
}

/** Three.js icosahedron subdivisions get very heavy past ~10; caps GPU cost. */
const PLANET_MESH_DETAIL_HARD_MAX = 10;
const PLANET_MESH_DETAIL_MIN = 4;
/**
 * Icosahedron detail tracks world shell radius R = baseRadius x size. Integer
 * subdivision can only step in powers of two in R for a fixed d, so we apply an
 * extra log2 scale (>1) to bump LOD more often — facets swing less on the size dial.
 * Camera planet view also scales with shell radius (see planetViewShellRadiusWorld).
 */
const PLANET_MESH_LOD_LOG2_SCALE = 2;
const PLANET_MESH_REF_SHELL_R = 1.0;
const PLANET_MESH_REF_DETAIL = 7;
// Low-res only while dragging peak/water on the radial ring (not size / not HTML dials).
const DRAG_PREVIEW_DETAIL = 6;

/** World radius of the scaled body (geometry base x pivot size). */
function getPlanetWorldShellRadius(mp) {
  if (!mp?.obj) return 0.8;
  return (mp.obj.baseRadius || 0.8) * Math.max(mp.obj.state?.size ?? 1, 0.05);
}

function terrainDetailForManagedPlanet(mp) {
  const R = getPlanetWorldShellRadius(mp);
  const idealD = PLANET_MESH_REF_DETAIL
    + PLANET_MESH_LOD_LOG2_SCALE * Math.log2(Math.max(R, 1e-6) / PLANET_MESH_REF_SHELL_R);
  const d = Math.ceil(idealD - 1e-9);
  return Math.max(PLANET_MESH_DETAIL_MIN, Math.min(PLANET_MESH_DETAIL_HARD_MAX, d));
}

function rebuildManagedPlanetTerrain(mp, maxDetail, skipVeg) {
  if (!mp?.obj?.rebuild) return;
  let d = terrainDetailForManagedPlanet(mp);
  if (maxDetail !== undefined) d = Math.min(d, maxDetail);
  if (d > 0) {
    mp.obj.rebuild(d, (maxDetail !== undefined || skipVeg) ? { skipVeg: true } : undefined);
  }
}

function rebuildAllManagedPlanetTerrainMeshes() {
  if (typeof managedPlanets === 'undefined' || !managedPlanets.length) return;
  for (let i = 0; i < managedPlanets.length; i++) {
    rebuildManagedPlanetTerrain(managedPlanets[i]);
  }
}

function applyDetailForCurrentView(scaleValue) {
  const cap = desiredDetailForCurrentView(scaleValue);
  if (cap === curDetail) return;
  curDetail = cap;
  // Terrain facet size follows shell radius only (terrainDetailForManagedPlanet), not zoom.
}

function setPlanetsRenderable(enabled) {
  if (planetsRenderable === enabled) return;
  planetsRenderable = enabled;
  managedPlanets.forEach(mp => {
    if (mp?.obj?.pivot) mp.obj.pivot.visible = enabled;
    if (mp?.trail?.line) mp.trail.line.visible = enabled && !isNavigating && currentDestIndex === 0;
  });
  if (typeof trail1 !== 'undefined' && trail1?.line) trail1.line.visible = enabled && !isNavigating && currentDestIndex === 0;
  if (typeof trail2 !== 'undefined' && trail2?.line) trail2.line.visible = enabled && !isNavigating && currentDestIndex === 0;
  if (typeof linkLine !== 'undefined' && linkLine) linkLine.visible = enabled && !isNavigating && currentDestIndex === 0;
  if (!enabled && walkMode.active) {
    stopWalkMode();
    updateWalkButtonVisibility();
  } else if (enabled && typeof syncTrailVisibility === 'function') {
    syncTrailVisibility();
  }
}

dialScale.addEventListener('input', () => {
  targetScale = sliderToScale(parseFloat(dialScale.value));
  lblScale.textContent = scaleLabelText(targetScale);
  applyDetailForCurrentView(targetScale);
  syncSunRadialReadouts();
});
lblScale.textContent = scaleLabelText(targetScale);
dialWarp.addEventListener('input', () => {
  timeWarp = parseFloat(dialWarp.value);
  lblWarp.textContent = timeWarp === 0 ? 'TIME WARP  PAUSED' : `TIME WARP  ${timeWarp.toFixed(2)}×`;
  syncSunRadialReadouts();
});
if (dialScale) dialScale.addEventListener('change', () => {
  if (typeof requestUniverseSave === 'function') requestUniverseSave();
});
if (dialWarp) dialWarp.addEventListener('change', () => {
  if (typeof requestUniverseSave === 'function') requestUniverseSave();
});

/** Matches initial HTML dial default (1×). Called when entering walk mode. */
function resetTimeWarpToDefaultForWalk() {
  timeWarp = 1;
  if (dialWarp) dialWarp.value = '1';
  if (lblWarp) {
    lblWarp.textContent = timeWarp === 0 ? 'TIME WARP  PAUSED' : `TIME WARP  ${timeWarp.toFixed(2)}×`;
  }
  if (typeof syncSunRadialReadouts === 'function') syncSunRadialReadouts();
  if (typeof updateSunRadialKnobPositions === 'function') updateSunRadialKnobPositions();
}

let sunRadialDismissed = true;
let solGalaxyMenuRevealed = false;
function scaleWorldToSliderValue(worldScale) {
  const ui = scaleWorldToUi(worldScale);
  const u = Math.max(SCALE_MIN, Math.min(SCALE_MAX, ui));
  return Math.log(u / SCALE_MIN) / SCALE_LOG;
}
const SUN_EDIT_CONFIG = {
  scale: { min: sliderToScale(0), max: sliderToScale(1), arcStart: 146, arcEnd: 266 },
  warp: { min: 0, max: TIME_WARP_UI_MAX, step: 0.1, arcStart: 302, arcEnd: 58 },
};

