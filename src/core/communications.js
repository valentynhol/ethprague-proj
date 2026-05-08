const DEFAULT_MAX_SKEW_SECONDS = 120;

export function buildCommunicationSessions({
  pairs,
  now = new Date(),
  maxSkewSeconds = DEFAULT_MAX_SKEW_SECONDS
}) {
  return pairs.map((pair) => {
    const startTime = pair.contact.startTime;
    const endTime = pair.contact.endTime;
    const { status, statusReason } = computeSessionStatus({
      startTime,
      endTime,
      now,
      maxSkewSeconds
    });

    return {
      station: {
        id: pair.station.id,
        name: pair.station.name,
        lat: pair.station.lat,
        lon: pair.station.lon
      },
      satellite: {
        id: pair.sat.id
      },
      scheduledAt: startTime.toISOString(),
      endTime: endTime.toISOString(),
      waitSeconds: Math.max(0, Math.round((startTime.getTime() - now.getTime()) / 1000)),
      windowSeconds: Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000)),
      peakElevationDeg: pair.contact.peakElevationDeg,
      minRangeKm: pair.contact.minRangeKm,
      score: roundTo(pair.score, 4),
      status,
      statusReason,
      maxSkewSeconds
    };
  });
}

export function computeSessionStatus({ startTime, endTime, now, maxSkewSeconds }) {
  const nowMs = now.getTime();
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const skewMs = maxSkewSeconds * 1000;

  if (nowMs < startMs) {
    return { status: "scheduled", statusReason: "Waiting for link window to open." };
  }

  if (nowMs <= endMs) {
    return { status: "in-range", statusReason: "Link window open; uplink in progress." };
  }

  if (nowMs <= endMs + skewMs) {
    return { status: "late", statusReason: "Link window closed; awaiting final response." };
  }

  return {
    status: "deviation-suspected",
    statusReason: "Missed expected pass window; possible orbital deviation."
  };
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

