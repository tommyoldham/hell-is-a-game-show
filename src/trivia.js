// Fresh questions from the free Open Trivia Database (opentdb.com, CC BY-SA 4.0).
// Kirby's brief: simple, not obscure, and never the same question twice. So:
// - easy questions first, medium only to fill a gap, never hard;
// - an OpenTDB session token, which never serves the same question twice while
//   it lives (it expires after 6 hours unused);
// - our own "seen" list in localStorage, which covers games days apart;
// - spares from each fetch go in a pool, so swapping one question is instant.
// OpenTDB allows one request per 5 seconds per address, so calls are queued.
(function (root) {
  'use strict';

  const API = 'https://opentdb.com/';
  const GAP_MS = 5200;
  const SEEN_MAX = 6000;

  const CATS = [
    [9, 'General Knowledge'], [11, 'Film'], [14, 'Television'], [12, 'Music'], [15, 'Video Games'],
    [17, 'Science & Nature'], [22, 'Geography'], [23, 'History'], [21, 'Sport'], [27, 'Animals'],
    [32, 'Cartoons'], [31, 'Anime & Manga'], [29, 'Comics'], [10, 'Books'], [20, 'Mythology'],
    [26, 'Celebrities'], [18, 'Computers'], [30, 'Gadgets'], [28, 'Vehicles'], [16, 'Board Games'],
    [25, 'Art'], [19, 'Maths'], [13, 'Musicals & Theatre'], [24, 'Politics'],
  ].map(([id, name]) => ({ id, name }));

  function decode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function key(q) { return q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  // Long or multi-part answers ("Kaltag, Nikki, and Star") are the obscure ones.
  function simple(c) { return c.a.length <= 30 && !/, /.test(c.a) && c.q.length <= 200; }

  // One OpenTDB result -> one board cell. Multiple-choice questions that only
  // make sense with their options ("Which of these...") get the options added.
  function toCell(r, rng) {
    const q = decode(r.question).trim(), a = decode(r.correct_answer).trim();
    if (r.type === 'boolean') return { q: 'True or false: ' + q, a, fraud: false, diff: r.difficulty };
    let text = q;
    if (/\b(which|what) of (these|the following)\b|\bfollowing\b|\bnot\b/i.test(q)) {
      const opts = [a].concat((r.incorrect_answers || []).map(decode));
      for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
      text += ' (' + opts.slice(0, -1).join(', ') + ' or ' + opts[opts.length - 1] + ')';
    }
    return { q: text, a, fraud: false, diff: r.difficulty };
  }

  // Easiest first; true/false (a coin flip) before open questions; then shorter
  // questions first. So 1 point is the gimme.
  function rank(cells) {
    const d = { easy: 0, medium: 1, hard: 2 };
    const tf = c => (/^True or false: /.test(c.q) ? 0 : 1);
    return cells.slice().sort((x, y) => (d[x.diff] - d[y.diff]) || (tf(x) - tf(y)) || (x.q.length - y.q.length));
  }

  function Client(opts) {
    const store = (opts && opts.store) || null;
    const rng = (opts && opts.rng) || Math.random;
    const get = k => { try { return JSON.parse(store.getItem('hgs:' + k)); } catch (e) { return null; } };
    const put = (k, v) => { try { store.setItem('hgs:' + k, JSON.stringify(v)); } catch (e) {} };
    let seen = new Set(get('seen') || []);
    const pools = get('pools') || {};
    let token = get('otdbToken');
    let nextAt = 0;
    let chain = Promise.resolve();

    function markSeen(cells) {
      cells.forEach(c => seen.add(key(c.q)));
      const arr = Array.from(seen);
      if (arr.length > SEEN_MAX) seen = new Set(arr.slice(-SEEN_MAX));
      put('seen', Array.from(seen));
    }

    // Requests run one at a time, at least GAP_MS apart.
    function call(path) {
      const run = () => new Promise(res => setTimeout(res, Math.max(0, nextAt - Date.now())))
        .then(() => { nextAt = Date.now() + GAP_MS; return fetch(API + path); })
        .then(r => (r.status === 429 ? { response_code: 5 } : r.json())); // 429 = too fast
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    }
    function freshToken(tries = 0) {
      return call('api_token.php?command=request').then(j => {
        if (!j.token) { if (tries < 3) return freshToken(tries + 1); throw new Error('The trivia database is busy. Try again in a minute.'); }
        token = j.token; put('otdbToken', token); return token;
      });
    }
    // Returns raw results; [] when OpenTDB has nothing (left) for that query.
    function query(params, retried, waits = 0) {
      const go = () => call('api.php?encode=url3986&token=' + token + '&' + params).then(j => {
        if (j.response_code === 0) return j.results;
        if (j.response_code === 3 && !retried) { token = null; return query(params, true, waits); } // token expired
        if (j.response_code === 5 && waits < 4) { nextAt = Date.now() + GAP_MS; return query(params, retried, waits + 1); } // too fast
        return []; // 1: not enough questions, 4: token has used them all
      });
      return token ? go() : freshToken().then(go);
    }

    // Fills a category's pool with unseen questions, easy first, then medium.
    function fill(id, want) {
      const pool = pools[id] = pools[id] || [];
      const take = list => list.map(r => toCell(r, rng)).filter(c => simple(c) && !seen.has(key(c.q)) && !pool.some(p => key(p.q) === key(c.q)));
      const step = (diffs, amount) => {
        if (pool.length >= want || !diffs.length) return Promise.resolve();
        return query(`amount=${amount}&category=${id}&difficulty=${diffs[0]}`).then(rs => {
          const got = take(rs);
          pool.push(...got);
          // OpenTDB answers "not enough" to big asks; a smaller ask may still work.
          if (pool.length >= want) return;
          if (!rs.length && amount > 5) return step(diffs, 5);
          return step(diffs.slice(1), amount);
        });
      };
      return step(['easy', 'medium'], 10).then(() => { put('pools', pools); return pool; });
    }
    function draw(id, n) {
      const pool = pools[id] || [];
      const out = pool.splice(0, n);
      markSeen(out);
      put('pools', pools);
      return out;
    }

    return {
      CATS,
      // A full category: 5 questions, worth 1-5 by difficulty.
      category(id) {
        const cat = CATS.find(c => c.id === id) || CATS[0];
        return fill(id, 5).then(() => {
          const cells = rank(draw(id, 5)).map(({ q, a }) => ({ q, a, fraud: false }));
          if (cells.length < 5) throw new Error(`Ran out of fresh ${cat.name} questions. Try another category.`);
          return { name: cat.name, src: id, cells };
        });
      },
      // One replacement question from the same category.
      one(id) {
        return fill(id, 1).then(() => {
          const [c] = draw(id, 1);
          if (!c) throw new Error('No fresh questions left in that category.');
          return { q: c.q, a: c.a, fraud: false };
        });
      },
      // Easy multiple-choice questions with short answers make fair final gambles.
      finals(n) {
        return query(`amount=${n * 4}&difficulty=easy&type=multiple`).then(rs => {
          const out = rs.map(r => ({ cat: decode(r.category).replace(/^(Entertainment|Science): /, ''), ...toCell(r, rng) }))
            .filter(c => simple(c) && !seen.has(key(c.q)) && c.a.length <= 24).slice(0, n);
          markSeen(out);
          return out.map(({ cat, q, a }) => ({ cat, q, a }));
        });
      },
      seenCount: () => seen.size,
    };
  }

  const api = { Client, CATS, toCell, rank, decode, simple };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HGS_TRIVIA = api;
})(typeof window !== 'undefined' ? window : globalThis);
