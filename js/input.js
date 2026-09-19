const KEYMAP = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  KeyE: "enter", KeyF: "act", Enter: "act", KeyC: "cook", KeyB: "book", KeyM: "map",
  KeyT: "phone", KeyR: "radio", KeyH: "horn", KeyV: "camera",
  Escape: "pause", KeyP: "pause", Space: "space",
  Digit1: "opt1", Digit2: "opt2", Digit3: "opt3",
};

class Input {
  constructor() {
    this.state = {}; this.pressedNow = {};
    addEventListener("keydown", e => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (["up", "down", "left", "right", "space"].includes(a)) e.preventDefault();
      if (!e.repeat && !this.state[a]) this.pressedNow[a] = true;
      this.state[a] = true;
    });
    addEventListener("keyup", e => { const a = KEYMAP[e.code]; if (a) this.state[a] = false; });
    addEventListener("blur", () => { this.state = {}; });
    this.touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (this.touch) this.bindTouch();
  }
  bindTouch() {
    const wrap = document.getElementById("touch");
    if (!wrap) return;
    wrap.classList.remove("hidden");
    document.body.classList.add("touch");
    wrap.querySelectorAll("[data-key]").forEach(btn => {
      const a = btn.dataset.key;
      const on = e => { e.preventDefault(); btn.setPointerCapture && btn.setPointerCapture(e.pointerId); sfx.unlock(); if (!this.state[a]) this.pressedNow[a] = true; this.state[a] = true; btn.classList.add("on"); };
      const off = e => { e.preventDefault(); this.state[a] = false; btn.classList.remove("on"); };
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off); btn.addEventListener("pointercancel", off);
      btn.addEventListener("contextmenu", e => e.preventDefault());
    });
    this.bindStick();
  }
  bindStick() {
    const zone = document.getElementById("stick"), knob = document.getElementById("knob");
    if (!zone) return;
    let id = null, cx = 0, cy = 0;
    const DEAD = 12, MAXR = 46;
    const apply = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      if (len > MAXR) { dx *= MAXR / len; dy *= MAXR / len; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const axis = (v, neg, pos) => {
        const n = v < -DEAD, p = v > DEAD;
        if (n && !this.state[neg]) this.pressedNow[neg] = true;
        if (p && !this.state[pos]) this.pressedNow[pos] = true;
        this.state[neg] = n; this.state[pos] = p;
      };
      axis(dx, "left", "right"); axis(dy, "up", "down");
    };
    const move = e => { const r = zone.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; apply(e.clientX - cx, e.clientY - cy); };
    zone.addEventListener("pointerdown", e => { e.preventDefault(); if (id !== null) return; id = e.pointerId; zone.setPointerCapture(id); zone.classList.add("on"); sfx.unlock(); move(e); });
    zone.addEventListener("pointermove", e => { if (e.pointerId === id) move(e); });
    const end = e => { if (e.pointerId !== id) return; id = null; zone.classList.remove("on"); apply(0, 0); };
    zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);
    zone.addEventListener("contextmenu", e => e.preventDefault());
  }
  down(a) { return !!this.state[a]; }
  pressed(a) { return !!this.pressedNow[a]; }
  press(a) { this.pressedNow[a] = true; }
  endFrame() { this.pressedNow = {}; }
}
