import { describe, expect, it } from "vitest";
import { sanitizeCsvCell, toCsv } from "../export/csv";

describe("sanitizeCsvCell", () => {
  it("prefixes formula-triggering cells with a leading single quote", () => {
    expect(sanitizeCsvCell("=1+1")).toBe("'=1+1");
    expect(sanitizeCsvCell("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(sanitizeCsvCell("-2")).toBe("'-2");
    expect(sanitizeCsvCell("@cmd")).toBe("'@cmd");
  });

  it("leaves ordinary cells unchanged", () => {
    expect(sanitizeCsvCell("Jane Doe")).toBe("Jane Doe");
    expect(sanitizeCsvCell("Sales (EMEA)")).toBe("Sales (EMEA)");
    // A leading negative-number string is intentionally escaped too — Excel
    // can't distinguish "-2" the number from "-2" the formula seed.
  });
});

describe("toCsv", () => {
  it("round-trips formula-triggering values with a leading quote inside the CSV cell", () => {
    const csv = toCsv(
      [{ key: "name", header: "Name" }],
      [{ name: "=1+1" }, { name: "+SUM(A1)" }, { name: "-2" }, { name: "@cmd" }],
    );
    const lines = csv.split("\r\n");
    expect(lines).toEqual(["Name", "'=1+1", "'+SUM(A1)", "'-2", "'@cmd"]);
  });

  it("still quotes cells containing commas after sanitization", () => {
    const csv = toCsv([{ key: "name", header: "Name" }], [{ name: "=Doe, Jane" }]);
    expect(csv).toBe('Name\r\n"\'=Doe, Jane"');
  });
});
