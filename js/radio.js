// Procedural car radio: four stations, each a generated loop. Nothing is sampled or downloaded.
const STATIONS = [
  { name: "Kitchen FM",       tag: "lo-fi for prep work",      bpm: 82,  scale: [0, 3, 5, 7, 10, 12, 15], root: 220, lead: "sine",     bass: "triangle", hats: 2, kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1] },
  { name: "Bayfront Bass",    tag: "Miami, windows down",      bpm: 106, scale: [0, 2, 4, 7, 9, 12, 14], root: 196, lead: "square",   bass: "sawtooth", hats: 1, kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  { name: "South Side House", tag: "Chicago, four on the floor", bpm: 124, scale: [0, 3, 5, 7, 10, 12], root: 174, lead: "sawtooth", bass: "square",   hats: 1, kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  { name: "Boardwalk Radio",  tag: "Venice, golden hour",      bpm: 96,  scale: [0, 2, 4, 5, 7, 9, 11, 12], root: 261, lead: "triangle", bass: "triangle", hats: 2, kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0], snare: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0] },
];

const radio = (() => {
  let ctx = null, master = null, timer = null, step = 0, nextT = 0, station = 0, on = false, seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  let bassLine = [], leadLine = [];
  const ac = () => { try { if (!ctx) { ctx = new (window.AudioContext || window.webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.16; master.connect(ctx.destination); } if (ctx.state === "suspended") ctx.resume(); return ctx; } catch (e) { return null; } };
  const compose = () => {
    const s = STATIONS[station]; seed = 11 + station * 97;
    bassLine = []; leadLine = [];
    for (let i = 0; i < 16; i++) { bassLine.push(i % 4 === 0 || rnd() < 0.35 ? s.scale[Math.floor(rnd() * 3)] : null); leadLine.push(rnd() < 0.55 ? s.scale[Math.floor(rnd() * s.scale.length)] : null); }
  };
  const osc = (type, freq, t, dur, vol, slide) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  };
  const noise = (t, dur, vol, hp) => {
    const n = ctx.sampleRate * dur, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = buf; f.type = "highpass"; f.frequency.value = hp; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur);
  };
  const schedule = () => {
    const s = STATIONS[station], spb = 60 / s.bpm / 4;
    while (nextT < ctx.currentTime + 0.25) {
      const i = step % 16, t = nextT;
      if (s.kick[i]) osc("sine", 150, t, 0.25, 0.9, 0.3);
      if (s.snare[i]) noise(t, 0.12, 0.35, 1800);
      if (i % s.hats === 0) noise(t, 0.04, 0.12, 6000);
      const b = bassLine[i]; if (b !== null) osc(s.bass, s.root / 2 * Math.pow(2, b / 12), t, spb * 1.8, 0.35);
      const l = leadLine[i]; if (l !== null && (step >> 4) % 2 === 1) osc(s.lead, s.root * 2 * Math.pow(2, l / 12), t, spb * 1.2, 0.12);
      nextT += spb; step++;
    }
  };
  return {
    get station() { return STATIONS[station]; },
    get on() { return on; },
    set(i) { station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length; compose(); },
    next() { this.set(station + 1); return STATIONS[station]; },
    index() { return station; },
    start() {
      if (on || !ac()) return; on = true; compose(); step = 0; nextT = ctx.currentTime + 0.05;
      timer = setInterval(() => { if (on) schedule(); }, 100);
    },
    stop() { on = false; if (timer) clearInterval(timer); timer = null; },
  };
})();
