import { childLogger } from "../logger.js";

const log = childLogger({ module: 'sessionQueue' });

/**
 * Per-session serialization queue.
 *
 * Guarantees that jobs for the same session execute strictly sequentially,
 * preventing race conditions when a user sends multiple rapid messages.
 * Each new job is chained onto the tail of the previous promise for that
 * session. The chain is removed once it goes idle to avoid memory leaks.
 *
 * For multi-instance deployments, replace the in-process Map with a
 * Redis-backed queue (e.g., BullMQ) using the same enqueue interface.
 */
export class SessionQueue {
  private readonly chains = new Map<string, Promise<void>>();

  enqueue(sessionId: string, job: () => Promise<void>): void {
    const prev = this.chains.get(sessionId) ?? Promise.resolve();

    const next = prev
      .then(job)
      .catch(err => {
        log.error({ sessionId, err }, 'agent job failed');
      });

    this.chains.set(sessionId, next);

    next.finally(() => {
      // Only delete if this is still the tail — a new job may have been
      // enqueued while we were running, in which case we must not delete.
      if (this.chains.get(sessionId) === next) {
        this.chains.delete(sessionId);
      }
    });
  }

  get activeSessions(): number {
    return this.chains.size;
  }
}

export const sessionQueue = new SessionQueue();
