export type DeviceInfo = {
  readonly serial: string
  readonly vendorId: number
  readonly productId: number
  readonly filesystemType: string
  readonly mountPoint: string | null
  readonly modelString: string | null
  readonly freeBytes: number
}
