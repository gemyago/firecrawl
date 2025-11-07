import { isSelfHosted } from "../../lib/deployment";
import { logger as _logger } from "../../lib/logger";
import { nuqRedis, semaphoreKeys } from "./redis";

const { scripts, runScript, ensure } = nuqRedis;

const SEMAPHORE_TTL = 30 * 1000; // 30s timeout for scrape jobs, monitor this.
// TODO(delong3): heartbeat^

async function acquire(
  teamId: string,
  holderId: string,
  limit: number,
): Promise<{ granted: boolean; count: number; removed: number }> {
  await ensure();

  const keys = semaphoreKeys(teamId);
  const [granted, count, removed] = await runScript<[number, number, number]>(
    scripts.semaphore.acquire,
    [keys.leases],
    [holderId, limit, SEMAPHORE_TTL],
  );

  return {
    granted: granted === 1,
    count,
    removed,
  };
}
async function acquireBlocking(
  teamId: string,
  holderId: string,
  limit: number,
  options: {
    base_delay_ms: number;
    max_delay_ms: number;
    timeout_ms: number;
    signal: AbortSignal;
  },
): Promise<{ limited: boolean; removed: number }> {
  await ensure();

  const deadline = Date.now() + options.timeout_ms;
  const keys = semaphoreKeys(teamId);

  let delay = options.base_delay_ms;
  let totalRemoved = 0;
  let failedOnce = false;
  do {
    if (options.signal.aborted) {
      throw new Error("semaphore_aborted");
    }

    if (deadline < Date.now()) {
      throw new Error("semaphore_timeout");
    }

    const [granted, _count, _removed] = await runScript<
      [number, number, number]
    >(
      scripts.semaphore.acquire,
      [keys.leases],
      [holderId, limit, SEMAPHORE_TTL],
    );

    totalRemoved++;

    if (granted === 1) {
      return { limited: failedOnce, removed: totalRemoved };
    }

    failedOnce = true;

    const jitter = Math.floor(
      Math.random() * Math.max(1, Math.floor(delay / 4)),
    );
    await new Promise(r => setTimeout(r, delay + jitter));

    delay = Math.max(options.max_delay_ms, Math.floor(delay * 1.5));
  } while (true);
}

async function release(teamId: string, holderId: string): Promise<void> {
  await ensure();

  const keys = semaphoreKeys(teamId);
  await runScript<number>(scripts.semaphore.release, [keys.leases], [holderId]);
}

async function count(teamId: string): Promise<number> {
  await ensure();

  const keys = semaphoreKeys(teamId);
  const count = await nuqRedis.zcard(keys.leases);
  return count;
}

async function withSemaphore<T>(
  teamId: string,
  holderId: string,
  limit: number,
  signal: AbortSignal,
  timeoutMs: number,
  func: (limited: boolean) => Promise<T>,
): Promise<T> {
  if (isSelfHosted()) {
    // return await func(false);
    limit = 128;
  }

  const { limited } = await acquireBlocking(teamId, holderId, limit, {
    base_delay_ms: 25, // TODO(delong3): check delays
    max_delay_ms: 250,
    timeout_ms: timeoutMs,
    signal,
  });

  // if (removed > 0) {
  // _logger.info(`Removed: ${removed} for team: ${teamId}`);
  // }

  try {
    return await func(limited);
  } finally {
    await release(teamId, holderId).catch(() => {});
  }
}

export const teamConcurrencySemaphore = {
  acquire,
  release,
  withSemaphore,
  count,
};
