# omatune

Music sync for the iPod Classic 6.5 gen after Apple dropped support.
Runs on Linux and writes the database the stock iPod firmware reads.

## Language

**Library**:
The folder tree of audio files on the host machine that omatune reads from.
_Avoid_: collection, source, music folder

**Device**:
The iPod Classic 6.5 gen mounted as USB mass storage.
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
