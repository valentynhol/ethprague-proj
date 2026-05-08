import assert from "assert";
import {
  aggregateCertificate,
  buildSatelliteState,
  buildSpaceTeeKeyPair,
  buildZoneProof,
  generateEvidence,
  loadTles,
  verifyCertificate,
  verifyEvidenceSignature
} from "../src/core/seap.js";

const tles = loadTles();
const satellites = buildSatelliteState(tles);
const teeKeyPair = buildSpaceTeeKeyPair();

const demoZone = {
  id: "hackathon-venue",
  name: "Hackathon Safe Zone",
  center: { lat: 37.7749, lon: -122.4194 },
  radiusMeters: 800,
  secret: "space-fabric-demo-secret"
};

const requestId = "smoke-test";
const lat = 37.775;
const lon = -122.4195;

const zoneProof = buildZoneProof({ zone: demoZone, lat, lon });
const { evidence } = generateEvidence({ lat, lon, satellites, requestId });

for (const item of evidence) {
  assert.strictEqual(verifyEvidenceSignature(item), true);
}

const certificate = aggregateCertificate({
  evidence,
  zone: zoneProof,
  requestId,
  teeKeyPair
});

const valid = verifyCertificate({
  certificate,
  teePublicKey: certificate.signerPublicKey
});

assert.strictEqual(valid, true);
assert.strictEqual(certificate.payload.zone.zoneId, demoZone.id);

console.log("Smoke test passed.");
