// Three.js renderer. The simulation stays 2D (x, y, heading); here x -> x, y -> z, up -> y.
// Built for phones: the static city is a handful of merged meshes, every car and person is
// drawn through InstancedMesh (one draw call per body part), and the look comes from a sun
// that moves across a shaded sky, filmic tone mapping, haze, and procedural textures.

class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.tmp = new THREE.Color(); }
  add(g, color, uvScale) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position.array, n = ng.attributes.normal.array, u = ng.attributes.uv ? ng.attributes.uv.array : null;
    this.tmp.set(color);
    for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
      this.pos.push(p[i], p[i + 1], p[i + 2]); this.nrm.push(n[i], n[i + 1], n[i + 2]); this.col.push(this.tmp.r, this.tmp.g, this.tmp.b);
      if (u) this.uv.push(u[j], u[j + 1]); else this.uv.push(0, 0);
    }
    ng.dispose(); if (ng !== g) g.dispose();
  }
  // Box with texture-space UVs: `unit` world units per texture repeat (uv scaled per face by the face's size).
  box(x, y, z, w, h, d, color, unit, uvo = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (unit) {
      const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) { const [fw, fh] = dims[f]; for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * fw / unit + uvo, uv.getY(i) * fh / unit); } }
    }
    g.translate(x, y, z); this.add(g, color);
  }
  cyl(x, y, z, rt, rb, h, color, seg = 6) { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); this.add(g, color); }
  sphere(x, y, z, r, color, seg = 6) { const g = new THREE.SphereGeometry(r, seg, seg); g.translate(x, y, z); this.add(g, color); }
  cone(x, y, z, r, h, color, seg = 6) { const g = new THREE.ConeGeometry(r, h, seg); g.translate(x, y, z); this.add(g, color); }
  quad(x, y, z, w, h, angleY, color, uvRect) {
    const g = new THREE.PlaneGeometry(w, h);
    if (uvRect) { const uv = g.attributes.uv; const [u0, v0, u1, v1] = uvRect; uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); }
    g.rotateY(angleY); g.translate(x, y, z); this.add(g, color);
  }
  build(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    return new THREE.Mesh(geo, material);
  }
  get empty() { return this.pos.length === 0; }
}

// One InstancedMesh per repeated part; refilled every frame.
class Parts {
  constructor(geometry, material, max, shadows) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.castShadow = !!shadows; this.mesh.receiveShadow = false; this.mesh.frustumCulled = false;
    this.max = max; this.n = 0; this.col = new THREE.Color();
    this.mesh.setColorAt(0, this.col.set("#ffffff"));
  }
  add(m, color) { if (this.n >= this.max) return; this.mesh.setMatrixAt(this.n, m); this.mesh.setColorAt(this.n, this.col.set(color)); this.n++; }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.n = 0; }
}

const NEON_WORDS = ["DINER", "24 HR", "TACOS", "BODEGA", "PHO", "BAR", "LAUNDRY", "PIZZA", "MARKET", "HOTEL", "NAILS", "SUSHI", "CAFE", "DELI", "LIQUOR", "PHARMACY"];
const NEON_COLORS = ["#ff2d95", "#22d3ee", "#facc15", "#f97316", "#a3e635", "#f43f5e", "#60a5fa", "#e879f9"];

