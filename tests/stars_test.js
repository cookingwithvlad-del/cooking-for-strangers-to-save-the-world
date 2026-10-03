// Stars for served tables: the thresholds match the cooking result labels.
import { assertEquals } from "jsr:@std/assert@1";

const source = Deno.readTextFileSync(new URL("../js/story.js", import.meta.url));
const G = new Function(source + "\nreturn { EPISODES, starsFor, isCookedTable, MAX_STARS };")();

Deno.test("cooking quality maps to one, two or three stars", () => {
  assertEquals([0, 0.3, 0.59, 0.6, 0.94, 0.95, 1].map(G.starsFor), [1, 1, 1, 2, 2, 3, 3]);
});

Deno.test("only cooked tables count toward the star total", () => {
  const cooked = G.EPISODES.filter(G.isCookedTable);
  assertEquals(cooked.some(ep => ep.type === "visit"), false);
  assertEquals(G.MAX_STARS, cooked.length * 3);
});
