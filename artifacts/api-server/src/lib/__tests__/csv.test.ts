import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRows } from "../csv";

describe("parseCsv", () => {
  it("parses simple rows into header-keyed objects", () => {
    const csv = "Name,Send,Receive\nAlice,3,5\nBob,1,0";
    expect(parseCsv(csv)).toEqual([
      { Name: "Alice", Send: "3", Receive: "5" },
      { Name: "Bob", Send: "1", Receive: "0" },
    ]);
  });

  it("keeps commas inside quoted fields (display names / UPNs)", () => {
    const csv = 'Display Name,Storage Used (Byte)\n"Doe, Jane (Sales)",1073741824';
    expect(parseCsv(csv)).toEqual([
      { "Display Name": "Doe, Jane (Sales)", "Storage Used (Byte)": "1073741824" },
    ]);
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const csv = 'Name,Note\n"The ""Big"" Room","a, b"';
    expect(parseCsv(csv)).toEqual([{ Name: 'The "Big" Room', Note: "a, b" }]);
  });

  it("handles CRLF line endings and a leading BOM", () => {
    const csv = "﻿Name,Send\r\nAlice,3\r\nBob,7\r\n";
    expect(parseCsv(csv)).toEqual([
      { Name: "Alice", Send: "3" },
      { Name: "Bob", Send: "7" },
    ]);
  });

  it("preserves embedded newlines within quoted fields", () => {
    const csv = 'Name,Note\n"Alice","line1\nline2"';
    expect(parseCsvRows(csv)).toEqual([
      ["Name", "Note"],
      ["Alice", "line1\nline2"],
    ]);
  });

  it("returns an empty array when there is no data row", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("Name,Send")).toEqual([]);
  });

  it("fills missing trailing cells with empty strings", () => {
    const csv = "Name,Send,Receive\nAlice,3";
    expect(parseCsv(csv)).toEqual([{ Name: "Alice", Send: "3", Receive: "" }]);
  });
});