class Renderer3D {
  constructor(canvas2d, game) {
    this.game = game;
    this.touch = game.input.touch;
    const canvas = document.createElement("canvas"); canvas.id = "game3d";
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(devicePixelRatio || 1, this.touch ? 1 : 1.5));
    this.gl.outputEncoding = THREE.sRGBEncoding;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.toneMappingExposure = 1.05;
    this.shadows = !this.touch;
    this.gl.shadowMap.enabled = this.shadows; this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas2d.parentNode.insertBefore(canvas, canvas2d.nextSibling);
    canvas2d.style.display = "none";
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog("#cfe8ff", 400, 1300);
    this.camera = new THREE.PerspectiveCamera(55, 1, 2, 3200);
    this.camYaw = 0; this.camMode = 0; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this._want = new THREE.Vector3(); this._look = new THREE.Vector3();
    this.mini = document.getElementById("minimap"); this.mctx = this.mini.getContext("2d");
    this.mapCache = document.createElement("canvas"); this.mapCache.width = CITY * 8; this.mapCache.height = CITY * 8; this.mapDirty = true;
    this.labelsEl = document.getElementById("labels"); this.labelPool = []; this.labelUsed = 0;
    this.textures = new Map(); this.lightT = 0; this.envKey = ""; this.m4 = new THREE.Matrix4(); this.m4b = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v3 = new THREE.Vector3(); this.s3 = new THREE.Vector3(); this.e = new THREE.Euler();
    this.makeTextures();
    this.buildSky();
    this.buildLights();
    this.buildCity();
    this.buildInstances();
    this.buildRain();
    this.buildMarkers();
  }
  invalidateMap() { this.mapDirty = true; this.rebuildLocks(); }
  resize() { this.gl.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  cycleCamera() { this.camMode = (this.camMode + 1) % 3; return ["chase", "high", "overhead"][this.camMode]; }
  hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

  // ---------- procedural textures ----------
  canvasTex(w, h, draw, repeat = true) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;
    return t;
  }
  noise(ctx, w, h, base, amp, n) { for (let i = 0; i < n; i++) { const v = (Math.random() - 0.5) * amp; ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v)})`; ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); } }
  makeTextures() {
    this.tex = {};
    this.tex.asphalt = this.canvasTex(256, 256, (ctx, w, h) => { ctx.fillStyle = "#3a3d46"; ctx.fillRect(0, 0, w, h); this.noise(ctx, w, h, 0, 0.35, 4000); ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; for (let i = 0; i < 6; i++) { ctx.beginPath(); let x = Math.random() * w, y = Math.random() * h; ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); } ctx.stroke(); } });
    this.tex.concrete = this.canvasTex(256, 256, (ctx, w, h) => { ctx.fillStyle = "#b9bcc2"; ctx.fillRect(0, 0, w, h); this.noise(ctx, w, h, 0, 0.22, 3000); ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2); ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); });
    this.tex.grass = this.canvasTex(256, 256, (ctx, w, h) => { ctx.fillStyle = "#4f8a3c"; ctx.fillRect(0, 0, w, h); this.noise(ctx, w, h, 0, 0.3, 5000); for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(${90 + Math.random() * 60},${130 + Math.random() * 60},50,0.5)`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 4); } });
    this.tex.sand = this.canvasTex(256, 256, (ctx, w, h) => { ctx.fillStyle = "#e6d3a3"; ctx.fillRect(0, 0, w, h); this.noise(ctx, w, h, 0, 0.18, 3000); ctx.strokeStyle = "rgba(120,90,40,0.15)"; for (let y = 0; y < h; y += 14) { ctx.beginPath(); for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x / 18) * 4); ctx.stroke(); } });
    this.tex.water = this.canvasTex(256, 256, (ctx, w, h) => { ctx.fillStyle = "#2f6ea3"; ctx.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { ctx.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.14})`; ctx.lineWidth = 1 + Math.random(); const x = Math.random() * w, y = Math.random() * h; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 12, y - 3, x + 26 + Math.random() * 20, y); ctx.stroke(); } });
    // Facade: 4 windows wide x 8 floors, tinted by vertex color. Emissive map lights a random subset.
    const facade = (lit) => this.canvasTex(512, 768, (ctx, w, h) => {
      ctx.fillStyle = lit ? "#000" : "#e6e1d8"; ctx.fillRect(0, 0, w, h);
      if (!lit) { this.noise(ctx, w, h, 0, 0.12, 6000); ctx.strokeStyle = "rgba(0,0,0,0.08)"; for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); } }
      for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) {
        const x = 24 + c * 128, y = 20 + r * 96, on = this.hash(c * 31 + 7, r * 17 + 3) < 0.38;
        if (lit) { if (on) { const g = ctx.createLinearGradient(0, y, 0, y + 60); g.addColorStop(0, "#fff0c2"); g.addColorStop(1, "#f3b25a"); ctx.fillStyle = g; ctx.fillRect(x, y, 80, 60); } continue; }
        ctx.fillStyle = "#6b7280"; ctx.fillRect(x - 4, y - 4, 88, 68);
        const g = ctx.createLinearGradient(x, y, x + 80, y + 60); g.addColorStop(0, "#2b3648"); g.addColorStop(0.5, "#516178"); g.addColorStop(1, "#1f2937");
        ctx.fillStyle = g; ctx.fillRect(x, y, 80, 60);
        ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(x, y, 80, 8);
        ctx.fillStyle = "#4b5563"; ctx.fillRect(x + 38, y, 4, 60);
        ctx.fillStyle = "#8b8f96"; ctx.fillRect(x - 6, y + 62, 92, 4);
      }
    });
    this.tex.facade = facade(false); this.tex.facadeLit = facade(true);
    this.tex.glass = this.canvasTex(256, 256, (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#1e2a3a"); g.addColorStop(0.5, "#3d5573"); g.addColorStop(1, "#16202c"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#374151"; for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 4, h); ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(0, 0, w, 12); });
    this.tex.cloud = this.canvasTex(256, 128, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); for (let i = 0; i < 14; i++) { const g = ctx.createRadialGradient(40 + Math.random() * 176, 40 + Math.random() * 48, 2, 40 + Math.random() * 176, 40 + Math.random() * 48, 30 + Math.random() * 30); g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); } }, false);
    // Sign atlas: shop names + neon words, one draw call for every sign in the city.
    this.signRows = [];
    const rows = [];
    for (const k of Object.keys(SHOPS)) rows.push({ key: "shop:" + k, text: SHOPS[k].icon + " " + SHOPS[k].name.toUpperCase(), bg: SHOPS[k].color, fg: "#fff" });
    rows.push({ key: "home", text: "🏠 HOME KITCHEN", bg: "#2563eb", fg: "#fff" }, { key: "garage", text: "🔧 AUTO BODY", bg: "#b45309", fg: "#fff" });
    NEON_WORDS.forEach((wd, i) => rows.push({ key: "neon:" + i, text: wd, bg: "#0b0b14", fg: NEON_COLORS[i % NEON_COLORS.length], neon: true }));
    this.signIndex = {}; rows.forEach((r, i) => this.signIndex[r.key] = i);
    this.tex.signs = this.canvasTex(512, rows.length * 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      rows.forEach((r, i) => {
        const y = i * 64;
        ctx.fillStyle = r.bg; ctx.fillRect(0, y + 2, w, 60);
        ctx.fillStyle = r.fg; ctx.font = (r.neon ? "bold 46px" : "bold 40px") + " sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        if (r.neon) { ctx.shadowColor = r.fg; ctx.shadowBlur = 18; }
        ctx.fillText(r.text, w / 2, y + 33); ctx.shadowBlur = 0;
      });
    }, false);
    this.signRowCount = rows.length;
  }
  signUV(key) { const i = this.signIndex[key], n = this.signRowCount; return [0, 1 - (i + 1) / n, 1, 1 - i / n]; }

  // ---------- sky ----------
  buildSky() {
    this.skyU = { top: { value: new THREE.Color("#3b8fe0") }, horizon: { value: new THREE.Color("#cfe8ff") }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color("#fff1c9") }, haze: { value: 0.6 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "varying vec3 vDir; uniform vec3 top, horizon, sunDir, sunCol; uniform float haze; void main(){ vec3 d = normalize(vDir); float t = clamp(d.y, 0.0, 1.0); vec3 col = mix(horizon, top, pow(t, 0.5)); float s = max(dot(d, sunDir), 0.0); col += sunCol * (pow(s, 900.0) * 4.0 + pow(s, 12.0) * 0.45 * haze + pow(s, 2.5) * 0.14 * haze); col = mix(col, horizon, (1.0 - t) * haze * 0.45); gl_FragColor = vec4(col, 1.0); }",
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 24, 12), mat); this.sky.renderOrder = -10; this.scene.add(this.sky);
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, e = Math.random() * 1.2 + 0.15, r = 2400; pos[i * 3] = Math.cos(a) * Math.cos(e) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: "#ffffff", size: 3, transparent: true, opacity: 0, fog: false, sizeAttenuation: false })); this.scene.add(this.stars);
    this.clouds = new THREE.Group();
    const cm = new THREE.SpriteMaterial({ map: this.tex.cloud, transparent: true, opacity: 0.85, fog: false, depthWrite: false });
    for (let i = 0; i < (this.touch ? 7 : 12); i++) { const s = new THREE.Sprite(cm.clone()); s.position.set((Math.random() - 0.5) * 3000, 520 + Math.random() * 160, (Math.random() - 0.5) * 3000); s.scale.set(500 + Math.random() * 400, 160 + Math.random() * 90, 1); s.userData.v = 4 + Math.random() * 6; this.clouds.add(s); }
    this.scene.add(this.clouds);
  }
  buildLights() {
    this.hemi = new THREE.HemisphereLight("#bfdfff", "#6b5a48", 0.55); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff1c9", 1.4); this.scene.add(this.sun); this.scene.add(this.sun.target);
    if (this.shadows) {
      this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera; c.left = -520; c.right = 520; c.top = 520; c.bottom = -520; c.near = 50; c.far = 2200; this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 1.5;
    }
    this.moon = new THREE.DirectionalLight("#8fa8ff", 0); this.moon.position.set(-300, 400, -200); this.scene.add(this.moon);
    this.amb = new THREE.AmbientLight("#ffffff", 0.18); this.scene.add(this.amb);
    this.streetLights = [];
    for (let i = 0; i < (this.touch ? 4 : 8); i++) { const l = new THREE.PointLight("#ffd28a", 0, 190, 1.7); this.scene.add(l); this.streetLights.push(l); }
    this.headlights = [];
    for (let i = 0; i < 2; i++) { const s = new THREE.SpotLight("#fff7cc", 0, 300, 0.5, 0.55, 1.1); s.target = new THREE.Object3D(); this.scene.add(s); this.scene.add(s.target); this.headlights.push(s); }
  }

  // ---------- static city ----------
  buildCity() {
    const w = this.game.world;
    const roads = new GeoBuilder(), walks = new GeoBuilder(), grass = new GeoBuilder(), sand = new GeoBuilder(), water = new GeoBuilder();
    const bld = new GeoBuilder(), glass = new GeoBuilder(), props = new GeoBuilder(), bulbs = new GeoBuilder(), signs = new GeoBuilder(), lampGlow = new GeoBuilder();
    const blockHeight = (bx, by) => { const h = this.hash(bx * 3 + 1, by * 7 + 2); const center = Math.hypot(bx - 4.5, by - 4.5); return 30 + Math.floor(h * 7) * 14 + (center < 2.5 ? 60 : 0) + (h > 0.92 ? 90 : 0); };
    roads.box(WORLD / 2, -6, WORLD / 2, WORLD + 600, 8, WORLD + 600, "#242833", 64);
    const isWalkable = t => t === T.SIDEWALK || t === T.SAND || t === T.PARK || t === T.GARAGE;
    for (let ty = 0; ty < CITY; ty++) for (let tx = 0; tx < CITY; tx++) {
      const t = w.get(tx, ty), cx = tx * TILE + 16, cz = ty * TILE + 16, cid = cityOfTile(tx, ty), h = this.hash(tx, ty);
      const lx = tx % 5, ly = ty % 5, warm = cid === "fl" || cid === "la";
      if (t === T.ROAD || t === T.BRIDGE) {
        const y = t === T.BRIDGE ? 3 : 0.5;
        roads.box(cx, y, cz, TILE, t === T.BRIDGE ? 6 : 1, TILE, "#ffffff", 32, h * 3);
        if (tx % 5 === 0 && ty % 5 !== 0) { props.box(cx, y + 0.65, cz - 8, 1.6, 0.3, 10, "#d8c25a"); props.box(cx, y + 0.65, cz + 8, 1.6, 0.3, 10, "#d8c25a"); }
        else if (ty % 5 === 0 && tx % 5 !== 0) { props.box(cx - 8, y + 0.65, cz, 10, 0.3, 1.6, "#d8c25a"); props.box(cx + 8, y + 0.65, cz, 10, 0.3, 1.6, "#d8c25a"); }
        const isCross = tx % 5 === 0 && ty % 5 === 0;
        if (!isCross && t === T.ROAD && ((tx % 5 === 0 && (ly === 1 || ly === 4)) || (ty % 5 === 0 && (lx === 1 || lx === 4)))) {
          for (let i = 0; i < 4; i++) {
            if (tx % 5 === 0) props.box(cx - 12 + i * 8, y + 0.65, cz + (ly === 1 ? -12 : 12), 5, 0.3, 4, "#e5e7eb");
            else props.box(cx + (lx === 1 ? -12 : 12), y + 0.65, cz - 12 + i * 8, 4, 0.3, 5, "#e5e7eb");
          }
        }
        if (t === T.BRIDGE) {
          const vertical = w.get(tx - 1, ty) === T.WATER || w.get(tx + 1, ty) === T.WATER;
          if (vertical) { props.box(cx - 15, 8, cz, 2, 8, TILE, "#7b8290"); props.box(cx + 15, 8, cz, 2, 8, TILE, "#7b8290"); }
          else { props.box(cx, 8, cz - 15, TILE, 8, 2, "#7b8290"); props.box(cx, 8, cz + 15, TILE, 8, 2, "#7b8290"); }
          props.box(cx, -6, cz, 10, 14, 10, "#4b5563");
        }
        if (isCross) {
          for (const [ox, oz] of [[-13, -13], [13, 13]]) {
            props.cyl(cx + ox, 13, cz + oz, 0.7, 0.9, 26, "#7c828c", 5);
            props.box(cx + ox + 3, 26, cz + oz, 7, 0.8, 0.8, "#7c828c");
            bulbs.box(cx + ox + 6, 25.6, cz + oz, 3, 1, 2, "#ffe9a8");
            lampGlow.sphere(cx + ox + 6, 25.2, cz + oz, 3, "#ffd58a", 8);
          }
          // traffic light heads on two diagonal corners
          for (const [ox, oz, rot] of [[-13, 13, 0], [13, -13, Math.PI]]) {
            props.cyl(cx + ox, 12, cz + oz, 0.6, 0.7, 24, "#3f3f46", 5);
            props.box(cx + ox, 22, cz + oz, 3, 9, 3, "#27272a");
          }
        }
      } else if (isWalkable(t)) {
        const b = t === T.SAND ? sand : t === T.PARK ? grass : walks;
        b.box(cx, 1, cz, TILE, 2, TILE, t === T.GARAGE ? "#9ca3af" : warm && t === T.SIDEWALK ? "#e8e0d0" : "#ffffff", 32, h);
        for (const [dx, dy] of DIRS) { if (w.get(tx + dx, ty + dy) === T.ROAD) props.box(cx + dx * 15.5, 1.6, cz + dy * 15.5, dx ? 1 : TILE, 1.2, dy ? 1 : TILE, "#d4d7dd"); }
        if (t === T.SIDEWALK) {
          if (h < 0.05) { props.box(cx, 4, cz, 6, 6, 6, "#374151"); props.box(cx, 7.5, cz, 7, 1, 7, "#1f2937"); }
          else if (h < 0.09) { props.box(cx, 5, cz, 20, 1.5, 5, "#6b4f2a"); props.box(cx, 8, cz - 2.5, 20, 5, 1.2, "#6b4f2a"); props.box(cx - 8, 2.5, cz, 1.5, 3, 5, "#4b3a20"); props.box(cx + 8, 2.5, cz, 1.5, 3, 5, "#4b3a20"); }
          else if (h < 0.16) { if (warm) this.palm(props, cx, cz, h); else this.tree(props, cx, cz, cid, h); }
          else if (h < 0.19) { props.cyl(cx, 5, cz, 2, 2.2, 8, "#b91c1c", 6); props.sphere(cx, 9.5, cz, 2.2, "#7f1d1d", 5); }
          else if (h < 0.22 && cid === "ny") { props.box(cx, 7, cz, 8, 12, 8, "#1d4ed8"); props.box(cx, 13.5, cz, 8.5, 1.5, 8.5, "#1e3a8a"); }
          else if (h < 0.25) { props.box(cx, 6, cz, 6, 12, 6, "#ef4444"); props.box(cx, 12.5, cz, 6.5, 1, 6.5, "#991b1b"); }
        } else if (t === T.PARK) {
          if (h < 0.45) { if (warm && h < 0.2) this.palm(props, cx + (h - 0.2) * 20, cz + this.hash(ty, tx) * 16 - 8, h); else this.tree(props, cx + (h - 0.2) * 20, cz + this.hash(ty, tx) * 16 - 8, cid, h); }
          else if (h < 0.52) { props.box(cx, 5, cz, 20, 1.5, 5, "#8b5a2b"); props.box(cx, 8, cz - 2.5, 20, 5, 1.2, "#8b5a2b"); }
          else if (h < 0.58) { props.cyl(cx, 3, cz, 9, 9, 2, "#a3b18a", 10); props.cyl(cx, 6, cz, 1.2, 1.2, 8, "#cbd5e1", 5); }
          else if (h < 0.62) { props.box(cx, 3, cz, 18, 2, 18, "#a8a29e"); }
        } else if (t === T.SAND) {
          if (h < 0.08) { props.cyl(cx, 8, cz, 0.6, 0.6, 16, "#e5e7eb", 4); props.cone(cx, 17, cz, 10, 4, h < 0.04 ? "#ef4444" : "#3b82f6", 8); }
          else if (h < 0.14) { props.box(cx, 2.5, cz, 18, 1, 9, "#3b82f6"); }
          else if (h < 0.2) this.palm(props, cx, cz, h);
        } else if (t === T.GARAGE && lx === 2 && ly === 2) {
          props.box(cx + 16, 12, cz + 16, 62, 22, 62, "#6b7280"); props.box(cx + 16, 24, cz + 16, 66, 2, 66, "#374151");
          props.box(cx + 16, 9, cz + 16 + 32, 40, 18, 2, "#fbbf24"); props.box(cx + 16 - 10, 9, cz + 16 + 32.5, 1, 18, 1, "#111"); props.box(cx + 16 + 10, 9, cz + 16 + 32.5, 1, 18, 1, "#111");
          signs.quad(cx + 16, 30, cz + 16 + 33.5, 42, 8, 0, "#ffffff", this.signUV("garage"));
        }
      } else if (t === T.WATER) {
        water.box(cx, -1.5, cz, TILE, 1, TILE, "#ffffff", 64, h);
      } else if (t === T.BUILDING) {
        const bx = Math.floor(tx / 5), by = Math.floor(ty / 5);
        const hh = blockHeight(bx, by) + (this.hash(tx * 5, ty * 3) < 0.3 ? 14 : 0);
        const tint = new THREE.Color(CITIES[cid].color).lerp(new THREE.Color("#ffffff"), 0.35).offsetHSL(0, 0, (h - 0.5) * 0.08);
        bld.box(cx, hh / 2, cz, TILE, hh, TILE, tint, 64, this.hash(tx + 3, ty + 9) * 4);
        props.box(cx, hh + 0.9, cz, TILE + 0.6, 1.8, TILE + 0.6, CITIES[cid].roof);
        if (this.hash(tx + 7, ty + 3) < 0.35) props.box(cx + (h - 0.5) * 12, hh + 4, cz + (this.hash(ty, tx) - 0.5) * 12, 8, 6, 8, "#9aa3ad");
        if (this.hash(tx + 11, ty + 5) < 0.1) { props.box(cx, hh + 3, cz, 10, 4, 10, "#cbd5e1"); props.cyl(cx, hh + 12, cz, 0.5, 0.5, 14, "#e5e7eb", 4); props.cyl(cx, hh + 9, cz, 3.5, 3.5, 6, "#8b5a2b", 8); }
        if (hh > 100 && this.hash(tx + 2, ty + 8) < 0.5) bld.box(cx, hh + 14, cz, TILE - 10, 28, TILE - 10, tint, 64, 1);
        for (let d = 0; d < 4; d++) {
          const [dx, dy] = DIRS[d];
          const nt = w.get(tx + dx, ty + dy);
          if (nt !== T.SIDEWALK) continue;
          // ground floor: storefront glass and an awning on street-facing sides
          const gx = cx + dx * 16.3, gz = cz + dy * 16.3;
          glass.box(gx, 5, gz, dx ? 0.6 : TILE - 4, 9, dy ? 0.6 : TILE - 4, "#ffffff", 32);
          const aw = this.hash(tx * 3 + d, ty * 5 + 1);
          if (aw < 0.5) props.box(cx + dx * 19, 10.5, cz + dy * 19, dx ? 6 : TILE - 8, 0.8, dy ? 6 : TILE - 8, NEON_COLORS[Math.floor(aw * 16) % NEON_COLORS.length]);
          if (aw > 0.72) { const word = Math.floor(this.hash(tx + d, ty * 2) * NEON_WORDS.length); signs.quad(cx + dx * 16.8, 13.5, cz + dy * 16.8, 24, 5, dx ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dy > 0 ? 0 : Math.PI), "#ffffff", this.signUV("neon:" + word)); }
        }
      } else if (t === T.SHOP || t === T.HOME) {
        if (lx === 2 && ly === 2) {
          const isHome = t === T.HOME, col = isHome ? "#dbeafe" : "#f3f4f6";
          bld.box(cx + 16, 13, cz + 16, 62, 26, 62, col, 64, 2);
          props.box(cx + 16, 27, cz + 16, 66, 2, 66, isHome ? "#2563eb" : "#4b5563");
          props.box(cx + 16, 22, cz + 16 + 32.5, 66, 4, 3, isHome ? "#2563eb" : "#b45309");
          glass.box(cx + 16, 6, cz + 16 + 32.2, 22, 12, 0.8, "#ffffff", 32);
          glass.box(cx + 16 - 20, 8, cz + 16 + 32.2, 12, 14, 0.8, "#ffffff", 32); glass.box(cx + 16 + 20, 8, cz + 16 + 32.2, 12, 14, 0.8, "#ffffff", 32);
          glass.box(cx + 16 + 32.2, 8, cz + 16, 0.8, 14, 30, "#ffffff", 32); glass.box(cx + 16 - 32.2, 8, cz + 16, 0.8, 14, 30, "#ffffff", 32);
          const key = isHome ? "home" : "shop:" + w.shops.find(s => s.tx === tx && s.ty === ty).kind;
          signs.quad(cx + 16, 31, cz + 16 + 33.6, 46, 8, 0, "#ffffff", this.signUV(key));
          signs.quad(cx + 16, 31, cz + 16 - 33.6, 46, 8, Math.PI, "#ffffff", this.signUV(key));
          signs.quad(cx + 16 + 33.6, 31, cz + 16, 46, 8, Math.PI / 2, "#ffffff", this.signUV(key));
          signs.quad(cx + 16 - 33.6, 31, cz + 16, 46, 8, -Math.PI / 2, "#ffffff", this.signUV(key));
        }
      }
    }
    const lam = (map, extra) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true, map }, extra || {}));
    this.roads = roads.build(new THREE.MeshPhongMaterial({ vertexColors: true, map: this.tex.asphalt, shininess: 6, specular: new THREE.Color("#1a1a1a") }));
    const groundMeshes = [this.roads, walks.build(lam(this.tex.concrete)), grass.build(lam(this.tex.grass)), sand.build(lam(this.tex.sand))];
    for (const m of groundMeshes) { m.receiveShadow = this.shadows; this.scene.add(m); }
    this.bld = bld.build(new THREE.MeshLambertMaterial({ vertexColors: true, map: this.tex.facade, emissiveMap: this.tex.facadeLit, emissive: new THREE.Color("#000000") }));
    this.bld.castShadow = this.shadows; this.bld.receiveShadow = this.shadows; this.scene.add(this.bld);
    this.glass = glass.build(new THREE.MeshPhongMaterial({ vertexColors: true, map: this.tex.glass, shininess: 80, specular: new THREE.Color("#8899aa"), emissive: new THREE.Color("#000") })); this.scene.add(this.glass);
    this.props = props.build(new THREE.MeshLambertMaterial({ vertexColors: true })); this.props.castShadow = this.shadows; this.props.receiveShadow = this.shadows; this.scene.add(this.props);
    this.bulbs = bulbs.build(new THREE.MeshBasicMaterial({ vertexColors: true })); this.scene.add(this.bulbs);
    this.lampGlow = lampGlow.build(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); this.scene.add(this.lampGlow);
    this.water = water.build(new THREE.MeshPhongMaterial({ vertexColors: true, map: this.tex.water, transparent: true, opacity: 0.92, shininess: 120, specular: new THREE.Color("#ffffff") })); this.scene.add(this.water);
    this.signs = signs.build(new THREE.MeshBasicMaterial({ vertexColors: true, map: this.tex.signs, transparent: true, side: THREE.FrontSide })); this.scene.add(this.signs);
    this.lampPosts = [];
    this.trafficHeads = [];
    for (let ty = 0; ty < CITY; ty += 5) for (let tx = 0; tx < CITY; tx += 5) if (w.get(tx, ty) === T.ROAD) {
      const cx = tx * TILE + 16, cz = ty * TILE + 16;
      this.lampPosts.push({ x: cx - 13 + 6, z: cz - 13 }, { x: cx + 13 + 6, z: cz + 13 });
      this.trafficHeads.push({ x: cx - 13, z: cz + 13, phase: this.hash(tx, ty), ns: true }, { x: cx + 13, z: cz - 13, phase: this.hash(tx, ty), ns: false });
    }
    this.locks = new THREE.Group(); this.scene.add(this.locks);
    this.rebuildLocks();
  }
  tree(b, x, z, cid, h) {
    const s = 0.8 + h * 0.7;
    b.cyl(x, 5 * s, z, 1.2, 1.6, 10 * s, "#6b4f2a", 5);
    b.sphere(x, 13 * s, z, 7 * s, cid === "la" ? "#3f7d2f" : "#2f6b2a", 6);
    b.sphere(x - 2 * s, 16 * s, z - 2 * s, 4 * s, "#5ea34e", 5);
  }
  palm(b, x, z, h) {
    const H = 22 + h * 16;
    b.cyl(x, H / 2, z, 1.1, 1.9, H, "#a0845c", 5);
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + h * 3; const g = new THREE.BoxGeometry(16, 0.7, 3.5); g.translate(8, 0, 0); g.rotateZ(-0.45); g.rotateY(a); g.translate(x, H, z); b.add(g, i % 2 ? "#2f8f3a" : "#3aa347"); }
    b.sphere(x, H - 1, z, 2, "#7c5a1e", 4);
  }
  rebuildLocks() {
    if (!this.locks) return;
    while (this.locks.children.length) this.locks.remove(this.locks.children[0]);
    const q = { ny: [0, 0], fl: [25, 0], chi: [0, 25], la: [25, 25] };
    for (const [id, [tx, ty]] of Object.entries(q)) {
      if (this.game.unlocked.has(id)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(25 * TILE, 240, 25 * TILE), new THREE.MeshBasicMaterial({ color: "#050810", transparent: true, opacity: 0.74 }));
      m.position.set(tx * TILE + 12.5 * TILE, 120, ty * TILE + 12.5 * TILE);
      this.locks.add(m);
      this.locks.add(this.textSprite("🔒 " + CITIES[id].name.toUpperCase() + " — finish the tables before it", "#111827", tx * TILE + 12.5 * TILE, 250, ty * TILE + 12.5 * TILE, 220, 26));
    }
  }
  textSprite(text, bg, x, y, z, w, h) {
    const key = text + bg;
    let tex = this.textures.get(key);
    if (!tex) {
      const c = document.createElement("canvas"); c.width = 512; c.height = 96;
      const ctx = c.getContext("2d");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 96);
      ctx.fillStyle = "#fff"; ctx.font = "bold 44px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 256, 50);
      tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter; this.textures.set(key, tex);
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    sp.position.set(x, y, z); sp.scale.set(w, h, 1); sp.renderOrder = 5;
    return sp;
  }
  buildRain() {
    const n = this.touch ? 500 : 900, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 500; pos[i * 3 + 1] = Math.random() * 300; pos[i * 3 + 2] = (Math.random() - 0.5) * 500; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#c8d6ff", size: 1.4, transparent: true, opacity: 0.5 }));
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
    this.orlySign = this.textSprite("FREE DINNER?", "#facc15", 0, 0, 0, 22, 7); this.orlySign.material.depthTest = true; this.scene.add(this.orlySign);
  }

  // ---------- instanced people and cars ----------
  buildInstances() {
    const lam = () => new THREE.MeshLambertMaterial({ color: "#ffffff" });
    const phong = (sh, sp) => new THREE.MeshPhongMaterial({ color: "#ffffff", shininess: sh, specular: new THREE.Color(sp) });
    const basic = () => new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const P = (geo, mat, max, sh = true) => { const p = new Parts(geo, mat, max, sh && this.shadows); this.scene.add(p.mesh); return p; };
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const pivotTop = new THREE.BoxGeometry(1, 1, 1); pivotTop.translate(0, -0.5, 0);
    const NP = this.touch ? 90 : 140, NV = 60;
    this.I = {
      leg: P(pivotTop, lam(), NP * 2), arm: P(pivotTop, lam(), NP * 2), body: P(unit, lam(), NP), head: P(new THREE.SphereGeometry(1, 8, 7), lam(), NP),
      hair: P(new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), lam(), NP), hat: P(new THREE.CylinderGeometry(1, 1, 1, 8), lam(), NP), brim: P(new THREE.CylinderGeometry(1, 1, 1, 8), lam(), NP),
      umb: P(new THREE.ConeGeometry(1, 1, 8), lam(), NP), pole: P(new THREE.CylinderGeometry(1, 1, 1, 4), lam(), NP), bag: P(unit, lam(), NP),
      dog: P(unit, lam(), 40 * 8),
      carBody: P(unit, phong(70, "#99aabb"), NV), carGlass: P(unit, phong(110, "#bbccdd"), NV * 2), carDark: P(unit, lam(), NV * 6), wheel: P(new THREE.CylinderGeometry(1, 1, 1, 10), lam(), NV * 4),
      carLight: P(unit, basic(), NV * 8, false), shadow: P(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.34, depthWrite: false }), NP + NV + 40, false),
      smoke: P(new THREE.SphereGeometry(1, 5, 5), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.5, depthWrite: false }), 60, false),
      tl: P(new THREE.SphereGeometry(1, 6, 6), basic(), 600, false),
    };
    this.I.shadow.mesh.renderOrder = 1;
  }
  // matrix helpers: parent transform (x, z, yaw, extra rotation) * local (pos, euler, scale)
  part(parent, lx, ly, lz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    this.e.set(rx, ry, rz); this.q.setFromEuler(this.e); this.v3.set(lx, ly, lz); this.s3.set(sx, sy, sz);
    this.m4b.compose(this.v3, this.q, this.s3);
    return this.m4.copy(parent).multiply(this.m4b);
  }
  frame(x, y, z, yaw, tilt = 0) { this.e.set(tilt, -yaw, 0); this.q.setFromEuler(this.e); this.v3.set(x, y, z); this.s3.set(1, 1, 1); return new THREE.Matrix4().compose(this.v3, this.q, this.s3); }
  drawPerson(x, y, z, yaw, p, walkT, o = {}) {
    const I = this.I, sc = o.scale || 1;
    const F = this.frame(x, y, z, yaw, o.stunned ? Math.PI / 2 : 0);
    if (sc !== 1) F.scale(new THREE.Vector3(sc, sc, sc));
    const skin = p.skin || "#e0ac69", shirt = o.orange ? "#f97316" : (p.shirt || "#64748b"), pants = p.pants || "#1f2937";
    const s = o.moving ? Math.sin(walkT * 10) * 0.7 : 0;
    I.leg.add(this.part(F, 0, 7, -1.7, 2.6, 7, 2.6, 0, 0, s), pants); I.leg.add(this.part(F, 0, 7, 1.7, 2.6, 7, 2.6, 0, 0, -s), pants);
    I.body.add(this.part(F, 0, 11, 0, 4.5, 8, 7), shirt);
    I.arm.add(this.part(F, 0, 14.5, -4.8, 2.2, 7.5, 2.2, 0, 0, -s * 0.8), o.chef ? "#f8fafc" : shirt); I.arm.add(this.part(F, 0, 14.5, 4.8, 2.2, 7.5, 2.2, 0, 0, s * 0.8), o.chef ? "#f8fafc" : shirt);
    I.head.add(this.part(F, 0, 18.6, 0, 3.2, 3.2, 3.2), skin);
    if (o.chef) { I.hat.add(this.part(F, 0, 23.5, 0, 2.6, 5, 2.6), "#ffffff"); I.bag.add(this.part(F, 2.6, 10, 0, 1, 7, 5), "#e5e7eb"); }
    else if (o.hat || p.hat) { I.hat.add(this.part(F, 0, 21.6, 0, 3.4, 1.8, 3.4), p.hatColor || "#374151"); I.brim.add(this.part(F, 0, 20.8, 0, 4.6, 0.5, 4.6), "#374151"); }
    else if (p.hairStyle !== 2) { I.hair.add(this.part(F, 0, 18.9, 0, 3.4, 3.4, 3.4), p.hair || "#3f2a1d"); if (p.hairStyle === 1) I.bag.add(this.part(F, -2.4, 16.5, 0, 2.5, 6, 5), p.hair || "#3f2a1d"); }
    if (p.bag && !o.chef) I.bag.add(this.part(F, -1, 9.5, 5.5, 3, 4, 2.5), "#78350f");
    if (o.umbrella) { I.umb.add(this.part(F, 0, 27, 0, 8, 3, 8), shirt); I.pole.add(this.part(F, 0, 20, 0, 0.3, 12, 0.3), "#111111"); }
    if (!o.noShadow) I.shadow.add(this.part(F, 0, 0.35, 0, 6, 1, 6), "#000000");
  }
  drawDog(x, z, yaw, color, t) {
    const I = this.I, F = this.frame(x, 0, z, yaw);
    I.dog.add(this.part(F, 0, 3.5, 0, 7, 3, 3), color); I.dog.add(this.part(F, 4.5, 4.5, 0, 2.8, 2.8, 2.6), color); I.dog.add(this.part(F, -4.2, 4.5, 0, 2.5, 0.8, 0.8, 0, Math.sin(t * 14) * 0.6, 0.5), color);
    for (const [px, pz] of [[-2.5, -1], [-2.5, 1], [2.5, -1], [2.5, 1]]) I.dog.add(this.part(F, px, 1.1, pz, 0.9, 2.2, 0.9), color);
    I.shadow.add(this.part(F, 0, 0.35, 0, 5, 1, 3), "#000000");
  }
  drawVehicle(v, night) {
    const I = this.I, L = v.len, W = v.wid, F = this.frame(v.x, 0, v.y, v.angle), g = this.game;
    const spin = (g.time * v.speed) / 3.2;
    I.shadow.add(this.part(F, 0, 0.3, 0, L / 2 + 2, 1, W / 2 + 2), "#000000");
    if (v.kind === "scooter") {
      I.carBody.add(this.part(F, 0, 4, 0, L, 4, W), v.color);
      for (const x of [-L / 2 + 3, L / 2 - 3]) I.wheel.add(this.part(F, x, 3, 0, 3, 2, 3, Math.PI / 2, 0, spin), "#1f2937");
      I.carDark.add(this.part(F, L / 2 - 4, 9, 0, 1, 1, 10), "#1f2937");
      const rider = v.driver === "player" ? { skin: "#e0ac69", shirt: "#f8fafc", pants: "#1f2937" } : (v.rider || (v.rider = { skin: "#c68642", shirt: "#22c55e", hair: "#1c1917", hairStyle: 0, pants: "#374151" }));
      this.drawPerson(v.x - Math.cos(v.angle) * 2, 3, v.y - Math.sin(v.angle) * 2, v.angle, rider, 0, { scale: 0.8, chef: v.driver === "player", noShadow: true });
      I.carLight.add(this.part(F, L / 2, 6, 0, 0.6, 1.5, 3), night ? "#fff7cc" : "#d6d3c4");
      return;
    }
    const tall = v.kind === "bus" || v.kind === "van" || v.kind === "foodtruck";
    const bh = tall ? 16 : v.kind === "sports" ? 6.5 : 8;
    I.carBody.add(this.part(F, 0, bh / 2 + 3, 0, L, bh, W), v.color);
    I.carDark.add(this.part(F, L / 2 - 0.5, 3.5, 0, 1.6, 2.5, W - 1), "#2a2f3a"); I.carDark.add(this.part(F, -L / 2 + 0.5, 3.5, 0, 1.6, 2.5, W - 1), "#2a2f3a");
    if (!tall) {
      I.carGlass.add(this.part(F, -L * 0.06, bh + 3 + (v.kind === "sports" ? 2.5 : 3.2), 0, L * 0.5, v.kind === "sports" ? 5 : 6.5, W * 0.86), "#5b7ea6");
      I.carBody.add(this.part(F, -L * 0.06, bh + 3 + (v.kind === "sports" ? 5.2 : 6.6), 0, L * 0.42, 0.8, W * 0.8), v.color);
      for (const s of [-1, 1]) I.carDark.add(this.part(F, L * 0.16, bh + 3.5, s * (W / 2 + 1), 1.5, 1, 2), "#2a2f3a");
    } else {
      I.carGlass.add(this.part(F, v.kind === "bus" ? 0 : -4, bh + 3 - 4, 0, L - (v.kind === "bus" ? 6 : 12), 5, W + 0.4), "#5b7ea6");
      I.carGlass.add(this.part(F, L / 2 - 0.3, bh + 3 - 3, 0, 0.6, 8, W - 3), "#5b7ea6");
    }
    for (const [x, z] of [[-L * 0.32, -W / 2], [-L * 0.32, W / 2], [L * 0.32, -W / 2], [L * 0.32, W / 2]]) I.wheel.add(this.part(F, x, 3.2, z, 3.2, 2.2, 3.2, Math.PI / 2, 0, spin), "#1a1d23");
    for (const s of [-1, 1]) {
      I.carLight.add(this.part(F, L / 2 + 0.2, bh / 2 + 3, s * (W / 2 - 2.5), 0.8, 2, 3), night ? "#fff7cc" : "#e8e4d0");
      I.carLight.add(this.part(F, -L / 2 - 0.2, bh / 2 + 3, s * (W / 2 - 2.5), 0.8, 2, 3), v.braking ? "#ff2d2d" : v.reversing ? "#f8fafc" : night ? "#c81e3a" : "#8f1d2c");
    }
    if (v.kind === "taxi") I.carLight.add(this.part(F, -L * 0.06, bh + 11, 0, 7, 2.5, 3), "#fde68a");
    if (v.kind === "rental") I.carDark.add(this.part(F, 0, bh + 3.3, 0, L - 6, 0.4, 4), "#e11d48");
    if (v.kind === "sports") I.carDark.add(this.part(F, 0, bh + 3.2, 0, L - 2, 0.3, 3), "#f8fafc");
    if (v.kind === "foodtruck") { I.carDark.add(this.part(F, -4, 12, W / 2 + 0.2, L * 0.55, 6, 0.6), "#ffffff"); I.carLight.add(this.part(F, -4, 12, W / 2 + 0.6, L * 0.5, 4, 0.3), night ? "#fde68a" : "#f5f5f4"); }
    if (v.kind === "bus") I.carDark.add(this.part(F, 0, 6, 0, L - 4, 2, W + 0.5), "#1d4ed8");
    if (v.kind === "police") {
      I.carDark.add(this.part(F, -L * 0.06, bh + 10.6, 0, 3, 1.5, W * 0.7), "#111111");
      const on = Math.floor(g.time * 8) % 2 === 0;
      I.carLight.add(this.part(F, -L * 0.06, bh + 11.5, -W * 0.18, 2.5, 2, W * 0.3), on ? "#ff3b3b" : "#7f1d1d");
      I.carLight.add(this.part(F, -L * 0.06, bh + 11.5, W * 0.18, 2.5, 2, W * 0.3), on ? "#3b82f6" : "#1e3a8a");
      for (const s of [-1, 1]) I.carDark.add(this.part(F, 0, 6, s * (W / 2 + 0.2), L - 8, 3, 0.4), "#1d4ed8");
    }
    if (v.hp < v.maxHp * 0.35) for (let i = 0; i < 3; i++) I.smoke.add(this.part(F, L / 2 - 2 - i * 5, bh + 6 + i * 4 + Math.sin(g.time * 5 + i) * 1.5, 0, 2 + i, 2 + i, 2 + i), v.dead ? "#4b5563" : "#9ca3af");
  }

  // ---------- frame ----------
  draw() {
    const g = this.game, p = g.player, night = g.nightAmount() > 0.25;
    this.labelUsed = 0;
    const dt = 1 / 60;
    this.updateCamera(dt);
    this.updateEnvironment(dt);
    const camT = this.camLook, cull = this.touch ? 560 : 820;
    const near = (x, z) => Math.hypot(x - camT.x, z - camT.z) < cull;

    for (const v of [...g.vehicles, ...g.police]) {
      if (!near(v.x, v.y)) continue;
      this.drawVehicle(v, night);
      if (v.honk) this.label(v.x, 20, v.y, HONK_LINES[Math.floor(this.hash(Math.round(v.x), Math.round(v.y)) * HONK_LINES.length)], "lbl");
      if (v.honk && v.honkT < 1.5) v.honk = false;
    }
    for (const pd of g.peds) {
      if (!near(pd.x, pd.y)) continue;
      const moving = pd.state === "walk" || pd.state === "flee" || pd.state === "angry";
      this.drawPerson(pd.x, 0, pd.y, pd.angle, pd, pd.walkT * (pd.state === "walk" ? 1 : 2), { moving, stunned: pd.state === "stunned", umbrella: g.weather.rain && pd.umbrella && pd.state !== "flee" && pd.state !== "stunned" });
      if (pd.dog) this.drawDog(pd.dog.x, pd.dog.y, pd.dog.angle, pd.dog.color, pd.dog.t);
      if (pd.say) this.label(pd.x, 26, pd.y, pd.say, "lbl");
      else {
        const dd = dist(pd, p);
        if (dd < 70 && pd.hungry) this.label(pd.x, 26, pd.y, "🍴", "lbl plate");
        if (pd.hailing && p.vehicle && p.vehicle.kind === "taxi" && !g.fare && dd < 260 && pd.state === "walk") this.label(pd.x, 26, pd.y, "🖐 " + HAIL_LINES[Math.floor(this.hash(Math.round(pd.x), 3) * HAIL_LINES.length)], "lbl");
      }
    }
    for (const s of g.strangers) {
      if (!near(s.x, s.y)) continue;
      this.drawPerson(s.x, Math.sin(s.t * 3) * 0.6, s.y, s.angle, s, s.t, { orange: true });
      this.label(s.x, 27, s.y, s.plate.icon + (dist(s, p) < 140 ? " " + s.plate.name : ""), "lbl plate");
    }
    this.spotBeam.visible = false; this.spotCone.visible = false;
    if (g.spot && g.step) {
      const s = g.spot, look = g.spotLook, nearP = dist(p, s) < 120;
      this.spotBeam.visible = true; this.spotBeam.position.set(s.x, 45, s.y);
      this.spotCone.visible = true; this.spotCone.position.set(s.x, 34 + Math.sin(g.time * 3) * 2, s.y); this.spotCone.rotation.y = g.time * 2;
      look.figures.forEach((f, i) => {
        const fx = s.x + f.dx, fz = s.y + f.dy;
        const a = nearP ? Math.atan2(p.y - fz, p.x - fx) : f.angle + Math.sin(g.time * 0.7 + i) * 0.3;
        this.drawPerson(fx, 0, fz, a, f, g.time + i, { hat: f.hat });
        if (f.dog) this.drawDog(fx + 10, fz + 8, a, f.dogColor, g.time);
      });
      const icon = g.step === "cook" ? "🍳 " : g.step === "shop" ? "⏳ " : "❗ ";
      this.label(s.x, 52, s.y, icon + g.ep.name, "lbl name");
      if (nearP) this.label(s.x, 44, s.y, g.ep.who, "lbl sub");
    }
    this.orlySign.visible = !p.vehicle;
    if (!p.vehicle) {
      const moving = g.input.down("up") || g.input.down("down") || g.input.down("left") || g.input.down("right");
      this.drawPerson(p.x, 0, p.y, p.angle, { skin: "#e0ac69", shirt: "#f8fafc", pants: "#1f2937" }, p.walkT, { chef: true, moving: moving && p.stun <= 0, stunned: p.stun > 0 });
      const o = g.orly;
      const om = Math.hypot(o.x - (p.x - Math.cos(p.angle) * 16), o.y - (p.y - Math.sin(p.angle) * 16)) > 7;
      this.drawPerson(o.x, 0, o.y, o.angle, { skin: "#f1c9a5", shirt: "#1e3a8a", pants: "#374151", hair: "#d6b370", hairStyle: 0 }, o.walkT || 0, { moving: om, umbrella: g.weather.rain });
      this.I.pole.add(this.part(this.frame(o.x, 0, o.y, o.angle), 2, 20, 5, 0.4, 14, 0.4), "#b45309");
      this.orlySign.position.set(o.x + Math.cos(o.angle) * 2 - Math.sin(o.angle) * 5, 29, o.y + Math.sin(o.angle) * 2 + Math.cos(o.angle) * 5);
    }
    // traffic lights
    for (const h of this.trafficHeads) {
      if (Math.abs(h.x - camT.x) > cull || Math.abs(h.z - camT.z) > cull) continue;
      const ph = (g.time * 0.12 + h.phase) % 1, nsGreen = ph < 0.45, amber = (ph > 0.45 && ph < 0.5) || ph > 0.95;
      const green = h.ns ? nsGreen : !nsGreen;
      const F = this.frame(h.x, 0, h.z, 0);
      this.I.tl.add(this.part(F, 0, 25, 1.9, 0.9, 0.9, 0.9), !green && !amber ? "#ff3b3b" : "#3a1414");
      this.I.tl.add(this.part(F, 0, 22, 1.9, 0.9, 0.9, 0.9), amber ? "#ffb020" : "#3a2a10");
      this.I.tl.add(this.part(F, 0, 19, 1.9, 0.9, 0.9, 0.9), green && !amber ? "#22e07a" : "#0f3a20");
    }
    for (const k in this.I) this.I[k].end();

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
    for (let i = this.labelUsed; i < this.labelPool.length; i++) this.labelPool[i].style.display = "none";
    this.gl.render(this.scene, this.camera);
    this.drawMinimap();
  }
  updateCamera(dt) {
    const g = this.game, p = g.player, v = p.vehicle;
    const moving = g.input.down("up") || g.input.down("down") || g.input.down("left") || g.input.down("right");
    let wantYaw = v ? v.angle : (moving && p.stun <= 0 ? p.angle : this.camYaw);
    if (v && v.speed < -10) wantYaw = this.camYaw;
    const d = wrapAngle(wantYaw - this.camYaw);
    this.camYaw += d * Math.min(1, (v ? 4.5 : 3.5) * dt);
    const modes = [{ dist: v ? 118 : 78, h: v ? 46 : 34, ahead: v ? 46 : 36 }, { dist: 180, h: 140, ahead: 30 }, { dist: 40, h: 330, ahead: 10 }][this.camMode];
    const px = p.x, pz = p.y, w = g.world;
    const blocks = (x, z) => { const t = w.get(Math.floor(x / TILE), Math.floor(z / TILE)); return t === T.BUILDING || t === T.SHOP || t === T.HOME || t === T.GARAGE; };
    let cd = modes.dist, ch = modes.h;
    if (this.camMode < 2) for (let s = 14; s <= modes.dist; s += 5) {
      if (blocks(px - Math.cos(this.camYaw) * s, pz - Math.sin(this.camYaw) * s)) { cd = Math.max(16, s - 10); ch = modes.h + (modes.dist - cd) * 0.55; break; }
    }
    this._want.set(px - Math.cos(this.camYaw) * cd, ch, pz - Math.sin(this.camYaw) * cd);
    this._look.set(px + Math.cos(this.camYaw) * modes.ahead, 8, pz + Math.sin(this.camYaw) * modes.ahead);
    if (!this.camInit) { this.camInit = true; this.camPos.copy(this._want); this.camLook.copy(this._look); }
    this.camPos.lerp(this._want, Math.min(1, (cd < modes.dist ? 12 : 6) * dt));
    this.camLook.lerp(this._look, Math.min(1, 8 * dt));
    let sx = 0, sy = 0;
    if (g.shake > 0) { sx = (Math.random() - 0.5) * 5; sy = (Math.random() - 0.5) * 5; g.shake -= dt; }
    this.camera.position.set(this.camPos.x + sx, Math.max(this.camPos.y, 12), this.camPos.z + sy);
    this.camera.lookAt(this.camLook);
    const fov = 55 + (v ? Math.min(14, Math.abs(v.speed) / 24) : 0);
    if (Math.abs(this.camera.fov - fov) > 0.2) { this.camera.fov += (fov - this.camera.fov) * 0.1; this.camera.updateProjectionMatrix(); }
    this.sky.position.copy(this.camera.position); this.stars.position.copy(this.camera.position);
  }
  updateEnvironment(dt) {
    const g = this.game, rain = g.weather.rain, humid = g.city === "fl" || g.city === "la";
    const t = (g.time % DAY_LENGTH) / DAY_LENGTH, ang = t * Math.PI * 2, elev = Math.sin(ang);
    const sunDir = new THREE.Vector3(Math.cos(ang), elev, 0.35).normalize();
    const key = (elev * 100 | 0) + ":" + rain + ":" + humid;
    if (key !== this.envKey) {
      this.envKey = key;
      const day = Math.max(0, Math.min(1, elev * 2.2)), dusk = Math.max(0, 1 - Math.abs(elev) * 5), night = Math.max(0, Math.min(1, -elev * 3));
      const c = (a, b, k) => new THREE.Color(a).lerp(new THREE.Color(b), k);
      let top = c("#1a3f7a", rain ? "#5b6b85" : "#2f7fd6", day).lerp(new THREE.Color("#3a2a5a"), dusk * 0.6).lerp(new THREE.Color("#04071a"), night);
      let hor = c("#6d6f93", rain ? "#9aa5b5" : "#cfe6ff", day).lerp(new THREE.Color("#ff9a5c"), dusk * 0.85).lerp(new THREE.Color("#0b1230"), night);
      const haze = (humid ? 0.75 : 0.5) + (rain ? 0.25 : 0);
      this.skyU.top.value.copy(top); this.skyU.horizon.value.copy(hor); this.skyU.haze.value = haze;
      this.skyU.sunCol.value.copy(c("#ff8a3d", "#fff4d6", Math.min(1, elev * 3)));
      this.scene.fog.color.copy(hor); this.scene.fog.near = rain ? 220 : humid ? 320 : 420; this.scene.fog.far = rain ? 900 : humid ? 1150 : 1400;
      this.sun.color.copy(c("#ff9a4a", "#fff3d9", Math.min(1, elev * 2.5)));
      this.sun.intensity = Math.max(0, Math.pow(Math.max(0, elev), 0.6)) * (rain ? 0.6 : 1.5);
      this.moon.intensity = night * 0.22;
      this.hemi.color.copy(hor).lerp(new THREE.Color("#ffffff"), 0.3); this.hemi.groundColor.set(night > 0.5 ? "#1a1a24" : "#6b5a48"); this.hemi.intensity = 0.55 * (1 - night * 0.6) * (rain ? 0.8 : 1);
      this.amb.intensity = 0.18 * (1 - night * 0.4);
      this.gl.toneMappingExposure = 1.05 - night * 0.2 + dusk * 0.05;
      const glow = Math.max(0, night * 1.3 + dusk * 0.5 + (rain ? 0.25 : 0));
      this.bld.material.emissive.setRGB(glow, glow * 0.85, glow * 0.6);
      this.glass.material.emissive.setRGB(glow * 0.25, glow * 0.22, glow * 0.16);
      this.bulbs.material.color.copy(c("#d1d5db", "#fff1b8", Math.min(1, glow))); this.lampGlow.material.opacity = Math.min(0.55, glow * 0.45);
      this.stars.material.opacity = night * 0.9;
      this.roads.material.shininess = rain ? 90 : 6; this.roads.material.specular.set(rain ? "#9aa4b0" : "#1a1a1a"); this.roads.material.color.set(rain ? "#7a8290" : "#ffffff");
      this.water.material.opacity = rain ? 0.96 : 0.92;
      this.rain.visible = rain;
      for (const s of this.clouds.children) { s.material.opacity = rain ? 0.95 : 0.8 * (0.4 + day * 0.6); s.material.color.copy(c("#aab4c8", "#ffffff", day).lerp(new THREE.Color("#ffb08a"), dusk * 0.5)); }
    }
    this.skyU.sunDir.value.copy(sunDir);
    const p = g.player;
    this.sun.position.set(p.x + sunDir.x * 900, Math.max(80, sunDir.y * 900), p.y + sunDir.z * 900); this.sun.target.position.set(p.x, 0, p.y);
    if (this.shadows) { this.sun.shadow.camera.updateProjectionMatrix(); }
    for (const s of this.clouds.children) { s.position.x += s.userData.v * dt; if (s.position.x > this.camera.position.x + 1600) s.position.x -= 3200; if (s.position.x < this.camera.position.x - 1600) s.position.x += 3200; }
    this.water.material.map.offset.x = (g.time * 0.012) % 1; this.water.material.map.offset.y = (g.time * 0.007) % 1;
    this.lightT -= dt;
    if (this.lightT <= 0) {
      this.lightT = 0.4;
      const posts = this.lampPosts.map(l => ({ l, d: Math.hypot(l.x - p.x, l.z - p.y) })).sort((a, b) => a.d - b.d).slice(0, this.streetLights.length);
      posts.forEach((o, i) => this.streetLights[i].position.set(o.l.x, 24, o.l.z));
    }
    const n = g.nightAmount();
    for (const l of this.streetLights) l.intensity = n > 0.15 ? 1.6 * n : 0;
    const v = p.vehicle;
    for (let i = 0; i < 2; i++) {
      const h = this.headlights[i];
      if (v && n > 0.12 && v.kind !== "scooter") {
        const s = i === 0 ? -1 : 1;
        h.intensity = 1.8 * Math.min(1, n * 1.5);
        h.position.set(v.x + Math.cos(v.angle) * v.len / 2 + Math.cos(v.angle + Math.PI / 2) * s * v.wid * 0.35, 8, v.y + Math.sin(v.angle) * v.len / 2 + Math.sin(v.angle + Math.PI / 2) * s * v.wid * 0.35);
        h.target.position.set(v.x + Math.cos(v.angle) * 220, 0, v.y + Math.sin(v.angle) * 220);
      } else h.intensity = 0;
    }
    if (rain) {
      const pos = this.rain.geometry.attributes.position, c = this.camLook;
      this.rain.position.set(c.x, 0, c.z);
      for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) - 380 * dt; if (y < 0) y += 300; pos.setY(i, y); }
      pos.needsUpdate = true;
    }
  }
  label(x, y, z, text, cls) {
    const v = this.v3.set(x, y, z).project(this.camera);
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
