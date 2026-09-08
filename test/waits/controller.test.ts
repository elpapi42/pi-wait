import assert from "node:assert/strict";
import test from "node:test";
import { Controller } from "../../src/waits/controller.js";

class FakeTimers {
  readonly pending = new Map<number, () => void>();
  readonly callbacks = new Map<number, () => void>();
  readonly delays = new Map<number, number>();
  readonly cleared: number[] = [];
  #next = 1;

  set(delay: number, callback: () => void): number {
    const handle = this.#next++;
    this.pending.set(handle, callback);
    this.callbacks.set(handle, callback);
    this.delays.set(handle, delay);
    return handle;
  }

  clear(handle: unknown): void {
    this.cleared.push(handle as number);
    this.pending.delete(handle as number);
  }

  fire(handle: number): void {
    const callback = this.pending.get(handle);
    if (!callback) throw new Error(`Timer ${handle} is not active.`);
    this.pending.delete(handle);
    callback();
  }

  fireStale(handle: number): void {
    const callback = this.callbacks.get(handle);
    if (!callback) throw new Error(`Timer ${handle} has no callback.`);
    callback();
  }
}

function waitForQueue(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function drainQueue(): Promise<void> {
  await waitForQueue();
  await waitForQueue();
  await waitForQueue();
}

function harness(branch: any[] = [], now = 1_000, generationStart = 0) {
  let current = branch;
  let clock = now;
  const timers = new FakeTimers();
  const messages: any[] = [];
  const events: string[] = [];
  const pi = {
    appendEntry(customType: string, data: any) { current.push({ type: "custom", customType, data }); events.push(data.type); },
    sendMessage(...args: any[]) { messages.push(args); events.push("due"); },
  };
  let sessionId: unknown = "session-a";
  const ctx = { sessionManager: { getBranch: () => current, getHeader: () => ({ id: sessionId }) } };
  let ids = 0;
  let generation = generationStart;
  const controller = new Controller(pi, {
    now: () => clock,
    timers,
    createWaitId: () => `wait-${String(++ids).padStart(7, "0")}`,
    createGenerationId: () => `${String(++generation).padStart(8, "0")}-1111-4111-8111-111111111111`,
  });
  return {
    ctx,
    context() { return { sessionManager: ctx.sessionManager }; },
    timers,
    messages,
    events,
    controller,
    now: () => clock,
    setNow(value: number) { clock = value; },
    setBranch(value: any[]) { current = value; },
    setSessionId(value: unknown) { sessionId = value; },
  };
}

test("schedules a wait, persists before arming, and fires it after its deadline", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  const result = await h.controller.schedule(h.ctx, 5, "Check deploy health.");
  assert.deepEqual(result, { waitId: "wait-0000001", dueAt: 6_000 });
  assert.equal(h.timers.delays.get(1), 5_000);
  assert.equal(h.timers.pending.size, 1);
  assert.equal(h.messages.length, 0);
  h.setNow(6_000);
  h.timers.fire(1);
  await waitForQueue();
  assert.equal(h.ctx.sessionManager.getBranch().at(-1)?.data.type, "wait.fired");
  assert.deepEqual(h.events.slice(-2), ["wait.fired", "due"]);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0][0].content, "wait-0000001:\n\nThis wait is due.\n\nCheck deploy health.");
});

test("keeps armed waits when each schedule receives a fresh context", async () => {
  const h = harness();
  await h.controller.start(h.context());
  await h.controller.schedule(h.context(), 1, "Check first.", "first-check");
  await h.controller.schedule(h.context(), 1, "Check second.", "second-check");
  h.setNow(2_000);
  for (const handle of [...h.timers.pending.keys()]) h.timers.fire(handle);
  await drainQueue();
  assert.deepEqual(h.messages.map(([message]) => message.details.waitId), ["first-check", "second-check"]);
});

