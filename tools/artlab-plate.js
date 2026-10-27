// Builds art/out/stage.webp from art/source/stage-target.webp (Tommy's paintover).
// Run in tools/artlab.html: await makePlate(). Paints out everything the game
// draws itself: the demon and his desk props, the two podiums and ghosts, and
// the text inside the host's name plate. The top 652 rows are the stage; the
// rest of the source is UI that the page builds in HTML.
window.PLATE = { W: 1448, H: 652, hostPlate: { x0: 222, y0: 514, x1: 552, y1: 592 } };
window.makePlate = async function makePlate() {
  const { W, H } = PLATE;
  const target = await load('/art/source/stage-target.webp');
  const plate = document.createElement('canvas'); plate.width = W; plate.height = H;
  const g = plate.getContext('2d'); g.drawImage(target, 0, 0);
  const px = (x, y) => (y * W + x) * 4;
  let im = g.getImageData(0, 0, W, H), d = im.data;
  const s0 = g.getImageData(0, 0, W, H).data;

  // 1) Podiums and ghosts: tile the clean strip x 628-800 across, cross-fading seams.
  const sx0 = 628, span = 172, fade = 28;
  for (let y = 350; y < H; y++) {
    const m = Math.min(1, (y - 350) / 16);
    for (let x = 800; x < 1216; x++) {
      const o = x - 800, k = o % (span - fade), tile = Math.floor(o / (span - fade)), a = px(sx0 + k, y), q = px(x, y);
      const e = Math.min(1, (x - 800) / 10, (1216 - x) / 10) * m;
      for (let c = 0; c < 3; c++) {
        let v = s0[a + c];
        if (tile > 0 && k < fade) { const t = k / fade; v = v * t + s0[px(sx0 + k + span - fade, y) + c] * (1 - t); }
        d[q + c] = d[q + c] * (1 - e) + v * e;
      }
    }
  }
  g.putImageData(im, 0, 0);

  // 2) The demon: the spotlight beams repeat every ~100px, so copying from 400px
  // to the right (now podium-free) keeps them lined up with the beams above.
  const s1 = g.getImageData(0, 0, W, H).data;
  im = g.getImageData(0, 0, W, H); d = im.data;
  for (let y = 196; y < 432; y++) {
    const x0 = y < 410 ? 192 : 112, x1 = 612;
    for (let x = x0; x < x1; x++) {
      const sx = x + 400 < 612 ? x + 500 : x + 400, a = px(sx, y), q = px(x, y);
      const e = Math.min(1, (y - 196) / 16, (x - x0) / 12, (x1 - x) / 12);
      for (let c = 0; c < 3; c++) d[q + c] = d[q + c] * (1 - e) + s1[a + c] * e;
    }
  }
  // The desk-top surface is uniform left to right: repeat one clean column.
  for (let y = 432; y < 447; y++) {
    const a = px(612, y);
    for (let x = 112; x < 612; x++) { const q = px(x, y), e = Math.min(1, (x - 112) / 8); for (let c = 0; c < 3; c++) d[q + c] = d[q + c] * (1 - e) + s1[a + c] * e; }
  }

  // 3) Host plate text: refill the inside with its own dark, edge-lit gradient.
  const P = PLATE.hostPlate, centre = [28, 8, 8];
  const L = [], R = [];
  for (let y = P.y0; y <= P.y1; y++) { L[y] = [0, 1, 2].map(c => s1[px(P.x0 + 4, y) + c]); R[y] = [0, 1, 2].map(c => s1[px(P.x1 - 4, y) + c]); }
  for (let y = P.y0 + 2; y <= P.y1 - 2; y++) for (let x = P.x0 + 4; x <= P.x1 - 4; x++) {
    const t = (x - P.x0) / (P.x1 - P.x0), u = (y - P.y0) / (P.y1 - P.y0);
    const wh = Math.pow(Math.abs(2 * t - 1), 6), wv = Math.pow(Math.abs(2 * u - 1), 6) * 0.6;
    const edge = t < 0.5 ? L[y] : R[y], q = px(x, y);
    for (let c = 0; c < 3; c++) { const base = centre[c] * (1 - wh) + edge[c] * wh; d[q + c] = base * (1 - wv) + s1[px(x, u < 0.5 ? P.y0 + 2 : P.y1 - 2) + c] * wv; }
  }
  g.putImageData(im, 0, 0);
  return plate;
};

