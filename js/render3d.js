// Three.js renderer. The simulation stays 2D (x, y, heading); here x -> x, y -> z, up -> y.

class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.tmp = new THREE.Color(); }
  add(g, color, matrix) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (matrix) ng.applyMatrix4(matrix);
    const p = ng.attributes.position.array, n = ng.attributes.normal.array;
    this.tmp.set(color);
    for (let i = 0; i < p.length; i += 3) { this.pos.push(p[i], p[i + 1], p[i + 2]); this.nrm.push(n[i], n[i + 1], n[i + 2]); this.col.push(this.tmp.r, this.tmp.g, this.tmp.b); }
    ng.dispose(); if (ng !== g) g.dispose();
  }
  box(x, y, z, w, h, d, color) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); this.add(g, color); }
  cyl(x, y, z, rt, rb, h, color, seg = 6) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); this.add(g, color); }
  sphere(x, y, z, r, color, seg = 6) { const g = new THREE.SphereGeometry(r, seg, seg); g.translate(x, y, z); this.add(g, color); }
  cone(x, y, z, r, h, color, seg = 6) { const g = new THREE.ConeGeometry(r, h, seg); g.translate(x, y, z); this.add(g, color); }
  build(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    return new THREE.Mesh(geo, material);
  }
  get empty() { return this.pos.length === 0; }
}

