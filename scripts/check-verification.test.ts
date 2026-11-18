import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { checkChart, type VerificationRecord } from "./check-verification.ts"

const skill = ".claude/skills/verify-read-back"
const branch = "feature/x"
const chartPath = `${skill}/charts/feature-x.md`
const imagePath = `${skill}/charts/feature-x.svg`
const coveredFile = "packages/core/src/read-back.ts"

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")

const recordWith = (specSha: string): VerificationRecord => ({
  tool: { version: "1.7.4", url: "", sha256: "" },
  model: {
    spec: { file: "ReadBack.tla", sha256: specSha },
    config: { file: "ReadBack.cfg", sha256: sha256("config\n") },
  },
  covers: [{ file: coveredFile, sha256: sha256("two\n") }],
  properties: [],
})

const record = recordWith(sha256("spec\n"))

const coveredDigestOf = (value: VerificationRecord): string =>
  sha256(
    [
      `${value.covers[0]?.sha256}  ${coveredFile}\n`,
      `${value.model.spec.sha256}  ${skill}/ReadBack.tla\n`,
      `${value.model.config.sha256}  ${skill}/ReadBack.cfg\n`,
    ].join(""),
  )

const mermaidBody = "stateDiagram-v2\n  [*] --> a\n"
const mermaid = `## State chart\n\n\`\`\`mermaid\n${mermaidBody}\`\`\`\n`
const image = (named: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg"><desc>Chart digest: ${named}</desc></svg>\n`

let root: string

const git = (...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  )

const commit = (files: Record<string, string>): void => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  git("add", "-A")
  git("commit", "-q", "-m", "change")
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-chart-"))
  git("init", "-q", "-b", "main")
  commit({
    [coveredFile]: "one\n",
    "README.md": "one\n",
    [`${skill}/ReadBack.tla`]: "spec\n",
    [`${skill}/ReadBack.cfg`]: "config\n",
  })
  git("update-ref", "refs/remotes/origin/main", "HEAD")
  git("checkout", "-q", "-b", branch)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("state chart file of a change", () => {
  test("is not checked when HEAD has no change from origin/main", async () => {
    git("checkout", "-q", "main")
    expect(await checkChart(root, record, "main")).toEqual([])
  })

  test("fails when the change adds no chart file", async () => {
    commit({ "README.md": "two\n" })
    expect(await checkChart(root, record, branch)).toEqual([
      expect.stringContaining(`adds no state chart file ${chartPath}`),
    ])
  })

  test("fails when the chart file is not named by the branch", async () => {
    commit({ [`${skill}/charts/other.md`]: "No state change: docs.\n" })
    expect(await checkChart(root, record, branch)).toEqual([
      expect.stringContaining(`adds no state chart file ${chartPath}`),
    ])
  })

  test("accepts each added chart file when the branch name is unknown", async () => {
    commit({ [`${skill}/charts/other.md`]: "No state change: docs.\n" })
    expect(await checkChart(root, record, undefined)).toEqual([])
  })

  test("fails when the change only edits a chart file of an earlier change", async () => {
    git("checkout", "-q", "main")
    commit({ [chartPath]: "No state change: docs.\n" })
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("checkout", "-q", "-b", "feature/y")
    commit({ [chartPath]: "No state change: other docs.\n" })
    expect(await checkChart(root, record, "feature/x")).toEqual([
      expect.stringContaining("adds no state chart file"),
    ])
  })

  test("passes with a no state change note when no verified file changed", async () => {
    commit({ "README.md": "two\n", [chartPath]: "No state change: this PR changes only docs.\n" })
    expect(await checkChart(root, record, branch)).toEqual([])
  })

  test("fails when the chart file has no mermaid chart and no note", async () => {
    commit({ [chartPath]: "## State chart\n\nTo do.\n" })
    expect(await checkChart(root, record, branch)).toEqual([
      expect.stringContaining("no mermaid chart"),
    ])
  })

  test("fails when a covered file changed and the chart does not name the covered digest", async () => {
    commit({ [coveredFile]: "two\n", [chartPath]: mermaid, [imagePath]: image(sha256(mermaidBody)) })
    expect(await checkChart(root, record, branch)).toEqual([
      expect.stringContaining(coveredDigestOf(record)),
    ])
  })

  test("fails when only the model changed and the chart names the covered digest before the change", async () => {
    const changed = recordWith(sha256("spec two\n"))
    commit({
      [`${skill}/ReadBack.tla`]: "spec two\n",
      [chartPath]: `${mermaid}\nCovered digest: ${coveredDigestOf(record)}\n`,
      [imagePath]: image(sha256(mermaidBody)),
    })
    expect(await checkChart(root, changed, branch)).toEqual([
      expect.stringContaining(coveredDigestOf(changed)),
    ])
  })

  test("passes when a covered file changed and the chart names the covered digest", async () => {
    commit({
      [coveredFile]: "two\n",
      [chartPath]: `${mermaid}\nCovered digest: ${coveredDigestOf(record)}\n`,
      [imagePath]: image(sha256(mermaidBody)),
    })
    expect(await checkChart(root, record, branch)).toEqual([])
  })

  test("fails when a chart file has a chart and the change has no SVG image", async () => {
    commit({ [chartPath]: mermaid })
    expect(await checkChart(root, record, branch)).toEqual([
      expect.stringContaining("no SVG image"),
    ])
  })

  test("fails when the SVG image names the digest of an older chart text", async () => {
    commit({ [chartPath]: mermaid, [imagePath]: image(sha256("stateDiagram-v2\n")) })
    expect(await checkChart(root, record, branch)).toEqual([
      expect.stringContaining("older than the chart text"),
    ])
  })

  test("passes when the SVG image names the digest of the chart text", async () => {
    commit({ [chartPath]: mermaid, [imagePath]: image(sha256(mermaidBody)) })
    expect(await checkChart(root, record, branch)).toEqual([])
  })

  test("needs no SVG image for a no state change note", async () => {
    commit({ [chartPath]: "No state change: this PR changes only docs.\n" })
    expect(await checkChart(root, record, branch)).toEqual([])
  })
})
