---
name: verify-read-back
description: Model-check with TLC that a Sync counts each play on the Device one time in the host Play Data, also when a Sync stops early, and add the state chart file of each PR. Use when a change touches packages/core/src/read-back.ts, packages/core/src/play-data.ts, or packages/core/src/sync.ts, when you open a PR, or when bun run verify fails.
---

# Verify the Play Data Read-back

At the start of each Sync, the Read-back merges the Play Counts file of the Device into the host Play Data.
`CONTEXT.md` defines Read-back, Play Data, and Commit point.
The Sync writes the host file, then later writes the iTunesDB and deletes Play Counts.
A Sync can stop between any two of these steps, and the Device can record plays before the next Sync.
`ReadBack.tla` is a TLA+ model of those steps, and TLC checks every order of them within the bounds below.

## Why this target and this tool

- Play Data is the only user data that omatune cannot make again.
  A Sync can copy the Library again.
  A lost or doubled play count stays wrong on the host and on the Device.
- The Sync writes Play Data on two machines in several steps, and an unplug, a kill, or an error can stop it at any step.
  The tests stop a Sync at one place. They do not stop it at each step with plays between two Syncs.
- The question is about the order of steps and stops, so a model checker fits it.
  TLA+ with TLC explores every order. No verifier runs on the TypeScript code under Bun.
- TLC is one pinned jar with a checked SHA-256, and it needs only Java, so CI and each developer can run it.

## Run the check

```sh
bun run verify
```

The check needs Java 11 or later on the `PATH`.
The first run downloads TLC 1.7.4 into `node_modules/.cache/tla2tools/1.7.4/` and checks its SHA-256 against `record.json`.
The `verify` job of `.github/workflows/verification.yml` runs the same command on each PR.
The test command in `.no-mistakes.yaml` runs it after `bun test`.
On a developer computer, the check takes about 1 s after the first download.

The check fails in each of these cases, and it names the cause:

1. This skill or `record.json` is missing.
2. A covered file, `ReadBack.tla`, or `ReadBack.cfg` changed, and its SHA-256 in `record.json` did not.
3. TLC finds a violation of a property with the status `holds`, or a recorded finding no longer breaks.
4. TLC does not catch the recorded break of a property with the status `holds`.
5. The change adds no state chart file with the name of the branch, as "State chart file of each PR" tells you.
6. A state chart file has no Mermaid chart and no "No state change" note.
7. The change touches a covered file, `ReadBack.tla`, or `ReadBack.cfg`, and the state chart file does not name the covered digest.
8. A state chart file has a Mermaid chart, and the change has no SVG image of it.
9. The SVG image names a chart digest that is not the digest of the chart text.

The check finds the change from the merge base of `HEAD` and `origin/main` to `HEAD`.
It reads the committed files, so commit the chart file and its image before you run it.
It does not check cases 5 to 9 when `HEAD` has no change from `origin/main`, for example on `main`.
It gets the branch name from `GITHUB_HEAD_REF` in CI, or from the branch that you checked out.
On a detached `HEAD`, it uses the one local branch that is in the history of `HEAD` and is not in `origin/main`.
When no such branch or more than one such branch exists, it accepts each chart file that the change adds.

## Tell if a change touches verified code

`record.json` lists each covered file, the functions in it, and its SHA-256.
It also lists the SHA-256 of `ReadBack.tla` and `ReadBack.cfg`.
The check compares the full file, so any edit of a covered file stops the check until you confirm the model.

| Covered file | Code that the model describes |
| --- | --- |
| `packages/core/src/read-back.ts` | `runPlayDataReadBack`: no Play Counts, the digest guard on `mergedPlayCounts`, and the merge |
| `packages/core/src/play-data.ts` | `mergePlayDataEntry` (counts add), `withMergedPlayCounts`, `hashPlayCountsBytes`, `writePlayDataAtomic` |
| `packages/core/src/sync.ts` | `runPipeline`: the order of Read-back, iTunesDB write, Play Counts delete, and commit. `runReadBack`: the host write |

Also look for new code that changes the same behavior in other files.
Examples are a new writer of `play-data.json`, a new reader or deleter of Play Counts, and a new path that writes the iTunesDB.

## Properties

`NextAdd` in the model is the count of plays that the next Read-back adds.
It is the count in the Play Counts file when the digest of the file is not in `mergedPlayCounts`, and zero in other cases.

| Property | Status | Rule in plain words | Harm when it breaks |
| --- | --- | --- | --- |
| `NoPlayLost` | holds | A Sync deletes Play Counts only after the host Play Data holds its plays. | Plays that the Device recorded are lost. |
| `RedoCountsOnce` | holds | A Sync that runs again after a stop counts each play one time, unless the Device recorded a play after the stop. | A Sync that runs again after a stop counts the same plays two times. |
| `NoPlayCountedTwice` | finding | Each play on the Device counts one time in the host Play Data. | The host Play Data and the next iTunesDB show plays that did not occur. |

