/* Domino Sky — deterministic disruption engine.
   simulate(net, weather, plan) replays the whole day as a discrete-event simulation:
   aircraft chains, runway slots under weather, ground holds, holding/diversion,
   crew duty limits, connection holds, passenger re-accommodation.
   Recovery actions only act from their `from` time, so the past never changes. */
(function (G) {
  'use strict';
  const HOLD_LIMIT = 40;      // max minutes an aircraft will hold before diverting
  const CANCEL_DELAY = 240;   // airline cancels rotation if departure would slip past this
  const MCT = 45;             // minimum connection time (min)
  const STRAND_MIN = 840;     // stranded pax assumed re-accommodated next day
  const CREW_DUTY = 840;      // crew duty limit from report (min)
  const HORIZON = 1800;       // sim day ends 06:00 next day
  const MIN_TURN = 35;

  const RATE = { delayMin: 8000, paxMin: 9, cancel: 750000, cancelPro: 350000, divert: 400000, stranded: 5000,
                 rebook: 2500, spare: 400000, spareRepo: 150000, crewFlight: 90000, fastTurn: 25000, surge: 1500000 };

  function simulate(net, weather, plan) {
    plan = plan || []; weather = weather || [];
    const A = net.airportMap, F = net.flights, n = F.length;
    const HZ = (net.meta && net.meta.t1) || HORIZON;
    const P = { gdp: [], hold: [], fastturn: [], crew: [], surge: [], cancel: [], swap: [], rebook: null };
    plan.forEach(a => { if (a.type === 'rebook') { if (!P.rebook || a.from < P.rebook.from) P.rebook = a; } else if (P[a.type]) P[a.type].push(a); });
    const spareBase = {};
    net.tails.forEach(t => { if (t.spare) spareBase[t.id] = t.base; });

    const fl = F.map((f, i) => ({
      id: i, num: f.num, tail: f.tail, airline: f.airline, orig: f.orig, dest: f.dest, std: f.std, sta: f.sta, block: f.block,
      noise: f.noise, load: f.load, root: null, status: 'sched', cancel: null, cancelAt: null, adep: null, aarr: null, eta: null, cta: null,
      react: 0, hold: 0, gdp: 0, detour: 0, slot: 0, slotWx: false, airHold: 0, airWx: false, gen: -1,
      divert: null, divArr: null, ferryDep: null, ferryArr: null, crewExt: false, fastTurn: false, swapped: false, proactive: false
    }));
    const tails = {};
    net.tails.forEach(t => { tails[t.id] = { id: t.id, chain: t.flights.slice(), ptr: 0, ready: -1, needTurn: false, crewEnd: 0, lastGen: -1, lastRoot: null, spare: t.spare, base: t.base }; });
    const spareUsed = [];

    // ---- weather / capacity ------------------------------------------------
    // A problem is a circle on the map; each airport inside it is hit according to distance from the centre.
    const wx = {}, bounds = {};
    function addB(code, t) { (bounds[code] = bounds[code] || []).push(t); }
    weather.forEach(e => net.airports.forEach(a => {
      const s = G.DS.effSev(e, a);
      if (s > 0.04) { (wx[a.code] = wx[a.code] || []).push({ start: e.start, end: e.start + e.dur, sev: s }); addB(a.code, e.start); addB(a.code, e.start + e.dur); }
    }));
    P.surge.forEach(s => addB(s.airport, s.from));
    const wxFactor = (code, t) => {
      let f = 1; const L = wx[code]; if (!L) return 1;
      for (const e of L) if (t >= e.start && t < e.end) f = Math.min(f, e.sev >= 0.9 ? 0 : 1 - e.sev);
      return f;
    };
    // en-route cells (thunderstorm, cyclone, dust): flights whose track crosses one fly around it
    const enr = weather.filter(e => (G.DS.WXT[e.type] || {}).enroute);
    function segDist(e, o, d) {
      const kx = 111 * Math.cos(e.lat * Math.PI / 180), ky = 111;
      const ax = (o.lon - e.lon) * kx, ay = (o.lat - e.lat) * ky, bx = (d.lon - e.lon) * kx, by = (d.lat - e.lat) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
      return { d: Math.hypot(ax + u * dx, ay + u * dy), len: Math.sqrt(L2) };
    }
    function detourFor(f, t) {
      let extra = 0; const o = A[f.orig], d = A[f.dest];
      for (const e of enr) {
        if (!(e.start < t + f.block && e.start + e.dur > t)) continue;
        if (G.DS.hav(e, o) < e.radius && G.DS.hav(e, d) < e.radius) continue;   // both ends inside: airport effects dominate
        const sg = segDist(e, o, d); if (sg.d >= e.radius) continue;
        // extra distance to skirt the cell: the way round the circle minus the straight chord we would have flown through
        const half = Math.acos(Math.min(1, sg.d / e.radius)), around = e.radius * 2 * half, chord = 2 * Math.sqrt(e.radius * e.radius - sg.d * sg.d);
        extra = Math.max(extra, Math.min(40, Math.max(0, around - Math.min(chord, sg.len)) / 13 * 1.2 * Math.min(1, e.severity + 0.25)));
      }
      return Math.round(extra / 5) * 5;
    }
    function capAt(code, t) {
      let c = A[code].cap;
      for (const s of P.surge) if (s.airport === code && t >= s.from) c *= 1 + s.pct / 100;
      return c * wxFactor(code, t);
    }
    function openTime(code, t) {
      if (capAt(code, t) > 0.01) return t;
      const b = (bounds[code] || []).filter(x => x > t).sort((a, c) => a - c);
      for (const x of b) if (capAt(code, x) > 0.01) return x;
      return Infinity;
    }
    const slots = {}; net.airports.forEach(a => slots[a.code] = []);
    function slotFor(code, t) {
      let s = t;
      for (let it = 0; it < 400; it++) {
        const c = capAt(code, s);
        if (c <= 0.01) { s = openTime(code, s); if (!isFinite(s)) return Infinity; continue; }
        const sp = 60 / c; let ns = s;
        for (const m of slots[code]) if (Math.abs(m - ns) < sp - 1e-6) ns = m + sp;
        if (ns === s) return s;
        s = ns;
      }
      return s;
    }
    const reserve = (code, s) => slots[code].push(s);
    const act = (list, code, t) => list.filter(a => (a.airport === 'ALL' || a.airport === code) && t >= a.from);

    // ---- event queue ---------------------------------------------------------
    const Q = []; let seq = 0;
    function push(t, type, fid) {
      const ev = { t, type, fid, seq: seq++ };
      let lo = 0, hi = Q.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (Q[m].t < t || (Q[m].t === t && Q[m].seq < ev.seq)) lo = m + 1; else hi = m; }
      Q.splice(lo, 0, ev);
    }

    // ---- plan application (before time starts; effects gated by `from`) ------
    function cancelRotation(tid, pos, reason, at, proactive) {
      const T = tails[tid]; const origin = fl[T.chain[pos]].orig;
      for (let k = pos; k < T.chain.length; k++) {
        const f = fl[T.chain[k]];
        if (f.status !== 'cancelled') { f.status = 'cancelled'; f.cancel = k === pos ? reason : 'rotation'; f.cancelAt = at; f.proactive = !!proactive; f.root = T.lastRoot; }
        if (k > pos && f.dest === origin) break;
      }
    }
    function cancelAll(tid, pos, reason, at) {
      const T = tails[tid];
      for (let k = pos; k < T.chain.length; k++) {
        const f = fl[T.chain[k]];
        if (f.status !== 'cancelled') { f.status = 'cancelled'; f.cancel = k === pos ? reason : 'rotation'; f.cancelAt = at; f.root = T.lastRoot; }
      }
    }
    P.swap.forEach(s => {
      const f = fl[s.flight], S = tails[s.spare]; if (!f || !S || !S.spare || S.chain.length) return;
      const T = tails[f.tail], pos = T.chain.indexOf(s.flight); if (pos < 0) return;
      const moved = T.chain.splice(pos); S.chain = moved; S.spare = false;
      moved.forEach(id => { fl[id].tail = S.id; fl[id].swapped = true; });
      const reposition = S.base !== f.orig;
      S.ready = s.from + (reposition ? net.blockBetween(S.base, f.orig) + 30 : 0);
      spareUsed.push({ tail: S.id, flight: s.flight, reposition });
    });
    P.cancel.forEach(c => {
      const f = fl[c.flight]; if (!f || f.status === 'cancelled') return;
      const T = tails[f.tail], pos = T.chain.indexOf(c.flight); if (pos < 0) return;
      cancelRotation(f.tail, pos, 'proactive', c.from, true);
    });
    Object.values(tails).forEach(T => {
      if (T.chain.length) T.crewEnd = F[T.chain[0]].std - 60 + (net.crewDuty || CREW_DUTY);
    });

    // ---- helpers -------------------------------------------------------------
    function minTurn(code, t) {
      let cut = 0;
      for (const a of act(P.fastturn, code, t)) cut = Math.max(cut, a.cut || 10);
      return { turn: MIN_TURN - cut, cut };
    }
    function scheduleNext(T) {
      while (T.ptr < T.chain.length && fl[T.chain[T.ptr]].status === 'cancelled') T.ptr++;
      if (T.ptr >= T.chain.length) return;
      const f = fl[T.chain[T.ptr]];
      const base = f.std + f.noise;
      let tr = base;
      if (T.ready >= 0) {
        if (T.needTurn) {
          const mt = minTurn(f.orig, T.ready);
          const normal = T.ready + MIN_TURN, cut = T.ready + mt.turn;
          tr = Math.max(base, cut);
          if (mt.cut && normal > base && cut < normal) f.fastTurn = true;
        } else tr = Math.max(base, T.ready);
      }
      f.react = Math.max(0, tr - base);
      push(tr, 'dep', f.id);
    }
    function findAlt(dest, t) {
      let best = null, bd = Infinity;
      for (const a of net.airports) {
        if (a.code === dest) continue;
        if (capAt(a.code, t) < 0.5 * a.cap || capAt(a.code, t + 60) < 0.5 * a.cap) continue;
        const d = net.dist(dest, a.code); if (d > (net.divertRange || 900)) continue;
        if (d < bd) { bd = d; best = a.code; }
      }
      return best;
    }

    // ---- departure -----------------------------------------------------------
    function onDep(fid, t) {
      const f = fl[fid], T = tails[f.tail];
      let t4 = t, holdMin = 0;
      // connection hold (only for feeders already airborne — what a real ops controller can see)
      const hp = act(P.hold, f.orig, t).reduce((m, a) => Math.max(m, a.mins), 0);
      if (hp > 0) {
        let need = t4;
        for (const it of net.itins) {
          if (it.d !== fid || it.pax < 10) continue;
          const g = fl[it.g];
          if (g.status === 'cancelled' || g.adep == null) continue;
          const arr = g.aarr != null ? g.aarr : g.eta;
          if (arr == null) continue;
          const ok = arr + MCT;
          if (ok > t4 && ok - t4 <= hp) need = Math.max(need, ok);
        }
        holdMin = need - t4; t4 = need;
      }
      const det = detourFor(f, t4), blk = f.block + det;
      let s = slotFor(f.orig, t4);
      const sRaw = s;
      let cta = null, gdpMin = 0;
      if (act(P.gdp, f.dest, t).length && isFinite(s)) {
        const eta = s + blk;
        const c = slotFor(f.dest, eta);
        if (isFinite(c)) {
          cta = c;
          if (c - eta > 4) { const s2 = slotFor(f.orig, s + (c - eta)); gdpMin = s2 - s; s = s2; }
        }
      }
      // cancellation checks
      const T0 = T.crewEnd;
      let ext = 0; for (const a of P.crew) if (t >= a.from) ext = Math.max(ext, a.extra);
      if (!isFinite(s) || s > HZ) { cancelRotation(f.tail, T.ptr, 'delay', t); scheduleNext(T); return; }
      if (s + blk > T0 + ext) { cancelAll(f.tail, T.ptr, 'crew', t); scheduleNext(T); return; }
      if (s - f.std > CANCEL_DELAY) { cancelRotation(f.tail, T.ptr, 'delay', t); scheduleNext(T); return; }
      if (s + blk > T0) f.crewExt = true;
      reserve(f.orig, s);
      if (cta != null) reserve(f.dest, cta);
      f.adep = s; f.eta = s + blk; f.cta = cta; f.detour = det;
      f.hold = holdMin; f.gdp = gdpMin; f.slot = sRaw - t4;
      f.slotWx = f.slot > 0 && (wxFactor(f.orig, t4) < 1 || wxFactor(f.orig, sRaw) < 1);
      // generation (domino depth)
      if (f.slotWx && f.slot >= 5) { f.gen = 0; f.root = f.orig; }
      else if (f.react >= 10 && T.lastGen >= 0) { f.gen = T.lastGen + 1; f.root = T.lastRoot; }
      if (f.gen < 0 && det >= 10) { f.gen = 0; f.root = 'en-route'; }
      f.status = 'ok';
      push(f.eta, 'arr', fid);
    }

    // ---- arrival -------------------------------------------------------------
    function onArr(fid, t) {
      const f = fl[fid], T = tails[f.tail];
      let aarr;
      if (f.cta != null) { aarr = Math.max(t, f.cta); }
      else {
        const s = slotFor(f.dest, t);
        if (s - t > HOLD_LIMIT) {
          const alt = findAlt(f.dest, t);
          if (alt) {
            const tA = t + 15 + net.dist(f.dest, alt) / 6.5;
            const sA = slotFor(alt, tA); reserve(alt, sA);
            f.divert = alt; f.divArr = sA;
            const ft = net.blockBetween(alt, f.dest);
            const earliest = openTime(f.dest, sA + 50 + ft);
            let fd = Math.max(sA + 50, earliest - ft);
            fd = slotFor(alt, fd); reserve(alt, fd); f.ferryDep = fd;
            const s2 = slotFor(f.dest, fd + ft); reserve(f.dest, s2);
            aarr = s2; f.ferryArr = s2;
            f.airWx = true; f.airHold = s2 - t;
          }
        }
        if (f.divert == null) {
          reserve(f.dest, s); aarr = s; f.airHold = s - t;
          f.airWx = f.airHold > 0 && (wxFactor(f.dest, t) < 1 || wxFactor(f.dest, s) < 1);
        }
      }
      f.aarr = aarr;
      if ((f.airWx && f.airHold >= 10) || f.divert) { f.gen = 0; f.root = f.dest; }
      T.lastGen = f.gen; T.lastRoot = f.root;
      T.ready = aarr; T.needTurn = true; T.ptr++;
      scheduleNext(T);
    }

    Object.values(tails).forEach(T => { if (T.chain.length) scheduleNext(T); });
    let guard = 0;
    while (Q.length && guard++ < 100000) {
      const ev = Q.shift();
      if (ev.type === 'dep') onDep(ev.fid, ev.t); else onArr(ev.fid, ev.t);
    }
    fl.forEach(f => { if (f.status === 'sched') { f.status = 'cancelled'; f.cancel = f.cancel || 'delay'; f.cancelAt = f.cancelAt == null ? f.std : f.cancelAt; } });

    const res = { flights: fl, tails, plan: P, spareUsed, weather };
    res.pax = resolvePax(net, fl, P);
    res.costs = computeCosts(net, res, plan);
    return res;
  }

  // ---- passengers ------------------------------------------------------------
  function resolvePax(net, fl, P) {
    const F = net.flights;
    const free = F.map(f => f.seats - f.load);
    const route = {};
    fl.forEach((f, i) => { if (f.status === 'ok') (route[f.orig + '>' + f.dest] = route[f.orig + '>' + f.dest] || []).push(i); });
    Object.values(route).forEach(L => L.sort((a, b) => fl[a].adep - fl[b].adep));

    function alloc(O, H, D, ready, need, second) {
      const out = []; let left = need;
      for (let iter = 0; iter < 8 && left > 0; iter++) {
        const cands = [];
        for (const i of route[O + '>' + D] || []) if (fl[i].adep >= ready && free[i] > 0) { cands.push({ legs: [i], arr: fl[i].aarr }); break; }
        if (!second && H && H !== D) {
          let gi = 0;
          for (const g of route[O + '>' + H] || []) {
            if (fl[g].adep < ready || free[g] <= 0) continue;
            if (++gi > 3) break;
            for (const d of route[H + '>' + D] || []) if (fl[d].adep >= fl[g].aarr + MCT && free[d] > 0) { cands.push({ legs: [g, d], arr: fl[d].aarr }); break; }
          }
        }
        if (!cands.length) break;
        cands.sort((a, b) => a.arr - b.arr);
        const c = cands[0], k = Math.min(left, ...c.legs.map(i => free[i]));
        c.legs.forEach(i => free[i] -= k);
        out.push({ legs: c.legs, n: k, arr: c.arr }); left -= k;
      }
      return { out, left };
    }

    let curCause = null;
    const R = { caused: {}, total: 0, onTime: 0, delayed: 0, paxMin: 0, missedPax: 0, missedItins: 0, cancelledPax: 0, rebooked: 0, stranded: 0, events: [], list: [], byHub: {} };
    const share = (tEvent, proactive) => {
      if (proactive) return { s: 1, q: 0 };
      if (P.rebook && tEvent >= P.rebook.from) return { s: 1, q: 0 };
      return { s: 0.6, q: 120 };
    };
    function handle(label, p, tEvent, proactive, O, H, D, ready, second, schedArr, kind, hub) {
      const sh = share(tEvent, proactive);
      const handled = Math.round(p * sh.s);
      const r = alloc(O, H, D, ready, handled, second);
      let rebooked = 0, pm = 0, bestArr = null;
      r.out.forEach(a => { rebooked += a.n; pm += a.n * (Math.max(0, a.arr - schedArr) + sh.q); bestArr = bestArr == null ? a.arr : Math.max(bestArr, a.arr); });
      if (curCause != null) R.caused[curCause] = (R.caused[curCause] || 0) + p;
      const stranded = p - rebooked;
      pm += stranded * STRAND_MIN;
      R.paxMin += pm; R.rebooked += rebooked; R.stranded += stranded;
      R.events.push({ t: tEvent, kind, pax: p, stranded, rebooked });
      if (hub) R.byHub[hub] = (R.byHub[hub] || 0) + p;
      R.list.push({ label, hub, pax: p, kind, rebooked, stranded, impact: pm, delay: rebooked ? Math.round(pm / Math.max(1, p)) : STRAND_MIN, tEvent });
    }

    for (const it of net.itins) {
      const g = fl[it.g], d = fl[it.d], p = it.pax, G0 = F[it.g], D0 = F[it.d];
      R.total += p;
      curCause = g.status === 'cancelled' ? it.g : d.status === 'cancelled' ? it.d : (g.aarr - G0.sta > 5 ? it.g : it.d);
      const label = `${G0.orig}→${G0.dest}→${D0.dest} (${G0.num} + ${D0.num})`;
      if (g.status === 'ok' && d.status === 'ok') {
        if (d.adep - g.aarr >= MCT) {
          const dl = Math.max(0, d.aarr - D0.sta);
          R.paxMin += p * dl; if (dl > 15) R.delayed += p; else R.onTime += p;
          continue;
        }
        R.missedPax += p; R.missedItins++;
        handle(label, p, g.aarr, false, G0.dest, null, D0.dest, g.aarr + MCT, true, D0.sta, 'missed', G0.dest);
      } else if (g.status === 'cancelled') {
        R.cancelledPax += p;
        handle(label, p, g.cancelAt == null ? G0.std - 60 : g.cancelAt, g.proactive, G0.orig, G0.dest, D0.dest, G0.std, false, D0.sta, 'cancelled', G0.orig);
      } else {
        R.missedPax += p; R.missedItins++;
        handle(label, p, g.aarr, false, G0.dest, null, D0.dest, g.aarr + MCT, true, D0.sta, 'missed', G0.dest);
      }
    }
    fl.forEach((f, i) => {
      const f0 = F[i], p = f0.local; if (p <= 0) return;
      curCause = i;
      R.total += p;
      if (f.status === 'ok') {
        const dl = Math.max(0, f.aarr - f.sta);
        R.paxMin += p * dl; if (dl > 15) R.delayed += p; else R.onTime += p;
      } else {
        R.cancelledPax += p;
        handle(`${f0.orig}→${f0.dest} (${f0.num})`, p, f.cancelAt == null ? f.std - 60 : f.cancelAt, f.proactive, f0.orig, null, f0.dest, f.std, false, f.sta, 'cancelled', f0.orig);
      }
    });
    R.list.sort((a, b) => b.impact - a.impact);
    return R;
  }

  // ---- costs -----------------------------------------------------------------
  function computeCosts(net, res, plan) {
    const fl = res.flights; let delayMin = 0, cancels = 0, proCancels = 0, diverts = 0, crewUsed = 0, fastUsed = 0;
    fl.forEach(f => {
      if (f.status === 'cancelled') { if (f.proactive) proCancels++; else cancels++; return; }
      delayMin += Math.max(0, f.aarr - f.sta);
      if (f.divert) diverts++;
      if (f.crewExt) crewUsed++;
      if (f.fastTurn) fastUsed++;
    });
    const px = res.pax;
    const c = {
      delay: delayMin * RATE.delayMin, paxDelay: px.paxMin * RATE.paxMin,
      cancel: cancels * RATE.cancel + proCancels * RATE.cancelPro, divert: diverts * RATE.divert, stranded: px.stranded * RATE.stranded,
      spare: res.spareUsed.length * RATE.spare + res.spareUsed.filter(s => s.reposition).length * RATE.spareRepo,
      crew: crewUsed * RATE.crewFlight, fast: fastUsed * RATE.fastTurn,
      surge: (res.plan.surge.length) * RATE.surge,
      rebook: res.plan.rebook ? px.rebooked * RATE.rebook : 0
    };
    c.recovery = c.spare + c.crew + c.fast + c.surge + c.rebook;
    c.disruption = c.delay + c.paxDelay + c.cancel + c.divert + c.stranded;
    c.total = c.disruption + c.recovery;
    c.counts = { delayMin, cancels: cancels + proCancels, diverts, crewUsed, fastUsed };
    return c;
  }

  // ---- metrics ---------------------------------------------------------------
  function metricsAt(res, t) {
    let paxDelay = 0, due = 0, onTime = 0, delayMin = 0, cancelled = 0, diverted = 0, airborne = 0, waiting = 0, delayed = 0, worst = 0;
    for (const f of res.flights) {
      const cancelKnown = f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= t;
      const isDue = f.std <= t || cancelKnown;
      if (!isDue) continue;
      due++;
      if (f.status === 'cancelled') { cancelled++; continue; }
      const d = f.adep != null && f.adep <= t ? f.adep - f.std : t - f.std;
      if (d <= 15) onTime++; else delayed++;
      if (f.adep > t) waiting++;
      delayMin += Math.max(0, d); paxDelay += f.load * Math.max(0, d); if (d > worst) worst = d;
      if (f.adep <= t && f.aarr > t) airborne++;
    }
    for (const f of res.flights) if (f.divert && f.eta <= t) diverted++;
    let missed = 0, stranded = 0, rebooked = 0;
    for (const e of res.pax.events) if (e.t <= t) { missed += e.pax; stranded += e.stranded; rebooked += e.rebooked; }
    return { paxDelayMin: paxDelay, due, onTime, otp: due ? onTime / due : 1, delayMin, cancelled, diverted, airborne, waiting, delayed, worst, missedPax: missed, stranded, rebooked };
  }
  function series(res, from, to, step) {
    const T = [], D = [], C = [], P = [];
    for (let t = from; t <= to; t += step) { const m = metricsAt(res, t); T.push(t); D.push(m.delayMin); C.push(m.cancelled); P.push(m.paxDelayMin / 60); }
    return { t: T, delay: D, cancelled: C, pax: P };
  }
  function airportStandings(net, res, t) {
    const rows = {}; net.airports.forEach(a => rows[a.code] = { code: a.code, city: a.city, dep: 0, onTime: 0, delaySum: 0, cancelled: 0, queue: 0, gen: 0, status: 'ok' });
    for (const f of res.flights) {
      const r = rows[f.orig];
      const cancelKnown = f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= t;
      if (!(f.std <= t || cancelKnown)) continue;
      r.dep++;
      if (f.status === 'cancelled') { r.cancelled++; continue; }
      const d = f.adep != null && f.adep <= t ? f.adep - f.std : t - f.std;
      if (d <= 15) r.onTime++; r.delaySum += Math.max(0, d);
      if (f.adep > t) r.queue++;
      if (f.gen >= 1 && d > 15) r.gen++;
    }
    return Object.values(rows).map(r => Object.assign(r, { otp: r.dep ? r.onTime / r.dep : 1, avg: (r.dep - r.cancelled) > 0 ? r.delaySum / (r.dep - r.cancelled) : 0 }));
  }
  function carrierStandings(net, res, t) {
    const rows = {}; net.airlines.forEach(a => rows[a.code] = { code: a.code, name: a.name, color: a.color, dep: 0, onTime: 0, delaySum: 0, cancelled: 0 });
    for (const f of res.flights) {
      const r = rows[f.airline];
      const cancelKnown = f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= t;
      if (!(f.std <= t || cancelKnown)) continue;
      r.dep++;
      if (f.status === 'cancelled') { r.cancelled++; continue; }
      const d = f.adep != null && f.adep <= t ? f.adep - f.std : t - f.std;
      if (d <= 15) r.onTime++; r.delaySum += Math.max(0, d);
    }
    return Object.values(rows).map(r => Object.assign(r, { otp: r.dep ? r.onTime / r.dep : 1, avg: (r.dep - r.cancelled) > 0 ? r.delaySum / (r.dep - r.cancelled) : 0 }));
  }
  // delay attribution over the whole day
  function attribution(res) {
    const a = { weather: 0, reactionary: 0, congestion: 0, measures: 0, minor: 0, airborne: 0 };
    res.flights.forEach(f => {
      if (f.status !== 'ok') return;
      if (f.slotWx) a.weather += f.slot; else a.congestion += f.slot;
      a.reactionary += f.react; a.measures += f.hold + f.gdp; a.minor += f.noise;
      if (f.airWx) a.airborne += f.airHold; else a.congestion += f.airHold;
      a.airborne += f.detour;
    });
    return a;
  }
  function generations(res) {
    const g = [];
    res.flights.forEach(f => {
      if (f.status !== 'ok' || f.gen < 0) return;
      const k = Math.min(f.gen, 5); g[k] = g[k] || { n: 0, min: 0 };
      g[k].n++; g[k].min += Math.max(0, f.aarr - f.sta);
    });
    for (let i = 0; i < g.length; i++) g[i] = g[i] || { n: 0, min: 0 };
    return g;
  }

  // ---- advisor ---------------------------------------------------------------
  function affected(net, weather) {
    const m = {};
    weather.forEach(e => net.airports.forEach(a => { const v = G.DS.effSev(e, a); if (v > 0.3) m[a.code] = Math.max(m[a.code] || 0, v); }));
    return Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, 4);
  }
  function candidates(net, weather, plan, now) {
    const out = [], hubs = net.airports.filter(a => a.hub).map(a => a.code);
    const wxCodes = affected(net, weather);
    const has = (type, key) => plan.some(a => a.type === type && (!key || a.airport === key));
    const cur = simulate(net, weather, plan);
    wxCodes.forEach(c => {
      if (!has('gdp', c) && !has('gdp', 'ALL')) out.push({ label: `Ground-delay program for ${c}`, action: { type: 'gdp', airport: c, from: now } });
      if (!plan.some(a => a.type === 'surge' && a.airport === c)) out.push({ label: `Surge ops at ${c} (+25% capacity)`, action: { type: 'surge', airport: c, from: now, pct: 25 } });
      if (!has('fastturn', c)) out.push({ label: `Fast turnarounds at ${c}`, action: { type: 'fastturn', airport: c, from: now, cut: 10 } });
    });
    if (!has('gdp', 'ALL')) out.push({ label: 'Network-wide ground-delay program', action: { type: 'gdp', airport: 'ALL', from: now } });
    if (!has('hold', 'ALL')) { out.push({ label: 'Hold connections up to 20 min (all airports)', action: { type: 'hold', airport: 'ALL', mins: 20, from: now } });
      out.push({ label: 'Hold connections up to 35 min (all airports)', action: { type: 'hold', airport: 'ALL', mins: 35, from: now } }); }
    if (!has('fastturn', 'ALL')) out.push({ label: 'Fast turnarounds network-wide', action: { type: 'fastturn', airport: 'ALL', from: now, cut: 10 } });
    if (!plan.some(a => a.type === 'crew')) out.push({ label: 'Extend crew duty by 2 h', action: { type: 'crew', from: now, extra: 120 } });
    if (!plan.some(a => a.type === 'rebook')) out.push({ label: 'Auto-rebook & care for disrupted passengers', action: { type: 'rebook', from: now } });
    // swaps: best late flights at airports that host a free spare
    const freeSpares = net.tails.filter(t => t.spare && !plan.some(a => a.type === 'swap' && a.spare === t.id));
    const late = cur.flights.filter(f => f.status === 'ok' && f.std >= now && f.adep - f.std >= 30 && !f.swapped)
      .sort((a, b) => (b.adep - b.std) - (a.adep - a.std)).slice(0, 14);
    late.forEach(f => {
      const sp = freeSpares.slice().sort((a, b) => net.dist(a.base, f.orig) - net.dist(b.base, f.orig))[0];
      if (sp) out.push({ label: `Swap in spare ${sp.id} for ${f.num} ${f.orig}→${f.dest}`, action: { type: 'swap', flight: f.id, spare: sp.id, from: now } });
    });
    // proactive rotation cancels for badly delayed flights
    cur.flights.filter(f => f.status === 'ok' && f.std >= now + 30 && f.adep - f.std >= 150 && !plan.some(a => a.type === 'cancel' && a.flight === f.id))
      .sort((a, b) => (b.adep - b.std) - (a.adep - a.std)).slice(0, 8)
      .forEach(f => out.push({ label: `Cancel rotation from ${f.num} ${f.orig}→${f.dest}`, action: { type: 'cancel', flight: f.id, from: now } }));
    return { cur, list: out };
  }
  // Operational objectives — no money involved.
  const OBJ = {
    pax:      { label: 'Passenger delay', short: 'Passengers', unit: 'pax-hours',      eps: 300, div: 60 },
    flights:  { label: 'Aircraft delay',  short: 'Aircraft',   unit: 'aircraft-hours', eps: 10,  div: 60 },
    stranded: { label: 'People stranded', short: 'Stranded',   unit: 'people',         eps: 3,   div: 1 }
  };
  function objective(res, mode) {
    if (mode === 'flights') { let m = 0; res.flights.forEach(f => { m += f.status === 'ok' ? Math.max(0, f.aarr - f.sta) : 360; }); return m; }   // a cancelled flight counts as 6 h
    if (mode === 'stranded') return res.pax.stranded + res.pax.paxMin * 1e-7;
    return res.pax.paxMin;
  }
  const detail = (cur, r) => ({ paxMin: cur.pax.paxMin - r.pax.paxMin, delayMin: cur.costs.counts.delayMin - r.costs.counts.delayMin, cancels: cur.costs.counts.cancels - r.costs.counts.cancels,
    stranded: cur.pax.stranded - r.pax.stranded, spend: r.costs.recovery - cur.costs.recovery });
  function advise(net, weather, plan, now, mode) {
    mode = mode || 'pax';
    const { cur, list } = candidates(net, weather, plan, now);
    const base = objective(cur, mode), items = [];
    list.forEach(c => {
      const r = simulate(net, weather, plan.concat([Object.assign({ id: -1 }, c.action)]));
      items.push(Object.assign({ label: c.label, action: c.action, gain: base - objective(r, mode) }, detail(cur, r)));
    });
    return { base: cur, baseObj: base, mode, items: items.filter(i => i.gain > OBJ[mode].eps).sort((a, b) => b.gain - a.gain) };
  }
  // What would swapping a spare in / cancelling the rotation do for ONE flight?
  function fixOptions(net, weather, plan, now, fid, mode, cur) {
    cur = cur || simulate(net, weather, plan); mode = mode || 'pax';
    const f = cur.flights[fid], out = [], base = objective(cur, mode);
    const used = plan.filter(a => a.type === 'swap').map(a => a.spare);
    const sp = net.tails.filter(t => t.spare && !used.includes(t.id)).sort((a, b) => net.dist(a.base, f.orig) - net.dist(b.base, f.orig))[0];
    const tryIt = (label, action) => { const r = simulate(net, weather, plan.concat([Object.assign({ id: -1 }, action)])); out.push(Object.assign({ label, action, gain: base - objective(r, mode) }, detail(cur, r))); };
    if (sp) tryIt('Swap in spare ' + sp.id, { type: 'swap', flight: fid, spare: sp.id, from: now });
    tryIt('Cancel rotation', { type: 'cancel', flight: fid, from: now });
    return out.sort((a, b) => b.gain - a.gain);
  }

  // Where is the damage coming from, and which flights are about to fall next?
  function diagnose(net, res, now) {
    const fl = res.flights, caused = res.pax.caused || {}, roots = {};
    let direct = 0, knock = 0;
    fl.forEach(f => {
      if (f.std > now) return;
      const cp = (caused[f.id] || 0) * 180;
      if (f.status === 'ok') {
        if (f.gen < 0) return;
        const key = f.root || 'other', pm = f.load * Math.max(0, f.aarr - f.sta) + cp;
        const r = roots[key] = roots[key] || { root: key, flights: 0, gen0: 0, direct: 0, knock: 0, cancels: 0, missedPax: 0 };
        r.flights++; r.missedPax += caused[f.id] || 0;
        if (f.gen === 0) { r.direct += pm; r.gen0++; direct += pm; } else { r.knock += pm; knock += pm; }
      } else {
        const key = f.root || 'other', r = roots[key] = roots[key] || { root: key, flights: 0, gen0: 0, direct: 0, knock: 0, cancels: 0, missedPax: 0 };
        r.cancels++; r.missedPax += caused[f.id] || 0; r.knock += cp; knock += cp;
      }
    });
    const list = Object.values(roots).map(r => Object.assign(r, { total: r.direct + r.knock })).sort((a, b) => b.total - a.total);
    // upcoming flights that are already predicted late, with what they will drag down behind them
    const risks = [];
    fl.forEach(f => {
      if (f.status !== 'ok' || f.std < now || f.adep - f.std < 20) return;
      const T = res.tails[f.tail], pos = T.chain.indexOf(f.id); let kF = 0, kPax = 0, slack = null;
      for (let k = pos + 1; k < T.chain.length; k++) {
        const g = fl[T.chain[k]];
        if (k === pos + 1) slack = g.std - f.sta - MIN_TURN;
        if (g.status === 'cancelled') { kF++; kPax += g.load * 120; continue; }
        const d = g.aarr - g.sta; if (d > 15) { kF++; kPax += g.load * d; }
      }
      const own = f.load * Math.max(0, f.aarr - f.sta), cp = (caused[f.id] || 0) * 180;
      risks.push({ id: f.id, delay: f.adep - f.std, slack, kF, kPax, own, caused: caused[f.id] || 0, score: own + kPax + cp, root: f.root });
    });
    risks.sort((a, b) => b.score - a.score);
    return { roots: list, direct, knock, risks: risks.slice(0, 12) };
  }

  G.DS = G.DS || {};
  Object.assign(G.DS, { OBJ, objective, fixOptions, diagnose, affected, simulate, metricsAt, series, airportStandings, carrierStandings, attribution, generations, advise, RATE, MCT, HOLD_LIMIT, CANCEL_DELAY, CREW_DUTY, HORIZON });
  if (typeof module !== 'undefined') module.exports = G.DS;
})(typeof window !== 'undefined' ? window : globalThis);
