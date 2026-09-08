import { validateMessage, validateWaitId } from "./identity.js";

export const ENTRY_TYPE = "pi-wait-v2";
export const DUE_TYPE = "pi-wait-due-v2";

export type Scheduled = {
  version: 2;
  ownerSessionId: string;
  type: "wait.scheduled";
  waitId: string;
  generationId: string;
  dueAt: number;
  message: string;
};

export type Fired = {
  version: 2;
  ownerSessionId: string;
  type: "wait.fired";
  waitId: string;
  generationId: string;
  firedAt: number;
};

export type LifecycleRecord = Scheduled | Fired;
export type ManagedWait = Scheduled & { fired?: Fired };

type PiEntries = { appendEntry(customType: string, data: LifecycleRecord): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOwnerSessionId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isWaitId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    validateWaitId(value);
    return true;
  } catch {
    return false;
  }
}

function isMessage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return validateMessage(value) === value;
  } catch {
    return false;
  }
}

function isLifecycleRecord(value: unknown): value is LifecycleRecord {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 2 || !isOwnerSessionId(raw.ownerSessionId)) return false;
  if (!isWaitId(raw.waitId) || typeof raw.generationId !== "string" || !UUID.test(raw.generationId)) return false;
  if (raw.type === "wait.scheduled") return isTimestamp(raw.dueAt) && isMessage(raw.message);
  return raw.type === "wait.fired" && isTimestamp(raw.firedAt);
}

function customData(entry: unknown): LifecycleRecord | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const raw = entry as { type?: unknown; customType?: unknown; data?: unknown };
  return raw.type === "custom" && raw.customType === ENTRY_TYPE && isLifecycleRecord(raw.data) ? raw.data : undefined;
}

function records(entries: readonly unknown[], ownerSessionId: string): { current: Map<string, ManagedWait>; fired: ManagedWait[] } {
  const current = new Map<string, ManagedWait>();
  const scheduled = new Map<string, Scheduled>();
  const completed = new Map<string, ManagedWait>();
  for (const entry of entries) {
    const data = customData(entry);
    if (!data || data.ownerSessionId !== ownerSessionId) continue;
    if (data.type === "wait.scheduled") {
      current.delete(data.waitId);
      current.set(data.waitId, data);
      scheduled.set(data.generationId, data);
      continue;
    }
    const wait = scheduled.get(data.generationId);
    if (wait?.waitId === data.waitId && wait.ownerSessionId === data.ownerSessionId && !completed.has(data.generationId)) {
      const completedWait = { ...wait, fired: data };
      completed.set(data.generationId, completedWait);
      if (current.get(data.waitId)?.generationId === data.generationId) current.set(data.waitId, completedWait);
    }
  }
  return { current, fired: [...completed.values()] };
}

export function project(entries: readonly unknown[], ownerSessionId: string): Map<string, ManagedWait> {
  return records(entries, ownerSessionId).current;
}

export function firedWaits(entries: readonly unknown[], ownerSessionId: string): ManagedWait[] {
  return records(entries, ownerSessionId).fired;
}

export function active(entries: readonly unknown[], ownerSessionId: string): Map<string, Scheduled> {
  return new Map([...project(entries, ownerSessionId)].flatMap(([waitId, wait]) => wait.fired ? [] : [[waitId, wait] as [string, Scheduled]]));
}

export function appendScheduled(pi: PiEntries, record: Scheduled): void {
  pi.appendEntry(ENTRY_TYPE, record);
}

export function appendFired(pi: PiEntries, record: Fired): void {
  pi.appendEntry(ENTRY_TYPE, record);
}

export function isDelivered(entries: readonly unknown[], generationId: string, ownerSessionId: string): boolean {
  return entries.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const raw = entry as { type?: unknown; customType?: unknown; details?: { generationId?: unknown; ownerSessionId?: unknown } };
    return raw.type === "custom_message"
      && raw.customType === DUE_TYPE
      && raw.details?.generationId === generationId
      && raw.details?.ownerSessionId === ownerSessionId;
  });
}
