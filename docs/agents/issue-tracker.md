# Issue tracker: Linear

Issues, PRDs, specs, and the wayfinder map for this repo live in Linear.
Use the Linear MCP tools (`mcp__plugin_linear_linear__*`) for every operation.

## Coordinates

- Workspace: huffman
- Team: Huffman (key `HUF`)
- Project: omatune (https://linear.app/huffman/project/omatune-01f5cffbe701)

Always set `team: "Huffman"` and `project: "omatune"` when you create an issue.

## Conventions

- Create an issue: `save_issue` with `team`, `project`, `title`, `description` (Markdown, real newlines).
- Read an issue: `get_issue` with the identifier (`HUF-123`). Add `list_comments` for the thread.
- List issues: `list_issues` filtered by `project: "omatune"` plus `state` or `label`.
- Comment: `save_comment` with `issueId`.
- Labels: `save_issue` with `labels` (this replaces the full set, so pass every label you want kept).
- Close: `save_issue` with `state: "Done"`. Use `Canceled` for won't fix.
- Blocking: `save_issue` with `blockedBy` or `blocks`. These are native relations and render in the Linear UI.
- Sub-issues: `save_issue` with `parentId`.
- Claim: `save_issue` with `assignee: "me"`.

## Wayfinding operations

- The map is an issue labelled `wayfinder:map` in project omatune.
- Tickets are sub-issues of the map (`parentId`), labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Blocking uses `blockedBy`.
- Frontier query: `list_issues` with `project: "omatune"`, state not Done or Canceled, no assignee, then drop any issue whose blockers are still open (check with `get_issue`).
- Resolution: post the answer with `save_comment`, set state `Done`, then `patch` the map body to append one line under `## Decisions so far`.
- Specs and PRDs: create a Linear document on the project with `save_document`.

## When a skill says "publish to the issue tracker"

Create a Linear issue in project omatune.

## When a skill says "fetch the relevant ticket"

Call `get_issue` with the identifier, then `list_comments`.
