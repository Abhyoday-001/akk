// Run: node test/engine.test.js
const DS = require('../js/data.js'); require('../js/engine.js');
const assert = require('assert');
const net = DS.buildNetwork(2024);
const fmt = v => (v / 1e7).toFixed(2) + ' cr';
console.log('airports', net.airports.length, 'tails', net.tails.length, 'flights', net.flights.length, 'itins', net.itins.length,
  'pax', net.flights.reduce((s, f) => s + f.load, 0));

const none = DS.simulate(net, [], []);
const m0 = DS.metricsAt(none, 1800);
console.log('clear day: OTP', (m0.otp * 100).toFixed(1) + '%', 'delayMin', m0.delayMin, 'cancel', m0.cancelled, 'cost', fmt(none.costs.total));
assert(m0.cancelled === 0, 'clear day should have no cancellations');

for (const sc of DS.SCENARIOS.filter(s => s.events.length)) {
  const w = sc.events;
  const base = DS.simulate(net, w, []);
  const mb = DS.metricsAt(base, 1800);
  console.log(`\n== ${sc.name}`);
  console.log(' no action: OTP', (mb.otp * 100).toFixed(1) + '%', 'delayMin', mb.delayMin, 'cancel', mb.cancelled, 'div', mb.diverted,
    'stranded', base.pax.stranded, 'missedPax', base.pax.missedPax, 'cost', fmt(base.costs.total));
  console.log(' attribution', JSON.stringify(DS.attribution(base)), 'gens', JSON.stringify(DS.generations(base)));
  const t0 = Date.now();
  const adv = DS.advise(net, w, [], 540); adv.items.forEach(i => i.save = i.gain);
  console.log(' advisor took', Date.now() - t0, 'ms; top:');
  adv.items.slice(0, 5).forEach(i => console.log("   ", (i.gain / 60).toFixed(0), "pax-h", i.label));
  // apply greedy
  let plan = [];
  for (let k = 0; k < 5; k++) { const a = DS.advise(net, w, plan, 540); if (!a.items.length) break; plan = plan.concat([Object.assign({ id: k }, a.items[0].action)]); }
  const r = DS.simulate(net, w, plan), mr = DS.metricsAt(r, 1800);
  console.log(' optimized (' + plan.length + ' actions): OTP', (mr.otp * 100).toFixed(1) + '%', 'cancel', mr.cancelled, 'stranded', r.pax.stranded, 'cost', fmt(r.costs.total), 'vs', fmt(base.costs.total));
  assert(r.costs.total <= base.costs.total, 'optimized plan must not be worse');
  // invariants
  for (const f of base.flights) {
    if (f.status === 'ok') { assert(f.adep >= f.std, 'no early departure ' + f.num); assert(f.aarr >= f.adep + f.block - 1e-6, 'arrival ≥ dep+block'); }
  }
  // aircraft continuity: every ok flight starts where the previous ok flight on the tail ended, and not before it landed
  for (const t of net.tails) {
    let loc = t.base, ready = -1;
    for (const id of t.flights) {
      const f = base.flights[id]; if (f.status !== 'ok') continue;
      assert.strictEqual(f.orig, loc, `tail ${t.id} teleported at ${f.num}`);
      assert(f.adep >= ready, `tail ${t.id} departed before landing`);
      loc = f.dest; ready = f.aarr;
    }
  }
}
console.log('\nOK');

// ---- free-placed problems -------------------------------------------------
{
  const mk = (type, lat, lon, start, dur, sev, radius) => Object.assign({ id: 1, type, lat, lon, start, dur, severity: sev, radius });
  // 1) open-airspace storm with no airport inside: only routes crossing it are hit (detours)
  const open = [mk('Thunderstorm', 20.5, 80.5, 600, 240, 1, 150)];
  assert(DS.affected(net, open).length === 0, 'cell should contain no airport');
  const r = DS.simulate(net, open, []);
  const det = r.flights.filter(f => f.detour > 0);
  const m = DS.metricsAt(r, 1800), m0 = DS.metricsAt(DS.simulate(net, [], []), 1800);
  console.log('\nopen-airspace storm: flights detoured', det.length, 'delayMin', Math.round(m.delayMin), 'vs clear', Math.round(m0.delayMin));
  assert(det.length > 0 && m.delayMin > m0.delayMin, 'en-route storm must delay crossing flights');
  det.forEach(f => assert(f.eta - f.adep === f.block + f.detour, 'detour extends block time'));
  // 2) fog/runway closure never detour (ground-only)
  const fog = DS.simulate(net, [mk('Fog', 20.5, 80.5, 600, 240, 0.8, 150)], []);
  assert(fog.flights.every(f => !f.detour), 'fog must not cause detours');
  // 3) radius decides which airports are hit; edge airports are only partly throttled
  const e = mk('Thunderstorm', 19.089, 72.866, 600, 90, 1, 200);
  const hit = net.airports.map(a => [a.code, DS.effSev(e, a)]).filter(x => x[1] > 0.04);
  console.log('storm over BOM hits', JSON.stringify(hit.map(h => h[0] + ':' + h[1].toFixed(2))));
  assert(hit.some(h => h[0] === 'BOM' && h[1] === 1) && hit.length >= 2, 'BOM closed, neighbour throttled');
  // 4) several problem types at once, anywhere, still obey every invariant
  const multi = [mk('Cyclone', 16, 82, 700, 300, 1, 350), mk('Runway closure', 28.5, 77.1, 540, 180, 0.5, 40), mk('ATC outage', 13, 77.7, 800, 120, 0.85, 130), mk('Dust storm', 26.8, 75.8, 650, 180, 0.6, 260)];
  const rm = DS.simulate(net, multi, []);
  for (const t of net.tails) { let loc = t.base, ready = -1;
    for (const id of t.flights) { const f = rm.flights[id]; if (f.status !== 'ok') continue; assert.strictEqual(f.orig, loc); assert(f.adep >= ready); loc = f.dest; ready = f.aarr; } }
  const best = DS.advise(net, multi, [], 540);
  console.log('multi-problem day: cost', fmt(rm.costs.total), 'advisor found', best.items.length, 'useful measures');
  assert(rm.costs.total > DS.simulate(net, [], []).costs.total);
}
console.log('free-placement OK');

