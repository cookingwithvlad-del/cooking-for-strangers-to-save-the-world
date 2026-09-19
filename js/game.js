class Game {
  constructor(canvas, ui, input) {
    this.canvas = canvas; this.ui = ui; this.input = input;
    this.world = buildWorld();
    this.renderer = new Renderer(canvas, this);
    this.state = "title";
    this.initState();
    ui.bind(this);
  }

  get ep() { return EPISODES[this.episodeIdx]; }
  get level() { return Math.min(MAX_LEVEL, 1 + Math.floor(this.trust / TRUST_PER_LEVEL)); }
  get city() { return cityOfTile(Math.floor(this.player.x / TILE), Math.floor(this.player.y / TILE)); }
  nightAmount() { const t = (this.time % DAY_LENGTH) / DAY_LENGTH; return Math.max(0, 0.5 - 0.5 * Math.cos(t * Math.PI * 2)) ** 1.5; }
  clockText() { const h = Math.floor(6 + (this.time % DAY_LENGTH) / DAY_LENGTH * 24) % 24; return (h % 12 || 12) + (h < 12 ? "am" : "pm"); }

  initState() {
    const w = this.world;
    this.cash = START_CASH; this.trust = 0; this.fed = 0; this.heat = 0; this.time = 0;
    this.freeze = 0; this.shake = 0; this.signCooldown = 0; this.lockToastT = 0; this.hornT = 0;
    this.inventory = {}; this.plates = [];
    this.episodeIdx = 0; this.done = new Set(); this.step = null; this.spot = null; this.spotLook = { figures: [] };
    this.unlocked = new Set(["ny"]); w.unlocked = this.unlocked;
    this.stats = { earned: 0, splashed: 0, busted: 0, perfect: 0, plates: 0, fares: 0, fed_street: 0, carjacks: 0, swims: 0 };
    this.player = new Player(w.homes.ny.spawn.x, w.homes.ny.spawn.y);
    this.orly = { x: this.player.x - 18, y: this.player.y + 12, angle: 0, walkT: 0 };
    this.vehicles = []; this.peds = []; this.strangers = []; this.police = []; this.cars = {};
    this.owned = []; this.fare = null; this.skids = []; this.weather = { rain: false, t: 40 + w.rng() * 80 };
    this.radioOn = true; this.respawnQueue = []; this.cook = null;
    this.spawnHomeVehicles("ny");
    this.spawnTraffic(16); this.spawnPeds(60); this.spawnStrangers("ny");
    this.setEpisode(0);
    this.renderer.invalidateMap();
  }

  newGame() {
    clearSave();
    this.initState();
    this.state = "play"; this.ui.hideAll();
    this.ui.banner("PART ONE", CITIES.ny.tagline, 3500);
    setTimeout(() => { if (this.state === "play") this.openEpisodeCard(); }, 1800);
  }
  continueGame() {
    const d = readSave();
    if (!d) return this.newGame();
    this.initState();
    Object.assign(this, { cash: d.cash, trust: d.trust, fed: d.fed, time: d.time || 0, inventory: d.inventory || {}, plates: d.plates || [] });
    this.stats = Object.assign(this.stats, d.stats || {});
    this.done = new Set(d.done || []);
    this.owned = d.owned || [];
    this.radioOn = d.radioOn !== false; radio.set(d.radioStation || 0);
    this.unlocked = new Set(d.unlocked || ["ny"]); this.world.unlocked = this.unlocked;
    this.vehicles = this.vehicles.filter(v => v.kind !== "rental"); this.cars = {};
    for (const c of this.unlocked) { this.spawnHomeVehicles(c); if (c !== "ny") { this.spawnStrangers(c); this.spawnTraffic(6, c); } }
    this.setEpisode(Math.min(d.episodeIdx || 0, EPISODES.length - 1));
    if (d.accepted) this.step = this.ep.type === "visit" ? "visit" : "shop";
    if (this.done.has(this.ep.id)) this.step = null;
    this.checkShopStep(true);
    if (d.px != null) { this.player.x = d.px; this.player.y = d.py; this.orly.x = d.px - 18; this.orly.y = d.py + 12; }
    this.renderer.invalidateMap();
    this.state = "play"; this.ui.hideAll();
    this.ui.toast("Welcome back, Chef. " + (this.step ? this.ep.name + " is waiting." : "The city is still hungry."));
  }
  saveGame(announce) {
    const ok = writeSave({
      cash: this.cash, trust: this.trust, fed: this.fed, time: this.time, inventory: this.inventory, plates: this.plates,
      stats: this.stats, done: [...this.done], unlocked: [...this.unlocked], episodeIdx: this.episodeIdx,
      accepted: this.step !== "approach", px: this.player.vehicle ? this.world.homes[this.city].spawn.x : this.player.x, py: this.player.vehicle ? this.world.homes[this.city].spawn.y : this.player.y,
      owned: this.owned, radioOn: this.radioOn, radioStation: radio.index(),
    });
    if (announce) this.ui.toast(ok ? "Saved." : "Couldn't save (storage blocked).");
  }
  restart() { radio.stop(); this.newGame(); }
  toTitle() { this.saveGame(false); radio.stop(); this.state = "title"; this.ui.showTitle(hasSave()); }

  // ---------- spawning ----------
  randomUnlockedCity() { const a = [...this.unlocked]; return a[Math.floor(this.world.rng() * a.length)]; }
  spawnHomeVehicles(city) {
    const h = this.world.homes[city];
    const list = [{ kind: "rental" }, ...this.owned.filter(o => o.city === city)];
    list.slice(0, h.parking.length).forEach((o, i) => {
      const slot = h.parking[i];
      const v = new Vehicle(o.kind, slot.x, slot.y, slot.angle, this.world.rng);
      v.city = city; v.owned = o.kind !== "rental";
      if (o.kind === "rental") { v.name = "The Rental (" + CITIES[city].short + ")"; this.cars[city] = v; }
      v.speedBonus = (this.level - 1) * 18;
      this.vehicles.push(v);
    });
  }
  spawnTraffic(n, city) { for (let i = 0; i < n; i++) this.spawnCar(city); }
  spawnCar(city) {
    const w = this.world;
    for (let tries = 0; tries < 30; tries++) {
      const t = w.randomRoadTile(city || this.randomUnlockedCity());
      const opts = [0, 1, 2, 3].filter(d => { const [dx, dy] = DIRS[d]; return w.isRoad(t.tx + dx, t.ty + dy) && !w.isLockedTile(t.tx + dx, t.ty + dy); });
      if (!opts.length) continue;
      const v = new Vehicle(pickTrafficKind(w.rng), 0, 0, 0, w.rng);
      v.ai = true;
      v.placeOnRoad(t.tx, t.ty, opts[Math.floor(w.rng() * opts.length)]);
      if (dist(v, this.player) < 160) continue;
      this.vehicles.push(v); return v;
    }
    return null;
  }
  spawnPeds(n) { for (let i = 0; i < n; i++) this.spawnPed(); }
  spawnPed(city, near) {
    const w = this.world, c = city || this.randomUnlockedCity();
    let a = null;
    for (let t = 0; t < 12; t++) { const cand = w.randomAnchor(c); const d = dist(cand, this.player); if (!near || (d > 350 && d < 900)) { a = cand; break; } }
    if (!a) a = w.randomAnchor(c);
    const pd = new Ped(a.x + (w.rng() - 0.5) * 10, a.y + (w.rng() - 0.5) * 10, w.rng, c);
    this.peds.push(pd);
    if (w.rng() < 0.12) {
      const mate = new Ped(a.x + 14, a.y + 2, w.rng, c);
      mate.dog = null; pd.state = "chat"; mate.state = "chat"; pd.partner = mate; mate.partner = pd;
      pd.timer = 6 + w.rng() * 10; mate.timer = pd.timer;
      this.peds.push(mate);
    }
    return pd;
  }
  spawnStrangers(city) { for (let i = 0; i < 3; i++) this.spawnStranger(city); }
  spawnStranger(city) {
    const w = this.world;
    for (let tries = 0; tries < 40; tries++) {
      const a = w.randomAnchor(city);
      if (this.spot && dist(a, this.spot) < 140) continue;
      if (this.strangers.some(s => dist(s, a) < 200)) continue;
      if (dist(a, this.player) < 120) continue;
      const plate = PLATES[Math.floor(w.rng() * PLATES.length)];
      this.strangers.push(new Stranger(a.x, a.y, city, plate, w.rng));
      return;
    }
  }
  spawnPolice() {
    const w = this.world;
    for (let tries = 0; tries < 40; tries++) {
      const t = w.randomRoadTile(this.city);
      const x = t.tx * TILE + TILE / 2, y = t.ty * TILE + TILE / 2;
      const d = Math.hypot(x - this.player.x, y - this.player.y);
      if (d < 420 || d > 950) continue;
      const v = new Vehicle("police", x, y, w.rng() * 6.28, w.rng);
      v.name = CITIES[this.city].police;
      this.police.push(v); return;
    }
  }

  // ---------- episodes ----------
  setEpisode(idx) {
    this.episodeIdx = idx;
    const ep = this.ep;
    this.spot = this.world.episodeSpot(ep, idx);
    this.step = ep.mood === "invited" ? (ep.type === "visit" ? "visit" : "shop") : "approach";
    this.buildSpotLook(ep);
    this.checkShopStep(true);
  }
  buildSpotLook(ep) {
    const rng = makeRng(1000 + ep.n * 31);
    const text = (ep.name + " " + ep.who + " " + ep.hook).toLowerCase();
    const group = / and |couple|boys|family|grandparents|students|crew|staff/.test(text);
    const n = ep.home ? 0 : group ? (ep.covers >= 4 ? 3 : 2) : 1;
    const figures = [];
    for (let i = 0; i < n; i++) {
      const f = makePerson(rng, ep.city);
      f.hungry = false; f.hailing = false;
      f.dx = n === 1 ? 0 : Math.cos(i / n * 6.28) * 12; f.dy = n === 1 ? 0 : Math.sin(i / n * 6.28) * 12;
      f.angle = n === 1 ? -Math.PI / 2 : Math.atan2(-f.dy, -f.dx);
      f.dog = i === 0 && /dog/.test(text); f.dogColor = DOG_COLORS[Math.floor(rng() * DOG_COLORS.length)];
      f.hat = /rabbi|chef|trotter/.test(text) || f.hat;
      figures.push(f);
    }
    this.spotLook = { figures };
  }
  openEpisodeCard() { this.openModal("episode", this.ui.episodeCard(this.ep, this)); }
  missingIngredients() { return this.ep.shop ? this.ep.shop.filter(i => !(this.inventory[i] > 0)) : []; }
  shopHasMissing(kind) { return this.missingIngredients().some(i => ING[i].shop === kind); }
  checkShopStep(silent) {
    if (this.step === "shop" && this.missingIngredients().length === 0) {
      this.step = "cook";
      if (!silent) { this.ui.toast("That's everything on the list. Now go cook for " + this.ep.name + "."); sfx.good(); }
    }
  }
  objectiveTarget() {
    if (this.fare) return this.fare.dest;
    if (!this.step) return null;
    if (this.step === "shop") {
      let best = null, bd = 1e9;
      for (const s of this.world.shops) {
        if (!this.unlocked.has(s.city) || !this.shopHasMissing(s.kind)) continue;
        const d = dist(s, this.player);
        if (d < bd) { bd = d; best = s; }
      }
      return best || this.spot;
    }
    return this.spot;
  }
  objectiveHtml() {
    if (this.fare) {
      const d = Math.round(dist(this.player, this.fare.dest) / 10) * 10;
      return `<div class="obj-k">TAXI FARE</div><div>${esc(this.fare.ped.name)} → ${esc(this.fare.where)} · ${d}m · $${this.fare.pay}</div>`;
    }
    const ep = this.ep, name = esc(ep.name);
    if (!this.step) return `<div class="obj-k">AFTERWORD</div><div>All sixty-eight tables served. The streets stay open — keep feeding strangers (🟠), talk to anyone, drive anything.</div>`;
    let line;
    if (this.step === "approach") line = `Find <b>${name}</b> — ${esc(ep.who)}. Hold up the sign.`;
    else if (this.step === "visit") line = `Go and see <b>${name}</b>.`;
    else if (this.step === "shop") {
      const miss = this.missingIngredients().map(i => `${SHOPS[ING[i].shop].icon} ${esc(ING[i].name)}`).join(", ");
      line = `Shopping for <b>${name}</b>: ${miss}`;
    } else if (this.step === "cook") line = `Cook for <b>${name}</b> ${ep.home ? "at the Home Kitchen" : "at their place"}.`;
    else line = "";
    return `<div class="obj-k">EPISODE ${ep.n} · ${esc(ep.place)}</div><div>${line}</div>`;
  }

  signChoice(right) {
    const ep = this.ep;
    if (right) {
      sfx.chime();
      this.ui.toast(`${ep.name}: "${ACCEPTS[Math.floor(Math.random() * ACCEPTS.length)]}"`, 4000);
      this.trust += 4;
      if (ep.type === "visit") { this.closeModal(); this.completeEpisode(1); return; }
      this.step = "shop"; this.checkShopStep(true);
      this.openModal("episode", this.ui.episodeCard(ep, this));
    } else {
      sfx.no();
      this.trust = Math.max(0, this.trust - 5);
      this.signCooldown = 6;
      this.ui.toast(`${ep.name}: "${REFUSALS[Math.floor(Math.random() * REFUSALS.length)]}" — give it a moment and try a different line.`, 4000);
      this.closeModal();
    }
  }
  openSign() {
    const lines = SIGN_LINES[this.ep.mood];
    const options = [{ text: lines.right, right: true }, ...lines.wrong.map(t => ({ text: t, right: false }))];
    for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
    this.signOptions = options;
    this.openModal("sign", this.ui.signHtml(this.ep, options));
  }

  startEpisodeCook() {
    const ep = this.ep;
    const dishes = (ep.dishes || []).slice(0, 4);
    this.beginCook("episode", `Cooking for ${ep.name}`, dishes.map(d => ({ dish: d, cue: cookCue(d) })));
  }
  startPlate(id) {
    const plate = PLATES.find(p => p.id === id);
    if (!plate || !plate.ing.every(i => (this.inventory[i] || 0) > 0)) return;
    this.cookPlate = plate;
    this.beginCook("plate", plate.name, [{ dish: plate.name, cue: cookCue(plate.name) }]);
  }
  beginCook(kind, title, rounds) {
    this.cook = { kind, rounds, round: 0, results: [], pos: 0, dir: 1, speed: 0.85, zone: this.newZone(0.24), done: false, resultT: 0 };
    this.openModal("cook", this.ui.cookHtml(this, title, this.cook));
    this.ui.updateCook(this.cook);
  }
  newZone(w) { return { c: 0.15 + Math.random() * 0.7, w }; }
  cookTap() { if (this.cook && !this.cook.done) this.cook.tap = true; }
  updateCook(dt) {
    const c = this.cook;
    if (c.done) { c.resultT -= dt; if (c.resultT <= 0) this.finishCook(); return; }
    c.pos += c.dir * c.speed * dt;
    if (c.pos > 1) { c.pos = 2 - c.pos; c.dir = -1; }
    if (c.pos < 0) { c.pos = -c.pos; c.dir = 1; }
    if (this.input.pressed("space") || c.tap) {
      c.tap = false;
      const d = Math.abs(c.pos - c.zone.c);
      const score = d <= c.zone.w / 2 ? 1 : d <= c.zone.w / 2 + 0.1 ? 0.5 : 0;
      c.results.push(score);
      score >= 1 ? sfx.good() : score > 0 ? sfx.tick() : sfx.bad();
      c.round++;
      if (c.round >= c.rounds.length) {
        c.done = true; c.resultT = 1.7;
        const q = c.results.reduce((a, b) => a + b, 0) / c.results.length;
        c.quality = q;
        const label = q >= 0.95 ? "Perfect service." : q >= 0.6 ? "Good. They're happy." : q >= 0.3 ? "Rough, but it's dinner." : "Burnt. They ate it anyway.";
        this.ui.cookResult(label, c.kind === "episode" ? "Plates go to the table." : "Into the bag.");
      } else { c.zone = this.newZone(Math.max(0.14, c.zone.w - 0.03)); c.speed += 0.28; }
    }
    this.ui.updateCook(c);
  }
  finishCook() {
    const c = this.cook; this.cook = null;
    this.closeModal();
    if (c.kind === "plate") {
      for (const i of this.cookPlate.ing) this.inventory[i]--;
      this.plates.push({ id: this.cookPlate.id, q: c.quality });
      this.stats.plates++;
      this.ui.toast(`${this.cookPlate.icon} ${this.cookPlate.name} is in the bag. Hand it to anyone who's hungry (🍴 or 🟠).`);
    } else this.completeEpisode(c.quality);
  }
  completeEpisode(q) {
    const ep = this.ep;
    let cost = 0;
    if (ep.shop) for (const i of ep.shop) { this.inventory[i] = Math.max(0, (this.inventory[i] || 0) - 1); cost += ING[i].price; }
    const tip = Math.round((12 + ep.covers * 2.2) * (0.4 + q));
    const earned = Math.round(cost * 1.15 + tip);
    this.cash += earned; this.stats.earned += earned;
    const trustGain = Math.round((ep.covers >= 10 ? 26 : 13) * (0.6 + 0.4 * q));
    this.trust += trustGain;
    this.fed += ep.covers;
    if (q >= 0.95) this.stats.perfect++;
    this.done.add(ep.id);
    sfx.cash();
    this.ui.toast(`Table ${ep.n} served: ${ep.name}, ${ep.covers} ${ep.covers === 1 ? "person" : "people"} fed. +$${earned} · +${trustGain} trust.`, 4500);
    for (const v of this.vehicles) if (v.kind === "rental" || v.owned) v.speedBonus = (this.level - 1) * 18;
    const next = this.episodeIdx + 1;
    if (next >= EPISODES.length) {
      this.step = null;
      this.saveGame(false);
      this.state = "over"; this.ui.open("win", this.ui.winHtml(this));
      return;
    }
    const nextEp = EPISODES[next];
    this.setEpisode(next);
    if (!this.unlocked.has(nextEp.city)) this.unlockCity(nextEp.city);
    else setTimeout(() => { if (this.state === "play") this.openEpisodeCard(); }, 900);
    this.saveGame(false);
  }
  unlockCity(city) {
    this.unlocked.add(city);
    this.spawnHomeVehicles(city); this.spawnStrangers(city); this.spawnTraffic(6, city);
    for (let i = 0; i < 12; i++) this.spawnPed(city);
    this.renderer.invalidateMap();
    sfx.unlockCity();
    const c = CITIES[city];
    const dirs = { fl: "east, over the bridge", chi: "south, over the bridge", la: "east across the river" };
    this.ui.banner(c.name.toUpperCase() + " UNLOCKED", `${c.part} — ${c.tagline}`, 4500);
    setTimeout(() => { if (this.state === "play") { this.ui.toast(`Drive ${dirs[city] || "on"}. A new Home Kitchen and a fresh rental are waiting in ${c.name}.`, 6000); this.openEpisodeCard(); } }, 2200);
  }

  // ---------- modals / state ----------
  openModal(kind, html) { this.state = "modal"; this.modalKind = kind; this.ui.open(kind, html); if (kind === "map") this.renderer.drawBigMap(document.getElementById("bigmap")); }
  closeModal() {
    if (this.state === "over") { this.state = "play"; this.step = null; this.ui.close(); return; }
    this.cook = null; this.ui.close(); this.state = "play";
  }
  pause() { this.state = "paused"; this.ui.open("pause", this.ui.pauseHtml(this)); }
  resume() { this.ui.close(); this.state = "play"; }
  openJournal() { this.openModal("journal", this.ui.journalHtml(this)); }
  openMap() { this.openModal("map", this.ui.mapHtml()); }
  openPhone(tab) { this.phoneTab = tab || this.phoneTab || "jobs"; this.openModal("phone", this.ui.phoneHtml(this, this.phoneTab)); }
  openShop(shop) { this.openModal("shop", this.ui.shopHtml(this, shop)); this.currentShop = shop; }
  buy(id) {
    const i = ING[id];
    if (!i || this.cash < i.price) { sfx.no(); return; }
    this.cash -= i.price; this.inventory[id] = (this.inventory[id] || 0) + 1; sfx.cash();
    this.ui.open("shop", this.ui.shopHtml(this, this.currentShop));
    this.checkShopStep(false);
  }
  buyNeeded(kind) {
    for (const id of this.missingIngredients()) {
      if (ING[id].shop !== kind) continue;
      if (this.cash < ING[id].price) { this.ui.toast("Not enough cash for all of it."); break; }
      this.cash -= ING[id].price; this.inventory[id] = (this.inventory[id] || 0) + 1;
    }
    sfx.cash();
    this.ui.open("shop", this.ui.shopHtml(this, this.currentShop));
    this.checkShopStep(false);
  }
  buyVehicle(kind) {
    const spec = VEHICLE_SPECS[kind];
    if (!spec || !spec.price) return;
    if (this.cash < spec.price) { sfx.no(); this.ui.toast(`You need $${spec.price} for the ${spec.name}.`); return; }
    const city = this.nearestHomeCity();
    const taken = 1 + this.owned.filter(o => o.city === city).length;
    if (taken >= this.world.homes[city].parking.length) { this.ui.toast("No parking left at this Home Kitchen. Buy in another city."); return; }
    this.cash -= spec.price; this.owned.push({ kind, city });
    const slot = this.world.homes[city].parking[taken];
    const v = new Vehicle(kind, slot.x, slot.y, slot.angle, this.world.rng);
    v.city = city; v.owned = true; v.speedBonus = (this.level - 1) * 18;
    this.vehicles.push(v);
    sfx.cash(); this.saveGame(false);
    this.ui.toast(`${spec.name} bought. It's parked outside the ${CITIES[city].name} Home Kitchen.`);
    this.openPhone("garage");
  }
  nearestHomeCity() {
    let best = "ny", bd = 1e9;
    for (const h of Object.values(this.world.homes)) { if (!this.unlocked.has(h.city)) continue; const d = dist(h, this.player); if (d < bd) { bd = d; best = h.city; } }
    return best;
  }
  setRadio(i) { radio.set(i); this.radioOn = true; if (this.player.vehicle) radio.start(); this.ui.toast(`📻 ${radio.station.name} — ${radio.station.tag}`); if (this.modalKind === "phone") this.openPhone("radio"); }
  toggleRadio() { this.radioOn = !this.radioOn; if (this.radioOn && this.player.vehicle) radio.start(); else radio.stop(); this.ui.toast(this.radioOn ? "📻 Radio on" : "📻 Radio off"); if (this.modalKind === "phone") this.openPhone("radio"); }

  // ---------- update ----------
  update(dt) {
    dt = Math.min(dt, 0.05);
    const inp = this.input;
    if (this.state === "title" || this.state === "over") return;
    if (this.state === "modal") {
      if (this.cook) this.updateCook(dt);
      else if (inp.pressed("pause") || (this.modalKind === "journal" && inp.pressed("book")) || (this.modalKind === "map" && inp.pressed("map")) || (this.modalKind === "phone" && inp.pressed("phone"))) this.closeModal();
      else if (this.modalKind === "sign") {
        const k = inp.pressed("opt1") ? 0 : inp.pressed("opt2") ? 1 : inp.pressed("opt3") ? 2 : -1;
        if (k >= 0 && this.signOptions[k]) this.signChoice(this.signOptions[k].right);
      } else if (this.modalKind === "episode" && (inp.pressed("act") || inp.pressed("space"))) this.closeModal();
      return;
    }
    if (this.state === "paused") { if (inp.pressed("pause")) this.resume(); return; }
    if (inp.pressed("pause")) return this.pause();
    if (inp.pressed("book")) return this.openJournal();
    if (inp.pressed("map")) return this.openMap();
    if (inp.pressed("phone")) return this.openPhone();
    if (inp.pressed("radio")) { if (this.player.vehicle) { this.setRadio(radio.index() + 1); } else this.ui.toast("The radio's in the car."); }
    if (inp.pressed("horn")) this.honk();
    this.time += dt;
    if (this.signCooldown > 0) this.signCooldown -= dt;
    if (this.lockToastT > 0) this.lockToastT -= dt;
    if (this.hornT > 0) this.hornT -= dt;
    this.updateWeather(dt);
    if (this.freeze > 0) this.freeze -= dt; else this.updatePlayer(dt);
    this.updateOrly(dt);
    this.updateTraffic(dt);
    this.updatePeds(dt);
    this.updateStrangers(dt);
    this.updatePolice(dt);
    this.updateFare();
    for (let i = this.skids.length - 1; i >= 0; i--) { this.skids[i].life -= dt; if (this.skids[i].life <= 0) this.skids.splice(i, 1); }
    this.updateContext();
    this.ui.hud(this);
  }
  updateWeather(dt) {
    const w = this.weather;
    w.t -= dt;
    if (w.t <= 0) {
      w.rain = !w.rain && this.world.rng() < 0.45;
      w.t = w.rain ? 40 + this.world.rng() * 50 : 60 + this.world.rng() * 120;
      if (w.rain) this.ui.toast("🌧 Rain. The roads are slick and the sidewalks empty out.");
    }
  }
  honk() {
    const v = this.player.vehicle;
    if (!v || this.hornT > 0) return;
    this.hornT = 0.6; sfx.horn();
    for (const pd of this.peds) if (dist(pd, v) < 110 && pd.state === "walk") { pd.state = "flee"; pd.timer = 1.5; }
  }

  updatePlayer(dt) {
    const p = this.player, w = this.world, inp = this.input;
    if (p.stun > 0) { p.stun -= dt; if (p.stun <= 0) this.lockToastT = 0; return; }
    if (p.vehicle) {
      const v = p.vehicle;
      const hit = v.updatePlayer(dt, inp, w.solidCar, this.weather.rain);
      if (hit === "hard") { sfx.bump(); this.shake = 0.25; }
      if (hit) this.lockCheck(v.x + Math.cos(v.angle) * (v.r + 12), v.y + Math.sin(v.angle) * (v.r + 12));
      if (v.skidding) for (const s of [-1, 1]) this.skids.push({ x: v.x - Math.cos(v.angle) * v.len * 0.35 + Math.cos(v.angle + Math.PI / 2) * s * v.wid * 0.4, y: v.y - Math.sin(v.angle) * v.len * 0.35 + Math.sin(v.angle + Math.PI / 2) * s * v.wid * 0.4, a: v.angle, life: 6 });
      if (this.skids.length > 400) this.skids.splice(0, this.skids.length - 400);
      p.x = v.x; p.y = v.y; p.angle = v.angle;
      if (w.tileAt(v.x, v.y) === T.WATER) return this.sink();
      if (inp.pressed("enter")) this.exitVehicle();
      else if (inp.pressed("act")) this.vehicleAction();
      else if (inp.pressed("cook")) { if (v.kind === "foodtruck") this.openModal("plates", this.ui.platesHtml(this, "🚚 Food Truck")); else this.ui.toast("Cook at a Home Kitchen (🏠), or buy a Food Truck to cook anywhere."); }
      if ((v.kind === "rental" || v.owned) && v.hp < v.maxHp && Math.abs(v.speed) < 5 && dist(v, w.homes[v.city]) < 130) { v.hp = v.maxHp; this.ui.toast("Car patched up outside the Home Kitchen."); }
    } else {
      const mx = (inp.down("right") ? 1 : 0) - (inp.down("left") ? 1 : 0), my = (inp.down("down") ? 1 : 0) - (inp.down("up") ? 1 : 0);
      if (mx || my) {
        const l = Math.hypot(mx, my); p.angle = Math.atan2(my, mx); p.walkT += dt;
        const m = tryMove(p, mx / l * 135 * dt, my / l * 135 * dt, p.r, w.solidFoot);
        if (!m.x || !m.y) this.lockCheck(p.x + mx / l * 20, p.y + my / l * 20);
      }
      if (inp.pressed("enter")) this.tryEnterVehicle();
      else if (inp.pressed("act")) this.contextAction();
      else if (inp.pressed("cook")) { if (this.nearHome()) this.openModal("plates", this.ui.platesHtml(this)); else this.ui.toast("Quick plates are cooked at a Home Kitchen (🏠 on the map) or in a Food Truck."); }
      for (const v of this.vehicles) {
        if (!v.ai || Math.abs(v.speed) < 60 || !carHits(v, p.x, p.y, p.r)) continue;
        p.stun = 1.6; const nx = p.x - v.x, ny = p.y - v.y, l = Math.hypot(nx, ny) || 1; p.x += nx / l * 16; p.y += ny / l * 16; v.speed *= 0.6;
        sfx.bump(); this.shake = 0.3; this.ui.toast("A " + v.name.toLowerCase() + " clipped you. Orly helped you up. Look both ways, chef.");
        break;
      }
    }
  }
  lockCheck(x, y) {
    if (this.lockToastT > 0 || !this.world.lockedAt(x, y)) return;
    const c = CITIES[cityOfTile(Math.floor(x / TILE), Math.floor(y / TILE))];
    this.ui.toast(`${c.name} isn't open yet. Finish the tables in ${CITIES[this.city].name} first.`);
    this.lockToastT = 4;
  }
  sink() {
    const v = this.player.vehicle, w = this.world;
    this.stats.swims++;
    this.player.vehicle = null; v.driver = null; v.speed = 0;
    if (v.kind === "rental" || v.owned) { const slot = this.parkingFor(v); v.x = slot.x; v.y = slot.y; v.angle = slot.angle; v.hp = v.maxHp; }
    else this.vehicles.splice(this.vehicles.indexOf(v), 1);
    radio.stop();
    const h = w.homes[this.nearestHomeCity()];
    this.player.x = h.spawn.x; this.player.y = h.spawn.y; this.orly.x = h.spawn.x - 14; this.orly.y = h.spawn.y + 10;
    this.freeze = 2; this.fare = null;
    sfx.bad();
    this.ui.banner("INTO THE RIVER", "Orly pulled you out. The knives are fine. The car went home on a tow truck.", 3500);
  }
  parkingFor(v) {
    const h = this.world.homes[v.city || this.nearestHomeCity()];
    if (v.kind === "rental") return h.parking[0];
    const i = 1 + this.owned.filter(o => o.city === v.city).findIndex(o => o.kind === v.kind);
    return h.parking[Math.min(i, h.parking.length - 1)];
  }
  nearHome() { return Object.values(this.world.homes).some(h => this.unlocked.has(h.city) && dist(h, this.player) < 70); }
  nearShop() { let best = null; for (const s of this.world.shops) if (this.unlocked.has(s.city) && Math.abs(s.x - this.player.x) < 46 && Math.abs(s.y - this.player.y) < 46) best = s; return best; }
  nearStranger(r) { let best = null, bd = r; for (const s of this.strangers) { const d = dist(s, this.player); if (d < bd) { bd = d; best = s; } } return best; }
  nearPed(r) { let best = null, bd = r; for (const pd of this.peds) { if (pd.state === "stunned") continue; const d = dist(pd, this.player); if (d < bd) { bd = d; best = pd; } } return best; }
  nearCar() { let best = null, bd = 48; for (const v of this.vehicles) { const d = dist(v, this.player); if (d < bd) { bd = d; best = v; } } return best; }
  atSpot() { return this.spot && this.step && dist(this.spot, this.player) < 44; }
  inGarage() { const v = this.player.vehicle; return v && this.world.tileAt(v.x, v.y) === T.GARAGE; }

  tryEnterVehicle() {
    const v = this.nearCar();
    if (!v) return;
    if (v.ai) {
      this.heat = Math.min(MAX_HEAT, this.heat + 0.7); this.stats.carjacks++;
      const pd = this.spawnPed(this.city);
      pd.x = v.x + Math.cos(v.angle + Math.PI / 2) * 22; pd.y = v.y + Math.sin(v.angle + Math.PI / 2) * 22;
      pd.state = "angry"; pd.timer = 7; pd.target = this.player; pd.dog = null; pd.speak(ANGRY_LINES[Math.floor(Math.random() * ANGRY_LINES.length)], 2.5);
      this.ui.toast(`You pulled ${pd.name} out of their ${v.name.toLowerCase()}. They did not say yes to that.`);
    }
    v.ai = false; v.driver = "player"; v.speed = Math.abs(v.speed) * 0.3;
    this.player.vehicle = v; sfx.tick();
    if (this.radioOn && v.kind !== "scooter") { radio.start(); this.ui.toast(`📻 ${radio.station.name} — ${radio.station.tag}`, 2200); }
  }
  exitVehicle() {
    const v = this.player.vehicle, p = this.player, w = this.world;
    const tries = [[Math.PI / 2, 26], [-Math.PI / 2, 26], [Math.PI, 34], [0, 34]];
    for (const [a, d] of tries) {
      const x = v.x + Math.cos(v.angle + a) * d, y = v.y + Math.sin(v.angle + a) * d;
      if (!hitsSolid(x, y, p.r, w.solidFoot)) { p.x = x; p.y = y; break; }
    }
    v.driver = null; v.speed = 0; p.vehicle = null;
    radio.stop();
    this.orly.x = p.x - 14; this.orly.y = p.y + 10;
    if (this.fare) { this.ui.toast(`${this.fare.ped.name} got out too. Fare cancelled.`); this.peds.push(this.fare.ped); this.fare.ped.x = p.x + 10; this.fare.ped.y = p.y; this.fare.ped.state = "walk"; this.fare = null; }
  }
  vehicleAction() {
    const v = this.player.vehicle;
    if (this.inGarage()) return this.repairAtGarage();
    if (this.tryDeliver(48)) return;
    if (v.kind === "taxi" && !this.fare) { const pd = this.nearPed(64); if (pd) return this.pickupFare(pd); }
    if (this.spot && this.step && dist(this.spot, this.player) < 70) this.ui.toast("Get out of the car (E) to talk.");
  }
  repairAtGarage() {
    const v = this.player.vehicle;
    if (v.hp >= v.maxHp && this.heat < 1) { this.ui.toast("Nothing to fix, nobody chasing you. Drive safe."); return; }
    if (this.cash < GARAGE_FEE) { sfx.no(); this.ui.toast(`Body shop wants $${GARAGE_FEE}. You have $${Math.round(this.cash)}.`); return; }
    this.cash -= GARAGE_FEE; v.hp = v.maxHp; this.heat = 0; this.police.length = 0;
    sfx.cash(); this.ui.toast(`Fresh paint, new plates, no questions. -$${GARAGE_FEE}. Heat's gone.`);
  }
  pickupFare(pd) {
    const w = this.world, city = this.randomUnlockedCity();
    let dest = null;
    for (let t = 0; t < 20; t++) { const a = w.randomAnchor(city); if (dist(a, this.player) > 500) { dest = a; break; } }
    if (!dest) dest = w.randomAnchor(city);
    const d = dist(this.player, dest);
    this.fare = { ped: pd, dest, where: FARE_DESTS[Math.floor(Math.random() * FARE_DESTS.length)], pay: Math.round(25 + d / 22), t: 0, limit: 25 + d / 90 };
    this.peds.splice(this.peds.indexOf(pd), 1);
    sfx.tick(); this.ui.toast(`${pd.name} (${pd.job}) gets in: "${this.fare.where.charAt(0).toUpperCase() + this.fare.where.slice(1)}, please. And step on it."`, 4000);
  }
  updateFare() {
    const f = this.fare;
    if (!f) return;
    const dt = 1 / 60; f.t += dt;
    const v = this.player.vehicle;
    if (!v) return;
    if (dist(v, f.dest) < 56 && Math.abs(v.speed) < 25) {
      const fast = f.t < f.limit;
      const pay = f.pay + (fast ? Math.round(f.pay * 0.4) : 0);
      this.cash += pay; this.stats.earned += pay; this.stats.fares++; this.trust += 2;
      f.ped.x = f.dest.x; f.ped.y = f.dest.y; f.ped.state = "walk"; f.ped.hailing = false; this.peds.push(f.ped);
      f.ped.speak(FARE_THANKS[Math.floor(Math.random() * FARE_THANKS.length)]);
      this.fare = null; sfx.cash();
      this.ui.toast(`Fare done: $${pay}${fast ? " (fast — they tipped)" : ""}. Find another wave (🖐).`);
    }
  }
  contextAction() {
    const ep = this.ep;
    if (this.atSpot()) {
      if (this.step === "approach") {
        if (this.signCooldown > 0) { this.ui.toast(`${ep.name} isn't ready to talk again yet (${Math.ceil(this.signCooldown)}s).`); return; }
        this.openSign(); return;
      }
      if (this.step === "visit") { this.completeEpisode(1); return; }
      if (this.step === "cook") { this.startEpisodeCook(); return; }
      if (this.step === "shop") { this.ui.toast(`${ep.name} is waiting. Still need: ${this.missingIngredients().map(i => ING[i].name).join(", ")}.`); return; }
    }
    if (this.tryDeliver(36)) return;
    const shop = this.nearShop();
    if (shop) { this.openShop(shop); return; }
    if (this.nearHome()) { this.openModal("plates", this.ui.platesHtml(this)); return; }
    const pd = this.nearPed(40);
    if (pd) this.talkTo(pd);
  }
  talkTo(pd) {
    const p = this.player;
    pd.angle = Math.atan2(p.y - pd.y, p.x - pd.x);
    if (pd.state === "walk" || pd.state === "flee") { pd.state = "idle"; pd.timer = 3.5; }
    if (pd.hungry) {
      if (this.plates.length) {
        const plate = this.plates.shift();
        const tip = Math.round(4 + Math.random() * 10 + plate.q * 6);
        this.cash += tip; this.stats.earned += tip; this.fed += 1; this.stats.fed_street++; this.trust += 2; pd.hungry = false;
        pd.speak(THANKS_LINES[Math.floor(Math.random() * THANKS_LINES.length)], 4);
        sfx.cash(); this.ui.toast(`${PLATES.find(x => x.id === plate.id).icon} You handed ${pd.name} a plate. They pressed $${tip} on you anyway. One more fed.`);
      } else pd.speak(HUNGRY_LINES[Math.floor(Math.random() * HUNGRY_LINES.length)], 3.5);
      return;
    }
    let pool = CHATTER.concat(CITY_CHATTER[pd.city] || []);
    if (this.heat >= 2) pool = ["Aren't you the ones the cops are after?", "Keep it down, they're looking for you.", ...pool.slice(0, 4)];
    else if (this.nightAmount() > 0.5) pool = ["Late for dinner, chef.", "Nothing good happens after midnight. Except dessert.", ...pool];
    else if (this.weather.rain) pool = ["Lovely weather for a stir fry.", "You cook in the rain too?", ...pool];
    pd.speak(pool[Math.floor(Math.random() * pool.length)], 3.8);
    sfx.tick();
  }
  tryDeliver(r) {
    const s = this.nearStranger(r);
    if (!s) return false;
    const idx = this.plates.findIndex(p => p.id === s.plate.id);
    if (idx < 0) { this.ui.toast(`${s.name} would love ${s.plate.name}. Cook it at a Home Kitchen (C).`); return true; }
    const plate = this.plates.splice(idx, 1)[0];
    const tip = Math.round(14 + Math.random() * 14 + plate.q * 12);
    this.cash += tip; this.stats.earned += tip; this.fed += 1; this.trust += 3;
    this.strangers.splice(this.strangers.indexOf(s), 1);
    this.respawnQueue.push({ city: s.city, t: 14 + Math.random() * 10 });
    sfx.cash();
    this.ui.toast(`${s.plate.icon} Handed over. ${s.name}: "...thank you." They tipped $${tip}. One more stranger fed.`);
    return true;
  }
  updateContext() {
    const p = this.player, ep = this.ep;
    let h = "";
    if (p.vehicle) {
      const s = this.nearStranger(48), v = p.vehicle;
      if (this.inGarage()) h = `[F] Body shop — repair + lose the heat ($${GARAGE_FEE})`;
      else if (this.fare) h = dist(v, this.fare.dest) < 56 ? "Stop here to drop them off" : `Fare: ${this.fare.ped.name} → ${this.fare.where}`;
      else if (this.spot && this.step && dist(this.spot, p) < 70) h = "[E] Get out to " + (this.step === "cook" ? "cook" : "talk");
      else if (s) h = this.plates.some(x => x.id === s.plate.id) ? `[F] Hand over ${s.plate.name}` : `${s.name} wants ${s.plate.name}`;
      else if (v.kind === "taxi") { const pd = this.nearPed(64); h = pd ? `[F] Pick up ${pd.name} (${pd.job})` : "Taxi: pull up to anyone waving (🖐) and press F"; }
      else if (v.kind === "foodtruck") h = "[C] Cook in the truck · [E] Get out";
      else h = "[E] Get out";
    } else if (this.atSpot()) {
      if (this.step === "approach") h = `[F] Hold up the sign — ${ep.name}`;
      else if (this.step === "visit") h = `[F] Say hello — ${ep.name}`;
      else if (this.step === "cook") h = `[F] Cook for ${ep.name}`;
      else h = `${ep.name} is waiting. Still need: ${this.missingIngredients().map(i => ING[i].name).join(", ")}`;
    } else {
      const s = this.nearStranger(40), shop = this.nearShop(), car = this.nearCar(), pd = this.nearPed(40);
      if (s) h = this.plates.some(x => x.id === s.plate.id) ? `[F] Hand over ${s.plate.name}` : `${s.name} wants ${s.plate.name} — cook it at home [C]`;
      else if (shop) h = `[F] Shop — ${SHOPS[shop.kind].name}`;
      else if (this.nearHome()) h = "[C] Cook quick plates";
      else if (pd) h = pd.hungry && this.plates.length ? `[F] Give ${pd.name} a plate` : `[F] Talk — ${pd.name}, ${pd.job}`;
      else if (car) h = `[E] Get in — ${car.name}${car.ai ? " (it's someone's)" : ""}`;
    }
    this.ui.hint(h);
  }
  updateOrly(dt) {
    const o = this.orly, p = this.player;
    const tx = p.x - Math.cos(p.angle) * 16, ty = p.y - Math.sin(p.angle) * 16;
    const d = Math.hypot(tx - o.x, ty - o.y);
    if (d > 6) {
      const sp = Math.min(d * 6, 170) * dt;
      o.x += (tx - o.x) / d * sp; o.y += (ty - o.y) / d * sp;
      o.angle = Math.atan2(ty - o.y, tx - o.x); o.walkT += dt;
    }
    if (p.vehicle) { o.x = p.x; o.y = p.y; }
  }
  updateTraffic(dt) {
    const p = this.player, w = this.world;
    const obstacles = [...this.vehicles, ...this.police, ...this.peds];
    if (!p.vehicle) obstacles.push(p);
    for (const v of this.vehicles) {
      if (v.ai) {
        v.updateTraffic(dt, w, obstacles, p);
        if (v.honk && v.honkT > 2.4) sfx.horn();
        if (dist(v, p) > 1500) { const i = this.vehicles.indexOf(v); this.vehicles.splice(i, 1); this.spawnCar(); }
      }
      if (p.vehicle && v !== p.vehicle) this.collide(p.vehicle, v, true);
    }
    for (const pol of this.police) for (const v of this.vehicles) if (v !== p.vehicle) this.collide(pol, v, false);
  }
  collide(a, b, playerInvolved) {
    const d = dist(a, b), min = a.r + b.r;
    if (d >= min || d === 0) return;
    const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d, push = (min - d) / 2 + 0.5;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const rel = Math.abs(a.speed) + Math.abs(b.speed);
    if (rel > 130 && playerInvolved) { a.hp = Math.max(0, a.hp - 8); b.hp = Math.max(0, b.hp - 8); this.heat = Math.min(MAX_HEAT, this.heat + 0.25); sfx.bump(); this.shake = 0.2; if (b.ai) { b.honk = true; b.honkT = 2.5; } }
    a.speed *= 0.6; b.speed *= 0.6;
  }
  updatePeds(dt) {
    const p = this.player, w = this.world, v = p.vehicle;
    for (const pd of this.peds) {
      pd.update(dt, w, w.rng, p);
      if (v && Math.abs(v.speed) > 60 && pd.state !== "stunned" && carHits(v, pd.x, pd.y, pd.r)) {
        pd.state = "stunned"; pd.timer = 3; pd.partner = null;
        const nx = pd.x - v.x, ny = pd.y - v.y, l = Math.hypot(nx, ny) || 1;
        pd.x += nx / l * 14; pd.y += ny / l * 14;
        v.speed *= 0.75; this.heat = Math.min(MAX_HEAT, this.heat + 1); this.stats.splashed++;
        sfx.bump(); this.shake = 0.2;
        this.ui.toast(`You hit ${pd.name}, a ${pd.job}. Heat is up — that's not what the sign says.`);
      }
      if (!v && pd.state === "angry" && dist(pd, p) < 14 && p.stun <= 0) { p.stun = 0.9; pd.state = "walk"; pd.timer = 3; pd.target = null; pd.speak("That's for the car.", 2); sfx.bump(); }
      if (dist(pd, p) > 1100) {
        for (let t = 0; t < 12; t++) {
          const a = w.randomAnchor(this.city);
          const d = dist(a, p);
          if (d > 350 && d < 900) { pd.x = a.x; pd.y = a.y; pd.state = "walk"; pd.partner = null; if (pd.dog) { pd.dog.x = a.x; pd.dog.y = a.y; } break; }
        }
      }
    }
    while (this.peds.length < 60) this.spawnPed(this.city, true);
  }
  updateStrangers(dt) {
    for (const s of this.strangers) s.t += dt;
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const q = this.respawnQueue[i]; q.t -= dt;
      if (q.t <= 0) { this.respawnQueue.splice(i, 1); this.spawnStranger(q.city); }
    }
  }
  updatePolice(dt) {
    const p = this.player;
    const want = Math.min(3, Math.floor(this.heat));
    if (this.heat < 1) this.police.length = 0;
    else { while (this.police.length < want) this.spawnPolice(); while (this.police.length > want) this.police.pop(); }
    let near = false;
    for (const c of this.police) {
      c.updateChase(dt, p, this.world.solidPolice);
      const d = dist(c, p);
      if (d < 380) near = true;
      const pr = p.vehicle ? p.vehicle.r : p.r;
      if (d < c.r + pr + 2) {
        if (p.vehicle && Math.abs(p.vehicle.speed) > 90) { this.collide(c, p.vehicle, true); }
        else { this.busted(); return; }
      }
      if (Math.floor(this.time * 2) % 4 === 0 && d < 500 && Math.random() < dt * 2) sfx.siren();
    }
    this.heat = Math.max(0, this.heat - (near ? 0.02 : 0.14) * dt);
  }
  busted() {
    const fine = Math.round(Math.min(this.cash * 0.25, 250));
    this.cash -= fine; this.stats.busted++; this.heat = 0; this.police.length = 0;
    const v = this.player.vehicle;
    if (v) { this.player.vehicle = null; v.driver = null; v.speed = 0; if (v.kind === "rental" || v.owned) { const slot = this.parkingFor(v); v.x = slot.x; v.y = slot.y; v.angle = slot.angle; } }
    radio.stop();
    if (this.fare) { this.peds.push(this.fare.ped); this.fare = null; }
    const h = this.world.homes[this.nearestHomeCity()];
    this.player.x = h.spawn.x; this.player.y = h.spawn.y;
    this.orly.x = h.spawn.x - 14; this.orly.y = h.spawn.y + 10;
    this.freeze = 2;
    sfx.bad();
    this.ui.banner("BUSTED", `${CITIES[this.city].police} fined you $${fine}. The car was towed home. The knives were not confiscated.`, 3500);
  }
}
