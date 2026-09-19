const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class UI {
  constructor() {
    this.$ = id => document.getElementById(id);
    this.modalKind = null; this.toastTimer = null; this.bannerTimer = null;
  }
  bind(game) {
    this.game = game;
    document.addEventListener("click", e => {
      const el = e.target.closest("[data-act]");
      if (!el) return;
      e.preventDefault();
      sfx.unlock();
      this.handle(el.dataset.act, el.dataset);
    });
  }
  handle(act, ds) {
    const g = this.game;
    switch (act) {
      case "new": g.newGame(); break;
      case "continue": g.continueGame(); break;
      case "resume": g.resume(); break;
      case "save": g.saveGame(true); break;
      case "restart": if (confirm("Start over? Your saved run will be erased.")) g.restart(); break;
      case "title": g.toTitle(); break;
      case "close": g.closeModal(); break;
      case "buy": g.buy(ds.item); break;
      case "buyneeded": g.buyNeeded(ds.kind); break;
      case "cookep": g.startEpisodeCook(); break;
      case "plate": g.startPlate(ds.plate); break;
      case "tap": g.cookTap(); break;
      case "sign": g.signChoice(ds.right === "1"); break;
      case "controls": this.open("controls", this.controlsHtml(true)); break;
      case "pause": g.pause(); break;
      case "journal": g.openJournal(); break;
      case "map": g.openMap(); break;
      case "phone": g.openPhone(ds.tab); break;
      case "buycar": g.buyVehicle(ds.kind); break;
      case "station": g.setRadio(+ds.i); break;
      case "radiotoggle": g.toggleRadio(); break;
    }
  }

  toast(msg, ms = 3400) {
    const el = this.$("toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }
  banner(title, sub, ms = 3000) {
    const el = this.$("banner"); el.innerHTML = `<div class="b-title">${esc(title)}</div><div class="b-sub">${esc(sub || "")}</div>`;
    el.classList.add("show");
    clearTimeout(this.bannerTimer); this.bannerTimer = setTimeout(() => el.classList.remove("show"), ms);
  }
  hint(text) { const el = this.$("hint"); if (el.textContent !== text) el.textContent = text; el.style.opacity = text ? 1 : 0; }

  hud(g) {
    this.$("cash").textContent = "$" + Math.round(g.cash);
    this.$("level").textContent = "Trust Lv " + g.level;
    this.$("trust-bar").style.width = ((g.trust % TRUST_PER_LEVEL) / TRUST_PER_LEVEL * 100) + "%";
    this.$("fed").textContent = g.fed.toLocaleString() + " / " + FED_GOAL.toLocaleString();
    this.$("fed-bar").style.width = Math.min(100, g.fed / FED_GOAL * 100) + "%";
    const stars = Math.round(g.heat);
    this.$("heat").textContent = "★".repeat(stars) + "☆".repeat(MAX_HEAT - stars);
    this.$("heat").className = stars > 0 ? "hot" : "";
    const v = g.player.vehicle;
    this.$("hp-row").style.display = v ? "" : "none";
    if (v) { this.$("hp-bar").style.width = (v.hp / v.maxHp * 100) + "%"; this.$("car-name").textContent = v.name; }
    const c = CITIES[g.city];
    this.$("city").textContent = c.name + " · " + c.part + (g.weather.rain ? " · 🌧" : "") + (v && radio.on ? " · 📻 " + radio.station.name : "");
    this.$("objective").innerHTML = g.objectiveHtml();
    const inv = Object.entries(g.inventory).filter(([, n]) => n > 0).length;
    this.$("inv").textContent = `🧺 ${inv} ingredients · 🍽 ${g.plates.length} plates · 📖 ${g.done.size}/${EPISODES.length} tables`;
    this.$("clock").textContent = g.clockText();
  }

  showTitle(hasSaveGame) {
    this.hideAll();
    this.$("title").classList.remove("hidden");
    this.$("continue").style.display = hasSaveGame ? "" : "none";
  }
  hideAll() {
    this.$("title").classList.add("hidden");
    this.$("modal").classList.add("hidden");
    this.$("hud").classList.remove("hidden");
    this.modalKind = null;
  }
  open(kind, html) {
    this.modalKind = kind;
    this.$("modal-content").innerHTML = html;
    this.$("modal").classList.remove("hidden");
  }
  close() { this.$("modal").classList.add("hidden"); this.modalKind = null; }

  controlsHtml(withClose) {
    return `<h2>Controls</h2>
    <table class="controls">
      <tr><td>WASD / Arrows</td><td>Walk · Drive (W gas, S brake/reverse, A/D steer)</td></tr>
      <tr><td>E</td><td>Get in / out of a car (any car — the driver won't like it)</td></tr>
      <tr><td>F</td><td>Talk to anyone · Hold up the sign · Shop · Cook · Hand over a plate · Pick up a fare · Body shop</td></tr>
      <tr><td>C</td><td>Cook quick plates at a Home Kitchen or in a Food Truck</td></tr>
      <tr><td>T</td><td>Phone — jobs, dealership, radio, stats</td></tr>
      <tr><td>R / H</td><td>Change radio station · Horn</td></tr>
      <tr><td>B</td><td>The Book — every table so far</td></tr>
      <tr><td>M</td><td>City map</td></tr>
      <tr><td>Space</td><td>Stop the marker in the cooking minigame</td></tr>
      <tr><td>Esc / P</td><td>Pause</td></tr>
    </table>
    <p class="muted">Hit a pedestrian and the heat goes up. Enough heat and the police chase you. Get caught: a fine, and your car gets towed home.</p>
    ${withClose ? `<button data-act="close">Back</button>` : ""}`;
  }
  pauseHtml(g) {
    return `<h2>Paused</h2>
      <p class="muted">${esc(CITIES[g.city].name)} · ${g.done.size} of ${EPISODES.length} tables · ${g.fed.toLocaleString()} strangers fed</p>
      <div class="btns">
        <button class="primary" data-act="resume">Resume</button>
        <button data-act="save">Save</button>
        <button data-act="controls">Controls</button>
        <button data-act="title">Title screen</button>
        <button class="danger" data-act="restart">Start over</button>
      </div>`;
  }
  shopHtml(g, shop) {
    const sk = SHOPS[shop.kind];
    const need = new Set(g.step === "shop" || g.step === "cook" ? g.ep.shop : []);
    const rows = Object.entries(ING).filter(([, i]) => i.shop === shop.kind).map(([id, i]) => {
      const have = g.inventory[id] || 0, needed = need.has(id);
      return `<tr class="${needed ? (have ? "ok" : "need") : ""}">
        <td>${needed ? (have ? "✅" : "🛒") : ""}</td><td>${esc(i.name)}</td><td>$${i.price}</td><td>×${have}</td>
        <td><button data-act="buy" data-item="${id}" ${g.cash < i.price ? "disabled" : ""}>Buy</button></td></tr>`;
    }).join("");
    const missingHere = g.missingIngredients().filter(id => ING[id].shop === shop.kind);
    const cost = missingHere.reduce((s, id) => s + ING[id].price, 0);
    return `<h2>${sk.icon} ${esc(sk.name)} <span class="muted">· ${esc(CITIES[shop.city].name)}</span></h2>
      <div class="row-between"><span>Cash: <b>$${Math.round(g.cash)}</b></span>
      ${missingHere.length ? `<button class="primary" data-act="buyneeded" data-kind="${shop.kind}" ${g.cash < cost ? "disabled" : ""}>Buy everything on the list here ($${cost})</button>` : `<span class="muted">Nothing on your list here.</span>`}</div>
      <div class="scroll"><table class="shop">${rows}</table></div>
      <button data-act="close">Leave</button>`;
  }
  platesHtml(g, title = "🏠 Home Kitchen") {
    const rows = PLATES.map(p => {
      const can = p.ing.every(i => (g.inventory[i] || 0) > 0);
      const ing = p.ing.map(i => `<span class="${(g.inventory[i] || 0) > 0 ? "ok" : "need"}">${esc(ING[i].name)}</span>`).join(", ");
      return `<tr><td class="icon">${p.icon}</td><td><b>${esc(p.name)}</b><br><small>${ing}</small></td>
        <td><button data-act="plate" data-plate="${p.id}" ${can ? "" : "disabled"}>Cook</button></td></tr>`;
    }).join("");
    const have = g.plates.map(p => PLATES.find(x => x.id === p.id).icon).join(" ") || "none yet";
    return `<h2>${esc(title)}</h2>
      <p class="muted">Quick plates for anyone hungry — the 🟠 regulars on the map, or any pedestrian with a 🍴 over their head. They tip, and every one of them counts toward 10,000.</p>
      <p>Plates in the bag: ${have}</p>
      <div class="scroll"><table class="shop">${rows}</table></div>
      <button data-act="close">Leave</button>`;
  }
  signHtml(ep, options) {
    const opts = options.map((o, i) => `<button class="opt" data-act="sign" data-right="${o.right ? 1 : 0}"><span class="k">${i + 1}</span> ${esc(o.text)}</button>`).join("");
    return `<div class="sign-head"><div class="sign">FREE<br>DINNER?</div><div>
      <h2>${esc(ep.name)}</h2><p class="muted">${esc(ep.who)} · ${esc(ep.place)}</p>
      <p>They stop. They look at the sign, then at the two of you. <i>"...What's this?"</i></p></div></div>
      <div class="opts">${opts}</div>
      <button data-act="close">Walk away for now</button>`;
  }
  episodeCard(ep, g) {
    const menu = ep.dishes ? `<h3>The menu</h3><ul class="menu">${ep.dishes.map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
    const list = ep.shop ? `<h3>Shopping list</h3><p class="list">${ep.shop.map(i => `<span class="tag ${(g.inventory[i] || 0) > 0 ? "ok" : ""}">${SHOPS[ING[i].shop].icon} ${esc(ING[i].name)}</span>`).join(" ")}</p>` : "";
    const next = ep.type === "visit" ? "Go and see them." : ep.home ? "Shop, then cook at the Home Kitchen." : `Shop for the menu, then cook in ${esc(ep.name)}'s kitchen.`;
    return `<div class="ep-kicker">EPISODE ${ep.n} · ${esc(CITIES[ep.city].name)}</div>
      <h2>${esc(ep.name)}</h2>
      <p class="muted">${esc(ep.place)} · ${ep.covers} ${ep.covers === 1 ? "cover" : "covers"}</p>
      <p class="hook">${esc(ep.hook)}</p>
      ${menu}${list}
      <p class="muted">${next}</p>
      <button class="primary" data-act="close">Let's go</button>`;
  }
  cookHtml(g, title, cook) {
    return `<div class="cook-head"><img class="chef-photo" src="assets/chef-kitchen.jpg" alt="Vlad in the kitchen" onerror="this.style.display='none'">
      <div><h2>${esc(title)}</h2><p class="muted">Vlad's on the pans. Orly's setting the table. Stop the marker in the green.</p></div></div>
      <div class="cook-dish" id="cook-dish"></div>
      <div class="cook-cue" id="cook-cue"></div>
      <div class="cook-bar"><div class="zone" id="cook-zone"></div><div class="marker" id="cook-marker"></div></div>
      <div class="cook-results" id="cook-results"></div>
      <button class="primary big" data-act="tap" id="cook-tap">STOP! <small>(Space)</small></button>`;
  }
  updateCook(cook) {
    const m = this.$("cook-marker"), z = this.$("cook-zone");
    if (!m) return;
    m.style.left = (cook.pos * 100) + "%";
    z.style.left = ((cook.zone.c - cook.zone.w / 2) * 100) + "%"; z.style.width = (cook.zone.w * 100) + "%";
    this.$("cook-dish").textContent = `Round ${Math.min(cook.round + 1, cook.rounds.length)} of ${cook.rounds.length} — ${cook.rounds[Math.min(cook.round, cook.rounds.length - 1)].dish}`;
    this.$("cook-cue").textContent = cook.rounds[Math.min(cook.round, cook.rounds.length - 1)].cue;
    this.$("cook-results").innerHTML = cook.results.map(r => r >= 1 ? "🔥" : r > 0 ? "👍" : "💀").join(" ");
  }
  cookResult(label, sub) {
    const cue = this.$("cook-cue"); if (!cue) return;
    cue.innerHTML = `<b class="result">${esc(label)}</b><br><small>${esc(sub)}</small>`;
    this.$("cook-tap").disabled = true;
  }
  journalHtml(g) {
    const rows = EPISODES.map((ep, i) => {
      const st = g.done.has(ep.id) ? "done" : i === g.episodeIdx ? "now" : g.unlocked.has(ep.city) ? "" : "locked";
      const mark = st === "done" ? "✔" : st === "now" ? "▶" : st === "locked" ? "🔒" : "·";
      const dishes = st === "locked" ? "" : (ep.dishes || ["(no recipe — a visit)"]).join(" · ");
      return `<tr class="${st}"><td>${mark}</td><td>${ep.n}</td><td><b>${esc(ep.name)}</b><br><small>${esc(ep.place)}</small></td><td><small>${esc(dishes)}</small></td><td>${ep.covers}</td></tr>`;
    }).join("");
    return `<h2>📖 The Book</h2>
      <p class="muted">${g.done.size} of ${EPISODES.length} tables · ${g.fed.toLocaleString()} strangers fed · $${Math.round(g.stats.earned)} earned · ${g.stats.perfect} perfect services</p>
      <div class="scroll tall"><table class="journal"><tr><th></th><th>#</th><th>Table</th><th>Menu</th><th>Covers</th></tr>${rows}</table></div>
      <button data-act="close">Close</button>`;
  }
  phoneHtml(g, tab) {
    const tabs = [["jobs", "Jobs"], ["garage", "Garage"], ["radio", "Radio"], ["stats", "Stats"]].map(([id, label]) => `<button class="tab ${tab === id ? "on" : ""}" data-act="phone" data-tab="${id}">${label}</button>`).join("");
    let body = "";
    if (tab === "jobs") {
      body = `<h3>Ways to make a living</h3>
        <ul class="jobs">
          <li><b>🚕 Taxi fares.</b> Get in any taxi. People waving (🖐) want a ride — pull up, press F, drive them to the drop-off. Fast rides tip.${g.fare ? `<br><span class="ok">Current fare: ${esc(g.fare.ped.name)} → ${esc(g.fare.where)} · $${g.fare.pay}</span>` : ""}</li>
          <li><b>🍽 Plates.</b> Cook quick plates at a Home Kitchen (or in a Food Truck), then hand them to the 🟠 regulars or to anyone with a 🍴 over their head. Every one counts toward 10,000.</li>
          <li><b>📖 The tables.</b> The main line: 68 tables from the book, in order. Press B for the full list.</li>
          <li><b>🔧 Body shop.</b> Wrecked the car or got the police on you? Drive into an Auto Body and press F. $${GARAGE_FEE}, no questions.</li>
          <li><b>🌊 The river.</b> Bridges every fifth block. Miss one and Orly has to fish you out.</li>
        </ul>`;
    } else if (tab === "garage") {
      const city = g.nearestHomeCity();
      const rows = ["scooter", "taxi", "foodtruck", "sports"].map(k => {
        const s = VEHICLE_SPECS[k];
        const ownedHere = g.owned.filter(o => o.kind === k).length;
        const notes = { scooter: "Nimble, fragile, fits anywhere.", taxi: "Pick up fares and get paid to drive.", foodtruck: "A kitchen on wheels — press C inside to cook plates anywhere.", sports: "Fastest thing in the city. Watch the heat." }[k];
        return `<tr><td><b>${esc(s.name)}</b><br><small>${notes} Top speed ${s.maxSpeed}. ${ownedHere ? `Owned ×${ownedHere}.` : ""}</small></td><td>$${s.price}</td><td><button data-act="buycar" data-kind="${k}" ${g.cash < s.price ? "disabled" : ""}>Buy</button></td></tr>`;
      }).join("");
      body = `<h3>Dealership</h3><p class="muted">Cash: <b>$${Math.round(g.cash)}</b>. New cars park outside the ${esc(CITIES[city].name)} Home Kitchen (${g.world.homes[city].parking.length - 1 - g.owned.filter(o => o.city === city).length} spaces left there).</p>
        <div class="scroll"><table class="shop">${rows}</table></div>`;
    } else if (tab === "radio") {
      const rows = STATIONS.map((s, i) => `<tr class="${radio.index() === i ? "ok" : ""}"><td>${radio.index() === i ? "▶" : ""}</td><td><b>${esc(s.name)}</b><br><small>${esc(s.tag)} · ${s.bpm} bpm</small></td><td><button data-act="station" data-i="${i}">Tune</button></td></tr>`).join("");
      body = `<h3>Car radio</h3><p class="muted">Plays whenever you're in a car${g.radioOn ? "" : " (currently off)"}. R cycles stations while driving.</p>
        <div class="scroll"><table class="shop">${rows}</table></div><button data-act="radiotoggle">${g.radioOn ? "Turn radio off" : "Turn radio on"}</button>`;
    } else {
      const s = g.stats;
      body = `<h3>Stats</h3><table class="journal">
        <tr><td>Strangers fed</td><td>${g.fed.toLocaleString()} of ${FED_GOAL.toLocaleString()}</td></tr>
        <tr><td>Tables served</td><td>${g.done.size} of ${EPISODES.length}</td></tr>
        <tr><td>Plates handed out on the street</td><td>${s.fed_street}</td></tr>
        <tr><td>Perfect services</td><td>${s.perfect}</td></tr>
        <tr><td>Cash earned</td><td>$${Math.round(s.earned)}</td></tr>
        <tr><td>Taxi fares</td><td>${s.fares}</td></tr>
        <tr><td>Cars borrowed without asking</td><td>${s.carjacks}</td></tr>
        <tr><td>Pedestrians hit</td><td>${s.splashed}</td></tr>
        <tr><td>Times busted</td><td>${s.busted}</td></tr>
        <tr><td>Times in the river</td><td>${s.swims}</td></tr>
        <tr><td>Trust level</td><td>${g.level} (${g.trust} pts)</td></tr>
      </table>`;
    }
    return `<div class="phone-head"><span class="phone-dot"></span><h2>Phone</h2><span class="muted">${g.clockText()}</span></div>
      <div class="tabs">${tabs}</div>${body}
      <button data-act="close">Put it away</button>`;
  }
  mapHtml() {
    return `<h2>🗺 The Map</h2><canvas id="bigmap" width="480" height="480"></canvas>
      <p class="muted legend">🟡 current table · 🟢 shop with something on your list · 🟠 hungry stranger · 🔴 police · ⚪ you</p>
      <button data-act="close">Close</button>`;
  }
  winHtml(g) {
    const mins = Math.round(g.time / 60);
    return `<div class="ep-kicker">AFTERWORD</div><h2>Sixty-eight tables. Four cities. One year.</h2>
      <div class="win-photo"><img src="assets/cooks-selfie.jpg" alt="Vlad and Orly"><div class="hero-cap">Vlad &amp; Orly — @chef_briantsev · @chefonthehouse</div></div>
      <p class="hook">You fed ${g.fed.toLocaleString()} strangers and cooked ${g.done.size} tables. Nobody paid you to do it. That was the whole point.</p>
      <p>Cash on hand: $${Math.round(g.cash)} · Earned: $${Math.round(g.stats.earned)} · Perfect services: ${g.stats.perfect} · Busted: ${g.stats.busted} times · Pedestrians splashed: ${g.stats.splashed} · Playtime: ${mins} min</p>
      <p class="muted">The city is still hungry. The streets stay open — keep feeding people.</p>
      <div class="btns"><button class="primary" data-act="close">Keep playing</button><button data-act="restart">New run</button></div>`;
  }
}
