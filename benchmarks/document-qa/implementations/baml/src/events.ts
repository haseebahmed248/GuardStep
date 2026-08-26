import type { EventType, PortableEvent } from "./types.js";

export class EventRecorder {
  readonly #events: PortableEvent[] = [];

  constructor(readonly runId: string) {}

  emit(type: EventType, data: Record<string, unknown>, stepId?: string): void {
    this.#events.push({
      schema_version: 1,
      sequence: this.#events.length,
      run_id: this.runId,
      type,
      ...(stepId === undefined ? {} : { step_id: stepId }),
      data,
    });
  }

  snapshot(): PortableEvent[] {
    return this.#events.map((event) => ({ ...event, data: { ...event.data } }));
  }
}
