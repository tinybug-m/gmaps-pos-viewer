/**
 * What every DAL mutation and server action returns. Failures carry a code
 * the UI can branch on and a message that is safe to show the user.
 */
export type FailureCode = "invalid" | "not_found" | "forbidden" | "conflict" | "rate_limited";

export interface Failure {
  ok: false;
  code: FailureCode;
  message: string;
}

export type Result<T extends object = object> = ({ ok: true } & T) | Failure;

export function fail(code: FailureCode, message: string): Failure {
  return { ok: false, code, message };
}

/** For callers that see someone else's lead: the same answer as a lead that doesn't exist. */
export const NOT_FOUND = fail("not_found", "That lead doesn't exist or isn't assigned to you.");
