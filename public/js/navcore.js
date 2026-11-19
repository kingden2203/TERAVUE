// Turn-by-turn engine. Pure logic (no DOM) so it can be unit-tested in Node and driven by real GPS or the simulator.
const RAD = Math.PI / 180;
export const hav = (a, b) => {
  const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(s));
};
export const bearing = (a, b) => {
  const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
  const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
};
export function cumulative(coords) {
  const c = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) c[i] = c[i - 1] + hav(coords[i - 1], coords[i]);
  return c;
}

/** Nearest point on the route line, searched around the last known position first. */
export function snap(coords, cum, p, hint = 0) {
  const n = coords.length;
  const kx = Math.cos(p[0] * RAD) * 111320, ky = 110540;
  const scan = (lo, hi) => {
    let best = null;
    for (let i = lo; i <= hi; i++) {
      const ax = (coords[i][1] - p[1]) * kx, ay = (coords[i][0] - p[0]) * ky;
      const bx = (coords[i + 1][1] - p[1]) * kx, by = (coords[i + 1][0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      // when two passes of the route are equally close (flyovers, loops), keep the one nearest where we were
      if (!best || d < best.dist - 3 || (d <= best.dist + 3 && Math.abs(i - hint) < Math.abs(best.idx - hint) && d < best.dist + 3)) {
        best = { idx: i, t, dist: Math.min(d, best ? best.dist : d), along: cum[i] + t * (cum[i + 1] - cum[i]), raw: d };
      }
    }
    if (best) best.dist = best.raw;
    return best;
  };
  let best = scan(Math.max(0, hint - 25), Math.min(n - 2, hint + 300));
  if (!best || best.dist > 120) {
    const full = scan(0, n - 2);
    if (!best || full.dist < best.dist - 10) best = full;
  }
  const a = coords[best.idx], b = coords[best.idx + 1];
  best.lat = a[0] + (b[0] - a[0]) * best.t;
  best.lon = a[1] + (b[1] - a[1]) * best.t;
  best.heading = bearing(a, b);
  return best;
}

/** Point (and direction) at a distance along the route; used by the simulator. */
export function positionAt(coords, cum, along) {
  const n = coords.length;
  const a = Math.max(0, Math.min(cum[n - 1], along));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= a) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = (a - cum[lo]) / seg;
  return { lat: coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, lon: coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t, heading: bearing(coords[lo], coords[hi]), idx: lo };
}

/* ------------------------------------------------------------------ words */
const DIR = {
  fil: { left: 'pakaliwa', right: 'pakanan', 'slight left': 'bahagyang pakaliwa', 'slight right': 'bahagyang pakanan', 'sharp left': 'nang matalim pakaliwa', 'sharp right': 'nang matalim pakanan', straight: 'diretso', uturn: 'pabalik (U-turn)' },
  en: { left: 'left', right: 'right', 'slight left': 'slightly left', 'slight right': 'slightly right', 'sharp left': 'sharp left', 'sharp right': 'sharp right', straight: 'straight', uturn: 'around (U-turn)' },
};
const ORD = { fil: (n) => `ika-${n}`, en: (n) => ['', '1st', '2nd', '3rd'][n] || `${n}th` };
const HAZ = {
  fil: { flood: 'baha sa kalsada', closed: 'sarado ang daan', landslide: 'landslide', fallen: 'natumbang puno o poste', damaged: 'sirang daan o tulay', rain: 'malakas na ulan', gust: 'malakas na hangin', thunder: 'thunderstorm', vis: 'malabong paningin', floodrisk: 'banta ng baha', landrisk: 'banta ng landslide', heat: 'matinding init', wave: 'malalaking alon', wind: 'malakas na hangin sa dagat' },
  en: { flood: 'flooded road', closed: 'road closed', landslide: 'landslide', fallen: 'fallen tree or pole', damaged: 'damaged road or bridge', rain: 'heavy rain', gust: 'strong gusts', thunder: 'thunderstorm', vis: 'poor visibility', floodrisk: 'flood risk', landrisk: 'landslide risk', heat: 'extreme heat', wave: 'high waves', wind: 'strong wind at sea' },
};

export function distWords(m, lang) {
  if (m >= 950) { const km = Math.round(m / 100) / 10; return lang === 'en' ? `${km} kilometre${km === 1 ? '' : 's'}` : `${km} kilometro`; }
  const r = m > 300 ? Math.round(m / 50) * 50 : m > 100 ? Math.round(m / 10) * 10 : Math.max(10, Math.round(m / 10) * 10);
  return lang === 'en' ? `${r} metres` : `${r} metro`;
}

/** What to do at a maneuver, without the distance. */
export function describe(step, lang = 'fil') {
  const fil = lang !== 'en';
  const d = (DIR[fil ? 'fil' : 'en'][step.mo || 'straight']) || '';
  const on = step.nm ? (fil ? ` papuntang ${step.nm}` : ` onto ${step.nm}`) : '';
  switch (step.ty) {
    case 'depart': return fil ? `Simulan ang biyahe${step.nm ? ` sa ${step.nm}` : ''}` : `Start${step.nm ? ` on ${step.nm}` : ''}`;
    case 'arrive': return fil ? (step.mo === 'left' ? 'Nasa kaliwa ang pupuntahan' : step.mo === 'right' ? 'Nasa kanan ang pupuntahan' : 'Nakarating ka na sa pupuntahan') : (step.mo === 'left' ? 'Your destination is on the left' : step.mo === 'right' ? 'Your destination is on the right' : 'You have arrived');
    case 'roundabout': case 'rotary': case 'roundabout turn':
      return fil ? `Sa rotunda, lumabas sa ${ORD.fil(step.ex || 1)} labasan${on}` : `At the roundabout, take the ${ORD.en(step.ex || 1)} exit${on}`;
    case 'merge': return fil ? `Sumanib ${d}${on}` : `Merge ${d}${on}`;
    case 'fork': return fil ? `Sa sangandaan, pumunta ${d}${on}` : `At the fork, keep ${d}${on}`;
    case 'on ramp': return fil ? `Sumakay sa rampa ${d}${on}` : `Take the ramp ${d}${on}`;
    case 'off ramp': return fil ? `Lumabas sa rampa ${d}${on}` : `Take the exit ${d}${on}`;
    case 'end of road': return fil ? `Sa dulo ng kalsada, lumiko ${d}${on}` : `At the end of the road, turn ${d}${on}`;
    case 'continue': return fil ? `Magpatuloy ${d}${on}` : `Continue ${d}${on}`;
    default:
      if (step.mo === 'straight') return fil ? `Magpatuloy nang diretso${on}` : `Continue straight${on}`;
      if (step.mo === 'uturn') return fil ? 'Umikot pabalik (U-turn) kung ligtas' : 'Make a U-turn when safe';
      return fil ? `Lumiko ${d}${on}` : `Turn ${d}${on}`;
  }
}

export function hazardLabel(ev, lang = 'fil') {
  return (HAZ[lang === 'en' ? 'en' : 'fil'][ev.kind] || ev.kind);
}
export function hazardText(ev, ahead, lang = 'fil') {
  const w = distWords(Math.max(50, ahead), lang);
  return lang === 'en' ? `Warning: ${hazardLabel(ev, lang)} ahead in ${w}.` : `Babala: ${hazardLabel(ev, lang)} sa unahan, ${w} mula rito.`;
}

/* ----------------------------------------------------------------- engine */
export const PROFILE = {
  walk: { far: () => 80, near: 20, minSpeed: 0.8, offLimit: 30 },
  drive: { far: (v) => Math.max(250, Math.min(700, v * 20)), near: 50, minSpeed: 3, offLimit: 45 },
};

export class Nav {
  /**
   * route: { full, steps, durationMin, hazards, closures, sea }  (from POST /api/route with nav:true)
   * opts: { mode, lang, rerouted }
   */
  constructor(route, { mode = 'general', lang = 'fil', rerouted = false } = {}) {
    this.route = route;
    this.lang = lang;
    this.profile = mode === 'hiker' ? PROFILE.walk : PROFILE.drive;
    this.coords = route.full;
    this.cum = cumulative(this.coords);
    this.total = this.cum[this.cum.length - 1];
    this.steps = route.steps.map((s) => ({ ...s, at: this.cum[Math.min(s.i, this.coords.length - 1)] }));
    this.hint = 0;
    this.along = 0;
    this.fired = new Set();
    this.offCount = 0;
    this.offSince = 0;
    this.speed = 0;
    this.last = null;
    this.arrived = false;
    this.rerouted = rerouted;
    this.avgSpeed = this.total / Math.max(60, (route.durationMin || 1) * 60);
    // hazards -> distance along the route
    const raw = [
      ...(route.closures || []).map((c) => ({ id: `c${c.id}`, kind: c.type, lat: c.lat, lon: c.lon, severe: true })),
      ...(route.hazards || []).map((h, i) => ({ id: `h${i}`, kind: ({ flood: 'floodrisk', landslide: 'landrisk' })[h.reasons?.[0]?.k] || h.reasons?.[0]?.k || 'rain', lat: h.lat, lon: h.lon, severe: h.level >= 3 })),
    ];
    this.events = raw.map((e) => {
      const s = snap(this.coords, this.cum, [e.lat, e.lon], 0);
      return { ...e, at: s.along, off: s.dist };
    }).filter((e) => route.sea || e.off < 400).sort((a, b) => a.at - b.at);
  }

  /** Add a hazard discovered while driving (e.g. a fresh road report). Returns it, or null if it is not on this route / already known. */
  addEvent(e) {
    if (this.events.some((x) => x.id === e.id)) return null;
    const s = snap(this.coords, this.cum, [e.lat, e.lon], this.hint);
    if (s.dist > 150) return null;
    const ev = { ...e, at: s.along, off: s.dist };
    this.events.push(ev);
    this.events.sort((a, b) => a.at - b.at);
    return ev;
  }

  update(fix) {
    const t = fix.t ?? Date.now();
    const p = [fix.lat, fix.lon];
    const acc = Number.isFinite(fix.acc) ? fix.acc : 20;
    const s = snap(this.coords, this.cum, p, this.hint);
    this.hint = s.idx;

    // speed: GPS value if given, otherwise from movement; smoothed
    let v = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
    if (v == null && this.last) v = hav([this.last.lat, this.last.lon], p) / Math.max(0.5, (t - this.last.t) / 1000);
    if (v != null) this.speed = this.speed ? this.speed * 0.7 + v * 0.3 : v;
    this.last = { lat: fix.lat, lon: fix.lon, t };

    // off route: far from the line for a few fixes in a row (GPS jitter alone must not trigger it)
    const lim = Math.max(this.profile.offLimit, Math.min(90, acc * 1.5));
    if (s.dist > lim) { this.offCount++; if (!this.offSince) this.offSince = t; } else { this.offCount = 0; this.offSince = 0; }
    const offRoute = !this.route.sea && !this.arrived && (s.dist > 300 || (this.offCount >= 3 && t - this.offSince >= 5000));

    if (!offRoute) this.along = s.along;
    const along = this.along;
    const remaining = Math.max(0, this.total - along);
    const eff = Math.max(this.profile.minSpeed, Math.max(this.speed, this.avgSpeed * 0.6));
    const etaSec = remaining / eff;

    const lang = this.lang;
    const speak = [];
    const fire = (id, text, prio) => { if (!this.fired.has(id)) { this.fired.add(id); speak.push({ id, text, prio }); } };

    // next maneuver (the depart step is not "next")
    let k = this.steps.findIndex((st, i) => i > 0 && st.at > along + 8);
    if (k < 0) k = this.steps.length - 1;
    const next = this.steps[k];
    const distNext = Math.max(0, next.at - along);
    const afterStep = this.steps[k + 1] || null;

    if (!offRoute) {
      if (!this.fired.has('dep') && along < 60) fire('dep', this.rerouted ? (lang === 'en' ? 'New route.' : 'Bagong ruta.') : describe(this.steps[0], lang), 1);
      if (next.ty === 'arrive') {
        if (distNext <= Math.max(30, this.profile.near)) fire(`${k}:near`, describe(next, lang), 3);
      } else {
        const far = this.profile.far(this.speed || this.avgSpeed);
        if (distNext <= this.profile.near) fire(`${k}:near`, describe(next, lang) + '.', 3);
        else if (distNext <= far) fire(`${k}:far`, `${lang === 'en' ? 'In' : 'Sa'} ${distWords(distNext, lang)}, ${describe(next, lang)}.`, 2);
      }
      for (const ev of this.events) {
        const ahead = ev.at - along;
        if (ahead <= 0) continue;
        if (ahead <= 1500 && !this.fired.has(`${ev.id}:far`) && ahead > 450) fire(`${ev.id}:far`, hazardText(ev, ahead, lang), 0);
        if (ev.severe && ahead <= 450) fire(`${ev.id}:near`, hazardText(ev, ahead, lang), 0);
      }
    }

    if (!this.arrived && !this.route.sea ? remaining < Math.max(25, acc) : remaining < Math.max(120, acc * 2)) {
      if (next.ty === 'arrive' || remaining < 25) this.arrived = true;
    }
    if (this.arrived) fire('arrived', describe(this.steps[this.steps.length - 1], lang), 4);

    speak.sort((a, b) => a.prio - b.prio);
    const ahead = this.events.map((e) => ({ ...e, dist: e.at - along })).filter((e) => e.dist > 0 && e.dist < 3000).slice(0, 3);
    return {
      along, total: this.total, remaining, etaSec, progress: this.total ? along / this.total : 0, speed: this.speed,
      offRoute, offDist: s.dist, arrived: this.arrived, snapped: { lat: s.lat, lon: s.lon }, heading: this.speed > 1.5 && Number.isFinite(fix.heading) ? fix.heading : s.heading,
      next: { ...next, dist: distNext, text: describe(next, lang) }, after: afterStep ? { ...afterStep, dist: afterStep.at - along, text: describe(afterStep, lang) } : null,
      toDest: this.route.sea ? { bearing: bearing(p, this.coords[this.coords.length - 1]), dist: hav(p, this.coords[this.coords.length - 1]) } : null,
      hazardsAhead: ahead, speak,
    };
  }
}
