---
name: feature-flag-removal
description: >
  Remove feature flag conditional checks from the github/github codebase after a flag has been
  fully rolled out. Accepts one or more feature flag names, searches the entire codebase for all
  usages, and removes the conditional branching — keeping the "enabled" code path and deleting the
  "disabled" path. Also cleans up test helpers (enable_feature_flag / disable_feature_flag calls),
  flag definitions in seed and config files, and memoized predicates. Use this skill whenever the
  user asks to remove a feature flag, clean up a feature flag, delete a feature flag, unflag code,
  deflag, do flag removal, do feature flag cleanup, remove flag gating, sunset a feature flag,
  retire a feature flag, or graduate a feature flag. Also use when the user says "the flag is fully
  rolled out", "clean up old flags", "remove dead flags", "this flag is 100%", or wants to simplify
  code by removing flag checks that are always true.
---

# Feature Flag Removal

Remove feature flag conditionals from the codebase after a successful rollout.
Validate first that the flag is fully enabled in all environments, then keep the
"enabled" code path and delete the "disabled" path.

## Step 0 — Validate input

The user must provide at least one feature flag name. If they haven't, **stop
immediately** and ask:

> "Which feature flag(s) do you want to remove? Please provide at least one
> flag name (e.g., `:my_flag_name`)."

Do not proceed until you have at least one flag name.

**Normalize** each flag name the user provides:
- Strip a leading `:` if present (`:my_flag` → `my_flag`).
- The canonical form is the bare name (`my_flag`). When searching, look for both
  the symbol form (`:my_flag`) and the string form (`"my_flag"`).

## Step 1 — Validate rollout in DevPortal (mandatory)

Before editing code, verify each flag is fully enabled in all environments.
Use the `web-browser` skill for this check (do not create a new CLI unless the
user explicitly asks for one).

For each normalized flag name (for example, `my_flag`):

1. Open `https://devportal.githubapp.com/feature-flags/my_flag/overview`.
2. Confirm every environment listed on the page is fully enabled (`100%`,
   `Enabled`, or equivalent fully-on state).
3. Capture evidence for your final summary (URL + statuses observed).

If any environment is not fully enabled, stop and tell the user flag removal
cannot proceed yet.

If you cannot access the page or the status is unclear, stop and ask the user
for explicit confirmation before proceeding.

## Step 2 — Search the codebase

For each flag, search the **entire repository** for all occurrences. Cast a wide
net — the same flag can appear in production code, tests, config, seeds, and ERB
templates.

Run these searches for each flag (replacing `my_flag` with the actual name):

```bash
rg -n --hidden --glob '!.git' ':my_flag'      # symbol form
rg -n --hidden --glob '!.git' '"my_flag"'     # string literal
rg -n --hidden --glob '!.git' '\bmy_flag\b'   # bare token in YAML/data/docs
```

Collect every file path and line number. Group results by file for efficient
processing — you'll read each file once and apply all transformations for that
file together.

If all searches return zero results for all flags:
- Treat this as a valid no-op cleanup.
- Do not edit code.
- Summarize evidence (DevPortal fully enabled + zero code matches) and suggest
  resolving the lifecycle issue or removing the flag from registration systems.

## Step 3 — Categorize and plan each transformation

For additional concrete before/after examples, read
`references/patterns.md`.

Read each file with flag references and classify every occurrence into one of
the transformation types below. This classification step is important — don't
skip straight to editing. Understanding the pattern first prevents mistakes.

### Transformation types

**Throughout this section, "flag check" means any expression that evaluates
whether the feature flag is enabled, such as
`actor.feature_flag_enabled?(:flag, default: false)` or
`FeatureFlag.vexi.enabled?(:flag, actor, default: false)`.**

---

#### T1: Simple if/else

The most common pattern. The `if` branch is the enabled path; the `else` branch
is the disabled path.

```ruby
# Before
if actor.feature_flag_enabled?(:my_flag, default: false)
  new_behavior
else
  old_behavior
end

# After — keep the if-body, remove the conditional wrapper and else
new_behavior
```

