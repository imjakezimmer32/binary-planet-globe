// ── Vegetation ─────────────────────────────────────────────────────
// Turf grass + 5 tree variants for planet surfaces.
// Depends on: THREE (global).
// Exposes: VEG.spawnVegetationOnPlanet, VEG.clearVegetation, VEG.refreshVisibility
const VEG = (() => {
  const T_DARK  = [0.22, 0.14, 0.07];
  const T_MID   = [0.30, 0.18, 0.09];
  const G_DARK  = [0.06, 0.20, 0.03];
  const G_MID   = [0.10, 0.31, 0.06];
  const G_LT    = [0.16, 0.42, 0.08];
  const G_PALE  = [0.22, 0.52, 0.12];
  const GS_A    = [0.12, 0.38, 0.05];
  const GS_B    = [0.18, 0.48, 0.08];
  const GS_C    = [0.08, 0.28, 0.04];

  // Character height matches WALK_CFG.characterHeight (00-core-camera-walk.js)
  const CHAR_H  = 0.013;
  const TREE_H  = CHAR_H * 4.0;    // target tree height in world units
  const GRASS_H = CHAR_H * 0.25;   // target grass height in world units

  // Inherent height of each tree variant when built at sc=1.
  const VARIANT_HEIGHTS = [1.18, 1.34, 1.44, 0.64, 0.90];

  // Grass elevation band in mapped-ne space (matches terrain colorizer palette thresholds).
  const GRASS_NE_MIN = 0.042; // just above sand/green boundary (0.040)
  const GRASS_NE_MAX = 0.162; // just below treeline brown (0.165)

  // Max camera-to-planet-pivot world distance to show vegetation.
  // Covers binary companion (~3.5 sep) and typical moons; hides far solar orbiters.
  const VEG_DIST = 12;

  const _refPos = new THREE.Vector3();

  function pushTri(pos, col, v0, v1, v2, c) {
    pos.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
    col.push(c[0], c[1], c[2], c[0], c[1], c[2], c[0], c[1], c[2]);
  }

  function addCone(pos, col, x, y, z, r, h, sides, cSide, cTop) {
    const apex = [x, y + h, z];
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const b0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r];
      const b1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      pushTri(pos, col, b0, apex, b1, i % 2 === 0 ? cSide : cTop);
      pushTri(pos, col, [x, y, z], b0, b1, cSide);
    }
  }

  function addCylinder(pos, col, x, y, z, r, h, sides, c) {
    const yT = y + h;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const b0 = [x + Math.cos(a0) * r, y,  z + Math.sin(a0) * r];
      const b1 = [x + Math.cos(a1) * r, y,  z + Math.sin(a1) * r];
      const t0 = [x + Math.cos(a0) * r, yT, z + Math.sin(a0) * r];
      const t1 = [x + Math.cos(a1) * r, yT, z + Math.sin(a1) * r];
      pushTri(pos, col, b0, t0, b1, c);
      pushTri(pos, col, b1, t0, t1, c);
      pushTri(pos, col, [x, y,  z], b1, b0, c);
      pushTri(pos, col, [x, yT, z], t0, t1, c);
    }
  }

  function addIco(pos, col, x, y, z, r, color) {
    const tmp = new THREE.IcosahedronGeometry(r, 0).toNonIndexed();
    const pa  = tmp.attributes.position.array;
    for (let i = 0; i < pa.length; i += 9) {
      const t  = i / pa.length;
      const cv = 0.80 + t * 0.40;
      pushTri(pos, col,
        [pa[i]   + x, pa[i+1] + y, pa[i+2] + z],
        [pa[i+3] + x, pa[i+4] + y, pa[i+5] + z],
        [pa[i+6] + x, pa[i+7] + y, pa[i+8] + z],
        [color[0]*cv, color[1]*cv, color[2]*cv]
      );
    }
    tmp.dispose();
  }

  // ── 5 tree variants (local Y-up space, sc = normalised unit) ─────

  // Variant 0: Pine — triple-stacked cones (inherent height 1.18 sc)
  function v0Pine(pos, col, sc) {
    addCylinder(pos, col, 0, 0,       0, sc*0.09, sc*0.42, 4, T_MID);
    addCone(    pos, col, 0, sc*0.28, 0, sc*0.65, sc*0.52, 6, G_MID,  G_DARK);
    addCone(    pos, col, 0, sc*0.55, 0, sc*0.48, sc*0.46, 6, G_MID,  G_LT);
    addCone(    pos, col, 0, sc*0.78, 0, sc*0.30, sc*0.40, 6, G_LT,   G_PALE);
  }

  // Variant 1: Round tree — trunk + icosahedron canopy (inherent height 1.34 sc)
  function v1Round(pos, col, sc) {
    addCylinder(pos, col, 0, 0,       0, sc*0.10, sc*0.55, 4, T_DARK);
    addIco(     pos, col, 0, sc*0.82, 0, sc*0.52, G_MID);
  }

  // Variant 2: Spire — thin trunk + tall cypress-style cone (inherent height 1.44 sc)
  function v2Spire(pos, col, sc) {
    addCylinder(pos, col, 0, 0,       0, sc*0.07, sc*0.18, 4, T_MID);
    addCone(    pos, col, 0, sc*0.06, 0, sc*0.38, sc*1.38, 7, G_DARK, G_MID);
  }

  // Variant 3: Bush — 3 overlapping low icosahedra (inherent height 0.64 sc)
  function v3Bush(pos, col, sc) {
    addIco(pos, col,  0.00,     sc*0.22,  0.00,     sc*0.42, G_MID);
    addIco(pos, col,  sc*0.28,  sc*0.16,  sc*0.16,  sc*0.34, G_DARK);
    addIco(pos, col, -sc*0.24,  sc*0.18, -sc*0.12,  sc*0.36, G_LT);
  }

  // Variant 4: Palm — curved trunk + 9 fronds in varied directions (inherent height 0.90 sc)
  function v4Palm(pos, col, sc) {
    addCylinder(pos, col, 0, 0, 0, sc*0.055, sc*0.84, 5, T_MID);
    const tipY = sc * 0.92;
    const nFronds = 9;
    for (let i = 0; i < nFronds; i++) {
      const a = (i / nFronds) * Math.PI * 2;
      // Three alternating length/droop tiers so fronds vary in reach and hang
      const tier = i % 3;
      const lng   = sc * (0.52 + tier * 0.14);   // 0.52 / 0.66 / 0.80
      const droop = sc * (0.16 + tier * 0.08);    // 0.16 / 0.24 / 0.32
      const fw  = sc * 0.09;
      const dx  = Math.cos(a), dz = Math.sin(a);
      const lx  = -dz * fw,    lz = dx * fw;
      const base1 = [ lx, tipY + sc*0.02,  lz];
      const base2 = [-lx, tipY + sc*0.02, -lz];
      const tip   = [dx * lng, tipY - droop, dz * lng];
      const c = tier === 0 ? G_DARK : tier === 1 ? G_MID : G_LT;
      pushTri(pos, col, base1, tip, base2, c);
      pushTri(pos, col, base2, tip, base1, c);
    }
  }

  const BUILDERS = [v0Pine, v1Round, v2Spire, v3Bush, v4Palm];

  // ── Turf grass ───────────────────────────────────────────────
  // Dense cluster of thin, straight, uniform-height blades — no lean, no spread variation.
  function buildGrassTurf(pos, col, h, rng) {
    const N      = 30;
    const spread = h * 2.8;
    const hw     = h * 0.18;
    for (let i = 0; i < N; i++) {
      const a  = rng() * Math.PI * 2;
      const r  = Math.sqrt(rng()) * spread;
      const bx = Math.cos(a) * r;
      const bz = Math.sin(a) * r;
      const oa = rng() * Math.PI;
      const tx = Math.cos(oa) * hw;
      const tz = Math.sin(oa) * hw;
      const c  = i % 3 === 0 ? GS_C : i % 3 === 1 ? GS_A : GS_B;
      pushTri(pos, col, [bx-tx, 0, bz-tz], [bx+tx, 0, bz+tz], [bx, h, bz], c);
      pushTri(pos, col, [bx+tx, 0, bz+tz], [bx-tx, 0, bz-tz], [bx, h, bz], c);
    }
  }

  // ── 3 accent grass plant variants ────────────────────────────────

  // Clump — 3 crossed wide double-sided blades with slight lean.
  function buildGrassClump(pos, col, h, rng) {
    const w = h * 2.8;
    for (let i = 0; i < 3; i++) {
      const a    = (i / 3) * Math.PI + rng() * 0.4;
      const dx   = Math.cos(a) * w, dz = Math.sin(a) * w;
      const lean = (rng() - 0.5) * h * 0.5;
      const c    = [GS_A, GS_B, GS_C][i];
      pushTri(pos, col, [-dx, 0, -dz], [ dx, 0,  dz], [lean, h, lean*0.5], c);
      pushTri(pos, col, [ dx, 0,  dz], [-dx, 0, -dz], [lean, h, lean*0.5], c);
    }
  }

  // Tuft — 5 short upright blades radiating outward in a ring.
  function buildGrassTuft(pos, col, h, rng) {
    const th = h * 0.75;
    for (let i = 0; i < 5; i++) {
      const a  = (i / 5) * Math.PI * 2 + rng() * 0.25;
      const sr = h * 0.14;
      const bx = Math.cos(a) * sr, bz = Math.sin(a) * sr;
      const hw = h * 0.28;
      const tx = Math.cos(a + Math.PI * 0.5) * hw;
      const tz = Math.sin(a + Math.PI * 0.5) * hw;
      const lx = Math.cos(a) * h * 0.18, lz = Math.sin(a) * h * 0.18;
      const c  = i % 2 === 0 ? G_MID : G_LT;
      pushTri(pos, col, [bx-tx, 0, bz-tz], [bx+tx, 0, bz+tz], [bx+lx, th, bz+lz], c);
      pushTri(pos, col, [bx+tx, 0, bz+tz], [bx-tx, 0, bz-tz], [bx+lx, th, bz+lz], c);
    }
  }

  // Wispy — 2 tall thin blades with strong lean for wind-blown look.
  function buildGrassWispy(pos, col, h, rng) {
    const th = h * 1.5;
    const w  = h * 0.9;
    for (let i = 0; i < 2; i++) {
      const a    = (i / 2) * Math.PI + rng() * 0.5;
      const dx   = Math.cos(a) * w, dz = Math.sin(a) * w;
      const lean = (rng() - 0.5) * h * 1.1;
      const c    = i === 0 ? GS_A : G_DARK;
      pushTri(pos, col, [-dx, 0, -dz], [ dx, 0,  dz], [lean, th, lean * 0.4], c);
      pushTri(pos, col, [ dx, 0,  dz], [-dx, 0, -dz], [lean, th, lean * 0.4], c);
    }
  }

  // Index 0 = turf carpet; 1–3 = accent grass plants (~35% of placements).
  const GRASS_BUILDERS = [buildGrassTurf, buildGrassClump, buildGrassTuft, buildGrassWispy];

  // ── Helpers ───────────────────────────────────────────────────────
  function makeMat(doubleSide) {
    return new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1, metalness: 0,
      side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    });
  }

  function toGeo(pos, col) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(new Float32Array(col), 3));
    geo.computeVertexNormals();
    return geo;
  }

  function applyMat4(verts, m) {
    const v = new THREE.Vector3(), out = [];
    for (let i = 0; i < verts.length; i += 3) {
      v.set(verts[i], verts[i+1], verts[i+2]).applyMatrix4(m);
      out.push(v.x, v.y, v.z);
    }
    return out;
  }

  // ── Public API ────────────────────────────────────────────────────

  // Spawns vegetation attached to terrain face centroids of flatGeo (no floaters).
  // planetSize = mp.obj.state.size (pivot scale); vegetation geometry lives in
  // spin (pre-scale) so divide world-unit targets by size to get local units.
  // All meshes start hidden; call refreshVisibility to show in walk mode.
  function spawnVegetationOnPlanet(spinGroup, flatGeo, baseR, peakScale, waterLevel, planetSeed, planetSize) {
    const meshes = [];
    if (!(waterLevel > 0.0001)) return meshes;

    const ps  = Math.max(peakScale, 0.001);
    const sz  = Math.max(planetSize || 1, 0.05);

    // Heights in spin-local space (world height = local x sz via pivot.scale)
    const treeSc = TREE_H / sz;
    const grassH = GRASS_H / sz;

    let rngS = ((planetSeed * 997 + 1) * 65537) >>> 0;
    function rng() {
      rngS = (Math.imul(rngS, 1664525) + 1013904223) >>> 0;
      return rngS / 4294967296;
    }

    const treePosArr = [[], [], [], [], []];
    const treeColArr = [[], [], [], [], []];
    const grassPos = [[]], grassCol = [[]];

    // Universal tree densities: trees per square world unit.
    // Completely independent of planet size, mesh detail, or polygon count —
    // n = floor(worldFaceArea × density) + Bernoulli(remainder).
    // Index matches BUILDERS: 0=Pine, 1=Round, 2=Spire, 3=Bush, 4=Palm.
    // [neMin, neMax, treesPerSqUnit]
    const VARIANT_DENSITIES = [
      [0.135, 0.168, 18],   // Pine  — dense near peaks
      [0.065, 0.130,  2],   // Round — spread across middle green
      [0.120, 0.168,  7],   // Spire — medium upper+peaks
      [0.042, 0.140,  0.4], // Bush  — very sparse lower/mid green
      [0.042, 0.065, 18],   // Palm  — dense shoreline
    ];

    const GRASS_DENSITY       = 300000;
    const MAX_CLUMPS_PER_FACE = 16;

    const posArr     = flatGeo.attributes.position.array;
    const totalFaces = (posArr.length / 9) | 0;

    // Pre-scan to find the same ne scale the terrain colorizer uses so elevation
    // band thresholds (0.040 = sand/green, 0.165 = treeline) match visual colors.
    const liquidR   = baseR * (0.80 + Math.abs(waterLevel) * 0.42);
    const liquidEps = liquidR * 0.0018;
    let minNe = Infinity, maxNe = -Infinity;
    for (let f = 0; f < totalFaces; f++) {
      const b = f * 9;
      let sumR = 0, liq = 0;
      for (let v = 0; v < 3; v++) {
        const o = b + v*3;
        const rr = Math.sqrt(posArr[o]*posArr[o] + posArr[o+1]*posArr[o+1] + posArr[o+2]*posArr[o+2]);
        sumR += rr;
        if (rr <= liquidR + liquidEps) liq++;
      }
      if (liq > 0) continue;
      const ne = (sumR / 3 / baseR - 1) / ps;
      if (ne < minNe) minNe = ne;
      if (ne > maxNe) maxNe = ne;
    }
    if (!Number.isFinite(minNe)) { minNe = -0.2; maxNe = 0.2; }
    const negScale = minNe < 0 ? -0.200 / minNe : 1;
    const posScale = maxNe > 0 ?  0.200 / maxNe : 1;

    const _yUp = new THREE.Vector3(0, 1, 0);
    const _q   = new THREE.Quaternion();
    const _q2  = new THREE.Quaternion();
    const _m   = new THREE.Matrix4();
    const _nv  = new THREE.Vector3();

    for (let fi = 0; fi < totalFaces; fi++) {
      const base = fi * 9;
      const v0x = posArr[base],   v0y = posArr[base+1], v0z = posArr[base+2];
      const v1x = posArr[base+3], v1y = posArr[base+4], v1z = posArr[base+5];
      const v2x = posArr[base+6], v2y = posArr[base+7], v2z = posArr[base+8];
      const cx = (v0x + v1x + v2x) / 3;
      const cy = (v0y + v1y + v2y) / 3;
      const cz = (v0z + v1z + v2z) / 3;

      const cl = Math.sqrt(cx*cx + cy*cy + cz*cz);
      if (cl < 1e-6) continue;

      const ne     = (cl / baseR - 1) / ps;
      const mapped = ne < 0 ? ne * negScale : ne * posScale;

      const wantGrass   = mapped >= GRASS_NE_MIN && mapped <= GRASS_NE_MAX;
      const wantAnyTree = mapped >= 0.042 && mapped <= 0.178;
      if (!wantGrass && !wantAnyTree) continue;

      // Face normal via cross product (v1-v0) x (v2-v0), normalised.
      const e1x = v1x-v0x, e1y = v1y-v0y, e1z = v1z-v0z;
      const e2x = v2x-v0x, e2y = v2y-v0y, e2z = v2z-v0z;
      let fnx = e1y*e2z - e1z*e2y;
      let fny = e1z*e2x - e1x*e2z;
      let fnz = e1x*e2y - e1y*e2x;
      const fnl = Math.sqrt(fnx*fnx + fny*fny + fnz*fnz);
      if (fnl < 1e-10) continue;
      fnx /= fnl; fny /= fnl; fnz /= fnl;
      if (fnx*(cx/cl) + fny*(cy/cl) + fnz*(cz/cl) < 0) { fnx=-fnx; fny=-fny; fnz=-fnz; }

      _nv.set(fnx, fny, fnz);
      _q.setFromUnitVectors(_yUp, _nv);

      const treeEps  = grassH * 0.10;
      const grassEps = grassH * 0.05;

      // World-space area of this face (sq world units). fnl = |cross| = 2×local_area.
      const worldFaceArea = fnl * 0.5 * sz * sz;

      // Per-variant placement: pure world-area density, no caps, no planet-size fudge.
      // Expected count = worldFaceArea × treesPerSqUnit. Integer part always placed;
      // fractional part becomes a probability so expected value is exact.
      if (wantAnyTree) {
        for (let vi = 0; vi < 5; vi++) {
          const [neMin, neMax, density] = VARIANT_DENSITIES[vi];
          if (mapped < neMin || mapped > neMax) continue;
          const expected = worldFaceArea * density;
          const n = Math.floor(expected) + (rng() < (expected % 1) ? 1 : 0);
          for (let k = 0; k < n; k++) {
            let bu = rng(), bv = rng();
            if (bu + bv > 1) { bu = 1 - bu; bv = 1 - bv; }
            const px = v0x + bu*(v1x-v0x) + bv*(v2x-v0x);
            const py = v0y + bu*(v1y-v0y) + bv*(v2y-v0y);
            const pz = v0z + bu*(v1z-v0z) + bv*(v2z-v0z);
            // Random yaw around face normal then align to surface
            _q2.setFromAxisAngle(_nv, rng() * Math.PI * 2);
            _q2.multiply(_q);
            _m.makeRotationFromQuaternion(_q2);
            _m.setPosition(px + fnx*treeEps, py + fny*treeEps, pz + fnz*treeEps);
            const scVar = 0.65 + rng() * 0.70;
            const sc = (treeSc / VARIANT_HEIGHTS[vi]) * scVar;
            const lp = [], lc = [];
            BUILDERS[vi](lp, lc, sc);
            treePosArr[vi].push(...applyMat4(lp, _m));
            treeColArr[vi].push(...lc);
          }
        }
      }

      if (wantGrass) {
        const n = Math.min(MAX_CLUMPS_PER_FACE, Math.max(1, Math.round(fnl * 0.5 * sz * sz * GRASS_DENSITY)));
        for (let k = 0; k < n; k++) {
          let u = rng(), v = rng();
          if (u + v > 1) { u = 1 - u; v = 1 - v; }
          const px = v0x + u*(v1x-v0x) + v*(v2x-v0x);
          const py = v0y + u*(v1y-v0y) + v*(v2y-v0y);
          const pz = v0z + u*(v1z-v0z) + v*(v2z-v0z);
          _m.makeRotationFromQuaternion(_q);
          _m.setPosition(px + fnx*grassEps, py + fny*grassEps, pz + fnz*grassEps);
          const gv = rng() < 0.65 ? 0 : 1 + Math.floor(rng() * 3);
          const lp = [], lc = [];
          GRASS_BUILDERS[gv](lp, lc, grassH, rng);
          grassPos[0].push(...applyMat4(lp, _m));
          grassCol[0].push(...lc);
        }
      }
    }

    const treeMat = makeMat(false);
    for (let v = 0; v < 5; v++) {
      if (!treePosArr[v].length) continue;
      const mesh = new THREE.Mesh(toGeo(treePosArr[v], treeColArr[v]), treeMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      spinGroup.add(mesh);
      meshes.push(mesh);
    }

    const grassMat = makeMat(true);
    if (grassPos[0].length) {
      const mesh = new THREE.Mesh(toGeo(grassPos[0], grassCol[0]), grassMat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      spinGroup.add(mesh);
      meshes.push(mesh);
    }

    return meshes;
  }

  function clearVegetation(spinGroup, meshes) {
    if (!meshes || !meshes.length) return;
    for (const m of meshes) {
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach(mat => mat.dispose());
      spinGroup.remove(m);
    }
  }

  // Show vegetation on planets within VEG_DIST of camPos (world space) when walkActive.
  // Called every frame from the render loop.
  function refreshVisibility(managedPlanets, camPos, walkActive) {
    if (!managedPlanets) return;
    for (let i = 0; i < managedPlanets.length; i++) {
      const mp = managedPlanets[i];
      if (!mp?.obj?.pivot || !mp?.obj?.setVegVisible) continue;
      if (!walkActive) {
        mp.obj.setVegVisible(false);
        continue;
      }
      mp.obj.pivot.getWorldPosition(_refPos);
      mp.obj.setVegVisible(_refPos.distanceTo(camPos) <= VEG_DIST);
    }
  }

  return { spawnVegetationOnPlanet, clearVegetation, refreshVisibility };
})();
