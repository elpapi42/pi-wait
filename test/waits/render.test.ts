import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function loadRenderer() {
  const directory = await mkdtemp(join(tmpdir(), "pi-wait-render-"));
  await writeFile(join(directory, "coding-agent-stub.mjs"), "export function getMarkdownTheme() { return {}; }\n");
  await writeFile(join(directory, "tui-stub.mjs"), `
    export class Text { constructor(text, paddingX, paddingY) { this.text = text; } setText(text) { this.text = text; } }
    export class Container { constructor() { this.children = []; } addChild(child) { this.children.push(child); } }
    export class Box extends Container { constructor(paddingX, paddingY, bgFn) { super(); this.paddingX = paddingX; this.paddingY = paddingY; this.bgFn = bgFn; } }
    export class Spacer { constructor(size) { this.size = size; } }
    export class Markdown { constructor(text, paddingX, paddingY, theme, options) { this.text = text; this.options = options; } }
  `);
  await writeFile(join(directory, "identity.ts"), await readFile(join(process.cwd(), "src/waits/identity.ts"), "utf8"));
  const source = await readFile(join(process.cwd(), "src/waits/render.ts"), "utf8");
  await writeFile(join(directory, "render.ts"), source
    .replace('from "@earendil-works/pi-coding-agent"', 'from "./coding-agent-stub.mjs"')
    .replace('from "@earendil-works/pi-tui"', 'from "./tui-stub.mjs"'));
  return { renderer: await import(`${pathToFileURL(join(directory, "render.ts")).href}?t=${Date.now()}`), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function theme() { return { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text }; }
function text(component: any): string { return typeof component?.text === "string" ? component.text : Array.isArray(component?.children) ? component.children.map(text).filter(Boolean).join("\n") : ""; }

test("renders pending, completed, expanded, and error wait calls", async () => {
  const { renderer, cleanup } = await loadRenderer();
  try {
    const state: Record<string, unknown> = {};
    const pending = renderer.renderWaitCall({ seconds: 30, message: "Check deployment health.", id: "deploy-check" }, theme(), { state });
    assert.equal(text(pending), "wait deploy-check · 30s");

    renderer.renderWaitResult({ content: [], details: { waitId: "deploy-check" } }, { expanded: false }, theme(), { state, args: { seconds: 30, message: "Check deployment health.", id: "deploy-check" }, isError: false, invalidate: () => { throw new Error("must not invalidate while rendering"); } });
    assert.equal(text(pending), "wait deploy-check · 30s");

    const generatedState: Record<string, unknown> = {};
    const generated = renderer.renderWaitCall({ seconds: 5, message: "Check CI status." }, theme(), { state: generatedState });
    assert.equal(text(generated), "wait wait-… · 5s");
    const expanded = renderer.renderWaitResult({ content: [], details: { waitId: "wait-1234567" } }, { expanded: true }, theme(), { state: generatedState, args: { seconds: 5, message: "Check CI status." }, isError: false, invalidate: () => { throw new Error("must not invalidate while rendering"); } });
    assert.equal(text(generated), "wait wait-1234567 · 5s");
    assert.equal(text(expanded), "─── Check ───\nCheck CI status.");

    assert.equal(text(renderer.renderWaitCall({ seconds: 5, message: "x", id: "BAD ID" }, theme(), { state: {} })), "wait wait-… · 5s");
    assert.equal(text(renderer.renderWaitResult({ content: [{ type: "text", text: "Wait failed." }] }, { expanded: false }, theme(), { state: {}, isError: true, invalidate() {} })), "Wait failed.");
  } finally { await cleanup(); }
});

test("renders due messages without duplicating identifiers", async () => {
  const { renderer, cleanup } = await loadRenderer();
  try {
    const renderTheme = theme();
    const due = renderer.renderDueMessage({ content: "deploy-check:\n\nThis wait is due.\n\nCheck deployment health.", details: { waitId: "deploy-check", generationId: "11111111-1111-4111-8111-111111111111", dueAt: 1_000 } }, { expanded: true }, renderTheme);
    assert.equal(text(due), "⏱ wait deploy-check: due\nCheck deployment health.");
    assert.equal(due.paddingX, 1);
    assert.equal(due.paddingY, 1);
    assert.equal(due.bgFn("panel"), "panel");
    assert.equal(text(renderer.renderDueMessage({ content: "bad", details: {} }, { expanded: false }, renderTheme)), "⏱ wait: due");
  } finally { await cleanup(); }
});
