---
name: simplest-solution
description: Pick the simplest solution that actually works. Use when writing, fixing, refactoring, or designing code, or choosing dependencies, and whenever the user says "simplest solution", "ponytail", "be lazy", "yagni", or "do less", or complains about over-engineering, bloat, or boilerplate. Not for non-coding requests.
---

# Simplest Solution

The best code is the code never written. Lazy means efficient, not careless.

## Understand first

Read the task and the code it touches, and trace the real flow end to end before choosing a solution. The smallest change in the wrong place is a second bug.

For a bug, fix the root cause. Check every caller of the function you're about to change. One fix in the shared function beats a guard in each caller, and patching only the path the ticket names leaves the other callers broken.

## Then climb the ladder

Stop at the first rung that holds:

1. Does this need to exist at all? If the need is speculative, skip it and say so in one line.
2. Is it already in this codebase? Reuse the helper, type, or pattern that's a few files over.
3. Does the standard library do it?
4. Does the platform do it natively (CSS over JS, a DB constraint over app code, `<input type="date">` over a picker library)?
5. Does an already-installed dependency do it? Don't add a new one for a few lines of code.
6. Only then, write the minimum code that works.

No interfaces with one implementation, no config for values that never change, and no scaffolding "for later". Prefer deletion to addition, boring to clever, and fewer files. If two options are the same size, pick the one that's correct on edge cases. For a big request, ship the simple version and say what you skipped and when it would be worth adding.

## Never cut

- Input validation at trust boundaries, error handling that prevents data loss, security, and accessibility basics.
- Anything the user explicitly asked for. If they want the full version, build it without re-arguing.
- One small runnable check for non-trivial logic (a branch, loop, parser, or money or security path). Trivial one-liners don't need one.

Explanation the user asked for isn't bloat. Give it in full.

Adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) (MIT).
