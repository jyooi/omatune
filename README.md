# omatune

Open-source music sync for iPods after Apple dropped support.
Runs on Linux and macOS and writes the database the stock iPod firmware reads.
iPod classic, nano 1G to 4G, video and mini.
See the support table.

## Install

Download one binary for your platform from GitHub Releases.
The host does not need bun.

https://github.com/jyooi/omatune/releases

### Linux x86_64

```
chmod +x omatune-linux-x64
./omatune-linux-x64
```

### Linux arm64

```
chmod +x omatune-linux-arm64
./omatune-linux-arm64
```

### macOS Apple silicon

```
chmod +x omatune-darwin-arm64
./omatune-darwin-arm64
```

### macOS Intel

```
chmod +x omatune-darwin-x64
./omatune-darwin-x64
```

AUR `-bin` and Homebrew files are in `packaging/`.
A later ticket publishes those packages.

## Spec

The v1 spec is https://linear.app/huffman/document/omatune-v1-spec-fb07aaa33fe0.

## Support

<!-- render:support-table:start -->
| Family | Apple models | libgpod key | Tier | Verified by | Notes |
|---|---|---|---|---|---|
| iPod classic 120 GB (2008) | MB562, MB565 | CLASSIC_2 | Verified | Reference Device, firmware 2.0.1 PC, 2026-08-31, omatune main@5350b53, HUF-275, [verification report #23](https://github.com/jyooi/omatune/issues/23) | hash58, Play Counts 0x1c, artwork 1055/1060/1061 |
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
<!-- render:support-table:end -->

## Development

This repo needs bun 1.4.0.

Install dependencies with `bun install`.

Run the CLI from source with `bun run omatune`.

Run tests with `bun test`.

Build every package with `bun run build`.

## Commands

Open the Selection screen:

```
omatune
```

Set `--device` when two or more Devices connect.
Press Enter to review the Sync Plan in the bottom strip.
Confirm with `y`, or type `wipe` for a wipe.
The Sync screen shows one progress bar.
The report prints to stdout after the screen closes.
Press `e` on the report screen to eject a still-mounted Device.
Press `i` to open the Device screen.

List attached Devices:

```
omatune devices
```

Print the same facts as JSON objects, one object per line:

```
omatune devices --json
```

Print Selection Rule count and Ledger summary for one Device:

```
omatune status --device <serial>
```

Print a Sync Plan for one Device.
Nothing on the Device changes:

```
omatune plan --device <serial> --json
```

Run a Sync for one Device:

```
omatune sync --device <serial>
```

The command asks `Sync now? [y/N]`.
`--yes` does not ask except on a wipe.
A wipe asks `Wipe and Sync?` and needs the word wipe.

`--json` prints the plan, messages, one progress object per line, and the report.
`--no-eject` leaves the Device mounted.
`--strict` refuses the Sync when Skipped Tracks exist, Unlisted files exist, or Play Counts is corrupt.
`--unlisted` prints each Unlisted file with its reason.
The report always states mount state: `Ejected - safe to unplug.` on success, `Still mounted - the iPod shows no music until it is ejected.` otherwise.

omatune reads `$XDG_CONFIG_HOME/omatune/config.toml`.
`--config` sets the config directory.
`OMATUNE_CONFIG` overrides `--config`.
A missing `config.toml` writes a starter file and exits 1.
`config.toml` holds the Library path and a table for each Device.
Each Device has `devices/<serial>/selection.toml` with include and exclude Rules.

A Sync writes Play Data to `$XDG_DATA_HOME/omatune/play-data.json`.
On macOS the data directory is `~/Library/Application Support/omatune`.
A Sync copies failed Play Counts files to `read-back-failed/` in that directory.

## Packages

`packages/device-database` holds the model table, the Device Database codec, and the hash58 signer.

`packages/platform` holds the Platform service, the fake Layer, the Linux Layer, and the stub Layer.

`packages/core` holds Device reports, exit codes, config files, the scanner, Rule evaluation, the Ledger reader, the planner, Play Data, and Sync.

`packages/transcode` converts FLAC Tracks to ALAC during a Sync.

`packages/cli` holds the command line entry.

`packages/tui` holds the Selection screen, Sync Plan, Sync progress, report, and Device screen.

`Platform` is the only hardware seam.

## License

The project license is MIT.
The full text is in `LICENSE`.

Compiled copies of libFLAC and Apple ALAC are in the Transcode wasm module and in every binary.
The full license texts are in `THIRD-PARTY-LICENSES`.
