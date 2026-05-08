const CELESTRAK_URL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle";

export async function loadTlesWithFallback({
  fetchUrl = CELESTRAK_URL,
  maxSatellites = 12,
  fallbackLoader
} = {}) {
  const errors = [];

  try {
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`CelesTrak HTTP ${response.status}`);
    }
    const text = await response.text();
    const tles = parseTleText(text).slice(0, maxSatellites);
    if (tles.length === 0) {
      throw new Error("No TLE entries parsed from CelesTrak response");
    }
    return { tles, source: "celestrak", errors };
  } catch (error) {
    errors.push(normalizeError(error));
  }

  if (fallbackLoader) {
    try {
      const tles = fallbackLoader();
      return { tles, source: "local", errors };
    } catch (error) {
      errors.push(normalizeError(error));
    }
  }

  return { tles: [], source: "none", errors };
}

export function parseTleText(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const tles = [];
  for (let i = 0; i < lines.length; i += 3) {
    const name = lines[i];
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!line1 || !line2) {
      continue;
    }
    tles.push({ id: name, line1, line2 });
  }
  return tles;
}

function normalizeError(error) {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "Unknown error" };
}

