import { DUE_TYPE, isDelivered } from "./ledger.js";

export function formatDue(waitId: string, message: string): string {
  return `${waitId}:\n\nThis wait is due.\n\n${message}`;
}

export class Delivery {
  #tail = Promise.resolve();

  deliver(pi: any, waitId: string, generationId: string, dueAt: number, message: string): Promise<void> {
    const work = this.#tail.catch(() => undefined).then(() => {
      pi.sendMessage(
        {
          customType: DUE_TYPE,
          content: formatDue(waitId, message),
          display: true,
          details: { waitId, generationId, dueAt },
        },
        { deliverAs: "steer", triggerTurn: true },
      );
    });
    this.#tail = work;
    return work;
  }

  wasDelivered(entries: readonly unknown[], generationId: string): boolean {
    return isDelivered(entries, generationId);
  }
}
