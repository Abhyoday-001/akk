/* Skylay — network data + seeded schedule generators.
   No organiser flight feed is bundled, so realistic synthetic networks are generated
   deterministically from a seed: an Indian domestic network and a worldwide network.
   To use real data, replace buildNetwork() with a loader returning the same shape:
   { meta, airports[], airportMap, airlines[], tails[], flights[], itins[], dist, blockBetween } */
(function (G) {
  'use strict';

  // cap = movements (dep+arr) per hour at normal ops in the *sampled* network
  const A = (code, city, name, lat, lon, cap, hub) => ({ code, city, name, lat, lon, cap, hub: hub ? 1 : 0 });

  const AIRPORTS_IN = [
    A('DEL', 'Delhi', 'Indira Gandhi Intl', 28.556, 77.100, 24, 1), A('BOM', 'Mumbai', 'Chhatrapati Shivaji Intl', 19.089, 72.866, 20, 1),
    A('BLR', 'Bengaluru', 'Kempegowda Intl', 13.199, 77.706, 20, 1), A('MAA', 'Chennai', 'Chennai Intl', 12.990, 80.169, 16, 1),
    A('CCU', 'Kolkata', 'Netaji Subhas Chandra Bose', 22.654, 88.447, 16, 1), A('HYD', 'Hyderabad', 'Rajiv Gandhi Intl', 17.240, 78.429, 16, 1),
    A('AMD', 'Ahmedabad', 'Sardar Vallabhbhai Patel', 23.077, 72.634, 12), A('PNQ', 'Pune', 'Pune Airport', 18.582, 73.920, 9),
    A('GOI', 'Goa', 'Manohar Intl (Mopa)', 15.380, 73.831, 9), A('COK', 'Kochi', 'Cochin Intl', 10.152, 76.402, 10),
    A('JAI', 'Jaipur', 'Jaipur Intl', 26.824, 75.812, 10), A('LKO', 'Lucknow', 'Chaudhary Charan Singh', 26.761, 80.889, 10),
    A('GAU', 'Guwahati', 'Lokpriya Gopinath Bordoloi', 26.106, 91.586, 9), A('PAT', 'Patna', 'Jay Prakash Narayan', 25.591, 85.088, 9),
    A('NAG', 'Nagpur', 'Dr Ambedkar Intl', 21.092, 79.047, 9), A('IXC', 'Chandigarh', 'Chandigarh Intl', 30.673, 76.789, 8),
    A('BBI', 'Bhubaneswar', 'Biju Patnaik Intl', 20.244, 85.818, 9), A('TRV', 'Thiruvananthapuram', 'Trivandrum Intl', 8.482, 76.920, 8)
  ];

  const AIRPORTS_WORLD = [
    // North America
    A('ATL', 'Atlanta', 'Hartsfield–Jackson', 33.640, -84.428, 24, 1), A('LAX', 'Los Angeles', 'Los Angeles Intl', 33.942, -118.408, 22, 1),
    A('JFK', 'New York', 'John F. Kennedy Intl', 40.641, -73.778, 22, 1), A('ORD', 'Chicago', "O'Hare Intl", 41.978, -87.905, 22, 1),
    A('DFW', 'Dallas', 'Dallas/Fort Worth Intl', 32.897, -97.038, 20, 1), A('SFO', 'San Francisco', 'San Francisco Intl', 37.619, -122.375, 16, 1),
    A('MIA', 'Miami', 'Miami Intl', 25.796, -80.287, 16, 1), A('SEA', 'Seattle', 'Seattle–Tacoma Intl', 47.449, -122.309, 12),
    A('YYZ', 'Toronto', 'Pearson Intl', 43.677, -79.631, 14, 1), A('MEX', 'Mexico City', 'Benito Juárez Intl', 19.436, -99.072, 14, 1),
    // South America
    A('GRU', 'São Paulo', 'Guarulhos Intl', -23.435, -46.473, 16, 1), A('EZE', 'Buenos Aires', 'Ministro Pistarini', -34.822, -58.536, 10),
    A('BOG', 'Bogotá', 'El Dorado Intl', 4.702, -74.147, 12), A('SCL', 'Santiago', 'Arturo Merino Benítez', -33.393, -70.786, 10),
    A('LIM', 'Lima', 'Jorge Chávez Intl', -12.022, -77.114, 10),
    // Europe
    A('LHR', 'London', 'Heathrow', 51.470, -0.454, 24, 1), A('CDG', 'Paris', 'Charles de Gaulle', 49.010, 2.548, 22, 1),
    A('FRA', 'Frankfurt', 'Frankfurt Airport', 50.038, 8.562, 22, 1), A('AMS', 'Amsterdam', 'Schiphol', 52.309, 4.764, 20, 1),
    A('MAD', 'Madrid', 'Barajas', 40.494, -3.567, 16, 1), A('FCO', 'Rome', 'Fiumicino', 41.800, 12.252, 14, 1),
    A('IST', 'Istanbul', 'Istanbul Airport', 41.262, 28.742, 22, 1), A('ZRH', 'Zurich', 'Zürich Airport', 47.458, 8.548, 12),
    A('CPH', 'Copenhagen', 'Kastrup', 55.618, 12.650, 12), A('DUB', 'Dublin', 'Dublin Airport', 53.421, -6.270, 12),
    A('LIS', 'Lisbon', 'Humberto Delgado', 38.774, -9.134, 10), A('HEL', 'Helsinki', 'Helsinki-Vantaa', 60.317, 24.963, 10),
    A('SVO', 'Moscow', 'Sheremetyevo', 55.973, 37.415, 14),
    // Middle East & Africa
    A('DXB', 'Dubai', 'Dubai Intl', 25.253, 55.366, 24, 1), A('DOH', 'Doha', 'Hamad Intl', 25.273, 51.608, 16, 1),
    A('AUH', 'Abu Dhabi', 'Zayed Intl', 24.433, 54.651, 12), A('JED', 'Jeddah', 'King Abdulaziz Intl', 21.680, 39.157, 12),
    A('TLV', 'Tel Aviv', 'Ben Gurion', 32.011, 34.887, 10), A('CAI', 'Cairo', 'Cairo Intl', 30.122, 31.406, 12),
    A('ADD', 'Addis Ababa', 'Bole Intl', 8.978, 38.799, 12), A('NBO', 'Nairobi', 'Jomo Kenyatta Intl', -1.319, 36.928, 10),
    A('JNB', 'Johannesburg', 'O.R. Tambo Intl', -26.139, 28.246, 14, 1), A('CPT', 'Cape Town', 'Cape Town Intl', -33.965, 18.602, 9),
    A('LOS', 'Lagos', 'Murtala Muhammed', 6.577, 3.321, 9), A('CMN', 'Casablanca', 'Mohammed V Intl', 33.367, -7.590, 9),
    // Asia
    A('DEL', 'Delhi', 'Indira Gandhi Intl', 28.556, 77.100, 20, 1), A('BOM', 'Mumbai', 'Chhatrapati Shivaji Intl', 19.089, 72.866, 16, 1),
    A('BLR', 'Bengaluru', 'Kempegowda Intl', 13.199, 77.706, 12), A('MAA', 'Chennai', 'Chennai Intl', 12.990, 80.169, 10),
    A('CCU', 'Kolkata', 'Netaji Subhas Chandra Bose', 22.654, 88.447, 10), A('HYD', 'Hyderabad', 'Rajiv Gandhi Intl', 17.240, 78.429, 10),
    A('CMB', 'Colombo', 'Bandaranaike Intl', 7.180, 79.884, 8), A('DAC', 'Dhaka', 'Hazrat Shahjalal Intl', 23.843, 90.398, 9),
    A('KHI', 'Karachi', 'Jinnah Intl', 24.906, 67.161, 9), A('LHE', 'Lahore', 'Allama Iqbal Intl', 31.522, 74.404, 8),
    A('SIN', 'Singapore', 'Changi', 1.364, 103.991, 22, 1), A('BKK', 'Bangkok', 'Suvarnabhumi', 13.690, 100.750, 18, 1),
    A('KUL', 'Kuala Lumpur', 'KLIA', 2.746, 101.710, 14), A('CGK', 'Jakarta', 'Soekarno–Hatta', -6.126, 106.656, 14),
    A('MNL', 'Manila', 'Ninoy Aquino Intl', 14.509, 121.020, 12), A('HKG', 'Hong Kong', 'Hong Kong Intl', 22.309, 113.915, 22, 1),
    A('CAN', 'Guangzhou', 'Baiyun Intl', 23.392, 113.299, 18, 1), A('PEK', 'Beijing', 'Capital Intl', 40.080, 116.585, 20, 1),
    A('PVG', 'Shanghai', 'Pudong Intl', 31.144, 121.805, 20, 1), A('TPE', 'Taipei', 'Taoyuan Intl', 25.077, 121.233, 14),
    A('ICN', 'Seoul', 'Incheon Intl', 37.460, 126.440, 18, 1), A('NRT', 'Tokyo', 'Narita', 35.772, 140.393, 14),
    A('HND', 'Tokyo', 'Haneda', 35.549, 139.780, 18, 1), A('KIX', 'Osaka', 'Kansai Intl', 34.427, 135.244, 12),
    // Oceania
    A('SYD', 'Sydney', 'Kingsford Smith', -33.946, 151.177, 14, 1), A('MEL', 'Melbourne', 'Tullamarine', -37.673, 144.843, 12),
    A('PER', 'Perth', 'Perth Airport', -31.940, 115.967, 9), A('AKL', 'Auckland', 'Auckland Airport', -37.008, 174.792, 10)
  ];

  const AIRLINES = [
    { code: 'SK', name: 'Skylay Air',      color: '#38bdf8' },
    { code: 'IW', name: 'Indus Wings',     color: '#f472b6' },
    { code: 'KE', name: 'Kaveri Express',  color: '#a3e635' }
  ];
  const AIRLINES_WORLD = [
    { code: 'SK', name: 'Skylay Air',      color: '#38bdf8' },
    { code: 'GL', name: 'Globelink',       color: '#fbbf24' },
    { code: 'MR', name: 'Meridian Airways',color: '#f472b6' },
    { code: 'AU', name: 'Aurora Pacific',  color: '#a3e635' }
  ];

  // Problem types. radius in km; severity 0..1 (>=0.9 closes an airport outright);
  // enroute = also forces flights routed through the cell to detour around it.
  const WXT = {
    'Thunderstorm':   { icon: '⛈', radius: 200, dur: 90,  severity: 1,    enroute: true,  c: '124,92,255',  core: '255,60,120',  kind: 'Weather' },
    'Cyclone':        { icon: '🌀', radius: 350, dur: 300, severity: 1,    enroute: true,  c: '40,200,200',  core: '90,120,255',  kind: 'Weather' },
    'Dust storm':     { icon: '🌪', radius: 260, dur: 150, severity: 0.6,  enroute: true,  c: '230,150,60',  core: '250,190,90',  kind: 'Weather' },
    'Snowstorm':      { icon: '❄', radius: 300, dur: 240, severity: 0.8,  enroute: false, c: '170,205,255', core: '255,255,255', kind: 'Weather' },
    'Fog':            { icon: '🌫', radius: 240, dur: 240, severity: 0.72, enroute: false, c: '170,185,205', core: '220,230,240', kind: 'Weather' },
    'Volcanic ash':   { icon: '🌋', radius: 600, dur: 480, severity: 0.95, enroute: true,  c: '150,140,130', core: '200,70,50',   kind: 'Weather' },
    'Runway closure': { icon: '🚧', radius: 40,  dur: 180, severity: 0.5,  enroute: false, c: '251,191,36',  core: '251,146,60',  kind: 'Operational' },
    'ATC outage':     { icon: '📡', radius: 130, dur: 120, severity: 0.85, enroute: false, c: '56,189,248',  core: '255,255,255', kind: 'Operational' }
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hav(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const blockMin = km => Math.round((km / 780 * 60 + 30) / 5) * 5;

  // how strongly a problem hits an airport: full inside 60% of the radius, fading to zero at the edge
  function effSev(e, a) {
    const d = hav(e, a), R = e.radius;
    if (d >= R) return 0;
    const core = 0.6 * R;
    return d <= core ? e.severity : e.severity * (R - d) / (R - core);
  }
  const eventMaker = list => (code, type, start, dur, severity, radius) => {
    const a = list.find(x => x.code === code), t = WXT[type];
    return { type, lat: a.lat, lon: a.lon, radius: radius || t.radius, start, dur: dur || t.dur, severity: severity == null ? t.severity : severity };
  };
  const mkEvent = eventMaker(AIRPORTS_IN);
  const mkWorld = eventMaker(AIRPORTS_WORLD);
  const free = (type, lat, lon, start, dur, severity, radius) => { const t = WXT[type]; return { type, lat, lon, start, dur: dur || t.dur, severity: severity == null ? t.severity : severity, radius: radius || t.radius }; };

  const SCEN_IN = [
    { id: 'bom-monsoon', name: 'Mumbai monsoon burst',
      desc: 'A violent thunderstorm cell parks over Mumbai and closes the airport for 90 minutes at 10:00.',
      events: [mkEvent('BOM', 'Thunderstorm', 600, 90, 1)] },
    { id: 'del-fog', name: 'Delhi winter fog',
      desc: 'Dense fog cuts Delhi to ~30% capacity from 05:30 to 10:00 — a slow bleed rather than a hard stop.',
      events: [mkEvent('DEL', 'Fog', 330, 270, 0.72)] },
    { id: 'maa-cyclone', name: 'Cyclone landfall — Chennai',
      desc: 'A cyclone closes Chennai for 5 hours from 12:30. Inbound flights must hold, divert or be kept on the ground.',
      events: [mkEvent('MAA', 'Cyclone', 750, 300, 1)] },
    { id: 'double', name: 'Monsoon trough: Mumbai + Kolkata',
      desc: 'Two systems in one day: Mumbai closes at 10:00 for 90 min, Kolkata is hit by a squall line at 14:00 for 2 hours.',
      events: [mkEvent('BOM', 'Thunderstorm', 600, 90, 1), mkEvent('CCU', 'Thunderstorm', 840, 120, 0.9)] },
    { id: 'custom', name: 'Sandbox — plant your own problems',
      desc: 'Clear sky. Pick a problem type, click anywhere on the map to plant it, drag to move it, and edit it on the left.', events: [] }
  ];
  const SCEN_WORLD = [
    { id: 'w-atlantic', name: 'North Atlantic winter storm',
      desc: 'A deep snowstorm sits over London, Paris and Amsterdam from 08:00 UTC for 6 hours. Transatlantic and intra-Europe rotations unravel.',
      events: [free('Snowstorm', 51.0, 2.0, 480, 360, 0.85, 480)] },
    { id: 'w-typhoon', name: 'Typhoon — Hong Kong & Guangzhou',
      desc: 'A typhoon closes Hong Kong and Guangzhou from 10:00 UTC for 7 hours, severing the main Asia–Pacific connection bank.',
      events: [free('Cyclone', 22.5, 114.0, 600, 420, 1, 420)] },
    { id: 'w-hurricane', name: 'Hurricane Miami + Atlanta squall line',
      desc: 'A hurricane closes Miami from 13:00 UTC while a squall line later chokes Atlanta — the Americas hub system takes two hits.',
      events: [free('Cyclone', 26.0, -80.5, 780, 480, 1, 500), mkWorld('ATL', 'Thunderstorm', 1020, 150, 0.9, 260)] },
    { id: 'w-ash', name: 'Volcanic ash over Northern Europe',
      desc: 'An ash plume drifts from the north Atlantic over Ireland and the UK for 8 hours from 06:00 UTC, closing airports and forcing detours around the cloud.',
      events: [free('Volcanic ash', 56.0, -5.0, 360, 480, 0.95, 850)] },
    { id: 'w-custom', name: 'World sandbox — plant your own problems',
      desc: 'Clear skies worldwide. Plant storms, ash, outages or fog anywhere on the globe; drag them across oceans and watch the network react.', events: [] }
  ];

  function buildNetwork(kind, seed) {
    kind = kind === 'world' ? 'world' : 'india';
    const W = kind === 'world';
    const rnd = mulberry32(seed || (W ? 7331 : 2024));
    // world airports are cloned with capacity scaled to the sampled traffic density
    const airports = W ? AIRPORTS_WORLD.map(a => Object.assign({}, a, { cap: Math.max(6, Math.round(a.cap * 0.6)) })) : AIRPORTS_IN;
    const airlines = W ? AIRLINES_WORLD : AIRLINES;
    const airportMap = {}; airports.forEach(a => airportMap[a.code] = a);
    const codes = airports.map(a => a.code);
    const dist = (a, b) => hav(airportMap[a], airportMap[b]);

    const basePlan = W
      ? [['ATL', 5], ['LAX', 4], ['JFK', 5], ['ORD', 4], ['DFW', 4], ['SFO', 3], ['MIA', 3], ['SEA', 2], ['YYZ', 3], ['MEX', 2], ['GRU', 3], ['EZE', 1], ['BOG', 2], ['SCL', 1], ['LIM', 1],
         ['LHR', 7], ['CDG', 5], ['FRA', 5], ['AMS', 4], ['MAD', 3], ['FCO', 3], ['IST', 5], ['ZRH', 2], ['CPH', 1], ['DUB', 2], ['LIS', 1], ['HEL', 1], ['SVO', 2],
         ['DXB', 7], ['DOH', 4], ['AUH', 2], ['JED', 2], ['TLV', 1], ['CAI', 2], ['ADD', 2], ['NBO', 1], ['JNB', 3], ['CPT', 1], ['LOS', 1], ['CMN', 1],
         ['DEL', 4], ['BOM', 4], ['BLR', 2], ['MAA', 1], ['CCU', 1], ['HYD', 1], ['CMB', 1], ['DAC', 1], ['KHI', 1], ['LHE', 1],
         ['SIN', 5], ['BKK', 3], ['KUL', 2], ['CGK', 2], ['MNL', 1], ['HKG', 5], ['CAN', 3], ['PEK', 4], ['PVG', 4], ['TPE', 2], ['ICN', 4], ['NRT', 3], ['HND', 3], ['KIX', 1],
         ['SYD', 3], ['MEL', 2], ['PER', 1], ['AKL', 2]]
      : [['DEL', 16], ['BOM', 16], ['BLR', 13], ['MAA', 9], ['CCU', 9], ['HYD', 9], ['AMD', 4], ['PNQ', 2],
         ['GOI', 2], ['COK', 4], ['JAI', 3], ['LKO', 3], ['GAU', 2], ['PAT', 2], ['BBI', 2], ['NAG', 2], ['IXC', 2], ['TRV', 2]];
    const spareBases = W ? ['LHR', 'JFK', 'DXB', 'SIN', 'HKG', 'FRA', 'ATL', 'LAX', 'SYD', 'GRU'] : ['DEL', 'BOM', 'BLR', 'MAA', 'CCU', 'HYD'];
    const usedReg = new Set(), usedNum = new Set();
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const regPrefix = W ? ['N', 'G-', 'D-', 'VT-', 'B-', 'A6-', 'VH-', 'PR-'] : ['VT-'];
    const reg = () => { let r; do { const p = regPrefix[Math.floor(rnd() * regPrefix.length)]; r = p + letters[Math.floor(rnd() * 26)] + letters[Math.floor(rnd() * 26)] + letters[Math.floor(rnd() * 26)]; } while (usedReg.has(r)); usedReg.add(r); return r; };

    function pickDest(cur, maxKm) {
      const opts = []; let tot = 0;
      for (const c of codes) {
        if (c === cur) continue;
        const d = dist(cur, c);
        if (d < (W ? 450 : 250) || d > maxKm) continue;
        let w = airportMap[c].hub ? 3 : 1;
        if (!airportMap[cur].hub && !airportMap[c].hub) w *= 0.12;
        w *= W ? (d < 1500 ? 1.0 : d < 5000 ? 1.15 : 0.9) : (d < 500 ? 0.5 : (d < 1700 ? 1.2 : 0.7));
        opts.push([c, w]); tot += w;
      }
      let r = rnd() * tot;
      for (const [c, w] of opts) { r -= w; if (r <= 0) return c; }
      return opts[0][0];
    }

    const tails = [], flights = [];
    let airlineIx = 0;
    for (const [base, count0] of basePlan) {
      const count = W ? Math.round(count0 * 2) : count0;
      for (let k = 0; k < count; k++) {
        const airline = airlines[airlineIx++ % airlines.length].code;
        const wide = W && rnd() < 0.3;
        const seats = wide ? (rnd() < 0.5 ? 296 : 335) : (rnd() < 0.2 ? 222 : (rnd() < 0.5 ? 186 : 180));
        const type = wide ? (seats > 300 ? 'B787-9' : 'A330-300') : seats > 200 ? 'A321neo' : (seats === 186 ? 'B737-8' : 'A320neo');
        const maxKm = W ? (wide ? 10500 : 4800) : 2300;
        const tail = { id: reg(), airline, type, seats, base, flights: [], spare: false, wide };
        let t = W ? Math.floor(rnd() * 97) * 10 : 330 + Math.floor(rnd() * 31) * 10;   // world: 00:00–16:00 UTC, India: 05:30–10:30
        const firstStd = t; let cur = base;
        const span = W ? 810 : 660;
        for (;;) {
          const dest = pickDest(cur, maxKm), blk = blockMin(dist(cur, dest));
          if (t + blk > firstStd + span || t > (W ? 1500 : 1290)) break;
          let num; do { num = airline + (100 + Math.floor(rnd() * 880)); } while (usedNum.has(num)); usedNum.add(num);
          const load = Math.round(seats * (0.7 + rnd() * 0.22));
          const noise = rnd() < 0.25 ? 5 + Math.floor(rnd() * 10) : 0;
          const f = { id: flights.length, num, tail: tail.id, airline, orig: cur, dest, std: t, sta: t + blk, block: blk, seats, load, noise, idx: tail.flights.length, local: load };
          flights.push(f); tail.flights.push(f.id);
          t = t + blk + 35 + 5 * Math.floor(rnd() * 4);   // 35 min minimum turn + 0–15 min buffer
          cur = dest;
        }
        if (tail.flights.length) tails.push(tail);
      }
    }
    spareBases.forEach((b, i) => {
      tails.push({ id: (W ? 'SP-' : 'VT-') + 'S' + (i + 1) + 'R', airline: airlines[i % airlines.length].code, type: 'A320neo', seats: 180, base: b, flights: [], spare: true });
    });

    // Connecting itineraries (two-leg trips through any airport)
    const byOrig = {};
    flights.forEach(f => (byOrig[f.orig] = byOrig[f.orig] || []).push(f));
    const order = flights.slice().sort(() => rnd() - 0.5);
    const connPax = {}; const itins = [];
    for (const a of order) {
      if (rnd() > 0.78) continue;
      const cands = (byOrig[a.dest] || []).filter(d => d.tail !== a.tail && d.dest !== a.orig && d.std - a.sta >= 55 && d.std - a.sta <= 200);
      cands.sort(() => rnd() - 0.5);
      for (const d of cands.slice(0, 2)) {
        const p = 8 + Math.floor(rnd() * 28);
        if ((connPax[a.id] || 0) + p > 0.5 * a.load || (connPax[d.id] || 0) + p > 0.5 * d.load) continue;
        connPax[a.id] = (connPax[a.id] || 0) + p; connPax[d.id] = (connPax[d.id] || 0) + p;
        itins.push({ id: itins.length, g: a.id, d: d.id, pax: p });
      }
    }
    flights.forEach(f => { f.local = f.load - (connPax[f.id] || 0); });

    const meta = W
      ? { id: 'world', name: 'Worldwide', t0: 0, t1: 1800, tz: 0, tzLabel: 'UTC', crewDuty: 1020, divertRange: 1800, centre: { lon: 15, lat: 28 }, bounds: { lon0: -168, lon1: 192, lat0: -48, lat1: 66 }, scenarios: SCEN_WORLD }
      : { id: 'india', name: 'India domestic', t0: 300, t1: 1800, tz: 330, tzLabel: 'IST', crewDuty: 840, divertRange: 900, centre: { lon: 82, lat: 21.5 }, bounds: { lon0: 66, lon1: 99, lat0: 5.5, lat1: 36.5 }, scenarios: SCEN_IN };
    return { meta, seed: seed || (W ? 7331 : 2024), airports, airportMap, airlines, tails, flights, itins,
             crewDuty: meta.crewDuty, divertRange: meta.divertRange,
             dist, blockBetween: (a, b) => blockMin(dist(a, b)) };
  }

  G.DS = G.DS || {};
  Object.assign(G.DS, { AIRPORTS: AIRPORTS_IN, AIRPORTS_WORLD, AIRLINES, SCENARIOS: SCEN_IN, SCENARIOS_WORLD: SCEN_WORLD, WXT, effSev, mkEvent, mkWorld, buildNetwork, hav, blockMin, mulberry32 });
  if (typeof module !== 'undefined') module.exports = G.DS;
})(typeof window !== 'undefined' ? window : globalThis);
