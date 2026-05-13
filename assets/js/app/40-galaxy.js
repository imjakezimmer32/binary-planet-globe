// ── Galaxy destinations ───────────────────────────────────────────
// Per-system optional fields (forward-compatible):
//   audioSrc     — URL to loopable music (e.g. '/audio/foo.mp3'); omit or null = no track
//   audioVolume  — 0..1 peak gain after fade-in (default 0.78)
//   audioLoop    — default true
// Music ramps in/out over SOLAR_AUDIO_FADE_MS (5s) when entering/leaving a system or during hyperspace.
// Gate → Sol: gate fades out during intro; first astra fade is timed with splash (see splash sequence).
const GALAXY_DESTINATIONS = [
  {
    name: 'Sol System',
    dist: 'Home',
    color: 0xffffd0,
    pos: new THREE.Vector3(0, 0, 0),
    audioSrc: '/audio/astra.mp3',
    /** Peak gain after fade-in (~30% quieter than former 0.78). */
    audioVolume: 0.546,
    audioLoop: true,
  },
  { name: 'Alpha Centauri',  dist: '4.37 ly',   color: 0xffcc88, pos: new THREE.Vector3( 1800, 220, -1300) },
  { name: 'Sirius',          dist: '8.6 ly',    color: 0xaaddff, pos: new THREE.Vector3(-2100,-180,  900)  },
  { name: 'Tau Ceti',        dist: '11.9 ly',   color: 0xffee99, pos: new THREE.Vector3(-700,  450, 2600)  },
  { name: 'Kepler-442',      dist: '1,206 ly',  color: 0xff9966, pos: new THREE.Vector3( 3100,-700, 1500)  },
  { name: "Gliese 667C",     dist: '23.6 ly',   color: 0xff6644, pos: new THREE.Vector3(-1500, 600,-2300)  },
];

/** Fade duration when entering/leaving a system's music (linear volume ramp). */
const SOLAR_AUDIO_FADE_MS = 5000;

