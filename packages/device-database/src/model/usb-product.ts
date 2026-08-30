/**
 * USB disk-mode product ID when SysInfo has no ModelNumStr.
 *
 * The reference iPod classic 120 GB SysInfo holds FirewireGuid only.
 * That Device has no SysInfoExtended file.
 * The iTunesDB hash scheme is hash58 on every classic family, so it cannot pick CLASSIC_2.
 * udev reports idProduct 0x1261 in disk mode. That value is present on this Device.
 *
 * CLASSIC_1, CLASSIC_2, and CLASSIC_3 all use disk-mode 0x1261.
 * This map assigns 0x1261 to CLASSIC_2. That is the reference family.
 * It is also the only product ID the Linux Platform lists.
 *
 * A ModelNumStr in the CLASSIC_1 or CLASSIC_3 set on a 0x1261 Device falsifies this map.
 * udev also reported bcdDevice 1.62 on the reference Device. That value is a USB revision.
 * It does not name a family in the support table.
 */

export const CLASSIC_DISK_PRODUCT_ID = 0x1261

const USB_PRODUCT_TO_KEY: Readonly<Record<number, string>> = {
  [CLASSIC_DISK_PRODUCT_ID]: "CLASSIC_2",
}

export function libgpodKeyForUsbProductId(productId: number): string | undefined {
  return USB_PRODUCT_TO_KEY[productId]
}
