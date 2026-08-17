import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createAppFixture, type AppFixture } from "../../__fixtures__/testApp.js";
import { makeFinding } from "../../__fixtures__/inMemoryStore.js";

let fixture: AppFixture;

beforeEach(async () => {
  fixture = await createAppFixture();
});

afterAll(async () => {
  await fixture.dispose();
});

/** Put a known register in place and make it visible to the read path. */
async function seedRegister(): Promise<void> {
  fixture.setFindings([
    makeFinding("identity.globalAdminCount", { category: "identity", severity: "critical" }),
    makeFinding("licensing.unusedInventory", {
      category: "licensing",
      severity: "low",
      checkStatus: "warning",
    }),
    makeFinding("compliance.auditLogging", { category: "compliance", severity: "medium" }),
  ]);
  await fixture.metricStore.set("m365-users", { total: 1 });
  await fixture.findingsStore.regenerateFindings();
}

describe("GET /api/m365/findings", () => {
  it("returns the register with a total and a severity/status summary", async () => {
    await seedRegister();

    const res = await request(fixture.app).get("/api/m365/findings").expect(200);

    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.total).toBe(3);
    expect(res.body.findings).toHaveLength(3);
    // Severity rank orders the register, so the critical finding leads.
    expect(res.body.findings[0].fingerprint).toBe("identity.globalAdminCount");
    expect(res.body.summary).toEqual({
      bySeverity: { critical: 1, medium: 1, low: 1 },
      byStatus: { open: 3 },
    });
    // Findings with no lifecycle row read as open rather than as null.
    expect(res.body.findings.every((f: { status: string }) => f.status === "open")).toBe(true);
  });

  it("applies the severity, status and category filters", async () => {
    await seedRegister();
    await fixture.findingsStore.updateFindingState("compliance.auditLogging", {
      status: "acknowledged",
    });

    const bySeverity = await request(fixture.app)
      .get("/api/m365/findings?severity=critical")
      .expect(200);
    expect(bySeverity.body.findings.map((f: { fingerprint: string }) => f.fingerprint)).toEqual([
      "identity.globalAdminCount",
    ]);
    expect(bySeverity.body.total).toBe(1);

    const byStatus = await request(fixture.app)
      .get("/api/m365/findings?status=acknowledged")
      .expect(200);
    expect(byStatus.body.findings.map((f: { fingerprint: string }) => f.fingerprint)).toEqual([
      "compliance.auditLogging",
    ]);

    const byCategory = await request(fixture.app)
      .get("/api/m365/findings?category=licensing")
      .expect(200);
    expect(byCategory.body.findings.map((f: { fingerprint: string }) => f.fingerprint)).toEqual([
      "licensing.unusedInventory",
    ]);
  });

  it("rejects an unknown severity with 400 and the Zod issue shape, not 500", async () => {
    await seedRegister();

    const res = await request(fixture.app).get("/api/m365/findings?severity=urgent").expect(400);

    expect(res.body.error).toBe("Invalid request query");
    expect(res.body.issues).toHaveProperty("fieldErrors.severity");
    // Asserted on intent, not on Zod's phrasing: the message must name the
    // rejected field's permitted values so a caller can correct the request.
    // Zod 4 rewrote this string (v3 said "Invalid enum value"), and pinning the
    // exact wording made a library upgrade look like a route regression.
    const [severityIssue] = res.body.issues.fieldErrors.severity;
    for (const allowed of ["critical", "high", "medium", "low"]) {
      expect(severityIssue).toContain(allowed);
    }
    expect(res.body.issues.formErrors).toEqual([]);
    // A validation failure must not disclose anything about the server.
    expect(JSON.stringify(res.body)).not.toMatch(/at .*[\\/]src[\\/]/);
  });

  it("rejects an unknown status with 400", async () => {
    await seedRegister();
    const res = await request(fixture.app).get("/api/m365/findings?status=closed").expect(400);
    expect(res.body.issues).toHaveProperty("fieldErrors.status");
  });

  it("returns 500 with a fixed message, and no stack, when the register cannot be read", async () => {
    await seedRegister();
    // Drop the table the read path joins against.
    await fixture.client.execute("DROP TABLE findings");

    const res = await request(fixture.app).get("/api/m365/findings").expect(500);

    expect(res.body).toEqual({ error: "Failed to fetch findings register" });
    expect(res.body).not.toHaveProperty("stack");
  });
});