/** One player per destination (null = no track). Uses HTMLAudioElement.volume only — no Web Audio / MediaElementSource (that path often outputs silence when the context never runs). */
const solarSystemAudio = (function createSolarSystemAudio(destinations) {
  const peakVolumes = new Array(destinations.length).fill(0);
  const players = destinations.map((d, i) => {
    if (!d.audioSrc) return null;
    const peak = typeof d.audioVolume === 'number'
      ? Math.min(1, Math.max(0, d.audioVolume))
      : 0.78;
    peakVolumes[i] = peak;
    const el = new Audio(d.audioSrc);
    el.preload = 'auto';
    el.loop = d.audioLoop !== false;
    el.volume = 0;

    return { el, gain: null };
  });

  function getGain(p) {
    if (!p) return 0;
    return p.el.volume;
  }
  function setGain(p, v) {
    const x = Math.min(1, Math.max(0, v));
    p.el.volume = x;
  }

  const prevWantOn = destinations.map(() => false);
  /** @type {({ kind: 'in', t0: number, v0: number, duration?: number, easeFn?: (u: number) => number } | { kind: 'out', t0: number, v0: number } | null)[]} */
  const fadeState = destinations.map(() => null);
  let unlocked = false;
  let rafId = null;

  function tick() {
    const now = performance.now();
    let needsNext = false;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const st = fadeState[i];
      if (!p || !st) continue;
      const peak = peakVolumes[i];
      if (st.kind === 'in') {
        const dur = typeof st.duration === 'number' && st.duration > 0 ? st.duration : SOLAR_AUDIO_FADE_MS;
        const elapsed = now - st.t0;
        const tLin = Math.min(1, elapsed / dur);
        const t = typeof st.easeFn === 'function' ? st.easeFn(tLin) : tLin;
        setGain(p, st.v0 + (peak - st.v0) * t);
        if (tLin < 1) needsNext = true;
        else {
          setGain(p, peak);
          fadeState[i] = null;
        }
      } else {
        const elapsed = now - st.t0;
        const t = Math.min(1, elapsed / SOLAR_AUDIO_FADE_MS);
        setGain(p, st.v0 * (1 - t));
        if (t < 1) needsNext = true;
        else {
          setGain(p, 0);
          p.el.pause();
          fadeState[i] = null;
        }
      }
    }
    rafId = needsNext ? requestAnimationFrame(tick) : null;
  }

  function ensureTick() {
    if (rafId === null) rafId = requestAnimationFrame(tick);
  }

  function sync() {
    const activeIdx = unlocked && !isNavigating ? currentDestIndex : -1;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p) continue;
      const wantOn = activeIdx === i;
      if (wantOn === prevWantOn[i]) {
        if (fadeState[i]) ensureTick();
        continue;
      }
      prevWantOn[i] = wantOn;
      const now = performance.now();
      if (wantOn) {
        const pr = p.el.play();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
        fadeState[i] = { kind: 'in', t0: now, v0: Math.min(getGain(p), peakVolumes[i]) };
        ensureTick();
      } else {
        fadeState[i] = { kind: 'out', t0: now, v0: getGain(p) };
        ensureTick();
      }
    }
  }
  return {
    sync,
    /** Call after first user gesture so autoplay policy allows music. */
    unlock() {
      unlocked = true;
      sync();
    },
    /**
     * During the start-gate user gesture: allow in-system music but keep it silent
     * and do not start the volume ramp yet (used so gate music can finish fading first).
     */
    primeActiveDestinationAudioAfterGesture() {
      unlocked = true;
      const activeIdx = unlocked && !isNavigating ? currentDestIndex : -1;
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p) continue;
        const wantOn = activeIdx === i;
        if (!wantOn) continue;
        const pr = p.el.play();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
        setGain(p, 0);
        fadeState[i] = null;
        prevWantOn[i] = true;
      }
    },
    /** Start (or restart) fade-in for the active system (e.g. Sol / astra.mp3). Optional eased / custom duration for gate handoff. */
    beginActiveDestinationFadeIn(opts) {
      const activeIdx = unlocked && !isNavigating ? currentDestIndex : -1;
      const now = performance.now();
      let easeFn = null;
      const ease = opts && opts.ease;
      if (ease === 'smooth') easeFn = (u) => u * u * (3 - 2 * u);
      else if (ease === 'easeIn') easeFn = (u) => u * u * u;
      const durationMs = opts && typeof opts.durationMs === 'number' && opts.durationMs > 0
        ? opts.durationMs
        : undefined;
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p) continue;
        if (activeIdx !== i) continue;
        /** @type {{ kind: 'in', t0: number, v0: number, duration?: number, easeFn?: (u: number) => number }} */
        const st = {
          kind: 'in',
          t0: now,
          v0: Math.min(getGain(p), peakVolumes[i]),
        };
        if (durationMs != null) st.duration = durationMs;
        if (easeFn) st.easeFn = easeFn;
        fadeState[i] = st;
        ensureTick();
      }
    },
  };
})(GALAXY_DESTINATIONS);

function syncTrailVisibility() {
  const activeDest = isNavigating ? -1 : currentDestIndex;
  const showSolTrails = activeDest === 0;
  trail1.line.visible = showSolTrails;
  trail2.line.visible = showSolTrails;
  linkLine.visible = showSolTrails;
  managedPlanets.forEach(mp => {
    if (!mp.trail) return;
    mp.trail.line.visible = showSolTrails && !mp.isBinary &&
      (mp.orbitCenter === 'sun' || mp.orbitCenter === 'planet');
  });
  GALAXY_DESTINATIONS.forEach((dest, i) => {
    if (!dest._trail) return;
    dest._trail.line.visible = i === activeDest && i !== 0;
  });
}

// Beacon sun visual at each non-home destination
GALAXY_DESTINATIONS.forEach((dest, i) => {
  if (i === 0) return;
  const grp  = new THREE.Group();
  grp.position.copy(dest.pos);
  // Core
  grp.add(new THREE.Mesh(
    new THREE.SphereGeometry(5, 16, 16),
    new THREE.MeshBasicMaterial({ color: dest.color })
  ));
  // Corona glow layers
  [10, 16, 24].forEach((r, li) => {
    grp.add(new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 12),
      new THREE.MeshBasicMaterial({
        color: dest.color, side: THREE.BackSide,
        transparent: true, opacity: 0.18 - li * 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    ));
  });
  // Simple orbiting planet
  const orb = new THREE.Group();
  const pMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.8, 2),
    new THREE.MeshLambertMaterial({ color: 0x448844 })
  );
  pMesh.position.set(28, 0, 0);
  orb.add(pMesh);
  grp.add(orb);
  const orbitTrail = makeTrail({ len: 220, color: dest.color, opacity: 0.45 });
  dest._orb  = orb;
  dest._grp  = grp;
  dest._planetMesh = pMesh;
  dest._trail = orbitTrail;
  scene.add(grp);
});
syncTrailVisibility();

