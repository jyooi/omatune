## State chart

This chart shows the behavior that this PR verifies: the Play Counts file of one Device through a Sync that can stop.
TLC drew it from a scratch copy of `ReadBack.tla` with two plays and two Syncs (87 states).
In that copy, the start of a Sync and its Read-back are one step, because a stop between them changes nothing.

![State chart of Play Counts through a Sync that can stop](fm-omatune-verification-setup.svg)

```mermaid
---
title: "Play Counts through a Sync that can stop"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: waiting
    lg1: syncing
    lg2: Breaks NoPlayCountedTwice
    lg3: Breaks NoPlayCountedTwice in some cases
    lg4: Path to the NoPlayCountedTwice bug
  }
  class lg0 tan
  class lg1 blue
  class lg2 breaks
  class lg3 mayBreak
  class lg4 bugPath
  s0: No new plays on the Device
  s1: Read-back done, music copies
  s2: New plays on the Device
  s3: iTunesDB written
  s4: Play Counts deleted
  s5: Read plays still on the Device
  s6: Read and new plays in one file
  [*] --> s0
  s0 --> s1: you start a Sync, and it finds no Play Counts
  s0 --> s2: you play a Track
  s1 --> s3: the Sync writes the iTunesDB
  s1 --> s0: the Sync stops
  s2 --> s1: you start a Sync, and it adds the plays to the host
  s3 --> s0: the Sync stops
  s3 --> s4: the Sync deletes Play Counts
  s1 --> s5: the Sync stops
  s4 --> s0: the Sync stops or the Sync ends
  s3 --> s5: the Sync stops
  s5 --> s1: you start a Sync, and it skips the plays that it read
  s5 --> s6: you play a Track
  s6 --> s1: you start a Sync, and it adds the read plays again
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  classDef tan fill:#e5d9ce,color:#1f1f1f
  classDef blue fill:#c3e0ff,color:#1f1f1f
  classDef bugPath stroke:#1680f3,stroke-width:2.5px
  class s0 tan
  class s0 mayBreak
  class s0 bugPath
  class s1 blue
  class s1 mayBreak
  class s1 bugPath
  class s2 tan
  class s2 bugPath
  class s3 blue
  class s3 mayBreak
  class s4 blue
  class s4 mayBreak
  class s5 tan
  class s5 mayBreak
  class s5 bugPath
  class s6 tan
  class s6 breaks
  class s6 bugPath
```

The bug that the chart marks:

- `NoPlayCountedTwice` breaks: "Each play on the Device counts one time in the host Play Data."
  Path: you play a Track, you start a Sync and it adds the plays to the host, the Sync stops, you play a Track.
  The next Sync then adds the read plays again.

After the double count, a later state can keep the wrong count, so the chart marks those states "in some cases".
The chart does not draw a step that stays in one chart state.
An example is a second play when new plays are already on the Device.
The view hides the end step of the model, which changes nothing.

Covered digest: `173da93988e0dc5b0b93deb19be27960357489075295abf82834dc5af3917253`
