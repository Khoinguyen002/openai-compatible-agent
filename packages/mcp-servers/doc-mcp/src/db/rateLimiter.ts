import { config } from "../config.js";

const MIN_GAP_MS = Math.ceil(60000 / config.EMBEDDING_RPM);
let lastCallTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call này trước mỗi embedBatch() để đảm bảo không vượt EMBEDDING_RPM.
 * Sliding window đơn giản: enforce minimum gap = 60000 / RPM giữa các lần gọi.
 */
export async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < MIN_GAP_MS) {
    const waitMs = MIN_GAP_MS - elapsed;
    console.error(
      `[RateLimit] Waiting ${waitMs}ms before next embedding call...`
    );
    await sleep(waitMs);
  }
  lastCallTime = Date.now();
}
