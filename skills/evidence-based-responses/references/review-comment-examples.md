# Review Comment Examples

These examples show how to turn a correct observation into feedback the author can understand and apply.

## Be explicit about the requested change

**Too vague:**

> These states only differ by color. Could we add another cue?

**Better:**

> Faulted and Offline use the same pin shape and center icon, so color is the only way to distinguish them. Could we keep the current red and orange colors, but replace the bolt inside Faulted pins with an exclamation mark? Offline can keep the bolt. That gives users a second way to tell the states apart without redesigning the map.
>
> ```ts
> const glyphPath =
>   status === 'Faulted' ? FAULT_EXCLAMATION_PATH : BOLT_PATH;
> ```

The better version says what remains unchanged, what changes, and what the result should look like.

## Explain the idea before naming it

**Too compressed:**

> This should be a local semantic token instead of promoting the orange palette.

**Better:**

> `Offline` is the state we care about. Orange is only the color currently used to draw attention to it. Using names such as `variant="orange"` tells readers what the UI looks like, but not why that style is used. Could we keep this styling in the app and call it `attention` instead? The badge can still display `Offline`, while the style name explains its purpose.
>
> ```ts
> attention: 'bg-attention text-attention-foreground'
> ```

The better version does not require the author to understand design-system vocabulary before evaluating the suggestion.

## Include the expected code shape

**Too terse:**

> We should reuse the existing badge component here.

**Better:**

> This recreates the same tooltip and badge markup that `StatusBadge` already owns. The only special case here is the actionable error badge, so could we keep that branch and use the shared status badge for everything else?
>
> ```tsx
> {showErrorDetails ? (
>   <ErrorBadge error={error} />
> ) : (
>   <StatusBadge item={item} />
> )}
> ```

The code does not need to be complete. It needs to make the requested structure unambiguous.

## Focus on the current problem

**Too speculative:**

> We may add several more states later, so this architecture will not scale.

**Better:**

> The filter currently decides whether an item is Offline by checking its color. Changing the color we use to represent Offline shouldn't affect the filter. Could we store the status separately and use color only when rendering it?
>
> ```ts
> properties: {
>   effectiveStatus: status,
>   pinColor: statusToPinColor(status),
> }
> ```

A likely future change can support the concern, but the comment should stand on a problem visible now.

## Replace nested logic with the smallest readable helper

**Too general:**

> This conditional is hard to read. Can we make it more composable?

**Better:**

> This nested conditional is difficult to verify because active state, item type, and count are mixed together. A small local helper with `if` statements would make it easier to read and modify in the future.
>
> ```ts
> function getBadgeClass(type: Type, active: boolean, count: number) {
>   if (count > 0 && type === 'error') {
>     return active ? ACTIVE_ERROR : INACTIVE_ERROR;
>   }
>   if (count > 0 && type === 'warning') {
>     return active ? ACTIVE_WARNING : INACTIVE_WARNING;
>   }
>   return active ? ACTIVE_DEFAULT : INACTIVE_DEFAULT;
> }
> ```

This recommends the simplest sufficient abstraction and shows its boundary.
