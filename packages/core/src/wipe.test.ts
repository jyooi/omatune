import { expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { wipeIpodControl } from "./device-fs.ts"

test("wipe removes only Music, iTunes, and Artwork", async () => {
  const root = await mkdtemp(join(tmpdir(), "omatune-wipe-"))
  await mkdir(join(root, "iPod_Control", "Music", "F00"), { recursive: true })
  await mkdir(join(root, "iPod_Control", "iTunes"), { recursive: true })
  await mkdir(join(root, "iPod_Control", "Artwork"), { recursive: true })
  await mkdir(join(root, "iPod_Control", "Device"), { recursive: true })
  await writeFile(join(root, "iPod_Control", "Music", "F00", "a.mp3"), "audio")
  await writeFile(join(root, "iPod_Control", "iTunes", "iTunesDB"), "db")
  await writeFile(join(root, "iPod_Control", "Artwork", "F00_1.ithmb"), "art")
  await writeFile(join(root, "iPod_Control", "Device", "SysInfo"), "keep-sys")
  await writeFile(join(root, "Notes.txt"), "keep-notes")
  await wipeIpodControl(root)
  expect(await Bun.file(join(root, "Notes.txt")).text()).toBe("keep-notes")
  expect(await Bun.file(join(root, "iPod_Control", "Device", "SysInfo")).text()).toBe("keep-sys")
  expect(await Bun.file(join(root, "iPod_Control", "Music", "F00", "a.mp3")).exists()).toBe(false)
  expect(await Bun.file(join(root, "iPod_Control", "iTunes", "iTunesDB")).exists()).toBe(false)
  expect(await Bun.file(join(root, "iPod_Control", "Artwork", "F00_1.ithmb")).exists()).toBe(false)
})
