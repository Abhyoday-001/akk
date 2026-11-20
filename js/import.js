/* Skylay — bring your own flight schedule.
   parseTable()          CSV / TSV / JSON text  ->  array of row objects
   networkFromSchedule() rows -> a network the engine and UI can run (same shape as buildNetwork)
   scheduleToCSV()       current network -> CSV (a ready-made sample of the accepted format)

   Accepted columns (names are matched loosely, order does not matter):
     flight | tail/registration | origin | destination | std/departure time | sta/arrival time      (required: origin, destination, both times)
     airline, seats, pax/load, origin_lat/origin_lon/dest_lat/dest_lon                                  (optional)
   Times may be HH:MM, HHMM, "YYYY-MM-DD HH:MM" or ISO 8601. Without a tail column, aircraft rotations are inferred. */
(function (G) {
  'use strict';
  const DS = G.DS;
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

  // ---------------------------------------------------------------- parsing
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some(x => x.trim() !== '')) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some(x => x.trim() !== '')) rows.push(row);
    if (rows.length < 2) throw new Error('The file needs a header row and at least one flight.');
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] == null ? '' : r[i]).trim(); }); return o; });
  }
  function parseTable(text) {
    const t = text.trim();
    if (!t) throw new Error('Nothing to import — paste a CSV or JSON schedule, or choose a file.');
    if (t[0] === '[' || t[0] === '{') {
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('That looks like JSON but could not be parsed: ' + e.message); }
      if (Array.isArray(j)) return { rows: j, airports: [] };
      const rows = j.flights || j.schedule || j.rows || j.data;
      if (!Array.isArray(rows)) throw new Error('JSON must be an array of flights, or an object with a "flights" array.');
      return { rows, airports: Array.isArray(j.airports) ? j.airports : [] };
    }
    return { rows: parseCSV(t), airports: [] };
  }

  const ALIAS = {
    num: ['flight', 'flightno', 'flightnumber', 'flightnum', 'flt', 'fltno', 'callsign', 'flightid', 'id'],
    tail: ['tail', 'tailnumber', 'tailno', 'registration', 'reg', 'aircraft', 'aircraftid', 'aircraftregistration', 'ac', 'acid', 'rotation'],
    orig: ['origin', 'orig', 'from', 'dep', 'departure', 'depairport', 'departureairport', 'origincode', 'adep', 'departurestation', 'depstation', 'originairport'],
    dest: ['destination', 'dest', 'to', 'arr', 'arrival', 'arrairport', 'arrivalairport', 'destinationcode', 'ades', 'arrivalstation', 'arrstation', 'destinationairport'],
    std: ['std', 'scheduleddeparture', 'scheduleddeparturetime', 'departuretime', 'deptime', 'scheduleddep', 'schedulesdep', 'dep', 'departure', 'etd', 'offblock', 'depart'],
    sta: ['sta', 'scheduledarrival', 'scheduledarrivaltime', 'arrivaltime', 'arrtime', 'scheduledarr', 'arr', 'arrival', 'eta', 'onblock', 'arrive'],
    seats: ['seats', 'capacity', 'seatcapacity', 'aircraftseats', 'seatcount'],
    pax: ['pax', 'passengers', 'load', 'paxcount', 'booked', 'bookedpax', 'paxload'],
    airline: ['airline', 'carrier', 'operator', 'airlinecode', 'al', 'operatingcarrier']
  };
  function mapColumns(rows) {
    const headers = Object.keys(rows[0] || {}); const H = headers.map(norm);
    const sample = headers.map(h => rows.slice(0, 30).map(r => r[h]).filter(v => v != null && String(v).trim() !== ''));
    const isTime = i => sample[i].length > 0 && sample[i].every(v => /(\d{1,2}:\d{2})|^\d{3,4}$|^\d{4}-\d{2}-\d{2}/.test(String(v).trim()));
    const isCode = i => sample[i].length > 0 && sample[i].every(v => /^[A-Za-z]{3,4}$/.test(String(v).trim()));
    const used = new Set(), m = {};
    const pick = (role, pred) => { for (const n of ALIAS[role]) { const i = H.indexOf(n); if (i >= 0 && !used.has(i) && (!pred || pred(i))) { used.add(i); return headers[i]; } } return null; };
    m.orig = pick('orig', isCode); m.dest = pick('dest', isCode); m.std = pick('std', isTime); m.sta = pick('sta', isTime);
    m.num = pick('num'); m.tail = pick('tail'); m.seats = pick('seats'); m.pax = pick('pax'); m.airline = pick('airline');
    const free = pred => { for (let i = 0; i < headers.length; i++) if (!used.has(i) && pred(i)) { used.add(i); return headers[i]; } return null; };
    if (!m.orig) m.orig = free(isCode); if (!m.dest) m.dest = free(isCode);
    if (!m.std) m.std = free(isTime); if (!m.sta) m.sta = free(isTime);
    const latlon = (pred, which) => headers.find((h, i) => new RegExp(which).test(H[i]) && pred.test(H[i])) || null;
    m.oLat = latlon(/^(orig|origin|dep|departure|from|adep)/, 'lat'); m.oLon = latlon(/^(orig|origin|dep|departure|from|adep)/, 'lon|lng');
    m.dLat = latlon(/^(dest|destination|arr|arrival|to|ades)/, 'lat'); m.dLon = latlon(/^(dest|destination|arr|arrival|to|ades)/, 'lon|lng');
    const missing = ['orig', 'dest', 'std', 'sta'].filter(k => !m[k]);
    if (missing.length) throw new Error('Could not find the ' + { orig: 'origin airport', dest: 'destination airport', std: 'scheduled departure time', sta: 'scheduled arrival time' }[missing[0]] + ' column. Columns seen: ' + headers.join(', ') + '.');
    return m;
  }
  function parseWhen(v) {
    v = String(v == null ? '' : v).trim(); let m;
    if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/))) return { d: Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5, min: +m[4] * 60 + +m[5] };
    if ((m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[ ,T]+(\d{1,2}):(\d{2})/))) return { d: Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5, min: +m[4] * 60 + +m[5] };
    if ((m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*(?:\+(\d))?$/))) {
      let h = +m[1]; if (m[3]) { const pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
      return { d: null, min: h * 60 + +m[2] + (m[4] ? 1440 * +m[4] : 0) };
    }
    if ((m = v.match(/^(\d{2})(\d{2})$/))) return { d: null, min: +m[1] * 60 + +m[2] };
    return null;
  }

  // ---------------------------------------------------------------- network construction
  function networkFromSchedule(parsed, opts) {
    opts = opts || {};
    const rows = parsed.rows || parsed; if (!rows.length) throw new Error('The schedule has no flights.');
    const known = {}; DS.AIRPORTS_WORLD.concat(DS.AIRPORTS).forEach(a => { if (!known[a.code]) known[a.code] = a; });
    (parsed.airports || []).forEach(a => { const c = String(a.code || a.iata || '').toUpperCase(); if (c && isFinite(+a.lat) && isFinite(+a.lon)) known[c] = { code: c, city: a.city || c, name: a.name || c, lat: +a.lat, lon: +a.lon, cap: 0, hub: 0 }; });
    const m = mapColumns(rows), rep = { rows: rows.length, imported: 0, unknownAirports: {}, badTime: 0, tooLate: 0, sameAirport: 0, columns: m, inferredTails: !m.tail };
    const rnd = DS.mulberry32(opts.seed || 99);

    // 1. read rows
    const parsedRows = [];
    rows.forEach((r, ix) => {
      const o = String(r[m.orig] || '').trim().toUpperCase(), d = String(r[m.dest] || '').trim().toUpperCase();
      const a = parseWhen(r[m.std]), b = parseWhen(r[m.sta]);
      if (!a || !b) { rep.badTime++; return; }
      if (o === d) { rep.sameAirport++; return; }
      for (const [c, la, lo] of [[o, m.oLat, m.oLon], [d, m.dLat, m.dLon]]) {
        if (!known[c] && la && lo && isFinite(+r[la]) && isFinite(+r[lo]) && r[la] !== '' && r[lo] !== '') known[c] = { code: c, city: c, name: c, lat: +r[la], lon: +r[lo], cap: 0, hub: 0 };
      }
      const unk = [o, d].filter(c => !known[c]);
      if (unk.length) { unk.forEach(c => rep.unknownAirports[c] = (rep.unknownAirports[c] || 0) + 1); return; }
      parsedRows.push({ r, ix, o, d, a, b });
    });
    const days = parsedRows.flatMap(p => [p.a.d, p.b.d]).filter(x => x != null); const d0 = days.length ? Math.min(...days) : 0;
    const flightsRaw = [];
    parsedRows.forEach(p => {
      let std = (p.a.d == null ? 0 : p.a.d - d0) * 1440 + p.a.min, sta = (p.b.d == null ? (p.a.d == null ? 0 : p.a.d - d0) : p.b.d - d0) * 1440 + p.b.min;
      while (sta <= std) sta += 1440;
      flightsRaw.push({ p, std, sta });
    });
    if (!flightsRaw.length) throw new Error('No usable flights were found. ' + (Object.keys(rep.unknownAirports).length ? 'Unknown airport codes: ' + Object.keys(rep.unknownAirports).slice(0, 12).join(', ') + ' — add origin_lat/origin_lon/dest_lat/dest_lon columns, or an "airports" list in JSON.' : 'Check the time columns.'));
    const minStd = Math.min(...flightsRaw.map(f => f.std));
    const t0 = Math.max(0, Math.floor((minStd - 60) / 60) * 60);
    let t1 = 1800; const maxSta = Math.max(...flightsRaw.map(f => f.sta)); if (maxSta + 180 > t1) t1 = Math.min(2880, Math.ceil((maxSta + 180) / 60) * 60);
    const inWindow = flightsRaw.filter(f => f.std < t1 - 60); rep.tooLate = flightsRaw.length - inWindow.length;
    inWindow.sort((x, y) => x.std - y.std || x.p.ix - y.p.ix);

    // 2. aircraft rotations (given tails, or inferred greedily)
    const groups = {}, loose = [];
    inWindow.forEach(f => { const t = m.tail ? String(f.p.r[m.tail] || '').trim() : ''; if (t) (groups[t] = groups[t] || []).push(f); else loose.push(f); });
    const chains = [];                                                           // arrays of flights, each a feasible rotation
    const split = (id, list) => {
      list.sort((x, y) => x.std - y.std); let part = 1, cur = [];
      list.forEach(f => { const prev = cur[cur.length - 1]; if (prev && (prev.p.d !== f.p.o || f.std < prev.sta)) { chains.push({ id: part === 1 ? id : id + '~' + part, list: cur }); part++; cur = []; } cur.push(f); });
      if (cur.length) chains.push({ id: part === 1 ? id : id + '~' + part, list: cur });
    };
    Object.keys(groups).forEach(t => split(t, groups[t]));
    const open = []; let auto = 0;
    loose.forEach(f => {
      let best = null; open.forEach(c => { const last = c.list[c.list.length - 1]; if (last.p.d === f.p.o && last.sta + 35 <= f.std && (!best || last.sta > best.list[best.list.length - 1].sta)) best = c; });
      if (best) best.list.push(f); else { const c = { id: 'AC' + String(++auto).padStart(3, '0'), list: [f] }; open.push(c); chains.push(c); }
    });
    rep.inferredAircraft = auto;

    // 3. airports, capacities, hubs
    const mov = {}, perHour = {};
    inWindow.forEach(f => [[f.p.o, f.std], [f.p.d, f.sta]].forEach(([c, t]) => { mov[c] = (mov[c] || 0) + 1; const k = c + '|' + Math.floor(t / 60); perHour[k] = (perHour[k] || 0) + 1; }));
    const peak = {}; Object.keys(perHour).forEach(k => { const c = k.split('|')[0]; peak[c] = Math.max(peak[c] || 0, perHour[k]); });
    const codes = Object.keys(mov).sort((a, b) => mov[b] - mov[a]), maxMov = mov[codes[0]];
    const airports = codes.map(c => { const k = known[c]; return { code: c, city: k.city || c, name: k.name || c, lat: k.lat, lon: k.lon, cap: Math.max(6, Math.round(peak[c] * 2 + 2)), hub: mov[c] >= 0.6 * maxMov && codes.indexOf(c) < 14 ? 1 : 0 }; });
    const airportMap = {}; airports.forEach(a => airportMap[a.code] = a);
    const dist = (a, b) => DS.hav(airportMap[a], airportMap[b]);

    // 4. flights + tails
    const airlinesSeen = {}, flights = [], tails = [];
    chains.forEach(c => {
      const first = c.list[0], al = (first.p.r[m.airline] || String(first.p.r[m.num] || '').replace(/[^A-Za-z]/g, '').slice(0, 2) || 'XX').toString().toUpperCase().slice(0, 3);
      airlinesSeen[al] = 1;
      const maxKm = Math.max(...c.list.map(f => dist(f.p.o, f.p.d)));
      const seatsGiven = c.list.map(f => +f.p.r[m.seats]).filter(x => x > 0);
      const seats = seatsGiven.length ? Math.round(seatsGiven.reduce((x, y) => x + y, 0) / seatsGiven.length) : (maxKm > 4500 ? 300 : 180);
      const t = { id: c.id, airline: al, type: seats > 250 ? 'widebody' : 'narrowbody', seats, base: first.p.o, flights: [], spare: false };
      c.list.forEach((f, i) => {
        const pax = +f.p.r[m.pax], load = pax > 0 ? Math.min(Math.round(pax), seats) : Math.round(seats * (0.72 + rnd() * 0.2));
        const num = String(f.p.r[m.num] || '').trim() || (al + (100 + flights.length));
        const fl = { id: flights.length, num, tail: t.id, airline: al, orig: f.p.o, dest: f.p.d, std: f.std, sta: f.sta, block: f.sta - f.std, seats, load, noise: 0, idx: i, local: load };
        flights.push(fl); t.flights.push(fl.id);
      });
      tails.push(t);
    });
    codes.slice(0, 6).forEach((c, i) => tails.push({ id: 'SPARE-' + (i + 1), airline: tails[0].airline, type: 'narrowbody', seats: 180, base: c, flights: [], spare: true }));

    // 5. connecting itineraries
    const byOrig = {}; flights.forEach(f => (byOrig[f.orig] = byOrig[f.orig] || []).push(f));
    const connPax = {}, itins = [];
    flights.slice().sort(() => rnd() - 0.5).forEach(a => {
      if (rnd() > 0.78) return;
      const cands = (byOrig[a.dest] || []).filter(d => d.tail !== a.tail && d.dest !== a.orig && d.std - a.sta >= 55 && d.std - a.sta <= 200).sort(() => rnd() - 0.5);
      for (const d of cands.slice(0, 2)) {
        const p = 8 + Math.floor(rnd() * 28);
        if ((connPax[a.id] || 0) + p > 0.5 * a.load || (connPax[d.id] || 0) + p > 0.5 * d.load) continue;
        connPax[a.id] = (connPax[a.id] || 0) + p; connPax[d.id] = (connPax[d.id] || 0) + p; itins.push({ id: itins.length, g: a.id, d: d.id, pax: p });
      }
    });
    flights.forEach(f => { f.local = f.load - (connPax[f.id] || 0); });

    // 6. map framing + an automatic first scenario at the busiest hour of the busiest airport
    let lo0 = Math.min(...airports.map(a => a.lon)), lo1 = Math.max(...airports.map(a => a.lon)), la0 = Math.min(...airports.map(a => a.lat)), la1 = Math.max(...airports.map(a => a.lat));
    const padLon = Math.max(4, (lo1 - lo0) * 0.12), padLat = Math.max(3, (la1 - la0) * 0.15);
    lo0 -= padLon; lo1 += padLon; la0 = Math.max(-60, la0 - padLat); la1 = Math.min(75, la1 + padLat);
    if (lo1 - lo0 < 28) { const c = (lo0 + lo1) / 2; lo0 = c - 14; lo1 = c + 14; }
    if (la1 - la0 < 16) { const c = (la0 + la1) / 2; la0 = c - 8; la1 = c + 8; }
    if (lo1 - lo0 > 200) { lo0 = -168; lo1 = 192; la0 = -48; la1 = 66; }
    const hubCode = codes[0], hubHour = Object.keys(perHour).filter(k => k.startsWith(hubCode + '|')).sort((x, y) => perHour[y] - perHour[x])[0];
    const stormStart = hubHour ? Math.max(t0 + 30, +hubHour.split('|')[1] * 60 - 30) : t0 + 120;
    const hubA = airportMap[hubCode], WXT = DS.WXT.Thunderstorm;
    const meta = {
      id: 'custom', name: opts.name || 'Imported schedule', t0, t1, tz: 0, tzLabel: 'schedule time', crewDuty: 840, divertRange: 1200,
      centre: { lon: (lo0 + lo1) / 2, lat: (la0 + la1) / 2 }, bounds: { lon0: lo0, lon1: lo1, lat0: la0, lat1: la1 },
      scenarios: [
        { id: 'i-auto', name: 'Thunderstorm over ' + hubCode + ' (busiest airport)', desc: 'Auto-generated: a storm closes your busiest airport (' + hubCode + ') for 90 minutes at the busiest hour of its schedule.',
          events: [{ type: 'Thunderstorm', lat: hubA.lat, lon: hubA.lon, radius: WXT.radius, start: stormStart, dur: 90, severity: 1 }] },
        { id: 'i-sandbox', name: 'Imported schedule — plant your own problems', desc: 'Your schedule with clear skies. Plant problems anywhere on the map.', events: [] }
      ]
    };
    rep.imported = flights.length; rep.tails = tails.filter(t => !t.spare).length; rep.airports = airports.length; rep.window = [t0, t1];
    rep.hub = hubCode;
    const net = { meta, seed: opts.seed || 99, airports, airportMap, airlines: Object.keys(airlinesSeen).map((c, i) => ({ code: c, name: c, color: ['#38bdf8', '#fbbf24', '#f472b6', '#a3e635', '#c4b5fd'][i % 5] })),
      tails, flights, itins, crewDuty: meta.crewDuty, divertRange: meta.divertRange, dist, blockBetween: (a, b) => DS.blockMin(dist(a, b)) };
    return { net, report: rep };
  }

  function scheduleToCSV(net) {
    const day = (t, base) => { const d = new Date(Date.UTC(2026, 10, 20) + Math.floor(t / 1440) * 864e5); const mm = ((t % 1440) + 1440) % 1440; return d.toISOString().slice(0, 10) + ' ' + String(Math.floor(mm / 60)).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0'); };
    const lines = ['flight,tail,airline,origin,destination,std,sta,seats,pax,origin_lat,origin_lon,dest_lat,dest_lon'];
    net.flights.forEach(f => { const a = net.airportMap[f.orig], b = net.airportMap[f.dest];
      lines.push([f.num, f.tail, f.airline, f.orig, f.dest, day(f.std), day(f.sta), f.seats, f.load, a.lat, a.lon, b.lat, b.lon].join(',')); });
    return lines.join('\n') + '\n';
  }

  Object.assign(DS, { parseTable, networkFromSchedule, scheduleToCSV });
  if (typeof module !== 'undefined') module.exports = DS;
})(typeof window !== 'undefined' ? window : globalThis);