// ── Galaxy navigation ─────────────────────────────────────────────
function navigateTo(idx) {
  if (isNavigating || idx === currentDestIndex) return;
  if (walkMode.active) stopWalkMode();
  isNavigating = true;
  solarSystemAudio.sync();
  document.body.classList.add('hud-hidden');
  syncTrailVisibility();
  zoomTarget = null; // cancel any splash zoom in progress
  const dest   = GALAXY_DESTINATIONS[idx];
  const startT = cameraTarget.clone();
  const endT   = dest.pos.clone();
  const startZ = orbitZoom;
  const midZ   = Math.max(startZ, 18); // pull back mid-flight
  const endZ   = SYSTEM_FIT_ZOOM;
  const dur    = 3800;
  const t0     = performance.now();

  // Update menu UI to show navigating state
  document.querySelectorAll('.gx-item').forEach(el => el.classList.add('navigating'));

  function step() {
    const p    = Math.min((performance.now() - t0) / dur, 1);
    const ease = p < 0.5 ? 4*p*p*p : 1 - Math.pow(-2*p+2,3)/2; // cubic in-out

    // Smoothly move cameraTarget
    cameraTarget.lerpVectors(startT, endT, ease);
    panOffset.set(0,0,0);

    // Zoom arc: pull out then zoom in
    if (p < 0.45) {
      orbitZoom = startZ + (midZ - startZ) * (p / 0.45);
    } else {
      const pp = (p - 0.45) / 0.55;
      const e2 = pp < 0.5 ? 2*pp*pp : -1+(4-2*pp)*pp;
      orbitZoom = midZ + (endZ - midZ) * e2;
    }

    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      currentDestIndex = idx;
      isNavigating     = false;
      solGalaxyMenuRevealed = idx !== 0;
      syncTrailVisibility();
      rebuildGalaxyMenu();
      document.body.classList.remove('hud-hidden');
      solarSystemAudio.sync();
    }
  }
  requestAnimationFrame(step);
}

// ── Galaxy menu UI ────────────────────────────────────────────────
const galaxyMenu = document.getElementById('galaxy-menu');
const galaxyBtn  = document.getElementById('galaxy-btn');
const galaxyList = document.getElementById('galaxy-list');

