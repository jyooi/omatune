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
Play count, skip count, rating, and last-played time that the Device records per Track.
_Avoid_: stats, listening history, scrobbles

**Read-back**:
Copying Play Data from the Device to a file on the host before a Sync changes the Device.
_Avoid_: reverse sync, import

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
