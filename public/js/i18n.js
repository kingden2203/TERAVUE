import { EXTRA } from './i18n-extra.js';

// Filipino (default) + English strings. Server sends reason codes; the text lives here.
const D = {
  fil: {
    tagline: 'Radar para sa mangingisda, rider at hiker',
    search: 'Maghanap ng lugar…',
    locate: 'Aking lokasyon',
    'mode.general': 'Lahat', 'mode.motorcycle': 'Motor', 'mode.hiker': 'Hiking', 'mode.fisher': 'Mangingisda',
    layers: 'Mga Layer', radar: 'Radar ng ulan', sat: 'Ulap (satellite)', wind: 'Hangin (daloy)', wave: 'Alon (dagat)',
    risk: 'Risk heatmap', zones: 'Madalas bahain / landslide', storms: 'Bagyo', alerts: 'Mga alerto',
    'rk.overall': 'Kabuuan', 'rk.flood': 'Baha', 'rk.wind': 'Hangin', 'rk.sea': 'Alon',
    'base.dark': 'Madilim', 'base.light': 'Maliwanag', 'base.sat': 'Satellite',
    basemap: 'Mapa', legend: 'Legend',
    'tab.place': 'Lugar', 'tab.route': 'Ruta', 'tab.alerts': 'Alerto',
    'lv.0': 'Mababa', 'lv.1': 'Katamtaman', 'lv.2': 'Mataas', 'lv.3': 'Matindi',
    'verdict.0': 'Maayos ang kondisyon', 'verdict.1': 'Mag-ingat', 'verdict.2': 'Mataas ang panganib', 'verdict.3': 'Delikado — huwag tumuloy',
    pickHint: 'Mag-tap sa mapa para makita ang kondisyon, panganib at pinakamagandang oras ng byahe.',
    loading: 'Kinukuha ang datos…', error: 'Hindi makakonekta. Subukan ulit.', retry: 'Subukan ulit',
    nearLabel: '{km} km mula sa {name}', here: 'Napiling lugar',
    notSea: 'Hindi dagat ang napiling lugar. Para sa mangingisda, pumili ng punto sa dagat.',
    cWind: 'Hangin', cGust: 'Bugso', cRain: 'Ulan', cRain24: 'Ulan (≈24h)', cTemp: 'Init (feels like)', cVis: 'Visibility',
    cWave: 'Alon', cSwell: 'Swell', cCur: 'Agos', cElev: 'Taas', cRiver: 'Ilog (modelo)',
    riverVal: '{q} m³/s → peak {peak}',
    modesTitle: 'Para sa bawat byahe',
    tlTitle: 'Panganib bawat oras · susunod na 48h', now: 'Ngayon',
    windowsTitle: 'Kailan pwedeng bumiyahe', noWindow: 'Walang oras na mababa ang panganib sa susunod na 48 oras. Maghintay o mag-ingat nang husto.',
    zoneNote: 'Nasa lugar na madalas bahain / landslide (batay sa kasaysayan)',
    routeHere: 'Ruta papunta rito',
    from: 'Simula', to: 'Pupuntahan', pickMap: 'Piliin sa mapa', myLoc: 'Aking lokasyon',
    pickFromToast: 'Mag-tap sa mapa para itakda ang simula', pickToToast: 'Mag-tap sa mapa para itakda ang pupuntahan',
    findRoute: 'Hanapin ang ligtas na ruta', finding: 'Sinusuri ang ruta…', speed: 'Bilis ng bangka (knots)',
    needPoints: 'Itakda muna ang simula at pupuntahan.',
    tagRecommended: 'Inirerekomenda', tagFastest: 'Pinakamabilis', tagSafest: 'Pinakaligtas',
    routeN: 'Ruta {n}', seaLeg: 'Direktang linya sa dagat',
    hazards: '{n} mapanganib na bahagi', noHazards: 'Walang mapanganib na bahagi ngayon',
    advGo: 'Pwede nang umalis ngayon.', advWait: 'Mas ligtas kung aalis ka sa {time} ({h} oras mula ngayon).',
    advCaution: 'May panganib sa ruta. Mag-ingat at bantayan ang panahon.', advAvoid: 'Huwag munang bumiyahe — mataas ang panganib sa susunod na 12 oras.',
    depTitle: 'Panganib kung aalis…', seaWarn: 'Tuwid na linya ito sa dagat. Hindi nito iniiwasan ang lupa, bahura o mababaw — ayusin ang aktuwal na ruta.',
    landWarn: 'May bahagi ng linya na tumatawid sa lupa/baybayin.',
    hazAt: 'km {km} · ~{eta} mula simula',
    alertsTitle: 'Mga alerto ngayon (susunod na 12h)', noAlerts: 'Walang alerto sa ngayon.', stormsTitle: 'Bagyo / tropical cyclone',
    noStorms: 'Walang aktibong tropical cyclone sa datos (GDACS).', peak: 'Rurok ~{time}', sea: 'Dagat', land: 'Lupa',
    emergency: 'Emergency', emergencyText: '911 (pambansang emergency hotline) · Philippine Red Cross 143',
    official: 'Opisyal na babala',
    disclaimer: 'Tantya lang ito mula sa public forecast models — hindi opisyal na babala. Sundin lagi ang PAGASA, NDRRMC, LGU at Philippine Coast Guard.',
    demoBanner: 'DEMO DATA — hindi totoong panahon (walang koneksyon sa weather provider).',
    geoFail: 'Hindi makuha ang lokasyon. Payagan ang location access.', noResults: 'Walang nahanap',
    updated: 'Na-update {time}', radarFail: 'Hindi ma-load ang radar (RainViewer).', nowcast: 'Forecast', live: 'Live',
    radarNote: 'Radar: RainViewer · Panahon: Open-Meteo',
    'r.rain': 'Ulan {v} mm/h', 'r.gust': 'Bugso {v} km/h', 'r.thunder': 'Banta ng kidlat / thunderstorm', 'r.vis': 'Malabo ang paningin ({v} km)',
    'r.flood': 'Banta ng baha ({v} mm ulan ≈24h)', 'r.landslide': 'Banta ng landslide ({v} mm ulan ≈3 araw)', 'r.heat': 'Matinding init (heat index {v}°C)',
    'r.wave': 'Malaki ang alon ({v} m)', 'r.wind': 'Malakas ang hangin sa dagat ({v} kn)',
    'wx.clear': 'Maaliwalas', 'wx.cloud': 'Maulap', 'wx.fog': 'Hamog', 'wx.drizzle': 'Ambon', 'wx.rain': 'Maulan', 'wx.shower': 'Pag-ulan', 'wx.storm': 'Thunderstorm',
  },
  en: {
    tagline: 'Radar for fisherfolk, riders & hikers',
    search: 'Search a place…',
    locate: 'My location',
    'mode.general': 'All', 'mode.motorcycle': 'Rider', 'mode.hiker': 'Hiking', 'mode.fisher': 'Fisherfolk',
    layers: 'Layers', radar: 'Rain radar', sat: 'Clouds (satellite)', wind: 'Wind flow', wave: 'Waves (sea)',
    risk: 'Risk heatmap', zones: 'Flood / landslide-prone', storms: 'Storms', alerts: 'Alerts',
    'rk.overall': 'Overall', 'rk.flood': 'Flood', 'rk.wind': 'Wind', 'rk.sea': 'Waves',
    'base.dark': 'Dark', 'base.light': 'Light', 'base.sat': 'Satellite',
    basemap: 'Basemap', legend: 'Legend',
    'tab.place': 'Place', 'tab.route': 'Route', 'tab.alerts': 'Alerts',
    'lv.0': 'Low', 'lv.1': 'Moderate', 'lv.2': 'High', 'lv.3': 'Severe',
    'verdict.0': 'Conditions are fine', 'verdict.1': 'Use caution', 'verdict.2': 'High risk', 'verdict.3': 'Dangerous — do not go',
    pickHint: 'Tap the map to see conditions, risk and the best time to travel.',
    loading: 'Loading data…', error: 'Could not connect. Try again.', retry: 'Retry',
    nearLabel: '{km} km from {name}', here: 'Selected place',
    notSea: 'This spot is not at sea. For fishing, pick a point on the water.',
    cWind: 'Wind', cGust: 'Gusts', cRain: 'Rain', cRain24: 'Rain (≈24h)', cTemp: 'Heat (feels like)', cVis: 'Visibility',
    cWave: 'Waves', cSwell: 'Swell', cCur: 'Current', cElev: 'Elevation', cRiver: 'River (model)',
    riverVal: '{q} m³/s → peak {peak}',
    modesTitle: 'For each kind of trip',
    tlTitle: 'Hourly risk · next 48h', now: 'Now',
    windowsTitle: 'When you can travel', noWindow: 'No low-risk hours in the next 48 hours. Wait it out or be very careful.',
    zoneNote: 'Inside a historically flood / landslide-prone area',
    routeHere: 'Route to here',
    from: 'From', to: 'To', pickMap: 'Pick on map', myLoc: 'My location',
    pickFromToast: 'Tap the map to set the start', pickToToast: 'Tap the map to set the destination',
    findRoute: 'Find the safest route', finding: 'Analysing route…', speed: 'Boat speed (knots)',
    needPoints: 'Set a start and a destination first.',
    tagRecommended: 'Recommended', tagFastest: 'Fastest', tagSafest: 'Safest',
    routeN: 'Route {n}', seaLeg: 'Direct sea line',
    hazards: '{n} hazardous section(s)', noHazards: 'No hazardous sections right now',
    advGo: 'Good to leave now.', advWait: 'Safer if you leave at {time} ({h} h from now).',
    advCaution: 'There is risk on this route. Be careful and keep watching the weather.', advAvoid: 'Avoid travelling — risk stays high for the next 12 hours.',
    depTitle: 'Risk if you leave…', seaWarn: 'This is a straight line over water. It does not avoid land, reefs or shallows — plan the real course yourself.',
    landWarn: 'Part of this line crosses land / the shoreline.',
    hazAt: 'km {km} · ~{eta} from start',
    alertsTitle: 'Alerts now (next 12h)', noAlerts: 'No alerts right now.', stormsTitle: 'Storms / tropical cyclones',
    noStorms: 'No active tropical cyclones in the feed (GDACS).', peak: 'Peak ~{time}', sea: 'Sea', land: 'Land',
    emergency: 'Emergency', emergencyText: '911 (national emergency hotline) · Philippine Red Cross 143',
    official: 'Official warnings',
    disclaimer: 'Estimates from public forecast models — not an official warning. Always follow PAGASA, NDRRMC, your LGU and the Philippine Coast Guard.',
    demoBanner: 'DEMO DATA — not real weather (cannot reach the weather provider).',
    geoFail: 'Could not get your location. Allow location access.', noResults: 'Nothing found',
    updated: 'Updated {time}', radarFail: 'Radar could not be loaded (RainViewer).', nowcast: 'Forecast', live: 'Live',
    radarNote: 'Radar: RainViewer · Weather: Open-Meteo',
    'r.rain': 'Rain {v} mm/h', 'r.gust': 'Gusts {v} km/h', 'r.thunder': 'Thunderstorm / lightning risk', 'r.vis': 'Poor visibility ({v} km)',
    'r.flood': 'Flood risk ({v} mm rain ≈24h)', 'r.landslide': 'Landslide risk ({v} mm rain ≈3 days)', 'r.heat': 'Extreme heat (heat index {v}°C)',
    'r.wave': 'High waves ({v} m)', 'r.wind': 'Strong wind at sea ({v} kn)',
    'wx.clear': 'Clear', 'wx.cloud': 'Cloudy', 'wx.fog': 'Fog', 'wx.drizzle': 'Drizzle', 'wx.rain': 'Rain', 'wx.shower': 'Showers', 'wx.storm': 'Thunderstorm',
  },
};

Object.assign(D.fil, EXTRA.fil);
Object.assign(D.en, EXTRA.en);

let lang = 'fil';
export const getLang = () => lang;
export function setLang(l) {
  lang = D[l] ? l : 'fil';
  document.documentElement.lang = lang === 'fil' ? 'fil' : 'en';
}
export function t(key, params) {
  let s = D[lang][key] ?? D.en[key] ?? key;
  if (params) for (const k in params) s = s.replaceAll(`{${k}}`, params[k]);
  return s;
}
export const reason = (r) => t(r.river && r.k === 'flood' ? 'r.floodriver' : 'r.' + r.k, { v: r.v });
export function wx(code) {
  if (code >= 95) return t('wx.storm');
  if (code >= 80) return t('wx.shower');
  if (code >= 61) return t('wx.rain');
  if (code >= 51) return t('wx.drizzle');
  if (code >= 45) return t('wx.fog');
  if (code >= 2) return t('wx.cloud');
  return t('wx.clear');
}