test("keeps restored waits when a new schedule receives a fresh context", async () => {
  const branch: any[] = [];
  const first = harness(branch);
  await first.controller.start(first.context());
  await first.controller.schedule(first.context(), 5, "Check restored.", "restored-check");
  await first.controller.stop();

  const restored = harness(branch, 1_000, 1);
  await restored.controller.start(restored.context());
  await restored.controller.schedule(restored.context(), 1, "Check new.", "new-check");
  restored.setNow(6_000);
  for (const handle of [...restored.timers.pending.keys()]) restored.timers.fire(handle);
  await drainQueue();
  assert.deepEqual(restored.messages.map(([message]) => message.details.waitId), ["restored-check", "new-check"]);
});

test("rejects a different session manager outside a lifecycle transition", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 5, "Check existing.", "existing-check");
  const other = { sessionManager: { getBranch: () => [], getHeader: () => ({ id: "session-b" }) } };
  await assert.rejects(() => h.controller.schedule(other, 5, "Check other.", "other-check"), /different session manager/);
  assert.equal(h.ctx.sessionManager.getBranch().filter((entry) => entry?.data?.type === "wait.scheduled").length, 1);
  assert.equal(h.timers.pending.size, 1);
});

test("rearms a wait when its timeout fires before the wall-clock deadline", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 5, "Check clock.", "clock-check");
  h.setNow(3_000);
  h.timers.fire(1);
  await drainQueue();
  assert.equal(h.timers.delays.get(2), 3_000);
  assert.equal(h.messages.length, 0);
  h.setNow(6_000);
  h.timers.fire(2);
  await drainQueue();
  assert.equal(h.messages.length, 1);
  assert.equal(h.ctx.sessionManager.getBranch().filter((entry) => entry?.data?.type === "wait.fired").length, 1);
});

test("replaces a stable ID and ignores the obsolete timer callback", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 5, "Old check.", "deploy-check");
  const old = [...h.timers.pending.keys()][0];
  await h.controller.schedule(h.ctx, 10, "New check.", "deploy-check");
  assert.equal(h.timers.pending.size, 1);
  h.setNow(11_000);
  // A stale callback can still arrive after clearTimeout on a real event loop.
  h.timers.fireStale(old);
  await waitForQueue();
  assert.equal(h.messages.length, 0);
  const current = [...h.timers.pending.keys()][0];
  h.timers.fire(current);
  await waitForQueue();
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0][0].content, /New check/);
});

test("replays a fired generation after same-ID replacement when its due message is absent", async () => {
  const branch: any[] = [];
  const first = harness(branch);
  await first.controller.start(first.ctx);
  await first.controller.schedule(first.ctx, 1, "Check first.", "deploy-check");
  first.setNow(2_000);
  first.timers.fire(1);
  await drainQueue();
  await first.controller.schedule(first.ctx, 10, "Check replacement.", "deploy-check");

  const restored = harness(branch, 2_000);
  await restored.controller.start(restored.ctx);
  assert.deepEqual(restored.messages.map(([message]) => message.details.waitId), ["deploy-check"]);
  assert.match(restored.messages[0][0].content, /Check first/);
  assert.equal(restored.timers.pending.size, 1);
});

test("does not replay a delivered fired generation after same-ID replacement", async () => {
  const branch: any[] = [];
  const first = harness(branch);
  await first.controller.start(first.ctx);
  await first.controller.schedule(first.ctx, 1, "Check first.", "deploy-check");
  first.setNow(2_000);
  first.timers.fire(1);
  await drainQueue();
  const generationId = branch.find((entry) => entry?.data?.type === "wait.fired")?.data.generationId;
  branch.push({ type: "custom_message", customType: "pi-wait-due-v2", details: { generationId, ownerSessionId: "session-a" } });
  await first.controller.schedule(first.ctx, 10, "Check replacement.", "deploy-check");

  const restored = harness(branch, 2_000);
  await restored.controller.start(restored.ctx);
  assert.equal(restored.messages.length, 0);
  assert.equal(restored.timers.pending.size, 1);
});

