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
import { fetchCtrngWithFallback } from "../src/core/spacecomputer.js";

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

const requestId = "demo-request";
const lat = 37.775;
const lon = -122.4195;

const zoneProof = buildZoneProof({ zone: demoZone, lat, lon });
const { evidence } = generateEvidence({ lat, lon, satellites, requestId });
const verifiedEvidence = evidence.filter(verifyEvidenceSignature);
const { entropy } = await fetchCtrngWithFallback();
const certificate = aggregateCertificate({
  evidence: verifiedEvidence,
  zone: zoneProof,
  requestId,
  teeKeyPair,
  entropy
});

const valid = verifyCertificate({
  certificate,
  teePublicKey: certificate.signerPublicKey
});

console.log(
  JSON.stringify(
    {
      requestId,
      zone: zoneProof,
      evidenceCount: verifiedEvidence.length,
      certValid: valid
    },
    null,
    2
  )
);