// ---- operational objectives + diagnostics ---------------------------------------
{
  const w = DS.SCENARIOS[0].events, base = DS.simulate(net, w, []);
  for (const mode of ['pax', 'flights', 'stranded']) {
    const a = DS.advise(net, w, [], 540, mode);
    a.items.forEach(i => assert(i.gain > DS.OBJ[mode].eps));
    for (let k = 1; k < a.items.length; k++) assert(a.items[k - 1].gain >= a.items[k].gain, 'sorted by objective');
    // applying the top measure must really improve that objective
    if (a.items.length) { const r = DS.simulate(net, w, [Object.assign({ id: 1 }, a.items[0].action)]); assert(DS.objective(r, mode) < DS.objective(base, mode), mode + ' objective improves'); }
    console.log(mode.padEnd(8), 'top:', a.items[0] && a.items[0].label, '| gain', a.items[0] && (a.items[0].gain / DS.OBJ[mode].div).toFixed(1), DS.OBJ[mode].unit);
  }
  const dg = DS.diagnose(net, base, 1800);
  console.log('roots:', dg.roots.slice(0, 4).map(r => `${r.root} ${(r.total / 60).toFixed(0)}h(${r.gen0} direct/${r.flights - r.gen0} knock-on)`).join(', '));
  assert(dg.roots.length && dg.roots[0].root === 'BOM', 'Mumbai storm must be the top root cause');
  const tot = dg.direct + dg.knock; assert(dg.knock > 0 && tot > 0);
  const dgNow = DS.diagnose(net, base, 560);
  console.log('risks at 09:20:', dgNow.risks.length, dgNow.risks[0] && ('top ' + base.flights[dgNow.risks[0].id].num + ' knocks on ' + dgNow.risks[0].kF + ' flights'));
  if (dgNow.risks.length) { const fx = DS.fixOptions(net, w, [], 560, dgNow.risks[0].id, 'pax', base); console.log('fix options:', fx.map(o => o.label + ' ' + (o.gain / 60).toFixed(1) + 'h').join(' | ')); assert(fx.length >= 1); }
}
console.log('objectives OK');

// ---- worldwide network -----------------------------------------------------------
{
  const wn = DS.buildNetwork('world');
  console.log('\nWORLD: airports', wn.airports.length, 'tails', wn.tails.length, 'flights', wn.flights.length, 'itins', wn.itins.length, 'pax', wn.flights.reduce((s, f) => s + f.load, 0));
  const longest = wn.flights.reduce((m, f) => Math.max(m, f.block), 0);
  console.log('longest block', (longest / 60).toFixed(1) + 'h; flights >6h:', wn.flights.filter(f => f.block > 360).length);
  const clear = DS.simulate(wn, [], []);
  const mc = DS.metricsAt(clear, 1800);
  console.log('world clear day: OTP', (mc.otp * 100).toFixed(1) + '%', 'cancel', mc.cancelled, 'crew-limit cancels', clear.flights.filter(f => f.cancel === 'crew').length);
  assert(mc.cancelled === 0, 'no cancellations on a clear world day');
  for (const sc of DS.SCENARIOS_WORLD.filter(x => x.events.length)) {
    const t0 = Date.now(), r = DS.simulate(wn, sc.events, []), ms = Date.now() - t0, m = DS.metricsAt(r, 1800);
    for (const t of wn.tails) { let loc = t.base, ready = -1;
      for (const id of t.flights) { const f = r.flights[id]; if (f.status !== 'ok') continue; assert.strictEqual(f.orig, loc, 'teleport ' + t.id); assert(f.adep >= ready); loc = f.dest; ready = f.aarr; } }
    const dg = DS.diagnose(wn, r, 1800);
    const adv = DS.advise(wn, sc.events, [], 420, 'pax');
    console.log(' ', sc.name.padEnd(40), 'OTP', (m.otp * 100).toFixed(1) + '%', 'cancel', m.cancelled, 'div', m.diverted, 'stranded', r.pax.stranded, '| sim', ms + 'ms | top root', dg.roots[0] && dg.roots[0].root, '| advisor top:', adv.items[0] && adv.items[0].label);
    assert(DS.objective(r, 'pax') > DS.objective(clear, 'pax'), sc.id + ' must hurt');
  }
}
console.log('world OK');

