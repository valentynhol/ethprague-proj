import crypto from "crypto";
import { stableStringify } from "./stableJson.js";

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function signPayload(privateKey, payload) {
  const message = Buffer.from(stableStringify(payload));
  const signature = crypto.sign(null, message, privateKey);
  return signature.toString("base64");
}

export function verifyPayload(publicKey, payload, signatureB64) {
  const message = Buffer.from(stableStringify(payload));
  const signature = Buffer.from(signatureB64, "base64");
  return crypto.verify(null, message, publicKey, signature);
}

