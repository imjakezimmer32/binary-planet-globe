(function startScreenStarfield() {
  const canvas = document.getElementById('start-starfield');
  const startScreen = document.getElementById('start-screen');
  if (!canvas || !startScreen || !canvas.getContext) return;
  let ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stars = [];
  let w = 0, h = 0, cx = 0, cy = 0;
  const focal = 0.52;
  const maxZ = 1.85;
  const minZ = 0.022;
  let nStars = 1100;
  let running = true;
  let last = performance.now();
  let obs = null;

  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, Math.floor(window.innerWidth));
    h = Math.max(1, Math.floor(window.innerHeight));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = w * 0.5;
    cy = h * 0.5;
    nStars = prefersReduced
      ? (w < 520 ? 220 : 320)
      : (w < 520 ? 720 : w < 900 ? 960 : 1200);
    stars.length = 0;
    for (let i = 0; i < nStars; i++) {
      stars.push({
        x: (Math.random() - 0.5) * 2.4,
        y: (Math.random() - 0.5) * 2.4,
        z: minZ + Math.random() * maxZ,
        tw: Math.random() < 0.12 ? 1 : 0,
      });
    }
  }

  function recycle(s) {
    s.x = (Math.random() - 0.5) * 2.4;
    s.y = (Math.random() - 0.5) * 2.4;
    s.z = maxZ * (0.72 + Math.random() * 0.28);
    s.tw = Math.random() < 0.12 ? 1 : 0;
  }

  function shutdown() {
    if (!running) return;
    running = false;
    window.removeEventListener('resize', layout);
    if (obs) obs.disconnect();
  }

  function frame(now) {
    if (!running) return;
    if (startScreen.style.display === 'none') {
      shutdown();
      return;
    }
    const dt = Math.min(48, now - last) / 16.67;
    last = now;
    const speed = (prefersReduced ? 0.0045 : 0.0095) * dt;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const scale = Math.min(w, h) * focal;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.z -= speed * (0.1 + s.z * 0.26);
      if (s.z <= minZ) recycle(s);
      const inv = 1 / s.z;
      const px = cx + s.x * scale * inv;
      const py = cy + s.y * scale * inv;
      if (px < -8 || px > w + 8 || py < -8 || py > h + 8) continue;
      const t = Math.min(1, inv * inv * 0.55);
      const sz = Math.max(0.85, Math.min(4.2, inv * 3.4));
      if (s.tw) {
        ctx.fillStyle = 'rgba(200,228,255,' + (0.38 + t * 0.62) + ')';
      } else {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.32 + t * 0.68) + ')';
      }
      ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);
    }
    requestAnimationFrame(frame);
  }

  obs = new MutationObserver(function () {
    if (startScreen.style.display === 'none') shutdown();
  });
  obs.observe(startScreen, { attributes: true, attributeFilter: ['style'] });

  layout();
  window.addEventListener('resize', layout);
  requestAnimationFrame(function (t0) {
    last = t0;
    requestAnimationFrame(frame);
  });
})();
