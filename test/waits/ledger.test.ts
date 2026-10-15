import assert from "node:assert/strict";
import test from "node:test";
import { active, appendFired, appendScheduled, DUE_TYPE, ENTRY_TYPE, firedWaits, isDelivered, project } from "../../src/waits/ledger.js";

const ownerA = { ownerSessionId: "session-a", ownerSessionFile: "/sessions/parent.jsonl" };
const ownerB = { ...ownerA, ownerSessionFile: "/sessions/child.jsonl" };
const scheduled = {
  version: 3 as const,
  ...ownerA,
  type: "wait.scheduled" as const,
  waitId: "deploy-check",
  generationId: "11111111-1111-4111-8111-111111111111",
  dueAt: 1_000,
  message: "Check the deployment health endpoint.",
};

function entry(data: unknown, customType = ENTRY_TYPE) {
  return { type: "custom", customType, data };
}

function fired(generationId = scheduled.generationId, owner = ownerA) {
  return { version: 3 as const, ...owner, type: "wait.fired" as const, waitId: scheduled.waitId, generationId, firedAt: 1_001 };
}

test("projects scheduled waits and completes matching owner-fired generations", () => {
  const record = project([entry(scheduled), entry(fired())], ownerA).get(scheduled.waitId);
  assert.equal(record?.fired?.firedAt, 1_001);
  assert.equal(active([entry(scheduled), entry(fired())], ownerA).has(scheduled.waitId), false);
});

test("ignores copied records and foreign fired records", () => {
  const foreignFired = fired(scheduled.generationId, ownerB);
  assert.equal(project([entry(scheduled)], ownerB).size, 0);
  assert.equal(project([entry(scheduled), entry(foreignFired)], ownerA).get(scheduled.waitId)?.fired, undefined);
});

test("uses the latest schedule for a stable wait ID and ignores stale fired generations", () => {
  const replacement = { ...scheduled, generationId: "22222222-2222-4222-8222-222222222222", dueAt: 2_000 };
  const records = project([entry(scheduled), entry(replacement), entry(fired())], ownerA);
  assert.equal(records.get(scheduled.waitId)?.generationId, replacement.generationId);
  assert.equal(records.get(scheduled.waitId)?.fired, undefined);
  assert.equal(active([entry(scheduled), entry(replacement), entry(fired())], ownerA).has(scheduled.waitId), true);
});

test("keeps fired generations available after same-ID replacement in firing order", () => {
  const replacement = { ...scheduled, generationId: "22222222-2222-4222-8222-222222222222", dueAt: 2_000 };
  const records = [entry(scheduled), entry(fired()), entry(replacement)];
  assert.deepEqual(firedWaits(records, ownerA).map((record) => record.generationId), [scheduled.generationId]);
  assert.equal(active(records, ownerA).get(scheduled.waitId)?.generationId, replacement.generationId);
});

test("orders replacements by their latest schedule entry", () => {
  const other = { ...scheduled, waitId: "other-check", generationId: "22222222-2222-4222-8222-222222222222" };
  const replacement = { ...scheduled, generationId: "33333333-3333-4333-8333-333333333333", dueAt: 2_000 };
  assert.deepEqual([...active([entry(scheduled), entry(other), entry(replacement)], ownerA).keys()], ["other-check", "deploy-check"]);
});

test("keeps independent generated IDs separate", () => {
  const other = { ...scheduled, waitId: "wait-0000002", generationId: "22222222-2222-4222-8222-222222222222" };
  const records = project([entry(scheduled), entry(other)], ownerA);
  assert.equal(records.size, 2);
});

test("appends V3 lifecycle records with the V3 custom type", () => {
  const calls: Array<[string, unknown]> = [];
  const pi = { appendEntry(type: string, data: unknown) { calls.push([type, data]); } };
  appendScheduled(pi, scheduled);
  appendFired(pi, fired());
  assert.deepEqual(calls, [[ENTRY_TYPE, scheduled], [ENTRY_TYPE, fired()]]);
});

test("matches delivered due messages by immutable generation and owner", () => {
  const entries = [{ type: "custom_message", customType: DUE_TYPE, details: { generationId: scheduled.generationId, ...ownerA } }];
  assert.equal(isDelivered(entries, scheduled.generationId, ownerA), true);
  assert.equal(isDelivered(entries, scheduled.generationId, ownerB), false);
  assert.equal(isDelivered(entries, "22222222-2222-4222-8222-222222222222", ownerA), false);
});

test("ignores legacy V1 records and due messages after the strict V3 cutover", () => {
  const legacyScheduled = { type: "wait.scheduled", waitId: scheduled.waitId, generationId: scheduled.generationId, dueAt: scheduled.dueAt, message: scheduled.message };
  const legacyDue = [{ type: "custom_message", customType: "pi-wait-due", details: { generationId: scheduled.generationId } }];
  assert.equal(project([entry(legacyScheduled, "pi-wait")], ownerA).size, 0);
  assert.equal(isDelivered(legacyDue, scheduled.generationId, ownerA), false);
});

test("ignores malformed V3 ledger records", () => {
  const records = project([
    entry({ ...scheduled, dueAt: Infinity }),
    entry({ ...scheduled, message: "   " }),
    entry({ ...scheduled, waitId: "Deploy" }),
    entry({ ...scheduled, generationId: "not-a-uuid" }),
    entry({ ...scheduled, ownerSessionId: "" }),
    entry({ ...scheduled, version: 1 }),
    entry({ ...fired(), firedAt: -1 }),
  ], ownerA);
  assert.equal(records.size, 0);
});

test("rejects legacy V2 records and due messages even when their IDs match", () => {
  const legacy = { ...scheduled, version: 2 };
  const due = { type: "custom_message", customType: "pi-wait-due-v2", details: { generationId: scheduled.generationId, ...ownerA } };
  assert.equal(project([entry(legacy, "pi-wait-v2"), entry(legacy)], ownerA).size, 0);
  assert.equal(isDelivered([due], scheduled.generationId, ownerA), false);
});

test("rejects missing and relative V3 owner paths", () => {
  for (const ownerSessionFile of [undefined, "", "relative.jsonl", 42]) {
    assert.equal(project([entry({ ...scheduled, ownerSessionFile })], ownerA).size, 0);
  }
});

test("ignores a changed ID even when the path matches", () => {
  assert.equal(project([entry(scheduled)], { ...ownerA, ownerSessionId: "another-id" }).size, 0);
});
