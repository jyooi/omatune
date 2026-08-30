import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  HASH58_LENGTH,
  HASH58_OFFSET,
  HASH72_LENGTH,
  HASH72_OFFSET,
  lookupByLibgpodKey,
  signItunesdbForFamily,
} from "../src/index.ts";

const packageRoot = join(import.meta.dir, "..");
const fixtureDir = join(
  packageRoot,
  "..",
  "..",
  "fixtures",
  "device",
  "ipod-classic-120gb",
);
const fixturePath = join(fixtureDir, "iTunes", "iTunesDB");
const fixturePresent = existsSync(fixturePath);
const serial = fixturePresent ? loadFixtureSerial(fixtureDir) : null;
const canSign = fixturePresent && serial !== null;
const roundTripTitle = canSign
  ? "recomputes the Fixture hash58 and keeps the 0x72 area"
  : "recomputes the Fixture hash58 and keeps the 0x72 area (skipped: private Fixture serial is absent)";
const changedTitle = canSign
  ? "a modified Fixture iTunesDB produces a different hash58"
  : "a modified Fixture iTunesDB produces a different hash58 (skipped: private Fixture serial is absent)";

describe("S2 golden hash58", () => {
  test.skipIf(!canSign)(roundTripTitle, async () => {
    const classic = lookupByLibgpodKey("CLASSIC_2");
    if (!classic || serial === null) {
      throw new Error("missing classic family or serial");
    }
    const bytes = await Bun.file(fixturePath).bytes();
    const signed = signItunesdbForFamily(bytes, serial, classic);
    expect(signed.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).toEqual(
      bytes.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH),
    );
    expect(signed.slice(HASH72_OFFSET, HASH72_OFFSET + HASH72_LENGTH)).toEqual(
      bytes.slice(HASH72_OFFSET, HASH72_OFFSET + HASH72_LENGTH),
    );
  });

  test.skipIf(!canSign)(changedTitle, async () => {
    const classic = lookupByLibgpodKey("CLASSIC_2");
    if (!classic || serial === null) {
      throw new Error("missing classic family or serial");
    }
    const bytes = await Bun.file(fixturePath).bytes();
    const changed = bytes.slice();
    const poke = HASH58_OFFSET + HASH58_LENGTH + 16;
    const prior = changed[poke] ?? 0;
    changed[poke] = prior ^ 0x01;
    const original = signItunesdbForFamily(bytes, serial, classic);
    const other = signItunesdbForFamily(changed, serial, classic);
    expect(other.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH)).not.toEqual(
      original.slice(HASH58_OFFSET, HASH58_OFFSET + HASH58_LENGTH),
    );
  });
});

function loadFixtureSerial(dir: string): string | null {
  const fromSys = firewireFromSysInfo(readText(join(dir, "Device", "SysInfo")));
  if (fromSys) {
    return fromSys;
  }
  return firewireFromPlist(readText(join(dir, "Device", "SysInfoExtended")));
}

function readText(path: string): string {
  if (!existsSync(path)) {
    return "";
  }
  return readFileSync(path, "utf8");
}

function firewireFromSysInfo(text: string): string | null {
  if (text.trim().length === 0) {
    return null;
  }
  for (const line of text.split(/\r?\n/u)) {
    const cut = line.indexOf(":");
    if (cut <= 0) {
      continue;
    }
    const key = line.slice(0, cut).trim().toLowerCase();
    if (key === "firewireguid") {
      return normalizeSerial(line.slice(cut + 1));
    }
  }
  return null;
}

function firewireFromPlist(xml: string): string | null {
  if (xml.trim().length === 0) {
    return null;
  }
  const keys = ["FireWireGUID", "FirewireGuid", "FireWireGuid", "FirewireGUID"];
  for (const key of keys) {
    const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`, "i");
    const match = pattern.exec(xml);
    const value = match?.[1];
    if (value) {
      return normalizeSerial(value);
    }
  }
  return null;
}

function normalizeSerial(raw: string): string | null {
  const hex = raw.trim().toLowerCase().replace(/^0x/u, "");
  if (!/^[0-9a-f]{16}$/u.test(hex)) {
    return null;
  }
  return hex;
}
