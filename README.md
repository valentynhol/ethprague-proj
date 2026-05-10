# Space Fabric PoL MVP

Hackathon-ready Proof of Location (PoL) demo inspired by the Space Fabric / SpaceComputer SEAP protocol. It simulates satellite witnesses, time-of-flight verification, and a satellite-signed location certificate, plus a front-end gate that unlocks a protected action only when verification succeeds and the user is inside the safe zone.

## What is included

- Mock orbital witness service using TLEs and `satellite.js`
- Ground station to satellite pass scheduling (earliest pass per request)
- Satellite-signed location certificate with `certifiedAt`
- Verification confidence score (time-of-flight + elevation)
- Web UI with a globe visualization (real TLE positions)
- Space-gated action unlocked only after verification passes

## Quick start

```bash
npm install
npm run start
```

Open `http://localhost:3000` in your browser.

## Smoke test

```bash
npm run smoke
```

## Demo runner

```bash
npm run demo
```

## Deployment notes (GitHub Pages)

GitHub Pages only serves static assets. The API must be hosted separately.

1. Deploy the API (e.g., Render/Railway) using `npm run start`.
2. Set the UI API base in `src/public/app.js`:

```js
const API_BASE = "https://your-api.onrender.com";
```

3. Publish the static UI (copy `src/public` to `docs/`, then enable Pages from `docs/`).

## Notes

- The safe zone defaults to Prague but can be updated in `src/server.js`.
- The globe animation uses actual TLE positions and runs on simulated time for demos.
- The demo schedules the fastest upcoming pass each time the user requests a certificate.
- Certificates are signed by the primary satellite key used for the pass window.

## SpaceComputer integration

This demo uses the SpaceComputer Orbitport SDK to fetch cTRNG entropy and embeds it in the location certificate payload. When credentials are missing, it falls back to the public IPFS beacon.

Note: The Orbitport SDK requires Node.js 22+. On Node.js 20, the demo uses the IPFS beacon automatically.

Set credentials (optional):

```bash
export ORBITPORT_CLIENT_ID=your_client_id
export ORBITPORT_CLIENT_SECRET=your_client_secret
```

Fetch entropy directly:

```bash
npm run ctrng
```
