const TERMINAL_STATUSES = new Set(["completed", "failed"]);

export function createJobPoller({ fetchJob, onUpdate, onError, intervalMs = 650, setTimeoutFn = globalThis.setTimeout, clearTimeoutFn = globalThis.clearTimeout }) {
  let active = false;
  let generation = 0;
  let timeoutId = null;

  const stop = () => {
    active = false;
    generation += 1;
    if (timeoutId !== null) clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  const start = () => {
    stop();
    active = true;
    const currentGeneration = ++generation;
    const isCurrent = () => active && generation === currentGeneration;

    const poll = async () => {
      try {
        const job = await fetchJob();
        if (!isCurrent()) return;
        onUpdate(job);
        if (!isCurrent() || TERMINAL_STATUSES.has(job.status)) {
          if (isCurrent()) {
            active = false;
            timeoutId = null;
          }
          return;
        }
      } catch (error) {
        if (!isCurrent()) return;
        onError?.(error);
        if (isCurrent()) {
          active = false;
          timeoutId = null;
        }
        return;
      }

      if (isCurrent()) timeoutId = setTimeoutFn(poll, intervalMs);
    };

    poll();
  };

  return { start, stop };
}
