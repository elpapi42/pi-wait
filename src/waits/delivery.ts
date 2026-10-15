import { DUE_TYPE, isDelivered, type Owner } from "./ledger.js";

export function formatDue(waitId: string, message: string): string {
  return `${waitId}:\n\nThis wait is due.\n\n${message}`;
}

export class Delivery {
  #tail = Promise.resolve();

  deliver(pi: any, waitId: string, generationId: string, owner: Owner, dueAt: number, message: string, valid: () => boolean): Promise<void> {
    const work = this.#tail.catch(() => undefined).then(() => {
      if (!valid()) return;
      pi.sendMessage(
        {
          customType: DUE_TYPE,
          content: formatDue(waitId, message),
          display: true,
          details: { waitId, generationId, ...owner, dueAt },
        },
        { deliverAs: "steer", triggerTurn: true },
      );
    });
    this.#tail = work;
    return work;
  }

  wasDelivered(entries: readonly unknown[], generationId: string, owner: Owner): boolean {
    return isDelivered(entries, generationId, owner);
  }
}
