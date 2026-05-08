import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import * as satellite from "satellite.js";
import { fetchCtrngWithFallback } from "./core/spacecomputer.js";
import { loadTlesWithFallback } from "./core/tle.js";
import { loadGroundStations } from "./core/groundStations.js";
import { rankStationPairs } from "./core/links.js";
import { buildCommunicationSessions } from "./core/communications.js";
import {
  aggregateCertificate,
  buildSatelliteState,
  buildSpaceTeeKeyPair,
  buildZoneProof,
  generateEvidence,
  loadTles,
  verifyCertificate,
  verifyEvidenceSignature
} from "./core/seap.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const tlesResult = await loadTlesWithFallback({ fallbackLoader: loadTles });
if (tlesResult.tles.length === 0) {
  throw new Error("Unable to load any TLE data.");
}
const satellites = buildSatelliteState(tlesResult.tles);
const groundStations = loadGroundStations();
const teeKeyPair = buildSpaceTeeKeyPair();
const COMM_SIM_SPEED = 30;
const VERIFICATION_THRESHOLD = 0.75;
const scheduledRequests = new Map();

const demoZone = {
  id: "hackathon-venue",
  name: "Hackathon Safe Zone",
  center: { lat: 50.087773, lon: 14.427644 },
  radiusMeters: 800,
  secret: "space-fabric-demo-secret"
};

app.get("/api/zone", (req, res) => {
  res.json({
    zone: {
      id: demoZone.id,
      name: demoZone.name,
      center: demoZone.center,
      radiusMeters: demoZone.radiusMeters
    }
  });
});

app.get("/api/constellation", (req, res) => {
  res.json({
    groundStations,
    satellites: satellites.map((sat) => ({
      id: sat.id,
      originalId: sat.originalId ?? null
    })),
    simSpeed: COMM_SIM_SPEED
  });
});

app.get("/api/constellation-positions", (req, res) => {
  const requestedTimeMs = Number.parseFloat(req.query.time);
  const now = Number.isFinite(requestedTimeMs)
    ? new Date(requestedTimeMs)
    : new Date();
  const positions = satellites
    .map((sat) => {
      const positionVelocity = satellite.propagate(sat.satrec, now);
      if (!positionVelocity.position) {
        return null;
      }
      const gmst = satellite.gstime(now);
      const geodetic = satellite.eciToGeodetic(positionVelocity.position, gmst);
      const lat = satellite.degreesLat(geodetic.latitude);
      const lon = satellite.degreesLong(geodetic.longitude);
      return {
        id: sat.id,
        lat,
        lon,
        altKm: geodetic.height
      };
    })
    .filter(Boolean);

  res.json({
    generatedAt: now.toISOString(),
    satellites: positions
  });
});

app.post("/api/proof-request", async (req, res) => {
  const {
    lat,
    lon,
    altMeters = 0,
    requestId = crypto.randomUUID(),
    zone
  } = req.body ?? {};

  if (typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ error: "lat and lon are required numbers." });
  }

  const selectedZone = normalizeZone(zone) ?? demoZone;
  const zoneProof = buildZoneProof({ zone: selectedZone, lat, lon });

  const pairCandidates = rankStationPairs({
    userLat: lat,
    userLon: lon,
    satellites,
    groundStations,
    windowMinutes: 45,
    stepSeconds: 30,
    minElevationDeg: 10,
    maxPairs: 3
  });

  if (pairCandidates.length === 0) {
    return res.status(503).json({ error: "No ground station links available in the current window." });
  }

  const sortedPairs = pairCandidates
    .slice()
    .sort((a, b) => a.contact.startTime - b.contact.startTime);
  const primaryPair = sortedPairs[0];
  const contactTime = primaryPair.contact.startTime ?? new Date();
  const responseTime = new Date();
  const commSessions = buildCommunicationSessions({ pairs: sortedPairs, now: responseTime });
  const commsSimSpeed = COMM_SIM_SPEED;

  const schedule = {
    requestId,
    lat,
    lon,
    altMeters,
    zone: selectedZone,
    zoneProof,
    contactTime,
    endTime: primaryPair.contact.endTime,
    pairs: sortedPairs
  };
  scheduledRequests.set(requestId, schedule);

  const currentStatus = resolvePassStatus(schedule, responseTime);
  if (currentStatus !== "in-range") {
    return res.json({
      requestId,
      status: currentStatus,
      zone: {
        id: selectedZone.id,
        name: selectedZone.name,
        center: selectedZone.center,
        radiusMeters: selectedZone.radiusMeters,
        insideZone: zoneProof.insideZone
      },
      tleSource: tlesResult.source,
      pairPlan: formatPairPlan(sortedPairs),
      comms: {
        primary: commSessions[0] ?? null,
        sessions: commSessions,
        generatedAt: responseTime.toISOString(),
        simSpeed: commsSimSpeed
      }
    });
  }

  const result = await finalizeCertificate({
    schedule,
    responseTime,
    commSessions,
    commsSimSpeed
  });
  scheduledRequests.delete(requestId);
  return res.json(result);
});

