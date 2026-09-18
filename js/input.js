const KEYMAP = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  KeyE: "enter", KeyF: "act", Enter: "act", KeyC: "cook", KeyB: "book", KeyM: "map",
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
    wrap.querySelectorAll("[data-key]").forEach(btn => {
      const a = btn.dataset.key;
      const on = e => { e.preventDefault(); if (!this.state[a]) this.pressedNow[a] = true; this.state[a] = true; btn.classList.add("on"); };
      const off = e => { e.preventDefault(); this.state[a] = false; btn.classList.remove("on"); };
      btn.addEventListener("touchstart", on, { passive: false });
      btn.addEventListener("touchend", off); btn.addEventListener("touchcancel", off);
      btn.addEventListener("mousedown", on); btn.addEventListener("mouseup", off); btn.addEventListener("mouseleave", off);
    });
  }
  down(a) { return !!this.state[a]; }
  pressed(a) { return !!this.pressedNow[a]; }
  press(a) { this.pressedNow[a] = true; }
  endFrame() { this.pressedNow = {}; }
}
