# Fixture contributions

This page states how a contributor adds a Device Database Fixture.

## Public Fixture

A Public Fixture is a Scrub of a Device Database.
The Scrub keeps every byte offset of the source.
The Scrub holds no owner data.

## Scrub command

Run the scrub command in the Device Database package.

```
bun run --filter @omatune/device-database scrub -- <mount> <out-dir> --model CLASSIC_2
```

The command writes iTunesDB, Play Counts, ArtworkDB, ithmb files, and SHA256SUMS.
The output folder is `fixtures/device/<model-key>/`.
The command drops `Device/Users` and `Extras.itdb`.
The command signs the iTunesDB with hash58.
The fake serial is `000A270000000001`.

## Pull request path

1. Run the scrub command on the Device mount.
2. Sign the iTunesDB, or ask a maintainer to sign it.
3. Link a Verification Report in the pull request.
4. Do not commit a Private Fixture.

## Independent hash58 check

The hash58 signer in this package signs the scrubbed iTunesDB.
Arch has the `extra/libgpod` package.
A maintainer may sign the same file with libgpod on Arch.
CI does not run libgpod.

Install libgpod on Arch.

```
pacman -S extra/libgpod
```

Copy the scrubbed iTunesDB to a FAT32 volume.
Set `FirewireGuid: 0x000A270000000001` in `iPod_Control/Device/SysInfo`.
Run the libgpod write path on that volume.
Compare the 20 bytes at offset 0x58 with the hash58 output.

The scrub command does not run libgpod.

## Synthetic Fixture

`fixtures/device/synthetic-classic/` is a writer regression baseline.
The writer builds these files from the Verification Library for CLASSIC_2.
A test regenerates the files and compares every byte.

## Private Fixture

The Private Fixture stays on the maintainer clone.
Git ignores `fixtures/device/ipod-classic-120gb/`.
Do not copy strings from a Private Fixture into tests or docs.

## Golden tests

S2 golden-file tests read the Public Fixture.
The tests pass in a clean clone.
The tests also read the Private Fixture when that folder is present.