app.get("/api/proof-status", async (req, res) => {
  const requestId = String(req.query.requestId ?? "");
  if (!requestId || !scheduledRequests.has(requestId)) {
    return res.status(404).json({ error: "Unknown requestId." });
  }

  const schedule = scheduledRequests.get(requestId);
  const responseTime = new Date();
  const commSessions = buildCommunicationSessions({ pairs: schedule.pairs, now: responseTime });
  const commsSimSpeed = COMM_SIM_SPEED;
  const currentStatus = resolvePassStatus(schedule, responseTime);

  if (currentStatus !== "in-range") {
    if (currentStatus === "missed") {
      scheduledRequests.delete(requestId);
    }
    return res.json({
      requestId,
      status: currentStatus,
      zone: {
        id: schedule.zone.id,
        name: schedule.zone.name,
        center: schedule.zone.center,
        radiusMeters: schedule.zone.radiusMeters,
        insideZone: schedule.zoneProof.insideZone
      },
      tleSource: tlesResult.source,
      pairPlan: formatPairPlan(schedule.pairs),
      comms: {
        primary: commSessions[0] ?? null,
        sessions: commSessions,
        generatedAt: responseTime.toISOString(),
        simSpeed: commsSimSpeed
      }
    });
  }

  const result = await finalizeCertificate({
    schedule,
    responseTime,
    commSessions,
    commsSimSpeed
  });
  scheduledRequests.delete(requestId);
  res.json(result);
});

app.post("/api/verify-certificate", (req, res) => {
  const { certificate } = req.body ?? {};
  if (!certificate?.payload || !certificate?.signature || !certificate?.signerPublicKey) {
    return res.status(400).json({ valid: false, error: "Missing certificate fields." });
  }

  const valid = verifyCertificate({
    certificate,
    teePublicKey: certificate.signerPublicKey
  });
  res.json({ valid });
});

function formatPairPlan(pairs) {
  return pairs.map((pair) => ({
    station: {
      id: pair.station.id,
      name: pair.station.name,
      lat: pair.station.lat,
      lon: pair.station.lon
    },
    satId: pair.sat.id,
    score: roundTo(pair.score, 4),
    startTime: pair.contact.startTime.toISOString(),
    endTime: pair.contact.endTime.toISOString(),
    peakElevationDeg: pair.contact.peakElevationDeg,
    minRangeKm: pair.contact.minRangeKm
  }));
}

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`SEAP demo server listening on http://localhost:${port}`);
});

function normalizeZone(zone) {
  if (!zone || !zone.center) {
    return null;
  }

  const radiusMeters = Number.parseFloat(zone.radiusMeters);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    return null;
  }

  const lat = Number.parseFloat(zone.center.lat);
  const lon = Number.parseFloat(zone.center.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    id: String(zone.id ?? "custom-zone"),
    name: String(zone.name ?? "Custom Safe Zone"),
    center: { lat, lon },
    radiusMeters,
    secret: demoZone.secret
  };
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function resolvePassStatus(schedule, now) {
  if (now < schedule.contactTime) {
    return "scheduled";
  }
  if (now <= schedule.endTime) {
    return "in-range";
  }
  return "missed";
}

