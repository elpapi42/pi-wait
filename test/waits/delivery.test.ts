import assert from "node:assert/strict";
import test from "node:test";
import { Delivery, formatDue } from "../../src/waits/delivery.js";

const ownerSessionId = "session-a";

test("formats and serializes owner-scoped V2 due deliveries", async () => {
  assert.equal(
    formatDue("deploy-check", "Check deployment health."),
    "deploy-check:\n\nThis wait is due.\n\nCheck deployment health.",
  );

  const calls: any[] = [];
  const delivery = new Delivery();
  const pi = { sendMessage: (...args: any[]) => calls.push(args) };
  await Promise.all([
    delivery.deliver(pi, "deploy-check", "11111111-1111-4111-8111-111111111111", ownerSessionId, 1_000, "Check deployment health."),
    delivery.deliver(pi, "ci-check", "22222222-2222-4222-8222-222222222222", ownerSessionId, 2_000, "Check CI status."),
  ]);

  assert.deepEqual(calls.map(([message]) => message.content), [
    "deploy-check:\n\nThis wait is due.\n\nCheck deployment health.",
    "ci-check:\n\nThis wait is due.\n\nCheck CI status.",
  ]);
  assert.deepEqual(calls.map(([message]) => message.details), [
    { waitId: "deploy-check", generationId: "11111111-1111-4111-8111-111111111111", ownerSessionId, dueAt: 1_000 },
    { waitId: "ci-check", generationId: "22222222-2222-4222-8222-222222222222", ownerSessionId, dueAt: 2_000 },
  ]);
  assert.deepEqual(calls.map(([message]) => message.customType), ["pi-wait-due-v2", "pi-wait-due-v2"]);
  assert.deepEqual(calls.map(([, options]) => options), [
    { deliverAs: "steer", triggerTurn: true },
    { deliverAs: "steer", triggerTurn: true },
  ]);
});
