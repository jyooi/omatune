# omatune

Open-source music sync for iPods after Apple dropped support.
Read `CONTEXT.md` for the domain glossary before you touch code or docs.

## Agent skills

### Issue tracker

Issues live in Linear, team Huffman, project omatune. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels exist in Linear under their default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Verification Library

Public CC0 Tracks are in `fixtures/audio/`. See `fixtures/audio/README.md`.

### Device Database codec

The iTunesDB codec is in `packages/device-database`.
The S2 golden test reads `fixtures/device/` when the private Fixture is present.
hash58 is the clean-room signer in `packages/device-database/src/hash58.ts`.

## Packages

Workspace packages live in `packages/`.
`Platform` in `packages/platform` is the only hardware seam.
Config and Selection files load in `packages/core/src/config.ts`.
The scanner, Rule evaluation, Ledger reader, and planner live in `packages/core`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
