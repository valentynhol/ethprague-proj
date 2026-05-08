const zoneStatus = document.getElementById("zoneStatus");
const latInput = document.getElementById("latInput");
const lonInput = document.getElementById("lonInput");
const requestBtn = document.getElementById("requestBtn");
const certOutput = document.getElementById("certOutput");
const actionBtn = document.getElementById("actionBtn");
const actionResult = document.getElementById("actionResult");
const entropyStatus = document.getElementById("entropyStatus");
const commsStatus = document.getElementById("commsStatus");
const commsCountdown = document.getElementById("commsCountdown");
const commsOutput = document.getElementById("commsOutput");
const geoBtn = document.getElementById("geoBtn");
const defineZoneBtn = document.getElementById("defineZoneBtn");
const zoneRadiusInput = document.getElementById("zoneRadiusInput");
const zoneHint = document.getElementById("zoneHint");
const stepStatus = document.getElementById("stepStatus");
const claimedLocation = document.getElementById("claimedLocation");

let latestCertificate = null;
let map;
let locationMarker;
let zoneCircle;
let zoneCenter = null;
let defineZoneMode = false;
let commsInterval = null;
const pageLaunchMs = Date.now();
let orbitPollTimer = null;
let orbitSimSpeed = 1;
let statusPollTimer = null;

