# TERRAVUE

Libreng, **walang-login** weather radar, flood risk, hangin at alon para sa mga **mangingisda, rider (motor) at hiker** sa Pilipinas.
Free, no-login radar + hazard + safe-route app for fisherfolk, riders and hikers in the Philippines.

## Run

```bash
node server/index.js          # needs Node 20+, zero npm dependencies
# open http://localhost:3000
```

- `npm run demo`  → synthetic data (offline dev). The UI shows a red **DEMO DATA** banner.
- `npm test`      → boots the server in demo mode and checks every endpoint.
- `PORT=8080`, `OPEN_METEO_API_KEY=...` (commercial Open-Meteo plan) are the only env vars.

## What's inside

| Layer | Tech |
|---|---|
| Frontend | Vanilla ES modules + Leaflet (CDN), no build step. Tagalog / English. Mobile bottom-sheet layout, PWA shell. |
| Backend | Node `http` server: `/api/point`, `/api/grid`, `/api/route`, `/api/alerts`, `/api/storms`, `/api/zones`, `/api/geocode`. Caching, rate limit, stale-on-error. |
| Radar / clouds | RainViewer tiles (animated past + nowcast) |
| Weather, wind, waves, river | Open-Meteo forecast, marine and flood APIs |
| Routing | OSRM (driving for motor, foot for hiking); fisher mode = straight sea line |
| Tropical cyclones | GDACS feed (best-effort) |
| Search | Open-Meteo geocoding, Nominatim fallback |

## How the safety score works (`server/lib/risk.js`)

Each hour gets 0–100 per hazard (rain, gusts, thunderstorm, visibility, flood, landslide, heat, waves, sea wind),
weighted per mode (motor / hiker / fisher), then combined (worst hazard, +10 if two or more are high).
0–24 low (green) · 25–49 moderate (yellow) · 50–74 high (orange) · 75+ severe (red).
Routes are sampled every ~8 km, scored at the **time you would actually be there**, and compared across departure times for the next 12 hours.

## v0.2 additions

| Feature | How it works | Data source |
|---|---|---|
| **River Flow Alerts** | Coming 4-day peak vs last 3-day mean river discharge for 14 major rivers → Normal / Rising / Rising fast / Surging | GloFAS via Open-Meteo (a *model*, not a gauge) |
| **Dam levels** | Reads the dam table on PAGASA Flood Information at most every 30 min, sanity-checks every number, shows margin below NHWL | bagong.pagasa.dost.gov.ph/flood (HTML, no API). `TERRAVUE_PAGASA_DAMS=0` turns it off |
| **Hiking trails** | Named paths/tracks and `sac_scale` ways drawn from zoom 11; tap one for distance, climb/descent, Naismith time, elevation chart and weather/risk at the highest point | OpenStreetMap (Overpass), Open-Meteo elevation (90 m DEM) |
| **Road reports** | Flooded / closed / landslide / fallen tree / damaged road. No login, auto-expire (12-48 h), duplicates merge into confirmations, 2 independent "wala na" votes remove one, 6 reports/hour/IP. Reports on a route raise its score | Users |
| **Offline map** | "Save this area" stores ≤350 tiles of the Dark/Light basemap; service worker also keeps the last answer of each API call and shows an offline/stale banner | CARTO tiles |
| **Phone alerts** | Web Push (own VAPID + RFC 8291 implementation, zero deps). Every 15 min each saved place is checked for the next 6 h; a push is sent when the level reaches your threshold and rises | Browser push services |

### Production notes
- Set `VAPID_SUBJECT=mailto:you@yourdomain` (push services require a real contact). VAPID keys, subscriptions and road reports live in `data/` (override with `TERRAVUE_DATA`); keep that folder on a persistent disk and **back up `data/vapid.json`**, otherwise every subscriber must re-enable alerts.
- Push needs **HTTPS** (localhost is fine for testing). On iPhone it only works after "Add to Home Screen".
- Behind a proxy/CDN make sure `X-Forwarded-For` is set by *your* proxy; rate limits and report voting key on it.
- Push subscriptions store the push endpoint + a location rounded to ~1 km. Mention that in your privacy note.
- Offline tiles: CARTO/OSM tile servers are not bulk-download services, so saves are capped. For heavy offline use host your own tiles (e.g. PMTiles) and change `BASES` in `public/js/main.js`.

## Honest limitations

- **Not official.** Scores are heuristics on public forecast models. PAGASA / NDRRMC / LGU / Coast Guard advisories always win.
- **River Flow Alerts are modelled**, not PAGASA gauge readings; the cell is the nearest GloFAS channel (~5 km), so check the official bulletin. PAGASA has no public river-gauge API.
- **The dam reader is untested against the live PAGASA page** (it was built from its documented table layout, and fails safe: no number is shown unless it passes sanity checks). If PAGASA changes the page, dams show "walang live na reading".
- **Road reports are unverified** and only as good as the people using them.
- **Trail data is only as complete as OpenStreetMap**; many Philippine trails are unmapped. Elevation gain is an estimate.
- **Push delivery was tested by encrypting and decrypting a message locally**, not through real FCM/Mozilla/Apple servers.
- **Flood risk is an estimate** (rain totals, soil moisture, modelled river discharge, plus a small list of historically flood/landslide-prone areas in `server/lib/places.js`). It is not live river-gauge data.
- **Radar coverage** comes from RainViewer; where radar is sparse, use the satellite cloud layer.
- **Fisher "route" is a straight line** over water; it does not avoid land, reefs or shallows.
- Free Open-Meteo is for non-commercial use with daily limits. Responses are cached (15–30 min) and grid cells are shared between users; for heavy traffic use an API key or self-host Open-Meteo.

## v0.3: Live navigation

Route tab → pick a route → **Start** (real GPS) or **Simulation** (fake drive, works anywhere).
- Live position snapped to the route, turn-by-turn (Filipino/English), voice ("Sa 300 metro, kumanan…"), chime + vibration.
- Flood / wind / landslide / closure zones ahead are announced (1.5 km, and 450 m for severe) and shown on the map; community road reports are polled every 45 s.
- Auto-reroute when you leave the route, or when a severe report appears ahead. Screen wake lock keeps the screen on.
- Optional layer "Flood susceptibility" (MGB / GeoRiskPH).
- HTTPS: `TLS_CERT` / `TLS_KEY` env, or see DEPLOY.md.

### Honest limitations (v0.3)
- GPS needs HTTPS (or localhost). A web app can't track in the background when the screen is locked; wake lock keeps the screen on, and the nav screen warns about it.
- Voice uses the phone's speech engine. If there is no Filipino voice installed, it falls back to English voice (text stays Filipino).
- The MGB flood layer is **susceptibility** (long-term hazard), not live flooding. Live signals are river forecasts (GloFAS), PAGASA dam table, rain forecast and community reports.
- Fisher mode has no turn-by-turn on water (no sea routing data); it shows hazards along the straight line.
- Not verified against real internet in the dev sandbox: MGB tile rendering, PAGASA dam parser, real push delivery, real GPS/voice on a phone. Test on a device (checklist in DEPLOY.md / above).
