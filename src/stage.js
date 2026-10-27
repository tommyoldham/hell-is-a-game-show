// Hell Is a Game Show: the painted stage. Replaces the pixel-art studio in
// art.js (whose music and sound helpers are kept).
//
// Layers, back to front: Tommy's paintover with the demon and podiums painted
// out (art/out/stage.webp), animated torch flames, twinkling arch bulbs and
// embers, the demon host (one of 20 painted poses cut from Tommy's sheet),
// then per contestant a glossy ghost drawn in code and a painted podium whose
// screen frame is tinted to the player's colour.
(function () {
  'use strict';
  const ASSETS = window.HGS_ART_ASSETS || { host: {}, hostMeta: {} };
  const A = window.HGSArt;

  // The plate's own pixel grid. Everything below is in these coordinates.
  const W = 1448, H = 652;
  const FLOOR = 625;                     // podium bases stand here
  const HOST = { x: 350, y: 450, scale: 0.94 }; // tie line and desk-top line
  const HOST_PLATE = { x0: 222, y0: 514, x1: 552, y1: 592 };
  // Podium art is 200x228; its centre line is x 100 and its base is row 225.
  const POD = { w: 200, h: 228, cx: 100, base: 225, lid: 52, screen: { dx0: -56, dx1: 54, top: 111, bottom: 34 } };
  const GROUP = { centre: 995, span: 680, gap: 212 };
  const TORCHES = [{ x0: 0, y0: 236, x1: 118, y1: 430, cx: 58 }, { x0: 1330, y0: 236, x1: 1448, y1: 430, cx: 1392 }];
  const BULBS = [[254, 126], [316, 124], [380, 114], [444, 105], [512, 98], [572, 93], [636, 90], [810, 89], [875, 93], [939, 98], [1006, 106], [1070, 114], [1135, 122], [1195, 124]];

  function img(src) { const i = new Image(); if (src) i.src = src; return i; }
  const plateImg = img(ASSETS.stage), podImg = img(ASSETS.podium), frameImg = img(ASSETS.podiumFrame);
  const hostImgs = {};
  for (const [k, src] of Object.entries(ASSETS.host)) hostImgs[k] = img(src);
  const ready = i => i.complete && i.naturalWidth > 0;

  // Moods the game asks for, mapped to poses on Tommy's sheet. Idle drifts
  // through little bits of business so the host never looks frozen.
  const MOOD_POSE = { bored: 'bored', smirk: 'steeple', wide: 'lean', talk: 'talk' };
  const IDLE = ['coffee', 'sip', 'card', 'shades', 'ponder', 'scratch', 'glare'];

  // ---------------------------------------------------------------- layout
  function podiumGap(n) { return Math.min(GROUP.gap, GROUP.span / Math.max(1, n)); }
  function podiumScale(n) { return Math.min(1, podiumGap(n) / GROUP.gap); }
  function podiumXs(n) { const gap = podiumGap(n); return Array.from({ length: n }, (_, k) => GROUP.centre + (k - (n - 1) / 2) * gap); }
  // Where a podium's screen is, for the HTML name plates (stage pixels).
  function screenRect(cx, s) {
    return { x0: cx + POD.screen.dx0 * s, x1: cx + POD.screen.dx1 * s, y0: FLOOR - POD.screen.top * s, y1: FLOOR - POD.screen.bottom * s };
  }

  // ---------------------------------------------------------------- colour
  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(c, k, to = 255) { return '#' + hex(c).map(v => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')).join(''); }
  function rgba(c, a) { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; }

  // The podium screen frame in a player's colour, with its glow baked around it.
  const frameCache = {};
  function tintedFrame(color) {
    if (frameCache[color] || !ready(frameImg)) return frameCache[color];
    const pad = 24, c = document.createElement('canvas'); c.width = POD.w + pad * 2; c.height = POD.h + pad * 2;
    const t = document.createElement('canvas'); t.width = POD.w; t.height = POD.h;
    const tg = t.getContext('2d');
    tg.fillStyle = mix(color, 0.15); tg.fillRect(0, 0, POD.w, POD.h);
    tg.globalCompositeOperation = 'multiply'; tg.drawImage(frameImg, 0, 0);
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(frameImg, 0, 0);
    const g = c.getContext('2d');
    g.filter = 'blur(7px)'; g.globalAlpha = 0.9; g.drawImage(t, pad, pad);
    g.filter = 'blur(2px)'; g.globalAlpha = 0.8; g.drawImage(t, pad, pad);
    g.filter = 'none'; g.globalAlpha = 1; g.drawImage(t, pad, pad);
    return (frameCache[color] = { c, pad });
  }

  // Torch flames as their own layer, so a moving copy can be laid over the paint.
  let flameLayer = null;
  function buildFlames() {
    if (flameLayer || !ready(plateImg)) return flameLayer;
    flameLayer = TORCHES.map(T => {
      const w = T.x1 - T.x0, h = T.y1 - T.y0, c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.drawImage(plateImg, T.x0, T.y0, w, h, 0, 0, w, h);
      const im = g.getImageData(0, 0, w, h), d = im.data;
      for (let i = 0; i < w * h; i++) {
        const r = d[i*4], gg = d[i*4+1], b = d[i*4+2];
        const warm = r > 150 && r >= gg && gg >= b * 0.9;
        d[i*4+3] = warm ? Math.max(0, Math.min(255, (r + gg - 260) * 1.6)) : 0;
      }
      g.putImageData(im, 0, 0);
      return c;
    });
    return flameLayer;
  }

  // ---------------------------------------------------------------- ghosts
  const LOOKS = A.LOOKS, cleanLook = A.cleanLook;
  // A glossy ghost centred on cx with its dome top at `top`, radius r. Below
  // `cut` nothing is drawn (the podium lid hides it); hem draws the wavy tail.
  function drawGhost(g, cx, top, r, color, mood, look, t, opts = {}) {
    look = cleanLook(look);
    const hem = !!opts.hem, h = opts.height || r * 1.75;
    const bodyBottom = top + h;
    g.save();
    // Body.
    g.beginPath();
    g.moveTo(cx - r, top + r);
    g.arc(cx, top + r, r, Math.PI, 0);
    g.lineTo(cx + r, bodyBottom);
    if (hem) {
      const n = 4, step = (2 * r) / n;
      for (let k = 0; k < n; k++) {
        const x0 = cx + r - k * step, wob = Math.sin(t / 260 + k) * r * 0.05;
        g.quadraticCurveTo(x0 - step / 2, bodyBottom + r * 0.22 + wob, x0 - step, bodyBottom);
      }
    } else g.lineTo(cx - r, bodyBottom);
    g.closePath();
    g.shadowColor = rgba(color, 0.75); g.shadowBlur = r * 0.55;
    const grad = g.createRadialGradient(cx - r * 0.35, top + r * 0.45, r * 0.1, cx, top + r * 0.9, r * 1.45);
    grad.addColorStop(0, mix(color, 0.55)); grad.addColorStop(0.45, color); grad.addColorStop(1, mix(color, 0.45, 0));
    g.fillStyle = grad; g.fill();
    g.shadowBlur = 0;
    g.lineWidth = Math.max(1, r * 0.05); g.strokeStyle = rgba(mix(color, 0.6, 0), 0.8); g.stroke();
    // Gloss.
    g.beginPath(); g.ellipse(cx - r * 0.38, top + r * 0.42, r * 0.28, r * 0.17, -0.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.fill();
    g.beginPath(); g.ellipse(cx - r * 0.12, top + r * 0.22, r * 0.07, r * 0.05, 0, 0, Math.PI * 2); g.fill();

    const ink = '#1c0a10', ey = top + r * 0.92, ex = r * 0.36;
    const eyeStyle = LOOKS.eyes[look.eyes];
    const oval = (x, y, rx, ry, fill) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
    const shine = (x, y, s) => oval(x - s * 0.35, y - s * 0.45, s * 0.3, s * 0.3, 'rgba(255,255,255,.8)');
    const arcEye = (x, y, s) => { g.beginPath(); g.arc(x, y + s * 0.4, s, Math.PI * 1.15, Math.PI * 1.85); g.lineWidth = s * 0.45; g.lineCap = 'round'; g.strokeStyle = ink; g.stroke(); };
    // Eyes. Happy and sad override the face, except a cyclops stays one-eyed.
    if (eyeStyle === 'Cyclops') {
      if (mood === 'happy') arcEye(cx, ey, r * 0.24);
      else { oval(cx, ey, r * 0.27, r * 0.27, '#fff8ec'); oval(cx, ey + (mood === 'sad' ? r * 0.05 : 0), r * 0.13, r * 0.15, ink); shine(cx, ey, r * 0.13); }
    } else if (mood === 'happy') { arcEye(cx - ex, ey, r * 0.15); arcEye(cx + ex, ey, r * 0.15); }
    else if (eyeStyle === 'Big') { for (const s of [-1, 1]) { oval(cx + s * ex, ey, r * 0.21, r * 0.23, '#fff8ec'); oval(cx + s * ex, ey + r * 0.03, r * 0.11, r * 0.13, ink); shine(cx + s * ex, ey, r * 0.11); } }
    else if (eyeStyle === 'Sleepy') { for (const s of [-1, 1]) { oval(cx + s * ex, ey + r * 0.04, r * 0.12, r * 0.09, ink); g.fillStyle = mix(color, 0.2, 0); g.fillRect(cx + s * ex - r * 0.15, ey - r * 0.14, r * 0.3, r * 0.15); } }
    else { for (const s of [-1, 1]) { oval(cx + s * ex, ey - r * 0.04, r * 0.15, r * (mood === 'think' && s > 0 ? 0.16 : 0.25), ink); shine(cx + s * ex, ey - r * 0.04, r * 0.13); } }
    if (mood === 'sad' && eyeStyle !== 'Cyclops') oval(cx - ex - r * 0.1, ey + r * 0.3, r * 0.05, r * 0.08, '#8fe0ff');
    if (eyeStyle === 'Angry' && mood !== 'happy') {
      g.lineWidth = r * 0.08; g.lineCap = 'round'; g.strokeStyle = ink;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * (ex + r * 0.18), ey - r * 0.3); g.lineTo(cx + s * (ex - r * 0.12), ey - r * 0.18); g.stroke(); }
    }
    if (eyeStyle === 'Shades') {
      g.fillStyle = '#0d0a12';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * ex, ey, r * 0.24, r * 0.17, 0, 0, Math.PI * 2); g.fill(); }
      g.fillRect(cx - ex, ey - r * 0.06, ex * 2, r * 0.06);
      g.fillStyle = 'rgba(160,190,255,.45)'; for (const s of [-1, 1]) g.fillRect(cx + s * ex - r * 0.15, ey - r * 0.1, r * 0.1, r * 0.05);
    }
    if (eyeStyle === 'Specs') {
      g.lineWidth = r * 0.05; g.strokeStyle = '#2a1a10';
      for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * ex, ey, r * 0.22, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(cx - ex + r * 0.22, ey); g.lineTo(cx + ex - r * 0.22, ey); g.stroke();
    }
    // Mouth.
    const my = ey + r * 0.42;
    g.lineCap = 'round'; g.strokeStyle = ink; g.lineWidth = r * 0.07;
    if (mood === 'happy') { g.beginPath(); g.arc(cx, my - r * 0.08, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); g.fillStyle = '#3a0a14'; g.fill(); }
    else if (mood === 'sad') { g.beginPath(); g.arc(cx, my + r * 0.12, r * 0.14, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke(); }
    else if (mood === 'think') oval(cx + r * 0.05, my, r * 0.06, r * 0.07, ink);
    else { oval(cx - r * 0.07, my, r * 0.035, r * 0.035, ink); oval(cx + r * 0.07, my, r * 0.035, r * 0.035, ink); }
    // Face extras.
    const face = LOOKS.face[look.face];
    if (face === 'Moustache') {
      g.fillStyle = '#2a140c';
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * r * 0.14, my - r * 0.1, r * 0.16, r * 0.07, s * 0.3, 0, Math.PI * 2); g.fill(); }
    } else if (face === 'Fangs') {
      g.fillStyle = '#fffaf0';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * r * 0.12, my + r * 0.02); g.lineTo(cx + s * r * 0.04, my + r * 0.02); g.lineTo(cx + s * r * 0.08, my + r * 0.17); g.fill(); }
    } else if (face === 'Blush') { for (const s of [-1, 1]) oval(cx + s * r * 0.58, ey + r * 0.28, r * 0.14, r * 0.08, 'rgba(255,110,160,.55)'); }
    else if (face === 'Bow tie') {
      const by = Math.min(bodyBottom - r * 0.12, top + r * 1.62);
      g.fillStyle = '#d81e2c';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx, by); g.lineTo(cx + s * r * 0.3, by - r * 0.14); g.lineTo(cx + s * r * 0.3, by + r * 0.14); g.closePath(); g.fill(); }
      oval(cx, by, r * 0.07, r * 0.07, '#8e1020');
    } else if (face === 'Tongue') { g.beginPath(); g.ellipse(cx + r * 0.05, my + r * 0.12, r * 0.09, r * 0.12, 0, 0, Math.PI); g.fillStyle = '#ff5f8a'; g.fill(); }
    else if (face === 'Stitches') {
      g.strokeStyle = '#2a0f18'; g.lineWidth = r * 0.04;
      g.beginPath(); g.moveTo(cx + r * 0.55, top + r * 0.25); g.lineTo(cx + r * 0.75, top + r * 0.75); g.stroke();
      for (let k = 0; k < 4; k++) { const u = k / 3, x = cx + r * (0.55 + 0.2 * u), y = top + r * (0.25 + 0.5 * u); g.beginPath(); g.moveTo(x - r * 0.08, y + r * 0.03); g.lineTo(x + r * 0.08, y - r * 0.03); g.stroke(); }
    }
    // Hats.
    const hat = LOOKS.hat[look.hat], gold = '#ffcf4a';
    if (hat === 'Horns') {
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * r * 0.45, top + r * 0.28); g.quadraticCurveTo(cx + s * r * 0.95, top + r * 0.05, cx + s * r * 0.82, top - r * 0.45);
        g.quadraticCurveTo(cx + s * r * 0.7, top - r * 0.02, cx + s * r * 0.2, top + r * 0.1); g.closePath();
        const hg = g.createLinearGradient(0, top - r * 0.45, 0, top + r * 0.3); hg.addColorStop(0, '#ff6a4a'); hg.addColorStop(1, '#a3121c'); g.fillStyle = hg; g.fill(); g.strokeStyle = '#4a0a0e'; g.lineWidth = r * 0.04; g.stroke(); }
    } else if (hat === 'Halo') {
      const hy = top - r * 0.32 + Math.sin(t / 500) * r * 0.04;
      g.shadowColor = gold; g.shadowBlur = r * 0.4; g.lineWidth = r * 0.11; g.strokeStyle = gold;
      g.beginPath(); g.ellipse(cx, hy, r * 0.55, r * 0.16, 0, 0, Math.PI * 2); g.stroke(); g.shadowBlur = 0;
    } else if (hat === 'Top hat') {
      g.fillStyle = '#1b1620'; g.fillRect(cx - r * 0.4, top - r * 0.75, r * 0.8, r * 0.8);
      g.fillStyle = '#b3141f'; g.fillRect(cx - r * 0.4, top - r * 0.12, r * 0.8, r * 0.14);
      g.fillStyle = '#1b1620'; g.beginPath(); g.ellipse(cx, top + r * 0.06, r * 0.72, r * 0.13, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(cx - r * 0.3, top - r * 0.72, r * 0.1, r * 0.6);
    } else if (hat === 'Party hat') {
      g.save(); g.beginPath(); g.moveTo(cx - r * 0.35, top + r * 0.12); g.lineTo(cx + r * 0.08, top - r * 0.85); g.lineTo(cx + r * 0.4, top + r * 0.1); g.closePath(); g.clip();
      for (let k = -6; k < 6; k++) { g.fillStyle = k % 2 ? '#3ac4ff' : '#ff5fb7'; g.beginPath(); g.moveTo(cx - r + k * r * 0.22, top + r * 0.2); g.lineTo(cx - r + k * r * 0.22 + r * 0.11, top + r * 0.2); g.lineTo(cx + k * r * 0.22 + r * 0.6, top - r); g.lineTo(cx + k * r * 0.22 + r * 0.49, top - r); g.fill(); }
      g.restore(); oval(cx + r * 0.08, top - r * 0.88, r * 0.11, r * 0.11, gold);
    } else if (hat === 'Crown') {
      g.beginPath(); g.moveTo(cx - r * 0.5, top + r * 0.12);
      [[-0.5, -0.38], [-0.25, -0.1], [0, -0.48], [0.25, -0.1], [0.5, -0.38], [0.5, 0.12]].forEach(([u, v]) => g.lineTo(cx + u * r, top + v * r));
      g.closePath(); const cg = g.createLinearGradient(0, top - r * 0.5, 0, top + r * 0.12); cg.addColorStop(0, '#fff1a0'); cg.addColorStop(1, '#d1901a');
      g.fillStyle = cg; g.fill(); g.strokeStyle = '#7a4a08'; g.lineWidth = r * 0.03; g.stroke();
      oval(cx, top - r * 0.02, r * 0.07, r * 0.07, '#e0283a'); oval(cx - r * 0.3, top + r * 0.02, r * 0.05, r * 0.05, '#3ac4ff'); oval(cx + r * 0.3, top + r * 0.02, r * 0.05, r * 0.05, '#3ac4ff');
    } else if (hat === 'Cap') {
      g.beginPath(); g.ellipse(cx, top + r * 0.22, r * 0.9, r * 0.55, 0, Math.PI, 0); g.fillStyle = '#2a63d8'; g.fill();
      g.beginPath(); g.ellipse(cx + r * 0.55, top + r * 0.24, r * 0.6, r * 0.12, 0, 0, Math.PI * 2); g.fillStyle = '#1b46a0'; g.fill();
      oval(cx, top - r * 0.32, r * 0.08, r * 0.06, '#1b46a0');
    } else if (hat === 'Bow') {
      const bx = cx + r * 0.55, by = top + r * 0.12; g.fillStyle = '#ff4f9a';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + s * r * 0.34, by - r * 0.2); g.lineTo(bx + s * r * 0.34, by + r * 0.2); g.closePath(); g.fill(); }
      oval(bx, by, r * 0.08, r * 0.08, '#c0256a');
    } else if (hat === 'Antenna') {
      g.strokeStyle = '#26122a'; g.lineWidth = r * 0.06; g.beginPath(); g.moveTo(cx, top + r * 0.05); g.quadraticCurveTo(cx + r * 0.2, top - r * 0.4, cx + r * 0.1, top - r * 0.62); g.stroke();
      g.shadowColor = '#7dff6a'; g.shadowBlur = r * 0.35; oval(cx + r * 0.1, top - r * 0.68, r * 0.12, r * 0.12, '#7dff6a'); g.shadowBlur = 0;
    }
    g.restore();
  }

  // The avatar creator's preview: a whole ghost, tail and all.
  function soul(color, mood, wiggle, look) {
    const c = document.createElement('canvas'); c.width = 120; c.height = 150;
    drawGhost(c.getContext('2d'), 60, 42, 40, color, mood || 'idle', look, (wiggle || 0) * 200, { hem: true, height: 72 });
    return c;
  }

  // ---------------------------------------------------------------- stage
  function Stage(canvas) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    let scene = { players: [], talkingUntil: 0, mood: 'bored', shakeUntil: 0, flash: null };
    const confetti = [], arrived = {};
    const embers = Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 14 + Math.random() * 30, r: 0.8 + Math.random() * 1.8, p: Math.random() * 6 }));
    const tongues = TORCHES.map(() => []);
    // Host pose state: a timed pose beats the mood; idle business every so often.
    let timed = null, idle = { pose: null, until: 0, next: performance.now() + 6000 };
    let shown = 'bored', prev = null, swapAt = 0;

    function wantPose(t) {
      if (timed && t < timed.until) return timed.pose;
      if (t < scene.talkingUntil) return 'talk';
      if (scene.mood !== 'bored') return MOOD_POSE[scene.mood] || scene.mood;
      if (idle.pose && t < idle.until) return idle.pose;
      if (t > idle.next) { idle.pose = IDLE[Math.floor(Math.random() * IDLE.length)]; idle.until = t + 2600 + Math.random() * 1800; idle.next = idle.until + 7000 + Math.random() * 7000; return idle.pose; }
      return 'bored';
    }
    function drawHost(t) {
      const want = wantPose(t);
      if (want !== shown && hostImgs[want]) { prev = shown; shown = want; swapAt = t; }
      const k = Math.min(1, (t - swapAt) / 180);
      const breathe = 1 + Math.sin(t / 760) * 0.006;
      const one = (name, alpha, pop) => {
        const im = hostImgs[name], m = ASSETS.hostMeta[name];
        if (!im || !m || !ready(im)) return;
        const s = HOST.scale * pop;
        g.globalAlpha = alpha;
        g.drawImage(im, HOST.x - m.cx * s, HOST.y - m.h * s * breathe, m.w * s, m.h * s * breathe);
        g.globalAlpha = 1;
      };
      if (prev && k < 1) one(prev, 1 - k, 1);
      one(shown, k, 1 + (1 - k) * 0.025);
    }
    function drawTorches(t, dt) {
      const L = buildFlames();
      TORCHES.forEach((T, n) => {
        const flick = 0.75 + 0.25 * Math.sin(t / 70 + n * 2) * Math.sin(t / 130 + n);
        // A warm pool of light around the bowl.
        const glow = g.createRadialGradient(T.cx, T.y1 - 70, 10, T.cx, T.y1 - 70, 230);
        glow.addColorStop(0, `rgba(255,150,50,${0.22 * flick})`); glow.addColorStop(1, 'rgba(255,90,30,0)');
        g.globalCompositeOperation = 'lighter'; g.fillStyle = glow; g.fillRect(T.cx - 240, T.y1 - 310, 480, 480);
        // The painted flame, copied over itself with a heat shimmer and stretch.
        if (L) {
          const c = L[n], h = c.height, stretch = 1 + 0.07 * Math.sin(t / 110 + n * 3) + 0.04 * Math.sin(t / 47 + n);
          g.globalAlpha = 0.65;
          for (let y = 0; y < h; y += 2) {
            const up = 1 - y / h; // 0 at the bowl, 1 at the tip
            const dx = up * up * (5 * Math.sin(t / 95 + y * 0.09 + n) + 2.5 * Math.sin(t / 41 + y * 0.21));
            const dy = T.y1 - (h - y) * stretch;
            g.drawImage(c, 0, y, c.width, 2, T.x0 + dx, dy, c.width, 2 * stretch + 0.5);
          }
          g.globalAlpha = 1;
        }
        // Tongues of fire licking up out of the bowl.
        const list = tongues[n];
        if (Math.random() < dt * 34) list.push({ x: T.cx + (Math.random() - 0.5) * 50, y: T.y1 - 40, vx: (Math.random() - 0.5) * 18, vy: -(70 + Math.random() * 70), life: 0, max: 0.5 + Math.random() * 0.45, r: 10 + Math.random() * 14 });
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i]; p.life += dt; if (p.life > p.max) { list.splice(i, 1); continue; }
          p.x += p.vx * dt + Math.sin(t / 90 + i) * 0.4; p.y += p.vy * dt;
          const u = p.life / p.max, r = p.r * (1 - u * 0.7);
          const fg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          fg.addColorStop(0, `rgba(255,${230 - u * 120},${120 - u * 100},${0.55 * (1 - u)})`); fg.addColorStop(1, 'rgba(255,60,10,0)');
          g.fillStyle = fg; g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        }
        g.globalCompositeOperation = 'source-over';
      });
    }
    function drawBulbs(t) {
      const chase = Math.floor(t / 220) % BULBS.length;
      g.globalCompositeOperation = 'lighter';
      BULBS.forEach(([x, y], k) => {
        const v = 0.5 + 0.5 * Math.sin(t / 260 + k * 1.1);
        const r = 16 + v * 6, bg = g.createRadialGradient(x, y, 0, x, y, r);
        bg.addColorStop(0, `rgba(255,236,170,${0.25 + 0.3 * v})`); bg.addColorStop(1, 'rgba(255,180,60,0)');
        g.fillStyle = bg; g.fillRect(x - r, y - r, r * 2, r * 2);
      });
      g.globalCompositeOperation = 'source-over';
      // One bulb blinks off as the chase runs round the arch.
      const [bx, by] = BULBS[chase]; g.fillStyle = 'rgba(40,10,0,.55)'; g.beginPath(); g.arc(bx, by, 6.5, 0, Math.PI * 2); g.fill();
    }
    function drawEmbers(t, dt) {
      g.globalCompositeOperation = 'lighter';
      embers.forEach(e => {
        e.y -= e.v * dt; e.x += Math.sin(t / 900 + e.p) * 0.35;
        if (e.y < 60) { e.y = H + 5; e.x = Math.random() * W; }
        const a = 0.35 + 0.35 * Math.sin(t / 200 + e.p);
        g.fillStyle = `rgba(255,${150 + (e.p * 15 | 0)},60,${a})`;
        g.beginPath(); g.arc(e.x, e.y, e.r, 0, Math.PI * 2); g.fill();
      });
      g.globalCompositeOperation = 'source-over';
    }
    function drawContestants(t) {
      const ps = scene.players, n = ps.length, xs = podiumXs(n), s = podiumScale(n);
      ps.forEach((p, k) => {
        const cx = xs[k];
        if (arrived[p.id] == null) arrived[p.id] = t;
        const age = (t - arrived[p.id]) / 600;
        const lidY = FLOOR - (POD.base - POD.lid) * s, r = 44 * s;
        let top = lidY - 78 * s + Math.sin(t / 520 + k) * 2.5 * s;
        if (age < 1) top -= 420 * (1 - age) * (1 - age);
        if (p.falling) top += Math.min(95 * s, (t - p.falling) / 4 * s);
        const alpha = p.connected === false ? 0.35 : 1;
        // The ghost, clipped at the lid so it sits inside the podium.
        g.save(); g.globalAlpha = alpha;
        g.beginPath(); g.rect(cx - 140 * s, 0, 280 * s, lidY + 3 * s); g.clip();
        if (p.answered) { const ag = g.createRadialGradient(cx, top + r, r * 0.6, cx, top + r, r * 2.1); ag.addColorStop(0, rgba(p.color, 0.45)); ag.addColorStop(1, rgba(p.color, 0)); g.fillStyle = ag; g.fillRect(cx - r * 2.2, top - r * 1.2, r * 4.4, r * 4.4); }
        drawGhost(g, cx, top, r, p.color, p.mood || 'idle', p.look, t, { height: 95 * s });
        g.restore();
        // Podium, screen frame and a dim reflection on the floor.
        if (ready(podImg)) {
          const x0 = cx - POD.cx * s, y0 = FLOOR - POD.base * s;
          g.globalAlpha = alpha;
          g.drawImage(podImg, x0, y0, POD.w * s, POD.h * s);
          const f = tintedFrame(p.color);
          if (f) { const pulse = p.answered ? 1 : 0.85 + 0.15 * Math.sin(t / 600 + k); g.globalAlpha = alpha * pulse; g.drawImage(f.c, x0 - f.pad * s, y0 - f.pad * s, f.c.width * s, f.c.height * s); }
          g.save(); g.globalAlpha = alpha * 0.2; g.beginPath(); g.rect(0, FLOOR, W, H - FLOOR); g.clip();
          g.translate(0, FLOOR * 2); g.scale(1, -1); g.drawImage(podImg, x0, y0, POD.w * s, POD.h * s); g.restore();
          g.globalAlpha = 1;
        }
        if (p.bet) { // in control of the board: embers circle the podium
          g.globalCompositeOperation = 'lighter';
          for (let a = 0; a < 8; a++) { const ang = t / 500 + a * Math.PI / 4, ex = cx + Math.cos(ang) * 90 * s, ey = FLOOR - 120 * s + Math.sin(ang) * 26 * s;
            g.fillStyle = a % 2 ? 'rgba(255,200,80,.8)' : 'rgba(255,110,40,.8)'; g.beginPath(); g.arc(ex, ey, 3.2 * s + 1, 0, Math.PI * 2); g.fill(); }
          g.globalCompositeOperation = 'source-over';
        }
      });
    }

    let last = performance.now();
    function draw(t) {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const shake = t < scene.shakeUntil ? Math.sin(t / 22) * 6 : 0;
      g.setTransform(1, 0, 0, 1, shake, 0);
      if (ready(plateImg)) g.drawImage(plateImg, 0, 0, W, H); else { g.fillStyle = '#2a0710'; g.fillRect(0, 0, W, H); }
      drawTorches(t, dt);
      drawBulbs(t);
      drawHost(t);
      drawContestants(t);
      drawEmbers(t, dt);
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i]; c.vy += 260 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.a += c.va * dt;
        if (c.y > H) { confetti.splice(i, 1); continue; }
        g.save(); g.translate(c.x, c.y); g.rotate(c.a); g.fillStyle = c.c; g.fillRect(-5, -3, 10, 6 * Math.abs(Math.cos(c.a * 2))); g.restore();
      }
      if (scene.flash && t < scene.flash.until) { g.globalAlpha = (scene.flash.until - t) / 600; g.fillStyle = scene.flash.color; g.fillRect(-10, 0, W + 20, H); g.globalAlpha = 1; }
      g.setTransform(1, 0, 0, 1, 0, 0);
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);

    return {
      set(next) { scene = Object.assign(scene, next); },
      talk(ms) { scene.talkingUntil = performance.now() + ms; },
      // A pose from the sheet for a moment: 'laugh', 'shock', 'facepalm', 'present', 'point', 'shrug', 'wink'...
      pose(name, ms = 1600) { if (hostImgs[name]) timed = { pose: name, until: performance.now() + ms }; },
      shake(ms = 400) { scene.shakeUntil = performance.now() + ms; },
      flash(color) { scene.flash = { color, until: performance.now() + 600 }; },
      burst(colors) {
        for (let i = 0; i < 220; i++) confetti.push({ x: Math.random() * W, y: -Math.random() * 120, vx: (Math.random() - 0.5) * 160, vy: Math.random() * 120, a: Math.random() * 6, va: (Math.random() - 0.5) * 10, c: colors[i % colors.length] });
      },
      now: () => performance.now(),
    };
  }

  Object.assign(window.HGSArt, { Stage, soul, podiumXs, podiumScale, podiumGap, screenRect, HOST_PLATE, FLOOR, W, H, logo: ASSETS.logo });
})();
