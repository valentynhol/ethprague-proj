const DEFAULT_BEACON_URL =
  "https://ipfs.io/ipns/k2k4r8lvomw737sajfnpav0dpeernugnryng50uheyk1k39lursmn09f";

export async function fetchCtrngWithFallback({
  clientId,
  clientSecret,
  index = 0,
  beaconUrl = DEFAULT_BEACON_URL
} = {}) {
  const errors = [];

  try {
    const entropy = await fetchCtrngViaSdk({ clientId, clientSecret, index });
    return { entropy, errors };
  } catch (error) {
    errors.push(normalizeError(error));
  }

  try {
    const entropy = await fetchCtrngViaBeacon({ index, beaconUrl });
    return { entropy, errors };
  } catch (error) {
    errors.push(normalizeError(error));
  }

  return { entropy: null, errors };
}

async function fetchCtrngViaSdk({ clientId, clientSecret, index }) {
  const majorVersion = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (Number.isFinite(majorVersion) && majorVersion < 22) {
    throw new Error("Orbitport SDK requires Node.js >= 22");
  }

  const { OrbitportSDK } = await import("@spacecomputer-io/orbitport-sdk-ts");
  const config = {};
  if (clientId && clientSecret) {
    config.clientId = clientId;
    config.clientSecret = clientSecret;
  }

  const sdk = new OrbitportSDK({ config });
  const result = await sdk.ctrng.random({ index });

  return {
    source: "sdk",
    src: result.data.src ?? result.data.service,
    value: result.data.data,
    timestamp: result.data.timestamp ?? result.metadata?.timestamp,
    signature: result.data.signature ?? null,
    provider: result.data.provider ?? null,
    requestId: result.metadata?.request_id ?? null
  };
}

async function fetchCtrngViaBeacon({ index, beaconUrl }) {
  const response = await fetch(beaconUrl);
  if (!response.ok) {
    throw new Error(`Beacon HTTP ${response.status}`);
  }

  const payload = await response.json();
  const values = payload?.data?.ctrng;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Beacon payload missing ctrng array");
  }

  const normalizedIndex = Math.abs(index) % values.length;

  return {
    source: "ipfs-beacon",
    src: "ipfs",
    value: values[normalizedIndex],
    timestamp: payload?.data?.timestamp ?? null,
    sequence: payload?.data?.sequence ?? null,
    beaconUrl
  };
}

function normalizeError(error) {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "Unknown error" };
}
