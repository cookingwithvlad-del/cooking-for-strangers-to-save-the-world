class Renderer {
  constructor(canvas, game) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.game = game;
    this.cam = { x: 0, y: 0 };
    this.mini = document.getElementById("minimap");
    this.mctx = this.mini.getContext("2d");
    this.mapCache = document.createElement("canvas");
    this.mapCache.width = CITY * 8; this.mapCache.height = CITY * 8;
    this.dark = document.createElement("canvas");
    this.mapDirty = true;
  }
  invalidateMap() { this.mapDirty = true; }
  resize() { this.c.width = innerWidth; this.c.height = innerHeight; this.dark.width = innerWidth; this.dark.height = innerHeight; }
  hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
  rr(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }

  draw() {
    const g = this.game, ctx = this.ctx, W = this.c.width, H = this.c.height;
    const p = g.player;
    let cx = p.x - W / 2, cy = p.y - H / 2;
    cx = W >= WORLD ? (WORLD - W) / 2 : Math.max(0, Math.min(WORLD - W, cx));
    cy = H >= WORLD ? (WORLD - H) / 2 : Math.max(0, Math.min(WORLD - H, cy));
    if (g.shake > 0) { cx += (Math.random() - 0.5) * 8; cy += (Math.random() - 0.5) * 8; g.shake -= 1 / 60; }
    this.cam.x = cx; this.cam.y = cy;

    ctx.fillStyle = "#07090d"; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(-Math.round(cx), -Math.round(cy));
    this.drawTiles(cx, cy, W, H);
    this.drawSkids();
    this.drawSpot();
    for (const s of g.strangers) this.drawPerson(s.x, s.y + Math.sin(s.t * 3) * 1.5, s.angle, s, s.t, { orange: true });
    for (const pd of g.peds) this.drawPed(pd);
    for (const v of g.vehicles) this.drawVehicle(v);
    for (const v of g.police) this.drawVehicle(v);
    if (!p.vehicle) { this.drawOrly(g.orly); this.drawPlayer(p); }
    for (const pd of g.peds) if (pd.say) this.drawSpeech(pd.x, pd.y - 20, pd.say);
    for (const s of g.strangers) this.drawBubble(s.x, s.y - 22, s.plate.icon, dist(s, p) < 140 ? s.plate.name : null);
    for (const v of g.vehicles) if (v.honk) { this.drawSpeech(v.x, v.y - 18, HONK_LINES[Math.floor(this.hash(Math.round(v.x), Math.round(v.y)) * HONK_LINES.length)]); if (v.honkT < 1.5) v.honk = false; }
    this.drawShopMarkers();
    this.drawFareMarker();
    this.drawObjectiveArrow();
    ctx.restore();
    this.drawNight(W, H, cx, cy);
    this.drawRain(W, H);
    this.drawMinimap();
  }

  drawTiles(cx, cy, W, H) {
    const g = this.game, ctx = this.ctx, w = g.world, t0 = g.time;
    const x0 = Math.max(0, Math.floor(cx / TILE) - 1), x1 = Math.min(CITY - 1, Math.floor((cx + W) / TILE) + 1);
    const y0 = Math.max(0, Math.floor(cy / TILE) - 1), y1 = Math.min(CITY - 1, Math.floor((cy + H) / TILE) + 1);
    const night = g.nightAmount(), wet = g.weather.rain;
    const labels = [], locks = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = w.get(tx, ty), px = tx * TILE, py = ty * TILE;
      const cityId = cityOfTile(tx, ty), city = CITIES[cityId];
      const lx = tx % 5, ly = ty % 5;
      if (t === T.ROAD || t === T.BRIDGE) {
        ctx.fillStyle = wet ? "#1f232c" : "#2b2f3a"; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "#c9b458";
        if (tx % 5 === 0 && ty % 5 !== 0) { ctx.fillRect(px + 15, py + 3, 2, 10); ctx.fillRect(px + 15, py + 19, 2, 10); }
        else if (ty % 5 === 0 && tx % 5 !== 0) { ctx.fillRect(px + 3, py + 15, 10, 2); ctx.fillRect(px + 19, py + 15, 10, 2); }
        else { ctx.fillStyle = "#3a3f4b"; ctx.fillRect(px + 2, py + 2, 28, 28); }
        if (t === T.BRIDGE) {
          const vertical = w.get(tx - 1, ty) === T.WATER || w.get(tx + 1, ty) === T.WATER;
          ctx.fillStyle = "#6b7280";
          if (vertical) { ctx.fillRect(px, py, 3, TILE); ctx.fillRect(px + TILE - 3, py, 3, TILE); }
          else { ctx.fillRect(px, py, TILE, 3); ctx.fillRect(px, py + TILE - 3, TILE, 3); }
          if (w.get(tx - 1, ty) === T.WATER && w.get(tx, ty - 1) === T.WATER) { ctx.fillRect(px, py, 3, TILE); ctx.fillRect(px, py, TILE, 3); }
        }
        const isCross = tx % 5 === 0 && ty % 5 === 0;
        if (!isCross && ((tx % 5 === 0 && (ly === 1 || ly === 4)) || (ty % 5 === 0 && (lx === 1 || lx === 4))) && t === T.ROAD) {
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          if (tx % 5 === 0) for (let i = 0; i < 4; i++) ctx.fillRect(px + 2 + i * 8, py + (ly === 1 ? 2 : 26), 5, 4);
          else for (let i = 0; i < 4; i++) ctx.fillRect(px + (lx === 1 ? 2 : 26), py + 2 + i * 8, 4, 5);
        }
      } else if (t === T.SIDEWALK) {
        ctx.fillStyle = cityId === "la" ? "#c8bfa8" : cityId === "fl" ? "#d9cfc1" : "#a3a7ad"; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(px, py, TILE, 1); ctx.fillRect(px, py, 1, TILE);
        const h = this.hash(tx, ty);
        if (h < 0.06) { ctx.fillStyle = "#374151"; ctx.fillRect(px + 12, py + 6, 8, 12); ctx.fillStyle = "#1f2937"; ctx.fillRect(px + 13, py + 4, 6, 3); }
        else if (h < 0.1) { ctx.fillStyle = "#6b4f2a"; ctx.fillRect(px + 4, py + 12, 24, 6); ctx.fillRect(px + 6, py + 18, 3, 6); ctx.fillRect(px + 23, py + 18, 3, 6); }
        else if (h < 0.14) { ctx.fillStyle = "#2f6b2a"; ctx.beginPath(); ctx.arc(px + 16, py + 16, 9, 0, 7); ctx.fill(); ctx.fillStyle = "#5ea34e"; ctx.beginPath(); ctx.arc(px + 13, py + 13, 4, 0, 7); ctx.fill(); }
        else if (h < 0.17) { ctx.fillStyle = "#b91c1c"; ctx.fillRect(px + 12, py + 10, 8, 14); ctx.fillStyle = "#7f1d1d"; ctx.fillRect(px + 13, py + 8, 6, 3); }
      } else if (t === T.PARK) {
        ctx.fillStyle = cityId === "la" ? "#7a9b4a" : "#4c8a3f"; ctx.fillRect(px, py, TILE, TILE);
        const h = this.hash(tx, ty);
        if (h < 0.45) {
          ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(px + 18, py + 18, 9, 0, 7); ctx.fill();
          ctx.fillStyle = cityId === "la" ? "#3f7d2f" : "#2f6b2a"; ctx.beginPath(); ctx.arc(px + 16, py + 16, 9, 0, 7); ctx.fill();
          ctx.fillStyle = "#5ea34e"; ctx.beginPath(); ctx.arc(px + 13, py + 13, 4, 0, 7); ctx.fill();
        } else if (h < 0.52) { ctx.fillStyle = "#8b5a2b"; ctx.fillRect(px + 5, py + 13, 22, 6); ctx.fillRect(px + 7, py + 19, 3, 5); ctx.fillRect(px + 22, py + 19, 3, 5); }
        else if (h < 0.6) { ctx.fillStyle = "#a3b18a"; ctx.fillRect(px + 8, py + 8, 16, 16); }
      } else if (t === T.WATER) {
        ctx.fillStyle = wet ? "#1e3a5f" : "#2a5d8f"; ctx.fillRect(px, py, TILE, TILE);
        const ph = this.hash(tx, ty) * 6.28;
        const wy = py + 10 + Math.sin(t0 * 1.3 + ph) * 6;
        ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(px + 4 + Math.cos(t0 + ph) * 3, wy, 14, 2); ctx.fillRect(px + 16, wy + 12, 10, 2);
      } else if (t === T.SAND) {
        ctx.fillStyle = "#e7d3a1"; ctx.fillRect(px, py, TILE, TILE);
        const h = this.hash(tx, ty);
        ctx.fillStyle = "rgba(0,0,0,0.08)"; ctx.fillRect(px + h * 20, py + 8, 3, 3);
        if (h < 0.08) { ctx.fillStyle = "#ef4444"; ctx.beginPath(); ctx.arc(px + 16, py + 14, 10, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(px + 16, py + 4); ctx.lineTo(px + 16, py + 24); ctx.lineTo(px + 6, py + 14); ctx.closePath(); ctx.fill(); }
        else if (h < 0.14) { ctx.fillStyle = "#3b82f6"; ctx.fillRect(px + 6, py + 10, 20, 10); }
        else if (h < 0.2) { ctx.fillStyle = "#9a7b4f"; ctx.fillRect(px + 14, py + 6, 4, 20); ctx.fillStyle = "#2f8f3a"; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(px + 16 + Math.cos(i * 1.26) * 8, py + 8 + Math.sin(i * 1.26) * 5, 7, 2.5, i * 1.26, 0, 7); ctx.fill(); } }
      } else if (t === T.BUILDING) {
        ctx.fillStyle = city.color; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = city.roof; ctx.fillRect(px + 3, py + 3, 26, 26);
        const hh = this.hash(tx + 99, ty);
        if (hh < 0.12) { ctx.fillStyle = "#94a3b8"; ctx.fillRect(px + 10, py + 10, 12, 12); ctx.fillStyle = "#475569"; ctx.fillRect(px + 12, py + 12, 8, 8); }
        else if (hh < 0.18) { ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.arc(px + 16, py + 16, 6, 0, 7); ctx.fill(); }
        else for (let wy = 0; wy < 2; wy++) for (let wx = 0; wx < 2; wx++) {
          const lit = this.hash(tx * 2 + wx, ty * 2 + wy) < (0.25 + night * 0.5);
          ctx.fillStyle = lit ? (night > 0.3 ? "#fde68a" : "#e2e8f0") : "#1f2937";
          ctx.fillRect(px + 8 + wx * 11, py + 8 + wy * 11, 5, 5);
        }
      } else if (t === T.SHOP || t === T.HOME || t === T.GARAGE) {
        ctx.fillStyle = t === T.HOME ? "#dbeafe" : t === T.GARAGE ? "#9ca3af" : "#f3f4f6"; ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        if (t === T.GARAGE) { ctx.fillStyle = "#fbbf24"; ctx.fillRect(px + 4, py + 14, 24, 4); }
        if (lx === 2 && ly === 2) labels.push({ tx, ty, px, py, t, cityId });
      }
      if (w.isLockedTile(tx, ty)) {
        ctx.fillStyle = "rgba(4,6,12,0.78)"; ctx.fillRect(px, py, TILE, TILE);
        if ((tx === 12 || tx === 37) && (ty === 7 || ty === 32)) locks.push({ px, py, city });
      }
    }
    for (const l of labels) {
      let icon, name, color;
      if (l.t === T.HOME) { icon = "🏠"; name = "HOME KITCHEN"; color = "#2563eb"; }
      else if (l.t === T.GARAGE) { icon = "🔧"; name = "AUTO BODY"; color = "#b45309"; }
      else {
        const s = g.world.shops.find(s => s.tx === l.tx && s.ty === l.ty);
        const sk = SHOPS[s.kind]; icon = sk.icon; name = sk.name.toUpperCase(); color = sk.color;
      }
      ctx.fillStyle = color; ctx.fillRect(l.px, l.py + 48, 64, 14);
      ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      ctx.fillText(name, l.px + 32, l.py + 58);
      ctx.font = "24px sans-serif"; ctx.fillText(icon, l.px + 32, l.py + 36);
    }
    for (const l of locks) {
      ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#e5e7eb";
      ctx.fillText("🔒 " + l.city.name.toUpperCase(), l.px + 16, l.py + 10);
      ctx.font = "13px sans-serif"; ctx.fillText("Finish the tables before it to unlock", l.px + 16, l.py + 32);
    }
  }

  drawSkids() {
    const ctx = this.ctx;
    for (const s of this.game.skids) {
      ctx.strokeStyle = `rgba(20,20,20,${0.45 * Math.min(1, s.life / 3)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(s.a) * 6, s.y + Math.sin(s.a) * 6); ctx.stroke();
    }
  }

  drawSpot() {
    const g = this.game, ctx = this.ctx, s = g.spot;
    if (!s || !g.step) return;
    const t = g.time, ep = g.ep, look = g.spotLook;
    ctx.fillStyle = "rgba(250,204,21,0.25)";
    ctx.beginPath(); ctx.arc(s.x, s.y, 22 + Math.sin(t * 4) * 3, 0, 7); ctx.fill();
    const toPlayer = Math.atan2(g.player.y - s.y, g.player.x - s.x);
    const near = dist(g.player, s) < 120;
    look.figures.forEach((f, i) => {
      const fx = s.x + f.dx, fy = s.y + f.dy;
      const a = near ? Math.atan2(g.player.y - fy, g.player.x - fx) : f.angle + Math.sin(t * 0.7 + i) * 0.3;
      this.drawPerson(fx, fy, a, f, t + i, { hat: f.hat, idle: true });
      if (f.dog) this.drawDog(fx + 12, fy + 10, a, f.dogColor, t);
    });
    const icon = g.step === "cook" ? "🍳" : g.step === "shop" ? "⏳" : "!";
    const by = s.y - 30 - Math.abs(Math.sin(t * 3)) * 6;
    if (icon === "!") {
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.moveTo(s.x - 8, by - 20); ctx.lineTo(s.x + 8, by - 20); ctx.lineTo(s.x, by - 6); ctx.closePath(); ctx.fill();
      ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#facc15"; ctx.fillText("!", s.x, by - 24);
    } else { ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.fillText(icon, s.x, by - 8); }
    ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.6)"; const tw = ctx.measureText(ep.name).width + 10;
    ctx.fillRect(s.x - tw / 2, s.y + 16, tw, 14); ctx.fillStyle = "#facc15"; ctx.fillText(ep.name, s.x, s.y + 27);
    if (!near) return;
    ctx.font = "10px sans-serif"; ctx.fillStyle = "rgba(0,0,0,0.55)";
    const ww = ctx.measureText(ep.who).width + 8; ctx.fillRect(s.x - ww / 2, s.y + 31, ww, 12); ctx.fillStyle = "#e5e7eb"; ctx.fillText(ep.who, s.x, s.y + 40);
  }

  drawShopMarkers() {
    const g = this.game, ctx = this.ctx, t = g.time;
    if (g.step === "shop") for (const s of g.world.shops) {
      if (!g.unlocked.has(s.city) || !g.shopHasMissing(s.kind)) continue;
      const by = s.y - 44 - Math.abs(Math.sin(t * 3)) * 6;
      ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(s.x, by, 11, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.fillText("$", s.x, by + 5);
    }
    const v = g.player.vehicle;
    if (v && (v.hp < v.maxHp || g.heat >= 1)) for (const ga of g.world.garages) {
      if (!g.unlocked.has(ga.city) || dist(ga, g.player) > 900) continue;
      const by = ga.y - 44 - Math.abs(Math.sin(t * 3)) * 6;
      ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🔧", ga.x, by);
    }
  }
  drawFareMarker() {
    const g = this.game, f = g.fare, ctx = this.ctx;
    if (!f) return;
    const t = g.time;
    ctx.fillStyle = "rgba(250,204,21,0.3)"; ctx.beginPath(); ctx.arc(f.dest.x, f.dest.y, 26 + Math.sin(t * 4) * 4, 0, 7); ctx.fill();
    ctx.fillStyle = "#facc15"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("DROP-OFF", f.dest.x, f.dest.y - 30);
  }
  drawObjectiveArrow() {
    const g = this.game, ctx = this.ctx, tgt = g.objectiveTarget();
    if (!tgt) return;
    const p = g.player, d = dist(p, tgt);
    if (d < 60) return;
    const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
    ctx.save(); ctx.translate(p.x + Math.cos(a) * 38, p.y + Math.sin(a) * 38); ctx.rotate(a);
    ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = "10px sans-serif"; ctx.fillStyle = "#facc15"; ctx.textAlign = "center";
    ctx.fillText(Math.round(d / 10) * 10 + "m", p.x + Math.cos(a) * 52, p.y + Math.sin(a) * 52 + 4);
  }

  drawVehicle(v) {
    const ctx = this.ctx, g = this.game;
    ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.angle);
    const L = v.len, Wd = v.wid, dark = "#1f2937";
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(-L / 2 + 2, -Wd / 2 + 3, L, Wd);
    if (v.kind === "scooter") {
      ctx.fillStyle = v.color; this.rr(-L / 2, -Wd / 2, L, Wd, 4); ctx.fill();
      ctx.fillStyle = "#111"; ctx.fillRect(L / 2 - 4, -2, 4, 4); ctx.fillRect(-L / 2, -2, 4, 4);
      const rider = v.driver === "player" ? { skin: "#e0ac69", shirt: "#f8fafc", hair: "#3f2a1d", hairStyle: 0 } : (v.rider || (v.rider = { skin: SKINS[3], shirt: CAR_COLORS[2], hair: "#1c1917", hairStyle: 0 }));
      ctx.fillStyle = rider.shirt; ctx.beginPath(); ctx.ellipse(-2, 0, 6, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = "#fde68a"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
      ctx.fillStyle = "#fde68a"; ctx.fillRect(L / 2 - 2, -2, 2, 4);
      ctx.restore(); return;
    }
    ctx.fillStyle = v.color; this.rr(-L / 2, -Wd / 2, L, Wd, v.kind === "bus" || v.kind === "van" || v.kind === "foodtruck" ? 3 : 5); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(-L / 2 + 3, -Wd / 2 + 2, L - 6, 3);
    if (v.kind === "bus") {
      ctx.fillStyle = dark; ctx.fillRect(L / 2 - 8, -Wd / 2 + 3, 5, Wd - 6);
      for (let i = 0; i < 5; i++) { ctx.fillRect(-L / 2 + 6 + i * 9, -Wd / 2 + 2, 6, 3); ctx.fillRect(-L / 2 + 6 + i * 9, Wd / 2 - 5, 6, 3); }
      ctx.fillStyle = "#1d4ed8"; ctx.fillRect(-L / 2 + 4, -2, L - 14, 4);
    } else if (v.kind === "van" || v.kind === "foodtruck") {
      ctx.fillStyle = dark; ctx.fillRect(L / 2 - 11, -Wd / 2 + 3, 5, Wd - 6);
      ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(-L / 2 + 3, -Wd / 2 + 3, L - 18, Wd - 6);
      if (v.kind === "foodtruck") { ctx.fillStyle = "#fff"; ctx.fillRect(-L / 2 + 6, -Wd / 2 - 1, L - 24, 4); ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🍳", -6, 4); }
    } else {
      ctx.fillStyle = dark; ctx.fillRect(L / 2 - 13, -Wd / 2 + 3, 6, Wd - 6); ctx.fillRect(-L / 2 + 5, -Wd / 2 + 3, 4, Wd - 6);
      if (v.kind === "sports") { ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-L / 2 + 2, -1.5, L - 4, 3); }
      if (v.kind === "taxi") { ctx.fillStyle = "#111"; ctx.fillRect(-4, -4, 8, 8); ctx.fillStyle = "#fde68a"; ctx.fillRect(-3, -3, 6, 6); ctx.fillStyle = "#111"; ctx.fillRect(-L / 2 + 10, -Wd / 2, 3, Wd); }
    }
    const night = g.nightAmount() > 0.2;
    ctx.fillStyle = night ? "#fff7cc" : "#fde68a"; ctx.fillRect(L / 2 - 2, -Wd / 2 + 2, 2, 4); ctx.fillRect(L / 2 - 2, Wd / 2 - 6, 2, 4);
    ctx.fillStyle = v.braking ? "#ff2d2d" : v.reversing ? "#f8fafc" : "#9f1239"; ctx.fillRect(-L / 2, -Wd / 2 + 2, 2, 4); ctx.fillRect(-L / 2, Wd / 2 - 6, 2, 4);
    if (v.kind === "rental") { ctx.fillStyle = "#e11d48"; ctx.fillRect(-L / 2 + 10, -2, L - 24, 4); ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🔪", 0, 4); }
    if (v.kind === "police") {
      ctx.fillStyle = "#1d4ed8"; ctx.fillRect(-L / 2 + 8, -Wd / 2, L - 16, 3); ctx.fillRect(-L / 2 + 8, Wd / 2 - 3, L - 16, 3);
      const on = Math.floor(g.time * 8) % 2 === 0;
      ctx.fillStyle = on ? "#ef4444" : "#3b82f6"; ctx.fillRect(-5, -4, 4, 8);
      ctx.fillStyle = on ? "#3b82f6" : "#ef4444"; ctx.fillRect(1, -4, 4, 8);
    }
    if (v.hp < v.maxHp * 0.35) { ctx.fillStyle = `rgba(120,120,120,${v.dead ? 0.7 : 0.4})`; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(L / 2 - 4 - i * 6 + Math.sin(g.time * 5 + i) * 2, -6 - i * 5, 4 + i, 0, 7); ctx.fill(); } }
    ctx.restore();
  }

  drawPerson(x, y, angle, p, t, opts = {}) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(1, 2, 8, 6, 0, 0, 7); ctx.fill();
    const step = opts.idle ? 0 : Math.sin(t * 10) * 3;
    ctx.fillStyle = p.pants || "#1f2937"; ctx.fillRect(-2 + step, -5, 4, 3); ctx.fillRect(-2 - step, 2, 4, 3);
    ctx.fillStyle = opts.orange ? "#f97316" : (p.shirt || "#64748b"); this.rr(-5, -7, 10, 14, 3); ctx.fill();
    ctx.fillStyle = p.skin || "#e0ac69"; ctx.beginPath(); ctx.arc(3 - step * 0.6, -8, 2, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(3 + step * 0.6, 8, 2, 0, 7); ctx.fill();
    if (p.bag) { ctx.fillStyle = "#78350f"; ctx.fillRect(-6, 5, 5, 5); }
    ctx.fillStyle = p.skin || "#e0ac69"; ctx.beginPath(); ctx.arc(1, 0, 4.6, 0, 7); ctx.fill();
    if (opts.chef) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#e5e7eb"; ctx.fillRect(-4, -3, 3, 6); }
    else if (opts.hat || p.hat) { ctx.fillStyle = p.hatColor || "#374151"; ctx.beginPath(); ctx.arc(1, 0, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#6b7280"; ctx.fillRect(-1, -2, 3, 4); }
    else if (p.hairStyle !== 2) {
      ctx.fillStyle = p.hair || "#3f2a1d";
      ctx.beginPath(); ctx.arc(0, 0, 4.2, 0, 7); ctx.fill();
      if (p.hairStyle === 1) { ctx.beginPath(); ctx.ellipse(-4, 0, 3.5, 4.5, 0, 0, 7); ctx.fill(); }
      ctx.fillStyle = p.skin || "#e0ac69"; ctx.beginPath(); ctx.arc(3, 0, 2.6, 0, 7); ctx.fill();
    }
    if (opts.umbrella) { ctx.fillStyle = p.shirt || "#3b82f6"; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(i * 1.047) * 9, Math.sin(i * 1.047) * 9); ctx.stroke(); } }
    ctx.restore();
  }
  drawDog(x, y, angle, color, t) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(0, 1, 6, 3.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(-1, 0, 5.5, 3, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(5, 0, 2.6, 0, 7); ctx.fill();
    ctx.fillRect(-7, -1 + Math.sin(t * 14) * 1.5, 3, 1.5);
    ctx.fillStyle = "#111"; ctx.fillRect(7, -0.5, 1.2, 1);
    ctx.restore();
  }
  drawPed(pd) {
    const ctx = this.ctx, g = this.game;
    if (pd.dog) { ctx.strokeStyle = "rgba(60,40,20,0.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pd.x, pd.y); ctx.lineTo(pd.dog.x, pd.dog.y); ctx.stroke(); this.drawDog(pd.dog.x, pd.dog.y, pd.dog.angle, pd.dog.color, pd.dog.t); }
    if (pd.state === "stunned") {
      ctx.save(); ctx.translate(pd.x, pd.y);
      ctx.fillStyle = pd.shirt; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0.4, 0, 7); ctx.fill();
      ctx.fillStyle = pd.skin; ctx.beginPath(); ctx.arc(8, -3, 4, 0, 7); ctx.fill();
      ctx.font = "10px sans-serif"; ctx.fillStyle = "#fde047"; ctx.textAlign = "center";
      ctx.fillText("✦", Math.cos(g.time * 6) * 8, -10 + Math.sin(g.time * 6) * 3);
      ctx.restore();
      return;
    }
    const idle = pd.state === "idle" || pd.state === "chat";
    this.drawPerson(pd.x, pd.y, pd.angle, pd, pd.state === "walk" ? pd.walkT : pd.walkT * 2, { idle, umbrella: g.weather.rain && pd.umbrella && pd.state !== "flee" });
    if (idle && pd.state === "idle" && !pd.say) { ctx.fillStyle = "#93c5fd"; ctx.fillRect(pd.x + 5, pd.y - 2, 3, 4); }
    const near = dist(pd, g.player) < 70;
    if (near && pd.hungry && !pd.say) { ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🍴", pd.x, pd.y - 12); }
    if (pd.hailing && g.player.vehicle && g.player.vehicle.kind === "taxi" && !g.fare && dist(pd, g.player) < 260 && pd.state === "walk") { ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🖐", pd.x + 6, pd.y - 12 + Math.sin(g.time * 8) * 2); }
  }
  drawPlayer(p) {
    if (p.stun > 0) {
      const ctx = this.ctx; ctx.save(); ctx.translate(p.x, p.y);
      ctx.fillStyle = "#f8fafc"; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0.4, 0, 7); ctx.fill();
      ctx.fillStyle = "#e0ac69"; ctx.beginPath(); ctx.arc(8, -3, 4, 0, 7); ctx.fill(); ctx.restore(); return;
    }
    this.drawPerson(p.x, p.y, p.angle, { skin: "#e0ac69", shirt: "#f8fafc", pants: "#1f2937" }, p.walkT, { chef: true });
  }
  drawOrly(o) {
    const ctx = this.ctx, t = this.game.time;
    this.drawPerson(o.x, o.y, o.angle, { skin: "#f1c9a5", shirt: "#1e3a8a", pants: "#374151", hair: "#d6b370", hairStyle: 0 }, o.walkT || 0, { umbrella: this.game.weather.rain });
    ctx.save(); ctx.translate(o.x, o.y - 16 + Math.sin(t * 2) * 1);
    ctx.fillStyle = "#b45309"; ctx.fillRect(-1, 2, 2, 8);
    ctx.fillStyle = "#facc15"; ctx.fillRect(-11, -6, 22, 10);
    ctx.fillStyle = "#111"; ctx.font = "bold 6px sans-serif"; ctx.textAlign = "center"; ctx.fillText("FREE DINNER?", 0, 1);
    ctx.restore();
  }
  drawBubble(x, y, icon, text) {
    const ctx = this.ctx;
    ctx.font = "bold 10px sans-serif";
    const tw = text ? ctx.measureText(text).width : 0;
    const w = 22 + (text ? tw + 8 : 0), h = 22;
    ctx.fillStyle = "#fff"; this.rr(x - w / 2, y - h, w, h, 6); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.closePath(); ctx.fill();
    ctx.font = "14px sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "#000";
    ctx.fillText(icon, x - w / 2 + 4, y - 6);
    if (text) { ctx.font = "bold 10px sans-serif"; ctx.fillStyle = "#111"; ctx.fillText(text, x - w / 2 + 24, y - 8); }
  }
  drawSpeech(x, y, text) {
    const ctx = this.ctx;
    ctx.font = "10px sans-serif";
    const words = text.split(" "), lines = []; let cur = "";
    for (const wd of words) { if (ctx.measureText(cur + " " + wd).width > 150 && cur) { lines.push(cur); cur = wd; } else cur = cur ? cur + " " + wd : wd; }
    lines.push(cur);
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12, h = lines.length * 12 + 8;
    ctx.fillStyle = "rgba(255,255,255,0.95)"; this.rr(x - w / 2, y - h, w, h, 5); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.lineTo(x, y + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#111"; ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, x, y - h + 13 + i * 12));
  }

  drawNight(W, H, cx, cy) {
    const g = this.game, n = g.nightAmount();
    if (n <= 0.03) return;
    const d = this.dark.getContext("2d");
    d.globalCompositeOperation = "source-over";
    d.fillStyle = `rgba(6,10,36,${0.62 * n})`; d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = "destination-out";
    const hole = (x, y, r, a, sx = 1, sy = 1, rot = 0) => {
      const gx = x - cx, gy = y - cy;
      if (gx < -200 || gy < -200 || gx > W + 200 || gy > H + 200) return;
      d.save(); d.translate(gx, gy); d.rotate(rot); d.scale(sx, sy);
      const gr = d.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = gr; d.beginPath(); d.arc(0, 0, r, 0, 7); d.fill(); d.restore();
    };
    const x0 = Math.max(0, Math.floor(cx / TILE / 5) * 5), x1 = Math.min(CITY, Math.ceil((cx + W) / TILE) + 5);
    const y0 = Math.max(0, Math.floor(cy / TILE / 5) * 5), y1 = Math.min(CITY, Math.ceil((cy + H) / TILE) + 5);
    for (let ty = y0; ty <= y1; ty += 5) for (let tx = x0; tx <= x1; tx += 5) {
      if (g.world.get(tx, ty) !== T.ROAD || g.world.isLockedTile(tx, ty)) continue;
      hole(tx * TILE + 16, ty * TILE + 16, 80, 0.75);
    }
    for (const s of g.world.shops) if (g.unlocked.has(s.city)) hole(s.x, s.y, 90, 0.7);
    for (const h of Object.values(g.world.homes)) if (g.unlocked.has(h.city)) hole(h.x, h.y, 90, 0.7);
    for (const ga of g.world.garages) if (g.unlocked.has(ga.city)) hole(ga.x, ga.y, 70, 0.6);
    for (const v of [...g.vehicles, ...g.police]) {
      if (v.kind === "scooter" && !v.driver && !v.ai) continue;
      hole(v.x + Math.cos(v.angle) * (v.len / 2 + 34), v.y + Math.sin(v.angle) * (v.len / 2 + 34), 48, 0.9, 1.5, 0.75, v.angle);
      if (v.kind === "police") hole(v.x, v.y, 90, 0.5 + 0.3 * Math.sin(g.time * 16));
    }
    hole(g.player.x, g.player.y, 60, 0.5);
    this.ctx.drawImage(this.dark, 0, 0);
  }
  drawRain(W, H) {
    const g = this.game;
    if (!g.weather.rain) return;
    const ctx = this.ctx, t = g.time;
    ctx.strokeStyle = "rgba(180,200,255,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 140; i++) {
      const x = (this.hash(i, 1) * W + t * 60 * (0.5 + this.hash(i, 2))) % W;
      const y = (this.hash(i, 3) * H + t * 520 * (0.6 + this.hash(i, 4) * 0.6)) % H;
      ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 10);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(20,30,60,0.12)"; ctx.fillRect(0, 0, W, H);
  }

  buildMapCache() {
    const w = this.game.world, ctx = this.mapCache.getContext("2d"), S = 8;
    for (let ty = 0; ty < CITY; ty++) for (let tx = 0; tx < CITY; tx++) {
      const t = w.get(tx, ty), cityId = cityOfTile(tx, ty);
      let col;
      if (t === T.ROAD || t === T.BRIDGE) col = "#3a3f4b";
      else if (t === T.SIDEWALK) col = "#8f949b";
      else if (t === T.PARK) col = "#4c8a3f";
      else if (t === T.WATER) col = "#2a5d8f";
      else if (t === T.SAND) col = "#e7d3a1";
      else if (t === T.BUILDING) col = CITIES[cityId].color;
      else if (t === T.HOME) col = "#60a5fa";
      else if (t === T.GARAGE) col = "#b45309";
      else { const s = w.shops.find(s => tx >= s.tx && tx <= s.tx + 1 && ty >= s.ty && ty <= s.ty + 1); col = s ? SHOPS[s.kind].color : "#eee"; }
      ctx.fillStyle = col; ctx.fillRect(tx * S, ty * S, S, S);
      if (w.isLockedTile(tx, ty)) { ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(tx * S, ty * S, S, S); }
    }
    this.mapDirty = false;
  }
  drawMinimap() {
    if (this.mapDirty) this.buildMapCache();
    const g = this.game, m = this.mctx, p = g.player, size = this.mini.width;
    const view = 26 * 8, scale = size / view;
    const sx = p.x / TILE * 8 - view / 2, sy = p.y / TILE * 8 - view / 2;
    m.fillStyle = "#07090d"; m.fillRect(0, 0, size, size);
    m.drawImage(this.mapCache, sx, sy, view, view, 0, 0, size, size);
    const dot = (x, y, col, r) => { m.fillStyle = col; m.beginPath(); m.arc((x / TILE * 8 - sx) * scale, (y / TILE * 8 - sy) * scale, r, 0, 7); m.fill(); };
    if (g.step === "shop") for (const s of g.world.shops) if (g.unlocked.has(s.city) && g.shopHasMissing(s.kind)) dot(s.x, s.y, "#22c55e", 4);
    for (const s of g.strangers) dot(s.x, s.y, "#f97316", 2.5);
    for (const v of g.police) dot(v.x, v.y, "#ef4444", 3);
    for (const v of g.vehicles) if ((v.kind === "rental" || v.owned) && v.driver !== "player") dot(v.x, v.y, "#f4f1de", 2.5);
    if (g.fare) dot(g.fare.dest.x, g.fare.dest.y, "#facc15", 4);
    else if (g.spot && g.step) dot(g.spot.x, g.spot.y, "#facc15", 4);
    m.save(); m.translate((p.x / TILE * 8 - sx) * scale, (p.y / TILE * 8 - sy) * scale); m.rotate(p.angle);
    m.fillStyle = "#fff"; m.beginPath(); m.moveTo(6, 0); m.lineTo(-4, -4); m.lineTo(-4, 4); m.closePath(); m.fill(); m.restore();
  }
  drawBigMap(canvas) {
    if (this.mapDirty) this.buildMapCache();
    const g = this.game, ctx = canvas.getContext("2d"), S = canvas.width, k = S / (CITY * 8);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapCache, 0, 0, S, S);
    const pt = (x, y) => [x / TILE * 8 * k, y / TILE * 8 * k];
    const dot = (x, y, col, r) => { const [a, b] = pt(x, y); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(a, b, r, 0, 7); ctx.fill(); };
    ctx.font = "12px sans-serif"; ctx.textAlign = "center";
    for (const s of g.world.shops) if (g.unlocked.has(s.city)) { const [a, b] = pt(s.x, s.y); ctx.fillText(SHOPS[s.kind].icon, a, b + 4); }
    for (const h of Object.values(g.world.homes)) if (g.unlocked.has(h.city)) { const [a, b] = pt(h.x, h.y); ctx.fillText("🏠", a, b + 4); }
    for (const ga of g.world.garages) if (g.unlocked.has(ga.city)) { const [a, b] = pt(ga.x, ga.y); ctx.fillText("🔧", a, b + 4); }
    for (const s of g.strangers) dot(s.x, s.y, "#f97316", 3);
    for (const v of g.police) dot(v.x, v.y, "#ef4444", 4);
    for (const v of g.vehicles) if ((v.kind === "rental" || v.owned) && v.driver !== "player") dot(v.x, v.y, "#f4f1de", 3);
    if (g.fare) { dot(g.fare.dest.x, g.fare.dest.y, "#facc15", 6); const [a, b] = pt(g.fare.dest.x, g.fare.dest.y); ctx.fillStyle = "#facc15"; ctx.font = "bold 11px sans-serif"; ctx.fillText("Fare drop-off", a, b - 9); }
    if (g.spot && g.step) { dot(g.spot.x, g.spot.y, "#facc15", 6); const [a, b] = pt(g.spot.x, g.spot.y); ctx.fillStyle = "#facc15"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.fillText(g.ep.name, a, b - 9); }
    dot(g.player.x, g.player.y, "#fff", 5);
    ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center";
    const names = { ny: [12, 3], fl: [37, 3], chi: [12, 47], la: [37, 44] };
    for (const [id, [tx, ty]] of Object.entries(names)) {
      ctx.fillStyle = g.unlocked.has(id) ? "#fff" : "#94a3b8";
      ctx.fillText((g.unlocked.has(id) ? "" : "🔒 ") + CITIES[id].name.toUpperCase(), tx * 8 * k, ty * 8 * k);
    }
  }
}