In the model, `NoPlayLost` is `host + NextAdd >= plays`, and `NoPlayCountedTwice` is `host + NextAdd <= plays`.
`RedoCountsOnce` is `NoPlayCountedTwice`, except after the case that the variable `stale` records.
`stale` becomes true when the Device adds a play to a Play Counts file that a stopped Sync merged.

A property with the status `finding` breaks on the current code.
The check expects it to break, and the check fails when it stops breaking.
Each property with the status `holds` has a recorded break in `record.json`.
The check applies the break to a copy of the model in a temporary folder, and TLC must find the violation.
The break never changes a file in the repository.

### Finding: a play after a stopped Sync counts earlier plays two times

`NoPlayCountedTwice` breaks on this path:

1. The Device records two plays in Play Counts.
2. A Sync starts. `runReadBack` adds the two plays to `play-data.json` and records the digest of Play Counts in `mergedPlayCounts`.
3. The Sync stops before `runPipeline` deletes Play Counts, for example after an unplug, a kill, or a full disk.
4. You play the Track one more time. The firmware adds the play to the same Play Counts file, so its digest changes.
5. The next Sync does not find the new digest in `mergedPlayCounts`, so it adds all three plays.
   The host count is five, and the Device recorded three plays.

A stop after the iTunesDB write and before the Play Counts delete gives the same result.
A replay against the real code confirmed step 5 on 2026-11-18.
It used the fake Device of `packages/cli/src/play-data.test.ts` and a read-only `iPod_Control` folder to stop the Sync at the marker write.
Do not fix the product code in a verification change.
When a fix lands, set the status of `NoPlayCountedTwice` to `holds` and record a break for it.

## Bounds and assumptions

`ReadBack.cfg` sets `MaxPlays = 4` and `MaxSyncs = 4`, for one Device and one Track.
TLC checks 1,475 distinct states with these bounds.

The model assumes these facts about the firmware and the host:

- The Device records a play only when no Sync has it mounted.
- Each play adds one to the Play Counts file, or makes a new file when none exists.
  The firmware keeps the file until a host deletes it.
- Each play changes the bytes of Play Counts, because the file holds the last played time.
  Two files with different plays thus have different digests.
- The iTunesDB on the Device is readable, and the Read-back finds the Track in the Ledger or by its hash prefix.
- `writePlayDataAtomic` and `writeFileAtomic` replace a file in one rename.

## What the check does not cover

- Skip count, rating, last played, last skipped, and bookmark. The skip count adds as the play count does, so the finding also applies to it.
- More than one Device or Track, and the pairing of Play Counts entries with iTunesDB tracks by index in `playCountsForTracks`.
- A corrupt Play Counts file, a missing or unreadable iTunesDB, and the wipe of a Foreign Device.
- Plays of a Track that the Read-back cannot match. The Sync deletes Play Counts with those plays in it.
- The play count that the Device shows on its screen.
- What the firmware does with an old Play Counts file when a new iTunesDB arrives.
  The finding path does not depend on it, because the Sync stops before the iTunesDB write.
- The lock, the copy of music, the Artwork, and the Ledger.

## Model map

Each action in `ReadBack.tla` is one indivisible step in the code at the sync commit.

| Action | Code |
| --- | --- |
| `YouPlay` | The firmware adds a play to Play Counts. This is not omatune code. |
| `YouStartSync` | `sync.ts` `executeLocked` and `prepareSync`: the lock, the plan, and the confirm. They change no Play Data. |
| `ReadsBack` | `read-back.ts:137-147`: no Play Counts, so not consumed. `read-back.ts:148-159`: the digest is in `mergedPlayCounts`, so consumed with no merge. `read-back.ts:216-245`: the merge, where counts add (`play-data.ts:146`). `sync.ts:666-668` writes the host file with `writePlayDataAtomic`, and its rename (`play-data.ts:249`) is the indivisible step. |
| `WritesDatabase` | `sync.ts:592`: `writeFileAtomic` of the iTunesDB, the Commit point. The steps before it (`sync.ts:435-590`) change no Play Data and no Play Counts, so the model has no action for them. |
| `DeletesPlayCounts` | `sync.ts:593-596`: delete Play Counts when the Read-back consumed it. |
| `Finishes` | `sync.ts:607-621`: write `omatune.json` and the Ledger, delete the marker, and eject. |
| `Stops` | An unplug, a kill, or an error at any step after the Sync starts. An error after the Read-back exits with code 2. |
| `AllDone` | The model has no more plays or Syncs. |

The variable `consumed` is `readBack.consumedPlayCounts`, and `merged` is `mergedPlayCounts[serial]`.
In `playCounts` and `merged`, `file` numbers each Play Counts file that the firmware makes, and `file` 0 means no file.
`stopped` and `stale` are history variables for the properties. They have no field in the code.
`sync.ts:387-395` takes the no-change branch only when the Read-back consumed no Play Counts, so that branch changes no count.