async function finalizeCertificate({ schedule, responseTime, commSessions, commsSimSpeed }) {
  let { evidence, observedAt } = generateEvidence({
    lat: schedule.lat,
    lon: schedule.lon,
    altMeters: schedule.altMeters,
    satellites: schedule.pairs.map((item) => item.sat),
    requestId: schedule.requestId,
    date: schedule.contactTime
  });

  let evidencePolicy = "strict";
  if (evidence.length < 3) {
    ({ evidence, observedAt } = generateEvidence({
      lat: schedule.lat,
      lon: schedule.lon,
      altMeters: schedule.altMeters,
      satellites: schedule.pairs.map((item) => item.sat),
      requestId: schedule.requestId,
      date: schedule.contactTime,
      minElevationDeg: -90,
      maxTofSeconds: 0.05
    }));
    evidencePolicy = "relaxed";
  }

  const { entropy, errors: entropyErrors } = await fetchCtrngWithFallback({
    clientId: process.env.ORBITPORT_CLIENT_ID,
    clientSecret: process.env.ORBITPORT_CLIENT_SECRET
  });

  const signerContact = schedule.pairs[0] ?? null;
  const verifiedEvidence = evidence.filter(verifyEvidenceSignature);
  const verification = scoreVerification({
    evidence: verifiedEvidence,
    lat: schedule.lat,
    lon: schedule.lon,
    requestId: schedule.requestId
  });
  const certificate = aggregateCertificate({
    evidence: verifiedEvidence,
    zone: schedule.zoneProof,
    requestId: schedule.requestId,
    teeKeyPair,
    entropy,
    location: {
      lat: schedule.lat,
      lon: schedule.lon,
      altMeters: schedule.altMeters ?? 0
    },
    signerKeyPair: signerContact?.sat,
    signerId: signerContact ? `sat:${signerContact.sat.id}` : "space-tee",
    signerType: signerContact ? "satellite" : "space-tee",
    issuedAt: schedule.contactTime,
    certifiedAt: schedule.contactTime
  });

  return {
    requestId: schedule.requestId,
    status: "complete",
    observedAt,
    evidencePolicy,
    verification,
    zone: {
      id: schedule.zone.id,
      name: schedule.zone.name,
      center: schedule.zone.center,
      radiusMeters: schedule.zone.radiusMeters,
      insideZone: schedule.zoneProof.insideZone
    },
    tleSource: tlesResult.source,
    pairPlan: formatPairPlan(schedule.pairs),
    comms: {
      primary: commSessions[0] ?? null,
      sessions: commSessions,
      generatedAt: responseTime.toISOString(),
      simSpeed: commsSimSpeed
    },
    entropy,
    entropyErrors,
    evidence: verifiedEvidence,
    certificate,
    signerPublicKey: certificate.signerPublicKey
  };
}

function scoreVerification({ evidence, lat, lon, requestId }) {
  const evidenceCount = evidence.length;
  const avgElevation = average(evidence.map((item) => item.payload.elevationDeg));
  const tofResidual = average(evidence.map((item) => Math.abs(item.payload.observedTofSec - item.payload.expectedTofSec)));

  const baseErrorMeters = 150 + (1 - clamp(avgElevation / 90, 0, 1)) * 700;
  const densityPenalty = Math.max(0, 3 - evidenceCount) * 250;
  const tofPenalty = clamp(tofResidual / 0.00001, 0, 1) * 300;
  const jitter = seededRandom(`${requestId}:${lat}:${lon}`) * 120;
  const estimatedErrorMeters = baseErrorMeters + densityPenalty + tofPenalty + jitter;

  const confidence = clamp(1 - estimatedErrorMeters / 1500, 0, 1) * clamp(evidenceCount / 3, 0, 1);
  const verdict = confidence >= VERIFICATION_THRESHOLD;

  return {
    confidence: roundTo(confidence, 4),
    confidencePercent: Math.round(confidence * 100),
    estimatedErrorMeters: Math.round(estimatedErrorMeters),
    avgElevationDeg: roundTo(avgElevation, 2),
    evidenceCount,
    verdict,
    threshold: VERIFICATION_THRESHOLD
  };
}

function average(values) {
  if (!values || values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function seededRandom(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}
