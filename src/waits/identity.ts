import { randomInt, randomUUID } from "node:crypto";

const WAIT_ID = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/;

export function validateWaitId(waitId: string): void {
  if (!WAIT_ID.test(waitId)) {
    throw new Error("Wait ID must contain 1 to 64 lowercase ASCII letters or digits, start with a letter, and use single hyphens only between nonempty segments.");
  }
}

export function createWaitId(): string {
  return `wait-${randomInt(0, 10_000_000).toString().padStart(7, "0")}`;
}

export function createGenerationId(): string {
  return randomUUID();
}

export function validateSeconds(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error("Wait seconds must be a finite number from 1 through 3600.");
  }
}

export function validateMessage(message: string): string {
  if (!message.trim()) throw new Error("Wait message must not be empty.");
  return message;
}
