// ── Planet management ─────────────────────────────────────────────
// managedPlanets mirrors the actual planet objects + metadata.
// Extra added planets use sun-centered orbit slots with orbital-clearance checks.
const PLANET_COLORS = ['#4a9eff','#ff6b35','#a8ff78','#ff78a8','#ffd700','#c0a0ff','#ff4444'];
const SOLAR_ORBIT_GRID_RADII = [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30, 34, 38, 42, 46];
const SOLAR_ORBIT_GRID_PHASE_COUNT = 12;
// Inclination (rad) of the orbital plane about +X: 0 = ecliptic (XZ); orbit always passes through the sun.
const SOLAR_ORBIT_INCLINATIONS = [0, 0.12, -0.12, 0.22, -0.22, 0.32, -0.32, 0.45, -0.45, 0.55, -0.55];
const SUN_ORBIT_SLIDER_R_MIN = 6;
const SUN_ORBIT_SLIDER_R_MAX = 46;
const SUN_ORBIT_TILT_DEG_MAX = 35;
const SUN_ORBIT_TILT_RAD_MAX = (SUN_ORBIT_TILT_DEG_MAX * Math.PI) / 180;
let managedPlanets = []; // { … orbitPos, orbitVel, orbitInclination, orbitPlaneNormal, orbitParentId, trail }
let selectedPlanetIdx = null;

function registerPlanet(obj, name, color, isBinary, orbitR, orbitSpeed, spinRateBase, spinAngle, orbitCenter, orbitSlotKey, orbitAngle, orbitParentId, orbitInclination) {
  managedPlanets.push({ id: managedPlanets.length, name, obj, color, isBinary,
                         orbitR: orbitR||0, orbitSpeed: orbitSpeed||0,
                         angle: orbitAngle ?? (Math.random() * Math.PI * 2),
                         spinRateBase: spinRateBase ?? 0.008, spinAngle: spinAngle ?? (Math.random() * Math.PI * 2),
                         orbitCenter: orbitCenter ?? (isBinary ? 'binary' : 'sun'),
                         orbitSlotKey: orbitSlotKey ?? null, orbitBaseR: orbitR || 0,
                         orbitPos: null, orbitVel: null,
                         orbitInclination: Number.isFinite(orbitInclination) ? orbitInclination : 0,
                         orbitPlaneNormal: null,
                         orbitParentId: orbitParentId ?? null });
}

// Register original binary planets
registerPlanet(p1, 'Planet 1', PLANET_COLORS[0], true, 0, 0, 0.006, 0, 'binary', null, 0, null, 0);
registerPlanet(p2, 'Planet 2', PLANET_COLORS[1], true, 0, 0, 0.009, 0, 'binary', null, 0, null, 0);

function getSpinRateFromSize(mp) {
  const size = Math.max(mp.obj.state.size, 0.1);
  // Approximation: angular velocity scales as 1 / R^2 for similar planets.
  const rawRate = mp.spinRateBase / (size * size);
  return Math.min(mp.spinRateBase * 4, Math.max(mp.spinRateBase * 0.25, rawRate));
}

function getPlanetMass(mp) {
  const size = Math.max(mp.obj.state.size, 0.2);
  const baseVolume = Math.pow(Math.max(mp.obj.baseRadius || 0.8, 0.2), 3);
  const density = mp.isBinary ? 3.5 : 1.6;
  return density * baseVolume * Math.pow(size, 3);
}

function getSunOrbitRadius(mp) {
  if (!mp) return 0;
  if (mp.orbitPos) {
    const d = mp.orbitPos.length();
    if (d > 1e-6) return d;
  }
  if (mp.orbitR > 0) return mp.orbitR;
  if (mp.orbitBaseR > 0) return mp.orbitBaseR;
  return 0;
}

function getSunOrbitInclination(mp) {
  if (!mp) return 0;
  return Number.isFinite(mp.orbitInclination) ? mp.orbitInclination : 0;
}

function getOrbitalClearance(mp) {
  const mass = Math.max(getPlanetMass(mp), 0.2);
  const size = Math.max((mp.obj.baseRadius || 0.8) * Math.max(mp.obj.state.size, 0.2), 0.2);
  return Math.max(1.6, size * 2.8, Math.cbrt(mass) * 1.35);
}

const _sunBoundRadial = new THREE.Vector3();
const _sunHelioRxv = new THREE.Vector3();
const SUN_COLLISION_PASSES = 3;

function applySunOrbiterBounds(mp) {
  if (!mp?.orbitPos || !mp?.orbitVel) return;
  let r = mp.orbitPos.length();
  if (r < 1e-8) return;
  _sunBoundRadial.copy(mp.orbitPos).multiplyScalar(1 / r);
  if (r < SUN_ORBIT_MIN_R) {
    mp.orbitPos.copy(_sunBoundRadial).multiplyScalar(SUN_ORBIT_MIN_R);
    const vr = mp.orbitVel.dot(_sunBoundRadial);
    if (vr < 0) mp.orbitVel.addScaledVector(_sunBoundRadial, -vr);
    r = SUN_ORBIT_MIN_R;
  } else if (r > SUN_ORBIT_MAX_R) {
    mp.orbitPos.copy(_sunBoundRadial).multiplyScalar(SUN_ORBIT_MAX_R);
    const vr = mp.orbitVel.dot(_sunBoundRadial);
    if (vr > 0) mp.orbitVel.addScaledVector(_sunBoundRadial, -vr);
    const esc = Math.sqrt(2 * SOLAR_MU / SUN_ORBIT_MAX_R) * MAX_BOUND_SPEED_FACTOR;
    const speed = mp.orbitVel.length();
    if (speed > esc) mp.orbitVel.multiplyScalar(esc / speed);
  }
}

function enforceSunOrbiterNoOverlap(sunOrbiters) {
  if (!sunOrbiters || sunOrbiters.length < 2) return;
  const twoPi = Math.PI * 2;
  for (let pass = 0; pass < SUN_COLLISION_PASSES; pass++) {
    for (let i = 0; i < sunOrbiters.length; i++) {
      const a = sunOrbiters[i];
      if (!a?.orbitPos || !a?.orbitVel) continue;
      for (let j = i + 1; j < sunOrbiters.length; j++) {
        const b = sunOrbiters[j];
        if (!b?.orbitPos || !b?.orbitVel) continue;

        const ra = Math.max((a.obj.baseRadius || 0.8) * Math.max(a.obj.state.size, 0.2), 0.2);
        const rb = Math.max((b.obj.baseRadius || 0.8) * Math.max(b.obj.state.size, 0.2), 0.2);
        const hardBodySep = (ra + rb) * 2.35;
        const laneSep = (getOrbitalClearance(a) + getOrbitalClearance(b)) * 0.92;
        const minSep = Math.max(hardBodySep, laneSep, 1.4);

        const dx = b.orbitPos.x - a.orbitPos.x;
        const dy = b.orbitPos.y - a.orbitPos.y;
        const dz = b.orbitPos.z - a.orbitPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const dist = Math.sqrt(Math.max(d2, 1e-12));
        if (dist >= minSep) continue;

        let nx;
        let ny;
        let nz;
        if (dist < 1e-5) {
          const angle = (((i + 1) * 1.61803398875) + ((j + 1) * 2.41421356237) + pass * 0.7) % twoPi;
          const inc = (pass * 0.37 + i * 0.21) % twoPi;
          nx = Math.cos(angle) * Math.cos(inc);
          ny = Math.sin(inc);
          nz = Math.sin(angle) * Math.cos(inc);
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
        } else {
          nx = dx / dist;
          ny = dy / dist;
          nz = dz / dist;
        }

        const overlap = minSep - dist;
        if (overlap <= 0) continue;
        const split = overlap * 0.5;
        a.orbitPos.x -= nx * split;
        a.orbitPos.y -= ny * split;
        a.orbitPos.z -= nz * split;
        b.orbitPos.x += nx * split;
        b.orbitPos.y += ny * split;
        b.orbitPos.z += nz * split;

        const rvx = b.orbitVel.x - a.orbitVel.x;
        const rvy = b.orbitVel.y - a.orbitVel.y;
        const rvz = b.orbitVel.z - a.orbitVel.z;
        const closing = rvx * nx + rvy * ny + rvz * nz;
        if (closing < 0) {
          const impulse = -closing * 0.92;
          a.orbitVel.x -= nx * impulse * 0.5;
          a.orbitVel.y -= ny * impulse * 0.5;
          a.orbitVel.z -= nz * impulse * 0.5;
          b.orbitVel.x += nx * impulse * 0.5;
          b.orbitVel.y += ny * impulse * 0.5;
          b.orbitVel.z += nz * impulse * 0.5;
        }

        let ax = 0;
        let ay = 1;
        let az = 0;
        if (Math.abs(nx * ax + ny * ay + nz * az) > 0.88) {
          ax = 1;
          ay = 0;
          az = 0;
        }
        let tnx = ny * az - nz * ay;
        let tny = nz * ax - nx * az;
        let tnz = nx * ay - ny * ax;
        const tLen = Math.hypot(tnx, tny, tnz) || 1;
        tnx /= tLen;
        tny /= tLen;
        tnz /= tLen;
        const tangentBias = Math.min(0.08, 0.02 + overlap * 0.03);
        a.orbitVel.x -= tnx * tangentBias;
        a.orbitVel.y -= tny * tangentBias;
        a.orbitVel.z -= tnz * tangentBias;
        b.orbitVel.x += tnx * tangentBias;
        b.orbitVel.y += tny * tangentBias;
        b.orbitVel.z += tnz * tangentBias;
      }
    }
    sunOrbiters.forEach(applySunOrbiterBounds);
  }
}

function ensureSunOrbiterPlaneNormal(mp) {
  if (!mp || mp.orbitPlaneNormal) return;
  const inc = getSunOrbitInclination(mp);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  mp.orbitPlaneNormal = new THREE.Vector3(0, ci, si);
}