function initMap(lat, lon) {
  map = L.map("map").setView([lat, lon], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  locationMarker = L.marker([lat, lon], { draggable: true }).addTo(map);
  locationMarker.on("dragend", () => {
    const { lat: newLat, lng: newLng } = locationMarker.getLatLng();
    updateLocationInputs(newLat, newLng);
  });

  zoneCircle = L.circle([lat, lon], {
    radius: Number.parseFloat(zoneRadiusInput.value) || 800,
    color: "#2563eb",
    fillColor: "#93c5fd",
    fillOpacity: 0.25
  }).addTo(map);

  zoneCenter = { lat, lon };

  map.on("click", (event) => {
    if (defineZoneMode) {
      const { lat: zoneLat, lng: zoneLng } = event.latlng;
      setZoneCenter(zoneLat, zoneLng);
      toggleDefineZone(false);
      return;
    }

    const { lat: newLat, lng: newLng } = event.latlng;
    updateLocationInputs(newLat, newLng);
    locationMarker.setLatLng([newLat, newLng]);
  });
}

function updateLocationInputs(lat, lon) {
  latInput.value = lat.toFixed(6);
  lonInput.value = lon.toFixed(6);
  claimedLocation.textContent = `Claimed location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function setZoneCenter(lat, lon) {
  zoneCenter = { lat, lon };
  zoneCircle.setLatLng([lat, lon]);
}

function toggleDefineZone(enabled) {
  defineZoneMode = enabled;
  defineZoneBtn.textContent = enabled ? "Click Map to Set Zone Center" : "Define Safe Zone on Map";
  zoneHint.textContent = enabled
    ? "Click on the map to set the safe zone center."
    : "Click the map to move the user marker. Use the button to set the safe zone center.";
}

zoneRadiusInput.addEventListener("input", () => {
  const radius = Number.parseFloat(zoneRadiusInput.value) || 0;
  zoneCircle.setRadius(radius);
});

geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    zoneStatus.textContent = "Geolocation not supported in this browser.";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      updateLocationInputs(latitude, longitude);
      locationMarker.setLatLng([latitude, longitude]);
      map.setView([latitude, longitude], 15);
      requestCertificate();
    },
    () => {
      zoneStatus.textContent = "Unable to read current location.";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

defineZoneBtn.addEventListener("click", () => {
  toggleDefineZone(!defineZoneMode);
});

async function loadZone() {
  const response = await fetch("/api/zone");
  const data = await response.json();
  const { zone } = data;

  zoneStatus.textContent = `Zone: ${zone.name} (radius ${zone.radiusMeters}m)`;
  latInput.value = zone.center.lat;
  lonInput.value = zone.center.lon;
  claimedLocation.textContent = `Claimed location: ${zone.center.lat.toFixed(6)}, ${zone.center.lon.toFixed(6)}`;
  zoneRadiusInput.value = zone.radiusMeters;

  initMap(zone.center.lat, zone.center.lon);
}

function showWitnessingStatus() {
  const messages = [
    "Step 2: Pinging orbital constellation...",
    "Calculating time-of-flight...",
    "Verifying physical latency..."
  ];
  let index = 0;
  stepStatus.textContent = messages[index];
  return setInterval(() => {
    index = (index + 1) % messages.length;
    stepStatus.textContent = messages[index];
  }, 1400);
}

async function requestCertificate() {
  actionResult.textContent = "";
  actionBtn.disabled = true;
  certOutput.textContent = "Requesting proof...";
  entropyStatus.textContent = "Entropy source: loading";
  stepStatus.textContent = "Step 1: Claiming location";
  commsStatus.textContent = "Comms: scheduling link";
  commsCountdown.textContent = "Next link window: calculating";
  commsOutput.textContent = "Scheduling comms...";

  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }

  const lat = Number.parseFloat(latInput.value);
  const lon = Number.parseFloat(lonInput.value);
  const radiusMeters = Number.parseFloat(zoneRadiusInput.value);

  const zoneOverride = zoneCenter
    ? {
        id: "custom-zone",
        name: "Custom Safe Zone",
        center: zoneCenter,
        radiusMeters
      }
    : null;

  const witnessInterval = showWitnessingStatus();

  const response = await fetch("/api/proof-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lon, zone: zoneOverride })
  });

  clearInterval(witnessInterval);

  if (!response.ok) {
    const error = await response.json();
    certOutput.textContent = `Error: ${error.error ?? "unknown"}`;
    entropyStatus.textContent = "Entropy source: unavailable";
    stepStatus.textContent = "Step 2: Witnessing failed";
    return;
  }

  const data = await response.json();
  handleProofResponse(data);
}

requestBtn.addEventListener("click", requestCertificate);

actionBtn.addEventListener("click", () => {
  if (!latestCertificate) {
    actionResult.textContent = "No certificate available yet.";
    return;
  }
  const issuedAt = latestCertificate.payload?.certifiedAt ?? latestCertificate.payload?.issuedAt;
  actionResult.textContent = `Space-gated action executed at ${new Date().toISOString()} (certified ${issuedAt}).`;
});

loadZone().catch(() => {
  zoneStatus.textContent = "Failed to load zone.";
});

initOrbitVisualization().catch(() => {
  // Visualization is optional; ignore failures.
});

function handleProofResponse(data) {
  updateCommsDisplay(data.comms);

  if (data.zone?.center) {
    setZoneCenter(data.zone.center.lat, data.zone.center.lon);
    zoneRadiusInput.value = data.zone.radiusMeters;
    zoneCircle.setRadius(data.zone.radiusMeters);
  }

  if (data.status === "scheduled") {
    latestCertificate = null;
    entropyStatus.textContent = "Entropy source: pending";
    stepStatus.textContent = "Step 2: Waiting for satellite pass";
    certOutput.textContent = JSON.stringify(data, null, 2);
    startStatusPolling(data.requestId);
    return;
  }

  if (data.status === "missed") {
    latestCertificate = null;
    entropyStatus.textContent = "Entropy source: unavailable";
    stepStatus.textContent = "Step 2: Pass window missed";
    certOutput.textContent = JSON.stringify(data, null, 2);
    return;
  }

  finalizeCertificateResponse(data).catch(() => {
    stepStatus.textContent = "Step 3: Verification failed";
  });
}

function startStatusPolling(requestId) {
  if (!requestId) {
    return;
  }
  statusPollTimer = setInterval(async () => {
    const response = await fetch(`/api/proof-status?requestId=${requestId}`);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data.status === "scheduled") {
      updateCommsDisplay(data.comms);
      return;
    }
    clearInterval(statusPollTimer);
    statusPollTimer = null;
    handleProofResponse(data);
  }, 1000);
}

async function finalizeCertificateResponse(data) {
  latestCertificate = data.certificate;

  if (data.entropy?.value) {
    entropyStatus.textContent = `Entropy source: ${data.entropy.source} (${data.entropy.src})`;
  } else {
    entropyStatus.textContent = "Entropy source: unavailable";
  }

  certOutput.textContent = JSON.stringify(data, null, 2);
  if (data.verification?.confidencePercent != null) {
    stepStatus.textContent = `Step 3: Verification ${data.verification.confidencePercent}%`;
  } else {
    stepStatus.textContent = "Step 3: Location certificate issued";
  }

  const verifyResponse = await fetch("/api/verify-certificate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ certificate: data.certificate })
  });
  const verifyData = await verifyResponse.json();

  const passesVerification = data.verification?.verdict === true && data.zone?.insideZone === true;
  if (verifyData.valid && passesVerification) {
    actionBtn.disabled = false;
  }
}

function updateCommsDisplay(comms) {
  if (commsInterval) {
    clearInterval(commsInterval);
    commsInterval = null;
  }

  if (!comms?.sessions || comms.sessions.length === 0) {
    commsStatus.textContent = "Comms: unavailable";
    commsCountdown.textContent = "Next link window: --";
    commsOutput.textContent = "No comms sessions available.";
    return;
  }

  const primary = comms.primary ?? comms.sessions[0];
  const sessions = comms.sessions;
  const targetName = `${primary.station.name} -> ${primary.satellite.id}`;
  const simSpeed = Number.isFinite(comms.simSpeed) ? comms.simSpeed : 1;
  const simBase = new Date(comms.generatedAt ?? pageLaunchMs);
  const realBaseMs = pageLaunchMs;

  function getSimNow() {
    const deltaMs = Date.now() - realBaseMs;
    return new Date(simBase.getTime() + deltaMs * simSpeed);
  }

  function tick() {
    const now = getSimNow();
    const start = new Date(primary.scheduledAt);
    const end = new Date(primary.endTime);
    const maxSkewMs = (primary.maxSkewSeconds ?? 120) * 1000;

    if (now < start) {
      const seconds = Math.ceil((start.getTime() - now.getTime()) / 1000);
      commsStatus.textContent = `Comms: scheduled (${targetName})`;
      commsCountdown.textContent = `Next link window in ${formatDuration(seconds)}.`;
      return;
    }

    if (now <= end) {
      const seconds = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
      commsStatus.textContent = `Comms: in-range (${targetName})`;
      commsCountdown.textContent = `Link window closes in ${formatDuration(seconds)}.`;
      return;
    }

    if (now.getTime() <= end.getTime() + maxSkewMs) {
      const seconds = Math.ceil((now.getTime() - end.getTime()) / 1000);
      commsStatus.textContent = `Comms: late (${targetName})`;
      commsCountdown.textContent = `Window closed ${formatDuration(seconds)} ago. Awaiting final response.`;
      return;
    }

    const seconds = Math.ceil((now.getTime() - end.getTime()) / 1000);
    commsStatus.textContent = `Comms: deviation suspected (${targetName})`;
    commsCountdown.textContent = `Missed expected pass by ${formatDuration(seconds)}.`;
  }

  tick();
  commsInterval = setInterval(tick, 1000);
  commsOutput.textContent = JSON.stringify(sessions, null, 2);
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

async function initOrbitVisualization() {
  const orbitSvg = document.getElementById("orbitViz");
  if (!orbitSvg) {
    return;
  }

  const response = await fetch("/api/constellation");
  if (!response.ok) {
    return;
  }
  const { groundStations, satellites, simSpeed } = await response.json();
  orbitSimSpeed = Number.isFinite(simSpeed) ? simSpeed : 1;

  const size = 320;
  const center = size / 2;
  const radius = 120;
  const svgNs = "http://www.w3.org/2000/svg";

  orbitSvg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  orbitSvg.innerHTML = "";

  const earth = document.createElementNS(svgNs, "circle");
  earth.setAttribute("cx", center);
  earth.setAttribute("cy", center);
  earth.setAttribute("r", radius);
  earth.setAttribute("class", "earth-fill");
  orbitSvg.appendChild(earth);

  const grid = document.createElementNS(svgNs, "circle");
  grid.setAttribute("cx", center);
  grid.setAttribute("cy", center);
  grid.setAttribute("r", radius);
  grid.setAttribute("class", "earth-stroke");
  orbitSvg.appendChild(grid);

  const orbitRing = document.createElementNS(svgNs, "circle");
  orbitRing.setAttribute("cx", center);
  orbitRing.setAttribute("cy", center);
  orbitRing.setAttribute("r", radius + 16);
  orbitRing.setAttribute("class", "orbit-grid");
  orbitSvg.appendChild(orbitRing);

  const stationsGroup = document.createElementNS(svgNs, "g");
  const satellitesGroup = document.createElementNS(svgNs, "g");
  orbitSvg.appendChild(stationsGroup);
  orbitSvg.appendChild(satellitesGroup);

  const stationDots = groundStations.map((station) => {
    const dot = document.createElementNS(svgNs, "circle");
    dot.setAttribute("r", "3.5");
    dot.setAttribute("class", "station-point");
    dot.setAttribute("data-lat", String(station.lat));
    dot.setAttribute("data-lon", String(station.lon));
    stationsGroup.appendChild(dot);
    return dot;
  });

  const satDots = new Map();
  satellites.forEach((sat) => {
    const dot = document.createElementNS(svgNs, "circle");
    dot.setAttribute("r", "3.5");
    dot.setAttribute("class", "satellite-point");
    satellitesGroup.appendChild(dot);
    satDots.set(sat.id, dot);
  });

  if (orbitPollTimer) {
    clearTimeout(orbitPollTimer);
  }

  updateStationDots(stationDots, center, radius);

  const pollPositions = async () => {
    try {
      const simNow = pageLaunchMs + (Date.now() - pageLaunchMs) * orbitSimSpeed;
      const posResponse = await fetch(`/api/constellation-positions?time=${Math.round(simNow)}`);
      if (posResponse.ok) {
        const { satellites: positions } = await posResponse.json();
        updateSatelliteDots(positions, satDots, center, radius + 16);
      }
    } finally {
      orbitPollTimer = setTimeout(pollPositions, 1000);
    }
  };

  pollPositions();
}

function updateSatelliteDots(positions, satDots, center, radius) {
  positions.forEach((sat) => {
    const dot = satDots.get(sat.id);
    if (!dot) {
      return;
    }
    const { x, y, visible } = projectLatLon(sat.lat, sat.lon, center, radius);
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.style.opacity = visible ? "1" : "0.25";
  });
}

function updateStationDots(dots, center, radius) {
  dots.forEach((dot) => {
    const lat = Number.parseFloat(dot.getAttribute("data-lat"));
    const lon = Number.parseFloat(dot.getAttribute("data-lon"));
    const { x, y, visible } = projectLatLon(lat, lon, center, radius);
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.style.opacity = visible ? "1" : "0.2";
  });
}

function projectLatLon(latDeg, lonDeg, center, radius) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const visible = cosLat * cosLon > 0;
  const x = center + radius * cosLat * sinLon;
  const y = center - radius * sinLat;
  return { x, y, visible };
}

