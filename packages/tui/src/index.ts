export type TuiResult = {
  code: 1
  stdout: string
  stderr: string
}

export function runTui(): TuiResult {
  return {
    code: 1,
    stdout: "",
    stderr: "TUI is not implemented.\n",
  }
}
