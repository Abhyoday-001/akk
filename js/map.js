/* Skylay — realistic canvas map.
   Natural Earth 1:50m geometry, Web-Mercator with world wrap, great-circle routes,
   live day/night terminator, airliner sprites with shadows and contrails, light/dark palettes. */
(function (G) {
  'use strict';
  const DS = G.DS, PI = Math.PI, RAD = PI / 180;
  const clampLat = l => Math.max(-85, Math.min(85, l));
  const mercY = lat => Math.log(Math.tan(PI / 4 + clampLat(lat) * RAD / 2)) / RAD;       // degree-equivalent mercator ordinate
  const invMerc = v => (2 * Math.atan(Math.exp(v * RAD)) - PI / 2) / RAD;
  const KM_DEG = 111.32;
  const GEN = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#a3a3a3'];
  const colDelay = d => d <= 15 ? '#34d399' : d <= 45 ? '#fbbf24' : d <= 120 ? '#fb923c' : '#f87171';
  const colGen = g => g < 0 ? '#34d399' : GEN[Math.min(g, 4)];
  const WX = DS.WXT;

  // ---------------------------------------------------------------- palettes
  const PALS = {
    dark: {
      name: 'dark', ocean0: '#071a2b', ocean1: '#0b2a42', grid: 'rgba(150,200,235,.07)', gridText: 'rgba(160,200,230,.38)',
      land: [[75, '#8f9ea8'], [62, '#46584f'], [48, '#2c4a38'], [32, '#4a4a32'], [18, '#34503a'], [0, '#1f4a35'], [-18, '#2f4f38'], [-32, '#4d4b34'], [-50, '#34503e'], [-60, '#8f9ea8']],
      border: 'rgba(190,215,230,.30)', coast: 'rgba(130,205,240,.80)', shelf: 'rgba(90,170,220,.16)', label: 'rgba(215,230,240,.42)',
      route: 'rgba(150,200,255,.11)', halo: 'rgba(6,16,28,.88)', apRing: '#f1f6fb', apFill: '#0a1626', apText: '#e8f1f8', night: [4, 9, 24],
      nightAlpha: 0.62, shadow: 'rgba(0,0,0,.40)', plane: '#06101f'
    },
    light: {
      name: 'light', ocean0: '#bcd9ec', ocean1: '#a5cbe4', grid: 'rgba(40,90,130,.10)', gridText: 'rgba(30,70,105,.55)',
      land: [[75, '#f4f7f9'], [62, '#d5e0d3'], [48, '#cddfb8'], [32, '#e7dcb9'], [18, '#c3d9a5'], [0, '#b4d19a'], [-18, '#c3d8a6'], [-32, '#e5d9b6'], [-50, '#cbddb8'], [-60, '#f4f7f9']],
      border: 'rgba(90,110,125,.45)', coast: 'rgba(55,105,140,.85)', shelf: 'rgba(255,255,255,.35)', label: 'rgba(40,60,75,.50)',
      route: 'rgba(30,80,140,.12)', halo: 'rgba(255,255,255,.90)', apRing: '#10304a', apFill: '#ffffff', apText: '#10263a', night: [20, 35, 70],
      nightAlpha: 0.34, shadow: 'rgba(20,40,60,.30)', plane: '#12263c'
    }
  };
  DS.pal = PALS.dark; DS.themeName = 'dark';
  DS.setTheme = name => { DS.pal = PALS[name] || PALS.dark; DS.themeName = DS.pal.name; };

  function wxFactor(weather, code, t) {
    let f = 1; const a = (DS.airportMap || {})[code]; if (!a) return 1;
    for (const e of weather) {
      if (t < e.start || t >= e.start + e.dur) continue;
      const v = DS.effSev(e, a); if (v > 0.04) f = Math.min(f, v >= 0.9 ? 0 : 1 - v);
    }
    return f;
  }

  // Where is a flight at time t?
  function flightPhase(net, f, t) {
    if (f.status === 'cancelled') return { ph: 'cancelled' };
    if (t < f.adep) return { ph: t >= f.std ? 'waiting' : 'scheduled' };
    if (t < f.eta) return { ph: 'air', a: f.orig, b: f.dest, p: (t - f.adep) / Math.max(1, f.eta - f.adep) };
    if (f.divert == null) return t < f.aarr ? { ph: 'hold', at: f.dest } : { ph: 'landed' };
    if (t < f.divArr) return { ph: 'divert', a: f.dest, b: f.divert, p: (t - f.eta) / Math.max(1, f.divArr - f.eta) };
    if (t < f.ferryDep) return { ph: 'atalt', at: f.divert };
    const ft = net.blockBetween(f.divert, f.dest);
    if (t < f.ferryDep + ft) return { ph: 'ferry', a: f.divert, b: f.dest, p: (t - f.ferryDep) / ft };
    return t < f.ferryArr ? { ph: 'hold', at: f.dest } : { ph: 'landed' };
  }

  // ---------------------------------------------------------------- geography
  const GEO = { ready: false, countries: [], coast: [], border: [] };
  (function decode() {
    const topo = G.WORLD_TOPO; if (!topo) return;
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(p => { x += p[0]; y += p[1]; return [x * sx + tx, y * sy + ty]; }); });
    const use = new Array(arcs.length).fill(0);
    const unwrap = pts => { const out = new Float32Array(pts.length * 2); let prev = pts[0][0], off = 0;
      pts.forEach((p, i) => { let lon = p[0] + off; if (i && Math.abs(lon - prev) > 180) { off += lon < prev ? 360 : -360; lon = p[0] + off; } prev = lon; out[i * 2] = lon; out[i * 2 + 1] = p[1]; }); return out; };
    const ringPts = ring => { const pts = []; ring.forEach((i, k) => { const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i]; for (let j = k ? 1 : 0; j < a.length; j++) pts.push(a[j]); }); return pts; };
    for (const g of topo.objects.countries.geometries) {
      const name = g.properties && g.properties.name; if (name === 'Antarctica') continue;
      const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
      const rings = []; let best = null, bestArea = -1;
      polys.forEach(poly => poly.forEach((ring, ri) => {
        ring.forEach(i => { use[i < 0 ? ~i : i]++; });
        const pts = unwrap(ringPts(ring)); let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
        for (let i = 0; i < pts.length; i += 2) { mnx = Math.min(mnx, pts[i]); mxx = Math.max(mxx, pts[i]); mny = Math.min(mny, pts[i + 1]); mxy = Math.max(mxy, pts[i + 1]); }
        const r = { pts, bb: [mnx, mny, mxx, mxy] }; rings.push(r);
        const area = (mxx - mnx) * (mxy - mny); if (ri === 0 && area > bestArea) { bestArea = area; best = r.bb; }
      }));
      if (rings.length) GEO.countries.push({ name, rings, main: best });
    }
    arcs.forEach((a, i) => {
      if (use[i] < 1 || use[i] > 2) return;
      if (a.every(p => Math.abs(p[0]) > 179.9) || a.every(p => p[1] < -60)) return;      // antimeridian cuts, Antarctica
      (use[i] === 1 ? GEO.coast : GEO.border).push(unwrap(a));
    });
    GEO.ready = true;
  })();

  // ---------------------------------------------------------------- great circles
  const gcCache = new Map(), GCN = 64;
  function gc(a, b) {
    const key = a.code + b.code; let r = gcCache.get(key); if (r) return r;
    const la1 = a.lat * RAD, lo1 = a.lon * RAD, la2 = b.lat * RAD, lo2 = b.lon * RAD;
    const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2)) || 1e-9;
    r = new Float32Array((GCN + 1) * 2); let prev = a.lon, off = 0;
    for (let i = 0; i <= GCN; i++) {
      const f = i / GCN, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2), y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2), z = A * Math.sin(la1) + B * Math.sin(la2);
      let lon = Math.atan2(y, x) / RAD + off; if (i && Math.abs(lon - prev) > 180) { off += lon < prev ? 360 : -360; lon = Math.atan2(y, x) / RAD + off; } prev = lon;
      r[i * 2] = lon; r[i * 2 + 1] = Math.atan2(z, Math.hypot(x, y)) / RAD;
    }
    gcCache.set(key, r); return r;
  }
  function samplePos(arr, p) {
    p = Math.max(0, Math.min(1, p)); const f = p * GCN, i = Math.min(GCN - 1, Math.floor(f)), t = f - i;
    return [arr[i * 2] + (arr[i * 2 + 2] - arr[i * 2]) * t, arr[i * 2 + 1] + (arr[i * 2 + 3] - arr[i * 2 + 1]) * t];
  }

  // ---------------------------------------------------------------- view
  function MapView(canvas, getState, hooks) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.gs = getState; this.hooks = hooks || {};
    this.v = { s: 10, lon0: 0, m0: 0, ox: 0, oy: 0 }; this.hit = []; this.W = 0; this.H = 0; this.dpr = 1; this.hover = null;
    this.sc = document.createElement('canvas'); this.skey = ''; this.nightCv = document.createElement('canvas'); this.nightCv.width = 360; this.nightCv.height = 170; this.nkey = '';
    this.bind(); this.resize();
  }
  MapView.prototype.meta = function () { return this.gs().net.meta; };
  MapView.prototype.fitScale = function () {
    const b = this.meta().bounds; return Math.min(this.W / (b.lon1 - b.lon0), this.H / (mercY(b.lat1) - mercY(b.lat0))) * 0.98;
  };
  MapView.prototype.resize = function () {
    const r = this.c.getBoundingClientRect(); this.dpr = window.devicePixelRatio || 1; this.W = r.width; this.H = r.height;
    this.c.width = Math.max(1, Math.round(r.width * this.dpr)); this.c.height = Math.max(1, Math.round(r.height * this.dpr));
    this.sc.width = this.c.width; this.sc.height = this.c.height; this.skey = '';
    if (!this.fitted || !this.userMoved) this.recenter();
  };
  MapView.prototype.recenter = function () {
    const m = this.meta(), b = m.bounds;
    this.v.s = this.fitScale(); this.v.lon0 = m.centre.lon; this.v.m0 = (mercY(b.lat0) + mercY(b.lat1)) / 2; this.v.ox = 0; this.v.oy = 0;
    this.fitted = true; this.userMoved = false; this.skey = '';
  };
  MapView.prototype.P = function (lon, lat) {
    const v = this.v; return [this.W / 2 + v.ox + (lon - v.lon0) * v.s, this.H / 2 + v.oy - (mercY(lat) - v.m0) * v.s];
  };
  MapView.prototype.unP = function (x, y) {
    const v = this.v; let lon = v.lon0 + (x - this.W / 2 - v.ox) / v.s; lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return [lon, invMerc(v.m0 - (y - this.H / 2 - v.oy) / v.s)];
  };
  MapView.prototype.copies = function (x, margin) { // x positions of this point's world copies that are on screen
    const span = 360 * this.v.s, out = [], m = margin == null ? 30 : margin;
    const x0 = ((x % span) + span) % span - span;           // leftmost copy
    for (let k = 0; k < 4; k++) { const xx = x0 + k * span; if (xx >= -m && xx <= this.W + m) out.push(xx); }
    return out;
  };
  const kmToPx = (v, km, lat) => km / KM_DEG * v.s / Math.max(0.2, Math.cos(clampLat(lat) * RAD));

  MapView.prototype.bind = function () {
    const c = this.c; let drag = null, evDrag = null;
    c.addEventListener('mousedown', e => {
      const h = this.hooks.placing && this.hooks.placing() ? null : this.pick(e);
      if (h && h.type === 'wx') { evDrag = { id: h.id, moved: false, x: e.clientX, y: e.clientY }; return; }
      drag = { x: e.clientX, y: e.clientY, ox: this.v.ox, oy: this.v.oy, moved: false };
    });
    window.addEventListener('mousemove', e => {
      if (evDrag) {
        if (Math.abs(e.clientX - evDrag.x) + Math.abs(e.clientY - evDrag.y) > 4) evDrag.moved = true;
        if (evDrag.moved) { const r = c.getBoundingClientRect(), ll = this.unP(e.clientX - r.left, e.clientY - r.top); this.hooks.dragEvent && this.hooks.dragEvent(evDrag.id, ll[0], ll[1], false); c.style.cursor = 'grabbing'; }
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; c.classList.add('drag'); this.userMoved = true; }
        if (drag.moved) { this.v.ox = drag.ox + dx; this.v.oy = drag.oy + dy; this.clampPan(); }
      }
    });
    window.addEventListener('mouseup', e => {
      if (evDrag) {
        if (!evDrag.moved && Math.abs(e.clientX - evDrag.x) + Math.abs(e.clientY - evDrag.y) > 4) evDrag.moved = true;
        if (evDrag.moved) { const r = c.getBoundingClientRect(), ll = this.unP(e.clientX - r.left, e.clientY - r.top); this.hooks.dragEvent && this.hooks.dragEvent(evDrag.id, ll[0], ll[1], true); }
        else this.hooks.select && this.hooks.select({ type: 'wx', id: evDrag.id });
        evDrag = null; return;
      }
      if (drag && !drag.moved && e.target === c) this.click(e);
      drag = null; c.classList.remove('drag');
    });
    c.addEventListener('mousemove', e => { const r = c.getBoundingClientRect(); this.mouse = [e.clientX - r.left, e.clientY - r.top]; if (!drag && !evDrag) this.move(e); });
    c.addEventListener('mouseleave', () => { this.mouse = null; this.hover = null; this.hooks.hover && this.hooks.hover(null); });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, fit = this.fitScale();
      const k = Math.exp(-e.deltaY * 0.0015), ns = Math.max(fit * 0.85, Math.min(fit * 90, this.v.s * k));
      const v = this.v, lonAt = v.lon0 + (mx - this.W / 2 - v.ox) / v.s, mAt = v.m0 - (my - this.H / 2 - v.oy) / v.s;
      v.s = ns; v.ox = mx - this.W / 2 - (lonAt - v.lon0) * ns; v.oy = my - this.H / 2 + (mAt - v.m0) * ns;
      this.userMoved = true; this.clampPan();
    }, { passive: false });
  };
  MapView.prototype.clampPan = function () {
    const v = this.v, lim = mercY(80);
    const top = this.H / 2 + v.oy - (lim - v.m0) * v.s, bot = this.H / 2 + v.oy - (-lim - v.m0) * v.s;
    if (top > this.H * 0.45) v.oy -= top - this.H * 0.45;
    if (bot < this.H * 0.55) v.oy += this.H * 0.55 - bot;
  };
  MapView.prototype.pick = function (e) {
    const r = this.c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 1e9;
    for (const h of this.hit) { const d = Math.hypot(h.x - x, h.y - y) - (h.type === 'flight' ? 3 : h.type === 'wx' ? 7 : 0); if (d < h.r && d < bd) { bd = d; best = h; } }
    return best;
  };
  MapView.prototype.move = function (e) {
    const placing = this.hooks.placing && this.hooks.placing();
    const h = placing ? null : this.pick(e); this.hover = h; this.c.style.cursor = placing ? 'crosshair' : h ? (h.type === 'wx' ? 'move' : 'pointer') : 'grab';
    this.hooks.hover && this.hooks.hover(h, e.clientX, e.clientY);
  };
  MapView.prototype.click = function (e) {
    if (this.hooks.placing && this.hooks.placing()) { const r = this.c.getBoundingClientRect(), ll = this.unP(e.clientX - r.left, e.clientY - r.top); this.hooks.place && this.hooks.place(ll[0], ll[1]); return; }
    const h = this.pick(e); this.hooks.select && this.hooks.select(h || null);
  };

  // ---------------------------------------------------------------- static layer (land, borders, graticule, routes)
  MapView.prototype.renderStatic = function (S) {
    const pal = DS.pal, v = this.v, W = this.W, H = this.H, c = this.sc.getContext('2d'), span = 360 * v.s;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const og = c.createLinearGradient(0, 0, 0, H); og.addColorStop(0, pal.ocean0); og.addColorStop(1, pal.ocean1); c.fillStyle = og; c.fillRect(0, 0, W, H);
    const yOf = lat => H / 2 + v.oy - (mercY(lat) - v.m0) * v.s;
    // graticule
    const step = v.s > 90 ? 1 : v.s > 40 ? 2 : v.s > 18 ? 5 : v.s > 8 ? 10 : 30;
    c.lineWidth = 1; c.strokeStyle = pal.grid; c.fillStyle = pal.gridText; c.font = '10px ui-monospace,monospace'; c.beginPath();
    const lonL = v.lon0 + (-W / 2 - 40 - v.ox) / v.s, lonR = v.lon0 + (W / 2 + 40 - v.ox) / v.s;
    for (let lon = Math.floor(lonL / step) * step; lon <= lonR; lon += step) { const x = W / 2 + v.ox + (lon - v.lon0) * v.s; c.moveTo(x, 0); c.lineTo(x, H); }
    for (let lat = -80; lat <= 80; lat += step) { const y = yOf(lat); if (y > -5 && y < H + 5) { c.moveTo(0, y); c.lineTo(W, y); } }
    c.stroke();
    for (let lat = -60; lat <= 80; lat += Math.max(step, 10)) { const y = yOf(lat); if (y > 12 && y < H - 4) c.fillText(Math.abs(lat) + '°' + (lat < 0 ? 'S' : lat > 0 ? 'N' : ''), 5, y - 3); }
    if (!GEO.ready) return;
    // land, tinted by latitude like a physical map
    const lg = c.createLinearGradient(0, yOf(75), 0, yOf(-60)), den = (yOf(-60) - yOf(75)) || 1;
    pal.land.forEach(([lat, col]) => lg.addColorStop(Math.max(0, Math.min(1, (yOf(lat) - yOf(75)) / den)), col));
    const minD = 0.65;
    const trace = (pts, off, close) => {
      let lx = 0, ly = 0, first = true;
      for (let i = 0; i < pts.length; i += 2) {
        const x = W / 2 + v.ox + (pts[i] - v.lon0) * v.s + off, y = H / 2 + v.oy - (mercY(pts[i + 1]) - v.m0) * v.s;
        if (first) { c.moveTo(x, y); lx = x; ly = y; first = false; }
        else if (Math.abs(x - lx) + Math.abs(y - ly) >= minD || i === pts.length - 2) { c.lineTo(x, y); lx = x; ly = y; }
      }
      if (close) c.closePath();
    };
    const vis = (bb, off) => { const x0 = W / 2 + v.ox + (bb[0] - v.lon0) * v.s + off, x1 = W / 2 + v.ox + (bb[2] - v.lon0) * v.s + off, y0 = yOf(bb[3]), y1 = yOf(bb[1]); return x1 > -10 && x0 < W + 10 && y1 > -10 && y0 < H + 10; };
    const offs = [-2, -1, 0, 1, 2].map(k => k * span);
    c.beginPath();
    for (const o of offs) for (const ct of GEO.countries) for (const r of ct.rings) if (vis(r.bb, o)) trace(r.pts, o, true);
    c.fillStyle = lg; c.fill();
    c.lineJoin = 'round'; c.lineCap = 'round';
    const arcsVis = (list, o) => { for (const a of list) trace(a, o, false); };
    c.beginPath(); for (const o of offs) arcsVis(GEO.coast, o); c.lineWidth = 6; c.strokeStyle = pal.shelf; c.stroke();            // shelf glow
    c.beginPath(); for (const o of offs) arcsVis(GEO.border, o); c.lineWidth = v.s > 20 ? 1 : 0.7; c.strokeStyle = pal.border; c.stroke();
    c.beginPath(); for (const o of offs) arcsVis(GEO.coast, o); c.lineWidth = v.s > 20 ? 1.3 : 0.9; c.strokeStyle = pal.coast; c.stroke();
    // country names
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = pal.label;
    for (const o of offs) for (const ct of GEO.countries) {
      const bb = ct.main; if (!bb) continue;
      const x0 = W / 2 + v.ox + (bb[0] - v.lon0) * v.s + o, x1 = W / 2 + v.ox + (bb[2] - v.lon0) * v.s + o, y0 = yOf(bb[3]), y1 = yOf(bb[1]);
      const w = x1 - x0, h = y1 - y0; if (x1 < 0 || x0 > W || y1 < 0 || y0 > H) continue;
      const nm = ct.name.toUpperCase(), size = Math.max(8, Math.min(15, w / nm.length * 1.25));
      if (w < nm.length * size * 0.62 || h < size * 1.8) continue;
      c.font = '600 ' + size.toFixed(1) + 'px system-ui'; c.fillText(nm.split('').join(String.fromCharCode(8202)), (x0 + x1) / 2, (y0 + y1) / 2);
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    // the schedule's route network (great circles)
    const seen = {}; c.beginPath();
    for (const f of S.net.flights) {
      const k = f.orig + f.dest; if (seen[k]) continue; seen[k] = 1;
      const arr = gc(S.net.airportMap[f.orig], S.net.airportMap[f.dest]);
      for (const o of offs) {
        let first = true, minx = 1e9, maxx = -1e9;
        const x0 = W / 2 + v.ox + (arr[0] - v.lon0) * v.s + o, x1 = W / 2 + v.ox + (arr[GCN * 2] - v.lon0) * v.s + o;
        minx = Math.min(x0, x1); maxx = Math.max(x0, x1); if (maxx < -400 || minx > W + 400) continue;
        for (let i = 0; i <= GCN; i++) { const x = W / 2 + v.ox + (arr[i * 2] - v.lon0) * v.s + o, y = H / 2 + v.oy - (mercY(arr[i * 2 + 1]) - v.m0) * v.s; first ? (c.moveTo(x, y), first = false) : c.lineTo(x, y); }
      }
    }
    c.lineWidth = 0.8; c.strokeStyle = pal.route; c.stroke();
  };

  // ---------------------------------------------------------------- day / night
  const DEC = -23.44 * Math.cos(2 * PI * (324 + 10) / 365) * RAD;     // solar declination, 20 November
  MapView.prototype.nightImage = function (utcMin) {
    const key = Math.round(utcMin / 5) + DS.themeName; if (key === this.nkey) return;
    this.nkey = key; const cv = this.nightCv, c = cv.getContext('2d'), img = c.createImageData(360, 170), top = mercY(85), bot = -top;
    const lonSub = -15 * (utcMin / 60 - 12), pal = DS.pal;
    for (let j = 0; j < 170; j++) {
      const lat = invMerc(top - (j + 0.5) / 170 * (top - bot)) * RAD, sl = Math.sin(lat), cl = Math.cos(lat);
      for (let i = 0; i < 360; i++) {
        const Hh = (i - 180 + 0.5 - lonSub) * RAD, sinE = sl * Math.sin(DEC) + cl * Math.cos(DEC) * Math.cos(Hh), e = Math.asin(sinE) / RAD;
        const f = Math.max(0, Math.min(1, (3 - e) / 17)), a = f * f * (3 - 2 * f), o = (j * 360 + i) * 4;
        img.data[o] = pal.night[0]; img.data[o + 1] = pal.night[1]; img.data[o + 2] = pal.night[2]; img.data[o + 3] = a * pal.nightAlpha * 255;
      }
    }
    c.putImageData(img, 0, 0);
  };

  // ---------------------------------------------------------------- frame
  MapView.prototype.draw = function (tReal) {
    const S = this.gs(), net = S.net, ctx = this.ctx, W = this.W, H = this.H, now = S.now, res = S.res.plan, v = this.v, pal = DS.pal;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.hit = [];
    const key = [net.meta.id, DS.themeName, W | 0, H | 0, v.s.toFixed(3), Math.round(v.ox), Math.round(v.oy), v.lon0, this.dpr].join('|');
    if (key !== this.skey) { this.skey = key; this.renderStatic(S); }
    ctx.drawImage(this.sc, 0, 0, W, H);

    // night side of the planet
    this.nightImage(now - net.meta.tz);
    const span = 360 * v.s, topY = H / 2 + v.oy - (mercY(85) - v.m0) * v.s, hgt = 2 * mercY(85) * v.s;
    ctx.imageSmoothingEnabled = true;
    for (const x of this.copies(W / 2 + v.ox + (-180 - v.lon0) * v.s, 0)) ctx.drawImage(this.nightCv, x, topY, span, hgt);

    const selF = S.sel.flight != null ? res.flights[S.sel.flight] : null;
    const selTail = S.sel.tail || (selF && selF.tail);
    const AM = net.airportMap;
    const strokeGC = (o, d) => {
      const arr = gc(AM[o], AM[d]), base = this.P(arr[0], 0)[0];
      for (const x0 of this.copies(base, 600)) {
        const dx = x0 - base; ctx.beginPath();
        for (let i = 0; i <= GCN; i++) { const [x, y] = this.P(arr[i * 2], arr[i * 2 + 1]); i ? ctx.lineTo(x + dx, y) : ctx.moveTo(x + dx, y); }
        ctx.stroke();
      }
    };
    if (selTail && res.tails[selTail]) {
      ctx.lineCap = 'round';
      res.tails[selTail].chain.forEach(id => {
        const f = res.flights[id];
        ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4;
        if (f.status === 'cancelled') { ctx.setLineDash([2, 5]); ctx.strokeStyle = 'rgba(148,163,184,.75)'; ctx.lineWidth = 1.3; }
        else { const d = f.aarr - f.sta; ctx.setLineDash(f.adep > now ? [7, 5] : []); ctx.strokeStyle = S.colorMode === 'gen' ? colGen(f.gen) : colDelay(d); ctx.lineWidth = id === S.sel.flight ? 3.4 : 2.1; }
        strokeGC(f.orig, f.dest); ctx.setLineDash([]); ctx.shadowBlur = 0;
      });
    }

    // airport statistics
    const st = {}; net.airports.forEach(a => st[a.code] = { wait: 0, n: 0, sum: 0, gen: 0, inbound: 0 });
    for (const f of res.flights) {
      if (f.status !== 'ok') continue;
      const o = st[f.orig];
      if (f.std <= now && f.adep > now) o.wait++;
      if (f.std <= now && f.std >= now - 180) { const d = f.adep <= now ? f.adep - f.std : now - f.std; o.n++; o.sum += Math.max(0, d); if (f.gen >= 1 && d > 15) o.gen++; }
      if (f.eta <= now && f.aarr > now) st[f.dest].inbound++;
    }
    this.st = st;

    this.drawWeather(ctx, S, tReal);

    // airports
    const big = v.s > this.fitScale() * 3.2;
    ctx.textAlign = 'center';
    for (const a of net.airports) {
      const [bx, y] = this.P(a.lon, a.lat); if (y < -30 || y > H + 30) continue;
      const s = st[a.code], avg = s.n ? s.sum / s.n : 0, fac = wxFactor(S.weather, a.code, now);
      const col = S.colorMode === 'gen' ? (s.gen >= 2 ? GEN[1] : s.gen ? GEN[2] : '#34d399') : colDelay(avg);
      const r = a.hub ? 6.5 : 4.6, sel = S.sel.airport === a.code;
      for (const x of this.copies(bx, 40)) {
        if (avg > 15 || s.wait) { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.8); g.addColorStop(0, col + '99'); g.addColorStop(1, col + '00'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.8, 0, 7); ctx.fill(); }
        ctx.beginPath(); ctx.arc(x, y, r + 1.6, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = fac === 0 ? '#2a0d12' : pal.apFill; ctx.fill();
        ctx.lineWidth = 2.2; ctx.strokeStyle = fac === 0 ? '#ef4444' : fac < 1 ? '#fbbf24' : (avg > 15 ? col : pal.apRing); ctx.stroke();
        if (fac === 0) { ctx.beginPath(); ctx.moveTo(x - r * .55, y - r * .55); ctx.lineTo(x + r * .55, y + r * .55); ctx.moveTo(x + r * .55, y - r * .55); ctx.lineTo(x - r * .55, y + r * .55); ctx.lineWidth = 1.7; ctx.strokeStyle = '#ef4444'; ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(x, y, r * 0.32, 0, 7); ctx.fillStyle = col; ctx.fill(); }
        if (sel) { ctx.beginPath(); ctx.arc(x, y, r + 5.5, 0, 7); ctx.lineWidth = 1.6; ctx.strokeStyle = pal.apText; ctx.stroke(); }
        if (a.hub || big || sel) {
          const label = big ? a.code + ' · ' + a.city : a.code;
          ctx.font = '600 ' + (a.hub ? 11 : 10) + 'px ui-monospace,monospace'; ctx.lineWidth = 3.4; ctx.strokeStyle = pal.halo; ctx.strokeText(label, x, y + r + 13); ctx.fillStyle = pal.apText; ctx.fillText(label, x, y + r + 13);
        }
        if (s.wait > 0) { const bx2 = x + r + 6, by = y - r - 3; ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(bx2, by, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '700 9.5px system-ui'; ctx.fillText(s.wait, bx2, by + 3.4); }
        this.hit.push({ type: 'airport', code: a.code, x, y, r: r + 8 });
      }
    }
    ctx.textAlign = 'left';

    // aircraft
    const zoomK = Math.max(0.8, Math.min(1.5, 0.75 + Math.log2(v.s / this.fitScale()) * 0.12));
    for (const f of res.flights) {
      if (f.status !== 'ok' || f.adep > now) continue;
      const ph = flightPhase(net, f, now); if (ph.ph === 'landed' || ph.ph === 'cancelled' || ph.ph === 'waiting' || ph.ph === 'scheduled') continue;
      let lon, lat, ang = 0, tr = null;
      if (ph.ph === 'air' || ph.ph === 'divert' || ph.ph === 'ferry') {
        const arr = gc(AM[ph.a], AM[ph.b]), p = Math.max(0, Math.min(1, ph.p)); [lon, lat] = samplePos(arr, p);
        const q = Math.min(0.985, p), [lo2, la2] = samplePos(arr, q + 0.015), [lo1, la1] = samplePos(arr, q), a1 = this.P(lo1, la1), a2 = this.P(lo2, la2);
        ang = Math.atan2(a2[1] - a1[1], a2[0] - a1[0]); tr = { arr, p };
      } else { const a = AM[ph.at]; lon = a.lon; lat = a.lat; if (ph.ph === 'atalt') ang = -PI / 4; }
      const base = this.P(lon, lat);
      let ox = 0, oy = 0;
      if (ph.ph === 'hold') { const th = now * 0.09 + f.id; ox = Math.cos(th) * 17; oy = Math.sin(th) * 17; ang = th + PI / 2; }
      else if (ph.ph === 'atalt') { ox = 9; oy = -9; }
      const dd = Math.max(0, now >= f.aarr ? f.aarr - f.sta : Math.max(f.adep - f.std, 0));
      const col = S.colorMode === 'gen' ? colGen(f.gen) : colDelay(dd);
      const isSel = S.sel.flight === f.id || (selTail && f.tail === selTail);
      const sc = (isSel ? 1.3 : 1) * zoomK;
      for (const bx of this.copies(base[0], 40)) {
        const x = bx + ox, y = base[1] + oy; if (y < -30 || y > H + 30) continue;
        if (tr && tr.p > 0.02) {                                   // contrail
          const back = [];
          for (let k = 0; k <= 8; k++) { const [lo, la] = samplePos(tr.arr, Math.max(0, tr.p - 0.07 * k / 8)); const q = this.P(lo, la); back.push([q[0] + (bx - base[0]), q[1]]); }
          const g = ctx.createLinearGradient(back[0][0], back[0][1], back[8][0], back[8][1]); g.addColorStop(0, DS.themeName === 'dark' ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.beginPath(); back.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.strokeStyle = g; ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.stroke();
        }
        this.plane(ctx, x, y, ang, sc, col, pal);
        if (ph.ph === 'hold') { ctx.beginPath(); ctx.arc(x, y, 12 * sc, 0, 7); ctx.strokeStyle = 'rgba(251,146,60,' + (0.4 + 0.3 * Math.sin(tReal / 200)) + ')'; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (isSel) { ctx.beginPath(); ctx.arc(x, y, 15 * sc, 0, 7); ctx.strokeStyle = pal.apText; ctx.lineWidth = 1.3; ctx.stroke(); }
        this.hit.push({ type: 'flight', id: f.id, x, y, r: 12 });
      }
    }
    ctx.globalAlpha = 1;
    this.drawGhost(ctx, S);
  };

  // airliner, nose up, ~21 px long at scale 1
  const PLANE = [[0, -10.5], [0.9, -9.2], [1.2, -6], [1.25, -2.2], [9.6, 3.6], [9.8, 5.3], [1.3, 3.4], [1.1, 7.6], [4.2, 9.6], [4.2, 10.7], [0.5, 9.7], [0, 10.6]];
  MapView.prototype.plane = function (ctx, x, y, ang, sc, col, pal) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang + PI / 2);
    const path = () => { ctx.beginPath(); PLANE.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); for (let i = PLANE.length - 2; i >= 1; i--) ctx.lineTo(-PLANE[i][0], PLANE[i][1]); ctx.closePath(); };
    ctx.save(); ctx.translate(2.5 * sc, 4 * sc); ctx.scale(sc, sc); ctx.fillStyle = pal.shadow; path(); ctx.fill(); ctx.restore();       // ground shadow
    ctx.scale(sc, sc); path(); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.1; ctx.strokeStyle = pal.plane; ctx.stroke();
    ctx.fillStyle = pal.plane; ctx.globalAlpha = 0.55;                                                                                         // engines + cockpit
    ctx.beginPath(); ctx.ellipse(-3.9, 0.4, 0.9, 1.7, 0, 0, 7); ctx.ellipse(3.9, 0.4, 0.9, 1.7, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -7.6, 0.55, 1.1, 0, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
  };

  MapView.prototype.drawHandle = function (ctx, x, y, e, meta, live, sel) {
    ctx.save(); ctx.globalAlpha = live ? 1 : 0.6;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, 7); ctx.fillStyle = 'rgba(8,13,26,.92)'; ctx.fill();
    ctx.lineWidth = sel ? 2.8 : 1.7; ctx.strokeStyle = sel ? '#fff' : 'rgba(' + meta.c + ',1)'; ctx.stroke();
    ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(meta.icon, x, y + 4.8); ctx.textAlign = 'left';
    ctx.restore();
  };
  MapView.prototype.drawGhost = function (ctx, S) {
    if (!S.placing || !this.mouse) return;
    const meta = WX[S.placing], [x, y] = this.mouse, ll = this.unP(x, y), R = Math.max(16, kmToPx(this.v, meta.radius, ll[1]));
    ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(' + meta.c + ',.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(' + meta.c + ',.14)'; ctx.fill(); ctx.setLineDash([]);
    ctx.font = '600 12px system-ui'; ctx.textAlign = 'center'; const t = meta.icon + ' ' + S.placing + ' — click to plant';
    ctx.lineWidth = 3.5; ctx.strokeStyle = DS.pal.halo; ctx.strokeText(t, x, y - R - 8); ctx.fillStyle = DS.pal.apText; ctx.fillText(t, x, y - R - 8); ctx.textAlign = 'left'; ctx.restore();
  };

  MapView.prototype.drawWeather = function (ctx, S, tReal) {
    const now = S.now, v = this.v;
    for (const e of S.weather) {
      const end = e.start + e.dur, meta = WX[e.type] || WX.Thunderstorm;
      const [bx, y] = this.P(e.lon, e.lat), R = Math.max(16, kmToPx(v, e.radius, e.lat));
      const live = now >= e.start - 180 && now <= end + 40;
      for (const x of this.copies(bx, R)) {
        this.drawHandle(ctx, x, y, e, meta, live, S.selEv === e.id);
        this.hit.push({ type: 'wx', id: e.id, x, y, r: 13 });
        if (!live) continue;
        if (y + R < 0 || y - R > this.H) continue;
        const forecast = now < e.start, fade = now > end ? 1 - (now - end) / 40 : 1;
        if (forecast) {
          ctx.save(); ctx.setLineDash([5, 6]); ctx.lineDashOffset = -tReal / 80; ctx.strokeStyle = 'rgba(' + meta.c + ',.85)'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(x, y, R * 0.85, 0, 7); ctx.stroke(); ctx.restore();
          const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.85); g.addColorStop(0, 'rgba(' + meta.c + ',.20)'); g.addColorStop(1, 'rgba(' + meta.c + ',0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R * 0.85, 0, 7); ctx.fill();
          const m = Math.round(e.start - now); ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; const t = meta.icon + ' ' + e.type + ' in ' + Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0');
          ctx.lineWidth = 3.4; ctx.strokeStyle = DS.pal.halo; ctx.strokeText(t, x, y - R * 0.85 - 6); ctx.fillStyle = DS.themeName === 'light' ? '#3b2a8a' : 'rgba(' + meta.c + ',1)'; ctx.fillText(t, x, y - R * 0.85 - 6); ctx.textAlign = 'left';
          continue;
        }
        ctx.save(); ctx.globalAlpha = fade * 0.95;
        const spin = tReal / (e.type === 'Cyclone' ? 2600 : 9000), light = DS.themeName === 'light';
        for (let i = 0; i < 9; i++) {
          const a = spin + i * 0.7 + e.id, rr = R * (0.22 + (i % 4) * 0.17), cx = x + Math.cos(a) * rr * 0.9, cy = y + Math.sin(a) * rr * 0.9, br = R * (0.5 - (i % 3) * 0.07);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, br);
          g.addColorStop(0, 'rgba(' + meta.c + ',' + ((light ? 0.34 : 0.26) * (0.4 + e.severity)) + ')'); g.addColorStop(1, 'rgba(' + meta.c + ',0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, br, 0, 7); ctx.fill();
        }
        if (e.type === 'Cyclone') {
          ctx.strokeStyle = 'rgba(' + meta.c + ',.6)'; ctx.lineWidth = 2;
          for (let arm = 0; arm < 3; arm++) { ctx.beginPath(); for (let k = 0; k < 40; k++) { const th = spin * 3 + arm * 2.09 + k * 0.16, r = (k / 40) * R * 0.95; const px = x + Math.cos(th) * r, py = y + Math.sin(th) * r; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
          const eye = ctx.createRadialGradient(x, y, 0, x, y, R * 0.12); eye.addColorStop(0, light ? 'rgba(255,255,255,.7)' : 'rgba(5,15,30,.8)'); eye.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(x, y, R * 0.12, 0, 7); ctx.fill();
        }
        const cg = ctx.createRadialGradient(x, y, 0, x, y, R * 0.42); cg.addColorStop(0, 'rgba(' + meta.core + ',' + (0.4 * e.severity + 0.08) + ')'); cg.addColorStop(1, 'rgba(' + meta.core + ',0)');
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(x, y, R * 0.42, 0, 7); ctx.fill();
        if (e.type === 'Thunderstorm') {
          ctx.strokeStyle = 'rgba(190,200,255,.5)'; ctx.lineWidth = 1;
          for (let i = 0; i < 26; i++) { const a = i * 2.4 + e.id * 5, rr = R * 0.8 * ((i * 37 % 100) / 100), px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr, o = (tReal / 18 + i * 13) % 26; ctx.beginPath(); ctx.moveTo(px + o * 0.15, py + o); ctx.lineTo(px + o * 0.15 - 2, py + o + 7); ctx.stroke(); }
          const k = Math.floor(tReal / 170); if ((k * 2654435761 >>> 0) % 7 === 0) {
            const a = (k % 9) * 0.7, lx = x + Math.cos(a) * R * 0.3, ly = y + Math.sin(a) * R * 0.3;
            ctx.strokeStyle = 'rgba(255,255,230,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lx, ly - 18); ctx.lineTo(lx + 5, ly - 5); ctx.lineTo(lx - 2, ly - 3); ctx.lineTo(lx + 4, ly + 12); ctx.stroke();
          }
        }
        if (e.type === 'Snowstorm') {
          ctx.fillStyle = 'rgba(255,255,255,.8)';
          for (let i = 0; i < 40; i++) { const a = i * 2.1 + e.id, rr = R * 0.85 * ((i * 53 % 100) / 100), px = x + Math.cos(a) * rr + Math.sin(tReal / 700 + i) * 4, py = y + Math.sin(a) * rr + ((tReal / 40 + i * 17) % 30) - 15; ctx.beginPath(); ctx.arc(px, py, 1.3, 0, 7); ctx.fill(); }
        }
        if (e.type === 'Volcanic ash') {
          ctx.fillStyle = 'rgba(70,60,60,.38)';
          for (let i = 0; i < 30; i++) { const a = i * 1.7 + e.id + tReal / 12000, rr = R * 0.9 * ((i * 41 % 100) / 100); ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 2 + (i % 4), 0, 7); ctx.fill(); }
        }
        ctx.restore();
        ctx.beginPath(); ctx.arc(x, y, R * 0.9, 0, 7); ctx.strokeStyle = 'rgba(' + meta.c + ',' + (0.6 * fade) + ')'; ctx.lineWidth = 1.3; ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  };

  G.DS = G.DS || {};
  Object.assign(G.DS, { MapView, flightPhase, wxFactor, colDelay, colGen, GENCOL: GEN, WX, mercY });
})(window);