function sunInclinedHelioPos(out, r, theta, inc) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  out.set(r * c, -r * s * si, r * s * ci);
}

function sunInclinedHelioTanUnit(out, theta, inc) {
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  out.set(-s, -c * si, c * ci).normalize();
}

function initializeSunOrbiterState(mp) {
  if (!mp || mp.isBinary || mp.orbitCenter !== 'sun') return;
  ensureSunOrbiterPlaneNormal(mp);
  const inc = getSunOrbitInclination(mp);
  const r0 = Math.max(mp.orbitR || mp.orbitBaseR || SUN_ORBIT_MIN_R, SUN_ORBIT_MIN_R);
  const th = mp.angle;
  if (!mp.orbitPos) {
    mp.orbitPos = new THREE.Vector3();
    sunInclinedHelioPos(mp.orbitPos, r0, th, inc);
  }
  if (!mp.orbitVel) {
    const speed = Math.sqrt(SOLAR_MU / r0);
    const sign = mp.orbitSpeed < 0 ? -1 : 1;
    const tu = new THREE.Vector3();
    sunInclinedHelioTanUnit(tu, th, inc);
    mp.orbitVel = tu.multiplyScalar(speed * sign);
  }
}

/** Re-seat a sun orbiter on a circular path: radius r (heliocentric), plane tilt inc (rad about +X). */
function reapplySunOrbiterCircularOrbit(mp, r, inc) {
  if (!mp?.obj?.pivot || mp.isBinary || mp.orbitCenter !== 'sun') return;
  const rClamped = Math.max(SUN_ORBIT_MIN_R, Math.min(SUN_ORBIT_MAX_R - 0.05, r));
  const incClamped = Math.max(-SUN_ORBIT_TILT_RAD_MAX, Math.min(SUN_ORBIT_TILT_RAD_MAX, inc));
  if (!mp.orbitPos) mp.orbitPos = new THREE.Vector3();
  if (!mp.orbitVel) mp.orbitVel = new THREE.Vector3();
  mp.orbitBaseR = rClamped;
  mp.orbitR = rClamped;
  mp.orbitInclination = incClamped;
  mp.orbitPlaneNormal = null;
  ensureSunOrbiterPlaneNormal(mp);
  const th = mp.angle;
  sunInclinedHelioPos(mp.orbitPos, rClamped, th, incClamped);
  const sign = mp.orbitSpeed < 0 ? -1 : 1;
  const tu = new THREE.Vector3();
  sunInclinedHelioTanUnit(tu, th, incClamped);
  const speed = Math.sqrt(SOLAR_MU / rClamped);
  mp.orbitVel.copy(tu).multiplyScalar(speed * sign);
  mp.obj.pivot.position.copy(mp.orbitPos);
}

function ensureSunTrail(mp) {
  if (!mp || mp.isBinary || mp.orbitCenter !== 'sun' || mp.trail) return;
  const color = typeof mp.color === 'string' && mp.color.startsWith('#')
    ? parseInt(mp.color.slice(1), 16)
    : 0xffffff;
  mp.trail = makeTrail({ len: 280, color, opacity: 0.42 });
}

function ensureMoonTrail(mp) {
  if (!mp || mp.isBinary || mp.orbitCenter !== 'planet' || mp.trail) return;
  const color = typeof mp.color === 'string' && mp.color.startsWith('#')
    ? parseInt(mp.color.slice(1), 16)
    : 0xffffff;
  mp.trail = makeTrail({ len: 240, color, opacity: 0.38 });
}

function reserveSolarOrbitSlot(newBaseRadius = 0.8, newSize = 1.0) {
  const sunOrbiters = managedPlanets.filter(mp => !mp.isBinary && mp.orbitCenter === 'sun');
  const binaryBodies = managedPlanets.filter(mp => mp.isBinary);
  const newMass = 1.6 * Math.pow(Math.max(newBaseRadius, 0.2), 3) * Math.pow(Math.max(newSize, 0.2), 3);
  const newClearance = Math.max(1.8, newBaseRadius * Math.max(newSize, 0.2) * 3.0, Math.cbrt(newMass) * 1.45);
  const twoPi = Math.PI * 2;
  const binaryComR = Math.max(Math.hypot(sysGroup.position.x, sysGroup.position.z), SUN_ORBIT_MIN_R);
  const binaryLocalMax = binaryBodies.reduce((acc, mp) => {
    const local = mp?.obj?.pivot?.position ? mp.obj.pivot.position.length() : 0;
    return Math.max(acc, local);
  }, 0);
  // Keep new planets outside the dynamic binary annulus + safety margin.
  const binaryAvoidRadius = binaryComR + binaryLocalMax + newClearance + 3.6;

  function normalizeAngle(a) {
    return ((a % twoPi) + twoPi) % twoPi;
  }

  function chooseLargestGapMidpoint(angles) {
    if (!angles.length) return Math.random() * twoPi;
    const sorted = angles.map(normalizeAngle).sort((a, b) => a - b);
    let bestGap = -1;
    let bestStart = sorted[0];
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = i === sorted.length - 1 ? sorted[0] + twoPi : sorted[i + 1];
      const gap = b - a;
      if (gap > bestGap) {
        bestGap = gap;
        bestStart = a;
      }
    }
    return normalizeAngle(bestStart + bestGap * 0.5);
  }

  let chosenRadius = null;
  let fallbackRadius = SOLAR_ORBIT_GRID_RADII[SOLAR_ORBIT_GRID_RADII.length - 1];
  let fallbackScore = -Infinity;
  for (const r of SOLAR_ORBIT_GRID_RADII) {
    if (r < binaryAvoidRadius) continue;
    let safe = true;
    let minSlack = Infinity;
    for (const mp of sunOrbiters) {
      const requiredGap = newClearance + getOrbitalClearance(mp);
      const gap = Math.abs(r - getSunOrbitRadius(mp));
      const slack = gap - requiredGap;
      minSlack = Math.min(minSlack, slack);
      if (slack < 0) safe = false;
    }
    if (safe) {
      chosenRadius = r;
      break;
    }
    if (minSlack > fallbackScore) {
      fallbackScore = minSlack;
      fallbackRadius = r;
    }
  }

  if (chosenRadius === null) {
    const cap = SUN_ORBIT_MAX_R - 0.8;
    const farthest = sunOrbiters.reduce((acc, mp) => Math.max(acc, getSunOrbitRadius(mp)), SOLAR_ORBIT_GRID_RADII[SOLAR_ORBIT_GRID_RADII.length - 1]);
    const proposed = Math.max(fallbackRadius, binaryAvoidRadius, farthest + newClearance * 1.6);
    if (proposed > cap) return null; // no safe orbit space currently available
    chosenRadius = proposed;
  }

  const worldSample = new THREE.Vector3();
  let chosenInc = 0;
  let bestLaneScore = -Infinity;
  SOLAR_ORBIT_INCLINATIONS.forEach(incLane => {
    let minSlack = Infinity;
    managedPlanets.forEach(mp => {
      if (!mp?.obj?.pivot) return;
      let otherR;
      let otherInc;
      if (!mp.isBinary && mp.orbitCenter === 'sun') {
        otherR = getSunOrbitRadius(mp);
        otherInc = getSunOrbitInclination(mp);
      } else {
        mp.obj.pivot.getWorldPosition(worldSample);
        otherR = worldSample.length();
        otherInc = 0;
      }
      const requiredGap = newClearance + getOrbitalClearance(mp);
      const laneDist = Math.hypot(
        chosenRadius - otherR,
        chosenRadius * Math.abs(incLane - otherInc)
      );
      minSlack = Math.min(minSlack, laneDist - requiredGap);
    });
    const diversificationBonus = Math.abs(incLane) * 0.06;
    const score = minSlack + diversificationBonus;
    if (score > bestLaneScore) {
      bestLaneScore = score;
      chosenInc = incLane;
    }
  });

  const nearbyAngles = sunOrbiters
    .filter(mp => {
      const requiredGap = newClearance + getOrbitalClearance(mp);
      const laneDist = Math.hypot(
        getSunOrbitRadius(mp) - chosenRadius,
        chosenRadius * Math.abs(getSunOrbitInclination(mp) - chosenInc)
      );
      return laneDist < requiredGap;
    })
    .map(mp => mp.angle);
  managedPlanets.forEach(mp => {
    if (!mp?.obj?.pivot) return;
    mp.obj.pivot.getWorldPosition(worldSample);
    const worldHelioR = worldSample.length();
    const worldInc = (!mp.isBinary && mp.orbitCenter === 'sun') ? getSunOrbitInclination(mp) : 0;
    const requiredGap = newClearance + getOrbitalClearance(mp);
    const laneDist = Math.hypot(
      worldHelioR - chosenRadius,
      chosenRadius * Math.abs(worldInc - chosenInc)
    );
    if (laneDist > requiredGap) return;
    nearbyAngles.push(Math.atan2(worldSample.z, worldSample.x));
  });
  const chosenAngle = chooseLargestGapMidpoint(nearbyAngles);
  const phaseIdx = Math.round((normalizeAngle(chosenAngle) / twoPi) * (SOLAR_ORBIT_GRID_PHASE_COUNT - 1));
  return {
    key: `${chosenRadius.toFixed(2)}:${phaseIdx}:${chosenInc.toFixed(3)}`,
    radius: chosenRadius,
    angle: chosenAngle,
    inc: chosenInc,
  };
}

