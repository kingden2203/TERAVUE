# TERRAVUE: paano ilagay online (HTTPS) para gumana ang GPS, voice at push

Ang browser ay HINDI nagpapagana ng live location (GPS) o push notifications sa plain `http://` (maliban sa `localhost`).
Kaya para sa phone, kailangan ng HTTPS. Tatlong paraan, pinakamadali una:

## 1. Libreng hosting (Render / Fly / Railway)  — may HTTPS agad
- Render: i-push ang folder sa GitHub → New Web Service → Docker (gagamitin ang `render.yaml`). Ang `https://<name>.onrender.com` ay ready na.
- Anumang Docker host: `docker build -t terravue . && docker run -p 8080:8080 -v tv:/data terravue`

## 2. Cloudflare Tunnel / ngrok (testing mula sa sarili mong computer)
```
node server/index.js            # port 3000
npx cloudflared tunnel --url http://localhost:3000     # o: ngrok http 3000
```
Ibibigay nito ang `https://....trycloudflare.com` na pwede mong buksan sa phone.

## 3. HTTPS sa LAN (parehong WiFi) gamit ang mkcert
```
mkcert -install && mkcert 192.168.1.20 localhost
TLS_CERT=192.168.1.20+1.pem TLS_KEY=192.168.1.20+1-key.pem node server/index.js
```
I-install din ang mkcert root CA sa phone para di magreklamo. Palitan ang IP ng nakikita sa console ("on your phone").

## Subukan nang walang GPS
Route tab → pumili ng ruta → **Simulation**. Nagpapatakbo ito ng pekeng biyahe (×1/×5/×15, may "deviate" button para i-test ang auto-reroute).
