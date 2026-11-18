---- MODULE ReadBack ----
EXTENDS Naturals

CONSTANTS MaxPlays, MaxSyncs

VARIABLES plays, playCounts, host, merged, phase, consumed, syncs, stopped, stale, files

vars == <<plays, playCounts, host, merged, phase, consumed, syncs, stopped, stale, files>>

NoFile == [file |-> 0, count |-> 0]

PlayCountsFile == [file : 1..MaxPlays, count : 1..MaxPlays]

SyncPhases == {"reading", "merged", "committed", "cleaned"}

TypeOK ==
  /\ plays \in 0..MaxPlays
  /\ playCounts \in {NoFile} \cup PlayCountsFile
  /\ host \in Nat
  /\ merged \in {NoFile} \cup PlayCountsFile
  /\ phase \in {"unplugged"} \cup SyncPhases
  /\ consumed \in BOOLEAN
  /\ syncs \in 0..MaxSyncs
  /\ stopped \in BOOLEAN
  /\ stale \in BOOLEAN
  /\ files \in 0..MaxPlays

NextAdd == IF playCounts # NoFile /\ playCounts # merged THEN playCounts.count ELSE 0

Init ==
  /\ plays = 0
  /\ playCounts = NoFile
  /\ host = 0
  /\ merged = NoFile
  /\ phase = "unplugged"
  /\ consumed = FALSE
  /\ syncs = 0
  /\ stopped = FALSE
  /\ stale = FALSE
  /\ files = 0

YouPlay ==
  /\ phase = "unplugged"
  /\ plays < MaxPlays
  /\ plays' = plays + 1
  /\ IF playCounts = NoFile
       THEN /\ files' = files + 1
            /\ playCounts' = [file |-> files + 1, count |-> 1]
            /\ UNCHANGED stale
       ELSE /\ playCounts' = [playCounts EXCEPT !.count = @ + 1]
            /\ stale' = (stale \/ (stopped /\ playCounts = merged))
            /\ UNCHANGED files
  /\ UNCHANGED <<host, merged, phase, consumed, syncs, stopped>>

YouStartSync ==
  /\ phase = "unplugged"
  /\ syncs < MaxSyncs
  /\ syncs' = syncs + 1
  /\ phase' = "reading"
  /\ UNCHANGED <<plays, playCounts, host, merged, consumed, stopped, stale, files>>

ReadsBack ==
  /\ phase = "reading"
  /\ phase' = "merged"
  /\ IF playCounts = NoFile
       THEN /\ consumed' = FALSE
            /\ UNCHANGED <<host, merged>>
       ELSE IF playCounts = merged
         THEN /\ consumed' = TRUE
              /\ UNCHANGED <<host, merged>>
         ELSE /\ consumed' = TRUE
              /\ host' = host + playCounts.count
              /\ merged' = playCounts
  /\ UNCHANGED <<plays, playCounts, syncs, stopped, stale, files>>

WritesDatabase ==
  /\ phase = "merged"
  /\ phase' = "committed"
  /\ UNCHANGED <<plays, playCounts, host, merged, consumed, syncs, stopped, stale, files>>

DeletesPlayCounts ==
  /\ phase = "committed"
  /\ phase' = "cleaned"
  /\ playCounts' = IF consumed THEN NoFile ELSE playCounts
  /\ UNCHANGED <<plays, host, merged, consumed, syncs, stopped, stale, files>>

Finishes ==
  /\ phase = "cleaned"
  /\ phase' = "unplugged"
  /\ stopped' = FALSE
  /\ consumed' = FALSE
  /\ UNCHANGED <<plays, playCounts, host, merged, syncs, stale, files>>

Stops ==
  /\ phase \in SyncPhases
  /\ phase' = "unplugged"
  /\ stopped' = TRUE
  /\ consumed' = FALSE
  /\ UNCHANGED <<plays, playCounts, host, merged, syncs, stale, files>>

AllDone ==
  /\ phase = "unplugged"
  /\ plays = MaxPlays
  /\ syncs = MaxSyncs
  /\ UNCHANGED vars

Next ==
  \/ YouPlay
  \/ YouStartSync
  \/ ReadsBack
  \/ WritesDatabase
  \/ DeletesPlayCounts
  \/ Finishes
  \/ Stops
  \/ AllDone

Spec == Init /\ [][Next]_vars

NoPlayLost == host + NextAdd >= plays

RedoCountsOnce == stale \/ host + NextAdd <= plays

NoPlayCountedTwice == host + NextAdd <= plays

====
