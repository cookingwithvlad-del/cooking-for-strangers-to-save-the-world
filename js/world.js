function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function cityOfTile(tx, ty) {
  return tx < 25 ? (ty < 25 ? "ny" : "chi") : (ty < 25 ? "fl" : "la");
}

const CITY_BLOCKS = {
  ny:  { home: [2, 2], shops: { produce: [1, 3], meat: [3, 1], pantry: [3, 3] } },
  fl:  { home: [7, 2], shops: { produce: [6, 1], meat: [8, 3], pantry: [6, 3] } },
  chi: { home: [2, 7], shops: { produce: [3, 6], meat: [1, 8], pantry: [3, 8] } },
  la:  { home: [7, 7], shops: { produce: [8, 6], meat: [6, 8], pantry: [8, 8] } },
};
const PARK_BLOCKS = [[0, 1], [4, 4], [4, 0], [5, 0], [9, 3], [5, 4], [0, 9], [4, 6], [0, 5], [6, 5], [9, 9], [9, 6]];

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

  const shops = [];
  const homes = {};
  const homeBlocks = new Set();
  for (const [city, cfg] of Object.entries(CITY_BLOCKS)) {
    for (const [kind, [bx, by]] of Object.entries(cfg.shops)) {
      fillBlock(bx, by, T.SHOP, true);
      shops.push({ city, kind, x: (bx * 5 + 3) * TILE, y: (by * 5 + 3) * TILE, tx: bx * 5 + 2, ty: by * 5 + 2 });
    }
    const [hx, hy] = cfg.home;
    fillBlock(hx, hy, T.HOME, true);
    homeBlocks.add(hx + "," + hy);
    homes[city] = {
      city,
      x: (hx * 5 + 3) * TILE, y: (hy * 5 + 3) * TILE,
      spawn: { x: (hx * 5 + 1) * TILE + TILE / 2, y: (hy * 5 + 3) * TILE },
      door:  { x: (hx * 5 + 4) * TILE + TILE / 2, y: (hy * 5 + 3) * TILE },
      car:   { x: hx * 5 * TILE + TILE / 2 - 7, y: (hy * 5 + 3) * TILE, angle: Math.PI / 2 },
    };
  }

  const anchors = { ny: [], fl: [], chi: [], la: [] };
  const roadTiles = [];
  for (let y = 0; y < CITY; y++) for (let x = 0; x < CITY; x++) {
    const t = tiles[idx(x, y)];
    if (t === T.ROAD) roadTiles.push({ tx: x, ty: y });
    if (t === T.SIDEWALK && !homeBlocks.has(Math.floor(x / 5) + "," + Math.floor(y / 5)))
      anchors[cityOfTile(x, y)].push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, city: cityOfTile(x, y) });
  }
  for (const k in anchors) {
    const a = anchors[k];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  }

  const get = (tx, ty) => (tx < 0 || ty < 0 || tx >= CITY || ty >= CITY) ? -1 : tiles[idx(tx, ty)];
  const world = {
    tiles, get, rng, shops, homes, anchors, roadTiles,
    unlocked: new Set(["ny"]),
    tileAt(px, py) { return get(Math.floor(px / TILE), Math.floor(py / TILE)); },
    isLockedTile(tx, ty) { return !world.unlocked.has(cityOfTile(tx, ty)); },
    lockedAt(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      return get(tx, ty) !== -1 && world.isLockedTile(tx, ty);
    },
    solidFoot(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      const t = get(tx, ty);
      return t === -1 || t === T.BUILDING || world.isLockedTile(tx, ty);
    },
    solidCar(px, py) {
      const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
      const t = get(tx, ty);
      return t === -1 || t === T.BUILDING || t === T.SHOP || t === T.HOME || world.isLockedTile(tx, ty);
    },
    episodeSpot(ep, i) {
      if (ep.home) return homes[ep.city].door;
      const list = anchors[ep.city];
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
