// ── Renderer ──────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
document.addEventListener('selectstart', (e) => e.preventDefault(), { passive: false });

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(20, innerWidth / innerHeight, 0.01, 120000);

// ── Lighting: sun is the only real source ─────────────────────────
// Very dim ambient keeps the night-sides from going pure black
scene.add(new THREE.AmbientLight(0xffffff, 0.10));
// PointLight at origin (the sun). decay=0 → no distance falloff,
// so both planets get equal light intensity regardless of position.
const sunLight = new THREE.PointLight(0xfff5cc, 1.6, 0, 0);
scene.add(sunLight);   // stays at origin; position never needs updating

// ── Starfield — volumetric, many depth layers, no visible edge ────
(function() {
  const N = 40000, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi   = Math.acos(2 * v - 1);
    // Strong bias toward mid-range so the zoom flies through dense star lanes
    const r = 50 + Math.pow(Math.random(), 0.45) * 59950; // 50 → 60000
    pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false })
  ));
})();

// ── Sun visual (fixed world radius; universe scale moves orbits only) ─
// Core + nested corona layers using additive blending
const SUN_R = 2.5;    // sun radius in physics units
const sunGroup = new THREE.Group();
scene.add(sunGroup);

const sunCoreMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 40, 40),
  new THREE.MeshBasicMaterial({ color: 0xffeedd })
);
sunGroup.add(sunCoreMesh);
[
  [1.30, 0xffcc44, 0.20],
  [2.00, 0xff9900, 0.09],
  [3.20, 0xff5500, 0.04],
  [5.50, 0xff2200, 0.02],
].forEach(([s, c, o]) =>
  sunGroup.add(new THREE.Mesh(
    new THREE.SphereGeometry(s, 24, 24),
    new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: o,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  ))
);

// ── Camera — orbits the sun (world origin) ────────────────────────
// Distance = ORBIT_BASE * curScale * userZoom.
// Scale now controls camera distance only (solar system size stays fixed).
const ORBIT_BASE = 30;
const PLANET_ORBIT_BASE = 8; // camera distance for planet view (physics units)

// Sun-view orbit state
let orbitTheta = -0.3, orbitPhi = 0.92, orbitZoom = 3.0;
let zoomTarget = null; // when set, animate loop log-lerps orbitZoom toward it
let introZoomProfile = null; // custom speed curve used only for splash intro zoom
let dTheta = 0, dPhi = 0;

// Planet-view orbit state (separate angles so each view remembers its position)
let pOrbitTheta = -0.3, pOrbitPhi = 1.1;
let pDTheta = 0, pDPhi = 0;

let cameraMode    = 'sun'; // 'sun' | 'planet'
let autoRotate    = false;
let orbitSpeedMul = 0.1;
let zoomSpeedMul  = 0.1;
let dragButton = 0;
let dragging = false, lastPX = 0, lastPY = 0;
let desktopWalkLookReady = false, desktopWalkLookX = 0, desktopWalkLookY = 0;

// cameraTarget — the world point the camera orbits.  Normally the sun (origin)
// but animates smoothly when navigating to another star system.
const cameraTarget = new THREE.Vector3(0, 0, 0);
const _cameraClipFocus = new THREE.Vector3();

// Pan offset — shifts the look-at target in camera's local right/up plane
const panOffset = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up    = new THREE.Vector3();
const _selectedPlanetWorld = new THREE.Vector3();
const _planetEditorCenterWorld = new THREE.Vector3();
const _planetEditorEdgeWorld = new THREE.Vector3();
const _planetEditorNdc = new THREE.Vector3();
const _planetEditorEdgeNdc = new THREE.Vector3();
const _planetEditorCamRight = new THREE.Vector3();
const _planetEditorCamUp = new THREE.Vector3();
const _planetEditorCamForward = new THREE.Vector3();
const _sunEditorCenterWorld = new THREE.Vector3();

// ── Walk mode (redesigned pill walker) ──────────────────────────────
const walkMode = { active: false, spawnPlanetIdx: null };
const walkInput = { left: false, right: false, fwd: false, back: false, shiftRun: false, runLocked: false };
const walkLookInput = { x: 0, y: 0 };
const walkAnalog = { x: 0, y: 0 };
const WALK_CFG = {
  characterRadius: 0.0036,
  characterHeight: 0.013,
  footOffset: 0.0065,
  /** Tangential top speed at WALK_SPEED_REF_RADIUS; scaled per-planet in updateWalkMode. */
  moveSpeed: 0.10,
  sprintBoost: 1.82,
  acceleration: 6.4,
  drag: 9.2,
  slideAccel: 2.6,
  slipEnterDeg: 40,
  slipExitDeg: 39,
  landPriorityGapAllowance: 0.12,
  waterSpeedFactor: 0.5,
  lavaSpeedFactor: 0.2,
  bounceFreq: 8.2,
  bounceAmp: 0.0012,
  bounceResponse: 8.5,
  walkFov: 62,
  /** Default third-person pull-back (world units); zoom wheel / pinch adjust from tpDistanceMin..Max. */
  cameraDistance: 0.32,
  cameraHeight: 0.017,
  cameraLead: 0.26,
  cameraTargetLift: 0.009,
  cameraLag: 12.5,
  avatarTurnLerp: 10.5,
  tpDistanceMin: 0.042,
  tpDistanceMax: 1.75,
  tpZoomWheelStep: 1.09,
  tpZoomSmooth: 8.2,
  /** Along look-from-target ray: subtract from hit distance (stay outside mesh). */
  tpCollisionPadding: 0.032,
  /** Below this pull distance, camera blends toward first-person eye (smooth, no hard mode flip). */
  tpFpsBlendStart: 0.095,
  /** At or below this distance, first-person blend is full (eye + slight pullback from head). */
  tpFpsBlendEnd: 0.056,
  /** Eye height above walk anchor along planet up (feet/anchor → eyes). */
  fpEyeHeight: 0.0194,
  /** Nudge camera back from eye along viewDir so near-plane does not clip the pill. */
  fpsEyePullback: 0.0032,
  fpsFov: 74,
  lookSensitivity: 0.0054,
  mobileLookSensitivity: 0.0135,
  /**
   * Walk fall gravity (radial, world units / s²) at smallest vs largest planet in the system.
   * Current planet lerps between them by (baseRadius × size) metric.
   */
  walkGravityMin: 0.078,
  walkGravityMax: 0.195,
  /** Terminal radial fall speed at smallest vs largest planet. */
  walkMaxFallMin: 0.15,
  walkMaxFallMax: 0.28,
  /**
   * Jump always reaches this height above the feet (same on every world).
   * Launch speed = sqrt(2 × g × height) so apex is fixed while fall curve follows g.
   */
  jumpApexHeight: 0.037,
  jumpBufferSec: 0.14,
  jumpCooldownSec: 0.18,
  coyoteTimeSec: 0.12,
  airControlFactor: 0.38,
  airDrag: 1.6,
  /** Run (Shift / run lock) needs at least this input magnitude to apply faster top speed. */
  runInputMin: 0.018,
  /** Keyboard + joystick combined input below this counts as "no intentional move". */
  moveInputDeadzone: 0.05,
  /** Extra planar velocity decay (per second) when idle on ground; stacks with `drag`. */
  idlePlanarBrake: 28,
  /** Same when airborne (weaker so air control still feels possible). */
  idleAirPlanarBrake: 10,
  /** Tangential speed below this snaps to zero when idle (world units / frame-scale). */
  idlePlanarSnapSpeed: 0.0032,
  groundProbeDistance: 0.035,
  landMaxOutwardSpeed: 0.08,
  groundSnapIdle: 16,
  groundSnapMove: 26,
  groundNormalLerp: 14,
  /** Max distance from planet center while walking (tight shell keeps you on the mesh, not in empty space). */
  anchorSphereSlackMult: 1.46,
  /** Extra world units beyond nominal×mult for short jumps before the hard cap applies. */
  anchorSphereAbsSlack: 0.14,
  anchorSpherePull: 26,
  /** When airborne and next surface sample misses, resample along this radial scale from planet center. */
  airResampleRadiusMult: 1.08,
  maxAirHorizontalSpeed: 0.52,
  /** Player lantern: point light with finite distance (AOE-style falloff on ground). */
  playerLightColor: 0xa6d9ff,
  playerLightIntensity: 3.4,
  /** Player lantern: base distance at WALK_SPEED_REF_RADIUS; scaled each frame in walk by R/R_ref. */
  playerLightDistance: 0.28,
  playerLightDecay: 2,
  /** Lamp height along local body axis (fraction of characterHeight). */
  playerLightHeightMul: 0.4,
  /**
   * Minimum clearance from sampled terrain when forcing the eye outside meshes (world units).
   * Smaller = camera can hug polygons tighter; too small risks near-plane flicker.
   */
  cameraTerrainClearance: 0.028,
  /** Minimum distance along target→camera spoke when ray hits terrain (occlusion pull). */
  cameraOcclusionMinSpoke: 0.024,
};
let walkCameraMode = 'tp';
let walkTpDistance = WALK_CFG.cameraDistance;
let walkTpDistanceTarget = WALK_CFG.cameraDistance;
let walkPrevMs = performance.now();
const walkState = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  forward: new THREE.Vector3(1, 0, 0),
  viewDir: new THREE.Vector3(1, 0, 0),
  lookPitch: 0,
  grounded: false,
  jumpBufferTimer: 0,
  jumpCooldownTimer: 0,
  coyoteTimer: 0,
  anchorPlanetIdx: null,
  surfaceType: 'land',
  surfaceSlopeDeg: 0,
  sliding: false,
  bouncePhase: 0,
  bounceBlend: 0,
  missedSurfaceFrames: 0,
  anchorLastMatrix: new THREE.Matrix4(),
  anchorLastMatrixValid: false,
  prevFov: null,
};
const _walkCenter = new THREE.Vector3();
const _walkCamPos = new THREE.Vector3();
const _walkCamTarget = new THREE.Vector3();
const _walkBasisZ = new THREE.Vector3();
const _walkBasisMat = new THREE.Matrix4();
const _walkQ = new THREE.Quaternion();
const _walkTmp = new THREE.Vector3();
const _walkTmp2 = new THREE.Vector3();
const _walkTmp3 = new THREE.Vector3();
/** Integrated walk position for this frame; never pass into helpers that reuse scratch vectors. */
const _walkIntPos = new THREE.Vector3();
/** Mesh face normal scratch — must not alias _walkIntPos / _walkTmp3 used by callers. */
const _walkFaceN = new THREE.Vector3();
const _walkX = new THREE.Vector3(1, 0, 0);
const _walkY = new THREE.Vector3(0, 1, 0);
const _walkDesired = new THREE.Vector3();
const _walkRight = new THREE.Vector3();
const _walkRaycaster = new THREE.Raycaster();
const _walkCamObstacles = [];
const _walkSpawnV1 = new THREE.Vector3();
const _walkSpawnV2 = new THREE.Vector3();
const _walkSpawnV3 = new THREE.Vector3();
const _walkSpawnCenter = new THREE.Vector3();
const _walkSpawnNormal = new THREE.Vector3();
const _walkSpawnRadial = new THREE.Vector3();
const _walkSpawnToCam = new THREE.Vector3();
const _walkGroundTarget = new THREE.Vector3();
const _walkAnchorDelta = new THREE.Matrix4();
const _walkAnchorInv = new THREE.Matrix4();
const _walkAnchorCurr = new THREE.Matrix4();
/** Upper 3×3 of anchor frame delta — used for velocity (must preserve length; Vector3.transformDirection normalizes). */
const _walkAnchorRot = new THREE.Matrix3();
const walkTransition = { active: false, token: 0, startedAt: 0 };
const WALK_MAX_LOOK_PITCH = Math.PI * 0.498;

