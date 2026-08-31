import type { PortableEvent, PortableEventType } from "./contracts.js";

export class EventRecorder {
  private readonly events: PortableEvent[] = [];

  constructor(private readonly runId: string) {}

  emit(
    type: PortableEventType,
    data: Readonly<Record<string, unknown>>,
    stepId?: string,
  ): void {
    const event: PortableEvent = {
      schema_version: 1,
      sequence: this.events.length,
      run_id: this.runId,
      type,
      ...(stepId === undefined ? {} : { step_id: stepId }),
      data: { ...data },
    };
    this.events.push(Object.freeze(event));
  }

  snapshot(): readonly PortableEvent[] {
    return Object.freeze([...this.events]);
  }
}
