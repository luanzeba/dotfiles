# Defense in Depth

After identifying root cause, make recurrence hard by validating at multiple layers.

## Why

A single check is easy to bypass through a different code path, refactor, or test setup.
Multiple small checks turn one fragile fix into a stable system property.

## Four practical layers

1. **Entry validation**
   - Reject invalid input early at boundaries (CLI args, API params, function entry points).
2. **Business invariants**
   - Validate assumptions inside domain logic (state machine transitions, required IDs, non-empty paths).
3. **Environment guards**
   - Protect dangerous operations in sensitive contexts (tests, CI, production).
4. **Observability**
   - Add structured debug info near risky operations for future forensics.

## Minimal examples

### 1) Entry validation

```ts
if (!workingDirectory?.trim()) {
  throw new Error("workingDirectory is required");
}
```

### 2) Business invariant

```ruby
raise "session_id required" if session_id.blank?
```

### 3) Environment guard

```bash
if [[ "${NODE_ENV:-}" == "test" && "$target" != /tmp/* ]]; then
  echo "Refusing dangerous write outside /tmp in test mode" >&2
  exit 1
fi
```

### 4) Observability

```ts
console.error("DEBUG_RCA", { op: "git-init", cwd: process.cwd(), projectDir });
```

## Rollout pattern

1. Keep the root-cause fix small.
2. Add the minimum extra guards at layers directly touched by that failure.
3. Verify both:
   - the original repro now passes
   - invalid input now fails earlier with clear messages

## Avoid

- Huge refactors bundled with bug fix
- Silent fallback behavior that hides invalid state
- Adding logs without actionable fields (always include IDs/paths/state)
