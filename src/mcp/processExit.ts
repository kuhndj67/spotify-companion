/**
 * Wait until a child process has really gone (P-49, probe P-U7-2). 🔌 IMPURE
 *
 * Probe P-U7-2 (2026-10-08) measured that the MCP server's child exits **~2 s after** `client.close()` returns —
 * the SDK waits before forcing it. Writing the credentials file inside that window would let the old server,
 * still mid-refresh, overwrite the new credentials with the old ones (FD §2: read → network → write whole
 * object). So "closed" means *the process is gone*, not *close() returned*.
 */

/** Bounded: P-U7-2 measured ~2 s; anything past this is a fault to report, never something to write through. */
export const PROCESS_EXIT_TIMEOUT_MS = 6_000;

/** Signal 0 tests for existence without sending anything. `ESRCH` means gone; `EPERM` means it exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function waitForProcessExit(pid: number, timeoutMs = PROCESS_EXIT_TIMEOUT_MS, pollMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`process ${pid} was still running ${timeoutMs} ms after close`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