function createSunOrbitPlanet({
  orbitR,
  orbitSpeed,
  orbitAngle,
  orbitInclination = 0,
  slotKey = null,
  spinRateBase = 0.006 + Math.random() * 0.006,
  tilt = (Math.random() - 0.5) * 0.6,
  baseRadius = 0.5 + Math.random() * 0.6,
  initState,
  name,
}) {
  const idx   = managedPlanets.length;
  const seed  = Math.random() * 99;
  const color = PLANET_COLORS[idx % PLANET_COLORS.length];
  const newP  = createPlanet(baseRadius, Math.max(1, curDetail-1), seed, tilt, initState);
  scene.add(newP.pivot);
  newP.pivot.visible = planetsRenderable;
  newP.pivot.position.set(0, 0, 0);
  newP.setGrid(gridOn);
  registerPlanet(
    newP,
    name || `Planet ${idx+1}`,
    color,
    false,
    orbitR,
    orbitSpeed,
    spinRateBase,
    undefined,
    'sun',
    slotKey,
    orbitAngle,
    null,
    orbitInclination
  );
  const newIdx = managedPlanets.length - 1;
  const mp = managedPlanets[newIdx];
  initializeSunOrbiterState(mp);
  newP.pivot.position.copy(mp.orbitPos);
  ensureSunTrail(mp);
  rebuildManagedPlanetTerrain(mp);
  syncTrailVisibility();
  return newIdx;
}

const _orbitParentWorld = new THREE.Vector3();

function createPlanetMoonOrbit(parentIdx) {
  const parent = managedPlanets[parentIdx];
  if (!parent) return null;
  const idx = managedPlanets.length;
  const seed = Math.random() * 99;
  const color = PLANET_COLORS[idx % PLANET_COLORS.length];
  const parentRadius = Math.max((parent.obj.baseRadius || 0.8) * parent.obj.state.size, 0.3);
  const orbitR = Math.max(0.9, parentRadius * (2.0 + Math.random() * 1.8));
  const orbitAngle = Math.random() * Math.PI * 2;
  const moonMassProxy = Math.max(0.25, getPlanetMass(parent) * 0.045);
  const orbitSpeed = (Math.random() < 0.5 ? -1 : 1) * Math.sqrt((0.6 + moonMassProxy) / Math.pow(orbitR, 3));
  const spinRateBase = 0.008 + Math.random() * 0.008;
  const tilt = (Math.random() - 0.5) * 0.6;
  const baseRadius = Math.max(0.22, Math.min(0.65, parentRadius * (0.28 + Math.random() * 0.2)));
  const moon = createPlanet(baseRadius, Math.max(1, curDetail-1), seed, tilt, {
    peakScale: parent.obj.state.peakScale,
    waterLevel: parent.obj.state.waterLevel,
    size: Math.max(0.25, parent.obj.state.size * (0.35 + Math.random() * 0.25)),
  });
  scene.add(moon.pivot);
  moon.pivot.visible = planetsRenderable;
  parent.obj.pivot.getWorldPosition(_orbitParentWorld);
  moon.pivot.position.set(
    _orbitParentWorld.x + Math.cos(orbitAngle) * orbitR,
    _orbitParentWorld.y,
    _orbitParentWorld.z + Math.sin(orbitAngle) * orbitR
  );
  moon.setGrid(gridOn);
  const sameParentCount = managedPlanets.filter(mp => mp.orbitCenter === 'planet' && mp.orbitParentId === parent.id).length + 1;
  registerPlanet(
    moon,
    `${parent.name} Moon ${sameParentCount}`,
    color,
    false,
    orbitR,
    orbitSpeed,
    spinRateBase,
    undefined,
    'planet',
    null,
    orbitAngle,
    parent.id
  );
  const moonIdx = managedPlanets.length - 1;
  ensureMoonTrail(managedPlanets[moonIdx]);
  rebuildManagedPlanetTerrain(managedPlanets[moonIdx]);
  syncTrailVisibility();
  return moonIdx;
}

function rebuildPlanetList() {
  const list = $('planet-list');
  list.innerHTML = '';
  managedPlanets.forEach((mp, i) => {
    const el = document.createElement('div');
    el.className = 'planet-item' + (i === selectedPlanetIdx ? ' selected' : '');
    el.innerHTML = `<span class="planet-dot" style="background:${mp.color}"></span>
                    <span class="planet-name">${mp.name}</span>`;
    el.addEventListener('click', () => selectPlanet(i));
    list.appendChild(el);
  });
  syncPlanetCount();
}

const editPanel   = $('planet-edit-panel');
const dialSizeE   = $('dial-size-edit'),  lblSizeE  = $('lbl-size-edit');
const dialPeakE   = $('dial-peak-edit'),  lblPeakE  = $('lbl-peak-edit');
const dialWaterE  = $('dial-water-edit'), lblWaterE = $('lbl-water-edit');
const planetRadialEditorEl = $('planet-radial-editor');
const planetRadialRingEl = $('planet-radial-ring');
const planetRadialGuideEl = $('planet-radial-guide');
const planetRadialCloseBtn = $('planet-radial-close');
const planetRadialKnobEls = planetRadialEditorEl ? {
  size: planetRadialEditorEl.querySelector('button[data-setting="size"]'),
  peak: planetRadialEditorEl.querySelector('button[data-setting="peak"]'),
  water: planetRadialEditorEl.querySelector('button[data-setting="water"]'),
} : {};
const planetRadialValueEls = {
  size: $('prk-val-size'),
  peak: $('prk-val-peak'),
  water: $('prk-val-water'),
};
const PLANET_EDIT_CONFIG = {
  size:  { min: 0.1, max: 5, step: 0.005, arcStart: 140, arcEnd: 260 },
  peak:  { min: 0, max: 3, step: 0.01, arcStart: 310, arcEnd: 50 },
  water: { min: -1, max: 1, step: 0.005, arcStart: 40, arcEnd: 140 },
};
const planetRadialState = {
  visible: false,
  centerX: 0,
  centerY: 0,
  knobRadius: 95,
  dragSetting: null,
  dragPointerId: null,
  /** Pointer angle (deg) at drag start — maps to current value via dragValueStartDeg */
  dragPointerStartDeg: null,
  /** Arc angle (deg) that matches the planet value when the drag began */
  dragValueStartDeg: null,
  dragLastPointerDeg: null,
  dragAngleAccum: 0,
  /** Frozen HTML ring diameter (px) while editing this selection so size edits do not resize the UI */
  ringSizePxLock: null,
  ringLockSelectionIdx: null,
};
const sunRadialEditorEl = $('sun-radial-editor');
const sunRadialRingEl = $('sun-radial-ring');
const sunRadialGuideEl = $('sun-radial-guide');
const sunRadialCloseBtn = $('sun-radial-close');
const sunRadialKnobEls = sunRadialEditorEl ? {
  scale: sunRadialEditorEl.querySelector('button[data-sun-setting="scale"]'),
  warp: sunRadialEditorEl.querySelector('button[data-sun-setting="warp"]'),
} : {};
const sunRadialValueEls = {
  scale: $('srk-val-scale'),
  warp: $('srk-val-warp'),
};
const sunRadialState = {
  visible: false,
  centerX: 0,
  centerY: 0,
  knobRadius: 95,
  dragSetting: null,
  dragPointerId: null,
  dragPointerStartDeg: null,
  dragValueStartDeg: null,
  dragLastPointerDeg: null,
  dragAngleAccum: 0,
};
const planetPanel = $('planet-panel');
const planetPanelToggle = $('planet-panel-toggle');
const planetPanelHeader = $('planet-panel-header');
const planetCountEl = $('planet-count');
const addPlanetBtn = $('add-planet-btn');
const addTwinBtn = $('add-twin-btn');
const sunOrbitSlidersEl = $('sun-orbit-sliders');
const dialSunOrbitREl = $('dial-sun-orbit-r');
const dialSunOrbitTiltDegEl = $('dial-sun-orbit-tilt-deg');
const lblSunOrbitREl = $('lbl-sun-orbit-r');
const lblSunOrbitTiltEl = $('lbl-sun-orbit-tilt');
const btnWalk = $('btn-walk');
const walkControlsEl = $('walk-controls');
const walkJoystickEl = $('walk-joystick');
const walkJoystickThumbEl = $('walk-joystick-thumb');
const walkJoystickState = { pointerId: null, rangePx: 44 };

function updateWalkJoystickThumb() {
  if (!walkJoystickThumbEl) return;
  const xPx = walkAnalog.x * walkJoystickState.rangePx;
  const yPx = -walkAnalog.y * walkJoystickState.rangePx;
  walkJoystickThumbEl.style.transform = `translate(${xPx.toFixed(1)}px, ${yPx.toFixed(1)}px)`;
}

function setWalkAnalogInput(rawX, rawY) {
  let x = Math.max(-1, Math.min(1, rawX));
  let y = Math.max(-1, Math.min(1, rawY));
  const mag = Math.hypot(x, y);
  if (mag > 1e-6 && mag > 1) {
    x /= mag;
    y /= mag;
  }
  walkAnalog.x = x;
  walkAnalog.y = y;
  updateWalkJoystickThumb();
}

function resetWalkJoystick() {
  walkJoystickState.pointerId = null;
  if (typeof setWalkJoystickCapturingPointer === 'function') setWalkJoystickCapturingPointer(null);
  setWalkAnalogInput(0, 0);
}

function sampleWalkJoystickPointer(clientX, clientY) {
  if (!walkJoystickEl) return;
  const rect = walkJoystickEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  const nx = (clientX - centerX) / (rect.width * 0.5);
  const ny = (clientY - centerY) / (rect.height * 0.5);
  setWalkAnalogInput(nx, -ny);
}

function clampPlanetEditValue(setting, value) {
  const cfg = PLANET_EDIT_CONFIG[setting];
  if (!cfg) return value;
  return Math.max(cfg.min, Math.min(cfg.max, value));
}

function quantizePlanetEditValue(setting, value) {
  const cfg = PLANET_EDIT_CONFIG[setting];
  if (!cfg || !cfg.step) return value;
  return Math.round(value / cfg.step) * cfg.step;
}

