// Hell Is a Game Show — UI + networking. The room creator's browser owns the room
// and runs the rules engine (HGS); everyone else sends intents and renders the
// per-player view the room creator sends back. One player is the show host: they
// write the board, read questions out loud and rule on every answer.
(function () {
  'use strict';
  const H = window.HGS;
  const A = window.HGSArt;
  const app = document.getElementById('app');

  const PEER_PREFIX = 'hellisagameshow-v2-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const COLORS = ['#ff5a5a', '#ffb627', '#5ad1ff', '#7dff6a', '#c88bff', '#ff7ad9', '#f2f2f2', '#ff9248'];
  const HEARTBEAT_MS = 3000;
  const TIMEOUT_MS = 12000;
  const MAX_PLAYERS = 9;
  const SOUNDBOARD = [
    { id: 'ding', label: '🔔 Ding' }, { id: 'buzzer', label: '❌ Buzzer' }, { id: 'drumroll', label: '🥁 Drumroll' },
    { id: 'gong', label: '🔊 Gong' }, { id: 'trapdoor', label: '🕳️ Trapdoor' }, { id: 'loser', label: '😈 "Loser!"' },
  ];
  // Banter for the host to read out (or put in the speech bubble).
  const CUES = {
    open: ['Welcome to Hell Is a Game Show. I made it up. There are no refunds.', 'The rules: buzz in, and I stop reading. Mid-word. Mid-syllable.', 'Wrong answers cost points. The judges are me. I am all of the judges.'],
    read: ['Fraud question! Something in this statement is a lie. Correct me.', 'Buzzers ready. Try not to embarrass yourselves.', 'Big swing. I respect it. I don\'t like it, but I respect it.'],
    ruling: ['I\'ll allow it.', 'I will NOT allow it.', 'That is... correct. Ugh.', 'Wrong. Hell has never been prouder.', 'Do not argue with the host. The host has a spreadsheet.'],
    robin: ['Round robin. No buzzers. Name a thing until you can\'t.', 'Tick tock.', 'Is that a real one? ...Fine.'],
    final: ['Final gamble. Bet what you like. Lose it all if you like.', 'Last place picks the category. Pity is a powerful thing.', 'Write it down. No mumbling. Mumbling is not an answer.'],
  };

  // ---------------------------------------------------------------- storage
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  const local = {
    get: (k, d) => safe(() => { const v = localStorage.getItem('hgs:' + k); return v == null ? d : JSON.parse(v); }, d),
    set: (k, v) => safe(() => localStorage.setItem('hgs:' + k, JSON.stringify(v))),
    del: k => safe(() => localStorage.removeItem('hgs:' + k)),
  };
  // Player id lives per tab, so two tabs in one browser are two players.
  const session = {
    get: (k, d) => safe(() => { const v = sessionStorage.getItem('hgs:' + k); return v == null ? d : JSON.parse(v); }, d),
    set: (k, v) => safe(() => sessionStorage.setItem('hgs:' + k, JSON.stringify(v))),
  };
  function rid(n = 10) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => (b % 36).toString(36)).join(''); }
  function rng() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function cleanName(n) { return String(n || '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Lost Soul'; }
  function pts(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }

  const me = {
    id: session.get('pid') || rid(),
    name: local.get('name', ''),
    color: local.get('color', COLORS[Math.floor(rng() * COLORS.length)]),
  };
  session.set('pid', me.id);

  // ---------------------------------------------------------------- state
  const S = {
    screen: 'home',
    role: null,              // 'host' (owns the room) | 'guest'
    code: '',
    room: null,              // room owner only: the full room including the game
    view: null,              // what this player sees
    clockOffset: 0,
    net: { status: 'idle', msg: '' },
    joinCode: (location.hash.replace('#', '').toUpperCase().match(/^[A-Z]{4}$/) || [''])[0],
    sound: local.get('sound', true),
    music: local.get('music', true),
    musicOn: false,
    sceneKey: '',
    prev: null,              // previous game view, for one-off effects
    sayAt: 0,
    fallAt: {},
    cueShift: 0,
    tab: 0,                  // board editor tab
    draft: local.get('board', null) || H.clone(H.STARTER),
    spec: local.get('spec', ''),
    sentBoardFor: null,
  };

  // ---------------------------------------------------------------- sound
  const sfx = {};
  function play(name, vol = 0.6) {
    if (!S.sound) return;
    if (name === 'drumroll') return A.drumroll();
    if (!window.HGS_SOUNDS || !HGS_SOUNDS[name]) return;
    safe(() => {
      const base = sfx[name] || (sfx[name] = new Audio(HGS_SOUNDS[name]));
      const a = base.paused ? base : base.cloneNode();
      a.volume = vol;
      a.currentTime = 0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    });
  }

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  // ================================================================ NETWORK
  const net = { peer: null, conns: new Map(), hostConn: null, timers: [], connectTimer: null, joinedOnce: false, closed: false };

  function peerAvailable() { return typeof window.Peer === 'function'; }

  function stopNet() {
    net.closed = true;
    net.timers.forEach(clearInterval); net.timers = [];
    clearTimeout(net.connectTimer);
    safe(() => net.peer && net.peer.destroy());
    net.peer = null; net.conns.clear(); net.hostConn = null;
  }

  function setNet(status, msg) { S.net = { status, msg }; render(); }

  // ---------- room owner
  function hostRoom(code, room) {
    stopNet();
    net.closed = false;
    S.role = 'host'; S.code = code; S.room = room;
    S.screen = room.game ? 'game' : 'lobby';
    S.view = publicRoom(room, me.id);
    history.replaceState(null, '', '#' + code);
    if (peerAvailable()) openHostPeer(0);
    else setNet('error', 'Online play could not load. Check your internet connection.');
    net.timers.push(setInterval(hostHeartbeat, HEARTBEAT_MS));
    commit();
  }

  function openHostPeer(attempt) {
    if (net.closed) return;
    setNet('connecting', attempt ? 'Reclaiming room code…' : 'Opening the studio…');
    const peer = new Peer(PEER_PREFIX + S.code, { debug: 1 });
    net.peer = peer;
    peer.on('open', () => { setNet('online', ''); });
    peer.on('connection', conn => {
      conn.on('open', () => { net.conns.set(conn.peer, { conn, pid: null, lastSeen: Date.now() }); });
      conn.on('data', msg => onHostData(conn, msg));
      conn.on('close', () => dropConn(conn.peer));
      conn.on('error', () => dropConn(conn.peer));
    });
    peer.on('disconnected', () => {
      // Lost the matchmaking server; open data connections keep working.
      setTimeout(() => { if (!net.closed && net.peer === peer && !peer.destroyed) safe(() => peer.reconnect()); }, 2000);
    });
    peer.on('error', e => {
      if (net.peer !== peer) return;
      if (e.type === 'unavailable-id') {
        safe(() => peer.destroy());
        // After a refresh the old session can hold the id for a little while.
        if (attempt < 10) { setNet('connecting', 'Room code still held by the last session, retrying…'); setTimeout(() => openHostPeer(attempt + 1), 3000); }
        else setNet('error', 'That room code is taken. Start a new show.');
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        setNet('offline', 'Lost the connection to the matchmaking server. Retrying…');
        setTimeout(() => { if (net.peer === peer && !net.closed) { safe(() => peer.destroy()); openHostPeer(attempt + 1); } }, 4000);
      } else if (e.type === 'browser-incompatible') {
        setNet('error', 'This browser does not support online play (WebRTC).');
      } else {
        console.warn('peer error', e.type, e);
      }
    });
  }

  function dropConn(peerId) {
    const c = net.conns.get(peerId);
    if (!c) return;
    net.conns.delete(peerId);
    if (c.pid && ![...net.conns.values()].some(o => o.pid === c.pid)) {
      const p = S.room.players.find(p => p.id === c.pid);
      if (p && p.connected) { p.connected = false; toast(`${p.name} dropped out`); commit(); }
    }
  }

  function hostHeartbeat() {
    const now = Date.now();
    for (const [peerId, c] of net.conns) {
      if (now - c.lastSeen > TIMEOUT_MS) { safe(() => c.conn.close()); dropConn(peerId); continue; }
      safe(() => c.conn.send({ t: 'ping' }));
    }
  }

  function onHostData(conn, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    const c = net.conns.get(conn.peer) || { conn, pid: null, lastSeen: 0 };
    c.lastSeen = Date.now();
    net.conns.set(conn.peer, c);
    if (msg.t === 'pong' || msg.t === 'ping') return;
    if (msg.t === 'hello') {
      const pid = hostJoin(msg);
      if (!pid) { safe(() => conn.send({ t: 'error', reason: 'This show is full.' })); return; }
      c.pid = pid;
      safe(() => conn.send({ t: 'welcome', pid }));
      commit();
      return;
    }
    if (!c.pid) return;
    handle(c.pid, msg);
  }

  function hostJoin(msg) {
    const room = S.room;
    const name = cleanName(msg.name);
    let p = room.players.find(p => p.id === msg.pid);
    // A returning player with a fresh tab takes their old seat back by name.
    if (!p) p = room.players.find(p => !p.connected && p.name.toLowerCase() === name.toLowerCase() && p.id !== room.ownerId);
    if (!p) {
      if (room.players.length >= MAX_PLAYERS) return null;
      p = { id: String(msg.pid || rid()).slice(0, 20), name, color: COLORS.includes(msg.color) ? msg.color : COLORS[0], connected: true, spec: H.LIBRARY.cats.some(c => c.name === msg.spec) ? msg.spec : '' };
      if (room.players.some(o => o.color === p.color)) p.color = COLORS.find(col => !room.players.some(o => o.color === col)) || p.color;
      room.players.push(p);
      toast(room.game ? `${name} is watching` : `${name} joined`);
      play('pop');
    } else {
      if (!p.connected) { toast(`${p.name} is back`); play('pop'); }
      p.connected = true;
      if (name) p.name = name;
      if (!room.game && msg.spec !== undefined) p.spec = H.LIBRARY.cats.some(c => c.name === msg.spec) ? msg.spec : '';
    }
    return p.id;
  }

  function publicRoom(room, pid) {
    const host = pid === room.showHostId;
    const b = room.board;
    return {
      code: S.code, ownerId: room.ownerId, showHostId: room.showHostId, showText: room.showText, useSpecs: room.useSpecs,
      players: room.players,
      // Contestants get the category names only; the host already has the board.
      boardInfo: b ? { title: b.title, cats: b.cats.map(c => c.name), stats: H.boardStats(b) } : null,
      hasBoard: !!b && host,
      game: H.viewFor(room.game, pid),
      now: Date.now(),
    };
  }

  function saveHost() {
    if (S.role === 'host' && S.room) local.set('hostRoom', { code: S.code, room: S.room, ownerPid: me.id, savedAt: Date.now() });
  }

  function commit() {
    saveHost();
    for (const c of net.conns.values()) if (c.pid) safe(() => c.conn.send({ t: 'room', room: publicRoom(S.room, c.pid) }));
    onView(publicRoom(S.room, me.id));
  }

  function hostBroadcast(msg) { for (const c of net.conns.values()) if (c.pid) safe(() => c.conn.send(msg)); }

  // ---------- guest
  function joinRoom(code) {
    stopNet();
    net.closed = false;
    net.joinedOnce = false;
    S.role = 'guest'; S.code = code; S.room = null; S.view = null; S.screen = 'lobby';
    history.replaceState(null, '', '#' + code);
    if (!peerAvailable()) { setNet('error', 'Online play could not load. Check your internet connection.'); return; }
    setNet('connecting', `Looking for show ${code}…`);
    const peer = new Peer(PEER_PREFIX + 'g-' + rid(12), { debug: 1 });
    net.peer = peer;
    peer.on('open', () => connectToHost());
    peer.on('disconnected', () => {
      setTimeout(() => { if (!net.closed && net.peer === peer && !peer.destroyed) safe(() => peer.reconnect()); }, 2000);
    });
    peer.on('error', e => {
      if (net.peer !== peer) return;
      if (e.type === 'peer-unavailable') {
        clearTimeout(net.connectTimer);
        if (!net.joinedOnce) { setNet('error', `No show called ${code} is on air. Check the code.`); }
        else { setNet('offline', 'The room owner has gone quiet. Reconnecting…'); net.connectTimer = setTimeout(connectToHost, 3000); }
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        setNet('offline', 'Lost the matchmaking server. Retrying…');
      } else if (e.type === 'browser-incompatible') {
        setNet('error', 'This browser does not support online play (WebRTC).');
      } else console.warn('peer error', e.type, e);
    });
    let lastHost = Date.now();
    net.timers.push(setInterval(() => {
      if (!net.hostConn) return;
      if (Date.now() - lastHost > TIMEOUT_MS) {
        safe(() => net.hostConn.close());
        net.hostConn = null;
        setNet('offline', 'Connection dropped. Reconnecting…');
        connectToHost();
      } else safe(() => net.hostConn.send({ t: 'ping' }));
    }, HEARTBEAT_MS));

    function connectToHost() {
      if (net.closed || !net.peer || net.peer.destroyed) return;
      if (net.peer.disconnected) { safe(() => net.peer.reconnect()); net.connectTimer = setTimeout(connectToHost, 2000); return; }
      clearTimeout(net.connectTimer);
      const conn = net.peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      net.connectTimer = setTimeout(() => {
        if (net.hostConn === conn) return;
        safe(() => conn.close());
        if (S.net.status !== 'error') { setNet('offline', net.joinedOnce ? 'Reconnecting…' : `Still trying to reach show ${code}…`); connectToHost(); }
      }, 10000);
      conn.on('open', () => {
        clearTimeout(net.connectTimer);
        net.hostConn = conn;
        lastHost = Date.now();
        conn.send({ t: 'hello', pid: me.id, name: me.name, color: me.color, spec: S.spec });
      });
      conn.on('data', msg => { lastHost = Date.now(); onGuestData(msg); });
      conn.on('close', () => {
        if (net.hostConn !== conn || net.closed) return;
        net.hostConn = null;
        setNet('offline', 'Connection dropped. Reconnecting…');
        net.connectTimer = setTimeout(connectToHost, 1500);
      });
    }
  }

  function onGuestData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'ping': safe(() => net.hostConn.send({ t: 'pong' })); break;
      case 'welcome':
        net.joinedOnce = true;
        if (msg.pid && msg.pid !== me.id) { me.id = msg.pid; session.set('pid', me.id); }
        setNet('online', '');
        break;
      case 'room': onView(msg.room); break;
      case 'sfx': play(msg.name); break;
      case 'error': toast(msg.reason, 'bad'); play('buzzer'); break;
    }
  }

  // Every intent goes through here: the room owner handles it locally, guests send it.
  function send(msg) {
    if (S.role === 'host') handle(me.id, msg);
    else if (net.hostConn) safe(() => net.hostConn.send(msg));
    else toast('Not connected yet…', 'bad');
  }

  function reject(pid, reason) {
    if (pid === me.id) { toast(reason, 'bad'); return; }
    for (const c of net.conns.values()) if (c.pid === pid) safe(() => c.conn.send({ t: 'error', reason }));
  }

  // ---------- the room owner's rules for lobby + game intents
  function handle(pid, msg) {
    const room = S.room;
    const owner = pid === room.ownerId;
    const g = room.game;
    switch (msg.t) {
      case 'setHost':
        if (!owner || g || !room.players.some(p => p.id === msg.pid)) return;
        room.showHostId = msg.pid;
        room.board = null; // the new host brings their own board
        break;
      case 'setSpec': {
        const p = room.players.find(p => p.id === pid);
        if (!p || g) return;
        p.spec = H.LIBRARY.cats.some(c => c.name === msg.spec) ? msg.spec : '';
        break;
      }
      case 'setUseSpecs':
        if (!owner || g) return;
        room.useSpecs = !!msg.on;
        break;
      case 'setShowText':
        if (!owner || g) return;
        room.showText = !!msg.on;
        break;
      case 'setBoard':
        if (pid !== room.showHostId || g) return;
        room.board = H.cleanBoard(msg.board);
        break;
      case 'start': {
        if (!owner || (g && g.phase !== 'over')) return;
        const host = room.players.find(p => p.id === room.showHostId);
        if (!host || !host.connected) return reject(pid, 'The host isn\'t here.');
        if (!room.board || !H.boardStats(room.board).questions) return reject(pid, 'The host needs a board with at least one question.');
        const players = room.players.filter(p => p.connected);
        if (players.length < 2) return reject(pid, 'You need at least one contestant besides the host.');
        const board = room.useSpecs !== false ? H.withSpecialties(room.board, players, room.showHostId) : room.board;
        room.game = H.createGame({ showHostId: room.showHostId, showText: room.showText, board, players }, rng, Date.now());
        break;
      }
      case 'lobby':
        if ((!owner && pid !== room.showHostId) || !g) return;
        room.game = null;
        break;
      case 'sfx':
        if (!g || pid !== g.hostId || !SOUNDBOARD.some(s => s.id === msg.name)) return;
        hostBroadcast({ t: 'sfx', name: msg.name });
        play(msg.name);
        return;
      default: {
        if (!g) return;
        const err = H.act(g, pid, msg, rng, Date.now());
        if (err) return reject(pid, err);
      }
    }
    commit();
  }

  // ================================================================ VIEW UPDATES
  function onView(view) {
    const prevView = S.view;
    S.view = view;
    if (S.role === 'guest') S.clockOffset = view.now - Date.now();
    const g = view.game;
    if (g) S.screen = 'game';
    else if (S.screen === 'game' || S.screen === 'home') S.screen = 'lobby';
    if (!g) S.prev = null;
    // The host's board lives in their own browser; hand it to the room owner.
    if (!g && view.showHostId === me.id && (!view.hasBoard || S.sentBoardFor !== view.code + view.showHostId)) {
      S.sentBoardFor = view.code + view.showHostId;
      setTimeout(() => send({ t: 'setBoard', board: S.draft }), 0);
    }
    if (prevView && prevView.showHostId !== view.showHostId && view.showHostId !== me.id) S.sentBoardFor = null;
    if (g) react(S.prev, g);
    S.prev = g;
    render();
  }

  const amHost = g => g && g.hostId === me.id;
  const amPlaying = g => g && g.contestants.includes(me.id);

  // ---------- big Jackbox-style announcements
  const splashEl = document.createElement('div');
  splashEl.id = 'splash';
  document.body.appendChild(splashEl);
  let splashTimer = null;
  function splash(title, sub = '', kind = '', ms = 1500) {
    splashEl.className = '';
    void splashEl.offsetWidth; // restart the animation
    splashEl.className = 'show ' + kind;
    splashEl.style.setProperty('--ms', ms + 'ms');
    splashEl.innerHTML = `<div class="sp"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
    clearTimeout(splashTimer);
    splashTimer = setTimeout(() => { splashEl.className = ''; }, ms);
  }

  // One-off effects when the game moves on.
  function react(p, g) {
    const name = id => g.names[id] || '?';
    if (g.say && g.say.at !== S.sayAt && g.say.text) {
      S.sayAt = g.say.at;
      stage.talk(Math.min(5000, 600 + g.say.text.length * 45));
    }
    if (!p) { if (g.phase === 'guess') { play('gong'); splash('IT\'S SHOWTIME', 'Guess the host\'s number', 'robin', 1800); } return; }
    if (p.phase !== g.phase) {
      if (g.phase === 'read' && p.phase === 'board') {
        play('question', 0.5);
        if (g.cell && g.cell.fraud) { play('soulbet'); stage.shake(500); splash('FRAUD!', 'Something in this is a lie. Double points.', 'fraud', 1900); }
        else if (g.cell) { const tag = (g.board.cats[g.cell.c] || {}).tag; splash(`${g.cell.cat}`, `for ${g.cell.pts}${tag ? ' · ' + tag : ''}`, 'cat', 1300); }
      }
      if (g.phase === 'robin') { play('question', 0.5); splash('ROUND ROBIN', g.cell && g.cell.q, 'robin', 2000); }
      if (g.phase === 'board' && p.phase === 'guess') { play('ding'); splash(`${name(g.control)} picks first!`, g.opening.secret != null ? `The number was ${g.opening.secret}` : '', 'good', 1800); }
      if (g.phase === 'robinDone') { play('ding'); const r = g.robin && g.robin.result; if (r && r.winner) splash(`${name(r.winner)} wins it!`, `+${H.ROBIN_POINTS.winner}`, 'good'); }
      if ((g.phase === 'finalPick' || g.phase === 'wager') && p.phase === 'board') { play('gong'); stage.set({ mood: 'wide' }); stage.shake(400); splash('FINAL GAMBLE', 'Bet it all. Or don\'t. Coward.', 'fraud', 2000); }
      if (g.phase === 'finalQ') play('drumroll');
      if (g.phase === 'over') {
        play('jingle');
        const s = H.standings(g), top = s.filter(x => x.score === s[0].score);
        splash(top.length > 1 ? 'IT\'S A TIE!' : `${top[0].name} WINS!`, 'Everyone else: straight to Hell', 'win', 3000);
        stage.burst(S.view.players.map(pl => pl.color).concat(['#ffd84a', '#ff4b2b']));
        if (top.some(x => x.id === me.id)) setTimeout(() => play('winner'), 900);
      }
      if (g.phase === 'board') stage.set({ mood: 'bored' });
    }
    if (g.buzz && g.buzz !== p.buzz) {
      play('buzz');
      stage.flash('rgba(255,216,74,.3)');
      splash(g.buzz === me.id ? 'YOU!' : name(g.buzz), 'buzzed in', 'buzz', 900);
      if (g.buzz === me.id) safe(() => navigator.vibrate && navigator.vibrate(120));
    }
    if (g.last && JSON.stringify(g.last) !== JSON.stringify(p.last) && g.seq !== p.seq) {
      play(g.last.ok ? 'correct' : 'wrong');
      splash(g.last.ok ? 'CORRECT!' : 'WRONG!', `${name(g.last.pid)} ${pts(g.last.delta)}`, g.last.ok ? 'good' : 'bad', 1300);
      if (!g.last.ok) { S.fallAt[g.last.pid] = stage.now(); setTimeout(() => play('trapdoor', 0.4), 200); stage.set({ mood: 'smirk' }); }
      else stage.set({ mood: 'bored' });
    }
    if (g.robin && p.robin && g.robin.out.length > p.robin.out.length) {
      play('wrong');
      const out = g.robin.out[g.robin.out.length - 1];
      S.fallAt[out] = stage.now();
      if (g.phase === 'robin') splash(`${name(out)} is OUT`, '', 'bad', 1000);
    } else if (g.robin && p.robin && g.robin.named > p.robin.named) play('lock', 0.5);
    if (g.final && p.final) {
      const n = Object.keys(g.final.results).length;
      if (n > Object.keys(p.final.results).length) {
        const pid = g.final.order[n - 1];
        const ok = g.final.results[pid];
        play(ok ? 'correct' : 'wrong');
        const w = g.final.wagers[pid] || 0;
        if (g.phase !== 'over') splash(ok ? 'CORRECT!' : 'WRONG!', `${name(pid)} ${pts(ok ? w : -w)}`, ok ? 'good' : 'bad', 1300);
      }
    }
  }

  // ---------- name plates under the podiums (and under the host's desk)
  const lastScores = {};
  function syncPlates(entries, hostName) {
    const layer = stageNode.querySelector('.plates');
    const xs = A.podiumXs(entries.length);
    const gap = entries.length > 1 ? xs[1] - xs[0] : 34;
    const pct = x => (x / A.W * 100).toFixed(2) + '%';
    const html = (hostName ? `<div class="plate host" style="left:${pct(56)};width:${pct(76)}"><span>😈 ${esc(hostName)}</span><b>HOST</b></div>` : '') +
      entries.map((e, k) => `<div class="plate ${e.me ? 'me' : ''} ${e.connected === false ? 'gone' : ''}" style="left:${pct(xs[k])};width:${pct(gap - 2)};--c:${e.color}">
        <span>${esc(e.name)}</span>${e.score != null ? `<b>${e.score}</b>` : ''}</div>`).join('');
    if (layer.dataset.html !== html) { layer.innerHTML = html; layer.dataset.html = html; }
    // Floating "+3" / "−2" when a score changes.
    const floats = stageNode.querySelector('.floats');
    entries.forEach((e, k) => {
      if (e.score == null) return;
      const before = lastScores[e.id];
      lastScores[e.id] = e.score;
      if (before == null || before === e.score) return;
      const d = e.score - before;
      const f = document.createElement('div');
      f.className = 'float ' + (d > 0 ? 'good' : 'bad');
      f.style.left = pct(xs[k]);
      f.textContent = pts(d);
      floats.appendChild(f);
      setTimeout(() => f.remove(), 1600);
    });
  }

  function syncStage() {
    const v = S.view, g = v && v.game;
    if (!v) { stage.set({ players: [] }); syncPlates([], null); return; }
    const hostP = v.players.find(p => p.id === (g ? g.hostId : v.showHostId));
    if (!g || g.phase === 'guess') for (const k in lastScores) delete lastScores[k]; // a new show starts from zero quietly
    if (!g) {
      // Lobby: everyone who isn't hosting stands at a podium.
      const ps = v.players.filter(p => p.id !== v.showHostId);
      stage.set({ players: ps.map(p => ({ id: p.id, color: p.color, connected: p.connected, mood: 'idle' })) });
      syncPlates(ps.map(p => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, me: p.id === me.id })), hostP && hostP.name);
      return;
    }
    const byId = Object.fromEntries(v.players.map(p => [p.id, p]));
    syncPlates(g.contestants.map(id => ({ id, name: g.names[id], color: (byId[id] || {}).color || '#888', connected: (byId[id] || {}).connected, score: g.scores[id], me: id === me.id })), hostP && hostP.name);
    const R = g.robin;
    stage.set({
      players: g.contestants.map(id => {
        const p = byId[id] || { color: '#888', connected: false };
        let mood = 'idle', glow = false, falling = 0;
        if (g.phase === 'buzzed' && g.buzz === id) { mood = 'think'; glow = true; }
        if (g.phase === 'answer' && g.last && g.last.pid === id) mood = g.last.ok ? 'happy' : 'sad';
        if ((g.phase === 'read' || g.phase === 'buzzed' || g.phase === 'answer') && g.lockedOut.includes(id)) falling = S.fallAt[id] || 1;
        if (R && g.phase === 'robin') {
          if (R.out.includes(id)) falling = S.fallAt[id] || 1;
          else if (R.active[R.turn] === id) { glow = true; mood = 'think'; }
        }
        if (g.phase === 'robinDone' && R && R.result && R.result.winner === id) mood = 'happy';
        if (g.phase === 'over') mood = H.standings(g)[0].id === id ? 'happy' : 'idle';
        return { id, color: p.color, connected: p.connected, mood, answered: glow, bet: g.control === id && g.phase === 'board', falling };
      }),
    });
  }

  // ================================================================ RENDER
  const stageNode = document.createElement('div');
  stageNode.className = 'stage';
  stageNode.innerHTML = '<canvas></canvas><div class="plates"></div><div class="floats"></div><div class="bubble" hidden></div>';
  const stage = A.Stage(stageNode.querySelector('canvas'));

  const editor = document.createElement('div');
  editor.className = 'editor';

  function render() {
    const focus = document.activeElement && editor.contains(document.activeElement) ? document.activeElement : null;
    const sel = focus && 'selectionStart' in focus ? safe(() => [focus.selectionStart, focus.selectionEnd]) : null;
    // Keep what someone is typing in a game input across re-renders.
    const live = document.activeElement && app.contains(document.activeElement) && document.activeElement.dataset.keep ? { id: document.activeElement.dataset.keep, v: document.activeElement.value } : null;
    let html = '';
    if (S.screen === 'home') html = renderHome();
    else if (S.screen === 'lobby') html = renderLobby();
    else html = renderGame();
    app.innerHTML = html;
    const ss = app.querySelector('#stageSlot');
    if (ss) ss.replaceWith(stageNode);
    const es = app.querySelector('#editorSlot');
    if (es) { if (!editor.firstChild) buildEditor(); es.replaceWith(editor); }
    if (focus && editor.isConnected) { focus.focus(); if (sel) safe(() => focus.setSelectionRange(sel[0], sel[1])); }
    if (live) { const el = app.querySelector(`[data-keep="${live.id}"]`); if (el) { el.value = live.v; el.focus(); } }
    // Panels bounce in only when the scene changes, not on every update.
    const g = S.view && S.view.game;
    const sceneKey = S.screen + ':' + (g ? g.phase + ':' + JSON.stringify(g.cell && [g.cell.c, g.cell.r, g.cell.robin]) : '');
    if (sceneKey !== S.sceneKey) {
      S.sceneKey = sceneKey;
      app.querySelectorAll('.panel, .lobby > .card').forEach((el, k) => { el.classList.add('enter'); el.style.animationDelay = (k * 60) + 'ms'; });
      app.querySelectorAll('.bcell:not(.gone):not(.none)').forEach((el, k) => { el.classList.add('deal'); el.style.animationDelay = (120 + k * 18) + 'ms'; });
    }
    syncStage();
    updateBubble();
    updateMusic();
  }

  // Background loop in the lobby and on the board; quiet while questions are read.
  function updateMusic() {
    const g = S.view && S.view.game;
    const want = S.music && (S.screen === 'lobby' || (g && ['guess', 'board', 'over'].includes(g.phase)));
    if (want !== S.musicOn) { S.musicOn = want; A.music(want); }
  }

  function netBar() {
    const n = S.net;
    if (!n.msg) return '';
    return `<div class="netbar ${n.status}">${esc(n.msg)}${n.status === 'error' ? ' <button data-act="home" class="link">Back</button>' : ''}</div>`;
  }
  function soundBtn() {
    return `<span class="toggles"><button class="iconbtn ${S.music ? '' : 'off'}" data-act="music" title="Music">🎵</button><button class="iconbtn" data-act="sound" title="Sound effects">${S.sound ? '🔊' : '🔇'}</button></span>`;
  }
  function logo(small) { return `<div class="logo ${small ? 'small' : ''}"><span>HELL IS A</span><span>GAME SHOW</span></div>`; }

  // ---------- home
  function renderHome() {
    const saved = local.get('hostRoom', null);
    const canResume = saved && saved.ownerPid && Date.now() - saved.savedAt < 3 * 3600 * 1000;
    // Opened from an invite link: just a name and a Join button. (Not for the room
    // owner coming back to their own show; they get the normal screen and Reopen.)
    if (S.joinCode && !(canResume && saved.code === S.joinCode)) return renderInvite();
    return `
    <div class="home">
      ${logo()}
      <p class="tag">A trivia show hosted by one of your friends, who wrote the questions, judges the answers, and is never wrong.</p>
      <div id="stageSlot"></div>
      <div class="card">
        <label class="field"><span>Your name</span>
          <input id="name" maxlength="16" placeholder="Lost Soul" value="${esc(me.name)}" autocomplete="off"></label>
        <div class="field"><span>Your soul colour</span>
          <div class="swatches">${COLORS.map(c => `<button class="swatch ${c === me.color ? 'on' : ''}" style="--c:${c}" data-act="color" data-c="${c}" aria-label="colour ${c}"></button>`).join('')}</div>
        </div>
        <button class="big fire" data-act="create">🔥 Open a new show</button>
        <div class="or">or join a friend's show</div>
        <div class="joinrow">
          <input id="code" maxlength="4" placeholder="CODE" value="${esc(S.joinCode)}" autocomplete="off" autocapitalize="characters">
          <button class="big" data-act="join">Join</button>
        </div>
        ${canResume ? `<button class="link" data-act="resume">Reopen your show ${esc(saved.code)}</button>` : ''}
      </div>
      <p class="fine">One person opens the show and shares the code. One player is the host: they write the questions and judge the answers. Everyone else buzzes in. Play over voice chat.</p>
    </div>`;
  }

  function renderInvite() {
    return `
    <div class="home invite">
      ${logo()}
      <div id="stageSlot"></div>
      <div class="card center">
        <h2>You're invited!</h2>
        <p>Show <b class="bigcode inline">${esc(S.joinCode)}</b> is about to start.</p>
        <input type="hidden" id="code" value="${esc(S.joinCode)}">
        <label class="field"><span>Your name</span>
          <input id="name" maxlength="16" placeholder="Lost Soul" value="${esc(me.name)}" autocomplete="off" autofocus></label>
        <div class="field"><span>Your soul colour</span>
          <div class="swatches">${COLORS.map(c => `<button class="swatch ${c === me.color ? 'on' : ''}" style="--c:${c}" data-act="color" data-c="${c}" aria-label="colour ${c}"></button>`).join('')}</div>
        </div>
        <button class="big fire" data-act="join">🔥 Join the show</button>
        <button class="link" data-act="noInvite">or open my own show instead</button>
      </div>
      <p class="fine center">Play over voice chat. The host reads the questions out loud and you buzz in from here.</p>
    </div>`;
  }

  // ---------- lobby
  function renderLobby() {
    const v = S.view;
    if (!v) return `<div class="lobby">${netBar()}<div class="card center"><p>Connecting…</p><button class="link" data-act="home">Back</button></div></div>`;
    const owner = v.ownerId === me.id;
    const host = v.showHostId === me.id;
    const link = location.href.split('#')[0] + '#' + v.code;
    const name = id => { const p = v.players.find(p => p.id === id); return p ? p.name : '?'; };
    const contestants = v.players.filter(p => p.connected && p.id !== v.showHostId);
    const info = v.boardInfo;
    const ready = info && info.stats.questions > 0 && contestants.length > 0;
    return `
    <div class="lobby ${host ? 'wide' : ''}">
      ${netBar()}
      <div class="topbar">${logo(true)}${soundBtn()}</div>
      <div id="stageSlot"></div>
      <div class="card code">
        <div>Room code</div>
        <div class="bigcode">${esc(v.code)}</div>
        <button class="link" data-act="copy" data-text="${esc(link)}">Copy invite link</button>
      </div>
      <div class="card">
        <h2>Souls in the studio (${v.players.length}/${MAX_PLAYERS})</h2>
        <ul class="players">${v.players.map(p => `
          <li class="${p.connected ? '' : 'gone'}"><i style="--c:${p.color}"></i>${esc(p.name)}${p.id === me.id ? ' <em>(you)</em>' : ''}
          ${p.id === v.showHostId ? '<b class="pill">😈 Host</b>' : ''}${p.id === v.ownerId ? '<b class="pill dim">Room owner</b>' : ''}
          ${p.id !== v.showHostId && v.useSpecs !== false ? `<span class="spec">${p.spec ? '⭐ ' + esc(p.spec) : '<em>no specialty yet</em>'}</span>` : ''}</li>`).join('')}
        </ul>
        <label class="field inline"><span>Host:</span>
          <select data-act="setHost" ${owner ? '' : 'disabled'}>${v.players.map(p => `<option value="${esc(p.id)}" ${p.id === v.showHostId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-act="showText" ${v.showText ? 'checked' : ''} ${owner ? '' : 'disabled'}>
          Show questions on contestants' screens <span class="fine">(off = the host reads them out loud, like the real show)</span></label>
        <label class="check"><input type="checkbox" data-act="useSpecs" ${v.useSpecs !== false ? 'checked' : ''} ${owner ? '' : 'disabled'}>
          Put everyone's specialty on the board <span class="fine">(each contestant picks a category they'll crush)</span></label>
      </div>
      ${!host && v.useSpecs !== false ? renderSpecPicker(v) : ''}
      ${host ? `<div class="card">
          <h2>Your board</h2>
          <p class="fine">You're the host. Write a board, or use the starter one. Contestants only see the category names until you pick a question. It saves in this browser as you type.</p>
          ${v.useSpecs !== false ? `<p class="fine">⭐ Contestants' specialties go on the board ahead of yours (up to ${H.LIMITS.cats} categories in all): ${
            v.players.filter(p => p.id !== v.showHostId && p.spec).map(p => `<b>${esc(p.spec)}</b> (${esc(p.name)})`).join(', ') || 'nobody has picked one yet'}.</p>` : ''}
          <div id="editorSlot"></div>
        </div>`
        : `<div class="card"><h2>The board</h2>${info ? `<p><b>${esc(name(v.showHostId))}</b> has ${info.stats.questions} questions, ${info.stats.robins} round robins and ${info.stats.finals} final gambles ready.</p>
          <div class="catlist">${info.cats.filter(Boolean).map(c => `<span>${esc(c)}</span>`).join('')}</div>` : `<p class="waiting">${esc(name(v.showHostId))} is writing the board…</p>`}</div>`}
      <div class="card rules">
        <h2>How it works</h2>
        <ul>
          <li>Questions are worth <b>1 to 5 points</b>. Whoever has control picks the category and difficulty.</li>
          <li><b>Buzz in</b> to answer. The host stops reading the moment you buzz. Wrong answers <b>cost</b> the points.</li>
          <li><b>Fraud questions</b> are statements with a lie in them. Buzz in and correct it for <b>double points</b>.</li>
          <li><b>Round robins</b>: take turns naming things until you can't. Winner gets 5, second gets 2.</li>
          <li><b>Final gamble</b>: last place picks the category, everyone secretly bets (up to their score, or 5 if that's more), then writes an answer.</li>
          <li>The host's rulings are final. Argue anyway.</li>
        </ul>
      </div>
      ${owner
        ? `<button class="big fire" data-act="start" ${ready ? '' : 'disabled'}>🔥 Start the show</button>
           ${ready ? '' : `<p class="fine center">${!info ? 'Waiting for the host\'s board…' : 'Waiting for at least one contestant besides the host.'}</p>`}`
        : `<p class="center waiting">Waiting for ${esc(name(v.ownerId))} to start the show…</p>`}
      <button class="link center block" data-act="leave">Leave</button>
    </div>`;
  }

  // ---------- specialty picker (contestants)
  function renderSpecPicker(v) {
    const mine = (v.players.find(p => p.id === me.id) || {}).spec || '';
    const groups = {};
    H.LIBRARY.cats.forEach(c => (groups[c.group] = groups[c.group] || []).push(c.name));
    const taken = name => v.players.filter(p => p.id !== me.id && p.spec === name).map(p => p.name);
    return `<div class="card specpick">
      <h2>⭐ Your specialty</h2>
      <p class="fine">Pick the category you'll crush. It goes on the board with your name on it, and everyone can still buzz in on it, so prove it.</p>
      <select data-act="spec">
        <option value="">Choose from ${H.LIBRARY.cats.length} categories…</option>
        ${Object.entries(groups).map(([gname, names]) => `<optgroup label="${esc(gname)}">${names.map(n => {
          const t = taken(n);
          return `<option value="${esc(n)}" ${n === mine ? 'selected' : ''}>${esc(n)}${t.length ? ` (also ${esc(t.join(', '))})` : ''}</option>`;
        }).join('')}</optgroup>`).join('')}
      </select>
      ${mine ? `<p class="myspec">⭐ <b>${esc(mine)}</b>. No pressure.</p>` : ''}
    </div>`;
  }

  // ---------- board editor (host only; lives in their browser)
  let saveTimer = null;
  function draftChanged() {
    local.set('board', S.draft);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => send({ t: 'setBoard', board: S.draft }), 500);
  }
  function buildEditor() {
    const d = S.draft;
    d.cats = d.cats || []; d.robins = d.robins || []; d.finals = d.finals || [];
    const tabs = d.cats.map((c, k) => ({ k, label: c.name || `Category ${k + 1}` })).concat([{ k: 'rr', label: '🔁 Round robins' }, { k: 'fin', label: '🎲 Final gamble' }]);
    if (typeof S.tab === 'number' && S.tab >= d.cats.length) S.tab = d.cats.length ? 0 : 'rr';
    let body = '';
    if (typeof S.tab === 'number') {
      const c = d.cats[S.tab];
      c.cells = c.cells || [];
      body = `<div class="erow"><input data-e="cat-name" value="${esc(c.name)}" maxlength="30" placeholder="Category name, e.g. Horror movies">
          <button class="small" type="button" data-e="cat-del">Delete</button></div>
        ${H.POINTS.map((p, r) => { const x = c.cells[r] || (c.cells[r] = { q: '', a: '', fraud: false }); return `
        <div class="ecell"><b>${p}</b>
          <textarea data-e="q" data-r="${r}" rows="2" maxlength="300" placeholder="${p}-point question${p === 1 ? ' (easy)' : p === 5 ? ' (hard)' : ''}">${esc(x.q)}</textarea>
          <input data-e="a" data-r="${r}" maxlength="300" placeholder="Answer (only you see this)" value="${esc(x.a)}">
          <label class="check"><input type="checkbox" data-e="fraud" data-r="${r}" ${x.fraud ? 'checked' : ''}> Fraud statement (double points)</label>
        </div>`; }).join('')}`;
    } else if (S.tab === 'rr') {
      body = `<p class="fine">Prompts for "name as many as you can". Up to ${H.LIMITS.robins}. Each one appears as a tile on the board.</p>
        ${[0, 1, 2, 3].map(k => { const x = d.robins[k] || { q: '', a: '' }; return `<div class="ecell"><b>${k + 1}</b>
          <input data-e="rq" data-r="${k}" maxlength="300" placeholder="Name...  e.g. Name Pokémon" value="${esc(x.q)}">
          <input data-e="ra" data-r="${k}" maxlength="300" placeholder="Notes for you (optional)" value="${esc(x.a)}"></div>`; }).join('')}`;
    } else {
      body = `<p class="fine">Up to 3. Last place picks one; everyone wagers and writes an answer.</p>
        ${[0, 1, 2].map(k => { const x = d.finals[k] || { cat: '', q: '', a: '' }; return `<div class="ecell"><b>${k + 1}</b>
          <input data-e="fc" data-r="${k}" maxlength="30" placeholder="Category, e.g. Video game movies" value="${esc(x.cat)}">
          <textarea data-e="fq" data-r="${k}" rows="2" maxlength="300" placeholder="The final question">${esc(x.q)}</textarea>
          <input data-e="fa" data-r="${k}" maxlength="300" placeholder="Answer (only you see this)" value="${esc(x.a)}"></div>`; }).join('')}`;
    }
    const st = H.boardStats(H.cleanBoard(d));
    editor.innerHTML = `
      <div class="etools">
        <button class="small fire" type="button" data-e="random">🎲 Random board</button>
        <button class="small" type="button" data-e="starter">Load starter board</button>
        <button class="small" type="button" data-e="blank">New blank board</button>
        <button class="small" type="button" data-e="export">Save to file</button>
        <label class="small filebtn">Open file<input type="file" accept=".json,application/json" data-e="import" hidden></label>
      </div>
      <p class="fine">${st.questions} questions · ${st.robins} round robins · ${st.finals} finals</p>
      <div class="etabs">${tabs.map(t => `<button type="button" class="${t.k === S.tab ? 'on' : ''}" data-e="tab" data-k="${t.k}">${esc(t.label)}</button>`).join('')}
        ${d.cats.length < H.LIMITS.cats ? `<button type="button" data-e="cat-add">+ Blank</button>
          <select data-e="lib-add"><option value="">+ From library (${H.LIBRARY.cats.length})…</option>${H.LIBRARY.cats.map((c, k) => d.cats.some(x => x.name === c.name) ? '' : `<option value="${k}">${esc(c.name)}</option>`).join('')}</select>` : ''}</div>
      <div class="ebody">${body}</div>`;
  }
  editor.addEventListener('input', e => {
    const el = e.target, k = el.dataset.e, r = +el.dataset.r, d = S.draft;
    if (!k) return;
    const c = typeof S.tab === 'number' ? d.cats[S.tab] : null;
    if (k === 'cat-name') { c.name = el.value; const t = editor.querySelector('.etabs .on'); if (t) t.textContent = el.value || `Category ${S.tab + 1}`; }
    else if (k === 'q' || k === 'a') c.cells[r][k] = el.value;
    else if (k === 'fraud') c.cells[r].fraud = el.checked;
    else if (k === 'rq' || k === 'ra') { d.robins[r] = d.robins[r] || { q: '', a: '' }; d.robins[r][k === 'rq' ? 'q' : 'a'] = el.value; }
    else if (k === 'fc' || k === 'fq' || k === 'fa') { d.finals[r] = d.finals[r] || { cat: '', q: '', a: '' }; d.finals[r]['fc' === k ? 'cat' : k === 'fq' ? 'q' : 'a'] = el.value; }
    else return;
    draftChanged();
  });
  editor.addEventListener('change', e => {
    if (e.target.dataset.e === 'lib-add' && e.target.value !== '') {
      S.draft.cats.push(H.clone(H.LIBRARY.cats[+e.target.value]));
      S.tab = S.draft.cats.length - 1;
      draftChanged(); buildEditor();
      return;
    }
    if (e.target.dataset.e !== 'import' || !e.target.files[0]) return;
    const f = e.target.files[0];
    if (f.size > 200000) { toast('That file is too big to be a board.', 'bad'); return; }
    f.text().then(t => {
      const b = H.cleanBoard(JSON.parse(t));
      if (!b.cats.length && !b.robins.length) throw new Error('empty');
      S.draft = b; S.tab = 0; buildEditor(); draftChanged(); toast('Board loaded');
    }).catch(() => toast('That doesn\'t look like a board file.', 'bad'));
  });
  editor.addEventListener('click', e => {
    const b = e.target.closest('[data-e]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
    const k = b.dataset.e, d = S.draft;
    if (k === 'tab') S.tab = /^\d+$/.test(b.dataset.k) ? +b.dataset.k : b.dataset.k;
    else if (k === 'cat-add') { d.cats.push({ name: '', cells: H.POINTS.map(() => ({ q: '', a: '', fraud: false })) }); S.tab = d.cats.length - 1; draftChanged(); }
    else if (k === 'cat-del') { if (!confirm('Delete this category and its questions?')) return; d.cats.splice(S.tab, 1); S.tab = 0; draftChanged(); }
    else if (k === 'random') { if (!confirm('Replace your board with 6 random categories from the library?')) return; S.draft = H.randomBoard(rng); S.tab = 0; draftChanged(); }
    else if (k === 'starter') { if (!confirm('Replace your board with the starter board?')) return; S.draft = H.clone(H.STARTER); S.tab = 0; draftChanged(); }
    else if (k === 'blank') { if (!confirm('Start a blank board? Your current board will be replaced (save it to a file first if you want to keep it).')) return; S.draft = { title: '', cats: [0, 1, 2, 3].map(() => ({ name: '', cells: H.POINTS.map(() => ({ q: '', a: '', fraud: false })) })), robins: [], finals: [] }; S.tab = 0; draftChanged(); }
    else if (k === 'export') {
      const blob = new Blob([JSON.stringify(H.cleanBoard(S.draft), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'hell-is-a-game-show-board.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return;
    } else return;
    buildEditor();
  });

  // ---------- game
  function renderGame() {
    const v = S.view, g = v && v.game;
    if (!g) return renderLobby();
    const host = amHost(g);
    const playing = amPlaying(g);
    return `
    <div class="game ${host ? 'as-host' : ''}">
      ${netBar()}
      <div class="topbar">
        ${logo(true)}
        <div class="meta">
          ${playing ? `<span class="money">${g.scores[me.id]} pts</span>` : host ? '<span class="pill">😈 You are the host</span>' : '<span class="pill dim">Watching</span>'}
          ${soundBtn()}
        </div>
      </div>
      <div id="stageSlot"></div>
      ${renderPhase(g, host, playing)}
      ${host ? renderHostDesk(g) : ''}
      ${renderScores(g, v, host)}
    </div>`;
  }

  const nm = (g, id) => esc(g.names[id] || '?');

  function renderPhase(g, host, playing) {
    switch (g.phase) {
      case 'guess': return renderGuess(g, host, playing);
      case 'board': return renderBoard(g, host);
      case 'read': case 'buzzed': case 'answer': return renderQuestion(g, host, playing);
      case 'robin': case 'robinDone': return renderRobin(g, host);
      case 'finalPick': case 'wager': case 'finalQ': case 'finalReveal': return renderFinal(g, host, playing);
      case 'over': return renderOver(g);
    }
    return '';
  }

  function renderGuess(g, host, playing) {
    const o = g.opening;
    const mine = o.guesses[me.id];
    return `<div class="panel center">
      <h1 class="glow">Who goes first?</h1>
      ${host ? `<p>Your secret number is <b class="hot">${o.secret}</b>. Ask them to guess "a number". Closest picks first.</p>
          <p class="fine">Guessed: ${g.contestants.map(id => `${nm(g, id)} ${o.guesses[id] != null ? '✔ ' + o.guesses[id] : '…'}`).join(' · ')}</p>
          <button class="big" data-act="guessDone">Reveal it now</button>`
        : playing ? (mine == null
          ? `<p>The host has written down a secret number from 1 to 100. Closest guess picks the first question.</p>
             <form class="rowform" data-act="guessForm"><input type="number" min="1" max="100" name="n" data-keep="guess" placeholder="1–100" required><button class="big fire">Lock it in</button></form>`
          : `<p>You guessed <b>${mine}</b>. Waiting for the others…</p>`)
        : '<p>The contestants are guessing a number…</p>'}
    </div>`;
  }

  function renderBoard(g, host) {
    const b = g.board;
    const mine = g.control === me.id;
    const fresh = Object.values(b.cats).every(c => c.cells.every(x => !x.used || x.blank)) && b.robins.every(x => !x.used || x.blank) && g.opening.winner;
    const canPick = mine || host;
    const robins = b.robins.map((x, k) => ({ x, k })).filter(o => !o.x.blank);
    return `<div class="panel">
      ${fresh && g.opening.secret != null ? `<p class="banner">The number was <b>${g.opening.secret}</b>. ${nm(g, g.opening.winner)} was closest (${g.opening.guesses[g.opening.winner] != null ? g.opening.guesses[g.opening.winner] : 'no guess'}).</p>` : ''}
      <p class="center pickline">${mine ? '<b class="hot">Your pick!</b> Choose a category and a difficulty.' : `<b>${nm(g, g.control)}</b> has control of the board${host ? ' (you can pick for them)' : ''}.`}</p>
      <div class="board" style="--cols:${b.cats.length + (robins.length ? 1 : 0)}">
        ${b.cats.map(c => `<div class="bhead">${esc(c.name || '???')}${c.tag ? `<small>⭐ ${esc(c.tag)}</small>` : ''}</div>`).join('')}
        ${robins.length ? '<div class="bhead robin">Round robin</div>' : ''}
        ${[0, 1, 2, 3, 4].map(r => b.cats.map((c, ci) => {
          const x = c.cells[r];
          if (x.blank || x.used) return '<div class="bcell gone"></div>';
          return `<button class="bcell" data-act="pick" data-c="${ci}" data-r="${r}" ${canPick ? '' : 'disabled'}>${x.pts}</button>`;
        }).join('') + (robins.length ? (robins[r] ? (robins[r].x.used ? '<div class="bcell gone"></div>' : `<button class="bcell robin" data-act="pick" data-robin="${robins[r].k}" ${canPick ? '' : 'disabled'}>🔁</button>`) : '<div class="bcell none"></div>') : '')).join('')}
      </div>
      <div class="blist">
        ${b.cats.map((c, ci) => `<div class="brow"><div class="bhead">${esc(c.name || '???')}${c.tag ? `<small>⭐ ${esc(c.tag)}</small>` : ''}</div>${c.cells.map((x, r) => x.blank || x.used
          ? '<div class="bcell gone"></div>'
          : `<button class="bcell" data-act="pick" data-c="${ci}" data-r="${r}" ${canPick ? '' : 'disabled'}>${x.pts}</button>`).join('')}</div>`).join('')}
        ${robins.length ? `<div class="brow"><div class="bhead robin">Round robin</div>${robins.map(o => o.x.used ? '<div class="bcell gone"></div>' : `<button class="bcell robin" data-act="pick" data-robin="${o.k}" ${canPick ? '' : 'disabled'}>🔁</button>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }

  function buzzList(g) {
    if (!g.buzzes || g.buzzes.length < 2) return '';
    const t0 = g.buzzes[0].at;
    return `<p class="fine center">${g.buzzes.slice(1).map(b => `${nm(g, b.pid)} +${((b.at - t0) / 1000).toFixed(2)}s`).join(' · ')}</p>`;
  }

  function renderQuestion(g, host, playing) {
    const c = g.cell;
    if (!c) return '';
    const locked = g.lockedOut.includes(me.id);
    let main = '';
    if (g.phase === 'answer') {
      const L = g.last;
      main = `${c.q ? `<h2 class="question">${esc(c.q)}</h2>` : ''}
        <div class="reveal"><span>Answer</span><b>${esc(c.a)}</b></div>
        <p class="center result ${L && L.ok ? 'good' : 'bad'}">${L && L.ok ? `${nm(g, L.pid)} got it! ${pts(L.delta)}` : 'Nobody got it.'}</p>
        ${host ? '<button class="big fire" data-act="toBoard">Back to the board ▶</button>' : ''}`;
    } else if (host) {
      main = `<h2 class="question">${esc(c.q)}</h2>
        <div class="reveal host"><span>Answer (just you)</span><b>${esc(c.a)}</b></div>
        ${g.phase === 'buzzed'
          ? `<div class="buzzed"><b>${nm(g, g.buzz)}</b> buzzed in!</div>${buzzList(g)}
             <div class="judge"><button class="big good" data-act="judge" data-ok="1">✔ Correct ${pts(c.value)}</button><button class="big bad" data-act="judge" data-ok="0">✖ Wrong ${pts(-c.value)}</button></div>`
          : `<p class="center waiting">Read it out loud. Buzzers are live.${g.lockedOut.length ? ` (Locked out: ${g.lockedOut.map(id => nm(g, id)).join(', ')})` : ''}</p>`}
        <div class="deskrow"><button class="small" data-act="resetBuzz">↺ Reset buzzers</button><button class="small" data-act="skip">Nobody gets it: show the answer</button></div>`;
    } else {
      main = `${c.q ? `<h2 class="question">${esc(c.q)}</h2>` : `<p class="center listen">🎙️ Listen to the host…</p>`}
        ${g.phase === 'buzzed' ? `<div class="buzzed ${g.buzz === me.id ? 'me' : ''}"><b>${g.buzz === me.id ? 'YOU' : nm(g, g.buzz)}</b> buzzed in!${g.buzz === me.id ? '<span>Say your answer out loud.</span>' : ''}</div>${buzzList(g)}` : ''}
        ${playing ? `<button class="buzzer" data-act="buzz" ${locked || g.phase !== 'read' ? 'disabled' : ''}>${locked ? 'LOCKED OUT' : g.phase === 'buzzed' ? '…' : 'BUZZ'}</button>
           <p class="fine center">${locked ? 'You got it wrong. Wait for the next one.' : 'Tap, or press Space.'}</p>` : ''}`;
    }
    return `<div class="panel qpanel ${c.fraud ? 'fraud' : ''}">
      <div class="qhead"><span>${esc(c.cat)}</span><span class="money">${c.pts} pt${c.pts > 1 ? 's' : ''}${c.fraud ? ' × 2' : ''}</span></div>
      ${c.fraud ? '<div class="fraudbanner">🚨 FRAUD STATEMENT 🚨<span>Something in it is a lie. Buzz in and correct it for double points.</span></div>' : ''}
      ${main}
    </div>`;
  }

  function renderRobin(g, host) {
    const R = g.robin, c = g.cell;
    if (!R || !c) return '';
    const cur = R.active[R.turn];
    if (g.phase === 'robinDone') {
      const r = R.result || {};
      return `<div class="panel center"><div class="qhead"><span>Round robin</span></div>
        <h2 class="question">${esc(c.q)}</h2>
        <p class="result good">${r.winner ? `${nm(g, r.winner)} wins the round robin! +${H.ROBIN_POINTS.winner}` : 'Round robin over.'}</p>
        ${r.runnerUp ? `<p>${nm(g, r.runnerUp)} comes second. +${H.ROBIN_POINTS.runnerUp}</p>` : ''}
        ${c.a ? `<p class="fine">${esc(c.a)}</p>` : ''}
        ${host ? '<button class="big fire" data-act="toBoard">Back to the board ▶</button>' : ''}</div>`;
    }
    return `<div class="panel center">
      <div class="qhead"><span>Round robin · no buzzers</span><span>${R.named} named</span></div>
      <h2 class="question">${esc(c.q)}</h2>
      <ol class="turns">${R.order.map(id => `<li class="${R.out.includes(id) ? 'out' : ''} ${id === cur ? 'now' : ''}">${nm(g, id)}${R.out.includes(id) ? ' ✖' : ''}</li>`).join('')}</ol>
      ${cur === me.id ? '<p class="buzzed me"><b>YOUR TURN</b><span>Name one out loud!</span></p>' : `<p class="waiting">${nm(g, cur)}'s turn…</p>`}
      ${host ? `${c.a ? `<p class="fine">${esc(c.a)}</p>` : ''}
        <div class="judge"><button class="big good" data-act="robinJudge" data-ok="1">✔ Good one, next</button><button class="big bad" data-act="robinJudge" data-ok="0">✖ ${nm(g, cur)} is out</button></div>` : ''}
    </div>`;
  }

  function renderFinal(g, host, playing) {
    const F = g.final;
    let body = '';
    if (g.phase === 'finalPick') {
      const picker = F.picker === me.id;
      body = `<p>${picker ? '<b class="hot">You\'re in last place, so you pick the final category.</b>' : `${nm(g, F.picker)} is in last place, so they pick the final category${host ? ' (or you can pick for them)' : ''}.`}</p>
        <div class="finals">${F.cats.map((c, k) => c ? `<button class="big" data-act="finalPick" data-k="${k}" ${picker || host ? '' : 'disabled'}>${esc(c)}</button>` : '').join('')}</div>`;
    } else if (g.phase === 'wager') {
      const mine = F.wagers[me.id];
      body = `<p>Category: <b class="hot">${esc(F.cat)}</b></p>
        ${playing ? (F.wagered.includes(me.id)
          ? `<p>You're betting <b>${mine}</b>. You can change it until the host reads the question.</p>`
          : '<p>How many of your points will you bet? Right answer: you win them. Wrong: you lose them.</p>')
          + `<form class="rowform" data-act="wagerForm"><input type="number" min="0" max="${F.max}" name="n" data-keep="wager" placeholder="0–${F.max}" required><button class="big fire">Bet</button></form>` : ''}
        <p class="fine">Bets in: ${g.contestants.map(id => `${nm(g, id)} ${F.wagered.includes(id) ? (host ? '✔ ' + F.wagers[id] : '✔') : '…'}`).join(' · ')}</p>
        ${host ? '<button class="big fire" data-act="finalQ">Read the final question ▶</button>' : ''}`;
    } else if (g.phase === 'finalQ') {
      body = `<p class="fine">${esc(F.cat)}</p><h2 class="question">${esc(F.q)}</h2>
        ${host ? `<div class="reveal host"><span>Answer (just you)</span><b>${esc(F.a)}</b></div>
          <ul class="finalans">${g.contestants.map(id => `<li>${nm(g, id)}: ${F.answers[id] ? `<b>${esc(F.answers[id])}</b>` : '<em>writing…</em>'} <span class="fine">(bet ${F.wagers[id]})</span></li>`).join('')}</ul>
          <button class="big fire" data-act="finalReveal">Reveal the answers ▶</button>`
        : playing ? `<p>${F.answers[me.id] ? `Your answer: <b>${esc(F.answers[me.id])}</b>. You can change it until the reveal.` : 'Write your answer. No mumbling.'}</p>
          <form class="rowform" data-act="finalForm"><input name="text" maxlength="120" data-keep="final" placeholder="Your answer" autocomplete="off" required><button class="big fire">Lock in</button></form>
          <p class="fine">${F.answered.length}/${g.contestants.length} answered</p>` : '<p class="waiting">The contestants are writing their answers…</p>'}`;
    } else {
      const next = F.order.find(p => !(p in F.results));
      body = `<h2 class="question">${esc(F.q)}</h2>
        <ul class="finalans">${F.order.map(id => {
          const done = id in F.results;
          const shown = done || host || id === me.id;
          return `<li class="${done ? (F.results[id] ? 'good' : 'bad') : ''} ${id === next ? 'now' : ''}">${nm(g, id)}: ${shown ? `<b>${esc(F.answers[id])}</b>` : '???'}
            <span class="fine">bet ${done || host || id === me.id ? F.wagers[id] : '?'}</span>${done ? (F.results[id] ? ` ✔ ${pts(F.wagers[id])}` : ` ✖ ${pts(-F.wagers[id])}`) : ''}</li>`;
        }).join('')}</ul>
        ${host && next ? `<div class="reveal host"><span>Answer (just you)</span><b>${esc(F.a)}</b></div>
          <p>Rule on <b>${nm(g, next)}</b>:</p><div class="judge"><button class="big good" data-act="finalJudge" data-ok="1">✔ Correct</button><button class="big bad" data-act="finalJudge" data-ok="0">✖ Wrong</button></div>` : ''}`;
    }
    return `<div class="panel center finalpanel"><h1 class="glow">🎲 Final gamble</h1>${body}</div>`;
  }

  function renderOver(g) {
    const s = H.standings(g);
    const top = s.filter(x => x.score === s[0].score);
    const v = S.view;
    const canLobby = v.ownerId === me.id || amHost(g);
    return `<div class="panel center"><h1 class="glow">${top.length > 1 ? `A tie! ${top.map(x => esc(x.name)).join(' & ')}` : `${esc(s[0].name)} wins!`}</h1>
      ${g.final && g.final.a ? `<p class="fine">Final answer: ${esc(g.final.a)}</p>` : ''}
      <ol class="standings">${s.map((x, k) => { const p = v.players.find(p => p.id === x.id) || {}; return `<li class="${x.id === me.id ? 'me' : ''}"><span class="rank">${k + 1}</span><i style="--c:${p.color}"></i><span class="nm">${esc(x.name)}</span><span class="money">${x.score}</span></li>`; }).join('')}</ol>
      ${canLobby ? '<button class="big fire" data-act="toLobby">Back to the lobby</button>' : '<p class="fine">Waiting for the host…</p>'}</div>`;
  }

  function renderScores(g, v, host) {
    return `<div class="scorebar">${g.contestants.map(id => {
      const p = v.players.find(p => p.id === id) || {};
      return `<div class="chip ${id === me.id ? 'me' : ''} ${p.connected === false ? 'gone' : ''} ${g.buzz === id ? 'buzzing' : ''}"><i style="--c:${p.color}"></i>
        <span>${g.control === id ? '👑 ' : ''}${esc(g.names[id])}</span><b>${g.scores[id]}</b>
        ${host ? `<button class="tiny" data-act="adjust" data-pid="${esc(id)}" data-d="-1" title="Take a point">−</button><button class="tiny" data-act="adjust" data-pid="${esc(id)}" data-d="1" title="Give a point">+</button>` : ''}</div>`;
    }).join('')}</div>`;
  }

  // ---------- the host's desk
  function cueKeys(g) {
    switch (g.phase) {
      case 'guess': case 'board': return ['open', 'ruling'];
      case 'read': case 'buzzed': return ['read', 'ruling'];
      case 'answer': return ['ruling'];
      case 'robin': case 'robinDone': return ['robin', 'ruling'];
      default: return ['final', 'ruling'];
    }
  }
  function renderHostDesk(g) {
    const lines = [];
    cueKeys(g).forEach(k => lines.push(...CUES[k]));
    const shown = [0, 1, 2].map(k => lines[(k + S.cueShift) % lines.length]).filter((t, k, a) => a.indexOf(t) === k);
    return `<div class="card hostdesk">
      <h3>Host desk</h3>
      <p class="fine">Use + and − on the scores below to fix any ruling. ${g.phase === 'board' ? 'Click a player\'s name to give them control.' : ''}</p>
      ${g.phase === 'board' ? `<div class="deskrow">${g.contestants.map(id => `<button class="small" data-act="setControl" data-pid="${esc(id)}">👑 ${nm(g, id)}</button>`).join('')}</div>
        <div class="deskrow"><button class="small" data-act="toFinal">Skip to the final gamble</button></div>` : ''}
      <h3>Say something <button class="link" data-act="shuffleCues">more lines</button></h3>
      <div class="cues">${shown.map(t => `<button class="cue" data-act="say" data-text="${esc(t)}">“${esc(t)}”</button>`).join('')}</div>
      <form class="rowform" data-act="sayForm"><input name="say" maxlength="200" data-keep="say" placeholder="Put your own line in the speech bubble…" autocomplete="off"><button class="small">Say</button></form>
      <h3>Soundboard</h3>
      <div class="sounds">${SOUNDBOARD.map(sn => `<button class="small" data-act="sfx" data-name="${sn.id}">${sn.label}</button>`).join('')}</div>
      ${g.phase !== 'over' ? '<div class="deskrow"><button class="link" data-act="end">End the show now</button></div>' : ''}
    </div>`;
  }

  function updateBubble() {
    const b = stageNode.querySelector('.bubble');
    const g = S.view && S.view.game;
    const text = g && g.say && g.say.text;
    const stale = g && g.say && Date.now() + S.clockOffset - g.say.at > 10000;
    if (!text || stale || S.screen !== 'game') { b.hidden = true; return; }
    b.hidden = false;
    if (b.textContent !== text) b.textContent = text;
  }
  setInterval(updateBubble, 250);

  // ================================================================ INPUT
  function setName() {
    const el = document.getElementById('name');
    if (el) { me.name = cleanName(el.value); local.set('name', me.name); }
  }
  function genCode() { let c = ''; for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)]; return c; }
  function newRoom() {
    return { ownerId: me.id, showHostId: me.id, showText: false, useSpecs: true, board: null, players: [{ id: me.id, name: me.name, color: me.color, connected: true }], game: null };
  }

  function buzz() {
    const g = S.view && S.view.game;
    if (!g || g.phase !== 'read' || !amPlaying(g) || g.lockedOut.includes(me.id)) return;
    send({ t: 'buzz' });
  }

  app.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || b.tagName === 'FORM' || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    A.audio(); // unlock audio on the first tap
    const act = b.dataset.act;
    switch (act) {
      case 'color': me.color = b.dataset.c; local.set('color', me.color); render(); break;
      case 'create': setName(); hostRoom(genCode(), newRoom()); break;
      case 'join': {
        setName();
        const code = (document.getElementById('code').value || '').toUpperCase().replace(/[^A-Z]/g, '');
        if (code.length !== 4) { toast('Room codes are 4 letters.', 'bad'); return; }
        joinRoom(code);
        break;
      }
      case 'resume': {
        const saved = local.get('hostRoom', null);
        if (!saved) return;
        setName();
        me.id = saved.ownerPid; session.set('pid', me.id);
        const room = saved.room;
        room.players.forEach(p => { p.connected = p.id === me.id; });
        hostRoom(saved.code, room);
        break;
      }
      case 'noInvite':
        S.joinCode = ''; history.replaceState(null, '', location.pathname + location.search); render();
        break;
      case 'home': case 'leave':
        S.joinCode = '';
        stopNet(); S.screen = 'home'; S.view = null; S.room = null; S.role = null; S.prev = null; S.net = { status: 'idle', msg: '' };
        history.replaceState(null, '', location.pathname + location.search);
        render();
        break;
      case 'sound': S.sound = !S.sound; local.set('sound', S.sound); render(); break;
      case 'music': S.music = !S.music; local.set('music', S.music); render(); break;
      case 'copy':
        safe(() => navigator.clipboard.writeText(b.dataset.text).then(() => toast('Invite link copied'), () => toast(b.dataset.text)));
        break;
      case 'start': send({ t: 'start' }); break;
      case 'toLobby': send({ t: 'lobby' }); break;
      case 'buzz': buzz(); break;
      case 'pick': send(b.dataset.robin != null ? { t: 'pick', robin: +b.dataset.robin } : { t: 'pick', c: +b.dataset.c, r: +b.dataset.r }); break;
      case 'judge': send({ t: 'judge', ok: b.dataset.ok === '1' }); break;
      case 'robinJudge': send({ t: 'robinJudge', ok: b.dataset.ok === '1' }); break;
      case 'finalJudge': send({ t: 'finalJudge', ok: b.dataset.ok === '1' }); break;
      case 'finalPick': send({ t: 'finalPick', k: +b.dataset.k }); break;
      case 'adjust': send({ t: 'adjust', pid: b.dataset.pid, d: +b.dataset.d }); break;
      case 'setControl': send({ t: 'setControl', pid: b.dataset.pid }); break;
      case 'say': send({ t: 'say', text: b.dataset.text }); break;
      case 'shuffleCues': S.cueShift += 3; render(); break;
      case 'sfx': send({ t: 'sfx', name: b.dataset.name }); break;
      case 'end': if (confirm('End the show now and go to the results?')) send({ t: 'end' }); break;
      case 'guessDone': case 'resetBuzz': case 'skip': case 'toBoard': case 'toFinal': case 'finalQ': case 'finalReveal':
        send({ t: act }); break;
    }
  });
  app.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.act === 'setHost') send({ t: 'setHost', pid: el.value });
    if (el.dataset.act === 'showText') send({ t: 'setShowText', on: el.checked });
    if (el.dataset.act === 'useSpecs') send({ t: 'setUseSpecs', on: el.checked });
    if (el.dataset.act === 'spec') { S.spec = el.value; local.set('spec', S.spec); send({ t: 'setSpec', spec: el.value }); if (el.value) play('lock', 0.5); }
  });
  app.addEventListener('submit', e => {
    const f = e.target.closest('form[data-act]');
    if (!f) return;
    e.preventDefault();
    const act = f.dataset.act;
    if (act === 'guessForm') send({ t: 'guess', n: +f.n.value });
    if (act === 'wagerForm') send({ t: 'wager', n: +f.n.value });
    if (act === 'finalForm') send({ t: 'finalAnswer', text: f.text.value });
    if (act === 'sayForm' && f.say.value.trim()) send({ t: 'say', text: f.say.value.trim() });
    const input = f.querySelector('input');
    if (input) { input.value = ''; input.blur(); }
    play('lock', 0.4);
  });
  app.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'code' || (e.target.id === 'name' && app.querySelector('.invite'))) app.querySelector('[data-act=join]').click();
  });
  // Space bar is the buzzer.
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || (e.target.closest && e.target.closest('input, textarea, select, button'))) return;
    const g = S.view && S.view.game;
    if (g && amPlaying(g) && (g.phase === 'read' || g.phase === 'buzzed')) { e.preventDefault(); buzz(); }
  });

  // Debug hook for tests: read-only peek at state.
  window.HGS_DEBUG = { S, me, send };

  render();
})();
