// node build.js — inlines src/ + Kenney sounds into one shareable file:
//   dist/HellIsAGameShow.html
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'dist', 'HellIsAGameShow.html');
const KENNEY = 'D:/Claude/KenneyAssets/Audio';
const SOUNDS = {
  correct: 'interface-sounds/confirmation_003.ogg',
  wrong: 'interface-sounds/error_006.ogg',
  lock: 'interface-sounds/select_002.ogg',
  question: 'interface-sounds/question_002.ogg',
  pop: 'interface-sounds/drop_002.ogg',
  soulbet: 'digital-audio/zapThreeToneDown.ogg',
  ding: 'interface-sounds/confirmation_001.ogg',
  buzzer: 'interface-sounds/error_008.ogg',
  gong: 'impact-sounds/impactBell_heavy_001.ogg',
  trapdoor: 'sci-fi-sounds/lowFrequency_explosion_000.ogg',
  loser: 'voiceover-pack-fighter/loser.ogg',
  winner: 'voiceover-pack-fighter/winner.ogg',
  jingle: 'music-jingles/jingles_NES00.ogg',
  buzz: 'digital-audio/zapTwoTone.ogg',
};

function read(name) { return fs.readFileSync(path.join(SRC, name), 'utf8'); }
function findSound(rel) {
  const direct = path.join(KENNEY, rel);
  if (fs.existsSync(direct)) return direct;
  // Kenney folder layouts vary between packs; fall back to a filename search.
  const [pack] = rel.split('/');
  const file = path.basename(rel);
  const stack = [path.join(KENNEY, pack)];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === file) return p;
    }
  }
  throw new Error('Sound not found: ' + rel);
}

const sounds = {};
let soundBytes = 0;
for (const [key, rel] of Object.entries(SOUNDS)) {
  const buf = fs.readFileSync(findSound(rel));
  soundBytes += buf.length;
  sounds[key] = 'data:audio/ogg;base64,' + buf.toString('base64');
}

// Keep inline scripts from terminating the <script> tag early.
const js = s => s.replace(/<\/script/gi, '<\\/script');

const html = read('index.html')
  .replace('/*STYLE*/', () => read('style.css'))
  .replace('/*SOUNDS*/', () => 'window.HGS_SOUNDS = ' + JSON.stringify(sounds) + ';')
  .replace('/*QUESTIONS*/', () => js(read('questions.js')))
  .replace('/*LOGIC*/', () => js(read('logic.js')))
  .replace('/*ART*/', () => js(read('art.js')))
  .replace('/*APP*/', () => js(read('app.js')));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
// The same file is the website: GitHub Pages serves docs/index.html.
const WEB = path.join(__dirname, 'docs', 'index.html');
fs.mkdirSync(path.dirname(WEB), { recursive: true });
fs.writeFileSync(WEB, html);
console.log(`Built ${OUT} (${(html.length / 1024).toFixed(0)} KB, sounds ${(soundBytes / 1024).toFixed(0)} KB)`);