function planetEditAngleSpan(cfg) {
  const raw = cfg.arcEnd - cfg.arcStart;
  return raw >= 0 ? raw : raw + 360;
}

function radialCircDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

/** Widen min/max plateaus so slight overshoot at arc ends does not snap to the opposite value */
function softenRadialT(t) {
  const m = 0.055;
  if (t <= m) return 0;
  if (t >= 1 - m) return 1;
  return (t - m) / (1 - 2 * m);
}

/** Fold an unwrapped screen angle (deg) onto the configured arc for stable t mapping */
function foldAngleIntoCfgArc(cfg, deg, getSpan) {
  const span = getSpan(cfg);
  const s = cfg.arcStart;
  const e = cfg.arcEnd;
  if (e >= s) {
    let a = deg;
    for (let i = 0; i < 48; i++) {
      if (a >= s && a <= e) return a;
      if (a < s) a += 360;
      else a -= 360;
    }
    const raw = ((deg % 360) + 360) % 360;
    return Math.max(s, Math.min(e, raw));
  }
  const hi = s + span;
  let a = deg;
  for (let i = 0; i < 48; i++) {
    if (a >= s && a <= hi) return a;
    if (a < s) a += 360;
    else a -= 360;
  }
  const raw = ((deg % 360) + 360) % 360;
  if (raw >= s) return raw;
  if (raw <= e) return raw + 360;
  return radialCircDist(raw, s) <= radialCircDist(raw, e) ? s : e + 360;
}

function planetEditTToAngle(setting, t) {
  const cfg = PLANET_EDIT_CONFIG[setting];
  if (!cfg) return 0;
  const span = planetEditAngleSpan(cfg);
  return (cfg.arcStart + Math.max(0, Math.min(1, t)) * span + 360) % 360;
}

function planetEditAngleToT(setting, deg) {
  const cfg = PLANET_EDIT_CONFIG[setting];
  if (!cfg) return 0;
  const span = planetEditAngleSpan(cfg);
  const angle = foldAngleIntoCfgArc(cfg, deg, planetEditAngleSpan);
  return Math.max(0, Math.min(1, (angle - cfg.arcStart) / Math.max(1e-5, span)));
}

function valueFromPlanetSetting(mp, setting) {
  if (!mp) return 0;
  if (setting === 'size') return mp.obj.state.size;
  if (setting === 'peak') return mp.obj.state.peakScale;
  if (setting === 'water') return mp.obj.state.waterLevel;
  return 0;
}

function formatWaterCompact(wl) {
  const pct = Math.round(Math.abs(Math.max(-1, Math.min(1, wl))) * 100);
  if (wl > 0.0001) return `${pct}%W`;
  if (wl < -0.0001) return `${pct}%L`;
  return '0%';
}

function setPlanetRadialGuide(setting) {
  if (!planetRadialGuideEl) return;
  if (!setting || !PLANET_EDIT_CONFIG[setting]) {
    planetRadialGuideEl.classList.remove('visible');
    return;
  }
  const cfg = PLANET_EDIT_CONFIG[setting];
  const span = planetEditAngleSpan(cfg);
  const start = ((cfg.arcStart % 360) + 360) % 360;
  planetRadialGuideEl.style.setProperty('--guide-start', `${start.toFixed(2)}deg`);
  planetRadialGuideEl.style.setProperty('--guide-span', `${span.toFixed(2)}deg`);
  planetRadialGuideEl.classList.add('visible');
}

function updatePlanetRadialFocusVisuals() {
  const active = planetRadialState.dragSetting;
  if (active === _prevPlanetFocusDrag) return;
  _prevPlanetFocusDrag = active;
  if (planetRadialRingEl) {
    planetRadialRingEl.style.opacity = active ? '0.92' : '0.78';
  }
  Object.entries(planetRadialKnobEls).forEach(([setting, knob]) => {
    if (!knob) return;
    knob.classList.toggle('active', active === setting);
    knob.classList.toggle('dim', !!active && active !== setting);
  });
  if (planetRadialCloseBtn) {
    planetRadialCloseBtn.classList.toggle('dim', !!active);
  }
  setPlanetRadialGuide(active);
}

function syncPlanetEditReadouts(mp) {
  if (!mp) return;
  if (mp.id === _prevPlanetReadoutMpId &&
      mp.obj.state.size === _prevPlanetReadoutSize &&
      mp.obj.state.peakScale === _prevPlanetReadoutPeak &&
      mp.obj.state.waterLevel === _prevPlanetReadoutWater) return;
  _prevPlanetReadoutMpId = mp.id;
  _prevPlanetReadoutSize = mp.obj.state.size;
  _prevPlanetReadoutPeak = mp.obj.state.peakScale;
  _prevPlanetReadoutWater = mp.obj.state.waterLevel;
  if (lblSizeE) lblSizeE.textContent = `Size ${mp.obj.state.size.toFixed(3)}×`;
  if (lblPeakE) lblPeakE.textContent = `Peaks ${mp.obj.state.peakScale.toFixed(2)}×`;
  if (lblWaterE) lblWaterE.textContent = waterLabelText(mp.obj.state.waterLevel);
  if (planetRadialValueEls.size) planetRadialValueEls.size.textContent = `${mp.obj.state.size.toFixed(3)}×`;
  if (planetRadialValueEls.peak) planetRadialValueEls.peak.textContent = `${mp.obj.state.peakScale.toFixed(2)}×`;
  if (planetRadialValueEls.water) planetRadialValueEls.water.textContent = formatWaterCompact(mp.obj.state.waterLevel);
}

function syncPlanetDialValues(mp) {
  if (!mp) return;
  if (dialSizeE) dialSizeE.value = mp.obj.state.size;
  if (dialPeakE) dialPeakE.value = mp.obj.state.peakScale;
  if (dialWaterE) dialWaterE.value = mp.obj.state.waterLevel;
}

function updateSunOrbitSliderLabels() {
  if (lblSunOrbitREl && dialSunOrbitREl) {
    const rv = parseFloat(dialSunOrbitREl.value);
    lblSunOrbitREl.textContent = `Distance from sun ${Number.isFinite(rv) ? rv.toFixed(1) : '—'}`;
  }
  if (lblSunOrbitTiltEl && dialSunOrbitTiltDegEl) {
    lblSunOrbitTiltEl.textContent = `Orbit tilt ${dialSunOrbitTiltDegEl.value}°`;
  }
}

function syncSunOrbitEditorUi(mp) {
  if (!sunOrbitSlidersEl) return;
  const ok = mp && !mp.isBinary && mp.orbitCenter === 'sun';
  sunOrbitSlidersEl.style.display = ok ? 'flex' : 'none';
  if (!ok || !dialSunOrbitREl || !dialSunOrbitTiltDegEl) return;
  initializeSunOrbiterState(mp);
  const rNow = getSunOrbitRadius(mp);
  const rDial = Math.max(SUN_ORBIT_SLIDER_R_MIN, Math.min(SUN_ORBIT_SLIDER_R_MAX, rNow));
  dialSunOrbitREl.value = String(rDial);
  const deg = Math.round((getSunOrbitInclination(mp) * 180) / Math.PI);
  dialSunOrbitTiltDegEl.value = String(Math.max(-SUN_ORBIT_TILT_DEG_MAX, Math.min(SUN_ORBIT_TILT_DEG_MAX, deg)));
  updateSunOrbitSliderLabels();
}

function applySunOrbitFromSliders() {
  if (selectedPlanetIdx === null) return;
  const mp = managedPlanets[selectedPlanetIdx];
  if (!mp || mp.isBinary || mp.orbitCenter !== 'sun') return;
  if (!dialSunOrbitREl || !dialSunOrbitTiltDegEl) return;
  let r = parseFloat(dialSunOrbitREl.value);
  let tiltDeg = parseFloat(dialSunOrbitTiltDegEl.value);
  if (!Number.isFinite(r)) return;
  if (!Number.isFinite(tiltDeg)) tiltDeg = 0;
  r = Math.max(SUN_ORBIT_SLIDER_R_MIN, Math.min(SUN_ORBIT_SLIDER_R_MAX, r));
  const tiltClamped = Math.max(-SUN_ORBIT_TILT_DEG_MAX, Math.min(SUN_ORBIT_TILT_DEG_MAX, tiltDeg));
  const inc = (tiltClamped * Math.PI) / 180;
  reapplySunOrbiterCircularOrbit(mp, r, inc);
  updateSunOrbitSliderLabels();
}

function finalizePlanetSizeAfterRadialDrag() {
  if (selectedPlanetIdx === null) return;
  const mp = managedPlanets[selectedPlanetIdx];
  if (!mp) return;
  mp.obj.state.size = quantizePlanetEditValue(
    'size',
    clampPlanetEditValue('size', mp.obj.state.size)
  );
  if (mp.isBinary) {
    const mass1Now = BASE_M1 * Math.pow(Math.max(p1.state.size, 0.2), 3);
    const mass2Now = BASE_M2 * Math.pow(Math.max(p2.state.size, 0.2), 3);
    refreshBinaryPairForMassChange(mass1Now, mass2Now);
    binaryPrevMass1 = mass1Now;
    binaryPrevMass2 = mass2Now;
  }
  syncPlanetDialValues(mp);
  syncPlanetEditReadouts(mp);
  rebuildManagedPlanetTerrain(mp);
  if (typeof resetPlanetViewShellRadiusSmoothed === 'function') resetPlanetViewShellRadiusSmoothed();
}

