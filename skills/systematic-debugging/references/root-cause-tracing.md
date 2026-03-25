# Root Cause Tracing

Fix where bad state starts, not where it explodes.

## When to use

Use this technique when the error appears deep in the stack and the failing line is likely a symptom.

Examples:
- `cwd` is wrong inside a helper function
- `nil`/`undefined` appears late in a call chain
- wrong config value reaches runtime code from CI/workflow/env

## Backward tracing loop

1. Capture the symptom precisely (error text, file/line, inputs at failure).
2. Find the immediate failing statement.
3. Ask: who called this and what inputs were passed?
4. Move one frame up and repeat.
5. Stop only when you find the first invalid input/state transition.
6. Fix at that origin point, then add guardrails on downstream layers.

If you cannot move one frame up with confidence, add instrumentation and rerun.

## Instrumentation at boundaries

Add short, structured logs right before risky operations.

### Bash/example script boundary

```bash
echo "DEBUG_RCA layer=build env_identity=${IDENTITY:+set}${IDENTITY:-unset}" >&2
echo "DEBUG_RCA layer=build pwd=$(pwd)" >&2
```

### TypeScript/Node boundary

```ts
console.error("DEBUG_RCA", {
  layer: "workspace-init",
  projectDir,
  cwd: process.cwd(),
  stack: new Error().stack,
});
```

### Ruby boundary

```ruby
warn({
  tag: "DEBUG_RCA",
  layer: "job-perform",
  args: arguments,
  backtrace: caller.take(10),
}.to_json)
```

## Multi-component systems checklist

For each handoff (CI → script, script → app, app → DB/API):

- Log what entered the component
- Log what left the component
- Confirm required env/config is present
- Confirm invariants (non-empty path, valid ID, expected enum/state)

Run once, then locate the first boundary where data diverges.

## Dotfiles-oriented example

Symptom: installer fails late with "command not found".

Tracing path:
1. failure at `run_step` invocation
2. called from tool-specific `install`
3. command expected from a previous setup step
4. previous step skipped due to incorrect platform check

Root cause: guard condition excluded the current platform unexpectedly.

Fix: correct platform detection at the origin check, then add validation that expected commands exist before later steps run.

## Validation after root-cause fix

After fixing source:
1. rerun failing repro
2. rerun nearest dependent flows
3. remove temporary noisy instrumentation (or downgrade to debug logs)
4. keep durable assertions/guards that prevent recurrence
