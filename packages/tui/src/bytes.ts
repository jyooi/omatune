export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes)
  if (abs >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  }
  if (abs >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`
  }
  if (abs >= 1_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`
  }
  return `${bytes} B`
}