function makeWalkSurfaceRecord() {
  return {
    idx: null,
    center: new THREE.Vector3(),
    radialDir: new THREE.Vector3(),
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    surfaceRadius: 0,
    gap: Infinity,
    medium: 'land',
    slopeDeg: 0,
  };
}
const _walkSurfaceScratch = makeWalkSurfaceRecord();
const _walkBestLandSurface = makeWalkSurfaceRecord();
const _walkBestAnySurface = makeWalkSurfaceRecord();

function syncWalkPitchFromView() {
  const upDot = Math.max(-0.9999, Math.min(0.9999, walkState.viewDir.dot(walkState.up)));
  walkState.lookPitch = Math.max(-WALK_MAX_LOOK_PITCH, Math.min(WALK_MAX_LOOK_PITCH, Math.asin(upDot)));
}

function copyWalkSurface(src, dst) {
  dst.idx = src.idx;
  dst.center.copy(src.center);
  dst.radialDir.copy(src.radialDir);
  dst.point.copy(src.point);
  dst.normal.copy(src.normal);
  dst.surfaceRadius = src.surfaceRadius;
  dst.gap = src.gap;
  dst.medium = src.medium;
  dst.slopeDeg = src.slopeDeg;
}

function makeCapsuleApprox(radius, midLength, radialSegments, material) {
  const capsule = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, Math.max(0.001, midLength), radialSegments),
    material
  );
  const capGeo = new THREE.SphereGeometry(
    radius,
    Math.max(8, radialSegments),
    Math.max(6, Math.floor(radialSegments * 0.75))
  );
  const capTop = new THREE.Mesh(capGeo, material);
  const capBottom = new THREE.Mesh(capGeo, material);
  const halfStem = Math.max(0.001, midLength) * 0.5;
  capTop.position.y = halfStem;
  capBottom.position.y = -halfStem;
  capsule.add(stem, capTop, capBottom);
  return capsule;
}

const walkAvatar = new THREE.Group();
const avatarBodyMat = new THREE.MeshLambertMaterial({ color: 0xe4ebfb });
const avatarStripeMat = new THREE.MeshLambertMaterial({ color: 0x5aa6ff });
const capsuleMidLen = Math.max(0.001, WALK_CFG.characterHeight - WALK_CFG.characterRadius * 2);
const avatarBody = makeCapsuleApprox(WALK_CFG.characterRadius, capsuleMidLen, 16, avatarBodyMat);
const avatarStripe = new THREE.Mesh(
  new THREE.CylinderGeometry(WALK_CFG.characterRadius * 0.76, WALK_CFG.characterRadius * 0.76, WALK_CFG.characterHeight * 0.22, 16),
  avatarStripeMat
);
avatarStripe.position.y = WALK_CFG.characterHeight * 0.12;
walkAvatar.add(avatarBody, avatarStripe);
const walkPlayerLight = new THREE.PointLight(
  WALK_CFG.playerLightColor,
  WALK_CFG.playerLightIntensity,
  WALK_CFG.playerLightDistance,
  WALK_CFG.playerLightDecay
);
walkPlayerLight.position.set(0, WALK_CFG.characterHeight * WALK_CFG.playerLightHeightMul, 0);
walkAvatar.add(walkPlayerLight);
walkAvatar.visible = false;
scene.add(walkAvatar);

