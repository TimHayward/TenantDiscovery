import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { permissionsManifest, metricDataSources } from "../manifest";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.resolve(thisDir, "../generated/permissions.manifest.json");

describe("permissions.manifest.json", () => {
  it("matches what generate-json.ts would produce from manifest.ts", async () => {
    // Normalize CRLF: git's autocrlf may rewrite line endings on checkout, but
    // generate-json.ts always writes LF, so compare content, not bytes.
    const committed = (await fs.readFile(jsonPath, "utf-8")).replace(/\r\n/g, "\n");
    const expected = `${JSON.stringify(permissionsManifest, null, 2)}\n`;
    expect(committed).toBe(expected);
  });
});

describe("metricDataSources", () => {
  it("gives every metric entry a confidenceLabel", () => {
    const missing = metricDataSources.filter((m) => !m.confidenceLabel);
    expect(missing.map((m) => m.metricId)).toEqual([]);
  });
});