describe("PATCH /api/m365/findings/:fingerprint", () => {
  it("applies a valid transition and responds with the updated row", async () => {
    await seedRegister();

    const res = await request(fixture.app)
      .patch("/api/m365/findings/identity.globalAdminCount")
      .send({ status: "acknowledged", owner: "tim", notes: "raised with the tenant admin" })
      .expect(200);

    expect(res.body.fingerprint).toBe("identity.globalAdminCount");
    expect(res.body.status).toBe("acknowledged");
    expect(res.body.owner).toBe("tim");
    expect(res.body.stateNotes).toBe("raised with the tenant admin");
    expect(res.body.stateUpdatedAt).not.toBeNull();
    // The response is the joined row, not just the state that was written.
    expect(res.body.severity).toBe("critical");
    expect(res.body.category).toBe("identity");

    // And it is what a subsequent read returns.
    const read = await request(fixture.app).get("/api/m365/findings").expect(200);
    expect(
      read.body.findings.find(
        (f: { fingerprint: string }) => f.fingerprint === "identity.globalAdminCount",
      ).status,
    ).toBe("acknowledged");
  });

  it("survives a regeneration of the register", async () => {
    await seedRegister();
    await request(fixture.app)
      .patch("/api/m365/findings/licensing.unusedInventory")
      .send({ status: "suppressed", owner: "tim", dueDate: "2026-09-30T00:00:00Z" })
      .expect(200);

    // Re-run the rules with a changed outcome for the same fingerprint.
    fixture.setFindings([
      makeFinding("licensing.unusedInventory", {
        category: "licensing",
        severity: "medium",
        checkStatus: "warning",
      }),
    ]);
    await fixture.findingsStore.regenerateFindings();

    const res = await request(fixture.app).get("/api/m365/findings").expect(200);
    const row = res.body.findings[0];
    expect(row.fingerprint).toBe("licensing.unusedInventory");
    expect(row.severity).toBe("medium");
    expect(row.status).toBe("suppressed");
    expect(row.owner).toBe("tim");
    expect(row.dueDate).toBe("2026-09-30T00:00:00.000Z");
  });

  it("rejects an invalid transition with 400 before it reaches the store", async () => {
    await seedRegister();

    const res = await request(fixture.app)
      .patch("/api/m365/findings/identity.globalAdminCount")
      .send({ status: "closed" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request body");
    expect(res.body.issues).toHaveProperty("fieldErrors.status");

    // Nothing was written.
    const read = await request(fixture.app).get("/api/m365/findings").expect(200);
    expect(
      read.body.findings.find(
        (f: { fingerprint: string }) => f.fingerprint === "identity.globalAdminCount",
      ).status,
    ).toBe("open");
  });

  it("rejects an unparseable due date with 400", async () => {
    await seedRegister();

    const res = await request(fixture.app)
      .patch("/api/m365/findings/identity.globalAdminCount")
      .send({ dueDate: "the end of next quarter" })
      .expect(400);

    expect(res.body).toEqual({ error: "dueDate must be a valid ISO date string or null" });
  });

  it("returns 404 for a fingerprint that is not in the register", async () => {
    await seedRegister();

    const res = await request(fixture.app)
      .patch("/api/m365/findings/identity.doesNotExist")
      .send({ status: "acknowledged" })
      .expect(404);

    expect(res.body).toEqual({ error: "Finding not found" });
  });
});
