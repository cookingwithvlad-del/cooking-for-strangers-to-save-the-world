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
function carHits(v, x, y, r) {
  const dx = x - v.x, dy = y - v.y, c = Math.cos(v.angle), s = Math.sin(v.angle);
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) < v.len / 2 + r * 0.6 && Math.abs(ly) < v.wid / 2 + r * 0.6;
}
const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const VEHICLE_SPECS = {
  rental:    { name: "The Rental",  maxSpeed: 235, accel: 200, turn: 2.9, len: 36, wid: 18, r: 13, maxHp: 100, color: "#f4f1de", price: 0 },
  sedan:     { name: "Sedan",       maxSpeed: 230, accel: 190, turn: 3.0, len: 32, wid: 16, r: 12, maxHp: 100 },
  taxi:      { name: "Taxi",        maxSpeed: 240, accel: 200, turn: 3.0, len: 33, wid: 16, r: 12, maxHp: 100, color: "#facc15", price: 900 },
  sports:    { name: "Sports Car",  maxSpeed: 340, accel: 320, turn: 3.5, len: 34, wid: 15, r: 12, maxHp: 80,  price: 3200 },
  van:       { name: "Van",         maxSpeed: 200, accel: 150, turn: 2.5, len: 38, wid: 19, r: 14, maxHp: 140 },
  bus:       { name: "City Bus",    maxSpeed: 175, accel: 100, turn: 1.9, len: 58, wid: 20, r: 18, maxHp: 220, color: "#e2e8f0" },
  scooter:   { name: "Scooter",     maxSpeed: 255, accel: 280, turn: 4.4, len: 20, wid: 10, r: 7,  maxHp: 40,  price: 350 },
  foodtruck: { name: "Food Truck",  maxSpeed: 210, accel: 160, turn: 2.6, len: 44, wid: 20, r: 15, maxHp: 160, color: "#fb923c", price: 1800 },
  police:    { name: "Police",      maxSpeed: 265, accel: 250, turn: 3.3, len: 34, wid: 17, r: 12, maxHp: 120, color: "#f8fafc" },
};
const TRAFFIC_MIX = [["sedan", 42], ["taxi", 18], ["van", 12], ["sports", 8], ["bus", 7], ["scooter", 13]];
const CAR_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#14b8a6", "#f97316", "#e2e8f0", "#64748b", "#facc15", "#0f172a", "#7f1d1d", "#a3e635", "#f472b6"];
const LANE = 7;

function pickTrafficKind(rng) {
  const total = TRAFFIC_MIX.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [k, w] of TRAFFIC_MIX) { r -= w; if (r <= 0) return k; }
  return "sedan";
}

