export const CLASSIC_DISK_PRODUCT_ID = 0x1261

const USB_PRODUCT_TO_KEY: Readonly<Record<number, string>> = {
  [CLASSIC_DISK_PRODUCT_ID]: "CLASSIC_2",
}

export function libgpodKeyForUsbProductId(productId: number): string | undefined {
  return USB_PRODUCT_TO_KEY[productId]
}
