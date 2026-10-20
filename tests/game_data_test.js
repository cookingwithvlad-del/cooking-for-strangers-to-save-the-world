// Smoke tests for the game's data and world generation. The game runs as plain
// <script> files sharing globals, so this loads the pure-data ones the same way
// (one shared scope, in index.html order) and checks they hold together.
import { assert, assertEquals } from "jsr:@std/assert@1";

const FILES = ["constants", "story", "people", "world"];
const NAMES = ["T", "TILE", "CITIES", "CITY_ORDER", "SHOPS", "ING", "EPISODES", "PLATES", "SIGN_LINES", "cookCue", "makePerson", "buildWorld"];
const root = new URL("../js/", import.meta.url);
const source = FILES.map(f => Deno.readTextFileSync(new URL(f + ".js", root))).join("\n;\n");
const G = new Function(source + `\nreturn { ${NAMES.join(", ")} };`)();

Deno.test("every episode is in a known city and can be shopped for", () => {
  assert(G.EPISODES.length > 0);
  const ids = new Set();
  for (const ep of G.EPISODES) {
    assert(!ids.has(ep.id), `duplicate episode id ${ep.id}`);
    ids.add(ep.id);
    assert(G.CITIES[ep.city], `${ep.id}: unknown city ${ep.city}`);
    assert(ep.mood === "invited" || G.SIGN_LINES[ep.mood], `${ep.id}: unknown mood ${ep.mood}`);
    // "visit" episodes are tables where someone else cooked: no dishes, no shopping
    if (ep.type === "visit") continue;
    assert(ep.dishes?.length > 0, `${ep.id}: no dishes`);
    for (const ing of ep.shop) assert(G.ING[ing], `${ep.id}: unknown ingredient ${ing}`);
  }
});

Deno.test("episodes run through the cities in order", () => {
  const order = G.EPISODES.map(ep => G.CITY_ORDER.indexOf(ep.city));
  for (let i = 1; i < order.length; i++) assert(order[i] >= order[i - 1], `${G.EPISODES[i].id} is out of city order`);
  assertEquals(new Set(G.EPISODES.map(ep => ep.city)).size, G.CITY_ORDER.length);
});

Deno.test("every ingredient is sold somewhere and every plate can be made", () => {
  for (const [id, ing] of Object.entries(G.ING)) {
    assert(G.SHOPS[ing.shop], `${id}: unknown shop ${ing.shop}`);
    assert(ing.price > 0, `${id}: bad price`);
  }
  for (const plate of G.PLATES) for (const ing of plate.ing) assert(G.ING[ing], `${plate.id}: unknown ingredient ${ing}`);
});

Deno.test("every dish gets a cooking cue", () => {
  for (const ep of G.EPISODES) for (const dish of ep.dishes || []) assert(G.cookCue(dish).length > 0);
});

Deno.test("the world has a home, garage and all three shops in each city", () => {
  const world = G.buildWorld();
  for (const city of G.CITY_ORDER) {
    assert(world.homes[city], `${city}: no home kitchen`);
    assert(world.garages.some(g => g.city === city), `${city}: no garage`);
    assert(world.anchors[city].length > 0, `${city}: nowhere for people to stand`);
    for (const kind of Object.keys(G.SHOPS)) {
      assert(world.shops.some(s => s.city === city && s.kind === kind), `${city}: no ${kind} shop`);
    }
  }
  G.EPISODES.forEach((ep, i) => assert(world.episodeSpot(ep, i), `${ep.id}: nowhere to stand`));
});

Deno.test("the world is the same every time for the same seed", () => {
  assertEquals(G.buildWorld(7).tiles, G.buildWorld(7).tiles);
});

Deno.test("generated people have a name and a job", () => {
  const world = G.buildWorld();
  for (const city of G.CITY_ORDER) {
    const p = G.makePerson(world.rng, city);
    assert(p.name && p.job, `${city}: incomplete person`);
  }
});
