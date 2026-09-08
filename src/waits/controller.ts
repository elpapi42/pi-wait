import { Delivery } from "./delivery.js";
import { createGenerationId, createWaitId, validateMessage, validateSeconds, validateWaitId } from "./identity.js";
import { active, appendFired, appendScheduled, firedWaits, isDelivered, project, type Scheduled } from "./ledger.js";

type SessionManager = { getBranch(): readonly unknown[]; getHeader(): { id?: unknown } | null | undefined };
type Context = { sessionManager: SessionManager };
type Pi = { appendEntry(customType: string, data: unknown): void; sendMessage(message: unknown, options: unknown): void };
type TimerHandle = unknown;
type Timers = { set(delay: number, callback: () => void): TimerHandle; clear(handle: TimerHandle): void };
type Options = {
  now?: () => number;
  timers?: Timers;
  createWaitId?: () => string;
  createGenerationId?: () => string;
};

const MAX_ID_ATTEMPTS = 10;

function defaultTimers(): Timers {
  return {
    set(delay, callback) { return setTimeout(callback, delay); },
    clear(handle) { clearTimeout(handle as ReturnType<typeof setTimeout>); },
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Wait operation was aborted.");
}

export class Controller {
  readonly #pi: Pi;
  readonly #delivery = new Delivery();
  readonly #now: () => number;
  readonly #timers: Timers;
  readonly #createWaitId: () => string;
  readonly #createGenerationId: () => string;
  readonly #handles = new Map<string, TimerHandle>();
  #tail: Promise<void> = Promise.resolve();
  #generation = 0;
  #paused = true;
  #sessionManager: SessionManager | undefined;

  constructor(pi: Pi, options: Options = {}) {
    this.#pi = pi;
    this.#now = options.now ?? Date.now;
    this.#timers = options.timers ?? defaultTimers();
    this.#createWaitId = options.createWaitId ?? createWaitId;
    this.#createGenerationId = options.createGenerationId ?? createGenerationId;
  }

  async start(ctx: Context): Promise<void> {
    this.#sessionManager = ctx.sessionManager;
    this.#paused = false;
    await this.reconcile();
  }

  async schedule(ctx: Context, seconds: number, message: string, waitId?: string, signal?: AbortSignal): Promise<{ waitId: string; dueAt: number }> {
    this.resume(ctx);
    validateSeconds(seconds);
    message = validateMessage(message);
    if (waitId !== undefined) validateWaitId(waitId);
    return this.enqueue(async () => {
      throwIfAborted(signal);
      const sessionManager = this.sessionManager();
      const ownerSessionId = this.requireOwnerSessionId(sessionManager);
      const entries = sessionManager.getBranch();
      const chosen = waitId ?? this.nextWaitId(entries, ownerSessionId);
      const replaced = active(entries, ownerSessionId).get(chosen);
      const scheduled: Scheduled = {
        version: 2,
        ownerSessionId,
        type: "wait.scheduled",
        waitId: chosen,
        generationId: this.#createGenerationId(),
        dueAt: this.#now() + seconds * 1_000,
        message,
      };
      appendScheduled(this.#pi, scheduled);
      if (replaced) this.disarm(replaced.generationId);
      this.arm(scheduled, this.#generation);
      return { waitId: chosen, dueAt: scheduled.dueAt };
    });
  }

  async beforeTree(): Promise<void> {
    this.pause();
    await this.#tail.catch(() => undefined);
  }

  async afterTree(ctx: Context): Promise<void> {
    this.#sessionManager = ctx.sessionManager;
    this.#paused = false;
    await this.reconcile();
  }

  async stop(): Promise<void> {
    this.pause();
    await this.#tail.catch(() => undefined);
  }

  private async reconcile(): Promise<void> {
    const generation = ++this.#generation;
    this.clearHandles();
    await this.enqueue(async () => {
      if (!this.current(generation)) return;
      const sessionManager = this.sessionManager();
      const ownerSessionId = this.ownerSessionId(sessionManager);
      if (!ownerSessionId) return;
      const entries = sessionManager.getBranch();
      for (const record of firedWaits(entries, ownerSessionId)) {
        if (!this.current(generation)) return;
        if (!isDelivered(sessionManager.getBranch(), record.generationId, ownerSessionId)) {
          await this.#delivery.deliver(this.#pi, record.waitId, record.generationId, ownerSessionId, record.dueAt, record.message);
        }
      }
      for (const record of active(sessionManager.getBranch(), ownerSessionId).values()) {
        if (!this.current(generation)) return;
        if (record.dueAt <= this.#now()) await this.fire(record.waitId, record.generationId, ownerSessionId, generation);
        else this.arm(record, generation);
      }
    });
  }

  private arm(record: Scheduled, generation: number): void {
    if (!this.current(generation) || this.#handles.has(record.generationId)) return;
    const delay = Math.max(0, record.dueAt - this.#now());
    const handle = this.#timers.set(delay, () => {
      void this.enqueue(() => this.fire(record.waitId, record.generationId, record.ownerSessionId, generation)).catch(() => undefined);
    });
    this.#handles.set(record.generationId, handle);
  }

  private async fire(waitId: string, generationId: string, ownerSessionId: string, generation: number): Promise<void> {
    if (!this.current(generation)) return;
    const sessionManager = this.sessionManager();
    if (this.ownerSessionId(sessionManager) !== ownerSessionId) return;
    const record = active(sessionManager.getBranch(), ownerSessionId).get(waitId);
    if (!record || record.generationId !== generationId) return;
    if (record.dueAt > this.#now()) {
      this.disarm(generationId);
      this.arm(record, generation);
      return;
    }
    this.disarm(generationId);
    appendFired(this.#pi, { version: 2, ownerSessionId, type: "wait.fired", waitId, generationId, firedAt: this.#now() });
    await this.#delivery.deliver(this.#pi, record.waitId, record.generationId, ownerSessionId, record.dueAt, record.message);
  }

  private nextWaitId(entries: readonly unknown[], ownerSessionId: string): string {
    const existing = new Set(project(entries, ownerSessionId).keys());
    for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
      const waitId = this.#createWaitId();
      if (!existing.has(waitId)) return waitId;
      existing.add(waitId);
    }
    throw new Error(`Could not create a wait ID after ${MAX_ID_ATTEMPTS} attempts.`);
  }

  private pause(): void {
    this.#paused = true;
    this.#generation += 1;
    this.clearHandles();
  }

  private resume(ctx: Context): void {
    if (!this.#paused) {
      if (this.#sessionManager !== ctx.sessionManager) throw new Error("Wait controller received a different session manager outside a lifecycle transition.");
      return;
    }
    if (this.#sessionManager && this.#sessionManager !== ctx.sessionManager) throw new Error("Wait controller cannot resume a different session manager before session_tree.");
    this.#sessionManager = ctx.sessionManager;
    this.#paused = false;
    void this.reconcile().catch(() => undefined);
  }

  private clearHandles(): void {
    for (const handle of this.#handles.values()) this.#timers.clear(handle);
    this.#handles.clear();
  }

  private disarm(generationId: string): void {
    const handle = this.#handles.get(generationId);
    if (handle !== undefined) this.#timers.clear(handle);
    this.#handles.delete(generationId);
  }

  private sessionManager(): SessionManager {
    if (!this.#sessionManager) throw new Error("Wait controller has no active session manager.");
    return this.#sessionManager;
  }

  private ownerSessionId(sessionManager: SessionManager): string | undefined {
    const id = sessionManager.getHeader()?.id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  }

  private requireOwnerSessionId(sessionManager: SessionManager): string {
    const ownerSessionId = this.ownerSessionId(sessionManager);
    if (!ownerSessionId) throw new Error("Wait controller requires a non-empty session header ID.");
    return ownerSessionId;
  }

  private current(generation: number): boolean {
    return !this.#paused && this.#sessionManager !== undefined && this.#generation === generation;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#tail.catch(() => undefined).then(work);
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }
}
