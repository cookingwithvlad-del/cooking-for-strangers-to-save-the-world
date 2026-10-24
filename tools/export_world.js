#!/usr/bin/env node
// Exports the game's procedural world for other engines (see unreal/).
//
// The game runs as plain <script> files sharing globals, so this evaluates the
// pure-data ones in one scope (the same way tests/game_data_test.js does), builds
// the world with the game's seed, and writes every placement the 3D renderer
// derives from it: tiles, buildings with their facade style/height/tint, street
// props, shops, homes, garages, parking, episode spots and where the named
// characters stand. Coordinates are game units (TILE = 32 per block tile), x to
// the east, y to the south, angles in radians with 0 = +x.
//
//   node tools/export_world.js                 # -> unreal/Content/Data/world.json
//   node tools/export_world.js out/world.json
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const FILES = ["constants", "story", "people", "world"];
const NAMES = ["T", "TILE", "CITY", "WORLD", "DIRS", "CITIES", "CITY_ORDER", "SHOPS", "EPISODES", "buildWorld", "cityOfTile", "tileHash", "FACADE_TINTS", "facadeStyle", "blockHeight"];
const source = FILES.map(f => fs.readFileSync(path.join(root, "js", f + ".js"), "utf8")).join("\n;\n");
const G = new Function(source + `\nreturn { ${NAMES.join(", ")} };`)();
const { T, TILE, CITY, CITIES, SHOPS, EPISODES, cityOfTile, tileHash: hash, FACADE_TINTS: TINTS, facadeStyle: styleOf, blockHeight } = G;

const mix = (a, b, t) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = i => Math.round(((pa >> i) & 255) * (1 - t) + ((pb >> i) & 255) * t); return "#" + [16, 8, 0].map(i => c(i).toString(16).padStart(2, "0")).join(""); };

const w = G.buildWorld();
const TYPE_NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k.toLowerCase()]));

const tiles = [];
for (let ty = 0; ty < CITY; ty++) { const row = []; for (let tx = 0; tx < CITY; tx++) row.push(w.get(tx, ty)); tiles.push(row); }

const buildings = [], props = [], storefronts = [];
const prop = (kind, x, y, s = 1, rot = 0, extra = {}) => props.push({ kind, x: +x.toFixed(1), y: +y.toFixed(1), s: +s.toFixed(2), rot: +rot.toFixed(3), ...extra });
for (let ty = 0; ty < CITY; ty++) for (let tx = 0; tx < CITY; tx++) {
  const t = w.get(tx, ty), cx = tx * TILE + 16, cy = ty * TILE + 16, cid = cityOfTile(tx, ty), h = hash(tx, ty);
  const lx = tx % 5, ly = ty % 5, warm = cid === "fl" || cid === "la";
  if (t === T.BUILDING) {
    const bx = Math.floor(tx / 5), by = Math.floor(ty / 5);
    const hh = blockHeight(bx, by) + (hash(tx * 5, ty * 3) < 0.3 ? 14 : 0);
    const style = styleOf(bx, by, cid, hh);
    let tint;
    if (style === "brick") tint = mix("#ffffff", CITIES[cid].color, 0.35);
    else { const pal = TINTS[style]; tint = pal[Math.floor(hash(bx * 7 + 2, by * 3 + 11) * pal.length)]; }
    buildings.push({ tx, ty, x: cx, y: cy, w: TILE, h: hh, style, tint, city: cid, roof: style === "glass" || style === "concrete" ? "#4b5563" : CITIES[cid].roof });
  } else if (t === T.SIDEWALK) {
    if (h < 0.05) prop("trash", cx, cy, 0.8, h * 6);
    else if (h < 0.09) prop("bench", cx, cy, 1, 0);
    else if (h < 0.16) { if (warm) prop("palm", cx, cy, 0.9 + h * 0.5, h * 6.28); else prop("tree", cx, cy, (0.8 + h * 0.7) * 0.95, h * 6.28, { leaves: cid === "la" ? "#3f7d2f" : "#2f6b2a" }); }
    else if (h < 0.19) prop("hydrant", cx, cy, 0.8, 0);
    else if (h < 0.22 && cid === "ny") prop("mailbox", cx, cy, 1, 0);
    else if (h < 0.25) prop("firebox", cx, cy, 1, 0);
    for (const [dx, dy] of G.DIRS) if (w.get(tx + dx, ty + dy) === T.ROAD && hash(tx + 11, ty + 17) < 0.25) prop("lamp", cx + dx * 12, cy + dy * 12, 1, Math.atan2(dy, dx));
  } else if (t === T.PARK) {
    if (h < 0.45) { const px = cx + (h - 0.2) * 20, py = cy + hash(ty, tx) * 16 - 8; if (warm && h < 0.2) prop("palm", px, py, 0.9 + h * 0.5, h * 6.28); else prop("tree", px, py, (0.8 + h * 0.7) * 0.95, h * 6.28, { leaves: cid === "la" ? "#3f7d2f" : "#2f6b2a" }); }
    else if (h < 0.52) prop("bench", cx, cy, 1, 0);
    else if (h < 0.58) prop("fountain", cx, cy, 1, 0);
    else if (h < 0.62) prop("plaza", cx, cy, 1, 0);
  } else if (t === T.SAND) {
    if (h < 0.08) prop("umbrella", cx, cy, 1, 0, { color: h < 0.04 ? "#ef4444" : "#3b82f6" });
    else if (h < 0.14) prop("towel", cx, cy, 1, 0);
    else if (h < 0.2) prop("palm", cx, cy, 0.9 + h * 0.5, h * 6.28);
  } else if ((t === T.SHOP || t === T.HOME || t === T.GARAGE) && lx === 2 && ly === 2) {
    const kind = t === T.HOME ? "home" : t === T.GARAGE ? "garage" : "shop:" + w.shops.find(s => s.tx === tx && s.ty === ty).kind;
    storefronts.push({ kind, city: cid, x: cx + 16, y: cy + 16, w: 62, h: 26, color: t === T.HOME ? "#dbeafe" : t === T.GARAGE ? "#6b7280" : "#f3f4f6", trim: t === T.HOME ? "#2563eb" : t === T.GARAGE ? "#fbbf24" : "#b45309" });
  }
  if (t === T.ROAD && (tx % 5 === 0) !== (ty % 5 === 0)) {
    // traffic lights at the approaches to every intersection, like the renderer
    if ((tx % 5 === 0 && (ly === 1 || ly === 4)) || (ty % 5 === 0 && (lx === 1 || lx === 4))) prop("trafficlight", cx + (tx % 5 === 0 ? 14 : 0), cy + (ty % 5 === 0 ? 14 : 0), 1, tx % 5 === 0 ? Math.PI / 2 : 0);
  }
}

