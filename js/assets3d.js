// Loads the Blender-built assets (assets/3d/*) for the 3D renderer. Everything is optional:
// whatever fails to load, the renderer keeps its primitive fallback for.
var Assets3D = window.Assets3D = {
  ready: false, vehicles: {}, person: null, props: {}, tex: {}, sky: {},
  src(path) { return (window.ASSET_DATA && window.ASSET_DATA[path]) || path; },
  load(onDone) {
    if (!window.THREE || !THREE.GLTFLoader) { onDone && onDone(this); return; }
    const gltf = new THREE.GLTFLoader(), texl = new THREE.TextureLoader();
    const jobs = [];
    const glb = (path, cb) => jobs.push(new Promise(res => gltf.load(this.src(path), g => { try { cb(this.parts(g.scene)); } catch (e) { console.warn(path, e); } res(); }, undefined, e => { console.warn("asset missing:", path); res(); })));
    const tex = (key, path, linear) => jobs.push(new Promise(res => texl.load(this.src(path), t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.encoding = linear ? THREE.LinearEncoding : THREE.sRGBEncoding; this.tex[key] = t; res(); }, undefined, () => res())));
    for (const k of ["sedan", "sports", "van", "foodtruck", "bus", "taxi", "police", "rental", "scooter"]) glb("assets/3d/vehicles/" + k + ".glb", p => { this.vehicles[k] = p; });
    glb("assets/3d/person.glb", p => { this.person = p; });
    glb("assets/3d/props.glb", p => { this.props = this.groupProps(p); });
    for (const [k, f, lin] of [["facadeColor", "facade_color.jpg"], ["facadeNormal", "facade_normal.jpg", true], ["facadeEmissive", "facade_emissive.jpg"], ["facadeRough", "facade_rough.jpg", true],
      ["asphaltColor", "asphalt_color.jpg"], ["asphaltNormal", "asphalt_normal.jpg", true], ["asphaltRough", "asphalt_rough.jpg", true],
      ["concreteColor", "concrete_color.jpg"], ["concreteNormal", "concrete_normal.jpg", true], ["grassColor", "grass_color.jpg"], ["grassNormal", "grass_normal.jpg", true],
      ["sandColor", "sand_color.jpg"], ["sandNormal", "sand_normal.jpg", true], ["waterNormal", "water_normal.jpg", true]]) tex(k, "assets/3d/tex/" + f, lin);
    for (const k of ["morning", "noon", "dusk", "night"]) jobs.push(new Promise(res => texl.load(this.src("assets/3d/sky/" + k + ".jpg"), t => { t.mapping = THREE.EquirectangularReflectionMapping; t.encoding = THREE.sRGBEncoding; this.sky[k] = t; res(); }, undefined, () => res())));
    Promise.all(jobs).then(() => { this.ready = true; onDone && onDone(this); });
  },
  // Flatten a glTF scene into { name: BufferGeometry } with node transforms baked in.
  parts(scene) {
    const out = {};
    scene.updateMatrixWorld(true);
    scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      out[o.name] = g;
    });
    return out;
  },
  // "tree.leaves.001" -> props.tree.leaves (merged); keeps one geometry per prop part.
  groupProps(parts) {
    const groups = {};
    for (const [name, g] of Object.entries(parts)) {
      const m = name.match(/^([a-z]+)_([a-z]+)/); if (!m) continue;
      (groups[m[1]] = groups[m[1]] || {})[m[2]] = (groups[m[1]][m[2]] || []).concat([g]);
    }
    const merged = {};
    for (const [prop, ps] of Object.entries(groups)) {
      merged[prop] = {};
      for (const [part, list] of Object.entries(ps)) merged[prop][part] = list.length === 1 ? list[0].index ? list[0].toNonIndexed() : list[0] : this.merge(list);
    }
    return merged;
  },
  merge(list) {
    const pos = [], nrm = [];
    for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; pos.push(...g.attributes.position.array); nrm.push(...g.attributes.normal.array); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    return g;
  },
};
