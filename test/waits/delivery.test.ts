import assert from "node:assert/strict";
import test from "node:test";
import { Delivery, formatDue } from "../../src/waits/delivery.js";

const owner = { ownerSessionId: "session-a", ownerSessionFile: "/sessions/parent.jsonl" };

test("formats and serializes owner-scoped V3 due deliveries", async () => {
  assert.equal(
    formatDue("deploy-check", "Check deployment health."),
    "deploy-check:\n\nThis wait is due.\n\nCheck deployment health.",
  );

  const calls: any[] = [];
  const delivery = new Delivery();
  const pi = { sendMessage: (...args: any[]) => calls.push(args) };
  await Promise.all([
    delivery.deliver(pi, "deploy-check", "11111111-1111-4111-8111-111111111111", owner, 1_000, "Check deployment health.", () => true),
    delivery.deliver(pi, "ci-check", "22222222-2222-4222-8222-222222222222", owner, 2_000, "Check CI status.", () => true),
  ]);

  assert.deepEqual(calls.map(([message]) => message.content), [
    "deploy-check:\n\nThis wait is due.\n\nCheck deployment health.",
    "ci-check:\n\nThis wait is due.\n\nCheck CI status.",
  ]);
  assert.deepEqual(calls.map(([message]) => message.details), [
    { waitId: "deploy-check", generationId: "11111111-1111-4111-8111-111111111111", ...owner, dueAt: 1_000 },
    { waitId: "ci-check", generationId: "22222222-2222-4222-8222-222222222222", ...owner, dueAt: 2_000 },
  ]);
  assert.deepEqual(calls.map(([message]) => message.customType), ["pi-wait-due-v3", "pi-wait-due-v3"]);
  assert.deepEqual(calls.map(([, options]) => options), [
    { deliverAs: "steer", triggerTurn: true },
    { deliverAs: "steer", triggerTurn: true },
  ]);
});

test("rechecks validity inside the serialized delivery callback", async () => {
  const delivery = new Delivery();
  const calls: unknown[] = [];
  const pi = { sendMessage(message: unknown) { calls.push(message); } };
  let valid = true;
  const pending = delivery.deliver(pi, "deploy-check", "11111111-1111-4111-8111-111111111111", owner, 1_000, "Check health.", () => valid);
  valid = false;
  await pending;
  assert.equal(calls.length, 0);
});