// ---- schedule import ---------------------------------------------------------------
{
  require('../js/import.js');
  for (const kind of ['india', 'world']) {
    const src = DS.buildNetwork(kind), csv = DS.scheduleToCSV(src);
    const { net, report } = DS.networkFromSchedule(DS.parseTable(csv));
    console.log(`\nimport round-trip (${kind}): rows ${report.rows} -> flights ${report.imported}, aircraft ${report.tails} (source ${src.tails.filter(t => !t.spare).length}), airports ${report.airports}, window ${report.window}`);
    assert.strictEqual(report.imported, src.flights.length, 'every flight survives the round trip');
    assert.strictEqual(report.tails, src.tails.filter(t => !t.spare).length, 'aircraft rotations preserved');
    for (const t of net.tails) { let loc = null; for (const id of t.flights) { const f = net.flights[id]; if (loc) assert.strictEqual(f.orig, loc); loc = f.dest; } }
    const clear = DS.simulate(net, [], []), mc = DS.metricsAt(clear, net.meta.t1);
    const sc = net.meta.scenarios[0], storm = DS.simulate(net, sc.events, []);
    console.log('  clear OTP', (mc.otp * 100).toFixed(1) + '%', '| auto scenario:', sc.name, '| OTP', (DS.metricsAt(storm, net.meta.t1).otp * 100).toFixed(1) + '%', '| pax-h', Math.round(DS.objective(storm, 'pax') / 60));
    assert(DS.objective(storm, 'pax') > DS.objective(clear, 'pax'), 'imported storm hurts');
    assert(DS.advise(net, sc.events, [], sc.events[0].start - 30, 'pax').items.length > 0, 'advisor works on imported data');
  }
  // messy real-world style: semicolons, HHMM times, no tail column, unknown airport, no header aliases
  const messy = 'Flt;Dep;Arr;Dep Time;Arr Time\nAI101;DEL;BOM;0630;0830\nAI102;BOM;DEL;0930;1135\nAI103;DEL;BLR;0700;0945\nXX1;DEL;ZZZ;0800;0900\nAI104;BLR;DEL;1030;1315\nAI105;BOM;BLR;1000;1130\n';
  const r = DS.networkFromSchedule(DS.parseTable(messy));
  console.log('\nmessy CSV ->', JSON.stringify({ imported: r.report.imported, aircraft: r.report.inferredAircraft, unknown: r.report.unknownAirports, cols: r.report.columns.orig + '/' + r.report.columns.std }));
  assert.strictEqual(r.report.imported, 5); assert(r.report.unknownAirports.ZZZ === 1);
  assert.strictEqual(r.report.columns.orig, 'Dep'); assert.strictEqual(r.report.columns.std, 'Dep Time');
  // overnight flight (arrival earlier than departure on the clock)
  const night = DS.networkFromSchedule(DS.parseTable('flight,origin,destination,std,sta\nA1,DEL,BOM,23:10,01:20\n'));
  assert.strictEqual(night.net.flights[0].sta - night.net.flights[0].std, 130, 'overnight block time');
  // helpful errors
  assert.throws(() => DS.parseTable(''), /Nothing to import/);
  assert.throws(() => DS.networkFromSchedule(DS.parseTable('a,b\n1,2\n')), /Could not find/);
  assert.throws(() => DS.networkFromSchedule(DS.parseTable('flight,origin,destination,std,sta\nA1,QQQ,WWW,10:00,12:00\n')), /Unknown airport codes|No usable/);
  // JSON with its own airport list
  const js = JSON.stringify({ airports: [{ code: 'AAA', lat: 10, lon: 20 }, { code: 'BBB', lat: 12, lon: 25 }], flights: [{ flight: 'T1', origin: 'AAA', destination: 'BBB', std: '2026-05-01T08:00:00Z', sta: '2026-05-01T09:30:00Z' }] });
  assert.strictEqual(DS.networkFromSchedule(DS.parseTable(js)).report.imported, 1);
}
console.log('import OK');
