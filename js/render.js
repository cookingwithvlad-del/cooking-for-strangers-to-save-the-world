class Renderer {
  constructor(canvas, game) {
    this.c = canvas; this.ctx = canvas.getContext("2d"); this.game = game;
    this.cam = { x: 0, y: 0 };
    this.mini = document.getElementById("minimap");
    this.mctx = this.mini.getContext("2d");
    this.mapCache = document.createElement("canvas");
    this.mapCache.width = CITY * 8; this.mapCache.height = CITY * 8;
    this.mapDirty = true;
  }
  invalidateMap() { this.mapDirty = true; }
  resize() { this.c.width = innerWidth; this.c.height = innerHeight; }

  hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

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
    this.drawSpot();
    for (const s of g.strangers) this.drawFigure(s.x, s.y + Math.sin(s.t * 3) * 1.5, s.angle, s.shirt, s.skin, s.t, "orange");
    for (const pd of g.peds) this.drawPed(pd);
    for (const v of g.vehicles) this.drawVehicle(v);
    for (const v of g.police) this.drawVehicle(v);
    if (!p.vehicle) { this.drawOrly(g.orly); this.drawPlayer(p); }
    for (const s of g.strangers) this.drawBubble(s.x, s.y - 22, s.plate.icon, dist(s, p) < 140 ? s.plate.name : null);
    this.drawShopMarkers();
    this.drawObjectiveArrow();
    ctx.restore();
    this.drawNight(W, H);
    this.drawMinimap();
  }

  drawTiles(cx, cy, W, H) {
    const g = this.game, ctx = this.ctx, w = g.world;
    const x0 = Math.max(0, Math.floor(cx / TILE) - 1), x1 = Math.min(CITY - 1, Math.floor((cx + W) / TILE) + 1);
    const y0 = Math.max(0, Math.floor(cy / TILE) - 1), y1 = Math.min(CITY - 1, Math.floor((cy + H) / TILE) + 1);
    const night = g.nightAmount();
    const labels = [], locks = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = w.get(tx, ty), px = tx * TILE, py = ty * TILE;
      const cityId = cityOfTile(tx, ty), city = CITIES[cityId];
      const lx = tx % 5, ly = ty % 5;
      if (t === T.ROAD) {
        ctx.fillStyle = "#2b2f3a"; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "#c9b458";
        if (tx % 5 === 0 && ty % 5 !== 0) { ctx.fillRect(px + 15, py + 3, 2, 10); ctx.fillRect(px + 15, py + 19, 2, 10); }
        else if (ty % 5 === 0 && tx % 5 !== 0) { ctx.fillRect(px + 3, py + 15, 10, 2); ctx.fillRect(px + 19, py + 15, 10, 2); }
        else { ctx.fillStyle = "#3a3f4b"; ctx.fillRect(px + 2, py + 2, 28, 28); }
      } else if (t === T.SIDEWALK) {
        ctx.fillStyle = cityId === "la" ? "#c8bfa8" : "#a3a7ad"; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(px, py, TILE, 1); ctx.fillRect(px, py, 1, TILE);
      } else if (t === T.PARK) {
        ctx.fillStyle = cityId === "la" ? "#7a9b4a" : "#4c8a3f"; ctx.fillRect(px, py, TILE, TILE);
        const h = this.hash(tx, ty);
        if (h < 0.45) {
          ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.arc(px + 18, py + 18, 9, 0, 7); ctx.fill();
          ctx.fillStyle = cityId === "la" ? "#3f7d2f" : "#2f6b2a"; ctx.beginPath(); ctx.arc(px + 16, py + 16, 9, 0, 7); ctx.fill();
          ctx.fillStyle = "#5ea34e"; ctx.beginPath(); ctx.arc(px + 13, py + 13, 4, 0, 7); ctx.fill();
        }
      } else if (t === T.BUILDING) {
        ctx.fillStyle = city.color; ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = city.roof; ctx.fillRect(px + 3, py + 3, 26, 26);
        for (let wy = 0; wy < 2; wy++) for (let wx = 0; wx < 2; wx++) {
          const lit = this.hash(tx * 2 + wx, ty * 2 + wy) < (0.25 + night * 0.5);
          ctx.fillStyle = lit ? (night > 0.3 ? "#fde68a" : "#e2e8f0") : "#1f2937";
          ctx.fillRect(px + 8 + wx * 11, py + 8 + wy * 11, 5, 5);
        }
      } else if (t === T.SHOP || t === T.HOME) {
        ctx.fillStyle = t === T.HOME ? "#dbeafe" : "#f3f4f6"; ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        if (lx === 2 && ly === 2) labels.push({ tx, ty, px, py, t, cityId });
      }
      if (w.isLockedTile(tx, ty)) {
        ctx.fillStyle = "rgba(4,6,12,0.78)"; ctx.fillRect(px, py, TILE, TILE);
        if ((tx === 12 || tx === 37) && (ty === 7 || ty === 32)) locks.push({ px, py, city });
      }
    }
    for (const l of locks) {
      ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#e5e7eb";
      ctx.fillText("🔒 " + l.city.name.toUpperCase(), l.px + 16, l.py + 10);
      ctx.font = "13px sans-serif"; ctx.fillText("Finish the tables before it to unlock", l.px + 16, l.py + 32);
    }
    for (const l of labels) {
      let icon, name, color;
      if (l.t === T.HOME) { icon = "🏠"; name = "HOME KITCHEN"; color = "#2563eb"; }
      else {
        const s = g.world.shops.find(s => s.tx === l.tx && s.ty === l.ty);
        const sk = SHOPS[s.kind]; icon = sk.icon; name = sk.name.toUpperCase(); color = sk.color;
      }
      ctx.fillStyle = color; ctx.fillRect(l.px, l.py + 48, 64, 14);
      ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      ctx.fillText(name, l.px + 32, l.py + 58);
      ctx.font = "24px sans-serif"; ctx.fillText(icon, l.px + 32, l.py + 36);
    }
  }

  drawSpot() {
    const g = this.game, ctx = this.ctx, s = g.spot;
    if (!s || !g.step) return;
    const t = g.time;
    ctx.fillStyle = "rgba(250,204,21,0.25)";
    ctx.beginPath(); ctx.arc(s.x, s.y, 22 + Math.sin(t * 4) * 3, 0, 7); ctx.fill();
    this.drawFigure(s.x, s.y, -Math.PI / 2, "#475569", "#e0ac69", t, "hat");
    const icon = g.step === "cook" ? "🍳" : g.step === "shop" ? "⏳" : "!";
    const by = s.y - 30 - Math.abs(Math.sin(t * 3)) * 6;
    if (icon === "!") {
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.moveTo(s.x - 8, by - 20); ctx.lineTo(s.x + 8, by - 20); ctx.lineTo(s.x, by - 6); ctx.closePath(); ctx.fill();
      ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#facc15"; ctx.fillText("!", s.x, by - 24);
    } else {
      ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.fillText(icon, s.x, by - 8);
    }
    ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.6)"; const tw = ctx.measureText(g.ep.name).width + 10;
    ctx.fillRect(s.x - tw / 2, s.y + 14, tw, 14); ctx.fillStyle = "#facc15"; ctx.fillText(g.ep.name, s.x, s.y + 25);
  }

  drawShopMarkers() {
    const g = this.game, ctx = this.ctx;
    if (g.step !== "shop") return;
    const t = g.time;
    for (const s of g.world.shops) {
      if (!g.unlocked.has(s.city) || !g.shopHasMissing(s.kind)) continue;
      const by = s.y - 44 - Math.abs(Math.sin(t * 3)) * 6;
      ctx.fillStyle = "#22c55e"; ctx.beginPath(); ctx.arc(s.x, by, 11, 0, 7); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.fillText("$", s.x, by + 5);
    }
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
    const L = v.len, Wd = v.wid;
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(-L / 2 + 2, -Wd / 2 + 3, L, Wd);
    ctx.fillStyle = v.color; this.rr(-L / 2, -Wd / 2, L, Wd, 4); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(-L / 2 + 3, -Wd / 2 + 2, L - 6, 3);
    ctx.fillStyle = "#1f2937"; ctx.fillRect(L / 2 - 13, -Wd / 2 + 3, 6, Wd - 6); ctx.fillRect(-L / 2 + 5, -Wd / 2 + 3, 4, Wd - 6);
    ctx.fillStyle = "#fde68a"; ctx.fillRect(L / 2 - 2, -Wd / 2 + 2, 2, 4); ctx.fillRect(L / 2 - 2, Wd / 2 - 6, 2, 4);
    ctx.fillStyle = "#ef4444"; ctx.fillRect(-L / 2, -Wd / 2 + 2, 2, 4); ctx.fillRect(-L / 2, Wd / 2 - 6, 2, 4);
    if (v.kind === "rental") {
      ctx.fillStyle = "#e11d48"; ctx.fillRect(-L / 2 + 10, -2, L - 24, 4);
      ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🔪", 0, 4);
    }
    if (v.kind === "police") {
      ctx.fillStyle = "#1d4ed8"; ctx.fillRect(-L / 2 + 8, -Wd / 2, L - 16, 3); ctx.fillRect(-L / 2 + 8, Wd / 2 - 3, L - 16, 3);
      const on = Math.floor(g.time * 8) % 2 === 0;
      ctx.fillStyle = on ? "#ef4444" : "#3b82f6"; ctx.fillRect(-5, -4, 4, 8);
      ctx.fillStyle = on ? "#3b82f6" : "#ef4444"; ctx.fillRect(1, -4, 4, 8);
    }
    if (v.hp <= 0) { ctx.fillStyle = "rgba(120,120,120,0.6)"; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(L / 2 - 4 - i * 6 + Math.sin(g.time * 5 + i) * 2, -6 - i * 5, 4 + i, 0, 7); ctx.fill(); } }
    ctx.restore();
  }
  rr(x, y, w, h, r) { const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }

  drawFigure(x, y, angle, shirt, skin, t, style) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(1, 2, 8, 6, 0, 0, 7); ctx.fill();
    const step = Math.sin(t * 10) * 3;
    ctx.fillStyle = "#1f2937"; ctx.fillRect(-2 + step, -5, 4, 3); ctx.fillRect(-2 - step, 2, 4, 3);
    ctx.fillStyle = style === "orange" ? "#f97316" : shirt; this.rr(-5, -7, 10, 14, 3); ctx.fill();
    ctx.fillStyle = skin; ctx.fillRect(3, -8, 3, 3); ctx.fillRect(3, 5, 3, 3);
    ctx.beginPath(); ctx.arc(1, 0, 4.5, 0, 7); ctx.fill();
    if (style === "hat") { ctx.fillStyle = "#374151"; ctx.beginPath(); ctx.arc(1, 0, 4.8, 0, 7); ctx.fill(); ctx.fillStyle = "#6b7280"; ctx.fillRect(-1, -2, 3, 4); }
    if (style === "chef") { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#e5e7eb"; ctx.fillRect(-4, -3, 3, 6); }
    ctx.restore();
  }
  drawPed(pd) {
    const ctx = this.ctx;
    if (pd.state === "stunned") {
      ctx.save(); ctx.translate(pd.x, pd.y);
      ctx.fillStyle = pd.shirt; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0.4, 0, 7); ctx.fill();
      ctx.fillStyle = pd.skin; ctx.beginPath(); ctx.arc(8, -3, 4, 0, 7); ctx.fill();
      ctx.font = "10px sans-serif"; ctx.fillStyle = "#fde047"; ctx.textAlign = "center";
      ctx.fillText("✦", Math.cos(this.game.time * 6) * 8, -10 + Math.sin(this.game.time * 6) * 3);
      ctx.restore();
      return;
    }
    this.drawFigure(pd.x, pd.y, pd.angle, pd.shirt, pd.skin, pd.state === "walk" ? pd.walkT : pd.walkT * 2, null);
  }
  drawPlayer(p) {
    this.drawFigure(p.x, p.y, p.angle, "#f8fafc", "#e0ac69", p.walkT, "chef");
  }
  drawOrly(o) {
    const ctx = this.ctx, t = this.game.time;
    this.drawFigure(o.x, o.y, o.angle, "#1e3a8a", "#f1c9a5", o.walkT || 0, null);
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

  drawNight(W, H) {
    const n = this.game.nightAmount();
    if (n <= 0.02) return;
    this.ctx.fillStyle = `rgba(8,12,40,${0.5 * n})`; this.ctx.fillRect(0, 0, W, H);
  }

  buildMapCache() {
    const w = this.game.world, ctx = this.mapCache.getContext("2d"), S = 8;
    for (let ty = 0; ty < CITY; ty++) for (let tx = 0; tx < CITY; tx++) {
      const t = w.get(tx, ty), cityId = cityOfTile(tx, ty);
      let col;
      if (t === T.ROAD) col = "#3a3f4b";
      else if (t === T.SIDEWALK) col = "#8f949b";
      else if (t === T.PARK) col = "#4c8a3f";
      else if (t === T.BUILDING) col = CITIES[cityId].color;
      else if (t === T.HOME) col = "#60a5fa";
      else { const s = w.shops.find(s => Math.abs(s.tx - tx) <= 1 && Math.abs(s.ty - ty) <= 1 && tx >= s.tx && ty >= s.ty); col = s ? SHOPS[s.kind].color : "#eee"; }
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
    for (const c of Object.values(g.cars)) if (c.driver !== "player") dot(c.x, c.y, "#f4f1de", 2.5);
    if (g.spot && g.step) dot(g.spot.x, g.spot.y, "#facc15", 4);
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
    for (const s of g.world.shops) if (g.unlocked.has(s.city)) { const [a, b] = pt(s.x, s.y); ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText(SHOPS[s.kind].icon, a, b + 4); }
    for (const h of Object.values(g.world.homes)) if (g.unlocked.has(h.city)) { const [a, b] = pt(h.x, h.y); ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("🏠", a, b + 4); }
    for (const s of g.strangers) dot(s.x, s.y, "#f97316", 3);
    for (const v of g.police) dot(v.x, v.y, "#ef4444", 4);
    if (g.spot && g.step) { dot(g.spot.x, g.spot.y, "#facc15", 6); const [a, b] = pt(g.spot.x, g.spot.y); ctx.fillStyle = "#facc15"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.fillText(g.ep.name, a, b - 9); }
    dot(g.player.x, g.player.y, "#fff", 5);
    ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center";
    const names = { ny: [12, 3], fl: [37, 3], chi: [12, 47], la: [37, 47] };
    for (const [id, [tx, ty]] of Object.entries(names)) {
      ctx.fillStyle = g.unlocked.has(id) ? "#fff" : "#94a3b8";
      ctx.fillText((g.unlocked.has(id) ? "" : "🔒 ") + CITIES[id].name.toUpperCase(), tx * 8 * k, ty * 8 * k);
    }
  }
}