## Read a result

- Read each TLC result with the `/statechart` skill.
  For a property that breaks, it gives the shortest path in plain words.
- Replay each path against the real code, one step for each action.
  `packages/cli/src/play-data.test.ts` drives a full Sync on a fake Device and writes Play Counts.
  `packages/core/src/read-back.test.ts` drives `runPlayDataReadBack` alone.
- If a step of the path cannot occur in the code, the model is wrong. Correct the model, and say what was wrong.
- If each step can occur, it is a bug in the code. Report the path in the words of the code, and do not weaken the property.

## Update the verification for an intended change

1. Read the diff of each covered file, and decide if the change alters what the model describes.
2. Change `ReadBack.tla` and the model map from the code, before you run the check. Keep one indivisible code step as one action.
3. Change a property only when the promise changed on purpose. Cite the evidence, such as an ADR, a test, or a commit message.
4. Run `bun run verify`, and read each failure as "Read a result" tells you.
5. Copy each new SHA-256 that the check prints into `record.json`.
6. When the model no longer contains the find text of a break, write a new break for the same guard.
7. When a finding no longer breaks, set its status to `holds` and record a break for it.
8. Run `bun run verify` again until it passes.

When the writing-rule hook blocks an edit of `ReadBack.tla` as prose, write the file with a shell command.

## Sync commit

`syncCommit` in `record.json` is the main commit at which a person last confirmed that the model describes the covered code.
This repository squash-merges each PR, so a commit of a PR branch is not on main after the merge.
On a PR branch, keep `syncCommit` at a main commit.
The SHA-256 digests in `record.json` name the exact content that the model describes.
To find the newest main commit that the record describes, find the newest main commit where each covered file has its recorded digest.
Move `syncCommit` only after you confirm that the model describes the code at the new commit.

## State chart file of each PR

Each PR adds one state chart file to `charts/` in this skill folder.
The file name is the branch name with the extension `.md`.
A hyphen replaces each character that is not a letter, a digit, `.`, `_`, or `-`.
For example, the branch `fm/omatune-verification-setup` has the file `charts/fm-omatune-verification-setup.md`.
The check runs before the PR exists, so it reads only the committed chart file and its SVG image.

The file contains a Mermaid chart of the states that the PR changes.
It also shows the states around them that a reader needs to follow the change.
It does not show the full application.
The chart must define each class that it applies with a `classDef` line, because a Mermaid viewer ignores a class with no definition.

Write the TLA+ model of the chart in a scratch folder outside the repository, and draw it with the `/statechart` skill.
When the PR changes the Read-back, you can start from a copy of `ReadBack.tla` with smaller bounds.
When the PR changes no behavior that moves between states, write a note in place of the chart.
Start a line with "No state change", and say why in one sentence.

When the PR changes a covered file, `ReadBack.tla`, or `ReadBack.cfg`, the chart file must name the covered digest.
The covered digest is the SHA-256 of the `sha256sum` lines of the covered files, in the order of `record.json`, then `ReadBack.tla` and `ReadBack.cfg`.
Get it after `record.json` holds the new digests:

```sh
sha256sum packages/core/src/read-back.ts packages/core/src/play-data.ts packages/core/src/sync.ts .claude/skills/verify-read-back/ReadBack.tla .claude/skills/verify-read-back/ReadBack.cfg | sha256sum
```

The check also prints the expected digest when it fails.
Write it in the chart file as `Covered digest: <digest>`.
An old digest shows that the chart is older than the covered code or the model.
Draw the chart again from the change, then write the new digest.
When the PR changes no covered file and no model file, the chart file needs no digest.

### Image of the chart

Each chart file with a Mermaid chart also has an SVG image in the change.
A person can read an SVG image at any zoom.
Render the Mermaid text to an SVG file as the render guide of the `/statechart` skill says.
Give the image the base name of the chart file and the extension `.svg`, in the same folder.
Show the image in the chart file with a relative link above the Mermaid text, such as `![State chart](fm-omatune-verification-setup.svg)`.

The image must name the chart digest as `Chart digest: <digest>`, for example in a `desc` element at the start of the SVG.
The chart digest is the SHA-256 of the lines between the line `` ```mermaid `` and the closing fence, with each line end.
The check compares the digest in the image with the digest of the chart text, and it does not render.
When the two differ, the image is older than the chart text, so render the image again and write the new digest.
A "No state change" note needs no image.

### Comment on the PR

After the pipeline pushes the branch and the PR exists, post one PR comment that shows the SVG image at the pushed commit.
Write `![State chart](https://github.com/jyooi/omatune/blob/<commit>/<image path>?raw=true)` and a link to the chart file at the same commit.
No check depends on that comment.
Do not add the chart to the PR text, because the pipeline writes the full PR text again on each run.

For drift that builds up across many commits, use the `/maintain-formal-verification-skill` skill.
