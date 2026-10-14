/*
 * iTunesDB signature dispatch by family.
 *
 * none: zero the hash slots and set hashing_scheme to 0.
 * hash58: sign with hash58.
 * This module does not implement hash72 or hashAB.
 */

import { writeU16 } from "./bytes.ts";
import {
  HASH58_LENGTH,
  HASH58_OFFSET,
  HASH72_LENGTH,
  HASH72_OFFSET,
} from "./codec.ts";
import { firewireIdFromSerial, signHash58 } from "./hash58.ts";
import type { FamilyRecord, SignatureScheme } from "./model/types.ts";
import { ItunesdbSignatureError } from "./signature-error.ts";

const HASHING_SCHEME_OFFSET = 0x30;
const HASHING_SCHEME_NONE = 0;

export function signItunesdb(
  bytes: Uint8Array,
  serial: string,
  scheme: SignatureScheme,
): Uint8Array {
  if (scheme === "none") {
    return signNone(bytes);
  }
  if (scheme === "hash58") {
    return signHash58(bytes, firewireIdFromSerial(serial));
  }
  throw new ItunesdbSignatureError(`${scheme} is not implemented`);
}

export function signItunesdbForFamily(
  bytes: Uint8Array,
  serial: string,
  family: Pick<FamilyRecord, "signature">,
): Uint8Array {
  return signItunesdb(bytes, serial, family.signature);
}

function signNone(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  zeroSlot(out, HASH58_OFFSET, HASH58_LENGTH);
  zeroSlot(out, HASH72_OFFSET, HASH72_LENGTH);
  if (out.byteLength >= HASHING_SCHEME_OFFSET + 2) {
    writeU16(out, HASHING_SCHEME_OFFSET, HASHING_SCHEME_NONE);
  }
  return out;
}

function zeroSlot(bytes: Uint8Array, offset: number, length: number): void {
  if (bytes.byteLength <= offset) {
    return;
  }
  const end = Math.min(bytes.byteLength, offset + length);
  bytes.fill(0, offset, end);
}
