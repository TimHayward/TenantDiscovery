# Demonstration fixtures

Each directory here is a **fixture profile**: a recorded snapshot of a tenant
that the API server can serve in place of a live Microsoft Graph connection.
Start the server with `DEMO_MODE=<directory name>` and the whole dashboard runs
from the profile, with no credentials, no app registration and no consent.

See the "Offline demonstration mode" section of the repository `README.md` for
how to run it.

## Layout

```
fixtures/
  <profile>/
    manifest.json          name, description, schemaVersion, recordedAt, synthetic, source
    snapshots/<key>.json   one file per metric-store key, e.g. m365-overview.json
```

The snapshot keys are the keys the background refresh collects; the file content
is exactly what the corresponding collector returns, which is also what the
matching API route serves. `fixtures/build.mjs` writes the two committed
profiles and is the authority on their contents.

## The two committed profiles

| Profile | Shape | What it is for |
| --- | --- | --- |
| `healthy-mid-market` | ~250 users, MFA broadly enforced, Secure Score 462/600, a short tail of low findings | Showing what good looks like |
| `neglected-smb` | ~60 users, sparse MFA, legacy authentication permitted, ownerless apps with expired secrets, anonymous sharing links, no DLP, audit log off | The one worth demonstrating: a tenant where the tool has something to say |

**Both profiles are entirely invented.** No tenant was contacted to produce
them. Every domain is under the RFC 2606 reserved `.example` TLD and cannot
resolve; every identifier is a readable `demo-...` string rather than a GUID;
every display name carries a `(demo)` suffix so that a screenshot of any tab,
and every row of a PDF or spreadsheet export, says so on its face.

## Recording a fixture from a real tenant

`scripts/src/exportFixture.ts` records a running server's collection into a new
profile, redacting as it goes. It replaces tenant identifiers, user principal
names, display names, email addresses, device names and object identifiers with
generated equivalents, consistently, so references between snapshots survive.
Any field it does not recognise is **dropped**, with a warning, rather than
passed through.

> **A recording is not a fixture until a human has read it.**
>
> Redaction by field name is a good default and a poor guarantee. A tenant name
> in a free-text policy description, a supplier in a SharePoint site title, a
> customer in a Teams channel name: none of those are fields the redactor knows
> about, and the ones it does not know about it drops, which is not the same as
> being sure. Read every file before you promote a recording, and treat the
> result as publishable only once you have.

The recorder writes to `fixtures/<profile>/recorded-<timestamp>/`, which is
ignored by git (see `.gitignore`), so a raw recording cannot be committed by
accident. Promoting one is a deliberate act: review it, move the files up into
the profile directory, and set `synthetic` in the manifest honestly.
