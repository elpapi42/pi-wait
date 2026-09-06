import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { validateWaitId } from "./identity.js";

type RenderContext = {
  args?: { seconds?: unknown; message?: unknown; id?: unknown };
  state: Record<string, unknown>;
  lastComponent?: unknown;
  isError?: boolean;
  invalidate: () => void;
};

function textContent(result: any): string {
  if (!Array.isArray(result?.content)) return "";
  return result.content
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function waitId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    validateWaitId(value);
    return value;
  } catch {
    return undefined;
  }
}

function callText(args: RenderContext["args"], completedId: unknown, theme: any): string {
  const id = waitId(completedId) ?? waitId(args?.id) ?? "wait-…";
  const seconds = typeof args?.seconds === "number" && Number.isFinite(args.seconds) ? args.seconds : "?";
  return `${theme.fg("toolTitle", theme.bold("wait"))} ${theme.fg("accent", id)} ${theme.fg("muted", `· ${seconds}s`)}`;
}

function section(title: string, body: unknown): Container {
  const container = new Container();
  container.addChild(new Spacer(1));
  container.addChild(new Text(title, 0, 0));
  container.addChild(new Text(typeof body === "string" ? body : "", 0, 0));
  return container;
}

function dueBody(content: unknown, waitId: unknown): string {
  if (typeof content !== "string" || typeof waitId !== "string") return typeof content === "string" ? content : "";
  const prefix = `${waitId}:\n\nThis wait is due.\n\n`;
  return content.startsWith(prefix) ? content.slice(prefix.length) : content;
}

export function renderWaitCall(args: any, theme: any, context: RenderContext) {
  const component = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  context.state.waitCallComponent = component;
  component.setText(callText(args, context.state.waitId, theme));
  return component;
}

export function renderWaitResult(result: any, { expanded }: { expanded: boolean }, theme: any, context: RenderContext) {
  const id = waitId(result?.details?.waitId);
  if (!context.isError && id && context.state.waitId !== id) {
    context.state.waitId = id;
    const callComponent = context.state.waitCallComponent;
    if (callComponent instanceof Text) callComponent.setText(callText(context.args, id, theme));
  }

  const output = textContent(result);
  if (context.isError) return new Text(theme.fg("error", output || "Wait scheduling failed."), 0, 0);
  if (!expanded || typeof context.args?.message !== "string") return new Container();
  return section(theme.fg("muted", "─── Wake context ───"), theme.fg("dim", context.args.message));
}

export function renderDueMessage(message: any, { expanded }: { expanded: boolean }, theme: any) {
  const id = waitId(message?.details?.waitId);
  const header = `${theme.fg("accent", "⏱")} ${theme.fg("toolTitle", theme.bold("wait"))}${id ? ` ${theme.fg("accent", id)}` : ""}: ${theme.fg("warning", "due")}`;
  const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
  box.addChild(new Text(header, 0, 0));
  if (expanded) {
    box.addChild(new Spacer(1));
    box.addChild(new Markdown(
      dueBody(message?.content, id),
      0,
      0,
      getMarkdownTheme(),
      { color: (text: string) => theme.fg("customMessageText", text) },
    ));
  }
  return box;
}
