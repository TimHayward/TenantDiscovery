import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { permissionsManifest } from "../src/manifest.ts";

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const outputPath = path.resolve(thisDir, "../src/generated/permissions.manifest.json");

await writeFile(outputPath, `${JSON.stringify(permissionsManifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);