test("delivers simultaneous overdue replacements in schedule order", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 1, "Check first.", "first-check");
  await h.controller.schedule(h.ctx, 1, "Check second.", "second-check");
  await h.controller.schedule(h.ctx, 1, "Check replacement.", "first-check");
  h.setNow(2_000);
  for (const handle of [...h.timers.pending.keys()]) h.timers.fire(handle);
  await drainQueue();
  assert.deepEqual(h.messages.map(([message]) => message.content.match(/Check \w+/)?.[0]), ["Check second", "Check replacement"]);
});

test("replays a fired wait only when its due message is absent", async () => {
  const generationId = "11111111-1111-4111-8111-111111111111";
  const branch: any[] = [
    { type: "custom", customType: "pi-wait-v2", data: { version: 2, ownerSessionId: "session-a", type: "wait.scheduled", waitId: "deploy-check", generationId, dueAt: 1_000, message: "Check deploy health." } },
    { type: "custom", customType: "pi-wait-v2", data: { version: 2, ownerSessionId: "session-a", type: "wait.fired", waitId: "deploy-check", generationId, firedAt: 1_000 } },
  ];
  const h = harness(branch);
  await h.controller.start(h.ctx);
  assert.equal(h.messages.length, 1);
  branch.push({ type: "custom_message", customType: "pi-wait-due-v2", details: { generationId, ownerSessionId: "session-a" } });
  await h.controller.afterTree(h.ctx);
  assert.equal(h.messages.length, 1);
});

test("replays an owner-fired wait despite a forged foreign due message", async () => {
  const generationId = "11111111-1111-4111-8111-111111111111";
  const branch: any[] = [
    { type: "custom", customType: "pi-wait-v2", data: { version: 2, ownerSessionId: "session-a", type: "wait.scheduled", waitId: "deploy-check", generationId, dueAt: 1_000, message: "Check deploy health." } },
    { type: "custom", customType: "pi-wait-v2", data: { version: 2, ownerSessionId: "session-a", type: "wait.fired", waitId: "deploy-check", generationId, firedAt: 1_000 } },
    { type: "custom_message", customType: "pi-wait-due-v2", details: { generationId, ownerSessionId: "session-b" } },
  ];
  const h = harness(branch);
  await h.controller.start(h.ctx);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0][0].details.ownerSessionId, "session-a");
});

test("defers an overdue wait on an inactive branch until that branch becomes active", async () => {
  const branchA: any[] = [];
  const branchB: any[] = [];
  const h = harness(branchA);
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 1, "Check branch A.", "branch-check");
  await h.controller.beforeTree();
  h.setBranch(branchB);
  h.setNow(2_000);
  await h.controller.afterTree(h.ctx);
  assert.equal(h.messages.length, 0);
  await h.controller.beforeTree();
  h.setBranch(branchA);
  await h.controller.afterTree(h.ctx);
  assert.equal(h.messages.length, 1);
  assert.equal(branchA.filter((entry) => entry?.data?.type === "wait.fired").length, 1);
});

test("checks abort before append and ignores it after acceptance", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(() => h.controller.schedule(h.ctx, 1, "Check abort.", undefined, signal.signal), /aborted/);
  assert.equal(h.ctx.sessionManager.getBranch().length, 0);
});

test("preserves due delivery order for simultaneous waits", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 1, "Check first.", "first-check");
  await h.controller.schedule(h.ctx, 1, "Check second.", "second-check");
  h.setNow(2_000);
  for (const handle of [...h.timers.pending.keys()]) h.timers.fire(handle);
  await drainQueue();
  assert.deepEqual(h.messages.map(([message]) => message.details.waitId), ["first-check", "second-check"]);
});

test("does not fire a queued expiry after a branch transition", async () => {
  const branchA: any[] = [];
  const branchB: any[] = [];
  const h = harness(branchA);
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 1, "Check branch A.", "branch-check");
  h.setNow(2_000);
  h.timers.fire(1);
  await h.controller.beforeTree();
  h.setBranch(branchB);
  await h.controller.afterTree(h.ctx);
  assert.equal(h.messages.length, 0);
  assert.equal(branchA.filter((entry) => entry?.data?.type === "wait.fired").length, 0);
});

