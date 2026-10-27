// Hell Is a Game Show: pixel art and chiptune. Everything is drawn in code at low
// resolution and scaled up with nearest-neighbour, so there are no image files.
(function () {
  'use strict';

  // ---------------------------------------------------------------- sprite kit
  // A sprite is a small grid of palette colours, built with shape helpers and then
  // given a 1px dark outline so it reads as pixel art.
  function grid(w, h) { return { w, h, px: new Array(w * h).fill(null) }; }
  function set(s, x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.px[y * s.w + x] = c; }
  function get(s, x, y) { return x >= 0 && y >= 0 && x < s.w && y < s.h ? s.px[y * s.w + x] : null; }
  function rect(s, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(s, x + i, y + j, c); }
  function oval(s, cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) set(s, x, y, c);
      }
  }
  function outline(s, c) {
    const add = [];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (get(s, x, y)) continue;
      if (get(s, x - 1, y) || get(s, x + 1, y) || get(s, x, y - 1) || get(s, x, y + 1)) add.push([x, y]);
    }
    add.forEach(([x, y]) => set(s, x, y, c));
    return s;
  }
  function toCanvas(s) {
    const c = document.createElement('canvas');
    c.width = s.w; c.height = s.h;
    const g = c.getContext('2d');
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const col = s.px[y * s.w + x];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
    return c;
  }

  // ---------------------------------------------------------------- the demon
  const D = {
    ink: '#1a0508', skin: '#c63a2f', skinLo: '#8f2321', skinHi: '#e2574a',
    horn: '#eadfba', hornLo: '#b3a274', eye: '#ffd84a', bag: '#6d1a26',
    suit: '#2d2347', suitLo: '#1c1631', shirt: '#efe4d4', tie: '#ffb627', mouth: '#3d070d', tooth: '#fff6e8',
  };
  // frame: { eyes: 'bored' | 'shut' | 'wide', mouth: 'flat' | 'open' | 'smirk' }
  function demon(frame) {
    const s = grid(40, 44);
    // Suit and slumped shoulders.
    oval(s, 20, 44, 17, 12, D.suit);
    oval(s, 13, 40, 6, 6, D.suitLo);
    rect(s, 17, 32, 6, 12, D.shirt);
    rect(s, 19, 33, 2, 2, D.tie); rect(s, 18, 35, 4, 7, D.tie); rect(s, 19, 42, 2, 2, D.tie);
    set(s, 16, 33, D.suitLo); set(s, 23, 33, D.suitLo);
    // Neck.
    rect(s, 17, 27, 6, 5, D.skinLo);
    // Horns, curling out and up.
    const hornL = [[9, 12], [8, 11], [7, 10], [7, 9], [6, 8], [6, 7], [6, 6], [7, 5], [7, 4]];
    hornL.forEach(([x, y], k) => { rect(s, x, y, k < 4 ? 3 : 2, 2, D.horn); set(s, x + 1, y + 1, D.hornLo); });
    hornL.forEach(([x, y], k) => { rect(s, 39 - x - (k < 4 ? 3 : 2), y, k < 4 ? 3 : 2, 2, D.horn); set(s, 39 - x - 2, y + 1, D.hornLo); });
    // Head.
    oval(s, 20, 18, 10, 11, D.skin);
    oval(s, 23, 22, 6, 6, D.skinLo);  // jaw shadow
    oval(s, 20, 18, 9, 9, D.skin);
    oval(s, 16, 13, 3, 2, D.skinHi);  // forehead shine
    // Pointy ears.
    set(s, 9, 17, D.skin); set(s, 8, 16, D.skin); set(s, 8, 15, D.skinLo);
    set(s, 30, 17, D.skin); set(s, 31, 16, D.skin); set(s, 31, 15, D.skinLo);
    // Unibrow, flat and fed up.
    rect(s, 13, 15, 6, 1, D.ink); rect(s, 21, 15, 6, 1, D.ink);
    // Eyes.
    for (const ex of [14, 22]) {
      if (frame.eyes === 'shut') rect(s, ex, 18, 4, 1, D.ink);
      else if (frame.eyes === 'wide') { rect(s, ex, 16, 4, 3, D.eye); rect(s, ex + 1, 17, 2, 1, D.ink); }
      else { rect(s, ex, 17, 4, 2, D.eye); rect(s, ex, 17, 4, 1, D.skinLo); rect(s, ex + 1, 18, 2, 1, D.ink); }
      rect(s, ex, 19, 4, 1, D.bag); // eye bags: six thousand years of no sleep
    }
    // Nose.
    set(s, 19, 20, D.skinLo); set(s, 20, 21, D.skinLo);
    // Goatee.
    rect(s, 18, 27, 4, 2, D.ink); set(s, 19, 29, D.ink); set(s, 20, 29, D.ink);
    // Mouth.
    if (frame.mouth === 'open') { rect(s, 16, 23, 8, 3, D.mouth); rect(s, 17, 23, 2, 1, D.tooth); rect(s, 21, 23, 2, 1, D.tooth); }
    else if (frame.mouth === 'smirk') { rect(s, 16, 24, 7, 1, D.mouth); set(s, 23, 23, D.mouth); set(s, 22, 25, D.tooth); }
    else rect(s, 16, 24, 8, 1, D.mouth);
    return toCanvas(outline(s, D.ink));
  }

  // ---------------------------------------------------------------- souls
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = k => Math.max(0, Math.min(255, Math.round(((n >> k) & 255) * f)));
    return '#' + [16, 8, 0].map(k => ch(k).toString(16).padStart(2, '0')).join('');
  }
  // mood: 'idle' | 'happy' | 'sad' | 'think'
  function soul(color, mood, wiggle) {
    const s = grid(16, 18);
    oval(s, 8, 7, 6.5, 6.5, color);
    rect(s, 2, 7, 13, 7, color);
    for (let x = 2; x < 15; x++) if (((x + wiggle) >> 1) % 2 === 0) set(s, x, 14, color);
    oval(s, 6, 4, 2, 1.5, shade(color, 1.35));
    rect(s, 11, 7, 3, 6, shade(color, 0.75));
    const ink = '#1a0508';
    if (mood === 'happy') { set(s, 5, 7, ink); set(s, 6, 6, ink); set(s, 7, 7, ink); set(s, 9, 7, ink); set(s, 10, 6, ink); set(s, 11, 7, ink); rect(s, 6, 10, 5, 1, ink); set(s, 5, 9, ink); set(s, 11, 9, ink); }
    else if (mood === 'sad') { rect(s, 5, 7, 2, 2, ink); rect(s, 10, 7, 2, 2, ink); rect(s, 6, 11, 5, 1, ink); set(s, 5, 12, ink); set(s, 11, 12, ink); set(s, 4, 9, '#7fd4ff'); }
    else if (mood === 'think') { rect(s, 5, 7, 2, 2, ink); rect(s, 10, 6, 2, 2, ink); rect(s, 7, 11, 3, 1, ink); }
    else { rect(s, 5, 7, 2, 2, ink); rect(s, 10, 7, 2, 2, ink); rect(s, 7, 11, 3, 1, ink); }
    return toCanvas(outline(s, ink));
  }

  // ---------------------------------------------------------------- studio
  const W = 320, H = 150;
  function Stage(canvas) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    const frames = {
      bored: demon({ eyes: 'bored', mouth: 'flat' }),
      blink: demon({ eyes: 'shut', mouth: 'flat' }),
      talk: demon({ eyes: 'bored', mouth: 'open' }),
      smirk: demon({ eyes: 'bored', mouth: 'smirk' }),
      wide: demon({ eyes: 'wide', mouth: 'open' }),
    };
    const soulCache = {};
    const soulImg = (color, mood, w) => soulCache[color + mood + w] || (soulCache[color + mood + w] = soul(color, mood, w));
    const embers = Array.from({ length: 26 }, () => ({ x: Math.random() * W, y: H - Math.random() * 60, v: 6 + Math.random() * 10 }));
    let scene = { players: [], talkingUntil: 0, mood: 'bored', shakeUntil: 0, flash: null };
    let last = performance.now();

    // Back wall: a pleated curtain with a lava glow along the bottom.
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    (function paintBackdrop() {
      const b = bg.getContext('2d');
      for (let x = 0; x < W; x++) {
        const fold = Math.sin(x / 5) * 0.5 + 0.5;
        const r = Math.round(70 + fold * 40), gg = Math.round(10 + fold * 8), bb = Math.round(18 + fold * 8);
        b.fillStyle = `rgb(${r},${gg},${bb})`;
        b.fillRect(x, 0, 1, 112);
      }
      // Pelmet with scalloped edge.
      b.fillStyle = '#2a0710'; b.fillRect(0, 0, W, 12);
      for (let x = 0; x < W; x += 16) { b.beginPath(); b.arc(x + 8, 12, 8, 0, Math.PI); b.fill(); }
      b.fillStyle = '#ffb627'; b.fillRect(0, 11, W, 1);
      // Stage floor: dark checks fading into the lava pit.
      for (let y = 112; y < H; y++) for (let x = 0; x < W; x += 8) {
        const even = ((x >> 3) + (y >> 3)) % 2 === 0;
        b.fillStyle = even ? '#241016' : '#1a0a0f';
        b.fillRect(x, y, 8, 1);
      }
      b.fillStyle = '#ff7a2a'; b.fillRect(0, 112, W, 1);
      for (let k = 0; k < 10; k++) { b.fillStyle = `rgba(255,${80 + k * 10},40,${0.09 - k * 0.008})`; b.fillRect(0, H - 1 - k * 2, W, 2); }
    })();

    function bulbs(t) {
      for (let x = 6; x < W; x += 12) {
        const on = (Math.floor(t / 300) + x / 12) % 3 !== 0;
        g.fillStyle = on ? '#ffd84a' : '#6b4a12';
        g.fillRect(x, 3, 3, 3);
        if (on) { g.fillStyle = 'rgba(255,216,74,.25)'; g.fillRect(x - 1, 2, 5, 5); }
      }
    }
    function torch(x, t) {
      g.fillStyle = '#3a2a2a'; g.fillRect(x - 3, 90, 7, 22);
      g.fillStyle = '#1a0508'; g.fillRect(x - 4, 88, 9, 3);
      for (let k = 0; k < 18; k++) {
        const fx = x + Math.round(Math.sin(t / 90 + k * 1.7) * 3);
        const fy = 87 - Math.round(((t / 40 + k * 13) % 18));
        g.fillStyle = k % 3 === 0 ? '#ffd84a' : k % 3 === 1 ? '#ff7a2a' : '#e0281e';
        g.fillRect(fx, fy, 2, 2);
      }
    }
    function desk() {
      g.fillStyle = '#1a0508'; g.fillRect(14, 96, 84, 18);
      g.fillStyle = '#4b1520'; g.fillRect(15, 97, 82, 16);
      g.fillStyle = '#ffb627'; g.fillRect(15, 97, 82, 2);
      g.fillStyle = '#6a1e2b'; for (let x = 19; x < 96; x += 10) g.fillRect(x, 101, 6, 9);
    }
    function podium(x, color, glow, w) {
      const h = w >> 1;
      g.fillStyle = '#1a0508'; g.fillRect(x - h - 1, 96, w + 2, 18);
      g.fillStyle = shade(color, 0.45); g.fillRect(x - h, 97, w, 16);
      g.fillStyle = color; g.fillRect(x - h, 97, w, 2);
      if (glow) { g.fillStyle = 'rgba(255,216,74,.8)'; g.fillRect(x - h + 4, 104, w - 8, 3); g.fillStyle = 'rgba(255,216,74,.18)'; g.fillRect(x - h - 4, 60, w + 8, 36); }
    }
    const seen = {};
    const confetti = [];

    function draw(t) {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const shake = t < scene.shakeUntil ? Math.round(Math.sin(t / 25) * 2) : 0;
      g.setTransform(1, 0, 0, 1, shake, 0);
      g.drawImage(bg, 0, 0);
      bulbs(t);
      torch(6, t); torch(W - 7, t + 400);
      // Demon behind the desk.
      const blinking = (t % 4200) < 140;
      const talking = t < scene.talkingUntil;
      let img = frames.bored;
      if (talking) img = Math.floor(t / 140) % 2 ? frames.talk : frames.bored;
      else if (scene.mood === 'smirk') img = frames.smirk;
      else if (scene.mood === 'wide') img = frames.wide;
      if (blinking && !talking) img = frames.blink;
      const bob = Math.floor(t / 900) % 2;
      g.drawImage(img, 36, 56 + bob, 40, 44);
      desk();
      // Contestants.
      const ps = scene.players;
      const xs = podiumXs(ps.length);
      const pw = Math.min(22, Math.floor(podiumGap(ps.length)) - 2);
      ps.forEach((p, k) => {
        const x = xs[k];
        podium(x, p.color, p.answered, pw);
        let y = 78 + Math.round(Math.sin(t / 400 + k) * 1.5);
        // New arrivals drop in from the rafters.
        if (seen[p.id] == null) seen[p.id] = t;
        const age = (t - seen[p.id]) / 450;
        if (age < 1) y -= Math.round(70 * (1 - age) * (1 - age));
        if (p.falling) y += Math.min(90, (t - p.falling) / 6);
        if (p.falling && t - p.falling < 120) { g.fillStyle = '#000'; g.fillRect(x - 9, 95, 18, 3); }
        if (p.bet) { // soul bet aura
          for (let a = 0; a < 6; a++) { g.fillStyle = a % 2 ? '#ff7a2a' : '#ffd84a'; g.fillRect(x - 9 + ((t / 60 + a * 5) % 18), y - 2 + ((a * 7) % 6), 2, 2); }
        }
        g.drawImage(soulImg(p.color, p.mood || 'idle', Math.floor(t / 200) % 4), x - 8, y);
        if (p.connected === false) { g.fillStyle = 'rgba(18,6,10,.65)'; g.fillRect(x - 9, y - 1, 18, 20); }
      });
      if (!ps.length) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(150, 100, 140, 2); }
      // Embers drifting up from the pit.
      embers.forEach(e => {
        e.y -= e.v * dt; e.x += Math.sin((t / 700) + e.v) * 0.2;
        if (e.y < 14) { e.y = H; e.x = Math.random() * W; }
        g.fillStyle = e.v > 12 ? '#ffd84a' : '#ff7a2a';
        g.fillRect(Math.round(e.x), Math.round(e.y), 1, 1);
      });
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.vy += 60 * dt; c.x += c.vx * dt; c.y += c.vy * dt;
        if (c.y > H) { confetti.splice(i, 1); continue; }
        g.fillStyle = c.c;
        g.fillRect(Math.round(c.x), Math.round(c.y), (t / 80 + i) % 4 < 2 ? 2 : 1, 2);
      }
      if (scene.flash && t < scene.flash.until) {
        g.fillStyle = scene.flash.color; g.globalAlpha = (scene.flash.until - t) / 600;
        g.fillRect(0, 0, W, H); g.globalAlpha = 1;
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    return {
      set(next) { scene = Object.assign(scene, next); },
      talk(ms) { scene.talkingUntil = performance.now() + ms; },
      shake(ms = 400) { scene.shakeUntil = performance.now() + ms; },
      flash(color) { scene.flash = { color, until: performance.now() + 600 }; },
      burst(colors) {
        for (let i = 0; i < 160; i++) confetti.push({ x: Math.random() * W, y: -Math.random() * 40, vx: (Math.random() - 0.5) * 40, vy: Math.random() * 30, c: colors[i % colors.length] });
      },
      now: () => performance.now(),
    };
  }

  // Contestant podiums sit in a tight group to the right of the host's desk,
  // centred, so two players stand together rather than at opposite walls.
  const GROUP_CENTRE = 208, GROUP_SPAN = 192;
  function podiumGap(n) { return Math.min(34, GROUP_SPAN / Math.max(1, n)); }
  function podiumXs(n) {
    const gap = podiumGap(n);
    return Array.from({ length: n }, (_, k) => Math.round(GROUP_CENTRE + (k - (n - 1) / 2) * gap));
  }

  // ---------------------------------------------------------------- flags
  // Drawn at 45x30 and scaled up, so they match the pixel look.
  function drawFlag(canvas, f) {
    const w = 45, h = 30;
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    if (f.kind === 'v' || f.kind === 'h') {
      const r = f.r || f.c.map(() => 1), tot = r.reduce((a, b) => a + b, 0);
      let at = 0;
      f.c.forEach((col, k) => {
        const len = f.kind === 'v' ? w : h;
        const from = Math.round(at / tot * len); at += r[k];
        const to = Math.round(at / tot * len);
        g.fillStyle = col;
        if (f.kind === 'v') g.fillRect(from, 0, to - from, h); else g.fillRect(0, from, w, to - from);
      });
    } else if (f.kind === 'disc') {
      g.fillStyle = f.bg; g.fillRect(0, 0, w, h);
      const cx = w / 2 + (f.offset || 0) * w, cy = h / 2, rr = h * 0.3;
      g.fillStyle = f.c;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr) g.fillRect(x, y, 1, 1);
    } else if (f.kind === 'nordic') {
      g.fillStyle = f.bg; g.fillRect(0, 0, w, h);
      if (f.border) { g.fillStyle = f.border; g.fillRect(11, 0, 8, h); g.fillRect(0, 11, w, 8); }
      g.fillStyle = f.cross; g.fillRect(13, 0, 4, h); g.fillRect(0, 13, w, 4);
    } else if (f.kind === 'swiss') {
      canvas.width = 30; canvas.height = 30;
      g.fillStyle = f.bg; g.fillRect(0, 0, 30, 30);
      g.fillStyle = f.cross; g.fillRect(12, 6, 6, 18); g.fillRect(6, 12, 18, 6);
    }
  }

  // ---------------------------------------------------------------- chiptune
  // Notes are "name:beats"; R is a rest. Public-domain melodies only.
  const TUNES = {
    twinkle: { bpm: 110, n: 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2' },
    birthday: { bpm: 100, n: 'G4:.75 G4:.25 A4 G4 C5 B4:2 G4:.75 G4:.25 A4 G4 D5 C5:2' },
    jingle: { bpm: 150, n: 'E4 E4 E4:2 E4 E4 E4:2 E4 G4 C4:1.5 D4:.5 E4:4' },
    lamb: { bpm: 120, n: 'E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2' },
    ode: { bpm: 120, n: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:.5 D4:2' },
    elise: { bpm: 90, n: 'E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1.5 R:.5 C4:.5 E4:.5 A4:.5 B4:1.5 R:.5 E4:.5 G#4:.5 B4:.5 C5:1.5' },
    mountain: { bpm: 140, n: 'B3 C#4 D4 E4 F#4 D4 F#4:2 F4 C#4 F4:2 E4 C4 E4:2 B3 C#4 D4 E4 F#4 D4 F#4 B4 A4 F#4 D4 F#4 A4:3' },
    bride: { bpm: 80, n: 'C4 F4:.75 F4:.25 F4:2 C4 G4:.75 E4:.25 F4:2' },
    toccata: { bpm: 70, n: 'A5:.25 G5:.25 A5:2 G5:.25 F5:.25 E5:.25 D5:.25 C#5:1 D5:2 R:.5 A4:.25 G4:.25 A4:2 E4:.5 F4:.5 C#4:.5 D4:2' },
    funeral: { bpm: 60, n: 'A#3 A#3:.75 A#3:.25 A#3 C#4:.75 C4:.25 C4:.75 A#3:.25 A#3:.75 A3:.25 A#3:2' },
    lullaby: { bpm: 100, n: 'E4:.5 E4:.5 G4:1.5 E4:.5 E4:.5 G4:1.5 E4:.5 G4:.5 C5 B4:1.5 A4:.5 A4 G4:2' },
  };
  const SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  function freq(name) {
    const m = /^([A-G]#?)(\d)$/.exec(name);
    if (!m) return 0;
    return 440 * Math.pow(2, (SEMI[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
  }
  let ctx = null;
  function audio() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  let tuneNodes = [];
  function stopTune() { tuneNodes.forEach(n => { try { n.stop(); } catch (e) { /* already stopped */ } }); tuneNodes = []; }
  function playTune(key, vol = 0.15) {
    const a = audio(), tune = TUNES[key];
    if (!a || !tune) return 0;
    stopTune();
    const beat = 60 / tune.bpm;
    let t = a.currentTime + 0.05;
    for (const tok of tune.n.split(/\s+/)) {
      const [name, b] = tok.split(':');
      const dur = (b ? parseFloat(b) : 1) * beat;
      const f = freq(name);
      if (f) {
        const o = a.createOscillator(), gn = a.createGain();
        o.type = 'square'; o.frequency.value = f;
        gn.gain.setValueAtTime(0, t);
        gn.gain.linearRampToValueAtTime(vol, t + 0.01);
        gn.gain.setValueAtTime(vol, t + dur * 0.75);
        gn.gain.linearRampToValueAtTime(0, t + dur * 0.95);
        o.connect(gn).connect(a.destination);
        o.start(t); o.stop(t + dur);
        tuneNodes.push(o);
      }
      t += dur;
    }
    return t - a.currentTime;
  }
  // A snare roll for dramatic reveals.
  function drumroll(seconds = 1.6, vol = 0.25) {
    const a = audio();
    if (!a) return;
    const len = Math.floor(a.sampleRate * 0.05);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    for (let t = 0; t < seconds; t += 0.055) {
      const src = a.createBufferSource(), gn = a.createGain();
      src.buffer = buf;
      gn.gain.value = vol * (0.4 + 0.6 * t / seconds);
      src.connect(gn).connect(a.destination);
      src.start(a.currentTime + t);
    }
  }

  // ---------------------------------------------------------------- music
  // An original, low-key loop for the lobby and the board: a creeping minor bass
  // with a ticking hi-hat. Scheduled a bar ahead so timer jitter can't stutter it.
  const LOOP = { bpm: 104, bass: 'A2 A2 C3 A2 F2 F2 E2 E2 A2 A2 C3 D3 E3 D3 C3 B2', lead: 'R R E4 R R C4 R R R R E4 R F4 E4 D4 R' };
  let musicTimer = null, musicNext = 0, musicStep = 0, musicGain = null;
  function noteAt(a, f, t, dur, type, vol, dest) {
    const o = a.createOscillator(), gn = a.createGain();
    o.type = type; o.frequency.value = f;
    gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(vol, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function music(on) {
    const a = audio();
    if (!a) return;
    if (!on) { clearInterval(musicTimer); musicTimer = null; if (musicGain) musicGain.gain.setTargetAtTime(0, a.currentTime, 0.2); return; }
    if (musicTimer) return;
    musicGain = a.createGain(); musicGain.gain.value = 0.5; musicGain.connect(a.destination);
    const bass = LOOP.bass.split(' '), lead = LOOP.lead.split(' ');
    const step = 60 / LOOP.bpm / 2;
    musicNext = a.currentTime + 0.1;
    const dest = musicGain;
    musicTimer = setInterval(() => {
      while (musicNext < a.currentTime + 0.6) {
        const k = musicStep % bass.length;
        const fb = freq(bass[k]);
        if (fb) noteAt(a, fb, musicNext, step * 0.9, 'triangle', 0.09, dest);
        const fl = freq(lead[k]);
        if (fl) noteAt(a, fl, musicNext, step * 1.6, 'square', 0.025, dest);
        if (k % 2 === 1) noteAt(a, 6000 + Math.random() * 2000, musicNext, 0.03, 'square', 0.008, dest);
        musicNext += step; musicStep++;
      }
    }, 150);
  }

  window.HGSArt = { Stage, drawFlag, playTune, stopTune, drumroll, audio, music, soul, demon, podiumXs, W, H };
})();
