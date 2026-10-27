// node tests/logic.test.js — exits 1 on any failure.
const assert = require('assert');
const H = require('../src/logic.js');

let passed = 0, failed = 0;
const pending = [];
function test(name, fn) {
  const pass = () => { passed++; console.log('  ok  ' + name); };
  const fail = e => { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); };
  try { const r = fn(); if (r && r.then) pending.push(r.then(pass, fail)); else pass(); }
  catch (e) { fail(e); }
}
function seeded(seed) { // mulberry32
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Jack hosts; Mike, Rich and Jay play.
const players = [{ id: 'jack', name: 'Jack' }, { id: 'mike', name: 'Mike' }, { id: 'rich', name: 'Rich' }, { id: 'jay', name: 'Jay' }];
function newGame(board = H.STARTER, extra = {}) {
  const rng = seeded(4);
  const g = H.createGame(Object.assign({ showHostId: 'jack', showText: false, board, players }, extra), rng, 0);
  const act = (pid, msg, t = 0) => H.act(g, pid, msg, rng, t);
  return { g, act, rng };
}
function ok(err) { assert.strictEqual(err, '', err); }
function opening(g, act) {
  ok(act('mike', { t: 'guess', n: 47 }));
  ok(act('rich', { t: 'guess', n: 12 }));
  ok(act('jay', { t: 'guess', n: g.opening.secret }));
}

console.log('starter board');
test('the starter board is complete: 5x5 board, 3 round robins, 3 finals, some fraud', () => {
  const b = H.cleanBoard(H.STARTER);
  assert.deepStrictEqual(H.boardStats(b), { questions: 25, robins: 3, finals: 3 });
  assert(b.cats.every(c => c.cells.every(x => x.q && x.a)), 'every question has an answer for the host');
  assert(b.cats.some(c => c.cells.some(x => x.fraud)));
});
test('the library has 20+ full categories, robins and finals, with no repeated questions', () => {
  const L = H.LIBRARY;
  assert(L.cats.length >= 20, `${L.cats.length} categories`);
  assert(L.robins.length >= 10 && L.finals.length >= 6);
  const seen = new Set();
  for (const c of L.cats) {
    assert.strictEqual(c.cells.length, 5, c.name);
    assert(c.name.length <= H.LIMITS.name, 'name too long for a board header: ' + c.name);
    for (const x of c.cells) {
      assert(x.q && x.a, `${c.name}: missing question or answer`);
      assert(x.q.length <= H.LIMITS.q && x.a.length <= H.LIMITS.a, `${c.name}: too long, would be cut off: ${x.q}`);
      assert(!seen.has(x.q), 'repeated: ' + x.q);
      seen.add(x.q);
    }
  }
  assert(L.cats.filter(c => c.cells.some(x => x.fraud)).length >= 6, 'a good spread of fraud statements');
});
test('a random board has six different categories and survives cleanBoard intact', () => {
  const b = H.randomBoard(seeded(9));
  assert.strictEqual(new Set(b.cats.map(c => c.name)).size, 6);
  assert.deepStrictEqual(H.boardStats(H.cleanBoard(b)), { questions: 30, robins: 3, finals: 3 });
  b.cats[0].cells[0].q = 'changed';
  assert.notStrictEqual(H.LIBRARY.cats.find(c => c.name === b.cats[0].name).cells[0].q, 'changed', 'boards are copies, not the library itself');
});
console.log('specialties');
test('each contestant\'s specialty joins the board, labelled, ahead of the host\'s categories', () => {
  const ps = [{ id: 'jack', name: 'Jack', spec: 'Sport' }, { id: 'mike', name: 'Mike', spec: 'Star Wars' }, { id: 'rich', name: 'Rich', spec: 'Nintendo' }, { id: 'jay', name: 'Jay', spec: 'Horror Movies' }];
  const b = H.withSpecialties(H.STARTER, ps, 'jack');
  assert.deepStrictEqual(b.cats.slice(0, 3).map(c => [c.name, c.tag]), [['Star Wars', 'Mike\'s pick'], ['Nintendo', 'Rich\'s pick'], ['Horror Movies', 'Jay\'s pick']]);
  assert(!b.cats.some(c => c.name === 'Sport'), 'the host doesn\'t get a specialty');
  assert.strictEqual(b.cats.length, 8, '3 picks + 5 starter categories');
  assert(b.cats.every(c => c.cells.every(x => x.q)), 'specialty categories come with their questions');
});
test('shared or already-on-board specialties don\'t duplicate a column; the board caps at 8', () => {
  const ps = [{ id: 'h', name: 'H' }, { id: 'a', name: 'Ann', spec: 'Music' }, { id: 'b', name: 'Bo', spec: 'Music' }, { id: 'c', name: 'Cy', spec: 'Not a category' }];
  const b = H.withSpecialties(H.STARTER, ps, 'h');
  assert.strictEqual(b.cats.filter(c => c.name === 'Music').length, 1);
  assert.strictEqual(b.cats[0].tag, 'Ann & Bo\'s pick');
  assert.strictEqual(b.cats.length, 5);
  const many = H.LIBRARY.cats.slice(10, 20).map((c, k) => ({ id: 'p' + k, name: 'P' + k, spec: c.name }));
  assert.strictEqual(H.withSpecialties(H.STARTER, many, 'h').cats.length, H.LIMITS.cats);
});
test('specialty tags reach every player\'s view of the board', () => {
  const ps = [{ id: 'jack', name: 'Jack' }, { id: 'jay', name: 'Jay', spec: 'Horror Movies' }];
  const g = H.createGame({ showHostId: 'jack', board: H.withSpecialties(H.STARTER, ps, 'jack'), players: ps }, seeded(1), 0);
  assert.strictEqual(H.viewFor(g, 'jay').board.cats[0].tag, 'Jay\'s pick');
});
test('cleanBoard trims junk and caps sizes', () => {
  const b = H.cleanBoard({ cats: Array(9).fill({ name: 'x'.repeat(99), cells: [{ q: '  hi  ', a: 'a' }] }), robins: 'nope' });
  assert.strictEqual(b.cats.length, H.LIMITS.cats);
  assert.strictEqual(b.cats[0].name.length, H.LIMITS.name);
  assert.strictEqual(b.cats[0].cells.length, 5);
  assert.strictEqual(b.cats[0].cells[0].q, 'hi');
  assert.strictEqual(b.cats[0].cells[1].q, '');
  assert.deepStrictEqual(b.robins, []);
});

console.log('opening + board control');
test('the host is not a contestant; closest guess wins control', () => {
  const { g, act } = newGame();
  assert.deepStrictEqual(g.contestants, ['mike', 'rich', 'jay']);
  assert.notStrictEqual(act('jack', { t: 'guess', n: 5 }), '');
  assert.strictEqual(H.viewFor(g, 'mike').opening.secret, null, 'secret hidden while guessing');
  opening(g, act);
  assert.strictEqual(g.phase, 'board');
  assert.strictEqual(g.control, 'jay');
});
test('only the player in control (or the host) can pick, and used cells are gone', () => {
  const { g, act } = newGame();
  opening(g, act);
  assert.notStrictEqual(act('mike', { t: 'pick', c: 4, r: 4 }), '');
  ok(act('jay', { t: 'pick', c: 4, r: 4 }));
  assert.strictEqual(g.phase, 'read');
  ok(act('jack', { t: 'skip' }));
  ok(act('jack', { t: 'toBoard' }));
  assert.notStrictEqual(act('jay', { t: 'pick', c: 4, r: 4 }), '', 'cell already used');
  assert.strictEqual(g.control, 'jay', 'nobody got it: control stays');
});

console.log('buzzers + rulings');
test('first buzz wins; later buzzes are recorded; correct = +points and control', () => {
  const { g, act } = newGame();
  opening(g, act);
  ok(act('jay', { t: 'pick', c: 1, r: 0 }));
  ok(act('mike', { t: 'buzz' }, 100));
  ok(act('rich', { t: 'buzz' }, 180));
  assert.strictEqual(g.buzz, 'mike');
  assert.strictEqual(g.phase, 'buzzed');
  assert.deepStrictEqual(g.buzzes.map(b => b.pid), ['mike', 'rich']);
  ok(act('jack', { t: 'judge', ok: true }));
  assert.strictEqual(g.scores.mike, 1);
  assert.strictEqual(g.control, 'mike');
  assert.strictEqual(g.phase, 'answer');
  assert(H.viewFor(g, 'rich').cell.a, 'answer revealed to everyone');
});
test('wrong answer loses points, locks that player out, and reopens the buzzers', () => {
  const { g, act } = newGame();
  opening(g, act);
  ok(act('jay', { t: 'pick', c: 0, r: 3 }));
  ok(act('rich', { t: 'buzz' }));
  ok(act('jack', { t: 'judge', ok: false }));
  assert.strictEqual(g.scores.rich, -4);
  assert.strictEqual(g.phase, 'read');
  ok(act('rich', { t: 'buzz' })); // ignored silently
  assert.strictEqual(g.buzz, null);
  ok(act('mike', { t: 'buzz' }));
  ok(act('jack', { t: 'judge', ok: false }));
  ok(act('jay', { t: 'buzz' }));
  ok(act('jack', { t: 'judge', ok: false }));
  assert.strictEqual(g.phase, 'answer', 'everyone locked out closes the question');
  assert.strictEqual(g.control, 'jay');
});
test('fraud statements are worth double', () => {
  const { g, act } = newGame();
  opening(g, act);
  const c = g.board.cats.findIndex(c => c.cells.some(x => x.fraud));
  const r = g.board.cats[c].cells.findIndex(x => x.fraud);
  ok(act('jay', { t: 'pick', c, r }));
  assert(H.viewFor(g, 'mike').cell.fraud);
  ok(act('jay', { t: 'buzz' }));
  ok(act('jack', { t: 'judge', ok: true }));
  assert.strictEqual(g.scores.jay, (r + 1) * 2);
});
test('contestants never see the answer early, or the question unless "show text" is on', () => {
  const { g, act } = newGame();
  opening(g, act);
  ok(act('jay', { t: 'pick', c: 2, r: 2 }));
  const v = H.viewFor(g, 'mike');
  assert.strictEqual(v.cell.q, null);
  assert.strictEqual(v.cell.a, null);
  assert(!JSON.stringify(v).includes(g.board.cats[2].cells[2].a));
  const hv = H.viewFor(g, 'jack');
  assert(hv.cell.q && hv.cell.a, 'host sees both');
  const t = newGame(H.STARTER, { showText: true });
  opening(t.g, t.act);
  ok(t.act('jay', { t: 'pick', c: 2, r: 2 }));
  assert(H.viewFor(t.g, 'mike').cell.q);
  assert.strictEqual(H.viewFor(t.g, 'mike').cell.a, null);
});
test('host can reset buzzers, adjust scores, and hand over control', () => {
  const { g, act } = newGame();
  opening(g, act);
  ok(act('jay', { t: 'pick', c: 0, r: 0 }));
  ok(act('mike', { t: 'buzz' }));
  ok(act('jack', { t: 'resetBuzz' }));
  assert.strictEqual(g.phase, 'read');
  assert.strictEqual(g.buzz, null);
  ok(act('mike', { t: 'buzz' }));
  assert.strictEqual(g.buzz, 'mike', 'can buzz again after a reset');
  ok(act('jack', { t: 'adjust', pid: 'rich', d: 2 }));
  assert.strictEqual(g.scores.rich, 2);
  assert.notStrictEqual(act('mike', { t: 'adjust', pid: 'mike', d: 5 }), '', 'only the host rules');
  ok(act('jack', { t: 'setControl', pid: 'rich' }));
  assert.strictEqual(g.control, 'rich');
});

console.log('round robin');
test('turns go round from the picker; first out 0, second out 2, winner 5 and control', () => {
  const { g, act } = newGame();
  opening(g, act); // jay in control, order jay, mike, rich
  ok(act('jay', { t: 'pick', robin: 0 }));
  assert.strictEqual(g.phase, 'robin');
  assert.deepStrictEqual(g.robin.order, ['jay', 'mike', 'rich']);
  const turn = () => g.robin.active[g.robin.turn];
  assert.strictEqual(turn(), 'jay');
  ok(act('jack', { t: 'robinJudge', ok: true }));   // jay names one
  assert.strictEqual(turn(), 'mike');
  ok(act('jack', { t: 'robinJudge', ok: false }));  // mike out
  assert.strictEqual(turn(), 'rich');
  ok(act('jack', { t: 'robinJudge', ok: true }));   // rich
  assert.strictEqual(turn(), 'jay');
  ok(act('jack', { t: 'robinJudge', ok: false }));  // jay out -> rich wins
  assert.strictEqual(g.phase, 'robinDone');
  assert.deepStrictEqual(g.scores, { mike: 0, rich: 5, jay: 2 });
  assert.strictEqual(g.control, 'rich');
  ok(act('jack', { t: 'toBoard' }));
  assert.notStrictEqual(act('rich', { t: 'pick', robin: 0 }), '');
});

console.log('final gamble');
function playToFinal() {
  const t = newGame();
  const { g, act } = t;
  opening(g, act);
  ok(act('jack', { t: 'adjust', pid: 'rich', d: 10 }));
  ok(act('jack', { t: 'adjust', pid: 'mike', d: 6 }));
  ok(act('jack', { t: 'adjust', pid: 'jay', d: 3 }));
  ok(act('jack', { t: 'toFinal' }));
  return t;
}
test('a half-right answer gets half the points and control, and ends the question', () => {
  const { g, act } = newGame();
  opening(g, act);
  ok(act('jay', { t: 'pick', c: 3, r: 2 }));
  ok(act('mike', { t: 'buzz' }));
  ok(act('jack', { t: 'judge', half: true }));
  assert.strictEqual(g.scores.mike, 1.5);
  assert.strictEqual(g.control, 'mike');
  assert.strictEqual(g.phase, 'answer');
  assert(g.last.ok && g.last.half);
});
test('a half-right final answer wins half the wager', () => {
  const { g, act } = playToFinal();
  ok(act('jay', { t: 'finalPick', k: 0 }));
  ok(act('jay', { t: 'wager', n: 4 }));
  ok(act('jack', { t: 'finalQ' }));
  ok(act('jack', { t: 'finalReveal' }));
  const before = g.scores.jay;
  ok(act('jack', { t: 'finalJudge', ok: false }));
  ok(act('jack', { t: 'finalJudge', ok: false }));
  ok(act('jack', { t: 'finalJudge', half: true })); // jay is last in the order
  assert.strictEqual(g.final.results.jay, 'half');
  assert.strictEqual(g.scores.jay, before + 2);
});
test('last place picks the final; wagers are capped and secret; leader revealed first', () => {
  const { g, act } = playToFinal();
  assert.strictEqual(g.phase, 'finalPick');
  assert.strictEqual(g.final.picker, 'jay');
  assert.notStrictEqual(act('rich', { t: 'finalPick', k: 0 }), '');
  ok(act('jay', { t: 'finalPick', k: 0 }));
  assert.strictEqual(g.phase, 'wager');
  assert.notStrictEqual(act('jay', { t: 'wager', n: 6 }), '', 'cannot wager more than max(score, 5)');
  ok(act('jay', { t: 'wager', n: 5 }));
  assert.notStrictEqual(act('mike', { t: 'wager', n: 7 }), '');
  ok(act('jay', { t: 'wager', n: 3 }));
  ok(act('mike', { t: 'wager', n: 3 }));
  assert.deepStrictEqual(Object.keys(H.viewFor(g, 'rich').final.wagers), [], 'others\' wagers hidden');
  assert.strictEqual(H.viewFor(g, 'rich').final.q, null, 'question hidden until wagers are in');
  ok(act('jack', { t: 'finalQ' }));
  assert.strictEqual(g.final.wagers.rich, 0, 'no wager = 0');
  assert(H.viewFor(g, 'rich').final.q);
  ok(act('jay', { t: 'finalAnswer', text: 'Super Mario Bros.' }));
  ok(act('mike', { t: 'finalAnswer', text: 'WarGames' }));
  assert.deepStrictEqual(Object.keys(H.viewFor(g, 'rich').final.answers), [], 'others\' answers hidden');
  ok(act('jack', { t: 'finalReveal' }));
  assert.deepStrictEqual(g.final.order, ['rich', 'mike', 'jay']);
  ok(act('jack', { t: 'finalJudge', ok: false })); // rich: "(no answer)", wagered 0
  ok(act('jack', { t: 'finalJudge', ok: false })); // mike wrong -3
  assert.strictEqual(H.viewFor(g, 'rich').final.answers.mike, 'WarGames', 'revealed answers become public');
  ok(act('jack', { t: 'finalJudge', ok: true }));  // jay right +3
  assert.strictEqual(g.phase, 'over');
  assert.deepStrictEqual(g.scores, { mike: 3, rich: 10, jay: 6 });
});
test('clearing the whole board goes straight to the final', () => {
  const tiny = { cats: [{ name: 'One', cells: [{ q: 'q', a: 'a' }] }], robins: [], finals: [{ cat: 'F', q: 'fq', a: 'fa' }] };
  const { g, act } = newGame(tiny);
  opening(g, act);
  ok(act('jay', { t: 'pick', c: 0, r: 0 }));
  ok(act('jack', { t: 'skip' }));
  ok(act('jack', { t: 'toBoard' }));
  assert.strictEqual(g.phase, 'wager', 'single final skips the category pick');
});

console.log('fresh questions (Open Trivia DB)');
const T = require('../src/trivia.js');
test('database results decode, get options only when they need them, and rank easy-first', () => {
  const enc = encodeURIComponent;
  const mc = (q, a, wrong, difficulty = 'easy') => ({ type: 'multiple', difficulty, question: enc(q), correct_answer: enc(a), incorrect_answers: wrong.map(enc) });
  const plain = T.toCell(mc('Who directed "Jaws"?', 'Steven Spielberg', ['A', 'B', 'C']), Math.random);
  assert.strictEqual(plain.q, 'Who directed "Jaws"?');
  const which = T.toCell(mc('Which of these is a fruit?', 'Apple', ['Rock', 'Sock', 'Clock']), Math.random);
  assert(/\(.*Apple.*\)$/.test(which.q) && / or /.test(which.q), which.q);
  const tf = T.toCell({ type: 'boolean', difficulty: 'easy', question: enc('The sky is blue.'), correct_answer: 'True', incorrect_answers: ['False'] }, Math.random);
  assert.strictEqual(tf.q, 'True or false: The sky is blue.');
  const med = T.toCell(mc('Short?', 'x', ['a', 'b', 'c'], 'medium'), Math.random);
  const ranked = T.rank([med, which, plain, tf]);
  assert.deepStrictEqual(ranked, [tf, plain, which, med], 'true/false, then shorter, then medium');
  assert.strictEqual(ranked[3], med, 'medium questions are worth the most');
});
test('the client never serves a question it has already served', () => {
  const m = new Map(), store = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const rs = n => Array.from({ length: n }, (_, i) => ({ type: 'multiple', difficulty: 'easy', question: 'Q' + i, correct_answer: 'A', incorrect_answers: [] }));
  global.fetch = url => Promise.resolve({ json: () => Promise.resolve(/api_token/.test(url) ? { token: 't' } : { response_code: 0, results: rs(10) }) });
  const c = T.Client({ store });
  return c.category(9).then(cat => {
    assert.strictEqual(cat.cells.length, 5);
    return T.Client({ store }).category(9).then(cat2 => {
      const a = new Set(cat.cells.map(x => x.q));
      assert(cat2.cells.every(x => !a.has(x.q)), 'second board repeats nothing from the first');
    });
  });
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
