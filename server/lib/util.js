export const clamp = (x, a = 0, b = 100) => Math.min(b, Math.max(a, x));
export const KMH_TO_KN = 1 / 1.852;
export const LEVELS = ['low', 'moderate', 'high', 'severe'];

/** Piecewise-linear lookup. pts = [[x0,y0],[x1,y1],...] with ascending x. */
export function ramp(x, pts) {
  if (x == null || Number.isNaN(x)) return 0;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export const levelOf = (score) => (score < 25 ? 0 : score < 50 ? 1 : score < 75 ? 2 : 3);

export const snap = (x, step) => +(Math.round(x / step) * step).toFixed(4);

export function haversineKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
