import assert from "node:assert/strict";
import test from "node:test";
import { Controller } from "../src/waits/controller.js";
import { DUE_TYPE } from "../src/waits/ledger.js";
import register from "../src/index.js";

test("registers only wait with its due renderer and lifecycle handlers", () => {
  const tools: any[] = [];
  const events = new Map<string, Function>();
  const renderers = new Map<string, Function>();
  register({
    on(name: string, handler: Function) { events.set(name, handler); },
    registerTool(tool: unknown) { tools.push(tool); },
    registerMessageRenderer(type: string, renderer: Function) { renderers.set(type, renderer); },
  } as any);

  assert.deepEqual(tools.map((tool) => tool.name), ["wait"]);
  assert.match(tools[0].description, /one-shot, non-blocking wait/);
  assert.match(tools[0].description, /Do not use it for fork completion or shell sleep/);
  assert.equal(tools[0].parameters.properties.seconds.minimum, 1);
  assert.equal(tools[0].parameters.properties.seconds.maximum, 86400);
  assert.match(tools[0].parameters.properties.message.description, /what is being awaited/);
  assert.match(tools[0].parameters.properties.id.description, /current branch/);
  assert.match(tools[0].parameters.properties.id.description, /1 to 64 lowercase ASCII/);
  assert.equal(Object.hasOwn(tools[0].parameters.properties, "timer"), false);
  assert.equal(typeof tools[0].renderCall, "function");
  assert.equal(typeof tools[0].renderResult, "function");
  assert.equal(DUE_TYPE, "pi-wait-due-v3");
  assert.ok(renderers.has(DUE_TYPE));
  assert.ok(events.has("session_start"));
  assert.ok(events.has("session_before_tree"));
  assert.ok(events.has("session_tree"));
  assert.ok(events.has("session_shutdown"));
});

test("forwards wait scheduling and returns its model-visible result", async () => {
  const originalSchedule = Controller.prototype.schedule;
  const received: any[] = [];
  try {
    (Controller.prototype.schedule as any) = async function (...args: unknown[]) {
      received.push(args);
      return { waitId: "deploy-check", dueAt: 123_000 };
    };
    const tools: any[] = [];
    register({ on() {}, registerTool(tool: unknown) { tools.push(tool); }, registerMessageRenderer() {} } as any);
    const result = await tools[0].execute(
      "call-1",
      { seconds: 30, message: "Check deploy health.", id: "deploy-check" },
      new AbortController().signal,
      undefined,
      { sessionManager: {} },
    );
    assert.deepEqual(received[0].slice(1), [30, "Check deploy health.", "deploy-check", received[0][4]]);
    assert.equal(received[0][4] instanceof AbortSignal, true);
    assert.deepEqual(result, {
      content: [{ type: "text", text: "Wait deploy-check set for 30s." }],
      details: { waitId: "deploy-check", seconds: 30, dueAt: 123_000 },
    });
  } finally {
    Controller.prototype.schedule = originalSchedule;
  }
});

test("forwards lifecycle hooks to one controller", async () => {
  const originalStart = Controller.prototype.start;
  const originalBeforeTree = Controller.prototype.beforeTree;
  const originalAfterTree = Controller.prototype.afterTree;
  const originalStop = Controller.prototype.stop;
  const calls: string[] = [];
  try {
    (Controller.prototype.start as any) = async function (ctx: unknown) { calls.push(`start:${(ctx as any).id}`); };
    (Controller.prototype.beforeTree as any) = async function () { calls.push("before"); };
    (Controller.prototype.afterTree as any) = async function (ctx: unknown) { calls.push(`after:${(ctx as any).id}`); };
    (Controller.prototype.stop as any) = async function () { calls.push("stop"); };
    const events = new Map<string, Function>();
    register({ on(name: string, handler: Function) { events.set(name, handler); }, registerTool() {}, registerMessageRenderer() {} } as any);
    await events.get("session_start")?.({}, { id: "one", sessionManager: { getBranch: () => [] } });
    await events.get("session_before_tree")?.();
    await events.get("session_tree")?.({}, { id: "two", sessionManager: { getBranch: () => [] } });
    await events.get("session_shutdown")?.();
    assert.deepEqual(calls, ["start:one", "before", "after:two", "stop"]);
  } finally {
    Controller.prototype.start = originalStart;
    Controller.prototype.beforeTree = originalBeforeTree;
    Controller.prototype.afterTree = originalAfterTree;
    Controller.prototype.stop = originalStop;
  }
});
