import { expect, test } from "bun:test"
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { placeAdd } from "./copy-adds.ts"

test("placeAdd skips a resume file with the right size and stops on a full disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "omatune-copy-adds-"))
  const source = join(root, "src.mp3")
  const dest = join(root, "dest.mp3")
  await writeFile(source, "audio-bytes")
  const size = (await stat(source)).size
  await mkdir(root, { recursive: true })
  await writeFile(dest, "audio-bytes")
  const before = await stat(dest)
  const present = await placeAdd({
    source,
    dest,
    size,
    resume: true,
    spaceRemaining: size,
    liveFreeBytes: size,
  })
  expect(present.status).toBe("present")
  expect((await stat(dest)).mtimeMs).toBe(before.mtimeMs)
  const full = await placeAdd({
    source,
    dest: join(root, "other.mp3"),
    size,
    resume: false,
    spaceRemaining: size - 1,
    liveFreeBytes: size - 1,
  })
  expect(full.status).toBe("disk-full")
})
