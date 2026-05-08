import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import * as satellite from "satellite.js";
import { sha256Hex, signPayload, verifyPayload } from "./crypto.js";

const SPEED_OF_LIGHT_MPS = 299_792_458;
const DEFAULT_ELEVATION_DEG = 10;
const MAX_TOF_SECONDS = 0.020;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadTles() {
  const tlePath = path.join(__dirname, "..", "data", "tles.json");
  const raw = fs.readFileSync(tlePath, "utf-8");
  return JSON.parse(raw);
}

export function buildSatelliteState(tles) {
  return tles.map((tle, index) => {
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const isRenamed = typeof tle.id === "string" && tle.id.startsWith("SpaceComputer-");
    const normalizedId = isRenamed
      ? tle.id
      : `SpaceComputer-${String(index + 1).padStart(5, "0")}`;
    return {
      id: normalizedId,
      originalId: isRenamed ? (tle.originalId ?? null) : tle.id,
      line1: tle.line1,
      line2: tle.line2,
      satrec,
      publicKey,
      privateKey
    };
  });
}

export function buildSpaceTeeKeyPair() {
  return crypto.generateKeyPairSync("ed25519");
}

export function computeEvidence({
  sat,
  observerGd,
  date,
  requestId,
  minElevationDeg = DEFAULT_ELEVATION_DEG,
  maxTofSeconds = MAX_TOF_SECONDS
}) {
  const positionVelocity = satellite.propagate(sat.satrec, date);
  if (!positionVelocity.position) {
    return null;
  }

  const gmst = satellite.gstime(date);
  const positionEcf = satellite.eciToEcf(positionVelocity.position, gmst);
  const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);

  const elevationDeg = satellite.degreesLat(lookAngles.elevation);
  if (elevationDeg < minElevationDeg) {
    return null;
  }

  const rangeMeters = lookAngles.rangeSat * 1000;
  const expectedTofSec = rangeMeters / SPEED_OF_LIGHT_MPS;
  const observedTofSec = expectedTofSec + randomJitterSeconds();
  const latencyCheckPass = expectedTofSec <= maxTofSeconds;

  if (!latencyCheckPass) {
    return null;
  }

  const payload = {
    satId: sat.id,
    requestId,
    recvTime: date.toISOString(),
    expectedTofSec: roundTo(expectedTofSec, 12),
    observedTofSec: roundTo(observedTofSec, 12),
    elevationDeg: roundTo(elevationDeg, 6),
    positionEcfKm: {
      x: roundTo(positionEcf.x, 6),
      y: roundTo(positionEcf.y, 6),
      z: roundTo(positionEcf.z, 6)
    }
  };

  return {
    payload,
    signature: signPayload(sat.privateKey, payload),
    publicKey: sat.publicKey.export({ type: "spki", format: "pem" })
  };
}

export function generateEvidence({
  lat,
  lon,
  altMeters,
  satellites,
  requestId,
  minElevationDeg,
  maxTofSeconds,
  date
}) {
  const evidenceDate = date ?? new Date();
  const observerGd = {
    longitude: satellite.degreesToRadians(lon),
    latitude: satellite.degreesToRadians(lat),
    height: (altMeters ?? 0) / 1000
  };

  const evidence = satellites
    .map((sat) =>
      computeEvidence({
        sat,
        observerGd,
        date: evidenceDate,
        requestId,
        minElevationDeg,
        maxTofSeconds
      })
    )
    .filter(Boolean);

  return {
    evidence,
    observedAt: evidenceDate.toISOString()
  };
}

export function aggregateCertificate({
  evidence,
  zone,
  requestId,
  teeKeyPair,
  entropy,
  location,
  signerKeyPair,
  signerId,
  issuedAt,
  certifiedAt,
  signerType
}) {
  const evidenceHashes = evidence.map((item) => sha256Hex(JSON.stringify(item.payload)));
  const zoneClaim = {
    zoneId: zone.zoneId,
    insideZone: zone.insideZone
  };

  const issuedDate = issuedAt ?? new Date();
  const certifiedDate = certifiedAt ?? issuedDate;

  const certificatePayload = {
    requestId,
    issuedAt: issuedDate.toISOString(),
    certifiedAt: certifiedDate.toISOString(),
    signer: signerId ?? "space-tee",
    signerType: signerType ?? (signerId?.startsWith("sat:") ? "satellite" : "space-tee"),
    zone: zoneClaim,
    location: location ?? null,
    evidenceCount: evidence.length,
    evidenceHashes,
    zkProof: zone.zkProof,
    entropy: entropy ?? null
  };

  const activeSigner = signerKeyPair ?? teeKeyPair;

  return {
    payload: certificatePayload,
    signature: signPayload(activeSigner.privateKey, certificatePayload),
    signerPublicKey: activeSigner.publicKey.export({ type: "spki", format: "pem" })
  };
}

export function verifyCertificate({ certificate, teePublicKey }) {
  return verifyPayload(teePublicKey, certificate.payload, certificate.signature);
}

export function buildZoneProof({ zone, lat, lon }) {
  const insideZone = isInsideZone(zone, lat, lon);
  const secret = zone.secret;
  const claimHash = sha256Hex(`${secret}:${lat}:${lon}:${zone.id}`);

  return {
    zoneId: zone.id,
    insideZone,
    zkProof: {
      scheme: "mock-hash",
      commitment: claimHash,
      note: "Mock ZK proof for demo; replace with real boundary ZKP."
    }
  };
}

export function isInsideZone(zone, lat, lon) {
  const distanceMeters = haversineMeters(
    lat,
    lon,
    zone.center.lat,
    zone.center.lon
  );
  return distanceMeters <= zone.radiusMeters;
}

export function verifyEvidenceSignature(evidenceItem) {
  const publicKey = crypto.createPublicKey(evidenceItem.publicKey);
  return verifyPayload(publicKey, evidenceItem.payload, evidenceItem.signature);
}

function randomJitterSeconds() {
  return (Math.random() * 5e-6) - 2.5e-6;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}