function applyPlanetEditSetting(setting, rawValue, skipVeg) {
  if (selectedPlanetIdx === null) return;
  const mp = managedPlanets[selectedPlanetIdx];
  if (!mp) return;
  const inRadialSizeDrag = setting === 'size' && planetRadialState.dragSetting === 'size';
  const rawClamped = clampPlanetEditValue(setting, rawValue);
  let nextValue;
  if (setting === 'size') {
    nextValue = rawClamped;
  } else {
    nextValue = inRadialSizeDrag ? rawClamped : quantizePlanetEditValue(setting, rawClamped);
  }
  const detailCap =
    planetRadialState.dragSetting !== null &&
    planetRadialState.dragSetting !== 'size'
      ? DRAG_PREVIEW_DETAIL
      : undefined;
  if (setting === 'size') {
    mp.obj.state.size = nextValue;
    if (mp.isBinary && !inRadialSizeDrag) {
      const mass1Now = BASE_M1 * Math.pow(Math.max(p1.state.size, 0.2), 3);
      const mass2Now = BASE_M2 * Math.pow(Math.max(p2.state.size, 0.2), 3);
      refreshBinaryPairForMassChange(mass1Now, mass2Now);
      binaryPrevMass1 = mass1Now;
      binaryPrevMass2 = mass2Now;
    }
    rebuildManagedPlanetTerrain(mp, detailCap, skipVeg);
  } else if (setting === 'peak') {
    mp.obj.state.peakScale = nextValue;
    rebuildManagedPlanetTerrain(mp, detailCap, skipVeg);
  } else if (setting === 'water') {
    mp.obj.state.waterLevel = nextValue;
    rebuildManagedPlanetTerrain(mp, detailCap, skipVeg);
  }
  syncPlanetDialValues(mp);
  syncPlanetEditReadouts(mp);
}

function hidePlanetRadialEditor() {
  const wasSizeRadialDrag = planetRadialState.dragSetting === 'size';
  _prevPlanetEdCx = _prevPlanetEdCy = _prevPlanetEdRing = null;
  if (planetRadialEditorEl) planetRadialEditorEl.style.display = 'none';
  planetRadialState.visible = false;
  planetRadialState.dragSetting = null;
  planetRadialState.dragPointerId = null;
  planetRadialState.dragPointerStartDeg = null;
  planetRadialState.dragValueStartDeg = null;
  planetRadialState.dragLastPointerDeg = null;
  planetRadialState.dragAngleAccum = 0;
  planetRadialState.ringSizePxLock = null;
  planetRadialState.ringLockSelectionIdx = null;
  document.body.classList.remove('radial-edit-active');
  updatePlanetRadialFocusVisuals();
  if (wasSizeRadialDrag) finalizePlanetSizeAfterRadialDrag();
}

function updatePlanetRadialKnobPositions(mp) {
  if (!planetRadialEditorEl || !mp) return;
  const r = planetRadialState.knobRadius;
  const sz = mp.obj.state.size, pk = mp.obj.state.peakScale, wt = mp.obj.state.waterLevel;
  if (r !== _prevPlanetKnobR || sz !== _prevPlanetKnobSize || pk !== _prevPlanetKnobPeak || wt !== _prevPlanetKnobWater) {
    _prevPlanetKnobR = r; _prevPlanetKnobSize = sz; _prevPlanetKnobPeak = pk; _prevPlanetKnobWater = wt;
    ['size', 'peak', 'water'].forEach(setting => {
      const knob = planetRadialKnobEls[setting];
      const cfg = PLANET_EDIT_CONFIG[setting];
      if (!knob || !cfg) return;
      const value = valueFromPlanetSetting(mp, setting);
      const t = (value - cfg.min) / Math.max(1e-6, cfg.max - cfg.min);
      const deg = planetEditTToAngle(setting, t);
      const rad = deg * Math.PI / 180;
      knob.style.left = `${(Math.cos(rad) * r).toFixed(1)}px`;
      knob.style.top = `${(Math.sin(rad) * r).toFixed(1)}px`;
    });
  }
  updatePlanetRadialFocusVisuals();
}

function updatePlanetSelectionEditor() {
  const shouldShow =
    selectedPlanetIdx !== null &&
    !!managedPlanets[selectedPlanetIdx] &&
    cameraMode === 'planet' &&
    !walkMode.active &&
    planetsRenderable;
  if (!shouldShow) {
    planetSelectionHalo.visible = false;
    planetSelectionRing.visible = false;
    hidePlanetRadialEditor();
    return;
  }
  const mp = managedPlanets[selectedPlanetIdx];
  if (!mp?.obj?.pivot) {
    planetSelectionHalo.visible = false;
    planetSelectionRing.visible = false;
    hidePlanetRadialEditor();
    return;
  }
  document.body.classList.add('radial-edit-active');
  const radiusWorld = getPlanetCenterRadius(mp, _planetEditorCenterWorld);
  planetSelectionHalo.visible = true;
  planetSelectionHalo.position.copy(_planetEditorCenterWorld);
  planetSelectionHalo.scale.setScalar(radiusWorld * 1.22);

  planetSelectionRing.visible = true;
  planetSelectionRing.position.copy(_planetEditorCenterWorld);
  planetSelectionRing.quaternion.copy(camera.quaternion);
  const ringRadius = radiusWorld * 1.38;
  planetSelectionRing.scale.set(ringRadius, ringRadius, ringRadius);

  _planetEditorNdc.copy(_planetEditorCenterWorld).project(camera);
  const depthOutOfRange = _planetEditorNdc.z < -1 || _planetEditorNdc.z > 1;
  if (depthOutOfRange) {
    hidePlanetRadialEditor();
    return;
  }
  const vw = _vwCache;
  const vh = _vhCache;
  const projectedCx = (_planetEditorNdc.x * 0.5 + 0.5) * vw;
  const projectedCy = (-_planetEditorNdc.y * 0.5 + 0.5) * vh;
  if (!Number.isFinite(projectedCx) || !Number.isFinite(projectedCy)) {
    hidePlanetRadialEditor();
    return;
  }
  const cx = projectedCx;
  const cy = projectedCy;

  camera.matrixWorld.extractBasis(_planetEditorCamRight, _planetEditorCamUp, _planetEditorCamForward);
  _planetEditorEdgeWorld.copy(_planetEditorCenterWorld).addScaledVector(_planetEditorCamRight.normalize(), radiusWorld);
  _planetEditorEdgeNdc.copy(_planetEditorEdgeWorld).project(camera);
  const ex = (_planetEditorEdgeNdc.x * 0.5 + 0.5) * vw;
  const ey = (-_planetEditorEdgeNdc.y * 0.5 + 0.5) * vh;
  const projectedRadius = Number.isFinite(ex) && Number.isFinite(ey)
    ? Math.max(26, Math.hypot(ex - cx, ey - cy))
    : 64;
  const narrow = isNarrowPlanetUI();
  const shortSide = Math.min(vw, vh);
  const ringMinPx = narrow ? 132 : 156;
  const ringMaxPx = narrow
    ? Math.min(292, shortSide * 0.54)
    : Math.min(560, shortSide * 0.74);
  const ringFromProjection = projectedRadius * 2.85;
  let ringSize = Math.max(ringMinPx, Math.min(ringMaxPx, ringFromProjection));
  if (planetRadialState.ringLockSelectionIdx !== selectedPlanetIdx) {
    planetRadialState.ringLockSelectionIdx = selectedPlanetIdx;
    planetRadialState.ringSizePxLock = null;
  }
  if (planetRadialState.ringSizePxLock === null) {
    planetRadialState.ringSizePxLock = ringSize;
  } else {
    ringSize = planetRadialState.ringSizePxLock;
  }

  if (planetRadialEditorEl) {
    planetRadialEditorEl.style.display = 'block';
    if (_prevPlanetEdCx === null || Math.abs(cx - _prevPlanetEdCx) > 0.05 || Math.abs(cy - _prevPlanetEdCy) > 0.05 || Math.abs(ringSize - _prevPlanetEdRing) > 0.05) {
      planetRadialEditorEl.style.left = `${cx.toFixed(1)}px`;
      planetRadialEditorEl.style.top = `${cy.toFixed(1)}px`;
      planetRadialEditorEl.style.setProperty('--pre-size', `${ringSize.toFixed(1)}px`);
      _prevPlanetEdCx = cx; _prevPlanetEdCy = cy; _prevPlanetEdRing = ringSize;
    }
  }
  planetRadialState.visible = true;
  planetRadialState.centerX = cx;
  planetRadialState.centerY = cy;
  planetRadialState.knobRadius = ringSize * 0.5;
  syncPlanetEditReadouts(mp);
  updatePlanetRadialKnobPositions(mp);
}

function updatePlanetSettingFromPointer(clientX, clientY, setting) {
  const cfg = PLANET_EDIT_CONFIG[setting];
  if (!cfg) return;
  const dx = clientX - planetRadialState.centerX;
  const dy = clientY - planetRadialState.centerY;
  if (dx * dx + dy * dy < 25) return;
  const pointerDeg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  let deg;
  if (planetRadialState.dragPointerStartDeg !== null && planetRadialState.dragValueStartDeg !== null) {
    const step = ((pointerDeg - planetRadialState.dragLastPointerDeg + 540) % 360) - 180;
    planetRadialState.dragLastPointerDeg = pointerDeg;
    planetRadialState.dragAngleAccum += step;
    deg = planetRadialState.dragValueStartDeg + planetRadialState.dragAngleAccum;
  } else {
    deg = pointerDeg;
  }
  const t = softenRadialT(planetEditAngleToT(setting, deg));
  const value = cfg.min + t * (cfg.max - cfg.min);
  applyPlanetEditSetting(setting, value);
}