class Renderer3D {
  constructor(canvas2d, game) {
    this.game = game;
    const canvas = document.createElement("canvas"); canvas.id = "game3d";
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(devicePixelRatio || 1, game.input.touch ? 1.25 : 1.5));
    this.gl.outputEncoding = THREE.sRGBEncoding;
    canvas2d.parentNode.insertBefore(canvas, canvas2d.nextSibling);
    canvas2d.style.display = "none";
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#8ec5ff");
    this.scene.fog = new THREE.Fog("#8ec5ff", 500, 1400);
    this.camera = new THREE.PerspectiveCamera(58, 1, 2, 2600);
    this.camYaw = 0; this.camMode = 0; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.mini = document.getElementById("minimap"); this.mctx = this.mini.getContext("2d");
    this.mapCache = document.createElement("canvas"); this.mapCache.width = CITY * 8; this.mapCache.height = CITY * 8; this.mapDirty = true;
    this.labelsEl = document.getElementById("labels"); this.labelPool = []; this.labelUsed = 0;
    this.meshes = new Map(); this.seen = new Set(); this.textures = new Map();
    this.lightT = 0; this.night = -1; this.rainOn = false;
    this.buildLights();
    this.buildCity();
    this.buildRain();
    this.buildMarkers();
  }
  invalidateMap() { this.mapDirty = true; this.rebuildLocks(); }
  resize() { this.gl.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  cycleCamera() { this.camMode = (this.camMode + 1) % 3; return ["chase", "high", "overhead"][this.camMode]; }
  hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

  // ---------- static city ----------
  buildLights() {
    this.hemi = new THREE.HemisphereLight("#bfdfff", "#5a4a3a", 0.75); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff4d6", 1.0); this.sun.position.set(300, 500, 200); this.scene.add(this.sun);
    this.amb = new THREE.AmbientLight("#ffffff", 0.25); this.scene.add(this.amb);
    this.streetLights = [];
    for (let i = 0; i < 8; i++) { const l = new THREE.PointLight("#ffd28a", 0, 170, 1.6); this.scene.add(l); this.streetLights.push(l); }
    this.headlights = [];
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight("#fff7cc", 0, 260, 0.55, 0.5, 1.2); s.target = new THREE.Object3D();
      this.scene.add(s); this.scene.add(s.target); this.headlights.push(s);
    }
  }
  buildCity() {
    const w = this.game.world, g = this.game;
    const ground = new GeoBuilder(), bld = new GeoBuilder(), winD = new GeoBuilder(), winL = new GeoBuilder(), water = new GeoBuilder(), bulbs = new GeoBuilder();
    const cityColor = id => CITIES[id].color, roofColor = id => CITIES[id].roof;
    const blockHeight = (bx, by) => 36 + Math.floor(this.hash(bx * 3 + 1, by * 7 + 2) * 6) * 16;
    ground.box(WORLD / 2, -4, WORLD / 2, WORLD + 400, 8, WORLD + 400, "#1c2230");
    for (let ty = 0; ty < CITY; ty++) for (let tx = 0; tx < CITY; tx++) {
      const t = w.get(tx, ty), cx = tx * TILE + 16, cz = ty * TILE + 16, cid = cityOfTile(tx, ty), h = this.hash(tx, ty);
      const lx = tx % 5, ly = ty % 5;
      if (t === T.ROAD || t === T.BRIDGE) {
        const y = t === T.BRIDGE ? 3 : 0.5;
        ground.box(cx, y, cz, TILE, t === T.BRIDGE ? 6 : 1, TILE, "#2b2f3a");
        if (tx % 5 === 0 && ty % 5 !== 0) { ground.box(cx, y + 0.6, cz - 8, 1.6, 0.3, 10, "#c9b458"); ground.box(cx, y + 0.6, cz + 8, 1.6, 0.3, 10, "#c9b458"); }
        else if (ty % 5 === 0 && tx % 5 !== 0) { ground.box(cx - 8, y + 0.6, cz, 10, 0.3, 1.6, "#c9b458"); ground.box(cx + 8, y + 0.6, cz, 10, 0.3, 1.6, "#c9b458"); }
        const isCross = tx % 5 === 0 && ty % 5 === 0;
        if (!isCross && t === T.ROAD && ((tx % 5 === 0 && (ly === 1 || ly === 4)) || (ty % 5 === 0 && (lx === 1 || lx === 4)))) {
          for (let i = 0; i < 4; i++) {
            if (tx % 5 === 0) ground.box(cx - 12 + i * 8, y + 0.6, cz + (ly === 1 ? -12 : 12), 5, 0.3, 4, "#d9dde3");
            else ground.box(cx + (lx === 1 ? -12 : 12), y + 0.6, cz - 12 + i * 8, 4, 0.3, 5, "#d9dde3");
          }
        }
        if (t === T.BRIDGE) {
          const vertical = w.get(tx - 1, ty) === T.WATER || w.get(tx + 1, ty) === T.WATER;
          if (vertical) { ground.box(cx - 15, 8, cz, 2, 8, TILE, "#6b7280"); ground.box(cx + 15, 8, cz, 2, 8, TILE, "#6b7280"); }
          else { ground.box(cx, 8, cz - 15, TILE, 8, 2, "#6b7280"); ground.box(cx, 8, cz + 15, TILE, 8, 2, "#6b7280"); }
          ground.box(cx, -6, cz, 10, 14, 10, "#4b5563");
        }
        if (isCross) {
          for (const [ox, oz] of [[-13, -13], [13, 13]]) {
            ground.cyl(cx + ox, 12, cz + oz, 0.7, 0.9, 24, "#9ca3af", 5);
            bulbs.sphere(cx + ox, 24.5, cz + oz, 1.8, "#ffe9a8", 5);
          }
        }
      } else if (t === T.SIDEWALK || t === T.SAND || t === T.PARK || t === T.GARAGE) {
        const col = t === T.SAND ? "#e7d3a1" : t === T.PARK ? (cid === "la" ? "#7a9b4a" : "#4c8a3f") : t === T.GARAGE ? "#9ca3af" : (cid === "la" ? "#c8bfa8" : cid === "fl" ? "#d9cfc1" : "#a3a7ad");
        ground.box(cx, 1, cz, TILE, 2, TILE, col);
        if (t === T.SIDEWALK) {
          if (h < 0.06) { ground.box(cx, 4, cz, 6, 6, 6, "#374151"); ground.box(cx, 7.5, cz, 7, 1, 7, "#1f2937"); }
          else if (h < 0.1) { ground.box(cx, 5, cz, 20, 1.5, 5, "#6b4f2a"); ground.box(cx, 8, cz - 2.5, 20, 5, 1.2, "#6b4f2a"); ground.box(cx - 8, 2.5, cz, 1.5, 3, 5, "#4b3a20"); ground.box(cx + 8, 2.5, cz, 1.5, 3, 5, "#4b3a20"); }
          else if (h < 0.14) this.tree(ground, cx, cz, cid, h);
          else if (h < 0.17) { ground.cyl(cx, 5, cz, 2, 2.2, 8, "#b91c1c", 6); ground.sphere(cx, 9.5, cz, 2.2, "#7f1d1d", 5); }
        } else if (t === T.PARK) {
          if (h < 0.45) this.tree(ground, cx + (h - 0.2) * 20, cz + this.hash(ty, tx) * 16 - 8, cid, h);
          else if (h < 0.52) { ground.box(cx, 5, cz, 20, 1.5, 5, "#8b5a2b"); ground.box(cx, 8, cz - 2.5, 20, 5, 1.2, "#8b5a2b"); }
          else if (h < 0.58) { ground.cyl(cx, 3, cz, 9, 9, 2, "#a3b18a", 10); ground.cyl(cx, 6, cz, 1.2, 1.2, 8, "#cbd5e1", 5); }
        } else if (t === T.SAND) {
          if (h < 0.08) { ground.cyl(cx, 8, cz, 0.6, 0.6, 16, "#e5e7eb", 4); ground.cone(cx, 17, cz, 10, 4, h < 0.04 ? "#ef4444" : "#3b82f6", 8); }
          else if (h < 0.14) { ground.box(cx, 2.5, cz, 18, 1, 9, "#3b82f6"); }
          else if (h < 0.2) this.palm(ground, cx, cz);
        } else if (t === T.GARAGE && lx === 2 && ly === 2) { ground.box(cx + 16, 12, cz + 16, 62, 22, 62, "#6b7280"); ground.box(cx + 16, 24, cz + 16, 66, 2, 66, "#374151"); ground.box(cx + 16, 9, cz + 16 + 32, 40, 18, 2, "#fbbf24"); }
      } else if (t === T.WATER) {
        water.box(cx, -1.5, cz, TILE, 1, TILE, "#2a5d8f");
      } else if (t === T.BUILDING) {
        const bx = Math.floor(tx / 5), by = Math.floor(ty / 5);
        const hh = blockHeight(bx, by) + (this.hash(tx * 5, ty * 3) < 0.3 ? 16 : 0);
        bld.box(cx, hh / 2, cz, TILE, hh, TILE, cityColor(cid));
        bld.box(cx, hh + 0.75, cz, TILE - 4, 1.5, TILE - 4, roofColor(cid));
        if (this.hash(tx + 7, ty + 3) < 0.35) bld.box(cx + (h - 0.5) * 12, hh + 4, cz + (this.hash(ty, tx) - 0.5) * 12, 8, 6, 8, "#94a3b8");
        if (this.hash(tx + 11, ty + 5) < 0.12) { bld.box(cx, hh + 3, cz, 10, 4, 10, "#cbd5e1"); bld.cyl(cx, hh + 12, cz, 0.5, 0.5, 14, "#e5e7eb", 4); }
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = DIRS[d];
          const nt = w.get(tx + dx, ty + dy);
          if (nt === T.BUILDING) continue;
          for (let fy = 10; fy < hh - 6; fy += 12) for (let k = -1; k <= 1; k += 2) {
            const lit = this.hash(tx * 7 + fy + d * 13, ty * 5 + k) < 0.4;
            const wx = cx + dx * 16.4 + (dx === 0 ? k * 8 : 0), wz = cz + dy * 16.4 + (dy === 0 ? k * 8 : 0);
            (lit ? winL : winD).box(wx, fy, wz, dx === 0 ? 5 : 0.6, 6, dy === 0 ? 5 : 0.6, lit ? "#fde68a" : "#1f2937");
          }
        }
      } else if (t === T.SHOP || t === T.HOME) {
        if (lx === 2 && ly === 2) {
          const isHome = t === T.HOME;
          const col = isHome ? "#dbeafe" : "#f3f4f6";
          bld.box(cx + 16, 13, cz + 16, 62, 26, 62, col);
          bld.box(cx + 16, 27, cz + 16, 66, 2, 66, isHome ? "#2563eb" : "#4b5563");
          bld.box(cx + 16, 22, cz + 16 + 32.5, 66, 4, 3, isHome ? "#2563eb" : "#b45309");
          bld.box(cx + 16, 6, cz + 16 + 32.2, 22, 12, 1, "#93c5fd");
          bld.box(cx + 16 - 20, 8, cz + 16 + 32.2, 12, 14, 1, "#bfdbfe"); bld.box(cx + 16 + 20, 8, cz + 16 + 32.2, 12, 14, 1, "#bfdbfe");
          bld.box(cx + 16 + 32.2, 8, cz + 16, 1, 14, 30, "#bfdbfe"); bld.box(cx + 16 - 32.2, 8, cz + 16, 1, 14, 30, "#bfdbfe");
        }
      }
    }
    const lam = () => new THREE.MeshLambertMaterial({ vertexColors: true });
    this.scene.add(ground.build(lam()));
    this.scene.add(bld.build(lam()));
    this.winDark = winD.build(lam()); this.scene.add(this.winDark);
    this.winLit = winL.build(new THREE.MeshBasicMaterial({ vertexColors: true })); this.scene.add(this.winLit);
    this.bulbs = bulbs.build(new THREE.MeshBasicMaterial({ vertexColors: true })); this.scene.add(this.bulbs);
    this.water = water.build(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })); this.scene.add(this.water);
    // signs
    for (const s of w.shops) this.scene.add(this.textSprite(SHOPS[s.kind].icon + " " + SHOPS[s.kind].name.toUpperCase(), SHOPS[s.kind].color, s.x + 16, 36, s.y + 16, 46, 9, true));
    for (const h of Object.values(w.homes)) this.scene.add(this.textSprite("🏠 HOME KITCHEN", "#2563eb", h.x + 16, 36, h.y + 16, 46, 9, true));
    for (const ga of w.garages) this.scene.add(this.textSprite("🔧 AUTO BODY", "#b45309", ga.x + 16, 33, ga.y + 16, 42, 8, true));
    this.lampPosts = [];
    for (let ty = 0; ty < CITY; ty += 5) for (let tx = 0; tx < CITY; tx += 5) if (w.get(tx, ty) === T.ROAD) this.lampPosts.push({ x: tx * TILE + 16 - 13, z: ty * TILE + 16 - 13 }, { x: tx * TILE + 16 + 13, z: ty * TILE + 16 + 13 });
    this.locks = new THREE.Group(); this.scene.add(this.locks);
    this.rebuildLocks();
  }
  tree(b, x, z, cid, h) {
    const s = 0.8 + h * 0.6;
    b.cyl(x, 5 * s, z, 1.2, 1.6, 10 * s, "#6b4f2a", 5);
    b.sphere(x, 13 * s, z, 7 * s, cid === "la" ? "#3f7d2f" : "#2f6b2a", 6);
    b.sphere(x - 2 * s, 16 * s, z - 2 * s, 4 * s, "#5ea34e", 5);
  }
  palm(b, x, z) {
    b.cyl(x, 12, z, 1.2, 2, 24, "#9a7b4f", 5);
    for (let i = 0; i < 6; i++) { const a = i * 1.047; const g = new THREE.BoxGeometry(14, 0.8, 4); g.translate(7, 0, 0); g.rotateZ(-0.35); g.rotateY(a); g.translate(x, 24, z); b.add(g, "#2f8f3a"); }
  }
  rebuildLocks() {
    if (!this.locks) return;
    while (this.locks.children.length) this.locks.remove(this.locks.children[0]);
    const q = { ny: [0, 0], fl: [25, 0], chi: [0, 25], la: [25, 25] };
    for (const [id, [tx, ty]] of Object.entries(q)) {
      if (this.game.unlocked.has(id)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(25 * TILE, 200, 25 * TILE), new THREE.MeshBasicMaterial({ color: "#050810", transparent: true, opacity: 0.72 }));
      m.position.set(tx * TILE + 12.5 * TILE, 100, ty * TILE + 12.5 * TILE);
      this.locks.add(m);
      this.locks.add(this.textSprite("🔒 " + CITIES[id].name.toUpperCase() + " — finish the tables before it", "#111827", tx * TILE + 12.5 * TILE, 210, ty * TILE + 12.5 * TILE, 220, 26));
    }
  }
  textSprite(text, bg, x, y, z, w, h, occluded) {
    const key = text + bg;
    let tex = this.textures.get(key);
    if (!tex) {
      const c = document.createElement("canvas"); c.width = 512; c.height = 96;
      const ctx = c.getContext("2d");
      ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, 512, 96, 20) : ctx.rect(0, 0, 512, 96); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 44px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 256, 50);
      tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter; this.textures.set(key, tex);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: !!occluded }));
    sp.position.set(x, y, z); sp.scale.set(w, h, 1); sp.renderOrder = occluded ? 0 : 5;
    return sp;
  }
  buildRain() {
    const n = 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 500; pos[i * 3 + 1] = Math.random() * 300; pos[i * 3 + 2] = (Math.random() - 0.5) * 500; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#b8c8ff", size: 1.6, transparent: true, opacity: 0.55 }));
    this.rain.visible = false; this.scene.add(this.rain);
  }
  buildMarkers() {
    const beam = col => new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 90, 12, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    this.spotBeam = beam("#facc15"); this.scene.add(this.spotBeam);
    this.fareBeam = beam("#facc15"); this.scene.add(this.fareBeam);
    this.shopBeams = []; for (let i = 0; i < 4; i++) { const b = beam("#22c55e"); this.scene.add(b); this.shopBeams.push(b); }
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(4, 10, 6), new THREE.MeshBasicMaterial({ color: "#facc15" })); this.arrow.rotation.z = -Math.PI / 2;
    this.arrowPivot = new THREE.Group(); this.arrowPivot.add(this.arrow); this.arrow.position.x = 6; this.scene.add(this.arrowPivot);
    this.spotCone = new THREE.Mesh(new THREE.ConeGeometry(4, 9, 6), new THREE.MeshBasicMaterial({ color: "#facc15" })); this.spotCone.rotation.x = Math.PI; this.scene.add(this.spotCone);
  }

  // ---------- dynamic entities ----------
  mat(color) { return new THREE.MeshLambertMaterial({ color }); }
  basic(color) { return new THREE.MeshBasicMaterial({ color }); }
  makePerson(p, opts = {}) {
    const g = new THREE.Group();
    const skin = this.mat(p.skin || "#e0ac69"), shirt = this.mat(opts.orange ? "#f97316" : (p.shirt || "#64748b")), pants = this.mat(p.pants || "#1f2937");
    const legL = new THREE.Mesh(new THREE.BoxGeometry(2.6, 7, 2.6), pants), legR = legL.clone();
    legL.position.set(0, 3.5, -1.7); legR.position.set(0, 3.5, 1.7);
    const legs = [legL, legR]; for (const l of legs) { l.geometry = l.geometry.clone(); l.geometry.translate(0, -3.5, 0); l.position.y = 7; }
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, 8, 7), shirt); body.position.y = 11;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(2.2, 7.5, 2.2), shirt), armR = armL.clone();
    armL.geometry = armL.geometry.clone(); armL.geometry.translate(0, -3.2, 0); armR.geometry = armL.geometry;
    armL.position.set(0, 14.5, -4.8); armR.position.set(0, 14.5, 4.8);
    const head = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 8), skin); head.position.y = 18.6;
    g.add(legL, legR, body, armL, armR, head);
    if (opts.chef) { const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.2, 5, 8), this.mat("#ffffff")); t.position.y = 23.5; g.add(t); const apron = new THREE.Mesh(new THREE.BoxGeometry(1, 7, 5), this.mat("#e5e7eb")); apron.position.set(2.6, 10, 0); g.add(apron); }
    else if (opts.hat || p.hat) { const h = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.8, 8), this.mat(p.hatColor || "#374151")); h.position.y = 21.6; g.add(h); const brim = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.5, 8), this.mat("#374151")); brim.position.y = 20.8; g.add(brim); }
    else if (p.hairStyle !== 2) { const hair = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), this.mat(p.hair || "#3f2a1d")); hair.position.y = 18.9; g.add(hair); if (p.hairStyle === 1) { const long = new THREE.Mesh(new THREE.BoxGeometry(2.5, 6, 5), this.mat(p.hair || "#3f2a1d")); long.position.set(-2.4, 16.5, 0); g.add(long); } }
    if (p.bag) { const bag = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 2.5), this.mat("#78350f")); bag.position.set(-1, 9.5, 5.5); g.add(bag); }
    const umb = new THREE.Group(); const cone = new THREE.Mesh(new THREE.ConeGeometry(8, 3, 8), this.mat(p.shirt || "#3b82f6")); cone.position.y = 27; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 12, 4), this.mat("#111")); pole.position.y = 20; umb.add(cone, pole); umb.visible = false; g.add(umb);
    g.userData = { legs, arms: [armL, armR], umb, body };
    return g;
  }
  makeDog(color) {
    const g = new THREE.Group(), m = this.mat(color);
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 3), m); body.position.y = 3.5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.8, 2.6), m); head.position.set(4.5, 4.5, 0);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.8, 0.8), m); tail.position.set(-4.2, 4.5, 0); tail.rotation.z = 0.5;
    g.add(body, head, tail);
    for (const [x, z] of [[-2.5, -1], [-2.5, 1], [2.5, -1], [2.5, 1]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.9), m); l.position.set(x, 1.1, z); g.add(l); }
    g.userData = { tail };
    return g;
  }
  makeVehicle(v) {
    const g = new THREE.Group();
    const L = v.len, W = v.wid, body = this.mat(v.color), dark = this.mat("#1f2937"), glass = this.mat("#9fc5e8");
    if (v.kind === "scooter") {
      const b = new THREE.Mesh(new THREE.BoxGeometry(L, 4, W), body); b.position.y = 4; g.add(b);
      for (const x of [-L / 2 + 3, L / 2 - 3]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2, 8), dark); wh.rotation.x = Math.PI / 2; wh.position.set(x, 3, 0); g.add(wh); }
      const bars = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 10), dark); bars.position.set(L / 2 - 4, 9, 0); g.add(bars);
      const rider = this.makePerson(v.rider || (v.rider = { skin: "#c68642", shirt: "#22c55e", hair: "#1c1917", hairStyle: 0 }), {}); rider.position.set(-2, 3, 0); rider.scale.set(0.8, 0.8, 0.8); g.add(rider);
      g.userData = { rider, wheels: [], tail: [], head: [], lights: [], smoke: null };
      return g;
    }
    const tall = v.kind === "bus" || v.kind === "van" || v.kind === "foodtruck";
    const bh = tall ? 16 : v.kind === "sports" ? 6.5 : 8;
    const b = new THREE.Mesh(new THREE.BoxGeometry(L, bh, W), body); b.position.y = bh / 2 + 3; g.add(b);
    if (!tall) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, v.kind === "sports" ? 5 : 6.5, W * 0.86), glass); cab.position.set(-L * 0.06, bh + 3 + (v.kind === "sports" ? 2.5 : 3.2), 0); g.add(cab);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(L * 0.42, 0.8, W * 0.8), body); roof.position.set(-L * 0.06, bh + 3 + (v.kind === "sports" ? 5.2 : 6.6), 0); g.add(roof);
    } else {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(L - (v.kind === "bus" ? 6 : 12), 5, W + 0.4), glass); strip.position.set(v.kind === "bus" ? 0 : -4, bh + 3 - 4, 0); g.add(strip);
      const wind = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, W - 3), glass); wind.position.set(L / 2 - 0.3, bh + 3 - 3, 0); g.add(wind);
    }
    const wheels = [];
    for (const [x, z] of [[-L * 0.32, -W / 2], [-L * 0.32, W / 2], [L * 0.32, -W / 2], [L * 0.32, W / 2]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 2.2, 10), dark); wh.rotation.x = Math.PI / 2; wh.position.set(x, 3.2, z); g.add(wh); wheels.push(wh); }
    const head = [], tail = [];
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 3), this.basic("#fff7cc")); hl.position.set(L / 2 + 0.2, bh / 2 + 3, s * (W / 2 - 2.5)); g.add(hl); head.push(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 3), this.basic("#9f1239")); tl.position.set(-L / 2 - 0.2, bh / 2 + 3, s * (W / 2 - 2.5)); g.add(tl); tail.push(tl);
    }
    if (v.kind === "taxi") { const sign = new THREE.Mesh(new THREE.BoxGeometry(7, 2.5, 3), this.basic("#fde68a")); sign.position.set(-L * 0.06, bh + 11, 0); g.add(sign); }
    if (v.kind === "rental") { const stripe = new THREE.Mesh(new THREE.BoxGeometry(L - 6, 0.4, 4), this.mat("#e11d48")); stripe.position.set(0, bh + 3.3, 0); g.add(stripe); }
    if (v.kind === "sports") { const stripe = new THREE.Mesh(new THREE.BoxGeometry(L - 2, 0.3, 3), this.mat("#f8fafc")); stripe.position.set(0, bh + 3.2, 0); g.add(stripe); }
    if (v.kind === "foodtruck") { const hatch = new THREE.Mesh(new THREE.BoxGeometry(L * 0.55, 6, 0.6), this.mat("#ffffff")); hatch.position.set(-4, 12, W / 2 + 0.2); g.add(hatch); g.add(this.textSprite("🍳 FOOD TRUCK", "#b45309", 0, bh + 9, 0, 40, 8)); }
    if (v.kind === "bus") { const stripe = new THREE.Mesh(new THREE.BoxGeometry(L - 4, 2, W + 0.5), this.mat("#1d4ed8")); stripe.position.set(0, 6, 0); g.add(stripe); }
    const lights = [];
    if (v.kind === "police") {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, W * 0.7), this.mat("#111")); bar.position.set(-L * 0.06, bh + 10.6, 0); g.add(bar);
      const r = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, W * 0.3), this.basic("#ef4444")); r.position.set(-L * 0.06, bh + 11.5, -W * 0.18); g.add(r);
      const bl = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, W * 0.3), this.basic("#3b82f6")); bl.position.set(-L * 0.06, bh + 11.5, W * 0.18); g.add(bl);
      lights.push(r, bl);
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(L - 8, 3, 0.4), this.mat("#1d4ed8")); s1.position.set(0, 6, -W / 2 - 0.2); g.add(s1); const s2 = s1.clone(); s2.position.z = W / 2 + 0.2; g.add(s2);
    }
    const smoke = new THREE.Group(); for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(2 + i, 5, 5), new THREE.MeshBasicMaterial({ color: "#6b7280", transparent: true, opacity: 0.55 })); s.position.set(L / 2 - 2 - i * 5, bh + 6 + i * 4, 0); smoke.add(s); } smoke.visible = false; g.add(smoke);
    g.userData = { wheels, head, tail, lights, smoke, bh };
    return g;
  }
  ensure(key, maker) {
    let m = this.meshes.get(key);
    if (!m) { m = maker(); this.scene.add(m); this.meshes.set(key, m); }
    this.seen.add(key);
    return m;
  }
  animatePerson(g, walkT, moving, stunned, umbrella) {
    const u = g.userData;
    const s = moving ? Math.sin(walkT * 10) * 0.7 : 0;
    u.legs[0].rotation.z = s; u.legs[1].rotation.z = -s; u.arms[0].rotation.z = -s * 0.8; u.arms[1].rotation.z = s * 0.8;
    u.umb.visible = !!umbrella;
    if (stunned) { g.rotation.x = Math.PI / 2; g.position.y = 3; } else { g.rotation.x = 0; }
  }

  // ---------- frame ----------
  draw() {
    const g = this.game, p = g.player;
    this.seen.clear(); this.labelUsed = 0;
    const dt = 1 / 60;
    this.updateCamera(dt);
    this.updateEnvironment(dt);
    const camT = this.camLook, cull = this.game.input.touch ? 560 : 780;
    const near = (x, z) => Math.hypot(x - camT.x, z - camT.z) < cull;

    // vehicles
    for (const v of [...g.vehicles, ...g.police]) {
      if (!near(v.x, v.y)) continue;
      const m = this.ensure(v, () => this.makeVehicle(v));
      m.position.set(v.x, 0, v.y); m.rotation.y = -v.angle;
      const u = m.userData;
      const spin = v.speed * dt / 3.2; for (const w of u.wheels) w.rotation.z -= spin;
      for (const t of u.tail) t.material.color.set(v.braking ? "#ff2d2d" : v.reversing ? "#f8fafc" : "#9f1239");
      if (u.lights.length) { const on = Math.floor(g.time * 8) % 2 === 0; u.lights[0].material.color.set(on ? "#ff3b3b" : "#7f1d1d"); u.lights[1].material.color.set(on ? "#3b82f6" : "#1e3a8a"); }
      if (u.smoke) { u.smoke.visible = v.hp < v.maxHp * 0.35; if (u.smoke.visible) u.smoke.children.forEach((s, i) => { s.position.y = u.bh + 6 + i * 4 + Math.sin(g.time * 5 + i) * 1.5; }); }
      if (u.rider) this.animatePerson(u.rider, 0, false, false, false);
      if (v.honk) this.label(v.x, 20, v.y, HONK_LINES[Math.floor(this.hash(Math.round(v.x), Math.round(v.y)) * HONK_LINES.length)], "lbl");
      if (v.honk && v.honkT < 1.5) v.honk = false;
    }
    // pedestrians
    for (const pd of g.peds) {
      if (!near(pd.x, pd.y)) continue;
      const m = this.ensure(pd, () => this.makePerson(pd));
      m.position.set(pd.x, 0, pd.y); m.rotation.y = -pd.angle;
      const moving = pd.state === "walk" || pd.state === "flee" || pd.state === "angry";
      this.animatePerson(m, pd.walkT * (pd.state === "walk" ? 1 : 2), moving, pd.state === "stunned", g.weather.rain && pd.umbrella && pd.state !== "flee" && pd.state !== "stunned");
      if (pd.dog) { const d = this.ensure(pd.dog, () => this.makeDog(pd.dog.color)); d.position.set(pd.dog.x, 0, pd.dog.y); d.rotation.y = -pd.dog.angle; d.userData.tail.rotation.y = Math.sin(pd.dog.t * 14) * 0.6; }
      if (pd.say) this.label(pd.x, 26, pd.y, pd.say, "lbl");
      else {
        const dd = dist(pd, p);
        if (dd < 70 && pd.hungry) this.label(pd.x, 26, pd.y, "🍴", "lbl plate");
        if (pd.hailing && p.vehicle && p.vehicle.kind === "taxi" && !g.fare && dd < 260 && pd.state === "walk") this.label(pd.x, 26, pd.y, "🖐 " + HAIL_LINES[Math.floor(this.hash(Math.round(pd.x), 3) * HAIL_LINES.length)], "lbl");
      }
    }
    // strangers with plates
    for (const s of g.strangers) {
      if (!near(s.x, s.y)) continue;
      const m = this.ensure(s, () => this.makePerson(s, { orange: true }));
      m.position.set(s.x, Math.sin(s.t * 3) * 0.6, s.y); m.rotation.y = -s.angle;
      this.animatePerson(m, s.t, false, false, false);
      this.label(s.x, 27, s.y, s.plate.icon + (dist(s, p) < 140 ? " " + s.plate.name : ""), "lbl plate");
    }
    // episode spot
    this.spotBeam.visible = false; this.spotCone.visible = false;
    if (g.spot && g.step) {
      const s = g.spot, look = g.spotLook, nearP = dist(p, s) < 120;
      this.spotBeam.visible = true; this.spotBeam.position.set(s.x, 45, s.y);
      this.spotCone.visible = true; this.spotCone.position.set(s.x, 34 + Math.sin(g.time * 3) * 2, s.y); this.spotCone.rotation.y = g.time * 2;
      look.figures.forEach((f, i) => {
        const fx = s.x + f.dx, fz = s.y + f.dy;
        const m = this.ensure(f, () => this.makePerson(f, { hat: f.hat }));
        const a = nearP ? Math.atan2(p.y - fz, p.x - fx) : f.angle + Math.sin(g.time * 0.7 + i) * 0.3;
        m.position.set(fx, 0, fz); m.rotation.y = -a; this.animatePerson(m, g.time + i, false, false, false);
        if (f.dog) { const d = this.ensure(f.dogKey || (f.dogKey = { k: 1 }), () => this.makeDog(f.dogColor)); d.position.set(fx + 10, 0, fz + 8); d.rotation.y = -a; d.userData.tail.rotation.y = Math.sin(g.time * 12) * 0.6; }
      });
      const icon = g.step === "cook" ? "🍳 " : g.step === "shop" ? "⏳ " : "❗ ";
      this.label(s.x, 52, s.y, icon + g.ep.name, "lbl name");
      if (nearP) this.label(s.x, 44, s.y, g.ep.who, "lbl sub");
    }
    // player + Orly
    if (!p.vehicle) {
      const pm = this.ensure(p, () => this.makePerson({ skin: "#e0ac69", shirt: "#f8fafc", pants: "#1f2937" }, { chef: true }));
      pm.position.set(p.x, 0, p.y); pm.rotation.y = -p.angle;
      const moving = g.input.down("up") || g.input.down("down") || g.input.down("left") || g.input.down("right");
      this.animatePerson(pm, p.walkT, moving && p.stun <= 0, p.stun > 0, false);
      const o = g.orly;
      const om = this.ensure(o, () => { const m = this.makePerson({ skin: "#f1c9a5", shirt: "#1e3a8a", pants: "#374151", hair: "#d6b370", hairStyle: 0 }); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 4), this.mat("#b45309")); pole.position.set(2, 20, 5); m.add(pole); const sign = this.textSprite("FREE DINNER?", "#facc15", 2, 29, 5, 22, 7); m.add(sign); return m; });
      om.position.set(o.x, 0, o.y); om.rotation.y = -o.angle;
      this.animatePerson(om, o.walkT || 0, Math.hypot(o.x - (p.x - Math.cos(p.angle) * 16), o.y - (p.y - Math.sin(p.angle) * 16)) > 7, false, g.weather.rain);
    }
    // markers
    this.fareBeam.visible = !!g.fare;
    if (g.fare) { this.fareBeam.position.set(g.fare.dest.x, 45, g.fare.dest.y); this.label(g.fare.dest.x, 95, g.fare.dest.y, "DROP-OFF", "lbl name"); }
    let sb = 0;
    if (g.step === "shop") for (const s of g.world.shops) { if (sb >= this.shopBeams.length || !g.unlocked.has(s.city) || !g.shopHasMissing(s.kind)) continue; const b = this.shopBeams[sb++]; b.visible = true; b.position.set(s.x + 16, 45, s.y + 16); this.label(s.x + 16, 96, s.y + 16, "$", "lbl mark"); }
    for (let i = sb; i < this.shopBeams.length; i++) this.shopBeams[i].visible = false;
    const v = p.vehicle;
    if (v && (v.hp < v.maxHp || g.heat >= 1)) for (const ga of g.world.garages) if (g.unlocked.has(ga.city) && dist(ga, p) < 900) this.label(ga.x + 16, 60, ga.y + 16, "🔧", "lbl plate");
    const tgt = g.objectiveTarget();
    this.arrowPivot.visible = false;
    if (tgt) {
      const d = dist(p, tgt);
      if (d > 60) {
        const tx = tgt.x + (tgt.tx != null ? 16 : 0), tz = tgt.y + (tgt.ty != null ? 16 : 0);
        this.arrowPivot.visible = true; this.arrowPivot.position.set(p.x, (v ? 26 : 30) + Math.sin(g.time * 4), p.y);
        this.arrowPivot.rotation.y = -Math.atan2(tz - p.y, tx - p.x);
        this.label(p.x, (v ? 38 : 42), p.y, Math.round(d / 10) * 10 + "m", "lbl dist");
      }
    }
    // cleanup meshes no longer present
    for (const [key, m] of this.meshes) if (!this.seen.has(key)) { this.scene.remove(m); this.meshes.delete(key); }
    for (let i = this.labelUsed; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
    this.gl.render(this.scene, this.camera);
    this.drawMinimap();
  }
  updateCamera(dt) {
    const g = this.game, p = g.player, v = p.vehicle;
    const moving = g.input.down("up") || g.input.down("down") || g.input.down("left") || g.input.down("right");
    let wantYaw = v ? v.angle : (moving && p.stun <= 0 ? p.angle : this.camYaw);
    if (v && v.speed < -10) wantYaw = this.camYaw;
    let d = wrapAngle(wantYaw - this.camYaw);
    const k = v ? 4.5 : 3.5;
    this.camYaw += d * Math.min(1, k * dt);
    const modes = [{ dist: v ? 120 : 85, h: v ? 52 : 40, ahead: 40 }, { dist: 180, h: 140, ahead: 30 }, { dist: 40, h: 330, ahead: 10 }][this.camMode];
    const px = p.x, pz = p.y, w = g.world;
    // Pull the camera in (and up) rather than let it pass through a building behind the player.
    const blocks = (x, z) => { const t = w.get(Math.floor(x / TILE), Math.floor(z / TILE)); return t === T.BUILDING || t === T.SHOP || t === T.HOME || t === T.GARAGE; };
    let cd = modes.dist, ch = modes.h;
    if (this.camMode < 2) for (let s = 14; s <= modes.dist; s += 5) {
      if (blocks(px - Math.cos(this.camYaw) * s, pz - Math.sin(this.camYaw) * s)) { cd = Math.max(16, s - 10); ch = modes.h + (modes.dist - cd) * 0.55; break; }
    }
    const tx = px - Math.cos(this.camYaw) * cd, tz = pz - Math.sin(this.camYaw) * cd;
    const want = new THREE.Vector3(tx, ch, tz), look = new THREE.Vector3(px + Math.cos(this.camYaw) * modes.ahead, 8, pz + Math.sin(this.camYaw) * modes.ahead);
    if (!this.camInit) { this.camInit = true; this.camPos.copy(want); this.camLook.copy(look); }
    this.camPos.lerp(want, Math.min(1, (cd < modes.dist ? 12 : 6) * dt));
    this.camLook.lerp(look, Math.min(1, 8 * dt));
    let sx = 0, sy = 0;
    if (g.shake > 0) { sx = (Math.random() - 0.5) * 5; sy = (Math.random() - 0.5) * 5; g.shake -= dt; }
    this.camera.position.set(this.camPos.x + sx, Math.max(this.camPos.y, 12), this.camPos.z + sy);
    this.camera.lookAt(this.camLook);
  }
  updateEnvironment(dt) {
    const g = this.game, n = g.nightAmount(), rain = g.weather.rain;
    if (Math.abs(n - this.night) > 0.005 || rain !== this.rainOn) {
      this.night = n; this.rainOn = rain;
      const day = new THREE.Color(rain ? "#7d8aa0" : "#8ec5ff"), nightC = new THREE.Color(rain ? "#070a14" : "#0b1030");
      const sky = day.clone().lerp(nightC, n);
      this.scene.background = sky; this.scene.fog.color = sky;
      this.scene.fog.near = rain ? 300 : 500; this.scene.fog.far = rain ? 900 : 1400;
      this.sun.intensity = (rain ? 0.55 : 1.0) * (1 - n * 0.9);
      this.hemi.intensity = 0.75 * (1 - n * 0.7);
      this.amb.intensity = 0.25 * (1 - n * 0.5) + n * 0.12;
      const litCol = new THREE.Color("#cbd5e1").lerp(new THREE.Color("#ffe08a"), n);
      this.winLit.material.color = litCol; this.bulbs.material.color = new THREE.Color("#d1d5db").lerp(new THREE.Color("#fff1b8"), n);
      this.rain.visible = rain;
    }
    // street lights near the player
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.4;
      const p = g.player;
      const posts = this.lampPosts.map(l => ({ l, d: Math.hypot(l.x - p.x, l.z - p.y) })).sort((a, b) => a.d - b.d).slice(0, this.streetLights.length);
      posts.forEach((o, i) => { this.streetLights[i].position.set(o.l.x, 24, o.l.z); });
    }
    for (const l of this.streetLights) l.intensity = n > 0.15 ? 1.4 * n : 0;
    const v = g.player.vehicle;
    for (let i = 0; i < 2; i++) {
      const h = this.headlights[i];
      if (v && n > 0.15) {
        const s = i === 0 ? -1 : 1;
        h.intensity = 1.6 * n;
        h.position.set(v.x + Math.cos(v.angle) * v.len / 2 + Math.cos(v.angle + Math.PI / 2) * s * v.wid * 0.35, 8, v.y + Math.sin(v.angle) * v.len / 2 + Math.sin(v.angle + Math.PI / 2) * s * v.wid * 0.35);
        h.target.position.set(v.x + Math.cos(v.angle) * 200, 0, v.y + Math.sin(v.angle) * 200);
      } else h.intensity = 0;
    }
    if (rain) {
      const pos = this.rain.geometry.attributes.position, c = this.camLook;
      this.rain.position.set(c.x, 0, c.z);
      for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) - 380 * dt; if (y < 0) y += 300; pos.setY(i, y); }
      pos.needsUpdate = true;
    }
    this.water.position.y = Math.sin(g.time * 1.3) * 0.4;
  }
  label(x, y, z, text, cls) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
    let el = this.labelPool[this.labelUsed];
    if (!el) { el = document.createElement("div"); this.labelsEl.appendChild(el); this.labelPool.push(el); }
    this.labelUsed++;
    if (el.dataset.t !== text) { el.textContent = text; el.dataset.t = text; }
    if (el.className !== cls) el.className = cls;
    el.style.display = "";
    el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2 * innerWidth).toFixed(0)}px, ${((1 - v.y) / 2 * innerHeight).toFixed(0)}px)`;
  }
}
Renderer3D.prototype.buildMapCache = Renderer.prototype.buildMapCache;
Renderer3D.prototype.drawMinimap = Renderer.prototype.drawMinimap;
Renderer3D.prototype.drawBigMap = Renderer.prototype.drawBigMap;
