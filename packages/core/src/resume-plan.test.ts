import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { SyncPlan } from "./plan.ts"
import { reconcilePlanWithDevice } from "./resume-plan.ts"

test("reconcilePlanWithDevice promotes missing keep Tracks to add", async () => {
  const root = await mkdtemp(join(tmpdir(), "omatune-resume-plan-"))
  const presentPath = "iPod_Control/Music/F00/present.mp3"
  await mkdir(join(root, dirname(presentPath)), { recursive: true })
  await writeFile(join(root, presentPath), "audio-bytes")
  const plan: SyncPlan = {
    kind: "normal",
    add: [],
    remove: [],
    keep: [
      { path: "missing.mp3", devicePath: "iPod_Control/Music/F00/missing.mp3", size: 11 },
      { path: "present.mp3", devicePath: presentPath, size: 11 },
    ],
    skipped: [],
    bytesNeeded: 0,
    freeSpaceAfter: 100,
    forceModel: null,
  }
  const next = await reconcilePlanWithDevice(plan, root)
  expect(next.keep.map((track) => track.path)).toEqual(["present.mp3"])
  expect(next.add.map((track) => track.path)).toEqual(["missing.mp3"])
  expect(next.bytesNeeded).toBe(11)
  expect(next.freeSpaceAfter).toBe(89)
})