function sunArcSpan(cfg) {
  const raw = cfg.arcEnd - cfg.arcStart;
  return raw >= 0 ? raw : raw + 360;
}
function sunEditTToAngle(setting, t) {
  const cfg = SUN_EDIT_CONFIG[setting];
  if (!cfg) return 0;
  const span = sunArcSpan(cfg);
  return (cfg.arcStart + Math.max(0, Math.min(1, t)) * span + 360) % 360;
}
function sunEditAngleToT(setting, deg) {
  const cfg = SUN_EDIT_CONFIG[setting];
  if (!cfg) return 0;
  const span = sunArcSpan(cfg);
  const angle = foldAngleIntoCfgArc(cfg, deg, sunArcSpan);
  return Math.max(0, Math.min(1, (angle - cfg.arcStart) / Math.max(1e-5, span)));
}
function valueFromSunSetting(setting) {
  if (setting === 'scale') return targetScale;
  if (setting === 'warp') return timeWarp;
  return 0;
}
function clampSunEditValue(setting, value) {
  const cfg = SUN_EDIT_CONFIG[setting];
  if (!cfg) return value;
  return Math.max(cfg.min, Math.min(cfg.max, value));
}
function quantizeSunEditValue(setting, value) {
  if (setting === 'scale') {
    const s = scaleWorldToSliderValue(value);
    const q = Math.round(Math.max(0, Math.min(1, s)) / 0.001) * 0.001;
    return sliderToScale(q);
  }
  const cfg = SUN_EDIT_CONFIG[setting];
  if (!cfg || !cfg.step) return value;
  return Math.round(value / cfg.step) * cfg.step;
}
function syncSunRadialReadouts() {
  if (sunRadialValueEls.scale) sunRadialValueEls.scale.textContent = `${scaleWorldToUi(targetScale).toFixed(2)}×`;
  if (sunRadialValueEls.warp) {
    sunRadialValueEls.warp.textContent = timeWarp === 0 ? 'PAUSE' : `${timeWarp.toFixed(1)}×`;
  }
}
function setSunRadialGuide(setting) {
  if (!sunRadialGuideEl) return;
  if (!setting || !SUN_EDIT_CONFIG[setting]) {
    sunRadialGuideEl.classList.remove('visible');
    return;
  }
  const cfg = SUN_EDIT_CONFIG[setting];
  const span = sunArcSpan(cfg);
  const start = ((cfg.arcStart % 360) + 360) % 360;
  sunRadialGuideEl.style.setProperty('--guide-start', `${start.toFixed(2)}deg`);
  sunRadialGuideEl.style.setProperty('--guide-span', `${span.toFixed(2)}deg`);
  sunRadialGuideEl.classList.add('visible');
}
function updateSunRadialFocusVisuals() {
  const active = sunRadialState.dragSetting;
  if (active === _prevSunFocusDrag) return;
  _prevSunFocusDrag = active;
  if (sunRadialRingEl) {
    sunRadialRingEl.style.opacity = active ? '0.92' : '0.78';
  }
  Object.entries(sunRadialKnobEls).forEach(([setting, knob]) => {
    if (!knob) return;
    knob.classList.toggle('active', active === setting);
    knob.classList.toggle('dim', !!active && active !== setting);
  });
  if (sunRadialCloseBtn) {
    sunRadialCloseBtn.classList.toggle('dim', !!active);
  }
  setSunRadialGuide(active);
}
function applySunEditSetting(setting, rawValue) {
  const cfg = SUN_EDIT_CONFIG[setting];
  if (!cfg) return;
  const next = quantizeSunEditValue(setting, clampSunEditValue(setting, rawValue));
  if (setting === 'scale') {
    targetScale = next;
    if (dialScale) dialScale.value = String(scaleWorldToSliderValue(targetScale));
    if (lblScale) lblScale.textContent = scaleLabelText(targetScale);
    applyDetailForCurrentView(targetScale);
    setPlanetsRenderable(true);
  } else if (setting === 'warp') {
    timeWarp = next;
    if (dialWarp) dialWarp.value = String(timeWarp);
    if (lblWarp) lblWarp.textContent = timeWarp === 0 ? 'TIME WARP  PAUSED' : `TIME WARP  ${timeWarp.toFixed(2)}×`;
  }
  syncSunRadialReadouts();
}
function hideSunRadialEditor() {
  _prevSunEdCx = _prevSunEdCy = _prevSunEdRing = null;
  if (sunRadialEditorEl) sunRadialEditorEl.style.display = 'none';
  sunRadialState.visible = false;
  sunRadialState.dragSetting = null;
  sunRadialState.dragPointerId = null;
  sunRadialState.dragPointerStartDeg = null;
  sunRadialState.dragValueStartDeg = null;
  sunRadialState.dragLastPointerDeg = null;
  sunRadialState.dragAngleAccum = 0;
  sunRadialDismissed = true;
  document.body.classList.remove('sun-radial-edit-active');
  sunSelectionHalo.visible = false;
  sunSelectionRing.visible = false;
  updateSunRadialFocusVisuals();
}
function updateSunRadialKnobPositions() {
  if (!sunRadialEditorEl) return;
  const r = sunRadialState.knobRadius;
  const sc = targetScale, wp = timeWarp;
  if (r !== _prevSunKnobR || sc !== _prevSunKnobScale || wp !== _prevSunKnobWarp) {
    _prevSunKnobR = r; _prevSunKnobScale = sc; _prevSunKnobWarp = wp;
    ['scale', 'warp'].forEach(setting => {
      const knob = sunRadialKnobEls[setting];
      const cfg = SUN_EDIT_CONFIG[setting];
      if (!knob || !cfg) return;
      const value = valueFromSunSetting(setting);
      const t = (value - cfg.min) / Math.max(1e-6, cfg.max - cfg.min);
      const deg = sunEditTToAngle(setting, t);
      const rad = deg * Math.PI / 180;
      knob.style.left = `${(Math.cos(rad) * r).toFixed(1)}px`;
      knob.style.top = `${(Math.sin(rad) * r).toFixed(1)}px`;
    });
  }
  updateSunRadialFocusVisuals();
}
function updateSunSelectionEditor() {
  const shouldShow =
    cameraMode === 'sun' &&
    !walkMode.active &&
    !sunRadialDismissed &&
    currentDestIndex === 0 &&
    !isNavigating;
  if (!shouldShow) {
    sunSelectionHalo.visible = false;
    sunSelectionRing.visible = false;
    hideSunRadialEditor();
    return;
  }
  document.body.classList.add('sun-radial-edit-active');
  sunGroup.getWorldPosition(_sunEditorCenterWorld);
  const radiusWorld = SUN_R * 5.5;
  sunSelectionHalo.visible = true;
  sunSelectionHalo.position.copy(_sunEditorCenterWorld);
  sunSelectionHalo.scale.setScalar(radiusWorld * 1.12);

  sunSelectionRing.visible = true;
  sunSelectionRing.position.copy(_sunEditorCenterWorld);
  sunSelectionRing.quaternion.copy(camera.quaternion);
  const ringRadius = radiusWorld * 1.32;
  sunSelectionRing.scale.set(ringRadius, ringRadius, ringRadius);

  _planetEditorNdc.copy(_sunEditorCenterWorld).project(camera);
  const depthOutOfRange = _planetEditorNdc.z < -1 || _planetEditorNdc.z > 1;
  if (depthOutOfRange) {
    hideSunRadialEditor();
    return;
  }
  const vw = _vwCache;
  const vh = _vhCache;
  const projectedCx = (_planetEditorNdc.x * 0.5 + 0.5) * vw;
  const projectedCy = (-_planetEditorNdc.y * 0.5 + 0.5) * vh;
  if (!Number.isFinite(projectedCx) || !Number.isFinite(projectedCy)) {
    hideSunRadialEditor();
    return;
  }
  const cx = projectedCx;
  const cy = projectedCy;

  camera.matrixWorld.extractBasis(_planetEditorCamRight, _planetEditorCamUp, _planetEditorCamForward);
  _planetEditorEdgeWorld.copy(_sunEditorCenterWorld).addScaledVector(_planetEditorCamRight.normalize(), radiusWorld);
  _planetEditorEdgeNdc.copy(_planetEditorEdgeWorld).project(camera);
  const ex = (_planetEditorEdgeNdc.x * 0.5 + 0.5) * vw;
  const ey = (-_planetEditorEdgeNdc.y * 0.5 + 0.5) * vh;
  const projectedRadius = Number.isFinite(ex) && Number.isFinite(ey)
    ? Math.max(26, Math.hypot(ex - cx, ey - cy))
    : 64;
  const narrow = isNarrowPlanetUI();
  const shortSide = Math.min(vw, vh);
  const ringMinPx = narrow ? 132 : 156;
  const ringMaxPx = narrow
    ? Math.min(292, shortSide * 0.54)
    : Math.min(560, shortSide * 0.74);
  const ringFromProjection = projectedRadius * 2.85;
  const ringSize = Math.max(ringMinPx, Math.min(ringMaxPx, ringFromProjection));

  if (sunRadialEditorEl) {
    sunRadialEditorEl.style.display = 'block';
    if (_prevSunEdCx === null || Math.abs(cx - _prevSunEdCx) > 0.05 || Math.abs(cy - _prevSunEdCy) > 0.05 || Math.abs(ringSize - _prevSunEdRing) > 0.05) {
      sunRadialEditorEl.style.left = `${cx.toFixed(1)}px`;
      sunRadialEditorEl.style.top = `${cy.toFixed(1)}px`;
      sunRadialEditorEl.style.setProperty('--pre-size', `${ringSize.toFixed(1)}px`);
      _prevSunEdCx = cx; _prevSunEdCy = cy; _prevSunEdRing = ringSize;
    }
  }
  sunRadialState.visible = true;
  sunRadialState.centerX = cx;
  sunRadialState.centerY = cy;
  sunRadialState.knobRadius = ringSize * 0.5;
  syncSunRadialReadouts();
  updateSunRadialKnobPositions();
}
function updateSunSettingFromPointer(clientX, clientY, setting) {
  const cfg = SUN_EDIT_CONFIG[setting];
  if (!cfg) return;
  const dx = clientX - sunRadialState.centerX;
  const dy = clientY - sunRadialState.centerY;
  if (dx * dx + dy * dy < 25) return;
  const pointerDeg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  let deg;
  if (sunRadialState.dragPointerStartDeg !== null && sunRadialState.dragValueStartDeg !== null) {
    const step = ((pointerDeg - sunRadialState.dragLastPointerDeg + 540) % 360) - 180;
    sunRadialState.dragLastPointerDeg = pointerDeg;
    sunRadialState.dragAngleAccum += step;
    deg = sunRadialState.dragValueStartDeg + sunRadialState.dragAngleAccum;
  } else {
    deg = pointerDeg;
  }
  const t = softenRadialT(sunEditAngleToT(setting, deg));
  const value = cfg.min + t * (cfg.max - cfg.min);
  applySunEditSetting(setting, value);
}

