// ── Camera view buttons (Solar / Planet views: tap sun or a planet on canvas) ──
function setCamMode(mode) {
  if (mode !== 'planet' && walkMode.active) stopWalkMode();
  if (mode === 'planet') {
    hideSunRadialEditor();
    solGalaxyMenuRevealed = true;
  }
  cameraMode = mode;
  document.body.classList.toggle('mode-planet-view', mode === 'planet');
  applyDetailForCurrentView(targetScale);
  setPlanetsRenderable(true);
  updateTwinButtonVisibility();
  updateWalkButtonVisibility();
  galaxyList.classList.remove('open');
  galaxyBtn.classList.remove('open');
  rebuildGalaxyMenu();
  syncSolGalaxyMenuVisibility();
  if (!walkMode.active && !skipNextOrbitSyncForSetCamMode) {
    syncOrbitStateFromActualCamera(curScale);
  }
  skipNextOrbitSyncForSetCamMode = false;
}
const btnGrid = document.getElementById('btn-grid');
let gridOn = true;
if (btnGrid) {
  btnGrid.addEventListener('click', () => {
    gridOn = !gridOn;
    btnGrid.classList.toggle('active', gridOn);
    managedPlanets.forEach(mp => mp.obj.setGrid(gridOn));
  });
}

// Binary + registered planets: first terrain LOD/snap pass (see rebuildManagedPlanetTerrain in
// 10-world-geometry.js). Must run after `gridOn` is initialized — planet wire syncGrid() reads it.
// Runs even if #btn-grid is missing so Sol bodies are not stuck on createPlanet() placeholder meshes.
if (typeof rebuildAllManagedPlanetTerrainMeshes === 'function') rebuildAllManagedPlanetTerrainMeshes();

// ── Camera settings panel ─────────────────────────────────────────
const btnCamSettings = document.getElementById('btn-cam-settings');
const camSettingsEl  = document.getElementById('cam-settings');
if (btnCamSettings && camSettingsEl) {
  btnCamSettings.addEventListener('click', () => {
    const open = camSettingsEl.classList.toggle('open');
    btnCamSettings.classList.toggle('active', open);
  });
}

/** While walking: hide grid + cam settings, turn grid off; restore when leaving walk. */
let _gridStateBeforeWalk = null;
function syncWalkModeChrome(walkActive) {
  if (!btnGrid || !btnCamSettings) return;
  if (walkActive) {
    btnGrid.style.display = 'none';
    btnCamSettings.style.display = 'none';
    if (camSettingsEl && camSettingsEl.classList.contains('open')) {
      camSettingsEl.classList.remove('open');
      btnCamSettings.classList.remove('active');
    }
    if (_gridStateBeforeWalk === null) {
      _gridStateBeforeWalk = gridOn;
    }
    if (gridOn) {
      gridOn = false;
      btnGrid.classList.remove('active');
      managedPlanets.forEach(mp => mp.obj.setGrid(false));
    }
  } else {
    btnGrid.style.display = '';
    btnCamSettings.style.display = '';
    if (_gridStateBeforeWalk !== null) {
      const restore = _gridStateBeforeWalk;
      _gridStateBeforeWalk = null;
      if (gridOn !== restore) {
        gridOn = restore;
        btnGrid.classList.toggle('active', gridOn);
        managedPlanets.forEach(mp => mp.obj.setGrid(gridOn));
      }
    }
  }
}

// FOV
const csFov = document.getElementById('cs-fov');
const csLblFov = document.getElementById('cs-lbl-fov');
csFov.addEventListener('input', () => {
  const v = parseFloat(csFov.value);
  camera.fov = v;
  camera.updateProjectionMatrix();
  csLblFov.textContent = `FOV  ${v}°`;
});

// Orbit speed
const csSpeed = document.getElementById('cs-speed');
const csLblSpeed = document.getElementById('cs-lbl-speed');
csSpeed.addEventListener('input', () => {
  orbitSpeedMul = parseFloat(csSpeed.value);
  csLblSpeed.textContent = `Orbit Speed  ${orbitSpeedMul.toFixed(1)}×`;
});

// Zoom speed
const csZoom = document.getElementById('cs-zoom');
const csLblZoom = document.getElementById('cs-lbl-zoom');
csZoom.addEventListener('input', () => {
  zoomSpeedMul = parseFloat(csZoom.value);
  csLblZoom.textContent = `Zoom Speed  ${zoomSpeedMul.toFixed(1)}×`;
});

