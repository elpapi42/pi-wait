import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Controller } from "./waits/controller.js";
import { DUE_TYPE } from "./waits/ledger.js";
import { renderDueMessage, renderWaitCall, renderWaitResult } from "./waits/render.js";

const WAIT_DESCRIPTION = "Set a one-shot, non-blocking wait. The tool returns immediately. When it is due, Pi wakes you and starts a turn with the message as context. Use it for concrete external checks that do not send completion notifications, or for user-requested reminders. Do not use it for fork completion or shell sleep. Reusing an ID replaces the active wait in the current branch. If Pi is offline when a wait becomes due, it wakes you when the owning branch resumes.";
const SECONDS_DESCRIPTION = "Delay in seconds before the check. Use the shortest reasonable delay. Do not use waits as a polling loop.";
const MESSAGE_DESCRIPTION = "State what is being awaited, the exact check, any command, URL, or ID that matters, the expected state, and the next decision.";
const ID_DESCRIPTION = "Optional stable ID for replacing an active wait in the current branch. If you omit it, the tool creates an independent ID. Use 1 to 64 lowercase ASCII characters. Start with a letter. Use lowercase letters or digits, with single hyphens only between nonempty segments.";

export default function register(pi: ExtensionAPI): void {
  const controller = new Controller(pi);

  pi.registerMessageRenderer(DUE_TYPE, renderDueMessage);

  pi.on("session_start", async (_event, ctx) => {
    await controller.start(ctx);
  });
  pi.on("session_before_tree", async () => {
    await controller.beforeTree();
  });
  pi.on("session_tree", async (_event, ctx) => {
    await controller.afterTree(ctx);
  });
  pi.on("session_shutdown", async () => {
    await controller.stop();
  });

  pi.registerTool({
    name: "wait",
    label: "Wait",
    description: WAIT_DESCRIPTION,
    parameters: Type.Object({
      seconds: Type.Number({ description: SECONDS_DESCRIPTION, minimum: 1, maximum: 3600 }),
      message: Type.String({ description: MESSAGE_DESCRIPTION }),
      id: Type.Optional(Type.String({ description: ID_DESCRIPTION })),
    }),
    renderCall: renderWaitCall,
    renderResult: renderWaitResult,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const scheduled = await controller.schedule(ctx, params.seconds, params.message, params.id, signal);
      return {
        content: [{ type: "text", text: `Wait ${scheduled.waitId} set for ${params.seconds}s.` }],
        details: { waitId: scheduled.waitId, seconds: params.seconds, dueAt: scheduled.dueAt },
      };
    },
  });
}
