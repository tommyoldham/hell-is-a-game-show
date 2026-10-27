// Hell Is a Game Show: the rules engine. Pure functions over plain JSON, so the
// room owner's browser runs it and node tests can drive it without a DOM.
//
// The format follows a host-run buzzer show: a board of categories worth 1-5
// points, control of the board, buzz-in with spoken answers the host rules on
// (wrong answers cost points), "fraud" statements worth double, round robins
// scored by finishing place, and a final gamble with secret wagers.
(function (root) {
  'use strict';
  const Q = (typeof module !== 'undefined' && module.exports) ? require('./questions.js') : root.HGS_Q;
  const STARTER = Q.STARTER, LIBRARY = Q.LIBRARY;

  const POINTS = [1, 2, 3, 4, 5];
  const ROBIN_POINTS = { winner: 5, runnerUp: 2 };
  const LIMITS = { cats: 8, robins: 4, finals: 3, q: 300, a: 300, name: 30 };

  // ---------------------------------------------------------------- helpers
  function str(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Normalises a board from the editor (or a file). Blank cells stay blank and
  // are simply missing from the show.
  function cleanBoard(b) {
    b = b && typeof b === 'object' ? b : {};
    const cats = (Array.isArray(b.cats) ? b.cats : []).slice(0, LIMITS.cats).map(c => ({
      name: str(c && c.name, LIMITS.name),
      tag: str(c && c.tag, 30),
      cells: POINTS.map((_, r) => {
        const x = c && Array.isArray(c.cells) ? c.cells[r] : null;
        return { q: str(x && x.q, LIMITS.q), a: str(x && x.a, LIMITS.a), fraud: !!(x && x.fraud) };
      }),
    }));
    const robins = (Array.isArray(b.robins) ? b.robins : []).slice(0, LIMITS.robins).map(x => ({ q: str(x && x.q, LIMITS.q), a: str(x && x.a, LIMITS.a) }));
    const finals = (Array.isArray(b.finals) ? b.finals : []).slice(0, LIMITS.finals).map(x => ({ cat: str(x && x.cat, LIMITS.name), q: str(x && x.q, LIMITS.q), a: str(x && x.a, LIMITS.a) }));
    return { title: str(b.title, 40), cats, robins, finals };
  }

  // A fresh board drawn from the library: six categories, three round robins, three finals.
  function randomBoard(rng, nCats = 6) {
    const pick = (arr, n) => clone(shuffle(arr, rng).slice(0, n));
    return { title: 'Random board', cats: pick(LIBRARY.cats, nCats), robins: pick(LIBRARY.robins, 3), finals: pick(LIBRARY.finals, 3) };
  }

  // Puts each contestant's specialty category on the board, labelled with their
  // name ("Jay's pick"), ahead of the host's own categories. Two players with the
  // same specialty share one column. The board is capped at LIMITS.cats wide, so
  // the host's last categories make way if needed.
  function withSpecialties(board, players, hostId) {
    const b = cleanBoard(board);
    const picks = [];
    for (const p of players) {
      if (p.id === hostId || !p.spec) continue;
      const lib = LIBRARY.cats.find(c => c.name === p.spec);
      if (!lib) continue;
      let e = picks.find(x => x.name === lib.name);
      if (!e) picks.push(e = { name: lib.name, who: [] });
      e.who.push(p.name);
    }
    if (!picks.length) return b;
    const special = picks.map(e => {
      const base = b.cats.find(c => c.name === e.name) || clone(LIBRARY.cats.find(c => c.name === e.name));
      return Object.assign({}, base, { tag: e.who.join(' & ') + "'s pick" });
    });
    const rest = b.cats.filter(c => !picks.some(e => e.name === c.name));
    return cleanBoard(Object.assign({}, b, { cats: special.concat(rest).slice(0, LIMITS.cats) }));
  }

  // How much of a board is actually playable.
  function boardStats(b) {
    const questions = b.cats.reduce((n, c) => n + c.cells.filter(x => x.q).length, 0);
    return { questions, robins: b.robins.filter(x => x.q).length, finals: b.finals.filter(x => x.q).length };
  }

  // ---------------------------------------------------------------- setup
  // room: { showHostId, showText, board, players: [{id, name}] }
  function createGame(room, rng, now) {
    const contestants = room.players.filter(p => p.id !== room.showHostId).map(p => p.id);
    const board = cleanBoard(room.board);
    const used = {};
    board.cats.forEach((c, ci) => c.cells.forEach((x, r) => { if (!x.q) used[ci + '-' + r] = true; }));
    board.robins.forEach((x, k) => { if (!x.q) used['rr-' + k] = true; });
    return {
      hostId: room.showHostId,
      showText: !!room.showText,
      contestants,
      names: Object.fromEntries(room.players.map(p => [p.id, p.name])),
      scores: Object.fromEntries(contestants.map(id => [id, 0])),
      board,
      used,
      control: null,
      phase: 'guess',
      opening: { secret: 1 + Math.floor(rng() * 100), guesses: {}, winner: null },
      cell: null,
      buzz: null,
      buzzes: [],          // [{pid, at}] in the order the room owner received them
      lockedOut: [],
      last: null,          // {pid, ok, delta} from the latest ruling
      robin: null,
      final: null,
      say: { text: '', at: now },
      seq: 0,
    };
  }

  function bump(g) { g.seq++; }
  function isHost(g, pid) { return pid === g.hostId; }
  function isContestant(g, pid) { return g.contestants.includes(pid); }

  function cellOf(g, cell) {
    if (!cell) return null;
    if (cell.robin != null) return g.board.robins[cell.robin] || null;
    const c = g.board.cats[cell.c];
    return c ? c.cells[cell.r] : null;
  }
  function cellKey(cell) { return cell.robin != null ? 'rr-' + cell.robin : cell.c + '-' + cell.r; }
  function cellValue(g) {
    const x = cellOf(g, g.cell);
    return g.cell && g.cell.robin == null ? POINTS[g.cell.r] * (x && x.fraud ? 2 : 1) : 0;
  }
  function boardLeft(g) {
    let n = 0;
    g.board.cats.forEach((c, ci) => c.cells.forEach((x, r) => { if (!g.used[ci + '-' + r]) n++; }));
    g.board.robins.forEach((x, k) => { if (!g.used['rr-' + k]) n++; });
    return n;
  }

  function standings(g) {
    return g.contestants.map(id => ({ id, name: g.names[id], score: g.scores[id] || 0 })).sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------- phases
  function resolveOpening(g) {
    const o = g.opening;
    let best = null;
    for (const pid of g.contestants) {
      const n = o.guesses[pid];
      if (n == null) continue;
      const d = Math.abs(n - o.secret);
      if (!best || d < best.d) best = { pid, d };
    }
    o.winner = best ? best.pid : g.contestants[0];
    g.control = o.winner;
    g.phase = 'board';
  }

  function pickCell(g, cell) {
    if (cell.robin != null) {
      // Turn order starts with whoever picked it and goes round the room.
      const start = Math.max(0, g.contestants.indexOf(g.control));
      const order = g.contestants.slice(start).concat(g.contestants.slice(0, start));
      g.cell = { robin: cell.robin };
      g.robin = { order, active: order.slice(), turn: 0, out: [], named: 0, result: null };
      g.phase = 'robin';
    } else {
      g.cell = { c: cell.c, r: cell.r };
      g.phase = 'read';
    }
    g.buzz = null; g.buzzes = []; g.lockedOut = []; g.last = null;
  }

  function closeCell(g) {
    g.used[cellKey(g.cell)] = true;
    g.phase = 'answer';
  }

  function backToBoard(g) {
    g.cell = null; g.buzz = null; g.buzzes = []; g.lockedOut = []; g.robin = null;
    if (boardLeft(g) > 0) g.phase = 'board';
    else startFinal(g);
  }

  function startFinal(g) {
    g.cell = null;
    const finals = g.board.finals.map((f, k) => ({ f, k })).filter(x => x.f.q);
    if (!finals.length || !g.contestants.length) { g.phase = 'over'; return; }
    // Last place picks the final category (ties: whoever is listed first).
    const s = standings(g);
    const picker = s[s.length - 1].id;
    g.final = { picker, k: finals.length === 1 ? finals[0].k : null, wagers: {}, answers: {}, results: {} };
    g.phase = finals.length === 1 ? 'wager' : 'finalPick';
  }

  // Anyone can bet at least 5, so last place always has a comeback shot.
  function maxWager(g, pid) { return Math.max(5, g.scores[pid] || 0); }

  // Robin: after a ruling, move to the next player still in.
  function robinAdvance(g, ok) {
    const R = g.robin;
    const cur = R.active[R.turn];
    if (ok) {
      R.named++;
      R.turn = (R.turn + 1) % R.active.length;
    } else {
      R.out.push(cur);
      R.active.splice(R.turn, 1);
      if (R.turn >= R.active.length) R.turn = 0;
    }
    const finishAt = g.contestants.length >= 2 ? 1 : 0;
    if (R.active.length <= finishAt) {
      const winner = R.active[0] || null;
      const runnerUp = g.contestants.length >= 3 ? R.out[R.out.length - 1] : null;
      const awards = {};
      if (winner) awards[winner] = ROBIN_POINTS.winner;
      if (runnerUp) awards[runnerUp] = ROBIN_POINTS.runnerUp;
      for (const [pid, pts] of Object.entries(awards)) g.scores[pid] += pts;
      R.result = { winner, runnerUp, awards };
      if (winner) g.control = winner;
      g.used[cellKey(g.cell)] = true;
      g.phase = 'robinDone';
    }
  }

  // ---------------------------------------------------------------- intents
  // Handles one intent. Returns an error string, or '' when applied.
  function act(g, pid, msg, rng, now) {
    if (!g || !msg) return 'No game.';
    const host = isHost(g, pid);
    const player = isContestant(g, pid);
    switch (msg.t) {
      // ---- opening: closest to the host's secret number gets control
      case 'guess': {
        if (!player || g.phase !== 'guess') return 'Not now.';
        const n = Math.round(+msg.n);
        if (!(n >= 1 && n <= 100)) return 'Pick a number from 1 to 100.';
        g.opening.guesses[pid] = n;
        if (g.contestants.every(p => g.opening.guesses[p] != null)) resolveOpening(g);
        bump(g); return '';
      }
      case 'guessDone':
        if (!host || g.phase !== 'guess') return 'Not now.';
        resolveOpening(g); bump(g); return '';

      // ---- board
      case 'pick': {
        if (g.phase !== 'board') return 'Not now.';
        if (!host && pid !== g.control) return 'It\'s not your pick.';
        const cell = msg.robin != null ? { robin: msg.robin | 0 } : { c: msg.c | 0, r: msg.r | 0 };
        if (!cellOf(g, cell) || g.used[cellKey(cell)]) return 'That one\'s gone.';
        pickCell(g, cell); bump(g); return '';
      }
      case 'setControl':
        if (!host || !isContestant(g, msg.pid)) return 'Not allowed.';
        g.control = msg.pid; bump(g); return '';

      // ---- buzzers
      case 'buzz': {
        // Late buzzes still count for the "who was close behind" display.
        if (!player || (g.phase !== 'read' && g.phase !== 'buzzed')) return '';
        if (g.lockedOut.includes(pid) || g.buzzes.some(b => b.pid === pid)) return '';
        g.buzzes.push({ pid, at: now });
        if (!g.buzz) { g.buzz = pid; g.phase = 'buzzed'; }
        bump(g); return '';
      }
      case 'judge': {
        if (!host || g.phase !== 'buzzed') return 'Not now.';
        const v = cellValue(g);
        const who = g.buzz;
        g.scores[who] += msg.ok ? v : -v;
        g.last = { pid: who, ok: !!msg.ok, delta: msg.ok ? v : -v };
        if (msg.ok) { g.control = who; closeCell(g); }
        else {
          g.lockedOut.push(who);
          g.buzz = null; g.buzzes = [];
          if (g.contestants.every(p => g.lockedOut.includes(p))) closeCell(g);
          else g.phase = 'read';
        }
        bump(g); return '';
      }
      case 'resetBuzz':
        if (!host || (g.phase !== 'buzzed' && g.phase !== 'read')) return 'Not now.';
        g.buzz = null; g.buzzes = []; g.phase = 'read';
        bump(g); return '';
      case 'skip':
        if (!host || (g.phase !== 'read' && g.phase !== 'buzzed')) return 'Not now.';
        g.last = null; closeCell(g); bump(g); return '';
      case 'toBoard':
        if (!host || (g.phase !== 'answer' && g.phase !== 'robinDone')) return 'Not now.';
        backToBoard(g); bump(g); return '';

      // ---- round robin
      case 'robinJudge':
        if (!host || g.phase !== 'robin') return 'Not now.';
        robinAdvance(g, !!msg.ok); bump(g); return '';

      // ---- final gamble
      case 'toFinal':
        if (!host || g.phase !== 'board') return 'Not now.';
        startFinal(g); bump(g); return '';
      case 'finalPick': {
        if (g.phase !== 'finalPick') return 'Not now.';
        if (!host && pid !== g.final.picker) return 'Last place picks the final category.';
        const f = g.board.finals[msg.k | 0];
        if (!f || !f.q) return 'Not a category.';
        g.final.k = msg.k | 0; g.phase = 'wager';
        bump(g); return '';
      }
      case 'wager': {
        if (!player || g.phase !== 'wager') return 'Not now.';
        const n = Math.round(+msg.n);
        if (!(n >= 0 && n <= maxWager(g, pid))) return `You can wager 0 to ${maxWager(g, pid)}.`;
        g.final.wagers[pid] = n;
        bump(g); return '';
      }
      case 'finalQ':
        if (!host || g.phase !== 'wager') return 'Not now.';
        g.contestants.forEach(p => { if (g.final.wagers[p] == null) g.final.wagers[p] = 0; });
        g.phase = 'finalQ'; bump(g); return '';
      case 'finalAnswer': {
        if (!player || g.phase !== 'finalQ') return 'Not now.';
        g.final.answers[pid] = str(msg.text, 120) || '(blank)';
        bump(g); return '';
      }
      case 'finalReveal':
        if (!host || g.phase !== 'finalQ') return 'Not now.';
        g.contestants.forEach(p => { if (!g.final.answers[p]) g.final.answers[p] = '(no answer)'; });
        // Leader first, like the show.
        g.final.order = standings(g).map(s => s.id);
        g.phase = 'finalReveal'; bump(g); return '';
      case 'finalJudge': {
        if (!host || g.phase !== 'finalReveal') return 'Not now.';
        const next = g.final.order.find(p => !(p in g.final.results));
        if (!next) return 'Everyone\'s been revealed.';
        const w = g.final.wagers[next] || 0;
        g.final.results[next] = !!msg.ok;
        g.scores[next] += msg.ok ? w : -w;
        if (g.final.order.every(p => p in g.final.results)) g.phase = 'over';
        bump(g); return '';
      }

      // ---- host tools
      case 'adjust': {
        if (!host || !isContestant(g, msg.pid)) return 'Not allowed.';
        const d = Math.max(-10, Math.min(10, Math.round(+msg.d) || 0));
        g.scores[msg.pid] += d; bump(g); return '';
      }
      case 'say':
        if (!host) return 'Only the host can do that.';
        g.say = { text: str(msg.text, 200), at: now }; bump(g); return '';
      case 'end':
        if (!host) return 'Only the host can do that.';
        g.phase = 'over'; bump(g); return '';
    }
    return 'Unknown action.';
  }

  // ---------------------------------------------------------------- views
  // What one player may see. The host sees everything; contestants never get
  // answers before they're revealed, other players' secret wagers or final
  // answers early, or the opening number before it's resolved.
  function viewFor(g, pid) {
    if (!g) return null;
    const host = isHost(g, pid);
    const b = g.board;
    const cur = cellOf(g, g.cell);
    const showQ = host || g.showText || g.phase === 'answer';
    const v = {
      hostId: g.hostId, contestants: g.contestants, names: g.names, scores: g.scores,
      phase: g.phase, control: g.control, buzz: g.buzz, buzzes: g.buzzes, lockedOut: g.lockedOut,
      last: g.last, say: g.say, seq: g.seq, showText: g.showText,
      board: {
        cats: b.cats.map((c, ci) => ({ name: c.name, tag: c.tag, cells: c.cells.map((x, r) => ({ pts: POINTS[r], used: !!g.used[ci + '-' + r], blank: !x.q })) })),
        robins: b.robins.map((x, k) => ({ used: !!g.used['rr-' + k], blank: !x.q })),
      },
      opening: { guesses: g.phase === 'guess' && !host ? (g.opening.guesses[pid] != null ? { [pid]: g.opening.guesses[pid] } : {}) : g.opening.guesses,
        secret: g.phase === 'guess' && !host ? null : g.opening.secret, winner: g.opening.winner, guessed: Object.keys(g.opening.guesses) },
      cell: null,
      robin: g.robin,
      final: null,
    };
    if (g.cell && cur) {
      if (g.cell.robin != null) v.cell = { robin: g.cell.robin, q: cur.q, a: host || g.phase === 'robinDone' ? cur.a : null };
      else v.cell = { c: g.cell.c, r: g.cell.r, cat: b.cats[g.cell.c].name, pts: POINTS[g.cell.r], value: cellValue(g), fraud: cur.fraud,
        q: showQ ? cur.q : null, a: host || g.phase === 'answer' ? cur.a : null };
    }
    if (g.final) {
      const F = g.final, f = F.k != null ? b.finals[F.k] : null;
      const revealedAll = g.phase === 'over';
      const seen = p => host || p === pid || p in F.results || revealedAll;
      v.final = {
        picker: F.picker, k: F.k,
        cats: b.finals.map(x => (x.q ? x.cat : null)),
        cat: f ? f.cat : null,
        q: f && (g.phase === 'finalQ' || g.phase === 'finalReveal' || g.phase === 'over') ? f.q : null,
        a: f && (host || g.phase === 'over') ? f.a : null,
        wagered: Object.keys(F.wagers), answered: Object.keys(F.answers),
        wagers: Object.fromEntries(Object.entries(F.wagers).filter(([p]) => seen(p))),
        answers: Object.fromEntries(Object.entries(F.answers).filter(([p]) => seen(p))),
        results: F.results, order: F.order || null,
        max: maxWager(g, pid),
      };
    }
    return v;
  }

  const api = { STARTER, LIBRARY, randomBoard, withSpecialties, POINTS, ROBIN_POINTS, LIMITS, cleanBoard, boardStats, createGame, act, viewFor, standings, shuffle, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HGS = api;
})(typeof window !== 'undefined' ? window : globalThis);