function rebuildGalaxyMenu() {
  const inPlanetView = cameraMode === 'planet';
  if (galaxyMenu) galaxyMenu.classList.toggle('mode-planet', inPlanetView);
  galaxyList.innerHTML = '';
  if (inPlanetView) {
    const moonCounts = new Map();
    managedPlanets.forEach(mp => {
      if (mp.orbitCenter === 'planet' && mp.orbitParentId !== null) {
        moonCounts.set(mp.orbitParentId, (moonCounts.get(mp.orbitParentId) || 0) + 1);
      }
    });
    const childrenByParent = new Map();
    managedPlanets.forEach((mp, idx) => {
      if (mp.orbitCenter === 'planet' && mp.orbitParentId !== null && managedPlanets[mp.orbitParentId]) {
        if (!childrenByParent.has(mp.orbitParentId)) childrenByParent.set(mp.orbitParentId, []);
        childrenByParent.get(mp.orbitParentId).push(idx);
      }
    });
    const ordered = [];
    const visited = new Set();
    const pushBranch = (idx, depth) => {
      if (!managedPlanets[idx] || visited.has(idx)) return;
      visited.add(idx);
      ordered.push({ idx, depth });
      const kids = childrenByParent.get(idx) || [];
      kids.forEach(childIdx => pushBranch(childIdx, Math.min(depth + 1, 2)));
    };
    managedPlanets.forEach((mp, idx) => {
      const hasParent = mp.orbitCenter === 'planet' && mp.orbitParentId !== null && managedPlanets[mp.orbitParentId];
      if (!hasParent) pushBranch(idx, 0);
    });
    managedPlanets.forEach((_, idx) => pushBranch(idx, 0));

    ordered.forEach(({ idx, depth }) => {
      const mp = managedPlanets[idx];
      if (!mp) return;
      const isSelected = idx === selectedPlanetIdx;
      const el = document.createElement('div');
      el.className = 'gx-item planet-picker-item' + (isSelected ? ' current' : '');
      const indent = '&nbsp;'.repeat(depth * 3);
      const orbitTag = depth > 0 ? 'Moon' : 'Planet';
      const moonCount = moonCounts.get(mp.id) || 0;
      const moonText = moonCount ? `${moonCount} moon${moonCount === 1 ? '' : 's'}` : orbitTag;
      el.innerHTML = `<div class="gx-item-main">
        <span class="gx-item-title">
          <span class="planet-dot" style="background:${mp.color}"></span>
          <span class="gx-item-name">${indent}${mp.name}</span>
        </span>
        <span class="gx-item-meta">${moonText}</span>
      </div>`;
      el.addEventListener('click', () => {
        selectPlanet(idx);
      });
      galaxyList.appendChild(el);

      if (isSelected) {
        const actions = document.createElement('div');
        actions.className = 'gx-inline-actions';
        const moonBtn = document.createElement('button');
        moonBtn.type = 'button';
        moonBtn.className = 'gx-action-btn';
        moonBtn.textContent = '+ Moon';
        moonBtn.disabled = !canCreateMoonFromSelection();
        moonBtn.addEventListener('click', e => {
          e.stopPropagation();
          addMoonFromSelectionUi();
        });
        actions.appendChild(moonBtn);
        galaxyList.appendChild(actions);
      }
    });

    const footer = document.createElement('div');
    footer.className = 'gx-list-footer';
    const addPlanetInlineBtn = document.createElement('button');
    addPlanetInlineBtn.type = 'button';
    addPlanetInlineBtn.className = 'gx-action-btn';
    addPlanetInlineBtn.textContent = '+ Add Planet';
    addPlanetInlineBtn.addEventListener('click', e => {
      e.stopPropagation();
      addPlanetFromSelectionUi();
    });
    footer.appendChild(addPlanetInlineBtn);
    galaxyList.appendChild(footer);

    const selectedName =
      selectedPlanetIdx !== null && managedPlanets[selectedPlanetIdx]
        ? managedPlanets[selectedPlanetIdx].name
        : 'Pick Planet';
    galaxyBtn.textContent = '◉ ' + selectedName;
    syncSolGalaxyMenuVisibility();
    return;
  }

  GALAXY_DESTINATIONS.forEach((dest, i) => {
    const el = document.createElement('div');
    el.className = 'gx-item' + (i === currentDestIndex ? ' current' : '');
    el.innerHTML = `<span>${dest.name}</span><span class="gx-dist">${dest.dist}</span>`;
    el.addEventListener('click', () => {
      galaxyList.classList.remove('open');
      galaxyBtn.classList.remove('open');
      navigateTo(i);
    });
    galaxyList.appendChild(el);
  });
  galaxyBtn.textContent = '⬡ ' + GALAXY_DESTINATIONS[currentDestIndex].name;
  syncSolGalaxyMenuVisibility();
}

galaxyBtn.addEventListener('click', () => {
  const open = galaxyList.classList.toggle('open');
  galaxyBtn.classList.toggle('open', open);
});

// Tap / click outside any overlay closes it (canvas, empty space, other UI)
document.addEventListener('click', e => {
  if (!e.target.closest('#galaxy-menu')) {
    galaxyList.classList.remove('open');
    galaxyBtn.classList.remove('open');
  }
  if (camSettingsEl.classList.contains('open')) {
    if (!e.target.closest('#cam-settings') && !e.target.closest('#btn-cam-settings')) {
      camSettingsEl.classList.remove('open');
      btnCamSettings.classList.remove('active');
    }
  }
});

rebuildGalaxyMenu();

// Spin orbiting planets at each destination
const _origAnimate = animate;
(function patchAnimate() {
  const origRender = renderer.render.bind(renderer);
  const _destPlanetWorld = new THREE.Vector3();
  renderer.render = (scene, camera) => {
    const t = performance.now() * 0.001;
    // Skip entirely when fully at Sol — no galaxy destination is visible.
    if (currentDestIndex !== 0 || isNavigating) {
      GALAXY_DESTINATIONS.forEach((dest, i) => {
        if (!dest._orb) return;
        dest._orb.rotation.y = t * 0.4;
        const shouldRenderTrail = !isNavigating && i === currentDestIndex && i !== 0;
        if (shouldRenderTrail && dest._planetMesh && dest._trail) {
          dest._planetMesh.getWorldPosition(_destPlanetWorld);
          pushTrail(dest._trail, _destPlanetWorld.x, _destPlanetWorld.y, _destPlanetWorld.z);
        }
      });
    }
    origRender(scene, camera);
  };
})();