function syncPlanetCount() {
  if (planetCountEl) planetCountEl.textContent = String(managedPlanets.length);
}

function canCreateMoonFromSelection() {
  if (selectedPlanetIdx === null) return false;
  return !!managedPlanets[selectedPlanetIdx];
}

function addPlanetFromSelectionUi() {
  const baseRadius = 0.5 + Math.random() * 0.6;
  const slot = reserveSolarOrbitSlot(baseRadius, 1.0);
  if (!slot) return;
  const orbitSpeed = (Math.random() < 0.5 ? -1 : 1) * Math.sqrt(SOLAR_MU / Math.pow(slot.radius, 3));
  const newIdx = createSunOrbitPlanet({
    baseRadius,
    orbitR: slot.radius,
    orbitSpeed,
    orbitAngle: slot.angle,
    orbitInclination: slot.inc ?? 0,
    slotKey: slot.key,
  });
  rebuildPlanetList();
  selectPlanet(newIdx);
}

function addMoonFromSelectionUi() {
  if (cameraMode !== 'planet' || !canCreateMoonFromSelection()) return;
  const newIdx = createPlanetMoonOrbit(selectedPlanetIdx);
  if (newIdx === null) return;
  rebuildPlanetList();
  selectPlanet(newIdx);
}

function updateTwinButtonVisibility() {
  if (!addTwinBtn) return;
  const inPlanetView = cameraMode === 'planet';
  addTwinBtn.style.display = inPlanetView ? '' : 'none';
  const canTwin = inPlanetView && canCreateMoonFromSelection();
  addTwinBtn.disabled = !canTwin;
}

function canWalkFromSelection() {
  return managedPlanets.some(mp => !!mp?.obj?.pivot);
}

function updateWalkButtonVisibility() {
  if (!btnWalk) return;
  const inPlanetView = cameraMode === 'planet';
  btnWalk.style.display = inPlanetView ? '' : 'none';
  btnWalk.disabled = !inPlanetView || !canWalkFromSelection();
  refreshWalkUi();
}

let _narrowUiCache = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 768px)').matches;
let _vwCache = window.innerWidth, _vhCache = window.innerHeight;
{
  const _mq768 = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 768px)') : null;
  if (_mq768) _mq768.addEventListener('change', e => { _narrowUiCache = e.matches; });
  window.addEventListener('resize', () => { _vwCache = window.innerWidth; _vhCache = window.innerHeight; });
}
let _prevPlanetEdCx = null, _prevPlanetEdCy = null, _prevPlanetEdRing = null;
let _prevSunEdCx = null, _prevSunEdCy = null, _prevSunEdRing = null;
let _prevPlanetReadoutMpId = null, _prevPlanetReadoutSize = null, _prevPlanetReadoutPeak = null, _prevPlanetReadoutWater = null;
let _prevPlanetKnobR = null, _prevPlanetKnobSize = null, _prevPlanetKnobPeak = null, _prevPlanetKnobWater = null;
let _prevSunKnobR = null, _prevSunKnobScale = null, _prevSunKnobWarp = null;
let _prevPlanetFocusDrag = undefined, _prevSunFocusDrag = undefined;
function isNarrowPlanetUI() { return _narrowUiCache; }

function setPlanetPanelOpen(open) {
  if (!planetPanel || !isNarrowPlanetUI()) return;
  planetPanel.classList.toggle('pp-open', open);
  if (planetPanelToggle) planetPanelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function waterLabelText(wl) {
  const level = Math.max(-1, Math.min(1, wl));
  const pct = Math.round(Math.abs(level) * 100);
  if (level > 0.0001) return `Water ${pct}%`;
  if (level < -0.0001) return `Lava ${pct}%`;
  return 'Water/Lava 0%';
}

if (planetPanelToggle) {
  planetPanelToggle.addEventListener('click', e => {
    e.stopPropagation();
    if (!isNarrowPlanetUI()) return;
    setPlanetPanelOpen(!planetPanel.classList.contains('pp-open'));
  });
}
if (planetPanelHeader) {
  planetPanelHeader.addEventListener('click', e => {
    if (!isNarrowPlanetUI()) return;
    if (e.target.closest('#add-planet-btn')) return;
    if (e.target.closest('#add-twin-btn')) return;
    if (e.target.closest('#planet-panel-toggle')) return;
    setPlanetPanelOpen(!planetPanel.classList.contains('pp-open'));
  });
}

function selectPlanet(idx) {
  selectedPlanetIdx = idx;
  panOffset.set(0, 0, 0);
  rebuildPlanetList();
  const mp = idx !== null && idx !== undefined ? managedPlanets[idx] : null;
  if (typeof resetPlanetViewShellRadiusSmoothed === 'function') resetPlanetViewShellRadiusSmoothed();
  if (editPanel) editPanel.style.display = 'none';
  if (mp) {
    syncPlanetDialValues(mp);
    syncPlanetEditReadouts(mp);
  }
  if (!mp || mp.isBinary || mp.orbitCenter !== 'sun') syncSunOrbitEditorUi(null);
  else syncSunOrbitEditorUi(mp);
  setPlanetPanelOpen(false);
  updateTwinButtonVisibility();
  updateWalkButtonVisibility();
  updatePlanetSelectionEditor();
  rebuildGalaxyMenu();
}

dialSizeE.addEventListener('input',  () => applyPlanetEditSetting('size',  parseFloat(dialSizeE.value),  true));
dialPeakE.addEventListener('input',  () => applyPlanetEditSetting('peak',  parseFloat(dialPeakE.value),  true));
dialWaterE.addEventListener('input', () => applyPlanetEditSetting('water', parseFloat(dialWaterE.value), true));
// On release: full rebuild restores vegetation to correct positions.
const _restoreVegOnDialRelease = () => {
  const mp = selectedPlanetIdx !== null ? managedPlanets[selectedPlanetIdx] : null;
  if (mp) rebuildManagedPlanetTerrain(mp);
};
if (dialSizeE) {
  dialSizeE.addEventListener('change', () => {
    _restoreVegOnDialRelease();
    if (typeof resetPlanetViewShellRadiusSmoothed === 'function') resetPlanetViewShellRadiusSmoothed();
  });
}
if (dialPeakE)  dialPeakE.addEventListener('change',  _restoreVegOnDialRelease);
if (dialWaterE) dialWaterE.addEventListener('change', _restoreVegOnDialRelease);

if (dialSunOrbitREl) dialSunOrbitREl.addEventListener('input', () => { applySunOrbitFromSliders(); });
if (dialSunOrbitTiltDegEl) dialSunOrbitTiltDegEl.addEventListener('input', () => { applySunOrbitFromSliders(); });

// Add planet button (next free sun-orbit slot)
addPlanetBtn.addEventListener('click', e => {
  e.stopPropagation();
  addPlanetFromSelectionUi();
});

// Add moon button (planetary orbit around selected planet)
addTwinBtn.addEventListener('click', e => {
  e.stopPropagation();
  addMoonFromSelectionUi();
});

let lastWalkButtonPressMs = 0;
async function onWalkButtonPressed(e) {
  const now = performance.now();
  if (now - lastWalkButtonPressMs < 450) return;
  lastWalkButtonPressMs = now;
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  if (walkTransition.active) return;
  if (walkMode.active) {
    stopWalkMode();
    updateWalkButtonVisibility();
    return;
  }
  if (cameraMode !== 'planet') {
    skipNextOrbitSyncForSetCamMode = true;
    setCamMode('planet');
  }
  if (typeof trySelectPlanetForWalkStart === 'function') trySelectPlanetForWalkStart();
  const resolved = resolveWalkStartPlanetAndSpawn();
  if (!resolved) return;
  const { idx, spawn } = resolved;
  if (selectedPlanetIdx !== idx) selectPlanet(idx);
  await transitionCameraToWalkSpawn(spawn);
  if (!walkMode.active && typeof syncOrbitStateFromActualCamera === 'function') {
    syncOrbitStateFromActualCamera(typeof curScale !== 'undefined' ? curScale : 1);
  }
  startWalkMode(idx, spawn);
  updateWalkButtonVisibility();
}
btnWalk.addEventListener('pointerup', onWalkButtonPressed);
btnWalk.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') onWalkButtonPressed(e);
});

function setWalkInputFlag(key, down) {
  if (key === 'left') walkInput.left = down;
  if (key === 'right') walkInput.right = down;
  if (key === 'forward') walkInput.fwd = down;
  if (key === 'back') walkInput.back = down;
  if (key === 'jump' && down) queueWalkJump();
  if (key === 'view' && down) toggleWalkCameraMode();
}

