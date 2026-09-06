import assert from "node:assert/strict";
import test from "node:test";
import { active, appendFired, appendScheduled, firedWaits, isDelivered, project } from "../../src/waits/ledger.js";

const scheduled = {
  type: "wait.scheduled" as const,
  waitId: "deploy-check",
  generationId: "11111111-1111-4111-8111-111111111111",
  dueAt: 1_000,
  message: "Check the deployment health endpoint.",
};

function entry(data: unknown) {
  return { type: "custom", customType: "pi-wait", data };
}

function fired(generationId = scheduled.generationId) {
  return { type: "wait.fired" as const, waitId: scheduled.waitId, generationId, firedAt: 1_001 };
}

test("projects scheduled waits and completes matching fired generations", () => {
  const record = project([entry(scheduled), entry(fired())]).get(scheduled.waitId);
  assert.equal(record?.fired?.firedAt, 1_001);
  assert.equal(active([entry(scheduled), entry(fired())]).has(scheduled.waitId), false);
});

test("uses the latest schedule for a stable wait ID and ignores stale fired generations", () => {
  const replacement = { ...scheduled, generationId: "22222222-2222-4222-8222-222222222222", dueAt: 2_000 };
  const records = project([entry(scheduled), entry(replacement), entry(fired())]);
  assert.equal(records.get(scheduled.waitId)?.generationId, replacement.generationId);
  assert.equal(records.get(scheduled.waitId)?.fired, undefined);
  assert.equal(active([entry(scheduled), entry(replacement), entry(fired())]).has(scheduled.waitId), true);
});

test("keeps fired generations available after same-ID replacement in firing order", () => {
  const replacement = { ...scheduled, generationId: "22222222-2222-4222-8222-222222222222", dueAt: 2_000 };
  const records = [entry(scheduled), entry(fired()), entry(replacement)];
  assert.deepEqual(firedWaits(records).map((record) => record.generationId), [scheduled.generationId]);
  assert.equal(active(records).get(scheduled.waitId)?.generationId, replacement.generationId);
});

test("orders replacements by their latest schedule entry", () => {
  const other = { ...scheduled, waitId: "other-check", generationId: "22222222-2222-4222-8222-222222222222" };
  const replacement = { ...scheduled, generationId: "33333333-3333-4333-8333-333333333333", dueAt: 2_000 };
  assert.deepEqual([...active([entry(scheduled), entry(other), entry(replacement)]).keys()], ["other-check", "deploy-check"]);
});

test("keeps independent generated IDs separate", () => {
  const other = { ...scheduled, waitId: "wait-0000002", generationId: "22222222-2222-4222-8222-222222222222" };
  const records = project([entry(scheduled), entry(other)]);
  assert.equal(records.size, 2);
});

test("appends lifecycle records with the pi-wait custom type", () => {
  const calls: Array<[string, unknown]> = [];
  const pi = { appendEntry(type: string, data: unknown) { calls.push([type, data]); } };
  appendScheduled(pi, scheduled);
  appendFired(pi, fired());
  assert.deepEqual(calls, [["pi-wait", scheduled], ["pi-wait", fired()]]);
});

test("matches delivered due messages by immutable generation ID", () => {
  const entries = [{ type: "custom_message", customType: "pi-wait-due", details: { generationId: scheduled.generationId } }];
  assert.equal(isDelivered(entries, scheduled.generationId), true);
  assert.equal(isDelivered(entries, "22222222-2222-4222-8222-222222222222"), false);
});

test("ignores malformed ledger records", () => {
  const records = project([
    entry({ ...scheduled, dueAt: Infinity }),
    entry({ ...scheduled, message: "   " }),
    entry({ ...scheduled, waitId: "Deploy" }),
    entry({ ...scheduled, generationId: "not-a-uuid" }),
    entry({ ...fired(), firedAt: -1 }),
  ]);
  assert.equal(records.size, 0);
});
