# Support table

Source of truth for the Support Tier of every iPod family.
Edit this file only.
A row moves to Verified on one passing Verification Report and back to Expected on a failing one that the maintainer cannot fix.

| Family | Apple models | libgpod key | Tier | Verified by | Notes |
|---|---|---|---|---|---|
| iPod classic 120 GB (2008) | MB562, MB565 | CLASSIC_2 | Verified | Reference Device, firmware 2.0.1 PC | hash58, Play Counts 0x1c, artwork 1055/1060/1061 |
| iPod classic 80/160 GB (2007) | MB029, MB147, MB145, MB150 | CLASSIC_1 | Expected | - | hash58 |
| iPod classic 160 GB (Late 2009) | MC293, MC297 | CLASSIC_3 | Expected | - | hash58 |
| iPod nano 4G | MB598 to MB918 | NANO_4 | Expected | - | hash58, Cover Flow |
| iPod nano 3G | MA978 to MB261 | NANO_3 | Expected | - | hash58, Cover Flow |
| iPod video 5G / 5.5G | MA002 to MA450 | VIDEO_1, VIDEO_2 | Expected | - | no signature; gapless needs late firmware |
| iPod nano 2G | MA477 to MA497 | NANO_2 | Expected | - | no signature |
| iPod nano 1G | MA004 to MA107 | NANO_1 | Expected | - | no signature, no gapless |
| iPod mini | M9160 to M9807 | MINI_1, MINI_2 | Expected | - | no signature, no colour screen |
| iPod nano 5G | MC027 to MC075 | NANO_5 | Unsupported | - | hash72 plus sqlite, key harvested from an iTunes DB |
| iPod nano 6G / 7G | MC525 onward | NANO_6, NANO_7 | Unsupported | - | hashAB plus sqlite; 7G not in libgpod |
| iPod shuffle 1G to 4G | M9724 onward | SHUFFLE_* | Unsupported | - | iTunesSD plus iTunesStats second database format |
