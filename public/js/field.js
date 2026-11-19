// Turns a coarse lat/lon grid into a smooth, Mercator-correct colour image for Leaflet.
const interp = (stops) => (v) => {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [x0, c0] = stops[i - 1];
      const [x1, c1] = stops[i];
      const f = (v - x0) / (x1 - x0);
      return c0.map((c, k) => c + (c1[k] - c) * f);
    }
  }
  return stops[stops.length - 1][1];
};

// green → yellow → orange → red, centred on the 0/25/50/75 level bands
export const RISK_STOPS = [
  [0, [34, 197, 94, 0]], [12, [34, 197, 94, 80]], [37, [250, 204, 21, 150]],
  [62, [251, 146, 60, 180]], [87, [239, 68, 68, 205]], [100, [190, 18, 60, 225]],
];
export const WAVE_STOPS = [
  [0, [56, 189, 248, 0]], [0.3, [56, 189, 248, 70]], [1, [45, 212, 191, 120]], [2, [250, 204, 21, 165]],
  [3, [251, 146, 60, 190]], [4, [239, 68, 68, 210]], [6, [127, 29, 29, 230]],
];
export const riskColor = interp(RISK_STOPS);
export const waveColor = interp(WAVE_STOPS);

const mer = (la) => Math.log(Math.tan(Math.PI / 4 + (la * Math.PI) / 360));
const inv = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

export function renderField(grid, vals, colorFn, scale = 10) {
  const { lat0, lon0, step, nx, ny } = grid;
  const W = nx * scale;
  const H = ny * scale;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const lonMin = lon0 - step / 2;
  const lonMax = lon0 + (nx - 1) * step + step / 2;
  const latMin = lat0 - step / 2;
  const latMax = lat0 + (ny - 1) * step + step / 2;
  const yTop = mer(latMax);
  const yBot = mer(latMin);
  for (let py = 0; py < H; py++) {
    const lat = inv(yTop + ((yBot - yTop) * (py + 0.5)) / H);
    const gj = Math.min(ny - 1, Math.max(0, (lat - lat0) / step));
    const j0 = Math.floor(gj);
    const j1 = Math.min(ny - 1, j0 + 1);
    const fy = gj - j0;
    for (let px = 0; px < W; px++) {
      const lon = lonMin + ((lonMax - lonMin) * (px + 0.5)) / W;
      const gi = Math.min(nx - 1, Math.max(0, (lon - lon0) / step));
      const i0 = Math.floor(gi);
      const i1 = Math.min(nx - 1, i0 + 1);
      const fx = gi - i0;
      let sw = 0;
      let sv = 0;
      const corners = [[i0, j0, (1 - fx) * (1 - fy)], [i1, j0, fx * (1 - fy)], [i0, j1, (1 - fx) * fy], [i1, j1, fx * fy]];
      for (const [i, j, w] of corners) {
        const v = vals[j * nx + i];
        if (v != null && w > 0) {
          sw += w;
          sv += v * w;
        }
      }
      if (sw < 0.45) continue; // mostly no-data (e.g. land for wave height)
      const col = colorFn(sv / sw);
      const o = (py * W + px) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = col[3] * Math.min(1, sw * 1.4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: c.toDataURL('image/png'), bounds: [[latMin, lonMin], [latMax, lonMax]] };
}
