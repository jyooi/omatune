import { join } from "node:path"
import { presentWithSize } from "./device-fs.ts"
import type { PlannedTrack, SyncPlan } from "./plan.ts"

export async function reconcilePlanWithDevice(
  plan: SyncPlan,
  mountPoint: string,
): Promise<SyncPlan> {
  const keep: PlannedTrack[] = []
  const add: PlannedTrack[] = [...plan.add]
  for (const track of plan.keep) {
    if (await presentWithSize(join(mountPoint, track.devicePath), track.size)) {
      keep.push(track)
    } else {
      add.push(track)
    }
  }
  add.sort(byPath)
  keep.sort(byPath)
  const bytesNeeded = add.reduce((sum, track) => sum + track.size, 0)
  return {
    ...plan,
    add,
    keep,
    bytesNeeded,
    freeSpaceAfter: plan.freeSpaceAfter + plan.bytesNeeded - bytesNeeded,
    transcodeCount: add.filter((track) => track.transcode).length,
  }
}

function byPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path)
}
