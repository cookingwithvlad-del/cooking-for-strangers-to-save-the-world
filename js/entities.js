function hitsSolid(x, y, r, solid) {
  const d = r * 0.707;
  return solid(x - r, y) || solid(x + r, y) || solid(x, y - r) || solid(x, y + r) ||
         solid(x - d, y - d) || solid(x + d, y - d) || solid(x - d, y + d) || solid(x + d, y + d);
}
function tryMove(e, dx, dy, r, solid) {
  const res = { x: true, y: true };
  if (dx !== 0) { if (!hitsSolid(e.x + dx, e.y, r, solid)) e.x += dx; else res.x = false; }
  if (dy !== 0) { if (!hitsSolid(e.x, e.y + dy, r, solid)) e.y += dy; else res.y = false; }
  return res;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const VEHICLE_SPECS = {
  rental: { name: "The Rental",  maxSpeed: 235, accel: 200, turn: 2.9, len: 36, wid: 18, r: 13, color: "#f4f1de" },
  car:    { name: "Sedan",       maxSpeed: 240, accel: 200, turn: 3.0, len: 32, wid: 16, r: 12, color: null },
  police: { name: "Police",      maxSpeed: 245, accel: 240, turn: 3.3, len: 34, wid: 17, r: 12, color: "#f8fafc" },
};
const CAR_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#14b8a6", "#f97316", "#e2e8f0", "#64748b", "#facc15"];
const LANE = 7;

class Vehicle {
  constructor(kind, x, y, angle, rng) {
    Object.assign(this, VEHICLE_SPECS[kind]);
    this.kind = kind; this.x = x; this.y = y; this.angle = angle; this.speed = 0;
    this.hp = 100; this.driver = null; this.ai = kind === "car"; this.speedBonus = 0;
    this.color = this.color || CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
    this.dir = 0; this.next = { x: 0, y: 0 }; this.reverseT = 0; this.reverseSign = 1;
  }
  updatePlayer(dt, input, solid) {
    const max = this.hp <= 0 ? 60 : this.maxSpeed + this.speedBonus;
    if (input.down("up")) this.speed += this.accel * dt;
    else if (input.down("down")) this.speed -= this.accel * 0.8 * dt;
    else { const f = 150 * dt; this.speed = Math.abs(this.speed) <= f ? 0 : this.speed - Math.sign(this.speed) * f; }
    this.speed = Math.max(-max * 0.45, Math.min(max, this.speed));
    const steer = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
    if (steer && Math.abs(this.speed) > 4) {
      const k = Math.min(1, Math.abs(this.speed) / 90 + 0.25);
      this.angle += steer * this.turn * dt * k * (this.speed < 0 ? -1 : 1);
    }
    return this.integrate(dt, solid);
  }
  integrate(dt, solid) {
    const dx = Math.cos(this.angle) * this.speed * dt, dy = Math.sin(this.angle) * this.speed * dt;
    const m = tryMove(this, dx, dy, this.r, solid);
    if (!m.x || !m.y) {
      const hard = Math.abs(this.speed) > 110;
      if (hard) this.hp = Math.max(0, this.hp - 12);
      this.speed *= -0.3;
      return hard ? "hard" : "soft";
    }
    return null;
  }
  placeOnRoad(tx, ty, dir, world) { this.dir = dir; this.snapLane(tx, ty); this.computeNext(); }
  snapLane(tx, ty) {
    const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
    const [dx, dy] = DIRS[this.dir];
    this.x = cx + (dy !== 0 ? -dy * LANE : 0);
    this.y = cy + (dx !== 0 ? dx * LANE : 0);
    this.angle = Math.atan2(dy, dx);
  }
  computeNext() {
    const tx = Math.floor(this.x / TILE), ty = Math.floor(this.y / TILE);
    const [dx, dy] = DIRS[this.dir];
    let nx = tx, ny = ty;
    if (dx > 0) nx = tx % 5 === 0 ? tx + 5 : Math.ceil(tx / 5) * 5;
    if (dx < 0) nx = tx % 5 === 0 ? tx - 5 : Math.floor(tx / 5) * 5;
    if (dy > 0) ny = ty % 5 === 0 ? ty + 5 : Math.ceil(ty / 5) * 5;
    if (dy < 0) ny = ty % 5 === 0 ? ty - 5 : Math.floor(ty / 5) * 5;
    this.next = { x: nx * TILE + TILE / 2, y: ny * TILE + TILE / 2 };
  }
  updateTraffic(dt, world, obstacles) {
    const [dx, dy] = DIRS[this.dir];
    const ax = this.x + dx * 36, ay = this.y + dy * 36;
    let blocked = false;
    for (const o of obstacles) {
      if (o === this) continue;
      if (Math.hypot(o.x - ax, o.y - ay) < (o.r || 8) + 14) { blocked = true; break; }
    }
    const target = blocked ? 0 : 95;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), 170 * dt);
    this.x += dx * this.speed * dt; this.y += dy * this.speed * dt;
    const n = this.next;
    const passed = (dx > 0 && this.x >= n.x) || (dx < 0 && this.x <= n.x) || (dy > 0 && this.y >= n.y) || (dy < 0 && this.y <= n.y);
    if (passed) {
      const itx = Math.round((n.x - TILE / 2) / TILE), ity = Math.round((n.y - TILE / 2) / TILE);
      const opts = [];
      for (let d = 0; d < 4; d++) {
        if (d === (this.dir + 2) % 4) continue;
        const [ox, oy] = DIRS[d];
        if (world.get(itx + ox, ity + oy) === T.ROAD && !world.isLockedTile(itx + ox, ity + oy)) opts.push(d);
      }
      let nd;
      if (opts.length === 0) nd = (this.dir + 2) % 4;
      else if (opts.includes(this.dir) && world.rng() < 0.55) nd = this.dir;
      else nd = opts[Math.floor(world.rng() * opts.length)];
      this.dir = nd; this.snapLane(itx, ity); this.computeNext();
    }
  }
  updateChase(dt, target, solid) {
    if (this.reverseT > 0) {
      this.reverseT -= dt; this.speed = -70;
      this.angle += this.reverseSign * this.turn * 0.8 * dt;
    } else {
      const want = Math.atan2(target.y - this.y, target.x - this.x);
      const diff = wrapAngle(want - this.angle);
      this.angle += Math.max(-this.turn * dt, Math.min(this.turn * dt, diff));
      const far = Math.hypot(target.x - this.x, target.y - this.y);
      const max = far < 70 ? 130 : this.maxSpeed;
      this.speed = Math.min(max, this.speed + this.accel * dt);
    }
    const dx = Math.cos(this.angle) * this.speed * dt, dy = Math.sin(this.angle) * this.speed * dt;
    const m = tryMove(this, dx, dy, this.r, solid);
    if ((!m.x || !m.y) && this.reverseT <= 0) {
      this.reverseT = 0.7; this.reverseSign = Math.random() < 0.5 ? -1 : 1; this.speed = 0;
    }
  }
}

