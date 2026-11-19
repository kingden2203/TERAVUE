// Animated wind-flow particles drawn on a canvas that sits over the map.
const speedColor = (kn) =>
  kn < 8 ? 'rgba(186,230,253,.85)' : kn < 15 ? 'rgba(103,232,249,.9)' : kn < 22 ? 'rgba(253,224,71,.95)' : kn < 30 ? 'rgba(251,146,60,.95)' : 'rgba(248,113,113,1)';

export class WindFlow {
  constructor(map) {
    this.map = map;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'wind-canvas';
    this.canvas.hidden = true;
    map.getContainer().appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.grid = null;
    this.on = false;
    this.parts = [];
    this.last = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.on('resize', () => this.resize());
    map.on('movestart zoomstart', () => this.clear());
    map.on('moveend zoomend', () => this.seed());
    document.addEventListener('visibilitychange', () => this.on && !document.hidden && this.loop());
    this.resize();
  }

  setGrid(g) {
    const { nx, ny, fields } = g;
    const u = new Float32Array(nx * ny);
    const v = new Float32Array(nx * ny);
    for (let k = 0; k < nx * ny; k++) {
      const kn = fields.windKn[k] ?? 0;
      const rad = ((fields.windDir[k] ?? 0) * Math.PI) / 180;
      u[k] = -kn * Math.sin(rad); // wind blows TOWARDS dir+180
      v[k] = -kn * Math.cos(rad);
    }
    this.grid = { ...g, u, v };
    this.seed();
  }

  enable(on) {
    this.on = on;
    this.canvas.hidden = !on;
    if (on) {
      this.resize();
      this.seed();
      this.loop();
    } else this.clear();
  }

  resize() {
    const s = this.map.getSize();
    this.canvas.width = s.x;
    this.canvas.height = s.y;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  sample(lat, lon) {
    const g = this.grid;
    if (!g) return null;
    const gi = (lon - g.lon0) / g.step;
    const gj = (lat - g.lat0) / g.step;
    if (gi < 0 || gj < 0 || gi > g.nx - 1 || gj > g.ny - 1) return null;
    const i0 = Math.floor(gi), j0 = Math.floor(gj);
    const i1 = Math.min(g.nx - 1, i0 + 1), j1 = Math.min(g.ny - 1, j0 + 1);
    const fx = gi - i0, fy = gj - j0;
    const mix = (a) =>
      a[j0 * g.nx + i0] * (1 - fx) * (1 - fy) + a[j0 * g.nx + i1] * fx * (1 - fy) +
      a[j1 * g.nx + i0] * (1 - fx) * fy + a[j1 * g.nx + i1] * fx * fy;
    return [mix(g.u), mix(g.v)];
  }

  seed() {
    if (!this.on || !this.grid) return;
    this.clear();
    const { width: w, height: h } = this.canvas;
    const n = this.reduced ? 1800 : Math.min(1400, Math.round((w * h) / 1300));
    this.parts = Array.from({ length: n }, () => this.spawn(w, h));
    if (this.reduced) this.still();
  }

  spawn(w, h) {
    return { x: Math.random() * w, y: Math.random() * h, age: Math.floor(Math.random() * 80) };
  }

  still() {
    const ctx = this.ctx;
    ctx.lineWidth = 1.2;
    for (const p of this.parts) {
      const ll = this.map.containerPointToLatLng([p.x, p.y]);
      const s = this.sample(ll.lat, ll.lng);
      if (!s) continue;
      const kn = Math.hypot(s[0], s[1]);
      ctx.strokeStyle = speedColor(kn);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + s[0] * 0.9, p.y - s[1] * 0.9);
      ctx.stroke();
    }
  }

  loop() {
    if (!this.on || this.reduced || this._raf) return;
    const frame = (ts) => {
      this._raf = null;
      if (!this.on || document.hidden) return;
      if (ts - this.last > 33) {
        this.last = ts;
        this.step();
      }
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  step() {
    const { ctx, canvas } = this;
    const { width: w, height: h } = canvas;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.09)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.3;
    for (const p of this.parts) {
      const ll = this.map.containerPointToLatLng([p.x, p.y]);
      const s = this.sample(ll.lat, ll.lng);
      if (!s || p.age++ > 90) {
        Object.assign(p, this.spawn(w, h), { age: 0 });
        continue;
      }
      const kn = Math.hypot(s[0], s[1]);
      const nx = p.x + s[0] * 0.16;
      const ny = p.y - s[1] * 0.16;
      ctx.strokeStyle = speedColor(kn);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      p.x = nx;
      p.y = ny;
    }
  }
}
