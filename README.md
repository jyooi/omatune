# omatune

Open-source music sync for iPods after Apple dropped support.
Runs on Linux and macOS and writes the database the stock iPod firmware reads.

## Install

This repo needs bun 1.4.0.

Install dependencies with `bun install`.

## Commands

List attached Devices:

```
bun run omatune devices
```

Print the same facts as JSON objects, one object per line:

```
bun run omatune devices --json
```

Print Selection Rule count and Ledger summary for one Device:

```
bun run omatune status --device <serial>
```

Print a Sync Plan for one Device.
Nothing on the Device changes:

```
bun run omatune plan --device <serial> --json
```

omatune reads `$XDG_CONFIG_HOME/omatune/config.toml`.
`--config` sets the config directory.
`OMATUNE_CONFIG` overrides `--config`.
A missing `config.toml` writes a starter file and exits 1.
`config.toml` holds the Library path and a table for each Device.
Each Device has `devices/<serial>/selection.toml` with include and exclude Rules.

Run tests with `bun test`.

Build every package with `bun run build`.

## Packages

`packages/device-database` holds the model table, the iTunesDB codec, and the hash58 signer.

`packages/platform` holds the Platform service, the fake Layer, the Linux Layer, and the stub Layer.

`packages/core` holds Device reports, exit codes, config files, the scanner, Rule evaluation, the Ledger reader, and the planner.

`packages/cli` holds the command line entry.

`packages/tui` is a placeholder for the terminal UI.

`Platform` is the only hardware seam.
