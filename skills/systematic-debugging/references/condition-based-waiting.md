# Condition-Based Waiting

Flaky tests often come from time guesses (`sleep 1`, `setTimeout(500)`).
Wait for the condition you care about instead.

## Rule

- Prefer **condition polling with timeout** over arbitrary delays.
- Use fixed delays only when testing timing behavior itself (debounce/throttle/TTL), and document why.

## Before vs after

```ts
// ❌ Timing guess
await new Promise((r) => setTimeout(r, 200));
expect(job.state).toBe("done");

// ✅ Condition wait
await waitFor(() => job.state === "done", "job completion", 5000);
```

## Generic helper (TypeScript)

```ts
export async function waitFor(
  condition: () => boolean,
  description: string,
  timeoutMs = 5000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();

  while (true) {
    if (condition()) return;

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
```

## Shell helper (bash)

```bash
wait_for() {
  local timeout_s="$1"
  local interval_s="$2"
  local description="$3"
  shift 3

  local start
  start=$(date +%s)

  while true; do
    if "$@"; then
      return 0
    fi

    local now
    now=$(date +%s)
    if (( now - start >= timeout_s )); then
      echo "Timeout waiting for ${description}" >&2
      return 1
    fi

    sleep "$interval_s"
  done
}
```

Usage:

```bash
wait_for 30 0.2 "server health endpoint" curl -fsS http://localhost:3000/healthz
```

## Common mistakes

- Polling with no timeout (infinite wait)
- Polling stale cached state instead of fresh reads
- Polling too aggressively (wastes CPU)
- Using long sleeps that hide race conditions
