# pi-wait

`pi-wait` provides one durable, one-shot `wait` tool for Pi. A wait returns immediately, then wakes the agent with the stored check context when it becomes due.

## Tool

```text
wait(seconds, message, id?) → wait ID
```

- `seconds` is a finite number from 1 through 3600.
- `message` is the future check context. Include what changed, what to check, and the command, URL, or identifier needed to act.
- `id` is an optional stable replacement ID. It must contain 1 to 64 lowercase ASCII letters or digits, start with a letter, and use single hyphens only between nonempty segments.

A supplied `id` replaces its active wait on the current branch. An omitted `id` creates an independent generated ID such as `wait-1234567`.

When due, Pi receives this model-visible message:

```text
<waitId>:

This wait is due.

<message>
```

The due message starts a turn. It does not require user-visible text. The harness communication policy decides whether the agent needs to reply to the user.

## Behavior and limits

`pi-wait` uses an append-only, session-owned, branch-local V3 ledger:

```text
wait.scheduled { version: 3, ownerSessionId, ownerSessionFile, waitId, generationId, dueAt, message }
wait.fired { version: 3, ownerSessionId, ownerSessionFile, waitId, generationId, firedAt }
```

A wait belongs to the Pi session whose header ID and normalized absolute session file path match both owner fields. The path uses lexical normalization, without resolving symlinks or requiring the file to exist. A copied session, including an async-fork child with the same header ID, ignores the original session's waits because its file path differs.

Branches within the same session file keep their existing behavior. A pre-split wait is available in descendant branches. A post-split wait stays on its branch and descendants.

The latest `wait.scheduled` record for a public `waitId` replaces older generations for the same owner. `generationId` is internal. It prevents an old timeout from firing a replacement and deduplicates due-message replay with both owner fields.

Pending V3 waits survive reload, restart, and session shutdown at the same normalized absolute path. If Pi stops before a deadline, the wait fires when its branch next becomes active after the deadline. A wait remains inactive while its branch is inactive.

Moving, renaming, or importing a session file does not transfer its pending waits. Opening the same file through another symlink alias also changes its owner path. Reschedule pending waits after these operations. Scheduling requires a persistent session file path. In-memory sessions and `--no-session` cannot schedule waits. Pi can assign the path before the file exists.

Delivery is at least once. `wait.fired` is stored before delivery. If Pi stops before its due message persists, branch reconciliation sends it again. V3 due-message metadata suppresses later replay after persistence. The controller checks the owner and lifecycle generation again immediately before sending. Full owner paths stay in metadata, not model-visible text or TUI output.

Ownership is not a cross-process lock. Two processes that open the same ID and file can still independently fire waits.

## V3 cutover

After you reload this version, V1 and V2 records and due messages are intentionally inactive. They cannot schedule, fire, replay, or suppress a V3 wait. Reschedule any pending wait you still need. Historical entries are not rewritten. Older due messages can appear through Pi's generic renderer but do not start new timers.

Already-loaded processes keep their previous code until they reload or stop. Reload or stop those processes before relying on V3 ownership.

Do not roll back to older pi-wait code while copyable sessions contain legacy wait records. Older code can reactivate stored V1 or V2 waits and reintroduce copied-session execution. Older code ignores V3 waits, so rollback also drops pending V3 waits.

The extension uses the local wall clock. Clock rollback can delay a wait. Clock advance can make it due early.

The first version intentionally has no cancellation tool, wait listing, wait groups, external scheduler, or configuration. Reuse a stable `id` to replace a pending wait.

## TUI

The tool call shows a compact header:

```text
wait deploy-check · 30s
```

The full check context appears only when expanded. A due wait uses a themed panel headed:

```text
⏱ wait deploy-check: due
```

Internal generation IDs do not appear in tool calls or due-message content.

## Install and remove

This harness auto-discovers the active checkout at:

```text
/home/elpapi/.pi/agent/extensions/pi-wait
```

Run `/reload` after installation or source changes. To install elsewhere, use the `pi-wait` Git repository:

```bash
pi install git:github.com/elpapi42/pi-wait
```

To remove the extension, remove its discovery or package configuration and reload Pi. Existing `pi-wait` custom ledger entries remain inert session history. They do not start waits without the extension.

## Development

```bash
cd /home/elpapi/.pi/agent/extensions/pi-wait
npm test
npm run typecheck
npm audit --audit-level=high
```

The test suite covers ledger projection, replacement, branch ownership, restart recovery, overdue waits, replay suppression, lifecycle races, and TUI rendering.

## License

MIT