// Auto-rotate toggle
const csRotOn  = document.getElementById('cs-rot-on');
const csRotOff = document.getElementById('cs-rot-off');
function setAutoRotate(v) {
  autoRotate = v;
  csRotOn.classList.toggle('on', v);
  csRotOff.classList.toggle('on', !v);
}
csRotOn.addEventListener('click',  () => setAutoRotate(true));
csRotOff.addEventListener('click', () => setAutoRotate(false));

// Match Three.js + runtime to panel defaults (all devices start at minimum cam settings)
camera.fov = parseFloat(csFov.value);
camera.updateProjectionMatrix();
csLblFov.textContent = `FOV  ${camera.fov}°`;
orbitSpeedMul = parseFloat(csSpeed.value);
csLblSpeed.textContent = `Orbit Speed  ${orbitSpeedMul.toFixed(1)}×`;
zoomSpeedMul = parseFloat(csZoom.value);
csLblZoom.textContent = `Zoom Speed  ${zoomSpeedMul.toFixed(1)}×`;
setAutoRotate(true);

// ── Animate ───────────────────────────────────────────────────────
let currentDestIndex = 0;
let isNavigating     = false;
const SYSTEM_FIT_ZOOM = 3.0; // match Sol-system framing at rest
const BASE_DT = 1 / 60;
const TIME_WARP_BASE_SCALE = 0.06; // Maps UI warp × to sim speed; halved vs prior 0.12 for slower default pacing.

function getSimulationWarp(uiWarp) {
  return Math.max(0, uiWarp) * TIME_WARP_BASE_SCALE;
}

let _prevWireOpacity = -1;
let _vegWalkWasActive = false;