class Vehicle {
  constructor(kind, x, y, angle, rng) {
    Object.assign(this, VEHICLE_SPECS[kind]);
    this.kind = kind; this.x = x; this.y = y; this.angle = angle; this.speed = 0;
    this.hp = this.maxHp; this.driver = null; this.ai = false; this.speedBonus = 0;
    this.color = this.color || CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
    this.dir = 0; this.next = { x: 0, y: 0 }; this.reverseT = 0; this.reverseSign = 1;
    this.braking = false; this.reversing = false; this.blockedT = 0; this.honkT = 0; this.stopT = 0; this.pausedSeg = false;
    this.owned = false; this.city = null;
  }
  get dead() { return this.hp <= 0; }
  updatePlayer(dt, input, solid, wet) {
    const max = this.dead ? 55 : this.maxSpeed + this.speedBonus;
    const grip = wet ? 0.8 : 1;
    this.braking = false; this.reversing = false;
    if (input.down("up")) this.speed += this.accel * dt * grip;
    else if (input.down("down")) { this.speed -= this.accel * 0.8 * dt; this.braking = this.speed > 0; this.reversing = this.speed <= 0; }
    else { const f = (wet ? 100 : 150) * dt; this.speed = Math.abs(this.speed) <= f ? 0 : this.speed - Math.sign(this.speed) * f; }
    this.speed = Math.max(-max * 0.45, Math.min(max, this.speed));
    const steer = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
    this.skidding = false;
    if (steer && Math.abs(this.speed) > 4) {
      const k = Math.min(1, Math.abs(this.speed) / 90 + 0.25) * (wet ? 1.15 : 1);
      this.angle += steer * this.turn * dt * k * (this.speed < 0 ? -1 : 1);
      this.skidding = Math.abs(this.speed) > 150;
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
  placeOnRoad(tx, ty, dir) { this.dir = dir; this.snapLane(tx, ty); this.computeNext(); }
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
    this.pausedSeg = false;
  }
  updateTraffic(dt, world, obstacles, player) {
    const [dx, dy] = DIRS[this.dir];
    const ahead = 30 + this.len / 2;
    const ax = this.x + dx * ahead, ay = this.y + dy * ahead;
    let blocked = false, blockedByPlayer = false;
    for (const o of obstacles) {
      if (o === this) continue;
      if (Math.hypot(o.x - ax, o.y - ay) < (o.r || 8) + 14) { blocked = true; if (o === player || o === player.vehicle) blockedByPlayer = true; break; }
    }
    this.blockedT = blockedByPlayer ? this.blockedT + dt : 0;
    if (this.blockedT > 1.4 && this.honkT <= 0) { this.honkT = 2.5; this.honk = true; }
    if (this.honkT > 0) this.honkT -= dt;
    const n = this.next;
    const dn = Math.hypot(n.x - this.x, n.y - this.y);
    if (!this.pausedSeg && dn < 46) { this.pausedSeg = true; if (world.rng() < 0.35) this.stopT = 0.5 + world.rng() * 0.9; }
    if (this.stopT > 0) { this.stopT -= dt; blocked = true; }
    const cruise = this.kind === "sports" ? 125 : this.kind === "bus" ? 75 : this.kind === "scooter" ? 105 : 95;
    const target = blocked ? 0 : cruise;
    this.braking = target < this.speed - 5;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), 170 * dt);
    this.x += dx * this.speed * dt; this.y += dy * this.speed * dt;
    const passed = (dx > 0 && this.x >= n.x) || (dx < 0 && this.x <= n.x) || (dy > 0 && this.y >= n.y) || (dy < 0 && this.y <= n.y);
    if (passed) {
      const itx = Math.round((n.x - TILE / 2) / TILE), ity = Math.round((n.y - TILE / 2) / TILE);
      const opts = [];
      for (let d = 0; d < 4; d++) {
        if (d === (this.dir + 2) % 4) continue;
        const [ox, oy] = DIRS[d];
        if (world.isRoad(itx + ox, ity + oy) && !world.isLockedTile(itx + ox, ity + oy)) opts.push(d);
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

class Dog {
  constructor(owner, rng) {
    this.owner = owner; this.x = owner.x + 10; this.y = owner.y + 8; this.angle = 0; this.r = 4;
    this.color = DOG_COLORS[Math.floor(rng() * DOG_COLORS.length)]; this.t = rng() * 10;
  }
  update(dt) {
    this.t += dt;
    const o = this.owner;
    const tx = o.x - Math.cos(o.angle) * 14 + Math.cos(o.angle + Math.PI / 2) * 9, ty = o.y - Math.sin(o.angle) * 14 + Math.sin(o.angle + Math.PI / 2) * 9;
    const d = Math.hypot(tx - this.x, ty - this.y);
    if (d > 3) { const sp = Math.min(d * 5, 220) * dt; this.x += (tx - this.x) / d * sp; this.y += (ty - this.y) / d * sp; this.angle = Math.atan2(ty - this.y, tx - this.x); }
  }
}

class Ped {
  constructor(x, y, rng, city) {
    Object.assign(this, makePerson(rng, city));
    this.x = x; this.y = y; this.r = 7; this.city = city;
    this.dir = Math.floor(rng() * 4); this.angle = this.dir * Math.PI / 2;
    this.speed = 34 + rng() * 28;
    this.state = "walk"; this.timer = 1 + rng() * 3;
    this.walkT = rng() * 10; this.sayT = 0; this.say = null; this.umbrella = rng() < 0.45;
    this.dog = rng() < 0.12 ? new Dog(this, rng) : null;
    this.partner = null; this.target = null;
  }
  speak(text, secs = 3.2) { this.say = text; this.sayT = secs; }
  update(dt, world, rng, player) {
    this.walkT += dt;
    if (this.sayT > 0) { this.sayT -= dt; if (this.sayT <= 0) this.say = null; }
    if (this.dog) this.dog.update(dt);
    const solid = world.solidFoot;
    switch (this.state) {
      case "stunned":
        this.timer -= dt;
        if (this.timer <= 0) { this.state = "flee"; this.timer = 4; this.speak(HIT_LINES[Math.floor(rng() * HIT_LINES.length)]); }
        return;
      case "idle": case "chat":
        this.timer -= dt;
        if (this.state === "chat" && this.partner) this.angle = Math.atan2(this.partner.y - this.y, this.partner.x - this.x);
        if (this.timer <= 0) { this.state = "walk"; this.timer = 2 + rng() * 4; this.partner = null; this.pickDir(world, rng); }
        return;
      case "flee": {
        this.timer -= dt;
        if (player) this.angle = Math.atan2(this.y - player.y, this.x - player.x);
        const m = tryMove(this, Math.cos(this.angle) * this.speed * 2.6 * dt, Math.sin(this.angle) * this.speed * 2.6 * dt, this.r, solid);
        if (!m.x || !m.y) this.angle += Math.PI / 2;
        if (this.timer <= 0) { this.state = "walk"; this.timer = 2; this.pickDir(world, rng); }
        return;
      }
      case "angry": {
        this.timer -= dt;
        if (this.target) {
          const t = this.target.vehicle || this.target;
          this.angle = Math.atan2(t.y - this.y, t.x - this.x);
          const m = tryMove(this, Math.cos(this.angle) * this.speed * 2.2 * dt, Math.sin(this.angle) * this.speed * 2.2 * dt, this.r, solid);
          if (!m.x || !m.y) this.angle += 1;
          if (Math.random() < dt * 0.4) this.speak(ANGRY_LINES[Math.floor(rng() * ANGRY_LINES.length)], 2);
        }
        if (this.timer <= 0) { this.state = "walk"; this.timer = 3; this.target = null; this.pickDir(world, rng); }
        return;
      }
      default: {
        this.timer -= dt;
        if (this.timer <= 0) {
          if (rng() < 0.18) { this.state = "idle"; this.timer = 2 + rng() * 5; return; }
          this.pickDir(world, rng); this.timer = 1.5 + rng() * 4;
        }
        const [dx, dy] = DIRS[this.dir];
        const m = tryMove(this, dx * this.speed * dt, dy * this.speed * dt, this.r, solid);
        if (!m.x || !m.y) { this.pickDir(world, rng, true); this.timer = 1 + rng() * 3; }
      }
    }
  }
  pickDir(world, rng, forceChange) {
    const tx = Math.floor(this.x / TILE), ty = Math.floor(this.y / TILE);
    const here = world.get(tx, ty);
    const onRoad = here === T.ROAD || here === T.BRIDGE;
    const back = (this.dir + 2) % 4;
    const scored = [];
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIRS[d];
      let s = world.walkScore(tx + dx, ty + dy);
      if (world.isLockedTile(tx + dx, ty + dy)) s = 0;
      if (s === 0) continue;
      if (d === back) s *= 0.15;
      if (d === this.dir) s *= onRoad ? 6 : 1.6;
      if (forceChange && d === this.dir) s *= 0.1;
      scored.push([d, s]);
    }
    if (!scored.length) { this.dir = back; this.angle = this.dir * Math.PI / 2; return; }
    const total = scored.reduce((a, [, s]) => a + s, 0);
    let r = rng() * total;
    for (const [d, s] of scored) { r -= s; if (r <= 0) { this.dir = d; break; } }
    this.angle = this.dir * Math.PI / 2;
  }
}

class Stranger {
  constructor(x, y, city, plate, rng) {
    Object.assign(this, makePerson(rng, city));
    this.x = x; this.y = y; this.r = 8; this.city = city; this.plate = plate;
    this.t = rng() * 10; this.angle = -Math.PI / 2;
  }
}

class Player {
  constructor(x, y) { this.x = x; this.y = y; this.angle = 0; this.r = 8; this.vehicle = null; this.walkT = 0; this.stun = 0; }
}
