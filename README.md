# Space Fabric PoL MVP

Hackathon-ready Proof of Location (PoL) demo inspired by the Space Fabric / SpaceComputer SEAP protocol. It simulates satellite witnesses, distance-bounding checks, and a SpaceTEE-signed location certificate, plus a front-end gate that unlocks a protected action only when the certificate verifies and the user is inside the safe zone.

## What is included

- Mock orbital witness service using TLEs and `satellite.js`
- SEAP-inspired evidence generation and aggregation
- SpaceTEE-signed location certificate
- Mock ZK boundary proof (hash-based commitment)
- Web UI that gates an action based on the certificate
- Ground station to satellite comms planning with live countdowns

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

## Notes

- The ZK proof is a placeholder. Swap in a real boundary proof (e.g., zkSNARK or Plonk) to meet privacy requirements.
- Evidence signatures are generated with ephemeral Ed25519 keys on each server start.
- The safe zone is hard-coded in `src/server.js` and can be updated for your venue.
- The API will fall back to a relaxed evidence policy if fewer than three satellites are in view so the demo remains usable.
- Certificates now include a satellite-signed `certifiedAt` timestamp when the primary link window opens.

## SpaceComputer integration

This demo now uses the SpaceComputer Orbitport SDK to fetch cTRNG entropy and embeds it in the location certificate payload. When credentials are missing, it falls back to the public IPFS beacon.

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
