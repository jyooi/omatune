---
status: accepted
date: 2026-08-30
ticket: HUF-247
---

# Port the Device Database format in TypeScript instead of wrapping libgpod

omatune needs a writer for the iTunesDB, ArtworkDB, and hash58 signature that the stock iPod firmware reads.
libgpod is the only mature writer, but its last release is from 2013, Arch carries eight patches to build it, Homebrew has no formula, its API is GLib-struct heavy and not thread-safe, and bun:ffi is not production grade.
We port the format in TypeScript on bun with Effect, so the TUI, the sync core, and the writer share one language and the binary has no native dependency.
No low-level language is needed: the work is file IO, a 1.5 MB binary container, HMAC-SHA1, and RGB565 thumbnail encoding for a few hundred images.

## Considered options

- Port in TypeScript (chosen).
- Port in Rust behind napi-rs: same correctness work, a second toolchain, prebuilds per target, and an FFI seam, for no measurable gain in v1. Rust stays the escape hatch if a profile ever shows a hot loop.
- Wrap libgpod through Node-API (podkit's path): pulls glib, libplist, sqlite, gdk-pixbuf, libxml2, and zlib into every install, needs a Homebrew tap with static libs on macOS, and inherits five documented assertion traps.
- Wrap libgpod behind a shim process: same dependency tree plus one more layer.

## Consequences

- License: MIT holds across the repo. hash58 is a clean-room implementation from the ipodlinux wiki and independent ports, never copied from `itdb_hash58.c`. Its substitution tables are reverse-engineered firmware constants; the file header records that provenance.
- Test oracle: see `docs/contributing-fixtures.md` for golden-file tests and Fixture layout.
  libgpod is never a runtime or CI dependency.
- Distribution: one self-contained binary per target (linux-x64, linux-arm64, darwin-arm64, darwin-x64) from `bun build --compile` on GitHub Releases, wrapped by an AUR `-bin` package and a Homebrew tap. Users do not need bun. npm publishing is a possible follow-up.
- Repo shape: the writer is a bun workspace package inside this monorepo (`packages/device-database`), pure TypeScript with Effect, with its own golden-file test suite, published to npm under MIT once stable. The app depends on it like any other package.