const SHIRTS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#ec4899", "#94a3b8", "#1e293b"];
const SKINS = ["#f1c9a5", "#e0ac69", "#c68642", "#8d5524", "#5c3a21", "#ffdbac"];

class Ped {
  constructor(x, y, rng) {
    this.x = x; this.y = y; this.r = 7;
    this.angle = Math.floor(rng() * 4) * Math.PI / 2;
    this.speed = 35 + rng() * 30;
    this.state = "walk"; this.timer = 1 + rng() * 3;
    this.shirt = SHIRTS[Math.floor(rng() * SHIRTS.length)];
    this.skin = SKINS[Math.floor(rng() * SKINS.length)];
    this.walkT = rng() * 10;
  }
  update(dt, solid, rng, player) {
    this.walkT += dt;
    if (this.state === "stunned") {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = "flee"; this.timer = 4; }
      return;
    }
    let sp = this.speed;
    this.timer -= dt;
    if (this.state === "flee") {
      sp *= 2.6;
      if (player) this.angle = Math.atan2(this.y - player.y, this.x - player.x);
      if (this.timer <= 0) { this.state = "walk"; this.timer = 2; }
    } else if (this.timer <= 0) {
      this.angle = Math.floor(rng() * 4) * Math.PI / 2; this.timer = 1 + rng() * 4;
    }
    const m = tryMove(this, Math.cos(this.angle) * sp * dt, Math.sin(this.angle) * sp * dt, this.r, solid);
    if (!m.x || !m.y) { this.angle = Math.floor(rng() * 4) * Math.PI / 2; this.timer = 1 + rng() * 3; }
  }
}

class Stranger {
  constructor(x, y, city, plate, rng) {
    this.x = x; this.y = y; this.r = 8; this.city = city; this.plate = plate;
    this.t = rng() * 10;
    this.shirt = SHIRTS[Math.floor(rng() * SHIRTS.length)];
    this.skin = SKINS[Math.floor(rng() * SKINS.length)];
    this.angle = -Math.PI / 2;
  }
}

class Player {
  constructor(x, y) { this.x = x; this.y = y; this.angle = 0; this.r = 8; this.vehicle = null; this.walkT = 0; }
}