function animate() {
  requestAnimationFrame(animate);

  // Smooth zoom toward target in log-space (perceptually uniform speed)
  if (zoomTarget !== null) {
    const logCur = Math.log(orbitZoom);
    const logTgt = Math.log(zoomTarget);
    if (Math.abs(logCur - logTgt) < 0.005) {
      orbitZoom = zoomTarget;
      zoomTarget = null;
      introZoomProfile = null;
      resetOrbitPointerInertia();
    } else {
      let zoomLerp = 0.008;
      if (introZoomProfile) {
        if (Math.abs(logTgt - introZoomProfile.targetLog) < 1e-6) {
          // Intro request: ease in slower, stay calm mid-way, then finish faster.
          const span = Math.max(1e-5, introZoomProfile.startLog - introZoomProfile.targetLog);
          const progress = Math.max(0, Math.min(1, (introZoomProfile.startLog - logCur) / span));
          const accel = Math.pow(progress, 3.2);
          zoomLerp = 0.0048 + accel * 0.023;
        } else {
          introZoomProfile = null;
        }
      }
      orbitZoom = Math.exp(logCur + (logTgt - logCur) * zoomLerp);
    }
  } else if (introZoomProfile) {
    introZoomProfile = null;
  }

  // Smooth scale lerp (camera/universe view only; objects keep real size)
  curScale += (targetScale - curScale) * 0.08;
  setPlanetsRenderable(true);

  // Fade dense wire edges at long zoom-out ranges to prevent distance shimmer.
  const curScaleUi = scaleWorldToUi(curScale);
  const wireFade = cameraMode === 'planet' ? 1 : Math.max(0, 1 - (curScaleUi - 8) / 44);
  const wireOpacity = 0.25 * wireFade;
  if (wireOpacity !== _prevWireOpacity) {
    managedPlanets.forEach(mp => mp.obj.setWireOpacity?.(wireOpacity));
    _prevWireOpacity = wireOpacity;
  }

  const simWarp = getSimulationWarp(timeWarp);
  if (simWarp > 0) {
    const dt    = BASE_DT * simWarp;
    const steps = Math.max(1, Math.min(48, Math.ceil(Math.sqrt(simWarp) * 6)));
    const mass1 = BASE_M1 * Math.pow(Math.max(p1.state.size, 0.2), 3);
    const mass2 = BASE_M2 * Math.pow(Math.max(p2.state.size, 0.2), 3);
    const deferBinarySizeRadial =
      planetRadialState.dragSetting === 'size' &&
      selectedPlanetIdx !== null &&
      !!managedPlanets[selectedPlanetIdx]?.isBinary;
    const massesChanged =
      Math.abs(mass1 - binaryPrevMass1) > 1e-8 ||
      Math.abs(mass2 - binaryPrevMass2) > 1e-8;
    if (massesChanged && !deferBinarySizeRadial) {
      refreshBinaryPairForMassChange(mass1, mass2);
      binaryPrevMass1 = mass1;
      binaryPrevMass2 = mass2;
    }

    // Binary pair orbits around its COM with mass-driven mutual pattern.
    for (let i = 0; i < steps; i++) applyBinaryPairState(mass1, mass2, dt / steps);

    // Binary heliocentric orbit remains fixed regardless of size edits.
    comAngle += COM_OMEGA * dt;

    sunSpin += 0.0004 * simWarp;

    // Sun-orbiting planets: sun-only gravity (no inter-planet gravity between independent planets).
    // Twin/moon behavior remains in their dedicated parent-orbit logic below.
    const sunOrbiters = managedPlanets.filter(mp => !mp.isBinary && mp.orbitCenter === 'sun');
    const subSteps = Math.max(2, Math.min(64, steps * 2));
    const subDt = dt / subSteps;
    const acc = sunOrbiters.map(() => new THREE.Vector3());
    for (let k = 0; k < subSteps; k++) {
      sunOrbiters.forEach((mp, i) => {
        initializeSunOrbiterState(mp);
        const pos = mp.orbitPos;
        const r2 = pos.x*pos.x + pos.y*pos.y + pos.z*pos.z + ORBIT_SOFTENING;
        const invR3 = 1 / (r2 * Math.sqrt(r2));
        // Sun gravity
        acc[i].set(
          -SOLAR_MU * pos.x * invR3,
          -SOLAR_MU * pos.y * invR3,
          -SOLAR_MU * pos.z * invR3
        );
      });
      sunOrbiters.forEach((mp, i) => {
        mp.orbitVel.addScaledVector(acc[i], subDt);
        mp.orbitPos.addScaledVector(mp.orbitVel, subDt);
        applySunOrbiterBounds(mp);
      });
      enforceSunOrbiterNoOverlap(sunOrbiters);
    }
    sunOrbiters.forEach(mp => {
      const r = Math.max(mp.orbitPos.length(), SUN_ORBIT_MIN_R);
      mp.orbitR = r;
      mp.angle = Math.atan2(mp.orbitPos.z, mp.orbitPos.x);
      ensureSunOrbiterPlaneNormal(mp);
      _sunHelioRxv.copy(mp.orbitPos).cross(mp.orbitVel);
      const n = mp.orbitPlaneNormal;
      let omegaSigned = r > 1e-7 && n ? _sunHelioRxv.dot(n) / (r * r) : 0;
      if (!Number.isFinite(omegaSigned)) omegaSigned = 0;
      mp.orbitSpeed = omegaSigned;
      mp.obj.pivot.position.set(mp.orbitPos.x, mp.orbitPos.y, mp.orbitPos.z);
    });

    // Planetary orbiters (moons): orbit around parent planets but remain sun-bound via Hill limits.
    const moonOrbiters = managedPlanets.filter(mp => !mp.isBinary && mp.orbitCenter === 'planet' && mp.orbitParentId !== null);
    moonOrbiters.forEach(mp => {
      const parent = managedPlanets[mp.orbitParentId];
      if (!parent) return;
      parent.obj.pivot.getWorldPosition(_orbitParentWorld);
      const parentSunR = Math.max(Math.hypot(_orbitParentWorld.x, _orbitParentWorld.z), SUN_ORBIT_MIN_R);
      const parentMass = Math.max(getPlanetMass(parent), 0.2);
      const parentRadius = Math.max((parent.obj.baseRadius || 0.8) * parent.obj.state.size, 0.25);
      const hillR = parentSunR * Math.cbrt(parentMass / (3 * SOLAR_MU));
      const maxMoonR = Math.max(parentRadius * 1.6, Math.min(12, hillR * 0.45));
      const minMoonR = Math.max(parentRadius * 1.2, 0.45);
      mp.orbitR = Math.max(minMoonR, Math.min(maxMoonR, mp.orbitR));
      const r = Math.max(mp.orbitR, 0.5);
      const tideFactor = Math.max(0.62, 1 - 0.28 * (r / Math.max(maxMoonR, 0.5)));
      const targetSpeed = Math.sign(mp.orbitSpeed || 1) * Math.sqrt((0.35 + parentMass * 0.3) / Math.pow(r, 3)) * tideFactor;
      const blend = Math.min(1, 6 * dt);
      mp.orbitSpeed += (targetSpeed - mp.orbitSpeed) * blend;
      mp.angle += mp.orbitSpeed * dt;
    });

    // Spin dynamics: size, orbit distance, and sun interaction affect rotation.
    managedPlanets.forEach(mp => {
      let spinRate = getSpinRateFromSize(mp);
      if (!mp.isBinary) {
        const dist = Math.max(mp.orbitR, 4);
        spinRate *= 1 / (1 + 0.0045 * getPlanetMass(mp) / (dist * dist));
      }
      mp.spinAngle += spinRate * simWarp;
    });
  }

  // Keep the binary COM on a fixed-radius sun orbit.
  sysGroup.position.set(SUN_ORBIT * Math.cos(comAngle), 0, SUN_ORBIT * Math.sin(comAngle));

  // Planet positions are relative to binary COM (physics units in world space)
  p1.pivot.position.copy(body[0].pos);
  p2.pivot.position.copy(body[1].pos);

  // Update moon world positions from their parent planets.
  managedPlanets.forEach(mp => {
    if (mp.orbitCenter !== 'planet' || mp.orbitParentId === null) return;
    const parent = managedPlanets[mp.orbitParentId];
    if (!parent) return;
    parent.obj.pivot.getWorldPosition(_orbitParentWorld);
    mp.obj.pivot.position.set(
      _orbitParentWorld.x + Math.cos(mp.angle) * mp.orbitR,
      _orbitParentWorld.y,
      _orbitParentWorld.z + Math.sin(mp.angle) * mp.orbitR
    );
  });

  managedPlanets.forEach(mp => {
    mp.obj.spin.rotation.y = mp.spinAngle;
  });

  // Trails — world-space positions so the heliocentric orbit is captured correctly
  const cx = sysGroup.position.x, cy = sysGroup.position.y, cz = sysGroup.position.z;
  const renderSolTrails = !isNavigating && currentDestIndex === 0;
  if (renderSolTrails) {
    pushTrail(trail1,
      cx + body[0].pos.x,
      cy + body[0].pos.y,
      cz + body[0].pos.z);
    pushTrail(trail2,
      cx + body[1].pos.x,
      cy + body[1].pos.y,
      cz + body[1].pos.z);
    managedPlanets.forEach(mp => {
      if (mp.isBinary) return;
      if (mp.orbitCenter === 'sun') {
        if (!mp.trail) ensureSunTrail(mp);
        if (!mp.trail) return;
        const p = mp.obj.pivot.position;
        pushTrail(mp.trail, p.x, p.y, p.z);
      } else if (mp.orbitCenter === 'planet') {
        if (!mp.trail) ensureMoonTrail(mp);
        if (!mp.trail) return;
        const p = mp.obj.pivot.position;
        pushTrail(mp.trail, p.x, p.y, p.z);
      }
    });
  }

  // Gravity link line — world space
  if (renderSolTrails) {
    linkPos[0]=cx+body[0].pos.x; linkPos[1]=cy+body[0].pos.y; linkPos[2]=cz+body[0].pos.z;
    linkPos[3]=cx+body[1].pos.x; linkPos[4]=cy+body[1].pos.y; linkPos[5]=cz+body[1].pos.z;
    linkGeo.attributes.position.needsUpdate = true;
  }

  // Sun size stays fixed; scale slider no longer changes body size.
  sunGroup.scale.setScalar(SUN_R);
  sunGroup.rotation.y = sunSpin;
  updatePlanetSelectionEditor();
  updateSunSelectionEditor();
  syncSolGalaxyMenuVisibility();

  // Camera update runs after all planet/world transforms so walk mode stays planet-locked.
  updateCamera(curScale);
  updateDynamicCameraFar();

  // Show vegetation only in walk mode, on planets within viewing distance.
  if (typeof VEG !== 'undefined' && typeof managedPlanets !== 'undefined') {
    const vegWalkActive = walkMode.active;
    if (vegWalkActive || _vegWalkWasActive) {
      VEG.refreshVisibility(managedPlanets, camera.position, vegWalkActive);
    }
    _vegWalkWasActive = vegWalkActive;
  }

  renderer.render(scene, camera);
}
animate();