When unwrapping, **dedent** the kept code by one level to match the surrounding
indentation.

If the `if/else` is the entire body of a method, keep the method definition and
just replace its body with the unwrapped enabled-path code.

---

#### T2: Simple if (no else)

```ruby
# Before
if actor.feature_flag_enabled?(:my_flag, default: false)
  do_something
end

# After — keep the body, remove the conditional wrapper
do_something
```

---

#### T3: Guard clause — return unless

The flag check acts as a gate. Since the flag is now always enabled, the guard
always passes and the line is dead code.

```ruby
# Before
return unless actor.feature_flag_enabled?(:my_flag, default: false)

# After — delete the entire line
```

---

#### T4: Guard clause — return if / next if / break if

When the flag check is in a positive guard (`return if flag_enabled?`), the flag
being always-on means the guard always fires.

```ruby
# Before
return if actor.feature_flag_enabled?(:my_flag, default: false)

# After — the condition is always true, so simplify to unconditional:
return
```

If there is code after the guard that would now be unreachable, flag it for the
user's review — the method's behavior is changing in a way that deserves
attention.

---

#### T5: Unless block

`unless flag_enabled?` means "when the flag is OFF". Since the flag is now
always on, this block never executes.

```ruby
# Before
unless actor.feature_flag_enabled?(:my_flag, default: false)
  old_behavior
else
  new_behavior
end

# After — keep the else body (the enabled path), remove the rest
new_behavior
```

If there's no `else`, delete the entire `unless...end` block.

---

#### T6: Ternary

```ruby
# Before
value = actor.feature_flag_enabled?(:my_flag, default: false) ? new_val : old_val

# After
value = new_val
```

---

#### T7: Compound condition (&&, ||)

The flag check is part of a larger boolean expression. Replace the flag check
with its resolved value (`true`, since the flag is always enabled) and simplify.

```ruby
# Before
if actor.feature_flag_enabled?(:my_flag, default: false) && other_condition
  do_something
end

# After — true && other_condition simplifies to other_condition
if other_condition
  do_something
end
```

```ruby
# Before
if actor.feature_flag_enabled?(:my_flag, default: false) || other_condition
  do_something
end

# After — true || other_condition is always true; unwrap the conditional
do_something
```

Be careful with operator precedence when the flag check is nested deeper in the
expression. When in doubt, simplify conservatively and leave a comment for the
user.

---

#### T8: Negated flag check

```ruby
# Before
if !actor.feature_flag_enabled?(:my_flag, default: false)
  old_behavior
end

# After — !true is false, block never executes; delete the entire block
```

---

#### T9: ERB conditionals

Same logic as Ruby, but wrapped in ERB tags.

```erb
<%# Before %>
<% if actor.feature_flag_enabled?(:my_flag, default: false) %>
  <div>new UI</div>
<% else %>
  <div>old UI</div>
<% end %>

<%# After %>
<div>new UI</div>
```

---

#### T10: Test helper calls

`enable_feature_flag(:my_flag)` and `enable_feature_flag(:my_flag, actor)` are
no longer needed because the flag is always on. Delete these lines.

`disable_feature_flag(:my_flag)` and `disable_feature_flag(:my_flag, actor)`
are also deleted. However, if the surrounding test method is **specifically
testing the disabled behavior** (check the test name and assertions), flag the
entire test for user review — it may need to be deleted or rewritten.

Indicators that a test is "disabled-path only":
- Test name contains "without feature", "feature disabled", "flag off", or
  similar phrasing.
- The test calls `disable_feature_flag` and then asserts on the old behavior.
- The test has no other meaningful assertions beyond the flag-disabled path.

---

#### T11: Flag definitions

Remove the flag from registration/definition files. Look in:
- `script/seeds/` — feature flag seed data
- `config/` — feature flag configuration
- Data files that list available flags

---

#### T12: Memoized predicates

Methods that exist solely to cache a flag check:

```ruby
# Before
def my_flag_enabled?
  return @my_flag_enabled if defined?(@my_flag_enabled)
  @my_flag_enabled = feature_flag_enabled?(:my_flag, default: false)
end

# After — always returns true; simplify
def my_flag_enabled?
  true
end
```

