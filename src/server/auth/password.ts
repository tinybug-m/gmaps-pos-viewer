import "server-only";
import { randomInt } from "node:crypto";

// No 0/O, 1/l/I: temporary passwords get read out or copied by hand.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A one-time password an admin hands to a new or reset user (~94 bits). Shown once, never stored in clear. */
export function generateTempPassword(): string {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  );
  return groups.join("-");
}
