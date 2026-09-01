import type { RuntimeClock } from "./contracts.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const systemRuntimeClock: RuntimeClock = {
  now: () => performance.now(),
  schedule(delayMs, callback) {
    const deadline = performance.now() + delayMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const check = (): void => {
      if (cancelled) return;
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        callback();
        return;
      }
      timer = setTimeout(check, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    };
    timer = setTimeout(check, Math.min(delayMs, MAX_TIMER_DELAY_MS));
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  },
};

export type DeadlineOutcome<Value> =
  | {
      readonly status: "returned";
      readonly value: Value;
      readonly measuredElapsedMs: number;
    }
  | {
      readonly status: "threw";
      readonly measuredElapsedMs: number;
    }
  | {
      readonly status: "deadline_exceeded";
      readonly measuredElapsedMs: number;
    };

const elapsedSince = (clock: RuntimeClock, startedAt: number): number =>
  Math.max(0, clock.now() - startedAt);

export const invokeBeforeDeadline = async <Value>(
  clock: RuntimeClock,
  deadlineAt: number,
  invoke: (signal: AbortSignal) => Promise<Value>,
): Promise<DeadlineOutcome<Value>> => {
  const startedAt = clock.now();
  const controller = new AbortController();
  const invocation = Promise.resolve()
    .then(async () => await invoke(controller.signal))
    .then<DeadlineOutcome<Value>, DeadlineOutcome<Value>>(
      (value) => ({ status: "returned", value, measuredElapsedMs: elapsedSince(clock, startedAt) }),
      () => ({ status: "threw", measuredElapsedMs: elapsedSince(clock, startedAt) }),
    );

  let cancelDeadline = (): void => {};
  const deadline = new Promise<DeadlineOutcome<Value>>((resolve) => {
    cancelDeadline = clock.schedule(Math.max(0, deadlineAt - clock.now()), () => {
      resolve({
        status: "deadline_exceeded",
        measuredElapsedMs: elapsedSince(clock, startedAt),
      });
      controller.abort();
    });
  });

  const outcome = await Promise.race([invocation, deadline]);
  cancelDeadline();
  return outcome;
};