const episodes = EPISODES.map((ep, i) => { const s = w.episodeSpot(ep, i); return { n: ep.n, id: ep.id, name: ep.name, city: ep.city, who: ep.who, place: ep.place, covers: ep.covers, home: !!ep.home, x: s.x, y: s.y }; });

const heroes = [];
for (const city of G.CITY_ORDER) {
  const hm = w.homes[city];
  heroes.push({ id: "anthony", city, x: hm.door.x + 28, y: hm.door.y + 44, angle: -Math.PI / 2, pose: "idle" });
}
if (w.parks.ny.length) { const a = w.parks.ny[2] || w.parks.ny[0]; heroes.push({ id: "jeanphil", city: "ny", x: a.x, y: a.y, angle: -Math.PI / 2, pose: "box" }); }
if (w.parks.chi.length) { const a = w.parks.chi[1] || w.parks.chi[0]; heroes.push({ id: "alex", city: "chi", x: a.x, y: a.y, angle: Math.PI / 2, pose: "dj" }); }
heroes.push({ id: "vlad", city: "ny", x: w.homes.ny.spawn.x, y: w.homes.ny.spawn.y, angle: 0, pose: "idle", player: true });
heroes.push({ id: "orly", city: "ny", x: w.homes.ny.spawn.x - 14, y: w.homes.ny.spawn.y + 10, angle: 0, pose: "idle" });

const vehicles = [];
for (const city of G.CITY_ORDER) {
  const hm = w.homes[city];
  vehicles.push({ kind: "rental", city, x: hm.car.x, y: hm.car.y, angle: hm.car.angle, player: city === "ny" });
  hm.parking.slice(1).forEach((p, i) => vehicles.push({ kind: ["sedan", "van", "sports"][i % 3], city, x: p.x, y: p.y, angle: p.angle }));
}
// a dozen parked cars per city along quiet roads, deterministic
const KINDS = ["sedan", "sedan", "taxi", "van", "sports", "bus", "scooter"];
for (const city of G.CITY_ORDER) {
  let n = 0;
  for (const rt of w.roadTiles) {
    if (n >= 12 || cityOfTile(rt.tx, rt.ty) !== city) continue;
    const vertical = rt.tx % 5 === 0 && rt.ty % 5 !== 0, horizontal = rt.ty % 5 === 0 && rt.tx % 5 !== 0;
    if (!vertical && !horizontal) continue;
    const r = hash(rt.tx + 101, rt.ty + 7);
    if (r > 0.08) continue;
    const side = hash(rt.ty + 3, rt.tx + 5) < 0.5 ? -1 : 1;
    const x = rt.tx * TILE + 16 + (vertical ? side * 10 : 0), y = rt.ty * TILE + 16 + (horizontal ? side * 10 : 0);
    vehicles.push({ kind: KINDS[Math.floor(r * 100) % KINDS.length], city, x, y, angle: vertical ? Math.PI / 2 : 0, parked: true });
    n++;
  }
}

const out = {
  meta: { game: "Cooking for Strangers to Save the World", tile: TILE, size: CITY, world: TILE * CITY, seed: 20240918, units: "game units; x east, y south; 1 tile = 32 units", exported: new Date().toISOString(), tileTypes: TYPE_NAMES },
  cities: Object.fromEntries(Object.entries(CITIES).map(([k, c]) => [k, { name: c.name, short: c.short, part: c.part, tagline: c.tagline, color: c.color, roof: c.roof, accent: c.accent, quadrant: c.quadrant }])),
  tiles,
  buildings, storefronts, props,
  shops: w.shops.map(s => ({ ...s, name: SHOPS[s.kind] && SHOPS[s.kind].name })),
  garages: w.garages,
  homes: w.homes,
  episodes, heroes, vehicles,
  playerStart: { x: w.homes.ny.spawn.x, y: w.homes.ny.spawn.y, angle: 0 },
};

const dest = process.argv[2] || path.join(root, "unreal", "Content", "Data", "world.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
const count = (k) => out[k].length;
console.log(`wrote ${path.relative(root, dest)}: ${count("buildings")} buildings, ${count("storefronts")} storefronts, ${count("props")} props, ${count("episodes")} episodes, ${count("heroes")} characters, ${count("vehicles")} vehicles, ${Math.round(fs.statSync(dest).size / 1024)} KB`);