test("resumes canceled navigation when later scheduling work", async () => {
  const h = harness();
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 5, "Check existing.", "existing-check");
  await h.controller.beforeTree();
  await h.controller.schedule(h.ctx, 10, "Check new.", "new-check");
  await drainQueue();
  assert.equal(h.timers.pending.size, 2);
});

test("rejects generated IDs after ten historical collisions", async () => {
  const branch = Array.from({ length: 10 }, (_, index) => ({
    type: "custom",
    customType: "pi-wait-v2",
    data: {
      version: 2,
      ownerSessionId: "session-a",
      type: "wait.scheduled",
      waitId: `wait-${String(index + 1).padStart(7, "0")}`, 
      generationId: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
      dueAt: 100_000,
      message: "Check collision.",
    },
  }));
  const h = harness(branch);
  await h.controller.start(h.ctx);
  await assert.rejects(() => h.controller.schedule(h.ctx, 1, "Check collision."), /10 attempts/);
});

test("stops idempotently and restores pending waits after restart", async () => {
  const branch: any[] = [];
  const first = harness(branch);
  await first.controller.start(first.ctx);
  await first.controller.schedule(first.ctx, 5, "Check after restart.");
  await first.controller.stop();
  await first.controller.stop();
  const restored = harness(branch, 3_000);
  await restored.controller.start(restored.ctx);
  assert.equal(restored.timers.pending.size, 1);
  assert.equal(restored.timers.delays.get(1), 3_000);
});

test("ignores copied waits from another session while allowing its own waits", async () => {
  const parentBranch: any[] = [];
  const parent = harness(parentBranch);
  await parent.controller.start(parent.ctx);
  await parent.controller.schedule(parent.ctx, 1, "Parent-only wake.", "parent-check");

  const child = harness(parentBranch, 2_000);
  child.setSessionId("session-b");
  await child.controller.start(child.ctx);
  assert.equal(child.timers.pending.size, 0);
  assert.equal(child.messages.length, 0);
  assert.equal(parentBranch.filter((entry) => entry?.data?.type === "wait.fired").length, 0);

  await child.controller.schedule(child.ctx, 1, "Child-only wake.", "child-check");
  child.setNow(3_000);
  child.timers.fire([...child.timers.pending.keys()][0]);
  await drainQueue();
  assert.deepEqual(child.messages.map(([message]) => message.details.waitId), ["child-check"]);
  assert.equal(parentBranch.at(-1)?.data.ownerSessionId, "session-b");
});

test("inherits a pre-split wait across branches in the same session", async () => {
  const branchA: any[] = [];
  const h = harness(branchA);
  await h.controller.start(h.ctx);
  await h.controller.schedule(h.ctx, 1, "Check inherited branch.", "branch-check");
  const branchB = [...branchA];
  await h.controller.beforeTree();
  h.setBranch(branchB);
  h.setNow(2_000);
  await h.controller.afterTree(h.ctx);
  assert.equal(h.messages.length, 1);
  assert.equal(branchB.at(-1)?.data.ownerSessionId, "session-a");
  assert.equal(branchA.filter((entry) => entry?.data?.type === "wait.fired").length, 0);
});

test("fails closed when the session header ID is missing or invalid", async () => {
  const h = harness();
  h.setSessionId("");
  await h.controller.start(h.ctx);
  assert.equal(h.timers.pending.size, 0);
  await assert.rejects(() => h.controller.schedule(h.ctx, 1, "Do not schedule.", "blocked-check"), /non-empty session header ID/);
  assert.equal(h.ctx.sessionManager.getBranch().length, 0);

  h.setSessionId(42);
  await h.controller.afterTree(h.ctx);
  assert.equal(h.timers.pending.size, 0);
  assert.equal(h.messages.length, 0);
});
