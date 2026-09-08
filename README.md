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

`pi-wait` uses an append-only, session-owned, branch-local V2 ledger:

```text
wait.scheduled { version: 2, ownerSessionId, waitId, generationId, dueAt, message }
wait.fired { version: 2, ownerSessionId, waitId, generationId, firedAt }
```

Only the Pi session whose header ID matches `ownerSessionId` can project, arm, fire, or replay a wait. A copied session, including an async-fork child, ignores waits copied from another session. Branches within the same session keep their existing behavior: a pre-split wait is available in descendant branches, while a post-split wait stays on its branch and descendants.

The latest `wait.scheduled` record for a public `waitId` replaces older generations for the same session. `generationId` is internal. It prevents an old timeout from firing a replacement and deduplicates due-message replay with the session owner.

Pending V2 waits survive reload, restart, and session shutdown. If Pi is stopped after a deadline, the wait fires once when its branch next becomes active. A wait remains inactive while its branch is inactive.

Delivery is at least once. `wait.fired` is stored before delivery. If Pi stops before its due message persists, branch reconciliation sends it again. The V2 custom-message metadata suppresses later replay after persistence.

## V2 cutover

After you reload this version, pre-upgrade V1 `pi-wait` records and due messages are intentionally inactive. Reschedule any pending wait you still need. This prevents a copied session from executing a wait owned by another session.

Do not roll back to older pi-wait code while V1 records remain in a session that can be copied. Older code can reactivate those V1 waits and reintroduce copied-session execution. Older code ignores V2 records, so rolling back also drops pending V2 waits.

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
