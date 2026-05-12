// ── Splash intro sequence ─────────────────────────────────────────
(async function() {
  const splash  = document.getElementById('splash');
  const helloEl = document.getElementById('s-hello');
  const faceEl  = document.getElementById('s-face');
  const startScreen = document.getElementById('start-screen');
  const startHint = document.getElementById('start-hint');
  const INTRO_ZOOM_EPSILON = 0.02;
  const INTRO_ZOOM_TIMEOUT_MS = 9000;
  const INTRO_ZOOM_OVERLAP_MS = 70;
  const SPLASH_FADE_MS = 1450;

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  const touchPrimary = window.matchMedia('(pointer: coarse)').matches;
  startHint.textContent = touchPrimary
    ? 'Tap anywhere to start'
    : 'Click or press any key to start';

  // ── Start screen only: loop until user continues (before splash) ──
  const START_SCREEN_MUSIC_SRC = '/audio/outertaming.mp3';
  const START_SCREEN_MUSIC_GAIN = 0.72;
  const startScreenOuterEl = new Audio(START_SCREEN_MUSIC_SRC);
  startScreenOuterEl.loop = true;
  startScreenOuterEl.preload = 'auto';
  try {
    startScreenOuterEl.playsInline = true;
  } catch (_) {}
  startScreenOuterEl.setAttribute('playsinline', '');
  startScreenOuterEl.setAttribute('webkit-playsinline', '');
  // In-document audio is more reliable on iOS/Safari than a detached Audio node.
  startScreenOuterEl.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;pointer-events:none;';
  document.body.appendChild(startScreenOuterEl);
  startScreenOuterEl.volume = START_SCREEN_MUSIC_GAIN;

  function tryPlayStartScreenMusic() {
    // After fade/stop we set volume to 0 — without this, pageshow / primers replay silent.
    startScreenOuterEl.volume = START_SCREEN_MUSIC_GAIN;
    const pr = startScreenOuterEl.play();
    if (pr && typeof pr.catch === 'function') pr.catch(() => {});
  }

  const tapPrimerScreen = document.getElementById('tap-primer-screen');
  await new Promise((resolve) => {
    if (!tapPrimerScreen) {
      startScreen.classList.remove('gate-behind-primer');
      resolve();
      return;
    }
    let settled = false;
    function dismissPrimer() {
      if (settled) return;
      settled = true;
      tryPlayStartScreenMusic();
      tapPrimerScreen.style.display = 'none';
      tapPrimerScreen.setAttribute('aria-hidden', 'true');
      startScreen.classList.remove('gate-behind-primer');
      tapPrimerScreen.removeEventListener('pointerdown', dismissPrimer);
      window.removeEventListener('keydown', onPrimerKey, true);
      resolve();
    }
    function onPrimerKey(e) {
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Spacebar') e.preventDefault();
      dismissPrimer();
    }
    tapPrimerScreen.addEventListener('pointerdown', dismissPrimer, { passive: true });
    window.addEventListener('keydown', onPrimerKey, { capture: true, passive: true });
    try {
      tapPrimerScreen.focus({ preventScroll: true });
    } catch (_) {}
  });

  const gateMotionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (gateMotionOk) {
    startHint.style.opacity = '0';
    startHint.style.transition = 'none';
    requestAnimationFrame(() => {
      startHint.style.transition = 'opacity 0.95s ease';
      setTimeout(() => {
        startHint.style.opacity = '1';
        startHint.addEventListener('transitionend', function gateHintFadeIn(e) {
          if (e.propertyName !== 'opacity') return;
          startHint.removeEventListener('transitionend', gateHintFadeIn);
          startHint.style.transition = '';
          startHint.classList.add('start-hint-visible');
        });
      }, 2000);
    });
    setTimeout(() => {
      if (!startHint.classList.contains('start-hint-visible')) {
        startHint.classList.add('start-hint-visible');
      }
    }, 3400);
  } else {
    startHint.style.opacity = '1';
    startHint.classList.add('start-hint-visible');
  }

  // Begin title music as soon as the parser runs; retry on load/pageshow for
  // environments that allow autoplay after navigation (still blocked until a
  // gesture on strict browsers — tap primer / gate primers cover that).
  window.addEventListener('load', () => { tryPlayStartScreenMusic(); }, { once: true });
  window.addEventListener('pageshow', () => { tryPlayStartScreenMusic(); });

  function stopStartScreenMusic() {
    startScreenOuterEl.pause();
    startScreenOuterEl.currentTime = 0;
    startScreenOuterEl.volume = 0;
  }

  /**
   * Same user-activation turn as the start click: start the solar track at 0 volume
   * so autoplay policy is satisfied. First audible ramp is started with the splash (see below).
   */
  function handoffFromStartScreenToGameMusic() {
    solarSystemAudio.primeActiveDestinationAudioAfterGesture();
  }

  /** First astra.mp3 ramp after leaving the gate (runs alongside splash + gate fade). */
  const FIRST_ASTRA_FADE_IN_MS = 4000;
  /** Gate music linear fade while splash runs (parallel with astra fade-in). */
  const GATE_HANDOFF_FADE_OUT_MS = 2000;
  let gateFadeOutPromise = null;

  function fadeOutGateMusicDuringIntro() {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let fromGain = startScreenOuterEl.volume;
      if (fromGain < START_SCREEN_MUSIC_GAIN * 0.18) {
        fromGain = START_SCREEN_MUSIC_GAIN;
      }
      startScreenOuterEl.volume = fromGain;
      function frame() {
        const elapsed = performance.now() - t0;
        const gateLin = Math.min(1, elapsed / GATE_HANDOFF_FADE_OUT_MS);
        startScreenOuterEl.volume = fromGain * (1 - gateLin);
        if (gateLin < 1) {
          requestAnimationFrame(frame);
          return;
        }
        stopStartScreenMusic();
        resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function beginGateFadeOutOnStartTap() {
    if (gateFadeOutPromise) return gateFadeOutPromise;
    gateFadeOutPromise = fadeOutGateMusicDuringIntro();
    return gateFadeOutPromise;
  }

  /** First real gesture must start audio on strict browsers; capture runs before dismiss handlers. */
  function attachStartScreenMusicPrimers() {
    const prime = () => tryPlayStartScreenMusic();
    startScreen.addEventListener('pointerdown', prime, { capture: true, passive: true });
    window.addEventListener('keydown', prime, { capture: true, passive: true });
    return () => {
      startScreen.removeEventListener('pointerdown', prime, { capture: true });
      window.removeEventListener('keydown', prime, { capture: true });
    };
  }

  /**
   * Runs the supplied callback synchronously inside the tap/key handler so
   * Chrome still treats the following play() calls as user-initiated.
   */
  function waitForStart(onUserGestureSync) {
    return new Promise((resolve) => {
      let done = false;
      const cleanup = () => {
        window.removeEventListener('keydown', onKey);
        startScreen.removeEventListener('pointerdown', onPointer);
      };
      const finish = () => {
        if (done) return;
        done = true;
        if (typeof onUserGestureSync === 'function') onUserGestureSync();
        cleanup();
        resolve();
      };
      const onKey = (e) => {
        if (touchPrimary) return;
        if (e.repeat) return;
        finish();
      };
      const onPointer = () => {
        finish();
      };
      window.addEventListener('keydown', onKey);
      startScreen.addEventListener('pointerdown', onPointer);
    });
  }

  async function dismissStartScreen() {
    startScreen.style.pointerEvents = 'none';
    startScreen.style.transition = 'opacity 0.5s ease';
    startScreen.style.opacity = '0';
    await wait(500);
    startScreen.style.display = 'none';
  }

  async function waitForIntroZoom() {
    const start = performance.now();
    while (performance.now() - start < INTRO_ZOOM_TIMEOUT_MS) {
      const zoomSettled = zoomTarget === null;
      const zoomDistance = Math.abs(Math.log(orbitZoom) - Math.log(SYSTEM_FIT_ZOOM));
      if (zoomSettled && zoomDistance <= INTRO_ZOOM_EPSILON) return;
      await wait(16);
    }
  }

  // Start camera very far out; the animate loop will log-lerp it to 3.0
  orbitZoom = 4000;

  async function run() {
    solarSystemAudio.beginActiveDestinationFadeIn({ durationMs: FIRST_ASTRA_FADE_IN_MS });
    await wait(200);

    // ── Phase 1: HELLO WORLD ───────────────────────────────────────
    helloEl.style.opacity = '1';
    await wait(1600);
    helloEl.style.opacity = '0';
    await wait(750);

    // ── Phase 2: Type ":)" ─────────────────────────────────────────
    faceEl.style.transition = 'none';
    faceEl.style.transform  = 'rotate(0deg)';
    faceEl.style.filter     = 'none';
    faceEl.textContent = '';
    await wait(100);
    faceEl.textContent = ':';
    await wait(380);
    faceEl.textContent = ':)';
    await wait(900);

    // ── Phase 3: Rotate 90° → proper smiley face ──────────────────
    faceEl.style.transition = 'transform 1.1s cubic-bezier(0.34, 1.26, 0.64, 1)';
    faceEl.style.transform  = 'rotate(90deg)';
    await wait(1300);

    // ── Phase 4: zoom into the eye ────────────────────────────────────
    await wait(500);
    faceEl.style.transition = 'transform 1.4s cubic-bezier(0.4, 0, 1, 1), filter 1.4s ease';
    faceEl.style.filter     = 'blur(0px) brightness(1)';
    faceEl.style.transform  = 'rotate(90deg) scale(120)';
    faceEl.style.filter     = 'blur(18px) brightness(8)';
    await wait(900);

    // ── Phase 5: Start zoom + scene fade, then hand opacity over to splash fade.
    introZoomProfile = {
      startLog: Math.log(Math.max(orbitZoom, 1e-6)),
      targetLog: Math.log(SYSTEM_FIT_ZOOM),
    };
    zoomTarget = SYSTEM_FIT_ZOOM;
    // Start scene reveal immediately so it has a longer ramp-up.
    document.body.classList.add('scene-visible');
    // Keep only a tiny lead so the universe is visible during splash fade.
    await wait(INTRO_ZOOM_OVERLAP_MS);

    // Smooth splash fade for a cleaner opacity transfer to the zooming scene.
    splash.style.transition = `opacity ${SPLASH_FADE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    splash.style.opacity    = '0';
    await wait(SPLASH_FADE_MS);
    splash.style.display = 'none';
    await waitForIntroZoom();
    document.body.classList.remove('hud-hidden');
    rebuildGalaxyMenu();
    // zoom continues past the fade, settling gently near orbitZoom 3
  }

  const detachStartScreenMusicPrimers = attachStartScreenMusicPrimers();
  await waitForStart(() => {
    detachStartScreenMusicPrimers();
    handoffFromStartScreenToGameMusic();
    beginGateFadeOutOnStartTap();
  });
  await dismissStartScreen();
  await Promise.all([
    beginGateFadeOutOnStartTap(),
    run(),
  ]);
})();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
