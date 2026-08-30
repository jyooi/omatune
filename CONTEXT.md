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
The subset of the Library the user wants on the Device.
_Avoid_: playlist (a Selection is not a playlist), sync set

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

**Fixture**:
A copy of a Device Database, with or without Artwork and audio, that tests read as a known-good input.
A Fixture is Private when it still carries the owner's data and Public when it is Scrubbed.
_Avoid_: sample, test data, golden file (a golden file is one use of a Fixture)

**Scrub**:
Rewriting a Private Fixture so no personal, identifying, or third-party content remains while every byte offset holds.
_Avoid_: anonymise, redact, sanitise
