import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadGroundStations() {
  const stationsPath = path.join(__dirname, "..", "data", "groundStations.json");
  const raw = fs.readFileSync(stationsPath, "utf-8");
  return JSON.parse(raw);
}

