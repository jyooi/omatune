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

Run tests with `bun test`.

Build every package with `bun run build`.

## Packages

`packages/device-database` holds the model table.

`packages/platform` holds the Platform service, the fake Layer, the Linux Layer, and the stub Layer.

`packages/core` holds Device reports and exit codes.

`packages/cli` holds the command line entry.

`packages/tui` is a placeholder for the terminal UI.

`Platform` is the only hardware seam.
