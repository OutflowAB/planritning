import { randomBytes } from "node:crypto";

/** A temporary password the superadmin reads out once; the user must replace it at first login. */
export function temporaryPassword() {
  return randomBytes(9).toString("base64url");
}
