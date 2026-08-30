# omatune

Open-source music sync for iPods after Apple dropped support.
Runs on Linux and macOS and writes the database the stock iPod firmware reads.

## Language

**Library**:
The folder tree of audio files on the host machine that omatune reads from.
_Avoid_: collection, source, music folder

**Device**:
An iPod mounted as USB mass storage. The iPod Classic 6.5 gen is the reference Device.
_Avoid_: iPod (in code), target, player

**Track**:
One audio file in the Library, identified by its tags.
_Avoid_: song, file

**Album**:
A group of Tracks that share album and album-artist tags.

**Selection**:
The subset of the Library the user wants on one Device, expressed as Rules.
_Avoid_: playlist (a Selection is not a playlist), sync set

**Rule**:
One include or exclude line of a Selection that names an album artist, an Album, or a path under the Library.
Include Rules union, exclude Rules subtract.
_Avoid_: filter, query, pattern

**Sync**:
A mirror operation that makes the Device match the Selection exactly, deletions included.
_Avoid_: push, copy, transfer, upload

**Device Database**:
The `iTunesDB` and companion files on the Device that the stock firmware reads.
_Avoid_: iTunes library, db, index

**Artwork**:
The cover image embedded in a Track's tags, written to the Device so the firmware shows it.
_Avoid_: cover, thumbnail, album art

**Play Data**:
Play count, skip count, rating, last-played time, last-skipped time, and bookmark position that the Device records per Track.
omatune keeps one Play Data record per Track on the host, merged across every Device.
_Avoid_: stats, listening history, scrobbles

**Read-back**:
Merging the Play Data a Device recorded since the last Sync into the host record, before that Sync changes the Device.
_Avoid_: reverse sync, import

**Echo**:
A Play Data value the Device reports that equals the value the last Sync wrote to it, so it carries no new information.
_Avoid_: duplicate, unchanged value

**Foreign Device**:
A Device whose Device Database omatune did not write. A Sync wipes it after confirmation and reads no Play Data from it.
_Avoid_: iTunes iPod, unknown device, fresh device

**Ledger**:
The host-side record, one per Device, of which Tracks the Device holds and how each was identified at the last Sync.
_Avoid_: manifest, cache, index, state file

**Sync Plan**:
The list of Tracks a Sync will add, remove, keep, and skip, with the space it needs, shown before anything changes.
_Avoid_: diff, preview, dry run

**Commit point**:
The single moment in a Sync after which the Device Database describes the new content; everything before it can be redone.
_Avoid_: transaction, checkpoint

**Adoption**:
A Sync that rebuilds a missing Ledger from a Device omatune wrote earlier, instead of wiping it.
_Avoid_: import, recovery, re-sync

**Skipped**:
A Track the Selection matches that a Sync leaves off the Device, with a stated reason.
_Avoid_: error, failed, ignored

**Support Tier**:
The promise omatune makes for one iPod family: Verified (a Sync passed the Device Checklist on real hardware), Expected (the format is implemented, no hardware report yet), or Unsupported (omatune refuses the Device).
_Avoid_: compatibility level, status

**Device Checklist**:
The manual pass-or-fail list a person runs on a Device after a Sync to confirm the firmware reads what omatune wrote.
_Avoid_: QA script, smoke test

**Verification Report**:
A public issue from a community member that carries a completed Device Checklist plus the Device facts needed to move a family between Support Tiers.
_Avoid_: bug report, feedback

**Fixture**:
A copy of a Device Database, with or without Artwork and audio, that tests read as a known-good input.
A Fixture is Private when it still carries the owner's data and Public when it is Scrubbed.
_Avoid_: sample, test data, golden file (a golden file is one use of a Fixture)

**Scrub**:
Rewriting a Private Fixture so no personal, identifying, or third-party content remains while every byte offset holds.
_Avoid_: anonymise, redact, sanitise

**Verification Library**:
The fixed public set of CC0 Tracks a reporter syncs before running the Device Checklist, so every expected value in the checklist is a constant.
_Avoid_: test library, sample library, demo music