// Builds the podium from the paintover's left (yellow) podium, minus its ghost.
// Returns { body, frame }: the body has a blank screen; the frame is a white,
// luminance-only copy of the screen's border, tinted per player in the game.
window.PODIUM = { x0: 800, y0: 400, w: 200, h: 228, frame: { x0: 839, y0: 508, x1: 960, y1: 597, t: 5 } };
window.makePodium = async function makePodium() {
  const { x0, y0, w, h, frame: F } = PODIUM;
  const target = await load('/art/source/stage-target.webp');
  const plate = window.plate || await makePlate();
  const t = canvasOf(target).getContext('2d').getImageData(x0, y0, w, h), p = plate.getContext('2d').getImageData(x0, y0, w, h);
  const td = t.data, pd = p.data;
  // Solid silhouette, traced by hand (source-image coordinates).
  const poly = [[808, 488], [805, 476], [812, 470], [822, 461], [819, 446], [832, 455], [838, 451], [968, 451], [974, 455], [979, 446], [984, 461], [994, 470], [997, 476], [993, 488],
    [992, 600], [997, 606], [997, 618], [991, 625], [809, 625], [803, 618], [803, 606], [809, 600]];
  const m = document.createElement('canvas'); m.width = w; m.height = h; const mg = m.getContext('2d');
  mg.fillStyle = '#fff'; mg.beginPath(); poly.forEach(([x, y], k) => (k ? mg.lineTo : mg.moveTo).call(mg, x - x0, y - y0)); mg.closePath(); mg.fill();
  const md = mg.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) {
    const x = x0 + (i % w), y = y0 + Math.floor(i / w);
    const r = td[i*4], g = td[i*4+1], b = td[i*4+2];
    const diff = Math.hypot(r - pd[i*4], g - pd[i*4+1], b - pd[i*4+2]);
    let a = md[i*4] / 255;
    // Horn tips and the microphone stick up past the polygon: take them where they differ from the curtain.
    const ghost = r > 200 && g > 130 && b < 120;
    const inMic = x >= 934 && x <= 958 && y >= 412 && y <= 452;
    const inHorn = (x >= 815 && x <= 836 || x >= 965 && x <= 988) && y >= 440 && y <= 462;
    if ((inMic || inHorn) && !ghost) a = Math.max(a, Math.max(0, Math.min(1, (diff - 30) / 30)));
    if (y < 452 && !inMic && !inHorn) a = 0;
    td[i*4+3] = a * 255;
  }
  // Blank the screen: a dark glass gradient where the name and score were.
  const fr = document.createElement('canvas'); fr.width = w; fr.height = h;
  const frImg = fr.getContext('2d').createImageData(w, h), fd = frImg.data;
  for (let y = F.y0; y <= F.y1; y++) for (let x = F.x0; x <= F.x1; x++) {
    const i = ((y - y0) * w + (x - x0)) * 4;
    const inner = x >= F.x0 + F.t && x <= F.x1 - F.t && y >= F.y0 + F.t && y <= F.y1 - F.t;
    if (inner) {
      const u = (y - F.y0) / (F.y1 - F.y0), v = Math.abs((x - F.x0) / (F.x1 - F.x0) - 0.5) * 2;
      const k = 1 - 0.35 * u - 0.25 * v * v;
      td[i] = 26 * k + 6; td[i+1] = 12 * k + 3; td[i+2] = 12 * k + 4;
    } else {
      // Frame: keep its light and shade, lose its colour.
      const lum = Math.min(255, (td[i] * 0.45 + td[i+1] * 0.45 + td[i+2] * 0.1) * 1.15);
      fd[i] = fd[i+1] = fd[i+2] = lum; fd[i+3] = 255;
    }
  }
  fr.getContext('2d').putImageData(frImg, 0, 0);
  const body = document.createElement('canvas'); body.width = w; body.height = h; body.getContext('2d').putImageData(t, 0, 0);
  return { body, frame: fr };
};
