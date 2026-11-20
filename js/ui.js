/* Skylay — UI controller */
(function () {
  'use strict';
  const DS = window.DS, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  let net = DS.buildNetwork('india');
  let AP = net.airportMap;
  let T0 = net.meta.t0, T1 = net.meta.t1;
  DS.airportMap = net.airportMap;
  // colours for the canvas charts, switched with the theme
  const TC = () => DS.themeName === 'light'
    ? { axis: '#5b6f85', grid: '#d8e1ea', head: '#f1f5f9', headTxt: '#4b5f75', headLine: '#c4d0dd', rowAlt: 'rgba(15,40,70,.03)', selRow: 'rgba(10,124,196,.16)', txt: '#51657b', txtSel: '#0e1b2b', sliver: '#a9b8c8', nowLine: '#0e1b2b', nowBg: '#0e1b2b', nowTxt: '#ffffff', selOutline: '#0e1b2b', clear: '#94a3b8', legend: '#4b5f75', band: 'rgba(110,80,220,.13)', bandHead: 'rgba(110,80,220,.55)' }
    : { axis: '#6a7ba0', grid: '#1b2738', head: '#0e141d', headTxt: '#7d8db0', headLine: '#26364a', rowAlt: 'rgba(255,255,255,.018)', selRow: 'rgba(76,201,240,.13)', txt: '#8696ad', txtSel: '#ffffff', sliver: '#34445c', nowLine: '#ffffff', nowBg: '#ffffff', nowTxt: '#05101f', selOutline: '#ffffff', clear: '#64748b', legend: '#9fb0d4', band: 'rgba(167,139,250,.14)', bandHead: 'rgba(167,139,250,.55)' };

  const S = {
    net, scenario: 'bom-monsoon', weather: [], plan: [], now: 480, playing: false, speed: 15,
    sel: { airport: null, flight: null, tail: null }, colorMode: 'delay', res: {}, ser: {}, nextId: 1,
    placing: null, selEv: null, ltab: 'scenario', btab: 'gantt', rstab: 'airports', chartMetric: 'pax', objective: 'pax', fixCache: {}, fixKey: '', form: {}, advice: null,
    board: { filter: 'active', q: '' }, gantt: { mode: 'full', sort: 'base' }, standSort: 'worst', worstTail: null
  };

  // ---------- helpers ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function hhmm(m) { m = Math.round(m); const x = ((m % 1440) + 1440) % 1440; return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0') + (m >= 1440 ? '⁺¹' : ''); }
  function inr(v) { const a = Math.abs(v), s = v < 0 ? '−' : ''; if (a >= 1e7) return s + '₹' + (a / 1e7).toFixed(2) + ' cr'; if (a >= 1e5) return s + '₹' + (a / 1e5).toFixed(1) + ' L'; return s + '₹' + Math.round(a).toLocaleString('en-IN'); }
  const num = v => Math.round(v).toLocaleString('en-IN');
  const dcol = DS.colDelay;
  const delayPill = d => d <= 15 ? 'ok' : d <= 45 ? 'warn' : d <= 120 ? 'orange' : 'bad';
  let lastHtml = new WeakMap();
  function setHtml(el, html) { if (!el) return; if (lastHtml.get(el) !== html) { el.innerHTML = html; lastHtml.set(el, html); } }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2600); }
  const tip = $('#tip');
  function showTip(html, x, y) { tip.innerHTML = html; tip.classList.remove('hidden'); const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(innerWidth - w - 8, x + 14) + 'px'; tip.style.top = Math.min(innerHeight - h - 8, y + 14) + 'px'; }
  const hideTip = () => tip.classList.add('hidden');
  const R = () => S.res.plan;
  const wxAirports = () => DS.affected(net, S.weather);
  const wxAp = () => wxAirports()[0] || 'ALL';
  function where(e) {
    let best = null, bd = 1e9; net.airports.forEach(a => { const d = DS.hav(e, a); if (d < bd) { bd = d; best = a; } });
    return `${Math.abs(e.lat).toFixed(1)}°N ${e.lon.toFixed(1)}°E · ${bd < 25 ? 'over' : Math.round(bd) + ' km from'} ${best.code}`;
  }
  function hits(e) {
    return net.airports.map(a => ({ a, v: DS.effSev(e, a) })).filter(x => x.v > 0.04).sort((x, y) => y.v - x.v)
      .map(x => ({ code: x.a.code, txt: x.v >= 0.9 ? 'closed' : Math.round((1 - x.v) * 100) + '% cap' }));
  }
  function hitsHtml(e) {
    const h = hits(e);
    return h.length ? h.map(x => `<span class="pill ${x.txt === 'closed' ? 'bad' : 'warn'}">${x.code} ${x.txt}</span>`).join('') : '<span class="note" style="margin:0">No airport inside this area — only flights routed through it are affected.</span>';
  }
  const plantBtns = compact => Object.entries(DS.WXT).map(([t, m]) => `<button class="plantbtn ${S.placing === t ? 'on' : ''}" data-act="arm" data-type="${t}" title="${t} — ${m.kind.toLowerCase()} problem: click, then click anywhere on the map">${m.icon}${compact ? '' : ' ' + t}</button>`).join('');
  function renderPlant() {
    setHtml($('#plant'), `<span class="lbl">Plant</span>${plantBtns(true)}${S.placing ? '<button class="plantbtn" data-act="disarm">✕ Cancel</button>' : ''}`);
  }
  const apOptions = (sel, all) => (all ? `<option value="ALL" ${sel === 'ALL' ? 'selected' : ''}>All airports</option>` : '') + net.airports.map(a => `<option value="${a.code}" ${sel === a.code ? 'selected' : ''}>${a.code} · ${a.city}</option>`).join('');

  // ---------- model ----------
  function recompute() {
    S.res.clear = S.res.clear || DS.simulate(net, [], []);
    S.res.base = DS.simulate(net, S.weather, []);
    S.res.plan = S.plan.length ? DS.simulate(net, S.weather, S.plan) : S.res.base;
    S.ser = { clear: DS.series(S.res.clear, T0, T1, 10), base: DS.series(S.res.base, T0, T1, 10), plan: DS.series(S.res.plan, T0, T1, 10) };
    // most knocked-on aircraft
    let best = null, bv = -1;
    for (const id in S.res.plan.tails) {
      const T = S.res.plan.tails[id]; let v = 0;
      T.chain.forEach(fid => { const f = S.res.plan.flights[fid]; if (f.status === 'ok' && f.gen >= 0) v += Math.max(0, f.aarr - f.sta); else if (f.status === 'cancelled' && f.cancel !== 'proactive') v += 120; });
      if (v > bv) { bv = v; best = id; }
    }
    S.worstTail = bv > 0 ? best : null;
    S.advice = S.advice && S.advice.stale === false ? Object.assign(S.advice, { stale: true }) : S.advice;
  }
  function loadScenario(id) {
    const sc = net.meta.scenarios.find(s => s.id === id) || net.meta.scenarios[0];
    S.scenario = sc.id; S.weather = sc.events.map(e => Object.assign({ id: S.nextId++ }, e)); S.plan = []; S.advice = null; S.fixCache = {};
    S.sel = { airport: null, flight: null, tail: null }; S.form = {}; S.playing = false;
    S.now = sc.events.length ? Math.max(T0, Math.min(...sc.events.map(e => e.start)) - 120) : 480;
    recompute(); renderAll();
  }
  function addAction(a, quiet) {
    a.id = S.nextId++; S.plan.push(a); S.advice = null; recompute(); renderAll();
    if (!quiet) toast('Added: ' + describe(a).title + ' — effective ' + hhmm(a.from));
  }
  function removeAction(id) { S.plan = S.plan.filter(a => a.id !== id); recompute(); renderAll(); }
  function previewDelta(a) {
    const r = DS.simulate(net, S.weather, S.plan.concat([Object.assign({ id: -1 }, a)]));
    return r.costs.total - R().costs.total;
  }
  const flName = id => { const f = R().flights[id]; return f ? `${f.num} ${f.orig}→${f.dest}` : '?'; };
  function describe(a) {
    const ap = c => c === 'ALL' ? 'all airports' : c;
    switch (a.type) {
      case 'gdp': return { icon: '⏱', title: 'Ground-delay program · ' + (a.airport === 'ALL' ? 'network' : a.airport + ' inbound'), detail: 'Hold departures on the ground instead of in the air' };
      case 'hold': return { icon: '🤝', title: `Hold connections ≤${a.mins}m · ${ap(a.airport)}`, detail: 'Wait for airborne feeders with ≥10 connecting pax' };
      case 'fastturn': return { icon: '⚡', title: 'Fast turnarounds · ' + ap(a.airport), detail: 'Minimum turn 35 → 25 min' };
      case 'crew': return { icon: '👨‍✈️', title: `Crew duty +${a.extra / 60} h`, detail: 'Avoids late-evening crew time-outs' };
      case 'surge': return { icon: '🛫', title: `Surge ops · ${a.airport} +${a.pct}%`, detail: 'Extra staff, relaxed spacing, extra stands' };
      case 'rebook': return { icon: '🎫', title: 'Auto-rebook & care', detail: 'Protect disrupted pax on the next seats' };
      case 'cancel': return { icon: '✂', title: 'Cancel rotation · ' + flName(a.flight), detail: 'Pre-emptive cancel until the aircraft is back home' };
      case 'swap': return { icon: '🔁', title: `Spare ${a.spare} → ${flName(a.flight)}`, detail: 'Spare takes over the rest of the rotation' };
    }
    return { icon: '?', title: a.type, detail: '' };
  }

  // ---------- metrics for current time ----------
  const M = () => DS.metricsAt(R(), S.now);
  const MB = () => DS.metricsAt(S.res.base, S.now);

  function causeOf(f) {
    if (f.status === 'cancelled') return { crew: 'Crew duty limit hit', delay: 'Delay >4 h → cancelled', proactive: 'Proactive cancel', rotation: 'Rotation protected' }[f.cancel] || 'Cancelled';
    const parts = [];
    if (f.react >= 5) parts.push(['Late aircraft', f.react]);
    if (f.slot >= 5) parts.push([f.slotWx ? 'Weather queue' : 'Runway queue', f.slot]);
    if (f.detour >= 5) parts.push(['Storm detour', f.detour]);
    if (f.gdp >= 5) parts.push(['Ground hold', f.gdp]);
    if (f.hold >= 5) parts.push(['Connection hold', f.hold]);
    if (f.divert) parts.push(['Diverted → ' + f.divert, f.aarr - f.eta]);
    else if (f.airHold >= 5) parts.push(['Airborne hold', f.airHold]);
    if (!parts.length) return f.noise >= 5 ? 'Minor ops delay' : '';
    parts.sort((a, b) => b[1] - a[1]);
    return parts.slice(0, 2).map(p => `${p[0]} +${Math.round(p[1])}`).join(' · ');
  }
  function statusOf(f, t) {
    if (f.status === 'cancelled') return { k: 'cancel', text: 'Cancelled' };
    const ph = DS.flightPhase(net, f, t);
    const dep = f.adep - f.std;
    switch (ph.ph) {
      case 'scheduled': return dep > 15 ? { k: delayPill(dep), text: 'Delayed' } : { k: 'info', text: 'Scheduled' };
      case 'waiting': return { k: 'bad', text: 'Waiting' };
      case 'air': return { k: 'info', text: 'Airborne' };
      case 'hold': return { k: 'orange', text: 'Holding' };
      case 'divert': case 'atalt': case 'ferry': return { k: 'violet', text: 'Diverted' };
      default: { const d = f.aarr - f.sta; return { k: delayPill(d), text: d > 15 ? 'Landed +' + Math.round(d) : 'Landed' }; }
    }
  }

  // =====================================================================
  //  LEFT PANEL
  // =====================================================================
  function renderLeft() {
    $$('#leftTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.ltab));
    const el = $('#leftBody'); const keep = el.scrollTop;
    el.innerHTML = S.ltab === 'scenario' ? weatherHtml() : S.ltab === 'recovery' ? recoveryHtml() : advisorHtml();
    el.scrollTop = keep;
  }
  function weatherHtml() {
    const sc = net.meta.scenarios.find(s => s.id === S.scenario) || net.meta.scenarios[0];
    const types = Object.keys(DS.WXT);
    const ev = S.weather.map(e => {
      const m = DS.WXT[e.type];
      return `
      <div class="card evcard ${S.selEv === e.id ? 'sel' : ''}" id="ev${e.id}" data-ev="${e.id}">
        <h5><span>${m.icon} ${esc(e.type)}</span><button class="x-btn" data-act="delEv" data-id="${e.id}" title="Remove">✕</button></h5>
        <div class="note" style="margin:-2px 0 6px">${where(e)}</div>
        <div class="row" style="margin-bottom:5px"><select data-evf="type" data-id="${e.id}">${types.map(t => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="sl"><span>Starts</span><input type="range" min="${T0}" max="1560" step="5" value="${e.start}" data-evf="start" data-id="${e.id}"><output>${hhmm(e.start)}</output></div>
        <div class="sl"><span>Duration</span><input type="range" min="15" max="480" step="15" value="${e.dur}" data-evf="dur" data-id="${e.id}"><output>${Math.floor(e.dur / 60)}h${String(e.dur % 60).padStart(2, '0')}</output></div>
        <div class="sl"><span>Severity</span><input type="range" min="10" max="100" step="5" value="${Math.round(e.severity * 100)}" data-evf="severity" data-id="${e.id}"><output>${e.severity >= 0.9 ? 'Closed' : Math.round((1 - e.severity) * 100) + '% cap'}</output></div>
        <div class="sl"><span>Radius</span><input type="range" min="20" max="500" step="10" value="${e.radius}" data-evf="radius" data-id="${e.id}"><output>${e.radius} km</output></div>
        <div style="margin-top:6px" class="row" id="hits${e.id}">${hitsHtml(e)}</div>
      </div>`;
    }).join('');
    return `
      <h3>Scenario</h3>
      <div class="card"><h5>${esc(sc.name)}</h5><p style="margin:0">${esc(sc.desc)}</p></div>
      <h3>Plant a problem — anywhere</h3>
      <div class="plantgrid">${plantBtns()}</div>
      <p class="note">Pick a type, then <b>click anywhere on the map</b>. Drag a marker to move it. Airports inside the circle are throttled or closed; storms and cyclones also force flights crossing them to detour.</p>
      <h3>Active problems (${S.weather.length})</h3>
      ${ev || '<div class="empty">Nothing planted yet. Pick a type above and click the map.</div>'}
      <h3>How a domino falls</h3>
      <div class="card"><p style="margin:0">① A problem closes or throttles airports → ② aircraft wait or divert → ③ the same aircraft's next flights start late (<b>reactionary delay</b>) → ④ connections break and crews time out → ⑤ airports far from the problem go amber and red.</p></div>`;
  }

  function lateFlights(minDelay, fromT) {
    const list = R().flights.filter(f => f.status === 'ok' && f.std >= fromT && f.adep - f.std >= minDelay && !f.swapped)
      .sort((a, b) => (b.adep - b.std) - (a.adep - a.std)).slice(0, 30);
    const sf = S.sel.flight != null ? R().flights[S.sel.flight] : null;
    if (sf && sf.status === 'ok' && sf.std >= fromT && !list.includes(sf)) list.unshift(sf);
    return list;
  }
  const O = () => DS.OBJ[S.objective];
  const objVal = v => num(v / O().div);
  const unitS = () => ({ pax: 'pax-h', flights: 'ac-h', stranded: 'people' }[S.objective]);
  function objChips(extraCls) {
    return `<div class="chips ${extraCls || ''}">${Object.entries(DS.OBJ).map(([k, o]) => `<button data-act="obj" data-obj="${k}" class="${S.objective === k ? 'on' : ''}">${o.short}</button>`).join('')}</div>`;
  }
  function pv(a) {
    const o = O(), r = DS.simulate(net, S.weather, S.plan.concat([Object.assign({ id: -1 }, a)]));
    const d = DS.objective(R(), S.objective) - DS.objective(r, S.objective), spend = r.costs.recovery - R().costs.recovery;
    const sp = spend > 20000 ? `<span class="tag" title="Resources committed (reference only)">spend ${inr(spend)}</span>` : '';
    if (Math.abs(d) < o.eps) return '<span class="tag">≈ no change</span> ' + sp;
    return (d > 0 ? `<span class="tag good">−${objVal(d)} ${o.unit}</span>` : `<span class="tag bad">+${objVal(-d)} ${o.unit} worse</span>`) + ' ' + sp;
  }
  function recoveryHtml() {
    const now = S.now, F = S.form, wx = wxAp();
    const g = (k, d) => F[k] || d;
    const has = t => S.plan.some(a => a.type === t);
    const freeSp = net.tails.filter(t => t.spare && !S.plan.some(a => a.type === 'swap' && a.spare === t.id));
    const late = lateFlights(20, now);
    const swapF = late.find(f => f.id == F.swapFlight) ? +F.swapFlight : (late[0] ? late[0].id : null);
    const canF = late.find(f => f.id == F.cancelFlight) ? +F.cancelFlight : (late[0] ? late[0].id : null);
    const spareFor = fid => { const f = R().flights[fid]; return freeSp.slice().sort((a, b) => net.dist(a.base, f.orig) - net.dist(b.base, f.orig))[0]; };
    const flOpts = (sel) => late.map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${f.num} ${f.orig}→${f.dest} · ${hhmm(f.std)} · +${Math.round(f.adep - f.std)}m</option>`).join('');
    const gAp = g('gdpAp', wx), hAp = g('holdAp', 'ALL'), hMin = +g('holdMin', 20), fAp = g('ftAp', wx), sAp = g('surgeAp', wx === 'ALL' ? 'DEL' : wx);
    const sp = swapF != null ? spareFor(swapF) : null;
    const plan = S.plan.map(a => { const d = describe(a); return `<div class="card act"><h5><span>${d.icon} ${esc(d.title)}</span><button class="x-btn" data-act="delAct" data-id="${a.id}" title="Remove">✕</button></h5><p style="margin:0">from ${hhmm(a.from)} · ${esc(d.detail)}</p></div>`; }).join('');
    const c = R().costs;
    return `
      <div class="card" style="background:#0d2236;border-color:#22506e"><div class="row"><b>Decisions take effect at</b><span class="mono" style="font-size:16px">${hhmm(now)}</span></div>
        <p style="margin:4px 0 0">Pause the clock, choose a measure, and watch the cascade re-compute. Earlier events never change.</p></div>
      <h3>Your plan <span class="tag cost" style="float:right">spend ${inr(c.recovery)}</span></h3>
      ${plan || '<div class="empty">No measures yet.</div>'}
      ${S.plan.length ? '<button class="btn sm danger" data-act="clearPlan">Clear all measures</button>' : ''}
      <h3>Measures</h3>
      <div class="card"><h5>⏱ Ground-delay program</h5><p>Hold flights at their origin when the destination is closed or queuing — saves fuel, avoids holding and diversions.</p>
        <div class="row"><select data-f="gdpAp">${apOptions(gAp, true)}</select><button class="btn sm" data-act="addGdp">Apply</button></div><div style="margin-top:6px">${pv({ type: 'gdp', airport: gAp, from: now })}</div></div>
      <div class="card"><h5>🤝 Hold connections</h5><p>Delay a departure for airborne feeders with 10+ connecting passengers. Trades flight delay for missed connections.</p>
        <div class="row"><select data-f="holdAp">${apOptions(hAp, true)}</select><select data-f="holdMin" style="flex:0 0 78px">${[15, 20, 30, 45].map(m => `<option ${m === hMin ? 'selected' : ''} value="${m}">${m} min</option>`).join('')}</select><button class="btn sm" data-act="addHold">Apply</button></div><div style="margin-top:6px">${pv({ type: 'hold', airport: hAp, mins: hMin, from: now })}</div></div>
      <div class="card"><h5>⚡ Fast turnarounds</h5><p>Extra ground crews cut minimum turn time by 10 min, soaking up delay at that airport. ₹25k per turn used.</p>
        <div class="row"><select data-f="ftAp">${apOptions(fAp, true)}</select><button class="btn sm" data-act="addFt">Apply</button></div><div style="margin-top:6px">${pv({ type: 'fastturn', airport: fAp, from: now, cut: 10 })}</div></div>
      <div class="card"><h5>🛫 Surge operations</h5><p>+25% runway throughput after weather (extra ATC, stands, towing). ₹15 L per airport.</p>
        <div class="row"><select data-f="surgeAp">${apOptions(sAp)}</select><button class="btn sm" data-act="addSurge">Apply</button></div><div style="margin-top:6px">${pv({ type: 'surge', airport: sAp, from: now, pct: 25 })}</div></div>
      <div class="card"><h5>🔁 Swap in a spare aircraft ${sp ? `<span class="tag">${freeSp.length} spare${freeSp.length > 1 ? 's' : ''}</span>` : '<span class="tag bad">none left</span>'}</h5><p>A fresh aircraft and crew take over a late flight <b>and the rest of its rotation</b>. Spare repositioning costs extra.</p>
        ${late.length && sp ? `<div class="row"><select data-f="swapFlight">${flOpts(swapF)}</select><button class="btn sm" data-act="addSwap">Swap</button></div>
        <div class="note">Uses ${sp.id} from ${sp.base}${sp.base !== R().flights[swapF].orig ? ' (repositions)' : ''}</div><div style="margin-top:6px">${pv({ type: 'swap', flight: swapF, spare: sp.id, from: now })}</div>` : '<div class="empty">No late upcoming flights / spares.</div>'}</div>
      <div class="card"><h5>✂ Cancel a rotation</h5><p>Cancel a doomed flight early and every flight until the aircraft is back where it started. Passengers are re-protected before they reach the airport.</p>
        ${late.length ? `<div class="row"><select data-f="cancelFlight">${flOpts(canF)}</select><button class="btn sm danger" data-act="addCancel">Cancel</button></div><div style="margin-top:6px">${pv({ type: 'cancel', flight: canF, from: now })}</div>` : '<div class="empty">No late upcoming flights.</div>'}</div>
      <div class="card"><h5>👨‍✈️ Extend crew duty</h5><p>+2 h flight-duty limit. Prevents the evening flights of long-delayed crews from being cancelled. ₹90k per flight that needs it.</p>
        <div class="row"><button class="btn sm" data-act="addCrew" ${has('crew') ? 'disabled' : ''}>${has('crew') ? 'Active' : 'Apply'}</button>${has('crew') ? '' : pv({ type: 'crew', from: now, extra: 120 })}</div></div>
      <div class="card"><h5>🎫 Auto-rebook & passenger care</h5><p>Re-accommodate passengers on the next seats instead of leaving them in the queue. ₹2,500 per passenger.</p>
        <div class="row"><button class="btn sm" data-act="addRebook" ${has('rebook') ? 'disabled' : ''}>${has('rebook') ? 'Active' : 'Apply'}</button>${has('rebook') ? '' : pv({ type: 'rebook', from: now })}</div></div>`;
  }

  function advisorHtml() {
    const A = S.advice, o = O();
    const head = `<div class="card" style="background:#0d2236;border-color:#22506e"><h5>🧭 Recovery advisor</h5><p style="margin:0">Re-simulates every measure against the live plan at <b class="mono">${hhmm(S.now)}</b> and ranks them by how much <b>real delay and disruption</b> they remove — not by money.</p></div>
      <h3>Optimise for</h3>${objChips()}
      <div class="note" style="margin:4px 0 10px">${S.objective === 'pax' ? 'Total hours passengers lose, including people left overnight.' : S.objective === 'flights' ? 'Aircraft-hours of arrival delay; a cancelled flight counts as 6 h.' : 'Number of people who cannot be re-accommodated today.'}</div>
      <div class="row" style="margin-bottom:10px"><button class="btn primary" data-act="analyse">Analyse at ${hhmm(S.now)}</button><button class="btn" data-act="autoopt" title="Greedily applies the best measure up to 6 times">Auto-optimise</button></div>`;
    if (!A || A.mode !== S.objective) return head + '<div class="empty">Run the analysis to get ranked recommendations.</div>';
    const stale = A.stale ? '<div class="note" style="color:#fbbf24">Plan changed since this analysis — re-run for fresh numbers.</div>' : '';
    const items = A.items.slice(0, 9).map((it, i) => `<div class="card">
      <h5><span>#${i + 1} ${esc(it.label)}</span></h5>
      <div class="row"><span class="tag good">−${objVal(it.gain)} ${o.unit}</span>
        ${S.objective !== 'pax' && it.paxMin > 600 ? `<span class="tag">−${num(it.paxMin / 60)} pax-h</span>` : ''}${S.objective !== 'flights' && it.delayMin > 10 ? `<span class="tag">−${num(it.delayMin / 60)} aircraft-h</span>` : ''}${it.cancels > 0 ? `<span class="tag">−${it.cancels} cancels</span>` : it.cancels < 0 ? `<span class="tag bad">+${-it.cancels} cancels</span>` : ''}${S.objective !== 'stranded' && it.stranded > 5 ? `<span class="tag">−${num(it.stranded)} stranded</span>` : ''}${it.spend > 20000 ? `<span class="tag" title="Resources committed (reference only)">spend ${inr(it.spend)}</span>` : ''}
        <span class="grow"></span><button class="btn sm" data-act="applyAdvice" data-i="${i}">Apply</button></div></div>`).join('');
    return head + `<div class="note" style="margin:0 0 8px">Analysed at ${hhmm(A.at)} · current plan: ${objVal(A.baseObj)} ${o.unit}</div>` + stale + (items || '<div class="empty">Nothing improves this objective further — nice work.</div>');
  }

  // =====================================================================
  //  RIGHT PANEL
  // =====================================================================
  function initRight() {
    $('#rightBody').innerHTML = `
      <div id="scoreBox"></div>
      <div id="kpiBox" class="kpis"></div>
      <h3>Delay build-up through the day</h3>
      <div class="sw" id="chartSw"><button data-m="pax" class="on">Passenger-hours</button><button data-m="delay">Aircraft-min</button><button data-m="cancelled">Cancellations</button></div>
      <canvas class="chart" id="chart"></canvas>
      <h3>Standings</h3>
      <div class="sw" id="standSw"><button data-s="airports" class="on">Airports</button><button data-s="carriers">Carriers</button></div>
      <div class="row" style="margin-bottom:6px" id="standSortRow"><span class="tag">Sort</span><div class="chips" id="standSort"><button data-o="worst" class="on">Most affected</button><button data-o="best">Best first</button></div></div>
      <div id="standBox"></div>`;
  }
  function scoreData() {
    const mode = S.objective, o = DS.OBJ[mode], B = S.res.base, P = R(), C = S.res.clear;
    const ob = DS.objective(B, mode), op = DS.objective(P, mode), oc = DS.objective(C, mode);
    const dmg = ob - oc, saved = ob - op, pct = dmg > 1e-6 ? Math.max(-100, Math.min(100, saved / dmg * 100)) : 0;
    let grade = 'none';
    if (S.plan.length && S.weather.length) grade = pct >= 60 ? 'S' : pct >= 40 ? 'A' : pct >= 25 ? 'B' : pct >= 10 ? 'C' : 'D';
    return { mode, o, ob, op, oc, dmg, saved, pct, grade,
      paxH: (B.pax.paxMin - P.pax.paxMin) / 60, acH: (B.costs.counts.delayMin - P.costs.counts.delayMin) / 60,
      canc: B.costs.counts.cancels - P.costs.counts.cancels, strand: B.pax.stranded - P.pax.stranded, costs: P.costs };
  }
  function updateScore() {
    const d = scoreData(), o = d.o;
    const sgn = (v, unit, dec) => `<span style="color:${v > 0.5 ? 'var(--ok)' : v < -0.5 ? 'var(--bad)' : 'var(--muted)'}">${v > 0.5 ? '−' : v < -0.5 ? '+' : '±'}${num(Math.abs(v))}${unit}</span>`;
    const txt = d.grade === 'none' ? (S.weather.length ? 'Pick measures to cut the damage' : 'Plant a problem to start') : `${Math.round(d.pct)}% of the weather damage recovered`;
    setHtml($('#scoreBox'), `<div class="score"><div class="grade ${d.grade}">${d.grade === 'none' ? '–' : d.grade}</div><div>
      <small>${o.label} · full day</small><div class="big">${objVal(d.op)} <span style="font-size:12px;color:var(--muted)">${o.unit}</span></div>
      <small>Do nothing: <b>${objVal(d.ob)}</b> · Clear day: ${objVal(d.oc)}</small>
      <small style="color:${d.saved >= 0 ? 'var(--ok)' : 'var(--bad)'};margin-top:2px">${txt}</small></div></div>
      <div class="row" style="margin:8px 0 2px"><span class="tag">Optimise for</span>${objChips()}</div>
      <div class="subscore"><div>Passengers ${sgn(d.paxH, ' h')}</div><div>Aircraft ${sgn(d.acH, ' h')}</div><div>Cancels ${sgn(d.canc, '')}</div><div>Stranded ${sgn(d.strand, '')}</div></div>
      <div class="note" style="margin:2px 0 0">vs. doing nothing. Resources committed: ${S.plan.length ? `${S.plan.length} measure${S.plan.length > 1 ? 's' : ''} · ${inr(d.costs.recovery)}` : 'none'}</div>`);
    setHtml($('#hdrScore'), `<div class="grade ${d.grade}" style="width:38px;height:38px;font-size:20px;border-radius:9px">${d.grade === 'none' ? '–' : d.grade}</div><div style="line-height:1.15"><small style="color:var(--muted)">${o.short} vs no action</small><div class="mono" style="font-weight:700">${d.grade === 'none' ? '—' : (d.saved >= 0 ? '−' : '+') + objVal(Math.abs(d.saved)) + ' ' + (S.objective === 'pax' ? 'pax-h' : S.objective === 'flights' ? 'ac-h' : 'ppl')}</div></div>`);
  }
  function updateKpis() {
    const m = M(), b = MB(), has = S.plan.length > 0;
    const at = attributionAt(R(), S.now), wx = at.weather + at.airborne, kn = at.reactionary, share = wx + kn > 0 ? kn / (wx + kn) : 0;
    const k = (label, v, base, fmt, lowerBetter) => {
      let em = '';
      if (base == null) em = '<em>&nbsp;</em>';
      else if (has) { const d = v - base; if (Math.abs(d) >= 0.5 || fmt === 'pct') { const better = lowerBetter ? d < 0 : d > 0; em = `<em class="${better ? 'good' : d === 0 ? '' : 'bad'}">${d > 0 ? '+' : '−'}${fmt === 'pct' ? Math.abs(d * 100).toFixed(1) + ' pts' : num(Math.abs(d))} vs none</em>`; } else em = '<em>= no action</em>'; } else em = '<em>&nbsp;</em>';
      return `<div class="kpi"><small>${label}</small><b>${fmt === 'pct' ? (v * 100).toFixed(1) + '%' : num(v)}</b>${em}</div>`;
    };
    setHtml($('#kpiBox'), k('On-time', m.otp, b.otp, 'pct', false) + k('Pax delay h', m.paxDelayMin / 60, b.paxDelayMin / 60, 'n', true) + k('Aircraft h', m.delayMin / 60, b.delayMin / 60, 'n', true)
      + k('Cancelled', m.cancelled, b.cancelled, 'n', true) + k('Diverted', m.diverted, b.diverted, 'n', true) + k('Stranded', m.stranded, b.stranded, 'n', true)
      + k('Missed conn.', m.missedPax, b.missedPax, 'n', true) + k('Flights late', m.delayed, b.delayed, 'n', true)
      + `<div class="kpi" title="Share of weather-driven delay that is late-aircraft knock-on, not the storm itself"><small>Knock-on</small><b>${Math.round(share * 100)}%</b><em>${share > 0.5 ? 'cascade-driven' : 'storm-driven'}</em></div>`);
  }
  function drawChart() {
    const cv = $('#chart'); if (!cv || !S.ser.base) return;
    const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const key = S.chartMetric, L = 34, Rr = 8, Tp = 10, B = 20;
    const series = { clear: S.ser.clear[key], base: S.ser.base[key], plan: S.ser.plan[key] };
    let ymax = Math.max(1, ...series.base, ...series.plan, ...series.clear) * 1.08;
    const x = t => L + (t - T0) / (T1 - T0) * (W - L - Rr), y = v => H - B - v / ymax * (H - B - Tp);
    const tc = TC(); ctx.font = '10px ui-monospace,monospace'; ctx.fillStyle = tc.axis; ctx.strokeStyle = tc.grid; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const v = ymax * i / 4, yy = y(v); ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - Rr, yy); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v), L - 4, yy + 3); }
    ctx.textAlign = 'center'; for (let h = Math.ceil(T0 / 240) * 4; h <= 30; h += 4) { ctx.fillText(String(h % 24).padStart(2, '0'), x(h * 60), H - 6); }
    S.weather.forEach(e => { ctx.fillStyle = tc.band; ctx.fillRect(x(e.start), Tp, x(Math.min(T1, e.start + e.dur)) - x(e.start), H - B - Tp); });
    const line = (arr, col, w, dash) => { ctx.beginPath(); ctx.setLineDash(dash || []); S.ser.base.t.forEach((t, i) => { i ? ctx.lineTo(x(t), y(arr[i])) : ctx.moveTo(x(t), y(arr[i])); }); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]); };
    line(series.clear, tc.clear, 1.5, [4, 4]); line(series.base, '#f87171', 2);
    if (S.plan.length) { ctx.save(); ctx.lineJoin = 'round'; line(series.plan, '#22d3ee', 2.4); ctx.restore(); }
    const nx = x(S.now); ctx.strokeStyle = tc.nowLine; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nx, Tp); ctx.lineTo(nx, H - B); ctx.stroke();
    const i = Math.max(0, Math.min(S.ser.base.t.length - 1, Math.round((S.now - T0) / 10)));
    [['base', '#f87171'], ['plan', '#22d3ee']].forEach(([k2, c]) => { if (k2 === 'plan' && !S.plan.length) return; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(nx, y(series[k2][i]), 3.5, 0, 7); ctx.fill(); });
    ctx.textAlign = 'left'; ctx.font = '10.5px system-ui'; let lx = L + 6;
    [['Clear day', tc.clear], ['No action', '#f87171'], ['Your plan', '#22d3ee']].forEach(([t, c]) => { if (t === 'Your plan' && !S.plan.length) return; ctx.fillStyle = c; ctx.fillRect(lx, Tp + 3, 10, 3); ctx.fillStyle = tc.legend; ctx.fillText(t, lx + 14, Tp + 8); lx += ctx.measureText(t).width + 28; });
  }
  function updateStandings() {
    const now = S.now, isAir = S.rstab === 'airports';
    $('#standSortRow').classList.toggle('hidden', !isAir);
    let html;
    if (isAir) {
      const rows = DS.airportStandings(net, R(), now).filter(r => r.dep > 0);
      rows.sort((a, b) => S.standSort === 'worst' ? (b.avg - a.avg) || (a.otp - b.otp) : (a.avg - b.avg) || (b.otp - a.otp));
      html = `<table><tr><th>#</th><th>Airport</th><th>On-time</th><th class="r">Avg</th><th class="r">Canc</th><th class="r">Queue</th></tr>` + rows.map((r, i) => `<tr class="click ${S.sel.airport === r.code ? 'sel' : ''}" data-act="selAp" data-code="${r.code}">
        <td class="r">${i + 1}</td><td><b>${r.code}</b> <span style="color:var(--muted)">${esc(r.city.slice(0, 9))}</span></td>
        <td><div class="bar"><i style="width:${r.otp * 100}%;background:${r.otp > 0.85 ? '#34d399' : r.otp > 0.65 ? '#fbbf24' : '#f87171'}"></i></div></td>
        <td class="r" style="color:${dcol(r.avg)}">${Math.round(r.avg)}m</td><td class="r">${r.cancelled || ''}</td><td class="r" style="color:${r.queue ? '#f87171' : ''}">${r.queue || ''}</td></tr>`).join('') + '</table>';
    } else {
      const rows = DS.carrierStandings(net, R(), now).sort((a, b) => b.otp - a.otp);
      html = `<table><tr><th>#</th><th>Carrier</th><th>On-time</th><th class="r">Avg</th><th class="r">Canc</th></tr>` + rows.map((r, i) => `<tr><td class="r">${i + 1}</td><td><span style="color:${r.color}">●</span> <b>${r.code}</b> ${esc(r.name)}</td>
        <td><div class="bar"><i style="width:${r.otp * 100}%;background:${r.color}"></i></div><div class="mono" style="font-size:10.5px;color:var(--muted)">${(r.otp * 100).toFixed(0)}%</div></td><td class="r" style="color:${dcol(r.avg)}">${Math.round(r.avg)}m</td><td class="r">${r.cancelled || ''}</td></tr>`).join('') + '</table>';
    }
    setHtml($('#standBox'), html);
  }

  // =====================================================================
  //  BOTTOM PANEL
  // =====================================================================
  function renderBottomShell() {
    $$('#botTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.btab));
    const el = $('#botBody'); lastHtml = new WeakMap(); ganttHits = [];
    if (S.btab === 'gantt') {
      el.style.padding = '0';
      el.innerHTML = `<div class="ganttwrap" id="ganttWrap"><canvas id="ganttHead" style="position:sticky;top:0;z-index:2"></canvas><canvas id="ganttCv"></canvas></div>`;
      $('#botExtra').innerHTML = `<div class="chips" id="gMode"><button data-g="full" class="${S.gantt.mode === 'full' ? 'on' : ''}">Full day</button><button data-g="focus" class="${S.gantt.mode === 'focus' ? 'on' : ''}">Follow clock</button></div>
        <div class="chips" id="gSort"><button data-s="base" class="${S.gantt.sort === 'base' ? 'on' : ''}">By base</button><button data-s="worst" class="${S.gantt.sort === 'worst' ? 'on' : ''}">Most delayed</button></div>`;
      bindGantt();
    } else {
      el.style.padding = ''; $('#botExtra').innerHTML = '';
      el.innerHTML = '<div id="botInner"></div>';
    }
    updateBottom(true);
  }
  let ganttHits = [];
  function bindGantt() {
    const cv = $('#ganttCv');
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const h = ganttHits.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      if (!h) { hideTip(); cv.style.cursor = 'default'; return; }
      cv.style.cursor = 'pointer'; showTip(flightTip(h.id), e.clientX, e.clientY);
    });
    cv.addEventListener('mouseleave', hideTip);
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const h = ganttHits.find(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      if (h) selectFlight(h.id);
      else { const row = ganttRows[Math.floor((y - 2) / 17)]; if (row) { S.sel.tail = row.id; S.sel.flight = null; renderLiveSoon(); } }
    });
  }
  let ganttRows = [];
  function drawGantt() {
    const wrap = $('#ganttWrap'), cv = $('#ganttCv'), hd = $('#ganttHead'); if (!wrap || !cv) return;
    const res = R(), dpr = devicePixelRatio || 1;
    let rows = Object.values(res.tails).filter(t => t.chain.length).map(t => {
      const L = t.chain.map(i => res.flights[i]); const mx = Math.max(0, ...L.map(f => f.status === 'ok' ? f.aarr - f.sta : 150));
      return { id: t.id, chain: L, base: net.tails.find(x => x.id === t.id).base, worst: mx, airline: L[0].airline };
    });
    rows.sort(S.gantt.sort === 'worst' ? (a, b) => b.worst - a.worst : (a, b) => a.base.localeCompare(b.base) || a.id.localeCompare(b.id));
    ganttRows = rows;
    const W = wrap.clientWidth - 1, rowH = 17, left = 76, HH = 22, H = rows.length * rowH + 4;
    if (W < 50) return;
    const [t0, t1] = S.gantt.mode === 'full' ? [T0, T1] : [Math.max(T0, S.now - 120), Math.min(T1, S.now + 480)];
    const x = t => left + (t - t0) / (t1 - t0) * (W - left - 6);
    [[cv, H], [hd, HH]].forEach(([c, h]) => { if (c.width !== Math.round(W * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(h * dpr); c.style.width = W + 'px'; c.style.height = h + 'px'; } });
    const ctx = cv.getContext('2d'), hx = hd.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H); hx.clearRect(0, 0, W, HH);
    const tc = TC(); hx.fillStyle = tc.head; hx.fillRect(0, 0, W, HH); hx.font = '10.5px ui-monospace,monospace'; hx.textAlign = 'center'; hx.fillStyle = tc.headTxt;
    const stepH = (t1 - t0) > 900 ? 2 : 1;
    ctx.strokeStyle = tc.grid; ctx.lineWidth = 1;
    for (let h = Math.ceil(t0 / 60); h * 60 <= t1; h += 1) { const xx = x(h * 60); if (h % stepH === 0) { hx.fillText(String(h % 24).padStart(2, '0') + ':00', xx, 15); } ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, H); ctx.stroke(); }
    hx.strokeStyle = tc.headLine; hx.beginPath(); hx.moveTo(0, HH - .5); hx.lineTo(W, HH - .5); hx.stroke();
    S.weather.forEach(e => { const a = x(Math.max(t0, e.start)), b = x(Math.min(t1, e.start + e.dur)); if (b > a) { ctx.fillStyle = tc.band; ctx.fillRect(a, 0, b - a, H); hx.fillStyle = tc.bandHead; hx.fillRect(a, HH - 4, b - a, 3); } });
    ganttHits = [];
    const selTail = S.sel.tail || (S.sel.flight != null ? res.flights[S.sel.flight].tail : null);
    ctx.font = '10px ui-monospace,monospace';
    rows.forEach((row, r) => {
      const y = 2 + r * rowH;
      if (row.id === selTail) { ctx.fillStyle = tc.selRow; ctx.fillRect(0, y - 1, W, rowH); } else if (r % 2) { ctx.fillStyle = tc.rowAlt; ctx.fillRect(0, y - 1, W, rowH); }
      ctx.textAlign = 'left'; ctx.fillStyle = row.id === selTail ? tc.txtSel : tc.txt; ctx.fillText(row.id.slice(row.id.indexOf('-') + 1) + ' ' + row.base, 4, y + 11);
      ctx.fillStyle = (net.airlines.find(a => a.code === row.airline) || {}).color || '#888'; ctx.fillRect(left - 8, y + 3, 3, 9);
      row.chain.forEach(f => {
        const sx0 = x(f.std), sx1 = x(f.sta);
        if (sx1 < left || sx0 > W) return;
        if (f.status === 'cancelled') {
          ctx.fillStyle = 'rgba(248,113,113,.08)'; ctx.fillRect(sx0, y + 3, sx1 - sx0, 10); ctx.strokeStyle = 'rgba(248,113,113,.7)'; ctx.setLineDash([3, 3]); ctx.strokeRect(sx0 + .5, y + 3.5, sx1 - sx0 - 1, 9); ctx.setLineDash([]);
          if (sx1 - sx0 > 18) { ctx.fillStyle = '#f87171'; ctx.textAlign = 'center'; ctx.fillText('✕', (sx0 + sx1) / 2, y + 11.5); }
          ganttHits.push({ id: f.id, x0: sx0, x1: sx1, y0: y + 2, y1: y + 14 }); return;
        }
        ctx.fillStyle = tc.sliver; ctx.fillRect(sx0, y + 1, sx1 - sx0, 2);   // scheduled sliver
        const a0 = x(f.adep), a1 = x(f.aarr), fut = f.adep > S.now, d = f.aarr - f.sta;
        const col = S.colorMode === 'gen' ? DS.colGen(f.gen) : dcol(d);
        ctx.globalAlpha = fut ? 0.5 : 1; ctx.fillStyle = col; ctx.fillRect(a0, y + 4, Math.max(2, (f.eta != null ? x(f.eta) : a1) - a0), 9);
        if (f.aarr > f.eta + 1) { ctx.fillStyle = '#fb923c'; ctx.globalAlpha = (fut ? 0.5 : 1) * 0.65; ctx.fillRect(x(f.eta), y + 6, Math.max(1, a1 - x(f.eta)), 5); }
        ctx.globalAlpha = 1;
        if (f.divert) { ctx.fillStyle = '#c4b5fd'; ctx.beginPath(); const dx = x(f.divArr); ctx.moveTo(dx, y + 2); ctx.lineTo(dx + 4, y + 8); ctx.lineTo(dx, y + 14); ctx.lineTo(dx - 4, y + 8); ctx.fill(); }
        if (f.adep - f.std > 2) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.moveTo(sx0, y + 8.5); ctx.lineTo(a0, y + 8.5); ctx.stroke(); }
        if (S.sel.flight === f.id) { ctx.strokeStyle = tc.selOutline; ctx.lineWidth = 1.5; ctx.strokeRect(a0 - .5, y + 3.5, Math.max(3, a1 - a0), 10); ctx.lineWidth = 1; }
        if (a1 - a0 > 30) { ctx.fillStyle = '#06101f'; ctx.textAlign = 'center'; ctx.fillText(f.dest, (a0 + Math.min(a1, x(f.eta))) / 2, y + 12); }
        ganttHits.push({ id: f.id, x0: Math.min(sx0, a0), x1: Math.max(a1, sx1), y0: y + 1, y1: y + 14 });
      });
    });
    if (S.now >= t0 && S.now <= t1) {
      const nx = x(S.now); ctx.strokeStyle = tc.nowLine; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(nx, 0); ctx.lineTo(nx, H); ctx.stroke();
      hx.fillStyle = tc.nowBg; hx.fillRect(nx - 19, 1, 38, 13); hx.fillStyle = tc.nowTxt; hx.font = '600 10px ui-monospace,monospace'; hx.fillText(hhmm(S.now), nx, 11);
    }
  }
  function flightTip(id) {
    const f = R().flights[id], st = statusOf(f, S.now);
    if (f.status === 'cancelled') return `<b>${f.num}</b> ${f.orig}→${f.dest} <span class="pill cancel">Cancelled</span><br><span style="color:var(--muted)">${esc(causeOf(f))}</span><br>Tail ${f.tail}`;
    const d = f.aarr - f.sta;
    return `<b>${f.num}</b> ${f.orig}→${f.dest} <span class="pill ${st.k}">${st.text}</span><br>
      STD ${hhmm(f.std)} → <b>${hhmm(f.adep)}</b> (${f.adep - f.std >= 0.5 ? '+' + Math.round(f.adep - f.std) : 'on time'})<br>STA ${hhmm(f.sta)} → <b>${hhmm(f.aarr)}</b> (${d > 0.5 ? '+' + Math.round(d) : 'on time'})<br>
      Tail ${f.tail}${f.gen >= 0 ? ` · domino gen <b>${f.gen}</b>` : ''}<br><span style="color:var(--muted)">${esc(causeOf(f))}</span>`;
  }

  let lastFixT = 0;
  const rootName = r => r === 'en-route' ? 'En-route detours' : r === 'other' ? 'Other / unattributed' : (AP[r] ? r + ' · ' + AP[r].city : r);
  function fixEval(risks) {
    const key = [Math.round(S.now / 5), S.plan.map(a => a.id).join(','), S.objective, JSON.stringify(S.weather.map(e => [e.id, +e.lat.toFixed(2), +e.lon.toFixed(2), e.start, e.dur, e.severity, e.radius]))].join('|');
    if (S.fixCache.key !== key) {
      if (S.playing && S.fixCache.opts) return S.fixCache.opts;          // keep the last evaluation while the clock runs
      const opts = {}; risks.slice(0, 6).forEach(r => { opts[r.id] = DS.fixOptions(net, S.weather, S.plan, S.now, r.id, S.objective, R()); });
      S.fixCache = { key, opts };
    }
    return S.fixCache.opts;
  }
  function fixHtml() {
    const res = R(), now = S.now, dg = DS.diagnose(net, res, now), o = O();
    if (!S.weather.length) return '<div class="empty">Plant a problem to see where the damage comes from.</div>';
    const tot = dg.direct + dg.knock;
    if (tot < 600) return '<div class="empty">No disruption yet — press play, or move the clock past the first problem.</div>';
    const knockShare = Math.round(dg.knock / tot * 100);
    const rootRows = dg.roots.slice(0, 6).map(r => `<tr class="click" ${AP[r.root] ? `data-act="selAp" data-code="${r.root}"` : ''}>
      <td><b>${esc(rootName(r.root))}</b></td>
      <td style="width:38%"><div class="bar" style="height:10px;display:flex"><i style="width:${r.direct / tot * 100 * 2.2}%;background:#a78bfa" title="direct"></i><i style="width:${r.knock / tot * 100 * 2.2}%;background:#ef4444" title="knock-on"></i></div></td>
      <td class="r">${num(r.total / 60)} h</td><td class="r">${Math.round(r.total / tot * 100)}%</td><td class="r" style="color:var(--muted)">${r.flights + r.cancels} flt${r.cancels ? ' · ' + r.cancels + '✕' : ''}</td></tr>`).join('');
    const top = dg.roots[0];
    // bottlenecks right now
    const bn = net.airports.map(a => {
      let wait = 0, hold = 0; res.flights.forEach(f => { if (f.status !== 'ok') return; if (f.orig === a.code && f.std <= now && f.adep > now) wait++; if (f.dest === a.code && !f.divert && f.eta <= now && f.aarr > now) hold++; });
      const fac = DS.wxFactor(S.weather, a.code, now); return { a, wait, hold, fac };
    }).filter(x => x.wait + x.hold > 0 || x.fac < 1).sort((x, y) => (y.wait + y.hold) - (x.wait + x.hold)).slice(0, 6);
    const bnRows = bn.map(x => `<tr class="click" data-act="selAp" data-code="${x.a.code}"><td><b>${x.a.code}</b> ${esc(x.a.city)}</td><td>${x.fac === 0 ? '<span class="pill bad">closed</span>' : x.fac < 1 ? `<span class="pill warn">${Math.round(x.fac * 100)}% cap</span>` : '<span class="pill ok">open</span>'}</td><td class="r" style="color:${x.wait ? '#f87171' : ''}">${x.wait || ''}</td><td class="r" style="color:${x.hold ? '#fb923c' : ''}">${x.hold || ''}</td></tr>`).join('');
    // next dominoes
    const opts = fixEval(dg.risks);
    const riskRows = dg.risks.slice(0, 8).map(r => {
      const f = res.flights[r.id], ops = opts[r.id], best = ops && ops[0] && ops[0].gain > o.eps ? ops[0] : null;
      const fix = !ops ? `<button class="btn sm" data-act="fixSwap" data-id="${r.id}">Swap</button> <button class="btn sm danger" data-act="fixCancel" data-id="${r.id}">Cancel</button>`
        : best ? `<span class="tag good">${esc(best.label.replace('Swap in spare ', 'Spare ').replace('Cancel rotation', 'Cancel rotation'))} · −${objVal(best.gain)} ${unitS()}</span> <button class="btn sm" data-act="applyFix" data-id="${r.id}" data-k="0">Apply</button>`
        : '<span class="tag">no measure helps — let it ride</span>';
      return `<tr><td class="click" data-act="selFl" data-id="${r.id}"><b>${f.num}</b> ${f.orig}→${f.dest}</td><td class="r">${hhmm(f.std)}</td><td class="r" style="color:${dcol(r.delay)}">+${Math.round(r.delay)}m</td>
        <td class="r" style="color:${r.slack != null && r.slack < 5 ? '#f87171' : 'var(--muted)'}">${r.slack == null ? '—' : r.slack < 5 ? 'none' : Math.round(r.slack) + 'm'}</td><td class="r">${r.kF ? r.kF + ' flt · ' + num(r.kPax / 60) + ' h' : '—'}</td><td>${fix}</td></tr>`;
    }).join('');
    return `<div class="two" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr)">
      <div><h3 style="margin-top:0">Where the damage comes from <span class="tag">${num(tot / 60)} pax-hours of delay traced</span></h3>
        <table style="table-layout:auto"><tr><th>Root cause</th><th title="purple = hit directly by the problem, red = late only because the aircraft was late"><span style="color:#a78bfa">■</span> direct · <span style="color:#ef4444">■</span> knock-on</th><th class="r">Pax-h</th><th class="r">Share</th><th class="r">Flights</th></tr>${rootRows}</table>
        <div class="note" style="color:var(--text);margin-top:6px"><b>${knockShare}%</b> of this delay is knock-on — flights late only because their <i>aircraft</i> was late. ${top ? `<b>${esc(rootName(top.root))}</b> alone is the origin of ${Math.round(top.total / tot * 100)}%. ` : ''}Breaking aircraft chains (spare swap, ground hold) attacks the knock-on part; runway and queue measures attack the direct part.</div>
        ${bnRows ? `<h3>Bottlenecks right now</h3><table><tr><th>Airport</th><th>Status</th><th class="r">Waiting to depart</th><th class="r">Holding to land</th></tr>${bnRows}</table>` : ''}</div>
      <div><h3 style="margin-top:0">Next dominoes to fall <span class="tag">from ${hhmm(now)}</span></h3>
        ${riskRows ? `<div style="overflow-x:auto"><table><tr><th>Flight</th><th class="r">STD</th><th class="r">Late</th><th class="r" title="Scheduled turnaround buffer left after this flight, before the next one is affected">Buffer</th><th class="r" title="Later flights on this aircraft dragged down">Drags down</th><th>Best fix (measured)</th></tr>${riskRows}</table></div>
        <div class="note">${S.playing ? 'Pause the clock to re-measure each fix.' : 'Each fix is simulated against the whole day and scored on <b>' + o.label.toLowerCase() + '</b>.'}</div>` : '<div class="empty">No upcoming flight is predicted more than 20 min late.</div>'}</div></div>`;
  }

  function updateBottom(force) {
    if (S.btab === 'gantt') { drawGantt(); return; }
    const el = $('#botInner'); if (!el) return;
    if (S.btab === 'board') boardView(el, force);
    else if (S.btab === 'fix') { if (!S.playing || performance.now() - lastFixT > 1000 || force) { lastFixT = performance.now(); setHtml(el, fixHtml()); } }
    else if (S.btab === 'cascade') setHtml(el, cascadeHtml());
    else if (S.btab === 'pax') setHtml(el, paxHtml());
  }
  function boardView(el, force) {
    if (!el.querySelector('#boardTbl')) {
      el.innerHTML = `<div class="tools"><div class="chips" id="bFilter">${[['active', 'Around now'], ['delayed', 'Delayed'], ['cancelled', 'Cancelled'], ['diverted', 'Diverted'], ['all', 'All']].map(([k, l]) => `<button data-b="${k}" class="${S.board.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <input type="search" id="bQ" placeholder="Search flight / airport / tail" value="${esc(S.board.q)}"><span id="bCount" style="color:var(--muted)"></span></div><div id="boardTbl"></div>`;
      lastHtml = new WeakMap();
    }
    const now = S.now, q = S.board.q.trim().toUpperCase(), res = R();
    let L = res.flights.filter(f => {
      if (q && !(f.num + f.orig + f.dest + f.tail).toUpperCase().includes(q)) return false;
      if (S.sel.airport && S.board.filter === 'active' && f.orig !== S.sel.airport && f.dest !== S.sel.airport) return false;
      switch (S.board.filter) {
        case 'delayed': return f.status === 'ok' && (now >= f.std || f.adep <= now) && ((f.adep <= now ? f.adep - f.std : now - f.std) > 15);
        case 'cancelled': return f.status === 'cancelled' && Math.min(f.cancelAt == null ? f.std : f.cancelAt, f.std) <= now;
        case 'diverted': return f.divert && f.eta <= now;
        case 'active': return f.std >= now - 60 && f.std <= now + 150 || (f.status === 'ok' && f.adep <= now && f.aarr > now);
        default: return true;
      }
    }).sort((a, b) => a.std - b.std);
    const total = L.length; L = L.slice(0, 220);
    $('#bCount').textContent = total + ' flights';
    const rows = L.map(f => {
      const st = statusOf(f, now), dly = f.status === 'ok' ? f.adep - f.std : 0;
      return `<tr class="click ${S.sel.flight === f.id ? 'sel' : ''}" data-act="selFl" data-id="${f.id}"><td><b>${f.num}</b></td><td>${f.orig}→${f.dest}</td><td style="color:var(--muted)">${f.tail.slice(3)}</td>
        <td class="r">${hhmm(f.std)}</td><td class="r" style="color:${f.status === 'ok' ? dcol(dly) : 'var(--cancel)'}">${f.status === 'ok' ? hhmm(f.adep) : '—'}</td><td class="r">${f.status === 'ok' && dly >= 1 ? '+' + Math.round(dly) : ''}</td>
        <td><span class="pill ${st.k}">${st.text}</span></td><td style="color:var(--muted);font-size:11.5px">${esc(causeOf(f))}</td></tr>`;
    }).join('');
    setHtml($('#boardTbl'), `<table><tr><th>Flight</th><th>Route</th><th>Tail</th><th class="r">STD</th><th class="r">ETD</th><th class="r">Delay</th><th>Status</th><th>Cause</th></tr>${rows}</table>`);
  }

  function attributionAt(res, t) {
    const a = { weather: 0, airborne: 0, reactionary: 0, congestion: 0, measures: 0, minor: 0 };
    res.flights.forEach(f => {
      if (f.status !== 'ok' || f.adep > t) return;
      if (f.slotWx) a.weather += f.slot; else a.congestion += f.slot;
      a.reactionary += f.react; a.measures += f.hold + f.gdp; a.minor += f.noise;
      if (f.eta <= t) { if (f.airWx) a.airborne += f.airHold; else a.congestion += f.airHold; a.airborne += f.detour; }
    });
    return a;
  }
  function cascadeHtml() {
    const res = R(), now = S.now;
    const tail = S.sel.tail || (S.sel.flight != null ? res.flights[S.sel.flight].tail : S.worstTail);
    let dom = '<div class="empty">Add weather to see dominoes fall.</div>', title = '';
    if (tail && res.tails[tail]) {
      const T = res.tails[tail], tinfo = net.tails.find(x => x.id === tail);
      title = `<b>${tail}</b> · ${tinfo.type} · ${(net.airlines.find(a => a.code === tinfo.airline) || {}).name} · base ${tinfo.base}` + (tail === S.worstTail && !S.sel.tail && S.sel.flight == null ? ' <span class="tag">most knocked-on aircraft</span>' : '');
      dom = '<div class="dominoes">' + T.chain.map(id => {
        const f = res.flights[id];
        if (f.status === 'cancelled') return `<div class="dom cx" data-act="selFl" data-id="${id}"><span class="n">${f.num}</span><span class="r">${f.orig}→${f.dest}<br>${hhmm(f.std)}</span><span class="d">✕ cancel</span></div>`;
        const d = Math.max(0, f.aarr - f.sta), fallen = f.adep <= now, rot = fallen ? Math.min(32, d / 5) : 0;
        const gcol = f.gen >= 0 ? DS.GENCOL[Math.min(f.gen, 4)] : '#34d399';
        return `<div class="dom ${fallen ? '' : 'future'}" data-act="selFl" data-id="${id}" style="transform:rotate(${rot}deg);border-color:${fallen ? dcol(d) : ''}">
          ${f.gen >= 0 ? `<span class="g" style="background:${gcol}">G${f.gen}</span>` : ''}<span class="n">${f.num}</span><span class="r">${f.orig}→${f.dest}<br>${hhmm(f.std)} → ${hhmm(f.adep)}</span><span class="d" style="color:${fallen || d > 0 ? dcol(d) : 'var(--muted)'}">${d >= 1 ? '+' + Math.round(d) + 'm' : 'on time'}</span></div>`;
      }).join('') + '</div>';
    }
    // generations at now
    const gens = []; res.flights.forEach(f => { if (f.status !== 'ok' || f.gen < 0 || f.adep > now) return; const k = Math.min(f.gen, 5); gens[k] = gens[k] || { n: 0, min: 0 }; gens[k].n++; gens[k].min += Math.max(0, (f.aarr <= now ? f.aarr : f.adep + f.block) - f.sta); });
    const gmax = Math.max(1, ...gens.filter(Boolean).map(g => g.min));
    const gh = [0, 1, 2, 3, 4, 5].map(i => { const g = gens[i]; if (!g && i > 1) return ''; g && 0; const v = g ? g.min : 0, n = g ? g.n : 0; return `<tr><td style="width:84px"><span class="pill" style="background:${DS.GENCOL[Math.min(i, 4)]};color:#08101f">${i === 0 ? 'G0 · storm' : 'G' + i + (i === 5 ? '+' : '') + ' · knock-on'}</span></td><td><div class="bar" style="height:10px"><i style="width:${v / gmax * 100}%;background:${DS.GENCOL[Math.min(i, 4)]}"></i></div></td><td class="r">${n} flt</td><td class="r">${num(v)} m</td></tr>`; }).join('');
    const at = attributionAt(res, now); const tot = Object.values(at).reduce((a, b) => a + b, 0) || 1;
    const wx = at.weather + at.airborne, kn = at.reactionary;
    const cols = [['Weather (direct)', wx, '#a78bfa'], ['Knock-on (late aircraft)', kn, '#ef4444'], ['Congestion', at.congestion, '#f59e0b'], ['Your measures', at.measures, '#22d3ee'], ['Minor ops', at.minor, '#475569']];
    const stack = cols.map(c => `<i style="width:${c[1] / tot * 100}%;background:${c[2]}" title="${c[0]}"></i>`).join('');
    const legend = cols.map(c => `<span><i style="background:${c[2]}"></i>${c[0]} <b>${num(c[1])}</b></span>`).join('');
    // reach
    const stormAp = new Set(wxAirports()); const reach = new Set(); let far = 0;
    res.flights.forEach(f => { if (f.status === 'ok' && f.adep <= now && f.adep - f.std > 30 && !stormAp.has(f.orig)) { reach.add(f.orig); S.weather.forEach(e => { far = Math.max(far, DS.hav(e, AP[f.orig])); }); } });
    const share = tot > 1 ? Math.round(kn / (wx + kn || 1) * 100) : 0;
    return `<div class="two"><div><div style="margin-bottom:2px;color:var(--muted)">${title}</div>${dom}<div class="note">Cards lean further the later the flight lands. <b>G0</b> = hit directly by weather; <b>G1, G2…</b> = each later link in the same aircraft's chain. Click a card or a bar to inspect.</div></div>
      <div><div class="row" style="justify-content:space-between"><div><div class="big2" style="color:${share > 50 ? '#f87171' : 'var(--text)'}">${share}%</div><small style="color:var(--muted)">of weather-driven delay is knock-on</small></div>
        <div style="text-align:right"><div class="big2">${reach.size}</div><small style="color:var(--muted)">airports delayed beyond the storm${far ? ' · up to ' + num(far) + ' km away' : ''}</small></div></div>
        <div class="stack">${stack}</div><div class="leg">${legend}</div>
        <h3 style="margin-top:12px">Delay by domino generation</h3><table>${gh || '<tr><td class="empty">No weather impact yet.</td></tr>'}</table></div></div>`;
  }
  function paxHtml() {
    const res = R(), now = S.now, px = res.pax, m = M();
    const ev = px.list.filter(l => l.tEvent <= now);
    const byHub = {}; ev.forEach(l => { if (l.hub) byHub[l.hub] = (byHub[l.hub] || 0) + l.pax; });
    const hubs = Object.entries(byHub).sort((a, b) => b[1] - a[1]).slice(0, 7), hm = Math.max(1, ...hubs.map(h => h[1]));
    const rows = ev.slice(0, 10).map(l => `<tr><td>${esc(l.label)}</td><td class="r">${l.pax}</td><td><span class="pill ${l.kind === 'missed' ? 'orange' : 'bad'}">${l.kind === 'missed' ? 'Missed connection' : 'Flight cancelled'}</span></td>
      <td>${l.stranded > 0 ? `<span class="pill bad">${Math.round(l.stranded)} stranded</span> ` : ''}${l.rebooked > 0 ? `<span class="pill ok">${Math.round(l.rebooked)} rebooked</span>` : ''}</td></tr>`).join('');
    const rebook = S.plan.some(a => a.type === 'rebook');
    const tiles = [['Passengers today', px.total, ''], ['Missed connections', m.missedPax, 'var(--orange)'], ['Rebooked', m.rebooked, 'var(--ok)'], ['Stranded overnight', m.stranded, 'var(--bad)'], ['Total delay (pax-hours)', Math.round(px.paxMin / 60), '']];
    return `<div class="row" style="gap:10px;margin-bottom:10px">${tiles.map(t => `<div class="kpi" style="flex:1;min-width:110px"><small>${t[0]}</small><b style="color:${t[2]}">${num(t[1])}</b></div>`).join('')}
      <div class="kpi" style="flex:1;min-width:150px"><small>Rebooking policy</small><b style="font-size:13px;color:${rebook ? 'var(--ok)' : 'var(--orange)'}">${rebook ? 'Auto-rebook ON' : 'Counter queues'}</b><div style="margin-top:4px">${rebook ? '' : '<button class="btn sm" data-act="addRebook">Enable now</button>'}</div></div></div>
      <div class="two"><div><h3>Worst-hit itineraries so far</h3>${rows ? `<table><tr><th>Journey</th><th class="r">Pax</th><th>Cause</th><th>Outcome</th></tr>${rows}</table>` : '<div class="empty">No broken connections yet.</div>'}</div>
      <div><h3>Passengers disrupted by airport</h3>${hubs.map(([c, v]) => `<div class="row" style="margin:3px 0"><b style="width:36px">${c}</b><div class="bar" style="flex:1;height:10px"><i style="width:${v / hm * 100}%;background:#fb923c"></i></div><span class="mono" style="width:42px;text-align:right">${num(v)}</span></div>`).join('') || '<div class="empty">—</div>'}
      <div class="note">Connections need ${DS.MCT} min. Missed pax are rebooked only if later seats exist; the rest wait overnight (≈14 h).</div></div></div>`;
  }

  // =====================================================================
  //  MAP DETAIL CARD
  // =====================================================================
  function updateDetail() {
    const el = $('#detail'); const res = R(), now = S.now;
    if (S.sel.airport) {
      const a = AP[S.sel.airport], st = (map.st || {})[a.code] || {}, fac = DS.wxFactor(S.weather, a.code, now);
      const next = res.flights.filter(f => f.orig === a.code && f.status === 'ok' && f.std >= now - 20 && f.std <= now + 240).sort((x, y) => x.std - y.std).slice(0, 6);
      const status = fac === 0 ? '<span class="pill bad">CLOSED</span>' : fac < 1 ? `<span class="pill warn">${Math.round(fac * 100)}% capacity</span>` : '<span class="pill ok">Normal ops</span>';
      const html = `<button class="x" data-act="closeDetail">✕</button><h4>${a.code} ${status}</h4><div class="sub">${esc(a.name)}, ${esc(a.city)}</div>
        <dl class="kv"><dt>Runway rate</dt><dd>${Math.round(a.cap * fac)} / ${a.cap} mov/h</dd><dt>Departures waiting</dt><dd style="color:${st.wait ? '#f87171' : ''}">${st.wait || 0}</dd><dt>Inbound airborne</dt><dd>${st.inbound || 0}</dd><dt>Avg dep delay (3h)</dt><dd style="color:${dcol(st.n ? st.sum / st.n : 0)}">${st.n ? Math.round(st.sum / st.n) : 0} min</dd></dl>
        <div style="font-size:11px;color:var(--muted);margin:6px 0 2px">NEXT DEPARTURES</div>
        <table>${next.map(f => `<tr class="click" data-act="selFl" data-id="${f.id}"><td><b>${f.num}</b></td><td>→${f.dest}</td><td class="r">${hhmm(f.std)}</td><td class="r" style="color:${dcol(f.adep - f.std)}">${f.adep - f.std >= 1 ? '+' + Math.round(f.adep - f.std) : '·'}</td></tr>`).join('') || '<tr><td class="empty">No departures soon</td></tr>'}</table>
        <div class="btnrow"><button class="btn sm" data-act="apGdp" data-code="${a.code}">Ground-delay</button><button class="btn sm" data-act="apSurge" data-code="${a.code}">Surge ops</button><button class="btn sm" data-act="apFt" data-code="${a.code}">Fast turns</button><button class="btn sm" data-act="apHold" data-code="${a.code}">Hold conn.</button><button class="btn sm" data-act="apStorm" data-code="${a.code}">⛈ Storm here</button></div>`;
      el.classList.remove('hidden'); setHtml(el, html);
    } else if (S.sel.flight != null) {
      const f = res.flights[S.sel.flight], st = statusOf(f, now), T = res.tails[f.tail];
      const chain = T.chain.map(i => res.flights[i]), pos = chain.indexOf(f);
      const later = chain.slice(pos + 1).filter(x => x.status === 'cancelled' || x.aarr - x.sta > 15).length;
      const future = f.status === 'ok' ? f.adep > now : f.std > now;
      const html = `<button class="x" data-act="closeDetail">✕</button><h4>${f.num} <span class="pill ${st.k}">${st.text}</span></h4><div class="sub">${f.orig} → ${f.dest} · ${f.tail} · ${(net.airlines.find(a => a.code === f.airline) || {}).name}</div>
        ${f.status === 'ok' ? `<dl class="kv"><dt>Departure</dt><dd>${hhmm(f.std)} → ${hhmm(f.adep)}</dd><dt>Arrival</dt><dd>${hhmm(f.sta)} → ${hhmm(f.aarr)}</dd><dt>Arrival delay</dt><dd style="color:${dcol(f.aarr - f.sta)}">${Math.round(Math.max(0, f.aarr - f.sta))} min</dd><dt>Domino gen</dt><dd>${f.gen >= 0 ? 'G' + f.gen : 'unaffected'}</dd><dt>Passengers</dt><dd>${net.flights[f.id].load}/${net.flights[f.id].seats}</dd></dl>` : ''}
        <div class="note" style="margin:0 0 4px">${esc(causeOf(f)) || 'Running to schedule'}</div>
        ${later ? `<div class="note" style="color:#fbbf24;margin:0">Knock-on: ${later} later flight${later > 1 ? 's' : ''} on this aircraft ${later > 1 ? 'are' : 'is'} delayed or cancelled.</div>` : ''}
        <div class="btnrow"><button class="btn sm" data-act="viewCascade">See dominoes</button>${future ? `<button class="btn sm" data-act="flSwap" data-id="${f.id}">🔁 Swap spare</button><button class="btn sm danger" data-act="flCancel" data-id="${f.id}">✂ Cancel rotation</button>` : ''}</div>`;
      el.classList.remove('hidden'); setHtml(el, html);
    } else el.classList.add('hidden');
  }
  function updateBanner() {
    const now = S.now; const chips = [];
    if (S.placing) chips.push(`<div class="chip" style="border-color:#22d3ee"><span class="dot" style="background:#22d3ee"></span>${DS.WXT[S.placing].icon} Click anywhere on the map to plant <b>${S.placing}</b> · Esc to cancel</div>`);
    S.weather.forEach(e => {
      const end = e.start + e.dur, m = DS.WXT[e.type], h = hits(e), loc = h.length ? h.slice(0, 3).map(x => x.code).join('/') : 'open airspace';
      if (now < e.start - 240) chips.push(`<div class="chip"><span class="dot" style="background:#64748b"></span>${m.icon} ${e.type} forecast near ${loc} · ${hhmm(e.start)}–${hhmm(end)}</div>`);
      else if (now < e.start) chips.push(`<div class="chip" style="border-color:#a78bfa"><span class="dot" style="background:#fbbf24"></span>${m.icon} <b>${e.type}</b> reaches ${loc} in ${Math.round(e.start - now)} min — act now</div>`);
      else if (now < end) chips.push(`<div class="chip" style="border-color:#ef4444"><span class="dot" style="background:#ef4444"></span>${m.icon} <b>${e.type}</b> · ${h.length ? h.slice(0, 3).map(x => x.code + ' ' + x.txt).join(', ') : 'en-route only'} until ${hhmm(end)}</div>`);
      else if (now < end + 240) chips.push(`<div class="chip"><span class="dot" style="background:#34d399"></span>${e.type} cleared ${hhmm(end)} — backlog clearing</div>`);
    });
    if (chips.length > 4) { const n = chips.length - 3; chips.length = 3; chips.push(`<div class="chip">+${n} more problems — see the Weather tab</div>`); }
    setHtml($('#banner'), chips.join(''));
  }
  function updateLegend() {
    setHtml($('#legend'), S.colorMode === 'gen'
      ? `<span><i style="background:#34d399"></i>unaffected</span>${DS.GENCOL.map((c, i) => `<span><i style="background:${c}"></i>G${i}${i === 4 ? '+' : ''}</span>`).join('')}<span style="color:var(--dim)">drag · scroll to zoom</span>`
      : `<span><i style="background:#34d399"></i>≤15</span><span><i style="background:#fbbf24"></i>≤45</span><span><i style="background:#fb923c"></i>≤120</span><span><i style="background:#f87171"></i>&gt;2h</span><span style="color:var(--dim)">min late · drag · scroll to zoom</span>`);
  }

  // =====================================================================
  //  selection / actions
  // =====================================================================
  function selectFlight(id) {
    S.sel.flight = id; S.sel.tail = R().flights[id].tail; S.sel.airport = null; renderLiveSoon();
  }
  function selectAirport(code) { S.sel.airport = code; S.sel.flight = null; S.sel.tail = null; renderLiveSoon(); }

  function header() {
    $('#clock').textContent = hhmm(S.now).replace('⁺¹', ''); $('#clockDay').textContent = net.meta.tzLabel + (S.now >= 1440 ? ' · day 2' : '');
    $('#scrub').value = S.now; $('#btnPlay').textContent = S.playing ? '❚❚ Pause' : (S.now >= T1 ? '↺ Replay' : '▶ Play');
    $('#btnPlay').classList.toggle('primary', true);
  }
  function renderLive() {
    header(); updateBanner(); updateKpis(); updateScore(); drawChart(); updateStandings(); updateBottom(); updateDetail();
  }
  let liveSoon = false;
  function renderLiveSoon() { if (!liveSoon) { liveSoon = true; requestAnimationFrame(() => { liveSoon = false; renderLive(); }); } }
  function renderAll() {
    renderLeft(); renderBottomShell(); renderLive(); updateLegend(); renderPlant();
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const act = el.dataset.act, id = +el.dataset.id, code = el.dataset.code, now = S.now, F = S.form;
    const wx = wxAp();
    switch (act) {
      case 'arm': S.placing = S.placing === el.dataset.type ? null : el.dataset.type; renderPlant(); renderLeft(); renderLiveSoon(); break;
      case 'disarm': S.placing = null; renderPlant(); renderLeft(); renderLiveSoon(); break;
      case 'addEvOLD': { const used = new Set(S.weather.map(w => w.airport)); const ap = ['BOM', 'DEL', 'BLR', 'MAA', 'CCU', 'HYD'].find(c => !used.has(c)) || 'BOM'; S.weather.push({ id: S.nextId++, airport: ap, type: 'Thunderstorm', start: Math.max(T0, Math.round((now + 60) / 5) * 5), dur: 90, severity: 1 }); recompute(); renderAll(); break; }
      case 'delEv': S.weather = S.weather.filter(w => w.id !== id); if (S.selEv === id) S.selEv = null; recompute(); renderAll(); break;
      case 'delAct': removeAction(id); break;
      case 'clearPlan': S.plan = []; S.advice = null; recompute(); renderAll(); break;
      case 'addGdp': addAction({ type: 'gdp', airport: F.gdpAp || wx, from: now }); break;
      case 'addHold': addAction({ type: 'hold', airport: F.holdAp || 'ALL', mins: +(F.holdMin || 20), from: now }); break;
      case 'addFt': addAction({ type: 'fastturn', airport: F.ftAp || wx, from: now, cut: 10 }); break;
      case 'addSurge': addAction({ type: 'surge', airport: F.surgeAp || (wx === 'ALL' ? 'DEL' : wx), from: now, pct: 25 }); break;
      case 'addCrew': addAction({ type: 'crew', from: now, extra: 120 }); break;
      case 'addRebook': addAction({ type: 'rebook', from: now }); break;
      case 'addSwap': { const f = +(F.swapFlight || lateFlights(20, now)[0].id); const sp = freeSpareFor(f); if (sp) addAction({ type: 'swap', flight: f, spare: sp.id, from: now }); break; }
      case 'addCancel': addAction({ type: 'cancel', flight: +(F.cancelFlight || lateFlights(20, now)[0].id), from: now }); break;
      case 'flSwap': { const sp = freeSpareFor(id); if (sp) addAction({ type: 'swap', flight: id, spare: sp.id, from: now }); else toast('No spare aircraft left'); break; }
      case 'flCancel': addAction({ type: 'cancel', flight: id, from: now }); break;
      case 'apGdp': addAction({ type: 'gdp', airport: code, from: now }); break;
      case 'apSurge': addAction({ type: 'surge', airport: code, from: now, pct: 25 }); break;
      case 'apFt': addAction({ type: 'fastturn', airport: code, from: now, cut: 10 }); break;
      case 'apHold': addAction({ type: 'hold', airport: code, mins: 20, from: now }); break;
      case 'apStorm': { const a = AP[code], m = DS.WXT.Thunderstorm; const ev = { id: S.nextId++, type: 'Thunderstorm', lat: a.lat, lon: a.lon, radius: m.radius, start: Math.max(T0, Math.round((now + 45) / 5) * 5), dur: m.dur, severity: m.severity }; S.weather.push(ev); S.selEv = ev.id; recompute(); renderAll(); toast('Thunderstorm planted over ' + code); break; }
      case 'applyFix': { const o = (S.fixCache.opts[id] || [])[+el.dataset.k]; if (o) addAction(Object.assign({}, o.action, { from: S.now })); break; }
      case 'fixSwap': { const sp = freeSpareFor(id); if (sp) addAction({ type: 'swap', flight: id, spare: sp.id, from: S.now }); else toast('No spare aircraft left'); break; }
      case 'fixCancel': addAction({ type: 'cancel', flight: id, from: S.now }); break;
      case 'selAp': selectAirport(code); break;
      case 'selFl': selectFlight(id); break;
      case 'closeDetail': S.sel = { airport: null, flight: null, tail: null }; renderLiveSoon(); break;
      case 'viewCascade': S.btab = 'cascade'; renderBottomShell(); break;
      case 'obj': S.objective = el.dataset.obj; S.advice = null; renderLeft(); renderLive(); if (S.btab === 'fix') renderBottomShell(); break;
      case 'analyse': { const A = DS.advise(net, S.weather, S.plan, S.now, S.objective); S.advice = { at: S.now, items: A.items, baseObj: A.baseObj, mode: S.objective, stale: false }; renderLeft(); break; }
      case 'applyAdvice': { const it = S.advice.items[+el.dataset.i]; addAction(Object.assign({}, it.action, { from: S.now })); S.ltab = 'advisor'; { const A = DS.advise(net, S.weather, S.plan, S.now, S.objective); S.advice = { at: S.now, items: A.items, baseObj: A.baseObj, mode: S.objective, stale: false }; } renderLeft(); break; }
      case 'autoopt': {
        let n = 0; for (let k = 0; k < 6; k++) { const A = DS.advise(net, S.weather, S.plan, S.now, S.objective); if (!A.items.length) break; const a = Object.assign({ id: S.nextId++ }, A.items[0].action, { from: S.now }); S.plan.push(a); n++; }
        recompute(); const A = DS.advise(net, S.weather, S.plan, S.now, S.objective); S.advice = { at: S.now, items: A.items, baseObj: A.baseObj, mode: S.objective, stale: false }; renderAll(); toast(n ? `Auto-optimiser applied ${n} measure${n > 1 ? 's' : ''}` : 'Nothing further improves the plan'); break;
      }
    }
  });
  function freeSpareFor(fid) {
    const f = R().flights[fid], free = net.tails.filter(t => t.spare && !S.plan.some(a => a.type === 'swap' && a.spare === t.id));
    return free.sort((a, b) => net.dist(a.base, f.orig) - net.dist(b.base, f.orig))[0];
  }
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.f) { S.form[t.dataset.f] = t.value; renderLeft(); }
    else if (t.dataset.evf) { evEdit(t); renderLeft(); }
  });
  let evRaf = 0;
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.evf && t.type === 'range') { evEdit(t); const out = t.parentElement.querySelector('output'); const ev = S.weather.find(w => w.id === +t.dataset.id); out.textContent = t.dataset.evf === 'radius' ? ev.radius + ' km' : t.dataset.evf === 'start' ? hhmm(ev.start) : t.dataset.evf === 'dur' ? Math.floor(ev.dur / 60) + 'h' + String(ev.dur % 60).padStart(2, '0') : (ev.severity >= 0.9 ? 'Closed' : Math.round((1 - ev.severity) * 100) + '% cap'); }
    else if (t.id === 'bQ') { S.board.q = t.value; updateBottom(); }
  });
  function evEdit(t) {
    const ev = S.weather.find(w => w.id === +t.dataset.id); if (!ev) return; const f = t.dataset.evf;
    if (f === 'type') { const m = DS.WXT[t.value]; Object.assign(ev, { type: t.value, severity: m.severity, radius: m.radius }); }
    else ev[f] = f === 'severity' ? +t.value / 100 : +t.value;
    S.selEv = ev.id;
    cancelAnimationFrame(evRaf); evRaf = requestAnimationFrame(() => { recompute(); renderLive(); const h = $('#hits' + ev.id); if (h) h.innerHTML = hitsHtml(ev); });
  }
  $('#leftTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.ltab = b.dataset.tab; renderLeft(); } });
  $('#botTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) { S.btab = b.dataset.tab; renderBottomShell(); return; }
    const g = e.target.closest('[data-g]'); if (g) { S.gantt.mode = g.dataset.g; $$('#gMode button').forEach(x => x.classList.toggle('on', x === g)); drawGantt(); return; }
    const s = e.target.closest('#gSort button'); if (s) { S.gantt.sort = s.dataset.s; $$('#gSort button').forEach(x => x.classList.toggle('on', x === s)); drawGantt(); }
  });
  $('#botBody').addEventListener('click', e => {
    const b = e.target.closest('#bFilter button'); if (b) { S.board.filter = b.dataset.b; $$('#bFilter button').forEach(x => x.classList.toggle('on', x === b)); updateBottom(); }
  });
  $('#rightBody').addEventListener('click', e => {
    const m = e.target.closest('#chartSw button'); if (m) { S.chartMetric = m.dataset.m; $$('#chartSw button').forEach(x => x.classList.toggle('on', x === m)); drawChart(); return; }
    const s = e.target.closest('#standSw button'); if (s) { S.rstab = s.dataset.s; $$('#standSw button').forEach(x => x.classList.toggle('on', x === s)); updateStandings(); return; }
    const o = e.target.closest('#standSort button'); if (o) { S.standSort = o.dataset.o; $$('#standSort button').forEach(x => x.classList.toggle('on', x === o)); updateStandings(); }
  });
  $('#colorMode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.colorMode = b.dataset.m; $$('#colorMode button').forEach(x => x.classList.toggle('on', x === b)); updateLegend(); renderLiveSoon(); });
  $('#btnRecenter').addEventListener('click', () => { map.recenter(); });
  $('#btnPlay').addEventListener('click', () => { if (S.now >= T1) S.now = T0; S.playing = !S.playing; header(); if (!S.playing) renderLeft(); });
  $('#btnStepF').addEventListener('click', () => step(30)); $('#btnStepB').addEventListener('click', () => step(-30));
  function step(d) { S.playing = false; S.now = Math.max(T0, Math.min(T1, S.now + d)); renderLive(); renderLeft(); }
  $('#btnRestart').addEventListener('click', () => { S.playing = false; S.now = T0; renderLive(); renderLeft(); });
  $('#speed').addEventListener('change', e => S.speed = +e.target.value);
  $('#scrub').addEventListener('input', e => { S.now = +e.target.value; renderLiveSoon(); });
  $('#scrub').addEventListener('change', () => renderLeft());
  $('#scenarioSel').addEventListener('change', e => loadScenario(e.target.value));
  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.code === 'Escape' && S.placing) { S.placing = null; renderPlant(); renderLeft(); renderLiveSoon(); return; }
    if (e.code === 'Space') { e.preventDefault(); $('#btnPlay').click(); }
    else if (e.code === 'ArrowRight') step(30); else if (e.code === 'ArrowLeft') step(-30);
  });
  window.addEventListener('resize', () => { map.resize(); drawChart(); updateBottom(); });

  // ---------- map wiring ----------
  const map = new DS.MapView($('#map'), () => S, {
    placing: () => S.placing,
    place(lon, lat) {
      const t = S.placing, m = DS.WXT[t];
      const ev = { id: S.nextId++, type: t, lat, lon, radius: m.radius, start: Math.max(T0, Math.round((S.now + 45) / 5) * 5), dur: m.dur, severity: m.severity };
      S.weather.push(ev); S.selEv = ev.id; S.placing = null; S.ltab = 'scenario'; recompute(); renderAll();
      const h = hits(ev); toast(`${m.icon} ${t} planted — starts ${hhmm(ev.start)}${h.length ? ', hits ' + h.map(x => x.code).join(', ') : ' (no airport in range; flights will detour)'} · drag to move`);
    },
    dragEvent(id, lon, lat, final) {
      const ev = S.weather.find(w => w.id === id); if (!ev) return; ev.lon = lon; ev.lat = lat; S.selEv = id;
      cancelAnimationFrame(evRaf);
      if (final) { recompute(); renderAll(); } else evRaf = requestAnimationFrame(() => { recompute(); renderLive(); });
    },
    hover(h, x, y) {
      if (!h) { hideTip(); return; }
      if (h.type === 'wx') { const e = S.weather.find(w => w.id === h.id), hh = hits(e); showTip(`<b>${DS.WXT[e.type].icon} ${e.type}</b> · ${hhmm(e.start)}–${hhmm(e.start + e.dur)}<br>${hh.length ? hh.map(q => q.code + ' ' + q.txt).join(' · ') : 'no airport in range'}<br><span style="color:var(--muted)">drag to move · click to edit</span>`, x, y); return; }
      if (h.type === 'airport') { const a = AP[h.code], st = (map.st || {})[h.code] || {}, fac = DS.wxFactor(S.weather, h.code, S.now); showTip(`<b>${a.code}</b> ${esc(a.city)}<br>${fac === 0 ? '<span style="color:#f87171">Closed</span>' : fac < 1 ? '<span style="color:#fbbf24">Reduced capacity</span>' : 'Normal'} · ${st.wait || 0} waiting · ${st.inbound || 0} inbound<br><span style="color:var(--muted)">click for details &amp; actions</span>`, x, y); }
      else showTip(flightTip(h.id), x, y);
    },
    select(h) {
      if (h && h.type === 'wx') { S.selEv = h.id; S.ltab = 'scenario'; renderLeft(); const c = $('#ev' + h.id); if (c) c.scrollIntoView({ block: 'nearest' }); renderLiveSoon(); return; }
      if (!h) { S.sel = { airport: null, flight: null, tail: null }; renderLiveSoon(); } else if (h.type === 'airport') selectAirport(h.code); else selectFlight(h.id); }
  });
  map.resizeObs = new ResizeObserver(() => { map.resize(); }); map.resizeObs.observe($('#map'));

  // ---------- boot ----------
  function setNetwork(kind) {
    net = DS.buildNetwork(kind); AP = net.airportMap; T0 = net.meta.t0; T1 = net.meta.t1; S.net = net; DS.airportMap = net.airportMap;
    S.res = {}; S.plan = []; S.weather = []; S.fixCache = {}; S.gantt.sort = 'base';
    $('#scrub').min = T0; $('#scrub').max = T1; $('#networkSel').value = kind;
    $('#scenarioSel').innerHTML = net.meta.scenarios.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    map.skey = ''; map.recenter(); loadScenario(net.meta.scenarios[0].id); $('#scenarioSel').value = net.meta.scenarios[0].id;
    toast(kind === 'world' ? 'Worldwide network · ' + net.airports.length + ' airports, ' + net.flights.length + ' flights (times in UTC)' : 'India domestic network · ' + net.airports.length + ' airports, ' + net.flights.length + ' flights (times in IST)');
  }
  function applyTheme(name) {
    document.documentElement.dataset.theme = name; DS.setTheme(name); $('#btnTheme').textContent = name === 'light' ? '☾ Dark' : '☀ Light';
    try { localStorage.setItem('skylay-theme', name); } catch (e) { /* storage may be unavailable */ }
    map.skey = ''; renderLive(); updateLegend();
  }
  $('#networkSel').addEventListener('change', e => setNetwork(e.target.value));
  $('#btnTheme').addEventListener('click', () => applyTheme(DS.themeName === 'light' ? 'dark' : 'light'));
  $('#scenarioSel').innerHTML = net.meta.scenarios.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  initRight();
  loadScenario('bom-monsoon');
  { let saved = null; try { saved = localStorage.getItem('skylay-theme'); } catch (e) { /* ignore */ } applyTheme(saved === 'light' ? 'light' : 'dark'); }
  let last = performance.now(), acc = 0;
  function frame(ts) {
    const dt = Math.min(100, ts - last); last = ts;
    if (S.playing) {
      S.now += S.speed * dt / 1000;
      if (S.now >= T1) { S.now = T1; S.playing = false; renderLeft(); }
      acc += dt; if (acc > 220) { acc = 0; renderLive(); }
    }
    map.draw(ts);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.DominoSky = { S, map, recompute, addAction, renderAll };   // handy for debugging
})();
