import { fetchCtrngWithFallback } from "../src/core/spacecomputer.js";

const { entropy, errors } = await fetchCtrngWithFallback({
  clientId: process.env.ORBITPORT_CLIENT_ID,
  clientSecret: process.env.ORBITPORT_CLIENT_SECRET
});

if (!entropy) {
  console.error("Failed to fetch cTRNG entropy.");
  console.error(errors);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      source: entropy.source,
      src: entropy.src,
      value: entropy.value,
      timestamp: entropy.timestamp ?? null
    },
    null,
    2
  )
);

