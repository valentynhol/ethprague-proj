import * as satellite from "satellite.js";

const DEFAULT_MIN_ELEVATION_DEG = 10;

export function findBestStationLinks({
  userLat,
  userLon,
  satellites,
  groundStations,
  startDate = new Date(),
  windowMinutes = 30,
  stepSeconds = 30,
  minElevationDeg = DEFAULT_MIN_ELEVATION_DEG,
  minLinks = 3
}) {
  const stationPlans = groundStations.map((station) => {
    const contacts = satellites
      .map((sat) => ({ sat, contact: findNextContact({
        sat,
        station,
        startDate,
        windowMinutes,
        stepSeconds,
        minElevationDeg
      }) }))
      .filter((item) => item.contact)
      .sort((a, b) => a.contact.startTime - b.contact.startTime);

    return {
      station,
      contacts,
      soonest: contacts[0]?.contact?.startTime ?? null,
      distanceMeters: haversineMeters(userLat, userLon, station.lat, station.lon)
    };
  });

  const viable = stationPlans.filter((plan) => plan.contacts.length >= minLinks);
  const candidates = viable.length > 0 ? viable : stationPlans;

  candidates.sort((a, b) => {
    const aTime = a.soonest?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.soonest?.getTime?.() ?? Number.MAX_SAFE_INTEGER;
    if (a.contacts.length !== b.contacts.length) {
      return b.contacts.length - a.contacts.length;
    }
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.distanceMeters - b.distanceMeters;
  });

  const best = candidates[0];
  if (!best || best.contacts.length === 0) {
    return null;
  }

  return {
    station: best.station,
    contacts: best.contacts.slice(0, Math.max(minLinks, 1))
  };
}

export function buildObserverGd({ lat, lon, altMeters = 0 }) {
  return {
    longitude: satellite.degreesToRadians(lon),
    latitude: satellite.degreesToRadians(lat),
    height: altMeters / 1000
  };
}

function findNextContact({
  sat,
  station,
  startDate,
  windowMinutes,
  stepSeconds,
  minElevationDeg
}) {
  const observerGd = buildObserverGd({
    lat: station.lat,
    lon: station.lon,
    altMeters: station.altMeters ?? 0
  });

  const windowSeconds = windowMinutes * 60;
  let inView = false;
  let startTime = null;
  let maxElevationDeg = -90;
  let maxRangeKm = null;

  for (let t = 0; t <= windowSeconds; t += stepSeconds) {
    const date = new Date(startDate.getTime() + t * 1000);
    const positionVelocity = satellite.propagate(sat.satrec, date);
    if (!positionVelocity.position) {
      continue;
    }

    const gmst = satellite.gstime(date);
    const positionEcf = satellite.eciToEcf(positionVelocity.position, gmst);
    const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);
    const elevationDeg = satellite.degreesLat(lookAngles.elevation);

    if (elevationDeg >= minElevationDeg) {
      if (!inView) {
        inView = true;
        startTime = date;
      }
      if (elevationDeg > maxElevationDeg) {
        maxElevationDeg = elevationDeg;
        maxRangeKm = lookAngles.rangeSat;
      }
    } else if (inView) {
      return {
        startTime,
        endTime: date,
        peakElevationDeg: roundTo(maxElevationDeg, 4),
        minRangeKm: roundTo(maxRangeKm, 4)
      };
    }
  }

  if (inView && startTime) {
    return {
      startTime,
      endTime: new Date(startDate.getTime() + windowSeconds * 1000),
      peakElevationDeg: roundTo(maxElevationDeg, 4),
      minRangeKm: roundTo(maxRangeKm, 4)
    };
  }

  return null;
}

export function rankStationPairs({
  userLat,
  userLon,
  satellites,
  groundStations,
  startDate = new Date(),
  windowMinutes = 30,
  stepSeconds = 30,
  minElevationDeg = DEFAULT_MIN_ELEVATION_DEG,
  maxPairs = 3,
  uniqueSatellites = true
}) {
  const pairs = [];

  groundStations.forEach((station) => {
    const distanceMeters = haversineMeters(userLat, userLon, station.lat, station.lon);
    satellites.forEach((sat) => {
      const contact = findNextContact({
        sat,
        station,
        startDate,
        windowMinutes,
        stepSeconds,
        minElevationDeg
      });
      if (!contact) {
        return;
      }
      const score = scoreContact({ contact, startDate, distanceMeters });
      pairs.push({ station, sat, contact, score, distanceMeters });
    });
  });

  pairs.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    return a.contact.startTime - b.contact.startTime;
  });

  if (!uniqueSatellites) {
    return pairs.slice(0, Math.max(1, maxPairs));
  }

  const selected = [];
  const used = new Set();
  for (const pair of pairs) {
    if (selected.length >= maxPairs) {
      break;
    }
    if (used.has(pair.sat.id)) {
      continue;
    }
    selected.push(pair);
    used.add(pair.sat.id);
  }

  return selected;
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

function scoreContact({ contact, startDate, distanceMeters }) {
  const timeToStartMinutes =
    (contact.startTime.getTime() - startDate.getTime()) / 1000 / 60;
  const distancePenalty = distanceMeters / 1_000_000;
  return contact.peakElevationDeg * 2 - timeToStartMinutes - distancePenalty;
}