if (walkControlsEl) {
  walkControlsEl.querySelectorAll('button[data-walk]').forEach(btn => {
    const key = btn.getAttribute('data-walk');
    if (key === 'runLock') return;
    const down = e => { e.preventDefault(); setWalkInputFlag(key, true); };
    const up = e => { e.preventDefault(); setWalkInputFlag(key, false); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  });
  const runLockBtn = walkControlsEl.querySelector('button[data-walk="runLock"]');
  if (runLockBtn) {
    const toggleRunLock = e => {
      if (!walkMode.active) return;
      e.preventDefault();
      e.stopPropagation();
      walkInput.runLocked = !walkInput.runLocked;
      runLockBtn.classList.toggle('active', walkInput.runLocked);
      runLockBtn.setAttribute('aria-pressed', walkInput.runLocked ? 'true' : 'false');
    };
    runLockBtn.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      toggleRunLock(e);
    });
  }
}
if (walkJoystickEl) {
  const onJoyDown = e => {
    if (!walkMode.active) return;
    e.preventDefault();
    e.stopPropagation();
    walkJoystickState.pointerId = e.pointerId;
    if (typeof setWalkJoystickCapturingPointer === 'function') setWalkJoystickCapturingPointer(e.pointerId);
    try { walkJoystickEl.setPointerCapture(e.pointerId); } catch (err) {}
    sampleWalkJoystickPointer(e.clientX, e.clientY);
  };
  const onJoyMove = e => {
    if (!walkMode.active) return;
    if (walkJoystickState.pointerId !== e.pointerId) return;
    e.preventDefault();
    sampleWalkJoystickPointer(e.clientX, e.clientY);
  };
  const onJoyUp = e => {
    if (walkJoystickState.pointerId !== e.pointerId) return;
    e.preventDefault();
    try { walkJoystickEl.releasePointerCapture(e.pointerId); } catch (err) {}
    resetWalkJoystick();
  };
  walkJoystickEl.addEventListener('pointerdown', onJoyDown);
  walkJoystickEl.addEventListener('pointermove', onJoyMove);
  walkJoystickEl.addEventListener('pointerup', onJoyUp);
  walkJoystickEl.addEventListener('pointercancel', onJoyUp);
  window.addEventListener('pointerup', onJoyUp);
  window.addEventListener('pointercancel', onJoyUp);
  const noteJoyTouch = (e, down) => {
    if (typeof registerWalkJoystickTouch !== 'function') return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      registerWalkJoystickTouch(e.changedTouches[i].identifier, down);
    }
  };
  walkJoystickEl.addEventListener('touchstart', e => noteJoyTouch(e, true), { passive: true });
  walkJoystickEl.addEventListener('touchend', e => noteJoyTouch(e, false), { passive: true });
  walkJoystickEl.addEventListener('touchcancel', e => noteJoyTouch(e, false), { passive: true });
}
if (planetRadialEditorEl) {
  const onKnobDown = (e, setting) => {
    if (selectedPlanetIdx === null || !planetRadialState.visible) return;
    e.preventDefault();
    e.stopPropagation();
    planetRadialState.dragSetting = setting;
    planetRadialState.dragPointerId = e.pointerId;
    const mp = managedPlanets[selectedPlanetIdx];
    const cfg = PLANET_EDIT_CONFIG[setting];
    if (mp && cfg) {
      const v = valueFromPlanetSetting(mp, setting);
      const startT = (v - cfg.min) / Math.max(1e-6, cfg.max - cfg.min);
      planetRadialState.dragValueStartDeg = planetEditTToAngle(setting, startT);
      const dx = e.clientX - planetRadialState.centerX;
      const dy = e.clientY - planetRadialState.centerY;
      planetRadialState.dragPointerStartDeg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      planetRadialState.dragLastPointerDeg = planetRadialState.dragPointerStartDeg;
      planetRadialState.dragAngleAccum = 0;
    } else {
      planetRadialState.dragPointerStartDeg = null;
      planetRadialState.dragValueStartDeg = null;
      planetRadialState.dragLastPointerDeg = null;
      planetRadialState.dragAngleAccum = 0;
    }
    updatePlanetRadialFocusVisuals();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    updatePlanetSelectionEditor();
  };
  const onKnobMove = e => {
    if (planetRadialState.dragPointerId !== e.pointerId || !planetRadialState.dragSetting) return;
    e.preventDefault();
    updatePlanetSettingFromPointer(e.clientX, e.clientY, planetRadialState.dragSetting);
  };
  const onKnobUp = e => {
    if (planetRadialState.dragPointerId !== e.pointerId) return;
    e.preventDefault();
    const endedSetting = planetRadialState.dragSetting;
    planetRadialState.dragSetting = null;
    planetRadialState.dragPointerId = null;
    planetRadialState.dragPointerStartDeg = null;
    planetRadialState.dragValueStartDeg = null;
    planetRadialState.dragLastPointerDeg = null;
    planetRadialState.dragAngleAccum = 0;
    Object.values(planetRadialKnobEls).forEach(knob => {
      try { knob?.releasePointerCapture?.(e.pointerId); } catch (err) {}
    });
    updatePlanetRadialFocusVisuals();
    if (endedSetting === 'size') {
      finalizePlanetSizeAfterRadialDrag();
    } else if (endedSetting) {
      // peak / water were rebuilt at preview detail during drag — snap to full quality now.
      const mp = selectedPlanetIdx !== null ? managedPlanets[selectedPlanetIdx] : null;
      if (mp) rebuildManagedPlanetTerrain(mp);
    }
  };
  Object.entries(planetRadialKnobEls).forEach(([setting, knob]) => {
    if (!knob) return;
    knob.addEventListener('pointerdown', e => onKnobDown(e, setting));
    knob.addEventListener('pointermove', onKnobMove);
    knob.addEventListener('pointerup', onKnobUp);
    knob.addEventListener('pointercancel', onKnobUp);
  });
  window.addEventListener('pointerup', onKnobUp);
  window.addEventListener('pointercancel', onKnobUp);
  if (planetRadialCloseBtn) {
    planetRadialCloseBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      selectPlanet(null);
    });
  }
}
if (sunRadialEditorEl) {
  const onSunKnobDown = (e, setting) => {
    if (!sunRadialState.visible) return;
    e.preventDefault();
    e.stopPropagation();
    sunRadialState.dragSetting = setting;
    sunRadialState.dragPointerId = e.pointerId;
    const cfg = SUN_EDIT_CONFIG[setting];
    if (cfg) {
      const v = valueFromSunSetting(setting);
      const startT = (v - cfg.min) / Math.max(1e-6, cfg.max - cfg.min);
      sunRadialState.dragValueStartDeg = sunEditTToAngle(setting, startT);
      const dx = e.clientX - sunRadialState.centerX;
      const dy = e.clientY - sunRadialState.centerY;
      sunRadialState.dragPointerStartDeg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      sunRadialState.dragLastPointerDeg = sunRadialState.dragPointerStartDeg;
      sunRadialState.dragAngleAccum = 0;
    } else {
      sunRadialState.dragPointerStartDeg = null;
      sunRadialState.dragValueStartDeg = null;
      sunRadialState.dragLastPointerDeg = null;
      sunRadialState.dragAngleAccum = 0;
    }
    updateSunRadialFocusVisuals();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    updateSunSelectionEditor();
  };
  const onSunKnobMove = e => {
    if (sunRadialState.dragPointerId !== e.pointerId || !sunRadialState.dragSetting) return;
    e.preventDefault();
    updateSunSettingFromPointer(e.clientX, e.clientY, sunRadialState.dragSetting);
  };
  const onSunKnobUp = e => {
    if (sunRadialState.dragPointerId !== e.pointerId) return;
    e.preventDefault();
    sunRadialState.dragSetting = null;
    sunRadialState.dragPointerId = null;
    sunRadialState.dragPointerStartDeg = null;
    sunRadialState.dragValueStartDeg = null;
    sunRadialState.dragLastPointerDeg = null;
    sunRadialState.dragAngleAccum = 0;
    Object.values(sunRadialKnobEls).forEach(knob => {
      try { knob?.releasePointerCapture?.(e.pointerId); } catch (err) {}
    });
    updateSunRadialFocusVisuals();
  };
  Object.entries(sunRadialKnobEls).forEach(([setting, knob]) => {
    if (!knob) return;
    knob.addEventListener('pointerdown', e => onSunKnobDown(e, setting));
    knob.addEventListener('pointermove', onSunKnobMove);
    knob.addEventListener('pointerup', onSunKnobUp);
    knob.addEventListener('pointercancel', onSunKnobUp);
  });
  window.addEventListener('pointerup', onSunKnobUp);
  window.addEventListener('pointercancel', onSunKnobUp);
  if (sunRadialCloseBtn) {
    sunRadialCloseBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      hideSunRadialEditor();
    });
  }
}
updateWalkJoystickThumb();

window.addEventListener('keydown', e => {
  if (!walkMode.active) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') walkInput.fwd = true;
  if (k === 's' || k === 'arrowdown') walkInput.back = true;
  if (k === 'a' || k === 'arrowleft') walkInput.left = true;
  if (k === 'd' || k === 'arrowright') walkInput.right = true;
  walkInput.shiftRun = e.shiftKey;
  if (k === ' ') queueWalkJump();
  if (k === 'v' || k === 'c') toggleWalkCameraMode();
  if (k === 'escape') {
    stopWalkMode();
    updateWalkButtonVisibility();
  }
  if (['w','a','s','d',' ','shift','v','c','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
});

window.addEventListener('keyup', e => {
  if (!walkMode.active) return;
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup') walkInput.fwd = false;
  if (k === 's' || k === 'arrowdown') walkInput.back = false;
  if (k === 'a' || k === 'arrowleft') walkInput.left = false;
  if (k === 'd' || k === 'arrowright') walkInput.right = false;
  walkInput.shiftRun = e.shiftKey;
});

window.addEventListener('blur', () => {
  walkInput.shiftRun = false;
});

rebuildPlanetList();
updateTwinButtonVisibility();
updateWalkButtonVisibility();
if (isNarrowPlanetUI()) setPlanetPanelOpen(false);
// Initial terrain rebuild runs from 30-camera-ui-loop.js after `gridOn` exists — syncGrid()
// reads gridOn; running rebuild here (before script 30) could throw and leave binary planets
// on their createPlanet() placeholder detail.

