import { expect, test } from "bun:test"
import { join } from "node:path"
import {
  applySupportTable,
  extractSupportTable,
  parseChecklist,
  renderDeviceVerificationForm,
  renderGenerated,
  staleGenerated,
  SUPPORT_END,
  SUPPORT_START,
} from "./render.ts"

const root = join(import.meta.dir, "..")

async function sources(): Promise<{
  readme: string
  supportTableSource: string
  checklistSource: string
}> {
  return {
    readme: await Bun.file(join(root, "README.md")).text(),
    supportTableSource: await Bun.file(join(root, "docs/support-table.md")).text(),
    checklistSource: await Bun.file(join(root, "docs/verification/device-checklist.yaml")).text(),
  }
}

test("render copies every support table row into README", async () => {
  const input = await sources()
  const generated = renderGenerated(input)
  const table = extractSupportTable(input.supportTableSource).trimEnd()
  const start = generated.readme.indexOf(SUPPORT_START)
  const end = generated.readme.indexOf(SUPPORT_END)
  const body = generated.readme.slice(start + SUPPORT_START.length, end).trim()
  expect(body).toBe(table)
  expect(generated.readme).toContain("iPod classic 120 GB (2008)")
  expect(generated.readme).toContain("iPod shuffle 1G to 4G")
})

test("issue form has required facts and one dropdown per checklist item", async () => {
  const input = await sources()
  const checklist = parseChecklist(input.checklistSource)
  const yaml = renderDeviceVerificationForm(checklist)
  const parsed = Bun.YAML.parse(yaml) as {
    name?: string
    body?: Array<{
      type?: string
      id?: string
      attributes?: { label?: string; options?: unknown; value?: string }
    }>
  }
  expect(parsed.name).toBe("Device verification")
  const body = parsed.body ?? []
  const byId = new Map(body.filter((field) => field.id).map((field) => [field.id, field]))
  for (const id of [
    "model_num_str",
    "apple_model_number",
    "firmware",
    "filesystem",
    "host_os",
    "omatune_version",
    "devices_json",
  ]) {
    expect(byId.has(id)).toBe(true)
  }
  expect(byId.get("model_num_str")?.type).toBe("input")
  expect(byId.get("devices_json")?.type).toBe("textarea")
  const dropdowns = body.filter((field) => field.type === "dropdown")
  expect(dropdowns).toHaveLength(checklist.items.length)
  for (const item of checklist.items) {
    const id = item.id.toLowerCase().replaceAll("-", "_")
    const field = byId.get(id)
    expect(field?.type).toBe("dropdown")
    expect(field?.attributes?.options).toEqual(["pass", "fail", "not applicable"])
    expect(field?.attributes?.label).toContain(item.id)
  }
  const markdown = body
    .filter((field) => field.type === "markdown")
    .map((field) => field.attributes?.value ?? "")
    .join("\n")
  expect(markdown).toContain("SysInfo")
  expect(markdown).toContain("SysInfoExtended")
})

test("stale check fails when README markers hold the wrong table", () => {
  const readme = `intro\n${SUPPORT_START}\n| old |\n${SUPPORT_END}\n`
  const expected = applySupportTable(readme, "| Family |\n| --- |\n")
  const stale = staleGenerated(
    { readme, form: "form\n" },
    { readme: expected, form: "form\n" },
  )
  expect(stale).toEqual(["README.md"])
})
