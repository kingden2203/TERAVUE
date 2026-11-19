import { haversineKm } from './util.js';

/** Cities / provincial centers used for the national alert scan and "nearest place" labels. */
export const CITIES = [
  { n: 'Basco (Batanes)', lat: 20.4487, lon: 121.9702 },
  { n: 'Laoag', lat: 18.1978, lon: 120.5936 },
  { n: 'Vigan', lat: 17.5747, lon: 120.3869 },
  { n: 'Tuguegarao', lat: 17.6132, lon: 121.727 },
  { n: 'Santiago (Isabela)', lat: 16.6881, lon: 121.549 },
  { n: 'Baguio', lat: 16.4023, lon: 120.596 },
  { n: 'San Fernando (La Union)', lat: 16.6159, lon: 120.3209 },
  { n: 'Dagupan', lat: 16.043, lon: 120.3333 },
  { n: 'Cabanatuan', lat: 15.486, lon: 120.967 },
  { n: 'Angeles', lat: 15.145, lon: 120.5887 },
  { n: 'Quezon City', lat: 14.676, lon: 121.0437 },
  { n: 'Manila', lat: 14.5995, lon: 120.9842 },
  { n: 'Tagaytay', lat: 14.1153, lon: 120.9621 },
  { n: 'Batangas City', lat: 13.7565, lon: 121.0583 },
  { n: 'Lucena', lat: 13.9414, lon: 121.6234 },
  { n: 'Calapan', lat: 13.4119, lon: 121.1803 },
  { n: 'San Jose (Occ. Mindoro)', lat: 12.3526, lon: 121.0675 },
  { n: 'Naga (Camarines Sur)', lat: 13.6218, lon: 123.1948 },
  { n: 'Legazpi', lat: 13.1391, lon: 123.7438 },
  { n: 'Virac (Catanduanes)', lat: 13.5833, lon: 124.2333 },
  { n: 'Masbate', lat: 12.3667, lon: 123.6167 },
  { n: 'Puerto Princesa', lat: 9.7392, lon: 118.7353 },
  { n: 'Coron', lat: 12.003, lon: 120.204 },
  { n: 'Kalibo', lat: 11.7061, lon: 122.3639 },
  { n: 'Roxas City', lat: 11.5853, lon: 122.7511 },
  { n: 'Iloilo City', lat: 10.7202, lon: 122.5621 },
  { n: 'Bacolod', lat: 10.6713, lon: 122.9511 },
  { n: 'Cebu City', lat: 10.3157, lon: 123.8854 },
  { n: 'Tagbilaran', lat: 9.6477, lon: 123.8541 },
  { n: 'Dumaguete', lat: 9.3068, lon: 123.3054 },
  { n: 'Tacloban', lat: 11.2543, lon: 125.0 },
  { n: 'Catbalogan', lat: 11.7753, lon: 124.8861 },
  { n: 'Borongan', lat: 11.6078, lon: 125.4316 },
  { n: 'Surigao City', lat: 9.7839, lon: 125.4888 },
  { n: 'Butuan', lat: 8.9475, lon: 125.5406 },
  { n: 'Cagayan de Oro', lat: 8.4542, lon: 124.6319 },
  { n: 'Iligan', lat: 8.228, lon: 124.2452 },
  { n: 'Zamboanga City', lat: 6.9214, lon: 122.079 },
  { n: 'Cotabato City', lat: 7.2236, lon: 124.2464 },
  { n: 'Davao City', lat: 7.1907, lon: 125.4553 },
  { n: 'General Santos', lat: 6.1164, lon: 125.1716 },
  { n: 'Bongao (Tawi-Tawi)', lat: 5.0292, lon: 119.7731 },
];

/** Offshore reference points for the fisherfolk alert scan (approximate sea areas). */
export const SEAS = [
  { n: 'Luzon Strait / Batanes waters', lat: 20.0, lon: 122.0 },
  { n: 'Seaboard of Northern Luzon', lat: 18.5, lon: 122.6 },
  { n: 'West Philippine Sea (off Luzon)', lat: 15.5, lon: 119.0 },
  { n: 'Seaboard of Southern Luzon', lat: 14.0, lon: 124.5 },
  { n: 'Mindoro Strait', lat: 12.5, lon: 120.4 },
  { n: 'Seaboard of Eastern Visayas', lat: 11.5, lon: 126.0 },
  { n: 'Sulu Sea', lat: 9.0, lon: 120.0 },
  { n: 'Seaboard of Eastern Mindanao', lat: 7.5, lon: 127.3 },
  { n: 'Celebes Sea', lat: 5.5, lon: 124.5 },
];

/**
 * Historically flood- / landslide-prone areas. Indicative only (circles, not official hazard maps).
 * Used to nudge risk scores up when rain is also falling.
 */
export const ZONES = [
  { id: 'marikina', n: 'Marikina–Pasig River valley', type: 'flood', lat: 14.64, lon: 121.1, r: 10 },
  { id: 'laguna', n: 'Laguna Lake rim', type: 'flood', lat: 14.35, lon: 121.25, r: 18 },
  { id: 'pampanga', n: 'Pampanga / Candaba floodplain', type: 'flood', lat: 15.1, lon: 120.85, r: 25 },
  { id: 'agno', n: 'Agno River basin (Pangasinan)', type: 'flood', lat: 15.95, lon: 120.45, r: 20 },
  { id: 'cagayan', n: 'Lower Cagayan River valley', type: 'flood', lat: 17.6, lon: 121.73, r: 20 },
  { id: 'bicol', n: 'Bicol River basin (Camarines Sur)', type: 'flood', lat: 13.5, lon: 123.2, r: 20 },
  { id: 'iloilo', n: 'Iloilo–Jaro lowlands', type: 'flood', lat: 10.72, lon: 122.56, r: 8 },
  { id: 'agusan', n: 'Agusan Marsh / Butuan lowlands', type: 'flood', lat: 8.65, lon: 125.85, r: 25 },
  { id: 'liguasan', n: 'Liguasan Marsh / Cotabato basin', type: 'flood', lat: 7.1, lon: 124.35, r: 25 },
  { id: 'cordillera', n: 'Cordillera / Benguet slopes', type: 'landslide', lat: 16.45, lon: 120.6, r: 30 },
  { id: 'sierramadre', n: 'Sierra Madre (Quezon–Infanta)', type: 'landslide', lat: 14.75, lon: 121.65, r: 30 },
  { id: 'mayon', n: 'Mayon / Albay slopes', type: 'landslide', lat: 13.25, lon: 123.69, r: 20 },
  { id: 'leyte', n: 'Southern Leyte uplands', type: 'landslide', lat: 10.3, lon: 125.1, r: 25 },
  { id: 'samar', n: 'Eastern Samar uplands', type: 'landslide', lat: 11.5, lon: 125.4, r: 30 },
  { id: 'negros', n: 'Negros Oriental uplands', type: 'landslide', lat: 10.12, lon: 123.27, r: 20 },
  { id: 'davao-oro', n: 'Davao de Oro uplands', type: 'landslide', lat: 7.65, lon: 126.0, r: 30 },
];

export function zonesAt(lat, lon) {
  const p = { lat, lon };
  return ZONES.filter((z) => haversineKm(p, z) <= z.r);
}

export function nearestCity(lat, lon) {
  const p = { lat, lon };
  let best = null;
  for (const c of CITIES) {
    const d = haversineKm(p, c);
    if (!best || d < best.km) best = { name: c.n, km: Math.round(d) };
  }
  return best;
}
