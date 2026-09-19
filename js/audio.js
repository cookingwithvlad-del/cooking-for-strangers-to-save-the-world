const sfx = (() => {
  let ctx = null;
  const ac = () => {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (e) { return null; }
  };
  const tone = (freq, dur, type = "square", vol = 0.08, slide = 0) => {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
  };
  return {
    unlock() { ac(); },
    chime() { tone(660, 0.12, "triangle", 0.1); setTimeout(() => tone(880, 0.16, "triangle", 0.1), 110); setTimeout(() => tone(1320, 0.25, "triangle", 0.1), 220); },
    cash() { tone(1200, 0.08, "square", 0.06); setTimeout(() => tone(1600, 0.1, "square", 0.06), 70); },
    bump() { tone(120, 0.18, "sawtooth", 0.12, -80); },
    tick() { tone(500, 0.05, "square", 0.05); },
    good() { tone(900, 0.1, "triangle", 0.1); },
    bad() { tone(200, 0.25, "sawtooth", 0.1, -120); },
    siren() { tone(700, 0.3, "sine", 0.05, 300); },
    no() { tone(300, 0.15, "square", 0.07, -100); },
    unlockCity() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => tone(f, 0.3, "triangle", 0.1), i * 140)); },
    horn() { tone(392, 0.35, "sawtooth", 0.09); tone(494, 0.35, "sawtooth", 0.07); },
  };
})();