**However**, if this method is called from many places, consider whether the
callers should be updated too (removing the `if my_flag_enabled?` checks). Flag
this for user review with a list of call sites.

---

#### T13: Flag used as data

Sometimes flags appear in hashes, arrays, or data structures — not as
conditionals but as metadata (e.g., cache keys, snapshots, logging).

```ruby
ff_snapshot: {
  my_flag: actor.feature_flag_enabled?(:my_flag, default: false),
}
```

These are **ambiguous** — the right transformation depends on how the data is
consumed downstream. **Do not auto-transform.** Instead, present each occurrence
to the user with surrounding context and ask how they'd like to handle it.

---

#### T14: Complex / ambiguous

Anything that doesn't fit neatly into the categories above. Present to the user
with the file path, line number, and surrounding code context. Ask how they'd
like to handle it.

## Step 4 — Apply changes file by file

Process files one at a time. For each file:

1. **Read the full file** to understand its structure and indentation style.
2. **Apply all transformations** for flags in that file, working from bottom to
   top (so line numbers don't shift as you edit earlier in the file).
3. **Dedent properly** — when removing a conditional wrapper (if/else/end),
   dedent the kept block by one indentation level to match the surrounding code.
4. **Remove blank line clusters** — if removing code leaves multiple consecutive
   blank lines, collapse them to a single blank line.
5. **Preserve the file's style** — don't reformat code beyond what's needed for
   the flag removal.

## Step 5 — Clean up tests

After processing production code, handle test files:

1. Remove all `enable_feature_flag(:my_flag, ...)` lines.
2. Remove all `disable_feature_flag(:my_flag, ...)` lines.
3. If removing a helper call leaves an empty `setup` block or `fixtures` block,
   remove the empty block too.
4. **Flag for user review** any test method that:
   - Was specifically testing disabled-flag behavior (see T10 above).
   - Has a name referencing the flag (e.g., `test "with my_flag enabled"`).
   - Becomes empty or trivial after removing the flag helper calls.

## Step 6 — Clean up flag definitions

Search for and remove the flag from definition/registration files:

- Seed files in `script/seeds/`
- Feature flag YAML/config files
- Any file that registers the flag name as a known flag

## Step 7 — Validate

Run validation on all modified files:

```bash
# Auto-fix lint issues on all changed files
bin/rubocop -a <list of changed files>

# Find and run relevant tests
bin/rails test_oracle

# Type-check modified files
bin/srb tc <list of changed files>
```

Fix any failures. Common issues after flag removal:
- **Indentation errors** from unwrapping conditionals — RuboCop will usually
  catch these.
- **Unused variables** that were only referenced in the deleted branch.
- **Unreachable code** after unconditional returns (from T4 transformations).
- **Missing method errors** if a method was only defined/called in the deleted
  branch.

## Step 8 — Summarize

After all changes are applied and validated, provide:

1. **Flags removed**: List each flag name.
2. **Files modified**: For each file, a one-line description of what changed
   (e.g., "Unwrapped if/else in `#show` method, kept enabled path").
3. **Items for review**: Any T13/T14 occurrences or flagged test methods that
   need the user's attention, with file paths and context.
4. **Test results**: Whether tests passed and any issues found.
5. **No-op outcome** (if applicable): Explicitly state when no code references
   were found and no files were changed.

## Limitations

- This skill assumes the flag was **successful** (the enabled path is correct)
  and should only run after Step 1 confirms full rollout in DevPortal.
  If the flag was a failed experiment and you want to keep the disabled path
  instead, this skill is not the right tool — you'd need to invert the logic
  manually.
- Flags used dynamically (e.g., flag names constructed from variables at runtime)
  cannot be detected or cleaned up automatically. Grep for the flag name string
  to catch these, but some may require manual investigation.
- Class-level declarations that were added behind a flag (e.g., a `has_many` that
  only exists because of the feature) are kept in place since they can't be
  conditionally removed at runtime. Verify these are still desired.
