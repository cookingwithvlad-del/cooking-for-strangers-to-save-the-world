function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function cityOfTile(tx, ty) {
  return tx < 25 ? (ty < 25 ? "ny" : "chi") : (ty < 25 ? "fl" : "la");
}

const CITY_BLOCKS = {
  ny:  { home: [2, 2], garage: [1, 1], shops: { produce: [1, 3], meat: [3, 1], pantry: [3, 3] } },
  fl:  { home: [7, 2], garage: [8, 1], shops: { produce: [6, 1], meat: [8, 3], pantry: [6, 3] } },
  chi: { home: [2, 7], garage: [1, 6], shops: { produce: [3, 6], meat: [1, 8], pantry: [3, 8] } },
  la:  { home: [7, 7], garage: [6, 6], shops: { produce: [8, 6], meat: [6, 8], pantry: [8, 8] } },
};
const PARK_BLOCKS = [[0, 1], [4, 4], [4, 0], [5, 0], [9, 3], [5, 4], [0, 9], [4, 6], [0, 5], [6, 5], [9, 9], [9, 6], [2, 4], [7, 5], [5, 7]];
const RIVER = [23, 27];

function buildWorld(seed = 20240918) {
  const rng = makeRng(seed);
  const tiles = new Uint8Array(CITY * CITY);
  const idx = (x, y) => y * CITY + x;
  for (let y = 0; y < CITY; y++) for (let x = 0; x < CITY; x++) {
    let t;
    if (x % 5 === 0 || y % 5 === 0) t = T.ROAD;
    else {
      const lx = x % 5, ly = y % 5;
      t = (lx === 1 || lx === 4 || ly === 1 || ly === 4) ? T.SIDEWALK : T.BUILDING;
    }
    tiles[idx(x, y)] = t;
  }
  const fillBlock = (bx, by, type, innerOnly) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      if (innerOnly && !(x >= 1 && x <= 2 && y >= 1 && y <= 2)) continue;
      tiles[idx(bx * 5 + 1 + x, by * 5 + 1 + y)] = type;
    }
  };
  for (const [bx, by] of PARK_BLOCKS) fillBlock(bx, by, T.PARK, false);

  // Two rivers split the four cities; every fifth road crosses them on a bridge.
  const inRiver = v => v >= RIVER[0] && v <= RIVER[1];
  for (let y = 0; y < CITY; y++) for (let x = 0; x < CITY; x++) {
    if (!inRiver(x) && !inRiver(y)) continue;
    const bridge = (inRiver(x) && y % 5 === 0) || (inRiver(y) && x % 5 === 0);
    tiles[idx(x, y)] = bridge ? T.BRIDGE : T.WATER;
  }
  // Miami Beach on Florida's east edge, Venice on LA's south edge.
  for (let y = 0; y < 23; y++) { tiles[idx(46, y)] = y % 5 === 0 ? T.ROAD : T.SIDEWALK; tiles[idx(47, y)] = T.SAND; tiles[idx(48, y)] = T.SAND; tiles[idx(49, y)] = T.WATER; }
  for (let x = 28; x < CITY; x++) { tiles[idx(x, 46)] = x % 5 === 0 ? T.ROAD : T.SIDEWALK; tiles[idx(x, 47)] = T.SAND; tiles[idx(x, 48)] = T.SAND; tiles[idx(x, 49)] = T.WATER; }
  // Buildings that touch water become a promenade.
  const solidTypes = [T.BUILDING];
  for (let y = 0; y < CITY; y++) for (let x = 0; x < CITY; x++) {
    if (!solidTypes.includes(tiles[idx(x, y)])) continue;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= CITY || ny >= CITY) continue;
      const n = tiles[idx(nx, ny)];
      if (n === T.WATER || n === T.SAND) { tiles[idx(x, y)] = T.SIDEWALK; break; }
    }
  }

  const shops = [], garages = [];
  const homes = {};
  const specialBlocks = new Set();
  for (const [city, cfg] of Object.entries(CITY_BLOCKS)) {
    for (const [kind, [bx, by]] of Object.entries(cfg.shops)) {
      fillBlock(bx, by, T.SHOP, true);
      shops.push({ city, kind, x: (bx * 5 + 3) * TILE, y: (by * 5 + 3) * TILE, tx: bx * 5 + 2, ty: by * 5 + 2 });
    }
    const [gx, gy] = cfg.garage;
    fillBlock(gx, gy, T.GARAGE, true);
    garages.push({ city, x: (gx * 5 + 3) * TILE, y: (gy * 5 + 3) * TILE, tx: gx * 5 + 2, ty: gy * 5 + 2 });
    specialBlocks.add(gx + "," + gy);
    const [hx, hy] = cfg.home;
    fillBlock(hx, hy, T.HOME, true);
    specialBlocks.add(hx + "," + hy);
    const roadX = hx * 5 * TILE + TILE / 2 - 7;
    homes[city] = {
      city,
      x: (hx * 5 + 3) * TILE, y: (hy * 5 + 3) * TILE,
      spawn: { x: (hx * 5 + 1) * TILE + TILE / 2, y: (hy * 5 + 3) * TILE },
      door:  { x: (hx * 5 + 4) * TILE + TILE / 2, y: (hy * 5 + 3) * TILE },
      car:   { x: roadX, y: (hy * 5 + 3) * TILE, angle: Math.PI / 2 },
      parking: [
        { x: roadX, y: (hy * 5 + 3) * TILE, angle: Math.PI / 2 },
        { x: roadX, y: (hy * 5 + 1.6) * TILE, angle: Math.PI / 2 },
        { x: (hx * 5 + 5) * TILE + TILE / 2 + 7, y: (hy * 5 + 3) * TILE, angle: -Math.PI / 2 },
        { x: (hx * 5 + 5) * TILE + TILE / 2 + 7, y: (hy * 5 + 1.6) * TILE, angle: -Math.PI / 2 },
      ],
    };
  }

  const anchors = { ny: [], fl: [], chi: [], la: [] };
  const waterside = { ny: [], fl: [], chi: [], la: [] };
  const parks = { ny: [], fl: [], chi: [], la: [] };
  const roadTiles = [];
  const get = (tx, ty) => (tx < 0 || ty < 0 || tx >= CITY || ty >= CITY) ? -1 : tiles[idx(tx, ty)];
  const isRoadT = t => t === T.ROAD || t === T.BRIDGE;
  const nearWater = (x, y) => DIRS.some(([dx, dy]) => { const n = get(x + dx, y + dy); return n === T.WATER || n === T.SAND; });
  for (let y = 0; y < CITY; y++) for (let x = 0; x < CITY; x++) {
    const t = tiles[idx(x, y)], c = cityOfTile(x, y);
    if (t === T.ROAD) roadTiles.push({ tx: x, ty: y });
    const p = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, city: c };
    if ((t === T.SIDEWALK || t === T.SAND) && !specialBlocks.has(Math.floor(x / 5) + "," + Math.floor(y / 5))) {
      anchors[c].push(p);
      if (nearWater(x, y) || t === T.SAND) waterside[c].push(p);
    }
    if (t === T.PARK) parks[c].push(p);
  }
  for (const set of [anchors, waterside, parks]) for (const k in set) {
    const a = set[k];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  }

  const world = {
    tiles, get, rng, shops, garages, homes, anchors, waterside, parks, roadTiles,
    unlocked: new Set(["ny"]),
    isRoad(tx, ty) { return isRoadT(get(tx, ty)); },
    tileAt(px, py) { return get(Math.floor(px / TILE), Math.floor(py / TILE)); },
    isLockedTile(tx, ty) { return !world.unlocked.has(cityOfTile(tx, ty)); },
    lockedAt(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      return get(tx, ty) !== -1 && world.isLockedTile(tx, ty);
    },
    solidFoot(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      const t = get(tx, ty);
      return t === -1 || t === T.BUILDING || t === T.WATER || world.isLockedTile(tx, ty);
    },
    solidCar(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      const t = get(tx, ty);
      return t === -1 || t === T.BUILDING || t === T.SHOP || t === T.HOME || world.isLockedTile(tx, ty);
    },
    solidPolice(px, py) { return world.solidCar(px, py) || world.tileAt(px, py) === T.WATER; },
    walkScore(tx, ty) {
      const t = get(tx, ty);
      if (t === T.SIDEWALK || t === T.PARK || t === T.SAND) return 4;
      if (t === T.ROAD || t === T.BRIDGE || t === T.GARAGE) return 1;
      return 0;
    },
    episodeSpot(ep, i) {
      if (ep.home) return homes[ep.city].door;
      const text = (ep.who + " " + ep.hook + " " + ep.place).toLowerCase();
      let list = anchors[ep.city];
      if (/bridge|boardwalk|beach|bayfront|venice|water/.test(text) && waterside[ep.city].length) list = waterside[ep.city];
      else if (/park|bench|grape/.test(text) && parks[ep.city].length) list = parks[ep.city];
      return list[(i * 7 + 3) % list.length];
    },
    randomAnchor(city) {
      const list = anchors[city];
      return list[Math.floor(rng() * list.length)];
    },
    randomRoadTile(city) {
      for (let i = 0; i < 200; i++) {
        const t = roadTiles[Math.floor(rng() * roadTiles.length)];
        if (!city || cityOfTile(t.tx, t.ty) === city) return t;
      }
      return roadTiles[0];
    },
  };
  return world;
}