const planetSelectionHalo = new THREE.Mesh(
  new THREE.SphereGeometry(1, 36, 24),
  new THREE.MeshBasicMaterial({
    color: 0x58dfff,
    transparent: true,
    opacity: 0.22,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
planetSelectionHalo.visible = false;
scene.add(planetSelectionHalo);

const planetSelectionRing = new THREE.Mesh(
  new THREE.TorusGeometry(1, 0.028, 14, 96),
  new THREE.MeshBasicMaterial({
    color: 0x9ceeff,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
planetSelectionRing.visible = false;
scene.add(planetSelectionRing);

const sunSelectionHalo = new THREE.Mesh(
  new THREE.SphereGeometry(1, 36, 24),
  new THREE.MeshBasicMaterial({
    color: 0x58dfff,
    transparent: true,
    opacity: 0.22,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
sunSelectionHalo.visible = false;
scene.add(sunSelectionHalo);

const sunSelectionRing = new THREE.Mesh(
  new THREE.TorusGeometry(1, 0.028, 14, 96),
  new THREE.MeshBasicMaterial({
    color: 0x9ceeff,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
);
sunSelectionRing.visible = false;
scene.add(sunSelectionRing);

// ── Camera input: separate paths (do not mix) ─────────────────────
// Desktop: mouse / pen — left = orbit, right = pan on plane, wheel = zoom.
// Touch: 1 finger = orbit; 2 fingers pinch (spacing change) = zoom;
//        2 fingers drag together (spacing ~stable) = pan on view plane.
const _canvas = renderer.domElement;
const _pickRay = new THREE.Raycaster();
const _pickNdc = new THREE.Vector2();
let tapCandidate = null;

function syncSolGalaxyMenuVisibility() {
  const gm = document.getElementById('galaxy-menu');
  if (!gm) return;
  const hide =
    cameraMode === 'sun' &&
    currentDestIndex === 0 &&
    (!solGalaxyMenuRevealed || isNavigating);
  gm.classList.toggle('galaxy-await-sun-tap', hide);
}

/**
 * If nothing is selected in the planet list, infer a planet from what you are looking at
 * (screen center ray, then camera-forward cone toward nearest planet pivot).
 * Mutates selection via global `selectPlanet` (defined in a later script bundle).
 */
function trySelectPlanetForWalkStart() {
  if (typeof selectedPlanetIdx === 'undefined') return;
  if (selectedPlanetIdx !== null) return;

  const rect = _canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top + rect.height * 0.5;
  _pickNdc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  _pickNdc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  _pickRay.setFromCamera(_pickNdc, camera);

  const pickObjects = [];
  const metaByUuid = new Map();
  managedPlanets.forEach((mp, idx) => {
    const targets = mp.obj.getPickables ? mp.obj.getPickables() : [];
    targets.forEach(obj => {
      if (!obj || !obj.visible) return;
      pickObjects.push(obj);
      metaByUuid.set(obj.uuid, { kind: 'planet', idx });
    });
  });

  if (pickObjects.length) {
    const hits = _pickRay.intersectObjects(pickObjects, false);
    for (let hi = 0; hi < hits.length; hi++) {
      let obj = hits[hi].object;
      while (obj) {
        const tag = metaByUuid.get(obj.uuid);
        if (tag?.kind === 'planet' && typeof selectPlanet === 'function') {
          selectPlanet(tag.idx);
          return;
        }
        obj = obj.parent;
      }
    }
  }

  camera.getWorldDirection(_walkTmp);
  if (_walkTmp.lengthSq() < 1e-8) return;
  _walkTmp.normalize();
  let bestIdx = -1;
  let bestDot = 0.32;
  managedPlanets.forEach((mp, idx) => {
    if (!mp?.obj?.pivot) return;
    mp.obj.pivot.getWorldPosition(_walkTmp2);
    _walkTmp3.copy(_walkTmp2).sub(camera.position);
    const dist = _walkTmp3.length();
    if (dist < 1e-4) return;
    _walkTmp3.multiplyScalar(1 / dist);
    const dot = _walkTmp.dot(_walkTmp3);
    if (dot > bestDot) {
      bestDot = dot;
      bestIdx = idx;
    }
  });
  if (bestIdx >= 0 && typeof selectPlanet === 'function') selectPlanet(bestIdx);
}

function pickSolarSystemFromScreen(clientX, clientY) {
  if (walkMode.active) return;
  const rect = _canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  _pickNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _pickNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  _pickRay.setFromCamera(_pickNdc, camera);

  const pickObjects = [];
  const metaByUuid = new Map();

  managedPlanets.forEach((mp, idx) => {
    const targets = mp.obj.getPickables ? mp.obj.getPickables() : [];
    targets.forEach(obj => {
      if (!obj || !obj.visible) return;
      pickObjects.push(obj);
      metaByUuid.set(obj.uuid, { kind: 'planet', idx });
    });
  });

  if (currentDestIndex === 0) {
    sunGroup.updateMatrixWorld(true);
    if (sunCoreMesh.visible) {
      pickObjects.push(sunCoreMesh);
      metaByUuid.set(sunCoreMesh.uuid, { kind: 'sun' });
    }
  }

  if (!pickObjects.length) return;
  const hits = _pickRay.intersectObjects(pickObjects, false);
  for (let hi = 0; hi < hits.length; hi++) {
    let obj = hits[hi].object;
    let tag = null;
    while (obj) {
      tag = metaByUuid.get(obj.uuid);
      if (tag) break;
      obj = obj.parent;
    }
    if (!tag) continue;
    if (tag.kind === 'planet') {
      if (cameraMode !== 'planet') setCamMode('planet');
      selectPlanet(tag.idx);
      return;
    }
    if (tag.kind === 'sun') {
      onSunTapped();
      return;
    }
  }
}

function onSunTapped() {
  if (walkMode.active || currentDestIndex !== 0) return;
  solGalaxyMenuRevealed = true;
  setCamMode('sun');
  sunRadialDismissed = false;
  syncSolGalaxyMenuVisibility();
}

function isTouchPointer(e) {
  return e.pointerType === 'touch';
}

function queueWalkLook(rawDX, rawDY, isMobile = false) {
  if (!walkMode.active) return;
  const sens = isMobile ? WALK_CFG.mobileLookSensitivity : WALK_CFG.lookSensitivity;
  walkLookInput.x += rawDX * sens;
  walkLookInput.y += rawDY * sens;
}

// ----- Desktop (mouse / pen) -----
function desktopPointerDown(e) {
  dragging = true;
  dragButton = e.button;
  lastPX = e.clientX;
  lastPY = e.clientY;
  desktopWalkLookX = e.clientX;
  desktopWalkLookY = e.clientY;
  desktopWalkLookReady = true;
  try { _canvas.setPointerCapture(e.pointerId); } catch (err) {}
}
function desktopPointerUp(e) {
  dragging = false;
  desktopWalkLookReady = false;
  try { _canvas.releasePointerCapture(e.pointerId); } catch (err) {}
}
function desktopPointerMove(e) {
  if (walkMode.active) {
    if (walkJoystickPointerId !== null && e.pointerId === walkJoystickPointerId) return;
    let rawDX = 0;
    let rawDY = 0;
    if (dragging) {
      rawDX = e.clientX - lastPX;
      rawDY = e.clientY - lastPY;
    } else if (Math.abs(e.movementX || 0) > 0 || Math.abs(e.movementY || 0) > 0) {
      rawDX = e.movementX || 0;
      rawDY = e.movementY || 0;
    } else if (desktopWalkLookReady) {
      rawDX = e.clientX - desktopWalkLookX;
      rawDY = e.clientY - desktopWalkLookY;
    }
    desktopWalkLookX = e.clientX;
    desktopWalkLookY = e.clientY;
    desktopWalkLookReady = true;
    if (dragging) {
      lastPX = e.clientX;
      lastPY = e.clientY;
    }
    queueWalkLook(rawDX, rawDY, false);
    return;
  }
  if (!dragging) return;
  const rawDX = e.clientX - lastPX;
  const rawDY = e.clientY - lastPY;
  lastPX = e.clientX;
  lastPY = e.clientY;
  if (dragButton === 2) {
    camera.matrix.extractBasis(_right, _up, new THREE.Vector3());
    const panSpeed = 0.012 * orbitZoom;
    panOffset.addScaledVector(_right, -rawDX * panSpeed);
    panOffset.addScaledVector(_up,     rawDY * panSpeed);
  } else {
    const dx = -rawDX * 0.006 * orbitSpeedMul;
    const dy = -rawDY * 0.006 * orbitSpeedMul;
    if (cameraMode === 'sun') { dTheta += dx; dPhi += dy; }
    else                      { pDTheta += dx; pDPhi += dy; }
  }
}

// ----- Touch (phones / tablets) -----
const mobPointers = new Map();
let mobPinchDist = 0;
let mobMidX = 0, mobMidY = 0;
let mobSingleLX = 0, mobSingleLY = 0;
let mobSingleReady = false;
let walkTouchLookId = null;
let walkTouchLookX = 0;
let walkTouchLookY = 0;
/** Pointer id captured by the walk joystick — must not drive camera look (other hand / mouse for look). */
let walkJoystickPointerId = null;
const walkJoystickTouchIds = new Set();

function setWalkJoystickCapturingPointer(id) {
  walkJoystickPointerId = id != null ? id : null;
}

function registerWalkJoystickTouch(identifier, down) {
  if (down) walkJoystickTouchIds.add(identifier);
  else walkJoystickTouchIds.delete(identifier);
}
// Split 2-finger gestures: pinch → zoom; parallel drag → pan on camera plane (like desktop right-drag)
const MOB_SPREAD_ZOOM = 0.55;   // px finger-spacing change → pinch zoom
const MOB_PAN_DOM = 0.48;       // plane-pan only if spacing shifts < this × travel
const MOB_PAN_MIN = 0.45;       // min midpoint motion (px) for plane pan
const MOB_ZOOM_VS_PAN = 0.28;   // zoom wins if spacing shift > this × pan motion

function clearWalkTouchLookState() {
  walkTouchLookId = null;
  walkTouchLookX = 0;
  walkTouchLookY = 0;
}

function isWalkLookBlockedTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest(
    '#walk-controls, #walk-joystick, #walk-joystick-thumb, #ui, #planet-selection-editor, #planet-panel, #galaxy-menu, #cam-buttons, #cam-settings, #tap-primer-screen, #splash'
  );
}

function mobPinchPair() {
  const pts = Array.from(mobPointers.values());
  if (pts.length < 2) return null;
  return { a: pts[0], b: pts[1] };
}

function onMobilePointerDown(e) {
  if (walkMode.active && typeof e.preventDefault === 'function') e.preventDefault();
  try { _canvas.setPointerCapture(e.pointerId); } catch (err) {}
  mobPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (mobPointers.size === 1) {
    mobSingleLX = e.clientX;
    mobSingleLY = e.clientY;
    mobSingleReady = true;
  }
  if (mobPointers.size === 2) {
    const pair = mobPinchPair();
    if (pair) {
      mobPinchDist = Math.hypot(pair.a.x - pair.b.x, pair.a.y - pair.b.y);
      mobMidX = (pair.a.x + pair.b.x) * 0.5;
      mobMidY = (pair.a.y + pair.b.y) * 0.5;
    }
  }
}

function onMobilePointerMove(e) {
  if (!mobPointers.has(e.pointerId)) {
    if (!walkMode.active) return;
    mobPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mobPointers.size === 1) {
      mobSingleLX = e.clientX;
      mobSingleLY = e.clientY;
      mobSingleReady = true;
    }
    return;
  }
  const prev = mobPointers.get(e.pointerId);
  mobPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (walkMode.active) {
    if (walkTouchLookId !== null) return;
    if (walkJoystickPointerId !== null && e.pointerId === walkJoystickPointerId) {
      mobPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (mobPointers.size >= 2) {
        const pair = mobPinchPair();
        if (pair) {
          const dist = Math.hypot(pair.a.x - pair.b.x, pair.a.y - pair.b.y);
          mobMidX = (pair.a.x + pair.b.x) * 0.5;
          mobMidY = (pair.a.y + pair.b.y) * 0.5;
          if (mobPinchDist > 10 && dist > 10 && walkCameraMode === 'tp') {
            const ratio = mobPinchDist / dist;
            setWalkTpDistanceTarget(walkTpDistanceTarget * Math.pow(ratio, 1.08));
          }
          mobPinchDist = dist;
        }
      } else if (mobPointers.size >= 1) {
        const p = mobPointers.values().next().value;
        if (p) {
          mobSingleLX = p.x;
          mobSingleLY = p.y;
          mobSingleReady = true;
        }
      }
      return;
    }
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (prev) {
      queueWalkLook(e.clientX - prev.x, e.clientY - prev.y, true);
    }
    if (mobPointers.size >= 2) {
      const pair = mobPinchPair();
      if (pair) {
        const dist = Math.hypot(pair.a.x - pair.b.x, pair.a.y - pair.b.y);
        mobMidX = (pair.a.x + pair.b.x) * 0.5;
        mobMidY = (pair.a.y + pair.b.y) * 0.5;
        if (mobPinchDist > 10 && dist > 10 && walkCameraMode === 'tp') {
          const ratio = mobPinchDist / dist;
          setWalkTpDistanceTarget(walkTpDistanceTarget * Math.pow(ratio, 1.08));
        }
        mobPinchDist = dist;
      }
    } else if (mobPointers.size >= 1) {
      const p = mobPointers.values().next().value;
      if (p) {
        mobSingleLX = p.x;
        mobSingleLY = p.y;
        mobSingleReady = true;
      }
    }
    return;
  }

  if (mobPointers.size === 1 && mobSingleReady) {
    const rawDX = e.clientX - mobSingleLX;
    const rawDY = e.clientY - mobSingleLY;
    mobSingleLX = e.clientX;
    mobSingleLY = e.clientY;
    const sens = 0.005 * orbitSpeedMul;
    const dx = -rawDX * sens;
    const dy = -rawDY * sens;
    if (cameraMode === 'sun') { dTheta += dx; dPhi += dy; }
    else                      { pDTheta += dx; pDPhi += dy; }
    return;
  }

  if (mobPointers.size === 2) {
    const pair = mobPinchPair();
    if (!pair) return;
    const dist = Math.hypot(pair.a.x - pair.b.x, pair.a.y - pair.b.y);
    const midX = (pair.a.x + pair.b.x) * 0.5;
    const midY = (pair.a.y + pair.b.y) * 0.5;

    const prevD = mobPinchDist;
    const prevMx = mobMidX;
    const prevMy = mobMidY;

    if (prevD > 10 && dist > 10) {
      const spreadPx = Math.abs(dist - prevD);
      const mdx = midX - prevMx;
      const mdy = midY - prevMy;
      const panLen = Math.hypot(mdx, mdy);

      const doPinchZoom =
        spreadPx >= MOB_SPREAD_ZOOM && spreadPx > panLen * MOB_ZOOM_VS_PAN;
      const doPlanePan =
        panLen >= MOB_PAN_MIN && spreadPx < panLen * MOB_PAN_DOM;

      if (doPinchZoom) {
        zoomTarget = null;
        // Spread fingers → zoom in (smaller orbit radius); pinch together → zoom out — matches maps / photos
        const ratio = prevD / dist;
        const zf = Math.pow(ratio, 1.13);
        orbitZoom = Math.max(0.05, Math.min(14, orbitZoom * zf));
        resetOrbitPointerInertia();
      } else if (doPlanePan) {
        camera.matrix.extractBasis(_right, _up, new THREE.Vector3());
        const panSpeed = 0.019 * orbitZoom;
        panOffset.addScaledVector(_right, -mdx * panSpeed);
        panOffset.addScaledVector(_up,     mdy * panSpeed);
      }
    }

    mobPinchDist = dist;
    mobMidX = midX;
    mobMidY = midY;
  }
}

function onMobilePointerUp(e) {
  mobPointers.delete(e.pointerId);
  try { _canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  if (mobPointers.size < 2) {
    mobPinchDist = 0;
    mobMidX = 0;
    mobMidY = 0;
  }
  if (mobPointers.size === 1) {
    const p = mobPointers.values().next().value;
    mobSingleLX = p.x;
    mobSingleLY = p.y;
    mobSingleReady = true;
  }
  if (mobPointers.size === 0) mobSingleReady = false;
}

_canvas.addEventListener('contextmenu', e => e.preventDefault());

_canvas.addEventListener('pointerdown', e => {
  if (isTouchPointer(e)) onMobilePointerDown(e);
  else desktopPointerDown(e);
});

window.addEventListener('pointerdown', e => {
  if (!walkMode.active) return;
  if (isWalkLookBlockedTarget(e.target)) return;
  if (isTouchPointer(e)) {
    if (mobPointers.has(e.pointerId)) return;
    onMobilePointerDown(e);
  } else if (!dragging) {
    desktopPointerDown(e);
  }
}, { passive: false });

window.addEventListener('pointerup', e => {
  if (isTouchPointer(e)) onMobilePointerUp(e);
  else desktopPointerUp(e);
});

window.addEventListener('pointercancel', e => {
  if (isTouchPointer(e)) onMobilePointerUp(e);
  else desktopPointerUp(e);
});

window.addEventListener('pointermove', e => {
  if (isTouchPointer(e)) {
    if (walkMode.active) onMobilePointerMove(e);
    else if (mobPointers.has(e.pointerId)) onMobilePointerMove(e);
  } else {
    desktopPointerMove(e);
  }
}, { passive: false });

window.addEventListener('touchstart', e => {
  if (!walkMode.active || walkTouchLookId !== null) return;
  for (let i = 0; i < e.changedTouches.length; i++) {
    const t = e.changedTouches[i];
    if (walkJoystickTouchIds.has(t.identifier)) continue;
    if (isWalkLookBlockedTarget(t.target)) continue;
    walkTouchLookId = t.identifier;
    walkTouchLookX = t.clientX;
    walkTouchLookY = t.clientY;
    e.preventDefault();
    break;
  }
}, { passive: false });

window.addEventListener('touchmove', e => {
  if (!walkMode.active || walkTouchLookId === null) return;
  for (let i = 0; i < e.touches.length; i++) {
    const t = e.touches[i];
    if (walkJoystickTouchIds.has(t.identifier)) continue;
    if (t.identifier !== walkTouchLookId) continue;
    const dx = t.clientX - walkTouchLookX;
    const dy = t.clientY - walkTouchLookY;
    walkTouchLookX = t.clientX;
    walkTouchLookY = t.clientY;
    queueWalkLook(dx, dy, true);
    e.preventDefault();
    break;
  }
}, { passive: false });

window.addEventListener('touchend', e => {
  if (walkTouchLookId === null) return;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === walkTouchLookId) {
      clearWalkTouchLookState();
      break;
    }
  }
}, { passive: true });

window.addEventListener('touchcancel', e => {
  if (walkTouchLookId === null) return;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === walkTouchLookId) {
      clearWalkTouchLookState();
      break;
    }
  }
}, { passive: true });

_canvas.addEventListener('pointerdown', e => {
  tapCandidate = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
});

_canvas.addEventListener('pointermove', e => {
  if (!tapCandidate || tapCandidate.id !== e.pointerId) return;
  if (Math.hypot(e.clientX - tapCandidate.x, e.clientY - tapCandidate.y) > 8) {
    tapCandidate.moved = true;
  }
});

_canvas.addEventListener('pointerup', e => {
  if (!tapCandidate || tapCandidate.id !== e.pointerId) return;
  const shouldPick = !tapCandidate.moved && (isTouchPointer(e) || e.button === 0);
  tapCandidate = null;
  if (shouldPick) pickSolarSystemFromScreen(e.clientX, e.clientY);
});

_canvas.addEventListener('pointercancel', e => {
  if (tapCandidate && tapCandidate.id === e.pointerId) tapCandidate = null;
});

_canvas.addEventListener('wheel', e => {
  if (isTouchPointer(e)) return;
  e.preventDefault();
  if (walkMode.active) {
    if (walkCameraMode === 'tp') {
      const zoomOut = e.deltaY > 0 ? WALK_CFG.tpZoomWheelStep : 1 / WALK_CFG.tpZoomWheelStep;
      setWalkTpDistanceTarget(walkTpDistanceTarget * zoomOut);
    }
    return;
  }
  zoomTarget = null;
  const step = 1 + 0.08 * zoomSpeedMul;
  orbitZoom = Math.max(0.05, Math.min(14, orbitZoom * (e.deltaY > 0 ? step : 1 / step)));
  resetOrbitPointerInertia();
}, { passive: false });

function getPlanetCenterRadius(mp, centerOut) {
  mp.obj.pivot.getWorldPosition(centerOut);
  return Math.max(0.25, (mp.obj.baseRadius || 0.8) * mp.obj.state.size);
}

/**
 * World matrix of the rigid frame that carries the terrain mesh (spin group).
 * Using pivot alone misses mp.obj.spin.rotation (day spin), so the ground slides under the walker.
 */
function getWalkAnchorFrameWorldMatrix(mp, out) {
  if (!mp?.obj?.pivot) return false;
  mp.obj.pivot.updateMatrixWorld(true);
  const frame = mp.obj.spin || mp.obj.pivot;
  out.copy(frame.matrixWorld);
  return true;
}

function getWalkTerrainMesh(mp) {
  if (!mp?.obj) return null;
  const direct = mp.obj.getTerrainMesh ? mp.obj.getTerrainMesh() : null;
  if (direct) return direct;
  const pickables = mp.obj.getPickables ? mp.obj.getPickables() : null;
  return Array.isArray(pickables) && pickables.length ? pickables[0] : null;
}

function getWalkLandSpawnOnPlanet(idx) {
  const mp = managedPlanets[idx];
  if (!mp?.obj?.pivot) return null;
  const mesh = getWalkTerrainMesh(mp);
  const posAttr = mesh?.geometry?.attributes?.position;
  if (!posAttr || posAttr.count < 3) return null;

  mesh.updateMatrixWorld(true);
  mp.obj.pivot.getWorldPosition(_walkSpawnCenter);

  const liquid = getLiquidState(mp.obj.state.waterLevel, mp.obj.baseRadius || 0.8);
  const scaledLiquidR = liquid.liquidR * Math.max(mp.obj.state.size, 0.05);
  const liquidEps = Math.max(0.003, scaledLiquidR * 0.012);

  let bestScore = -Infinity;
  let best = null;
  const triCount = posAttr.count - (posAttr.count % 3);
  for (let i = 0; i < triCount; i += 3) {
    _walkSpawnV1.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    _walkSpawnV2.fromBufferAttribute(posAttr, i + 1).applyMatrix4(mesh.matrixWorld);
    _walkSpawnV3.fromBufferAttribute(posAttr, i + 2).applyMatrix4(mesh.matrixWorld);

    const avgR = (
      _walkSpawnV1.distanceTo(_walkSpawnCenter) +
      _walkSpawnV2.distanceTo(_walkSpawnCenter) +
      _walkSpawnV3.distanceTo(_walkSpawnCenter)
    ) / 3;
    if (liquid.hasLiquid && avgR <= scaledLiquidR + liquidEps) continue;

    _walkTmp.copy(_walkSpawnV1).add(_walkSpawnV2).add(_walkSpawnV3).multiplyScalar(1 / 3);
    _walkSpawnRadial.copy(_walkTmp).sub(_walkSpawnCenter);
    const radialLen = _walkSpawnRadial.length();
    if (radialLen < 1e-7) continue;
    _walkSpawnRadial.multiplyScalar(1 / radialLen);

    _walkSpawnNormal
      .subVectors(_walkSpawnV2, _walkSpawnV1)
      .cross(_walkTmp2.subVectors(_walkSpawnV3, _walkSpawnV1));
    if (_walkSpawnNormal.lengthSq() < 1e-9) continue;
    _walkSpawnNormal.normalize();
    if (_walkSpawnNormal.dot(_walkSpawnRadial) < 0) _walkSpawnNormal.multiplyScalar(-1);

    const slopeDot = Math.max(-1, Math.min(1, _walkSpawnNormal.dot(_walkSpawnRadial)));
    const slopeDeg = Math.acos(slopeDot) * THREE.MathUtils.RAD2DEG;
    if (slopeDeg > 56) continue;

    _walkSpawnToCam.copy(camera.position).sub(_walkTmp);
    const distToCam = _walkSpawnToCam.length();
    if (distToCam > 1e-7) _walkSpawnToCam.multiplyScalar(1 / distToCam);
    const facing = Math.max(-1, Math.min(1, _walkSpawnNormal.dot(_walkSpawnToCam)));
    const stableBonus = slopeDeg <= WALK_CFG.slipExitDeg ? 2.2 : 0.0;
    const slopePref = 1 - Math.min(1, Math.abs(slopeDeg - 16) / 26);
    const nearPref = 1 - Math.min(1, distToCam / 70);
    const score = stableBonus + slopePref * 2.1 + facing * 0.85 + nearPref * 0.55;
    if (score <= bestScore) continue;
    bestScore = score;
    best = {
      idx,
      center: _walkSpawnCenter.clone(),
      point: _walkTmp.clone(),
      normal: _walkSpawnNormal.clone(),
      radialDir: _walkSpawnRadial.clone(),
      medium: 'land',
      slopeDeg,
    };
  }
  return best;
}

function resolveWalkStartPlanetAndSpawn() {
  const tryPlanetSpawn = (idx) => {
    if (!managedPlanets[idx]?.obj?.pivot) return null;
    const spawn = getWalkLandSpawnOnPlanet(idx);
    return spawn ? { idx, spawn } : null;
  };

  // Always honor explicit selection first. Do NOT sort the selected index in with
  // fallbacks — a previous bug sorted the whole list by camera distance, which often
  // picked the nearer binary body (commonly "Planet 2") even when another was selected.
  if (selectedPlanetIdx !== null && managedPlanets[selectedPlanetIdx]?.obj?.pivot) {
    const primary = tryPlanetSpawn(selectedPlanetIdx);
    if (primary) return primary;
  }

  const ordered = [];
  for (let i = 0; i < managedPlanets.length; i++) {
    if (!managedPlanets[i]?.obj?.pivot) continue;
    if (i === selectedPlanetIdx) continue;
    ordered.push(i);
  }
  ordered.sort((a, b) => {
    managedPlanets[a].obj.pivot.getWorldPosition(_walkTmp);
    managedPlanets[b].obj.pivot.getWorldPosition(_walkTmp2);
    return _walkTmp.distanceToSquared(camera.position) - _walkTmp2.distanceToSquared(camera.position);
  });
  for (let i = 0; i < ordered.length; i++) {
    const hit = tryPlanetSpawn(ordered[i]);
    if (hit) return hit;
  }
  return null;
}

function classifyWalkSurfaceMedium(mp, hitDistanceWorld) {
  if (!mp?.obj) return 'land';
  const liquid = getLiquidState(mp.obj.state.waterLevel, mp.obj.baseRadius || 0.8);
  if (!liquid.hasLiquid) return 'land';
  const scaledLiquidR = liquid.liquidR * Math.max(mp.obj.state.size, 0.05);
  const eps = Math.max(0.004, scaledLiquidR * 0.012);
  if (hitDistanceWorld > scaledLiquidR + eps) return 'land';
  if (liquid.hasWater) return 'water';
  if (liquid.hasLava) return 'lava';
  return 'land';
}

function sampleWalkSurfaceForPlanet(mp, idx, pos, out = _walkSurfaceScratch) {
  const mesh = getWalkTerrainMesh(mp);
  if (!mesh) return null;
  mesh.updateMatrixWorld(true);
  getPlanetCenterRadius(mp, _walkCenter);
  _walkTmp.copy(pos).sub(_walkCenter);
  const radialLen = _walkTmp.length();
  if (radialLen < 1e-6) return null;
  _walkTmp.multiplyScalar(1 / radialLen);
  const nominalRadius = Math.max(0.25, (mp.obj.baseRadius || 0.8) * mp.obj.state.size);
  // Robust probe: cast from outside the planet back inward along the local radial.
  const probeStart = nominalRadius * 2.6 + WALK_CFG.footOffset * 4;
  const far = Math.max(2.0, probeStart * 1.8);
  _walkRaycaster.ray.origin.copy(_walkCenter).addScaledVector(_walkTmp, probeStart);
  _walkRaycaster.ray.direction.copy(_walkTmp).multiplyScalar(-1);
  _walkRaycaster.near = 0;
  _walkRaycaster.far = far;
  const hits = _walkRaycaster.intersectObject(mesh, false);
  if (!hits.length) return null;
  const hit = hits[0];
  _walkTmp2.copy(hit.point).sub(_walkCenter);
  const surfaceRadius = _walkTmp2.length();
  if (surfaceRadius < 1e-7) return null;
  _walkTmp2.multiplyScalar(1 / surfaceRadius);
  _walkFaceN.copy(hit.face?.normal || _walkTmp2).transformDirection(hit.object.matrixWorld).normalize();
  if (_walkFaceN.dot(_walkTmp2) < 0) _walkFaceN.multiplyScalar(-1);
  const medium = classifyWalkSurfaceMedium(mp, surfaceRadius);
  const slopeDot = Math.max(-1, Math.min(1, _walkFaceN.dot(_walkTmp2)));
  out.idx = idx;
  out.center.copy(_walkCenter);
  out.radialDir.copy(_walkTmp2);
  out.point.copy(hit.point);
  out.normal.copy(_walkFaceN);
  out.surfaceRadius = surfaceRadius;
  out.gap = radialLen - surfaceRadius;
  out.medium = medium;
  out.slopeDeg = Math.acos(slopeDot) * THREE.MathUtils.RAD2DEG;
  return out;
}

/** Same as sampleWalkSurfaceForPlanet but tries nearby radii when the primary ray misses (moving planets / grazing misses). */
function sampleWalkSurfaceForPlanetRobust(mp, idx, pos, out = _walkSurfaceScratch) {
  const first = sampleWalkSurfaceForPlanet(mp, idx, pos, out);
  if (first) return first;
  getPlanetCenterRadius(mp, _walkCenter);
  _walkTmp.copy(pos).sub(_walkCenter);
  const len = _walkTmp.length();
  if (len < 1e-7) return null;
  _walkTmp.multiplyScalar(1 / len);
  const nominalR = Math.max(0.25, (mp.obj.baseRadius || 0.8) * mp.obj.state.size);
  const scales = [1.0, 1.025, 0.975, 1.055, 0.945, 1.085, 0.915, 1.12, 0.89, 1.14];
  for (let si = 0; si < scales.length; si++) {
    _walkTmp2
      .copy(_walkCenter)
      .addScaledVector(_walkTmp, nominalR * scales[si] + WALK_CFG.footOffset);
    const hit = sampleWalkSurfaceForPlanet(mp, idx, _walkTmp2, out);
    if (hit) return hit;
  }
  return null;
}

/** Walk only real mesh hits: march along planet spoke through `pos` until a raycast finds terrain. */
function findWalkSurfaceRadialSweep(mp, idx, pos, out = _walkSurfaceScratch) {
  getPlanetCenterRadius(mp, _walkCenter);
  _walkTmp.copy(pos).sub(_walkCenter);
  const d = _walkTmp.length();
  if (d < 1e-7) return null;
  _walkTmp.multiplyScalar(1 / d);
  const nominalR = Math.max(0.25, (mp.obj.baseRadius || 0.8) * mp.obj.state.size);
  const tLo = nominalR * 0.5;
  const tHi = Math.max(nominalR * 2.85, d + nominalR * 0.65);
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const t = tLo + ((tHi - tLo) * i) / steps;
    _walkTmp2.copy(_walkCenter).addScaledVector(_walkTmp, t);
    const hit = sampleWalkSurfaceForPlanet(mp, idx, _walkTmp2, out);
    if (hit) return hit;
  }
  return sampleWalkSurfaceForPlanetRobust(mp, idx, pos, out);
}

function walkFootOnSurface(surf, out) {
  return out.copy(surf.point).addScaledVector(surf.normal, WALK_CFG.footOffset);
}

function sampleBestWalkSurface(pos, preferredIdx = null) {
  let bestLandGap = Infinity;
  let bestAnyGap = Infinity;
  let hasLand = false;
  let hasAny = false;

  function scoreSurface(sample) {
    if (!sample) return;
    const absGap = Math.abs(sample.gap);
    if (absGap < bestAnyGap) {
      bestAnyGap = absGap;
      copyWalkSurface(sample, _walkBestAnySurface);
      hasAny = true;
    }
    if (sample.medium !== 'land') return;
    if (absGap < bestLandGap) {
      bestLandGap = absGap;
      copyWalkSurface(sample, _walkBestLandSurface);
      hasLand = true;
    }
  }

  if (preferredIdx !== null && preferredIdx >= 0 && preferredIdx < managedPlanets.length) {
    scoreSurface(sampleWalkSurfaceForPlanet(managedPlanets[preferredIdx], preferredIdx, pos));
  }
  for (let i = 0; i < managedPlanets.length; i++) {
    if (i === preferredIdx) continue;
    scoreSurface(sampleWalkSurfaceForPlanet(managedPlanets[i], i, pos));
  }
  if (hasLand && (!hasAny || bestLandGap <= bestAnyGap + WALK_CFG.landPriorityGapAllowance)) {
    return _walkBestLandSurface;
  }
  if (hasAny) return _walkBestAnySurface;
  return null;
}

function resolveWalkCameraOcclusion(target, desiredPos, outPos) {
  outPos.copy(desiredPos);
  _walkTmp3.copy(desiredPos).sub(target);
  const dist = _walkTmp3.length();
  if (dist <= 1e-5) return outPos;

  _walkTmp3.multiplyScalar(1 / dist);
  _walkRaycaster.set(target, _walkTmp3);
  _walkRaycaster.near = 0.02;
  _walkRaycaster.far = dist;

  _walkCamObstacles.length = 0;
  managedPlanets.forEach(mp => {
    const mesh = getWalkTerrainMesh(mp);
    if (mesh?.visible) _walkCamObstacles.push(mesh);
  });
  if (!_walkCamObstacles.length) return outPos;

  const hits = _walkRaycaster.intersectObjects(_walkCamObstacles, false);
  if (!hits.length) return outPos;
  const minSpoke = WALK_CFG.cameraOcclusionMinSpoke;
  const safeDist = Math.max(minSpoke, hits[0].distance - WALK_CFG.tpCollisionPadding);
  outPos.copy(target).addScaledVector(_walkTmp3, safeDist);
  return outPos;
}

/**
 * Keep the camera outside all planet terrain meshes (orbit + walk + transitions).
 * Uses the same surface sampler as walk; runs a few passes so binary pairs cannot sandwich the eye.
 */
function enforceCameraOutsidePlanetMeshes(maxPasses = 4) {
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < managedPlanets.length; i++) {
      const mp = managedPlanets[i];
      if (!mp?.obj?.pivot) continue;
      const mesh = getWalkTerrainMesh(mp);
      if (!mesh || mesh.visible === false) continue;

      const nominalR = getPlanetCenterRadius(mp, _walkCenter);
      _walkSpawnToCam.copy(camera.position).sub(_walkCenter);
      const d2 = _walkSpawnToCam.lengthSq();
      if (d2 > nominalR * nominalR * 24) continue;

      let s = sampleWalkSurfaceForPlanetRobust(mp, i, camera.position);
      if (!s) s = findWalkSurfaceRadialSweep(mp, i, camera.position);
      if (!s) continue;

      const pad = Math.max(WALK_CFG.cameraTerrainClearance, WALK_CFG.tpCollisionPadding * 1.02);
      if (s.gap >= pad) continue;

      _walkSpawnRadial.copy(camera.position).sub(s.center);
      const rLen = _walkSpawnRadial.length();
      if (rLen < 1e-7) _walkSpawnRadial.copy(s.radialDir);
      else _walkSpawnRadial.multiplyScalar(1 / rLen);

      const want = s.surfaceRadius + pad;
      camera.position.copy(s.center).addScaledVector(_walkSpawnRadial, want);
      camera.position.addScaledVector(s.normal, pad * 0.38);
      moved = true;
    }
    if (!moved) break;
  }
}

function setWalkTpDistanceTarget(nextValue) {
  walkTpDistanceTarget = Math.max(WALK_CFG.tpDistanceMin, Math.min(WALK_CFG.tpDistanceMax, nextValue));
  refreshWalkUi();
}

function queueWalkJump() {
  if (!walkMode.active) return;
  walkState.jumpBufferTimer = WALK_CFG.jumpBufferSec;
}

function toggleWalkCameraMode() {
  // Intentional no-op: walk camera is always free-look third-person.
}

function clearWalkInputState() {
  walkInput.left = false;
  walkInput.right = false;
  walkInput.fwd = false;
  walkInput.back = false;
  walkInput.shiftRun = false;
  walkInput.runLocked = false;
  resetWalkJoystick();
}

function refreshWalkUi() {
  const btn = document.getElementById('btn-walk');
  const controls = document.getElementById('walk-controls');
  const runLockBtn = controls ? controls.querySelector('button[data-walk="runLock"]') : null;
  if (btn) {
    btn.classList.toggle('active', walkMode.active);
  }
  document.body.classList.toggle('walk-touch-look-active', walkMode.active);
  if (controls) {
    controls.style.display = walkMode.active ? 'flex' : 'none';
  }
  if (runLockBtn) {
    runLockBtn.classList.toggle('active', !!walkInput.runLocked);
    runLockBtn.setAttribute('aria-pressed', walkInput.runLocked ? 'true' : 'false');
  }
  if (typeof syncWalkModeChrome === 'function') syncWalkModeChrome(walkMode.active);
}

function stopWalkMode() {
  if (!walkMode.active) return;
  walkTransition.active = false;
  walkTransition.startedAt = 0;
  walkMode.active = false;
  walkMode.spawnPlanetIdx = null;
  zoomTarget = null;
  if (walkState.prevFov !== null) {
    camera.fov = walkState.prevFov;
    camera.updateProjectionMatrix();
    walkState.prevFov = null;
  }
  walkAvatar.visible = false;
  clearWalkInputState();
  walkLookInput.x = 0;
  walkLookInput.y = 0;
  walkState.velocity.set(0, 0, 0);
  walkState.grounded = false;
  walkState.jumpBufferTimer = 0;
  walkState.jumpCooldownTimer = 0;
  walkState.coyoteTimer = 0;
  walkState.anchorPlanetIdx = null;
  walkState.surfaceType = 'land';
  walkState.surfaceSlopeDeg = 0;
  walkState.sliding = false;
  walkState.bouncePhase = 0;
  walkState.bounceBlend = 0;
  walkState.missedSurfaceFrames = 0;
  walkState.lookPitch = 0;
  walkState.anchorLastMatrixValid = false;
  clearWalkTouchLookState();
  walkJoystickTouchIds.clear();
  setWalkJoystickCapturingPointer(null);
  desktopWalkLookReady = false;
  mobPointers.clear();
  mobSingleReady = false;
  refreshWalkUi();
  syncOrbitStateFromActualCamera();
}

function startWalkMode(idx, spawnSurface = null) {
  if (idx === null || idx === undefined) return;
  const mp = managedPlanets[idx];
  if (!mp) return;
  walkTransition.active = false;
  walkTransition.startedAt = 0;
  walkMode.active = true;
  walkMode.spawnPlanetIdx = idx;
  walkCameraMode = 'tp';
  if (walkState.prevFov === null) walkState.prevFov = camera.fov;
  camera.fov = WALK_CFG.walkFov;
  camera.updateProjectionMatrix();
  walkPrevMs = performance.now();
  walkLookInput.x = 0;
  walkLookInput.y = 0;
  clearWalkTouchLookState();
  clearWalkInputState();
  setWalkTpDistanceTarget(WALK_CFG.cameraDistance);
  walkTpDistance = walkTpDistanceTarget;

  let startSurface = spawnSurface;
  mp.obj.pivot.getWorldPosition(_walkCenter);
  if (startSurface) {
    walkFootOnSurface(startSurface, walkState.position);
    walkState.up.copy(startSurface.radialDir).normalize();
  } else {
    walkState.position.copy(camera.position);
    startSurface = sampleWalkSurfaceForPlanetRobust(mp, idx, walkState.position);
    if (startSurface) {
      walkFootOnSurface(startSurface, walkState.position);
      walkState.up.copy(startSurface.radialDir).normalize();
    }
    const fallbackR = getPlanetCenterRadius(mp, _walkCenter) + WALK_CFG.footOffset;
    if (!startSurface) {
      walkState.up.copy(camera.position).sub(_walkCenter);
      if (walkState.up.lengthSq() < 1e-8) walkState.up.set(0, 1, 0);
      walkState.up.normalize();
      walkState.position.copy(_walkCenter).addScaledVector(walkState.up, fallbackR);
      startSurface = findWalkSurfaceRadialSweep(mp, idx, walkState.position)
        || sampleWalkSurfaceForPlanetRobust(mp, idx, walkState.position);
      if (startSurface) {
        walkFootOnSurface(startSurface, walkState.position);
        walkState.up.copy(startSurface.radialDir).normalize();
      }
    }
  }

  camera.getWorldDirection(_walkTmp);
  if (_walkTmp.lengthSq() < 1e-8) _walkTmp.set(1, 0, 0);
  walkState.viewDir.copy(_walkTmp.normalize());
  walkState.forward.copy(walkState.viewDir).projectOnPlane(walkState.up);
  if (walkState.forward.lengthSq() < 1e-8) {
    walkState.forward.copy(_walkX).projectOnPlane(walkState.up);
    if (walkState.forward.lengthSq() < 1e-8) walkState.forward.crossVectors(_walkY, walkState.up);
  }
  walkState.forward.normalize();
  syncWalkPitchFromView();

  walkState.velocity.set(0, 0, 0);
  walkState.grounded = true;
  walkState.jumpBufferTimer = 0;
  walkState.jumpCooldownTimer = 0;
  walkState.coyoteTimer = WALK_CFG.coyoteTimeSec;
  walkState.anchorPlanetIdx = idx;
  walkState.surfaceType = startSurface ? startSurface.medium : 'land';
  walkState.surfaceSlopeDeg = startSurface ? startSurface.slopeDeg : 0;
  walkState.sliding = false;
  walkState.bouncePhase = 0;
  walkState.bounceBlend = 0;
  walkState.missedSurfaceFrames = 0;
  desktopWalkLookReady = false;
  getWalkAnchorFrameWorldMatrix(mp, walkState.anchorLastMatrix);
  walkState.anchorLastMatrixValid = true;
  walkAvatar.position.copy(walkState.position);
  walkAvatar.visible = true;
  refreshWalkUi();
}

function transitionCameraToWalkSpawn(spawn, durationMs = 680) {
  return new Promise((resolve) => {
    const token = ++walkTransition.token;
    walkTransition.active = true;
    walkTransition.startedAt = performance.now();

    const startPos = camera.position.clone();
    const startUp = camera.up.clone();
    camera.getWorldDirection(_walkTmp3);
    const startLook = startPos.clone().addScaledVector(_walkTmp3, 6);

    _walkTmp.copy(camera.position).sub(spawn.point).projectOnPlane(spawn.radialDir);
    if (_walkTmp.lengthSq() < 1e-8) _walkTmp.crossVectors(_walkY, spawn.radialDir);
    if (_walkTmp.lengthSq() < 1e-8) _walkTmp.crossVectors(spawn.normal, spawn.radialDir);
    if (_walkTmp.lengthSq() < 1e-8) _walkTmp.set(1, 0, 0);
    _walkTmp.normalize();

    const endLook = spawn.point.clone().addScaledVector(spawn.radialDir, WALK_CFG.cameraTargetLift);
    const endPos = endLook
      .clone()
      .addScaledVector(_walkTmp, -walkTpDistanceTarget)
      .addScaledVector(spawn.radialDir, WALK_CFG.cameraHeight);
    resolveWalkCameraOcclusion(endLook, endPos, endPos);
    // Occlusion pulls along target→eye spoke and was collapsing the radial height offset.
    const endUp = spawn.radialDir.clone();
    _walkTmp2.copy(endPos).sub(endLook);
    endPos.addScaledVector(endUp, WALK_CFG.cameraHeight - _walkTmp2.dot(endUp));

    const t0 = performance.now();
    function frame(now) {
      if (token !== walkTransition.token) {
        walkTransition.active = false;
        walkTransition.startedAt = 0;
        resolve();
        return;
      }
      const p = Math.max(0, Math.min(1, (now - t0) / durationMs));
      const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      camera.position.lerpVectors(startPos, endPos, eased);
      _walkTmp2.lerpVectors(startLook, endLook, eased);
      camera.up.lerpVectors(startUp, endUp, eased).normalize();
      camera.lookAt(_walkTmp2);
      enforceCameraOutsidePlanetMeshes();
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        walkTransition.active = false;
        walkTransition.startedAt = 0;
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

function applyWalkLook() {
  if (!walkMode.active) return;
  const yaw = -walkLookInput.x;
  const pitchDelta = -walkLookInput.y;
  walkLookInput.x = 0;
  walkLookInput.y = 0;

  _walkTmp.copy(walkState.viewDir).projectOnPlane(walkState.up);
  if (_walkTmp.lengthSq() < 1e-8) _walkTmp.copy(walkState.forward).projectOnPlane(walkState.up);
  if (_walkTmp.lengthSq() < 1e-8) _walkTmp.copy(_walkX).projectOnPlane(walkState.up);
  if (_walkTmp.lengthSq() < 1e-8) return;
  _walkTmp.normalize();

  if (Math.abs(yaw) > 1e-6) _walkTmp.applyAxisAngle(walkState.up, yaw).normalize();

  walkState.lookPitch = Math.max(
    -WALK_MAX_LOOK_PITCH,
    Math.min(WALK_MAX_LOOK_PITCH, walkState.lookPitch + pitchDelta)
  );
  const pitchCos = Math.cos(walkState.lookPitch);
  const pitchSin = Math.sin(walkState.lookPitch);
  walkState.viewDir
    .copy(_walkTmp).multiplyScalar(pitchCos)
    .addScaledVector(walkState.up, pitchSin)
    .normalize();
}

function updateWalkCameraPose(dt, bounce = 0) {
  walkTpDistance += (walkTpDistanceTarget - walkTpDistance) * Math.min(1, dt * WALK_CFG.tpZoomSmooth);
  const dist = walkTpDistance;

  // Character-anchored rig: chest (composition) + eye (FPS) share walkState.up (gravity / planetary up).
  const lift = WALK_CFG.cameraTargetLift + bounce * 0.5;
  const chest = _walkTmp2.copy(walkState.position).addScaledVector(walkState.up, lift);
  const eye = _walkTmp3.copy(walkState.position).addScaledVector(
    walkState.up,
    WALK_CFG.fpEyeHeight + bounce * 0.32
  );

  const d0 = WALK_CFG.tpFpsBlendEnd;
  const d1 = WALK_CFG.tpFpsBlendStart;
  let fpBlend = 0;
  if (dist <= d0) fpBlend = 1;
  else if (dist < d1) fpBlend = 1 - (dist - d0) / (d1 - d0);
  fpBlend = fpBlend * fpBlend * (3 - 2 * fpBlend);

  const camH = (WALK_CFG.cameraHeight + bounce) * (1 - fpBlend);
  const tpPos = _walkCamPos
    .copy(chest)
    .addScaledVector(walkState.viewDir, -dist)
    .addScaledVector(walkState.up, camH);
  const fpPos = _walkSpawnToCam
    .copy(eye)
    .addScaledVector(walkState.viewDir, -WALK_CFG.fpsEyePullback);
  _walkCamPos.copy(tpPos).lerp(fpPos, fpBlend);

  _walkCamTarget.copy(chest).lerp(eye, fpBlend * 0.78);

  // Preserve (camera − chest)·up through occlusion / mesh nudge so the rig does not sink
  // when orbiting behind terrain (spoke pull used to shrink the vertical offset).
  _walkSpawnRadial.copy(_walkCamPos).sub(chest);
  const keepAlongUp = _walkSpawnRadial.dot(walkState.up);
  resolveWalkCameraOcclusion(_walkCamTarget, _walkCamPos, _walkCamPos);
  _walkSpawnRadial.copy(_walkCamPos).sub(chest);
  _walkCamPos.addScaledVector(walkState.up, keepAlongUp - _walkSpawnRadial.dot(walkState.up));

  camera.position.lerp(_walkCamPos, Math.min(1, dt * WALK_CFG.cameraLag));

  const lead = WALK_CFG.cameraLead * (1 - fpBlend * 0.94);
  _walkTmp.copy(chest).addScaledVector(walkState.viewDir, lead);
  const lookFp = _walkSpawnRadial.copy(eye).addScaledVector(walkState.viewDir, 0.16);
  _walkTmp.lerp(lookFp, fpBlend);

  camera.up.lerp(walkState.up, Math.min(1, dt * 8)).normalize();
  camera.lookAt(_walkTmp);

  const fov = THREE.MathUtils.lerp(WALK_CFG.walkFov, WALK_CFG.fpsFov, fpBlend);
  if (Math.abs(camera.fov - fov) > 0.15) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  enforceCameraOutsidePlanetMeshes();

  if (walkMode.active) {
    _walkSpawnRadial.copy(camera.position).sub(chest);
    camera.position.addScaledVector(
      walkState.up,
      keepAlongUp - _walkSpawnRadial.dot(walkState.up)
    );
  }
}

function getWalkSurfaceSpeedFactor(surface) {
  if (!surface) return 1;
  if (surface.medium === 'water') return WALK_CFG.waterSpeedFactor;
  if (surface.medium === 'lava') return WALK_CFG.lavaSpeedFactor;
  return 1;
}

/** Hard cap: only limit how far you can drift *outward* from the planet center (no inward min — surface pull handles that). */
function clampWalkPositionToAnchor(anchorMp, dt) {
  if (!anchorMp?.obj?.pivot) return;
  const nominalR = getPlanetCenterRadius(anchorMp, _walkCenter);
  const foot = WALK_CFG.footOffset;
  const absSlack = WALK_CFG.anchorSphereAbsSlack != null ? WALK_CFG.anchorSphereAbsSlack : 0;
  const maxR = nominalR * WALK_CFG.anchorSphereSlackMult + foot * 3 + absSlack;
  _walkTmp.copy(walkState.position).sub(_walkCenter);
  const d = _walkTmp.length();
  if (d < 1e-10) return;
  _walkTmp.multiplyScalar(1 / d);
  if (d <= maxR) return;
  const t = Math.min(1, WALK_CFG.anchorSpherePull * dt);
  const newD = d + (maxR - d) * t;
  walkState.position.copy(_walkCenter).addScaledVector(_walkTmp, newD);
  const rv = walkState.velocity.dot(_walkTmp);
  if (rv > 0) walkState.velocity.addScaledVector(_walkTmp, -rv);
}

/**
 * Characteristic radius for gravity tuning: baseRadius × size (no collision floor),
 * so tiny moons vs big planets produce a real min/max spread.
 */
function getWalkPlanetRadiusMetric(mp) {
  if (!mp?.obj) return 0.8;
  return (mp.obj.baseRadius || 0.8) * Math.max(mp.obj.state?.size ?? 1, 0.05);
}

function computeWalkPlanetRadiusBounds() {
  let rMin = Infinity;
  let rMax = -Infinity;
  for (let i = 0; i < managedPlanets.length; i++) {
    const mp = managedPlanets[i];
    if (!mp?.obj?.pivot) continue;
    const r = getWalkPlanetRadiusMetric(mp);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
  }
  if (!Number.isFinite(rMin) || rMax < rMin + 1e-6) {
    return { rMin: 0.42, rMax: 1.2 };
  }
  return { rMin, rMax };
}

/** Smallest worlds → walkGravityMin; largest → walkGravityMax. Jump apex uses same g for v0 = sqrt(2gH). */
function getWalkGravityForPlanet(anchorMp) {
  const { rMin, rMax } = computeWalkPlanetRadiusBounds();
  const R = anchorMp ? getWalkPlanetRadiusMetric(anchorMp) : (rMin + rMax) * 0.5;
  const span = Math.max(1e-5, rMax - rMin);
  const t = Math.max(0, Math.min(1, (R - rMin) / span));
  const g = THREE.MathUtils.lerp(WALK_CFG.walkGravityMin, WALK_CFG.walkGravityMax, t);
  const maxFall = THREE.MathUtils.lerp(WALK_CFG.walkMaxFallMin, WALK_CFG.walkMaxFallMax, t);
  return { g, maxFall, R, rMin, rMax, t };
}

/**
 * WALK_CFG planar speeds are tuned at a reference shell radius. Scale by R_ref / R so similar
 * angular motion across tiny moons and huge worlds (uses physics radius, not mesh tessellation).
 */
const WALK_SPEED_REF_RADIUS = 0.62;

function getWalkSurfaceSpeedScale(anchorMp) {
  const R = getWalkPlanetRadiusMetric(anchorMp);
  const mul = WALK_SPEED_REF_RADIUS / Math.max(R, 1e-5);
  return Math.max(0.22, Math.min(7.5, mul));
}

/** Point light AOE scales with planet shell radius so large worlds get a visible pool on the ground. */
function syncWalkPlayerLightToPlanetScale(anchorMp) {
  if (!walkPlayerLight || !anchorMp?.obj) return;
  const R = getWalkPlanetRadiusMetric(anchorMp);
  const mul = Math.max(0.4, Math.min(14, R / Math.max(WALK_SPEED_REF_RADIUS, 1e-5)));
  walkPlayerLight.distance = WALK_CFG.playerLightDistance * mul;
  walkPlayerLight.intensity = WALK_CFG.playerLightIntensity * Math.min(3.4, Math.pow(mul, 0.52));
}

/** Light mesh-only correction along face normal (does not fight horizontal walking). */
function applyWalkSurfacePostCorrection(anchorMp, anchorIdx, dt) {
  const stick = sampleWalkSurfaceForPlanetRobust(anchorMp, anchorIdx, walkState.position);
  if (!stick) return;
  const n = stick.normal;
  walkFootOnSurface(stick, _walkGroundTarget);
  const along = _walkTmp.copy(walkState.position).sub(stick.point).dot(n);
  const err = along - WALK_CFG.footOffset;
  const vN = walkState.velocity.dot(n);

  if (err < -0.008) {
    walkState.position.copy(_walkGroundTarget);
    if (vN < 0) walkState.velocity.addScaledVector(n, -vN);
    return;
  }

  if (walkState.grounded && Math.abs(err) > 0.00025) {
    const k = Math.min(1, 10 * dt);
    walkState.position.addScaledVector(n, -err * k);
    return;
  }

  if (walkState.coyoteTimer > 0 && vN < 0.08 && err > 0.001) {
    walkState.position.addScaledVector(n, -err * Math.min(1, 8 * dt));
  } else if (vN <= 0.03 && err > 0.012) {
    walkState.position.addScaledVector(n, -err * Math.min(1, 6 * dt));
  }
}

function updateWalkMode(dt) {
  const anchorIdx = walkState.anchorPlanetIdx !== null
    ? walkState.anchorPlanetIdx
    : walkMode.spawnPlanetIdx;
  const anchorMp = anchorIdx !== null ? managedPlanets[anchorIdx] : null;
  if (!anchorMp?.obj?.pivot) {
    stopWalkMode();
    return;
  }
  const walkGrav = getWalkGravityForPlanet(anchorMp);
  const walkG = walkGrav.g;
  const walkMaxFall = walkGrav.maxFall;
  const speedScale = getWalkSurfaceSpeedScale(anchorMp);
  const landOutRad = WALK_CFG.landMaxOutwardSpeed * speedScale;
  syncWalkPlayerLightToPlanetScale(anchorMp);
  if (anchorMp?.obj?.pivot) {
    if (!getWalkAnchorFrameWorldMatrix(anchorMp, _walkAnchorCurr)) {
      stopWalkMode();
      return;
    }
    if (walkState.anchorLastMatrixValid) {
      _walkAnchorInv.copy(walkState.anchorLastMatrix).invert();
      _walkAnchorDelta.multiplyMatrices(_walkAnchorCurr, _walkAnchorInv);
      walkState.position.applyMatrix4(_walkAnchorDelta);
      _walkAnchorRot.setFromMatrix4(_walkAnchorDelta);
      walkState.velocity.applyMatrix3(_walkAnchorRot);
      walkState.up.transformDirection(_walkAnchorDelta).normalize();
      walkState.forward.transformDirection(_walkAnchorDelta).normalize();
      walkState.viewDir.transformDirection(_walkAnchorDelta).normalize();
    }
    walkState.anchorLastMatrix.copy(_walkAnchorCurr);
    walkState.anchorLastMatrixValid = true;
  } else {
    walkState.anchorLastMatrixValid = false;
  }
  walkState.jumpBufferTimer = Math.max(0, walkState.jumpBufferTimer - dt);
  walkState.jumpCooldownTimer = Math.max(0, walkState.jumpCooldownTimer - dt);
  walkState.coyoteTimer = Math.max(0, walkState.coyoteTimer - dt);
  applyWalkLook();
  let currentSurface = anchorMp
    ? sampleWalkSurfaceForPlanetRobust(anchorMp, anchorIdx, walkState.position)
    : null;
  if (!currentSurface && anchorMp) {
    currentSurface = findWalkSurfaceRadialSweep(anchorMp, anchorIdx, walkState.position);
  }
  if (!currentSurface) {
    walkState.missedSurfaceFrames += 1;

    const rescue = anchorMp
      ? findWalkSurfaceRadialSweep(anchorMp, anchorIdx, walkState.position)
      : null;
    if (rescue) {
      walkFootOnSurface(rescue, walkState.position);
      walkState.up.copy(rescue.radialDir).normalize();
      syncWalkPitchFromView();
      walkState.velocity.multiplyScalar(0.55);
      walkState.grounded = true;
      walkState.jumpBufferTimer = 0;
      walkState.jumpCooldownTimer = 0;
      walkState.coyoteTimer = WALK_CFG.coyoteTimeSec;
      walkState.missedSurfaceFrames = 0;
      walkState.anchorPlanetIdx = anchorIdx;
      getWalkAnchorFrameWorldMatrix(anchorMp, walkState.anchorLastMatrix);
      walkState.anchorLastMatrixValid = true;
      applyWalkSurfacePostCorrection(anchorMp, anchorIdx, dt);
      clampWalkPositionToAnchor(anchorMp, dt);
      walkAvatar.position.copy(walkState.position);
      updateWalkCameraPose(dt, 0);
      return;
    }

    if (walkState.missedSurfaceFrames > 24) stopWalkMode();
    applyWalkSurfacePostCorrection(anchorMp, anchorIdx, dt);
    clampWalkPositionToAnchor(anchorMp, dt);
    walkAvatar.position.copy(walkState.position);
    updateWalkCameraPose(dt, 0);
    return;
  }
  walkState.missedSurfaceFrames = 0;
  walkState.anchorPlanetIdx = anchorIdx;
  walkState.surfaceType = currentSurface.medium;
  walkState.surfaceSlopeDeg = currentSurface.slopeDeg;
  walkState.up.lerp(currentSurface.radialDir, Math.min(1, dt * WALK_CFG.groundNormalLerp)).normalize();
  syncWalkPitchFromView();

  const nearGround = Math.abs(currentSurface.gap) <= WALK_CFG.groundProbeDistance;
  const outwardSpeed = walkState.velocity.dot(walkState.up);
  if (nearGround) walkState.coyoteTimer = WALK_CFG.coyoteTimeSec;
  if (!walkState.grounded && nearGround && outwardSpeed <= landOutRad) {
    walkState.grounded = true;
  }
  if (walkState.grounded && !nearGround && walkState.coyoteTimer <= 0) {
    walkState.grounded = false;
  }

  walkState.forward.copy(walkState.viewDir).projectOnPlane(currentSurface.normal);
  if (walkState.forward.lengthSq() < 1e-8) {
    walkState.forward.copy(_walkX).projectOnPlane(walkState.up);
    if (walkState.forward.lengthSq() < 1e-8) walkState.forward.crossVectors(_walkY, walkState.up);
  }
  walkState.forward.normalize();
  _walkRight.crossVectors(walkState.forward, walkState.up).normalize();

  const moveX = ((walkInput.right ? 1 : 0) - (walkInput.left ? 1 : 0)) + walkAnalog.x;
  const moveY = ((walkInput.fwd ? 1 : 0) - (walkInput.back ? 1 : 0)) + walkAnalog.y;
  _walkDesired.copy(_walkRight).multiplyScalar(moveX).addScaledVector(walkState.forward, moveY);
  const moveLen = _walkDesired.length();
  if (moveLen > 1) _walkDesired.multiplyScalar(1 / moveLen);

  const runBoost = walkInput.runLocked || walkInput.shiftRun;
  const sprinting = runBoost && moveLen > WALK_CFG.runInputMin;
  const speedFactor = getWalkSurfaceSpeedFactor(currentSurface);
  const desiredSpeed = WALK_CFG.moveSpeed * speedScale * speedFactor * (sprinting ? WALK_CFG.sprintBoost : 1);
  _walkDesired.projectOnPlane(currentSurface.normal);
  if (_walkDesired.lengthSq() > 1e-8) _walkDesired.setLength(desiredSpeed);

  const radialVel = walkState.velocity.dot(walkState.up);
  _walkTmp.copy(walkState.velocity).addScaledVector(walkState.up, -radialVel);
  const controlAccel = (walkState.grounded
    ? WALK_CFG.acceleration
    : WALK_CFG.acceleration * WALK_CFG.airControlFactor) * speedScale;
  const accelStep = Math.min(1, controlAccel * dt);
  _walkTmp.lerp(_walkDesired, accelStep);

  let nextRadialVel = radialVel;
  if (walkState.grounded) {
    if (currentSurface.slopeDeg > WALK_CFG.slipEnterDeg) walkState.sliding = true;
    else if (currentSurface.slopeDeg <= WALK_CFG.slipExitDeg) walkState.sliding = false;
    if (walkState.sliding) {
      _walkTmp2.copy(currentSurface.radialDir).multiplyScalar(-1).projectOnPlane(currentSurface.normal);
      const downhillLen = _walkTmp2.length();
      if (downhillLen > 1e-8) {
        _walkTmp2.multiplyScalar(1 / downhillLen);
        const slopeGain = Math.max(0, Math.min(1, (currentSurface.slopeDeg - WALK_CFG.slipExitDeg) / (90 - WALK_CFG.slipExitDeg)));
        const slideImpulse = WALK_CFG.slideAccel * speedScale * (0.45 + slopeGain * 1.2);
        _walkTmp.addScaledVector(_walkTmp2, slideImpulse * dt);
      }
    }
    nextRadialVel = Math.min(nextRadialVel, 0);
  } else {
    walkState.sliding = false;
    nextRadialVel = Math.max(-walkMaxFall, nextRadialVel - walkG * dt);
  }

  const inputIdle = moveLen < WALK_CFG.moveInputDeadzone;
  if (inputIdle && !(walkState.grounded && walkState.sliding)) {
    const dragFactor = walkState.grounded ? WALK_CFG.drag : WALK_CFG.airDrag;
    const extra = walkState.grounded ? WALK_CFG.idlePlanarBrake : WALK_CFG.idleAirPlanarBrake;
    const damp = Math.max(0, 1 - (dragFactor + extra) * dt);
    _walkTmp.multiplyScalar(damp);
    const eps = WALK_CFG.idlePlanarSnapSpeed * speedScale;
    if (_walkTmp.lengthSq() < eps * eps) _walkTmp.set(0, 0, 0);
  } else if (inputIdle && walkState.grounded && walkState.sliding) {
    _walkTmp.multiplyScalar(Math.max(0, 1 - WALK_CFG.drag * 0.42 * dt));
  }

  const canJump = walkState.jumpBufferTimer > 0
    && walkState.jumpCooldownTimer <= 0
    && (walkState.grounded || walkState.coyoteTimer > 0);
  if (canJump) {
    walkState.grounded = false;
    walkState.jumpBufferTimer = 0;
    walkState.jumpCooldownTimer = WALK_CFG.jumpCooldownSec;
    walkState.coyoteTimer = 0;
    nextRadialVel = Math.sqrt(Math.max(0, 2 * walkG * WALK_CFG.jumpApexHeight));
  }

  walkState.velocity.copy(_walkTmp).addScaledVector(walkState.up, nextRadialVel);
  if (!walkState.grounded) {
    const rvAir = walkState.velocity.dot(walkState.up);
    _walkTmp.copy(walkState.velocity).addScaledVector(walkState.up, -rvAir);
    const planar = _walkTmp.length();
    const cap = WALK_CFG.maxAirHorizontalSpeed * speedScale;
    if (planar > cap) _walkTmp.multiplyScalar(cap / planar);
    walkState.velocity.copy(_walkTmp).addScaledVector(walkState.up, rvAir);
  }

  _walkIntPos.copy(walkState.position).addScaledVector(walkState.velocity, dt);
  const nextSurface = anchorMp
    ? sampleWalkSurfaceForPlanetRobust(anchorMp, anchorIdx, _walkIntPos)
    : null;
  if (!nextSurface) {
    const sweep = anchorMp ? findWalkSurfaceRadialSweep(anchorMp, anchorIdx, _walkIntPos) : null;
    if (sweep) {
      walkFootOnSurface(sweep, walkState.position);
      const rvS = walkState.velocity.dot(sweep.radialDir);
      if (rvS < 0) walkState.velocity.addScaledVector(sweep.radialDir, -rvS);
    } else {
      getPlanetCenterRadius(anchorMp, _walkCenter);
      const nominalR = Math.max(0.25, (anchorMp.obj.baseRadius || 0.8) * anchorMp.obj.state.size);
      _walkTmp.copy(_walkIntPos).sub(_walkCenter);
      const dist = _walkTmp.length();
      if (dist > 1e-8) {
        _walkTmp.multiplyScalar(1 / dist);
        const resamplePos = _walkGroundTarget
          .copy(_walkCenter)
          .addScaledVector(_walkTmp, nominalR * WALK_CFG.airResampleRadiusMult + WALK_CFG.footOffset);
        const rescue = sampleWalkSurfaceForPlanetRobust(anchorMp, anchorIdx, resamplePos);
        if (rescue) {
          walkFootOnSurface(rescue, walkState.position);
          const rvRes = walkState.velocity.dot(rescue.radialDir);
          if (rvRes < 0) walkState.velocity.addScaledVector(rescue.radialDir, -rvRes);
        } else {
          walkState.position.copy(_walkIntPos);
        }
      } else {
        walkState.position.copy(_walkIntPos);
      }
    }
    applyWalkSurfacePostCorrection(anchorMp, anchorIdx, dt);
    clampWalkPositionToAnchor(anchorMp, dt);
    if (walkState.grounded && walkState.coyoteTimer <= 0) walkState.grounded = false;
  } else {
    const nextGapAbs = Math.abs(nextSurface.gap);
    const nextOutwardSpeed = walkState.velocity.dot(nextSurface.radialDir);
    if (!walkState.grounded && nextGapAbs <= WALK_CFG.groundProbeDistance && nextOutwardSpeed <= landOutRad) {
      walkState.grounded = true;
    }
    if (walkState.grounded) {
      walkFootOnSurface(nextSurface, _walkGroundTarget);
      walkState.position.copy(_walkIntPos);
      const sn = nextSurface.normal;
      const alongErr = _walkTmp.copy(walkState.position).sub(nextSurface.point).dot(sn) - WALK_CFG.footOffset;
      let k = Math.min(1, dt * (moveLen > WALK_CFG.moveInputDeadzone ? WALK_CFG.groundSnapMove : WALK_CFG.groundSnapIdle));
      if (Math.abs(alongErr) > WALK_CFG.groundProbeDistance * 0.45) k = Math.max(k, 0.72);
      if (Math.abs(alongErr) > WALK_CFG.groundProbeDistance * 2.2) k = Math.max(k, 0.92);
      walkState.position.addScaledVector(sn, -alongErr * Math.min(1, k));
      const surfaceRadialVel = walkState.velocity.dot(nextSurface.radialDir);
      if (surfaceRadialVel > 0) walkState.velocity.addScaledVector(nextSurface.radialDir, -surfaceRadialVel);
      const vIn = walkState.velocity.dot(sn);
      if (vIn < 0) walkState.velocity.addScaledVector(sn, -vIn);
      walkState.velocity.projectOnPlane(sn);
      walkState.coyoteTimer = WALK_CFG.coyoteTimeSec;
    } else {
      walkFootOnSurface(nextSurface, _walkGroundTarget);
      let pull = 0;
      if (nextGapAbs > WALK_CFG.groundProbeDistance * 1.2) pull = Math.min(1, dt * 20);
      if (nextGapAbs > 0.07) pull = Math.max(pull, Math.min(1, dt * 28));
      if (nextGapAbs < -0.006) pull = Math.max(pull, 0.62);
      if (nextOutwardSpeed < -0.02 && nextGapAbs > WALK_CFG.groundProbeDistance * 0.6) {
        pull = Math.max(pull, Math.min(1, dt * 24));
      }
      walkState.position.copy(_walkIntPos).lerp(_walkGroundTarget, Math.min(1, pull));
    }
    walkState.anchorPlanetIdx = anchorIdx;
    walkState.surfaceType = nextSurface.medium;
    walkState.surfaceSlopeDeg = nextSurface.slopeDeg;
    walkState.up.lerp(nextSurface.radialDir, Math.min(1, dt * WALK_CFG.groundNormalLerp)).normalize();
  }
  applyWalkSurfacePostCorrection(anchorMp, anchorIdx, dt);
  clampWalkPositionToAnchor(anchorMp, dt);

  const planarSpeed = _walkTmp.copy(walkState.velocity).projectOnPlane(walkState.up).length();
  let bounceTarget = Math.min(1, planarSpeed / Math.max(0.001, desiredSpeed));
  if (moveLen < WALK_CFG.moveInputDeadzone || !walkState.grounded) bounceTarget = 0;
  walkState.bounceBlend += (bounceTarget - walkState.bounceBlend) * Math.min(1, dt * WALK_CFG.bounceResponse);
  walkState.bouncePhase += dt * (WALK_CFG.bounceFreq + planarSpeed * 10);
  const bounce = walkState.grounded
    ? Math.abs(Math.sin(walkState.bouncePhase)) * WALK_CFG.bounceAmp * walkState.bounceBlend
    : 0;

  walkAvatar.position.copy(walkState.position).addScaledVector(walkState.up, bounce * 0.45);
  _walkBasisZ.crossVectors(walkState.forward, walkState.up);
  if (_walkBasisZ.lengthSq() < 1e-8) _walkBasisZ.crossVectors(_walkRight, walkState.up);
  if (_walkBasisZ.lengthSq() < 1e-8) _walkBasisZ.set(0, 0, 1);
  _walkBasisZ.normalize();
  _walkBasisMat.makeBasis(walkState.forward, walkState.up, _walkBasisZ);
  _walkQ.setFromRotationMatrix(_walkBasisMat);
  walkAvatar.quaternion.slerp(_walkQ, Math.min(1, dt * WALK_CFG.avatarTurnLerp));
  walkAvatar.visible = true;

  updateWalkCameraPose(dt, bounce);
}

function updateCamera(curScale) {
  if (walkMode.active) {
    if (walkTransition.active) {
      walkTransition.active = false;
      walkTransition.startedAt = 0;
    }
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - walkPrevMs) / 1000));
    walkPrevMs = now;
    updateWalkMode(dt);
    return;
  }
  if (walkTransition.active) {
    const elapsed = performance.now() - (walkTransition.startedAt || 0);
    if (elapsed > 2200) {
      walkTransition.active = false;
      walkTransition.startedAt = 0;
    } else {
      return;
    }
  }
  if (cameraMode === 'sun') {
    orbitTheta += dTheta; dTheta *= 0.88;
    orbitPhi = Math.max(0.06, Math.min(Math.PI - 0.06, orbitPhi + dPhi));
    dPhi *= 0.88;
    if (autoRotate && mobPointers.size === 0 && (!dragging || dragButton !== 0)) orbitTheta += 0.0007; // gentle idle drift

    const r = ORBIT_BASE * curScale * orbitZoom;
    const sp = Math.sin(orbitPhi), cp = Math.cos(orbitPhi);
    const lookAt = cameraTarget.clone().add(panOffset);
    camera.position.set(
      lookAt.x + r * sp * Math.sin(orbitTheta),
      lookAt.y + r * cp,
      lookAt.z + r * sp * Math.cos(orbitTheta)
    );
    camera.lookAt(lookAt);
  } else {
    // Planet view: orbit around selected planet (fallback to system center).
    pOrbitTheta += pDTheta; pDTheta *= 0.88;
    pOrbitPhi = Math.max(0.06, Math.min(Math.PI - 0.06, pOrbitPhi + pDPhi));
    pDPhi *= 0.88;
    if (autoRotate && mobPointers.size === 0 && (!dragging || dragButton !== 0)) pOrbitTheta += 0.0012;

    let baseTarget = null;
    if (selectedPlanetIdx !== null) {
      const selected = managedPlanets[selectedPlanetIdx];
      if (selected?.obj?.pivot) {
        baseTarget = selected.obj.pivot.getWorldPosition(_selectedPlanetWorld);
      }
    }
    if (!baseTarget) {
      baseTarget = currentDestIndex === 0
        ? sysGroup.position
        : (GALAXY_DESTINATIONS[currentDestIndex]?._grp?.position || GALAXY_DESTINATIONS[currentDestIndex]?.pos || cameraTarget);
    }
    const base = baseTarget.clone().add(panOffset);
    const r = PLANET_ORBIT_BASE * orbitZoom * curScale;
    const sp = Math.sin(pOrbitPhi), cp = Math.cos(pOrbitPhi);
    camera.position.set(
      base.x + r * sp * Math.sin(pOrbitTheta),
      base.y + r * cp,
      base.z + r * sp * Math.cos(pOrbitTheta)
    );
    camera.lookAt(base);
  }
  enforceCameraOutsidePlanetMeshes();
}

/**
 * Recompute sun/planet orbit angles and zoom from the actual camera position so orbit
 * state matches the eye after walk, view switches, or any time the rig was driven elsewhere.
 * Resets drag inertia and world-up so pan/orbit controls stay coherent.
 */
function getOrbitLookAtWorld(outVec) {
  if (cameraMode === 'sun') {
    return outVec.copy(cameraTarget).add(panOffset);
  }
  if (selectedPlanetIdx !== null) {
    const selected = managedPlanets[selectedPlanetIdx];
    if (selected?.obj?.pivot) {
      selected.obj.pivot.getWorldPosition(outVec);
      return outVec.add(panOffset);
    }
  }
  if (currentDestIndex === 0) {
    return outVec.copy(sysGroup.position).add(panOffset);
  }
  const g = typeof GALAXY_DESTINATIONS !== 'undefined' ? GALAXY_DESTINATIONS[currentDestIndex] : null;
  const pos = g?._grp?.position || g?.pos || cameraTarget;
  return outVec.copy(pos).add(panOffset);
}

function syncOrbitStateFromActualCamera(curScaleHint) {
  if (walkMode.active) return;
  const sc = curScaleHint != null ? curScaleHint : typeof curScale !== 'undefined' ? curScale : 1;
  getOrbitLookAtWorld(_walkSpawnRadial);
  _walkTmp.copy(camera.position).sub(_walkSpawnRadial);
  const r = _walkTmp.length();
  if (r < 1e-5) return;

  const vx = _walkTmp.x;
  const vy = _walkTmp.y;
  const vz = _walkTmp.z;
  const cosPhi = THREE.MathUtils.clamp(vy / r, -1, 1);
  let phi = Math.acos(cosPhi);
  const sinPhi = Math.sin(phi);
  let theta = 0;
  if (sinPhi > 1e-4) {
    theta = Math.atan2(vx, vz);
  }
  const clampPhi = (p) => Math.max(0.06, Math.min(Math.PI - 0.06, p));
  phi = clampPhi(phi);

  if (cameraMode === 'sun') {
    orbitTheta = theta;
    orbitPhi = phi;
    orbitZoom = THREE.MathUtils.clamp(r / Math.max(ORBIT_BASE * sc, 1e-10), 0.05, 14);
  } else {
    pOrbitTheta = theta;
    pOrbitPhi = phi;
    orbitZoom = THREE.MathUtils.clamp(r / Math.max(PLANET_ORBIT_BASE * sc, 1e-10), 0.05, 14);
  }

  resetOrbitInteractionState();
}

function resetOrbitPointerInertia() {
  dTheta = 0;
  dPhi = 0;
  pDTheta = 0;
  pDPhi = 0;
  camera.up.set(0, 1, 0);
}

function resetOrbitInteractionState() {
  resetOrbitPointerInertia();
  dragging = false;
  dragButton = 0;
  desktopWalkLookReady = false;
}

/** Expand far clip for zoom-out; keep depth usable via logarithmicDepthBuffer on the renderer. */
function updateDynamicCameraFar() {
  if (walkMode.active) return;
  _cameraClipFocus.copy(cameraTarget).add(panOffset);
  const distToFocus = camera.position.distanceTo(_cameraClipFocus);
  const orbitCap = cameraMode === 'sun'
    ? ORBIT_BASE * curScale * orbitZoom
    : PLANET_ORBIT_BASE * curScale * orbitZoom;
  const span = Math.max(distToFocus, orbitCap);
  const far = Math.min(
    5e7,
    Math.max(
      220000,
      span * 2.15 + 780000,
      _cameraClipFocus.length() + 900000,
      camera.position.length() + 900000
    )
  );
  if (Math.abs(far - camera.far) > Math.max(800, camera.far * 0.035)) {
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

