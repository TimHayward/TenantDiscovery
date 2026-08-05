import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

/**
 * The Windows principal granted full control. Resolved from the process owner
 * rather than passing a literal `%USERNAME%`: `hardenFile` spawns icacls
 * without a shell, so nothing would expand the variable, and building the
 * argument list as an array keeps a username containing a space or a quote
 * from altering the command line.
 */
function getWindowsPrincipal(): string {
  const domain = process.env.USERDOMAIN?.trim();
  const user = process.env.USERNAME?.trim() || os.userInfo().username;
  return domain ? `${domain}\\${user}` : user;
}

/**
 * Restrict a file to its owner: `chmod 0600` on POSIX, and on Windows an ACL
 * that drops inheritance and grants full control to the current user alone.
 *
 * Hardening is best-effort by design. A failure here means the file is more
 * readable than intended, not that the file is unusable, so the caller is
 * warned and carries on: refusing to start because an ACL call failed only
 * pushes the operator towards running the tool somewhere less safe.
 *
 * Returns whether the permissions were applied, for callers that want to
 * assert on it.
 */
export async function hardenFile(filePath: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("icacls", [
        filePath,
        "/inheritance:r",
        "/grant:r",
        `${getWindowsPrincipal()}:F`,
      ]);
    } else {
      await fs.chmod(filePath, 0o600);
    }
    return true;
  } catch (err) {
    logger.warn(
      { err, filePath },
      "Could not restrict file permissions to the current user; other local accounts may be able to read it",
    );
    return false;
  }
}
