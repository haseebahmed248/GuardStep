import type { EventType, PortableEvent } from "./types.js";

export const appendEvent = (
  events: PortableEvent[],
  runId: string,
  type: EventType,
  data: Record<string, unknown>,
  stepId?: string,
): PortableEvent[] => [
  ...events,
  {
    schema_version: 1,
    sequence: events.length,
    run_id: runId,
    type,
    ...(stepId === undefined ? {} : { step_id: stepId }),
    data,
  },
];
