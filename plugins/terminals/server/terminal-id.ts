/**
 * Ids for the shells this plugin opens. VesnALIA lets `terminals.create` take the id
 * (`term_` and ten characters of its own alphabet, VesnALIA 0.48.1), which lets a
 * tab be stored before its shell exists (server/service.ts).
 */
import { randomInt } from "node:crypto";

/** VesnALIA's id alphabet: lower-case letters and digits without the look-alikes (0, 1, l, o). */
export const TERMINAL_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const SUFFIX_LENGTH = 10;

export function newTerminalId(random: (limit: number) => number = randomInt): string {
  let suffix = "";
  for (let index = 0; index < SUFFIX_LENGTH; index += 1) suffix += TERMINAL_ID_ALPHABET[random(TERMINAL_ID_ALPHABET.length)];
  return `term_${suffix}`;
}
