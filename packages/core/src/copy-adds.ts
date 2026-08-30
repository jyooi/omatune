import { unlink } from "node:fs/promises"
import { copyFileChunked, presentWithSize } from "./device-fs.ts"

export type PlaceAddStatus = "copied" | "present" | "disk-full"

export type PlaceAddResult = {
  readonly status: PlaceAddStatus
  readonly spaceRemaining: number
}

export function isEnospc(cause: unknown): boolean {
  return (cause as { code?: string }).code === "ENOSPC"
}

export async function placeAdd(input: {
  readonly source: string
  readonly dest: string
  readonly size: number
  readonly resume: boolean
  readonly spaceRemaining: number
  readonly liveFreeBytes: number | null
}): Promise<PlaceAddResult> {
  if (input.resume && (await presentWithSize(input.dest, input.size))) {
    return { status: "present", spaceRemaining: input.spaceRemaining }
  }
  const budget =
    input.liveFreeBytes === null
      ? input.spaceRemaining
      : Math.min(input.spaceRemaining, input.liveFreeBytes)
  if (input.size > budget) {
    return { status: "disk-full", spaceRemaining: input.spaceRemaining }
  }
  try {
    await copyFileChunked(input.source, input.dest)
  } catch (cause) {
    if (isEnospc(cause)) {
      await deleteQuiet(input.dest)
      return { status: "disk-full", spaceRemaining: input.spaceRemaining }
    }
    throw cause
  }
  return { status: "copied", spaceRemaining: input.spaceRemaining - input.size }
}

async function deleteQuiet(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (cause) {
    const code = (cause as { code?: string }).code
    if (code !== "ENOENT") {
      throw cause
    }
  }
}
