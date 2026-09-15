# Foundation and opt-in change example

Use this pattern when an MR adds shared capability but deliberately does not enable it for a real consumer. The description must make the distinction obvious. Do not use a passing test or pre-existing endpoint as the primary explanation or demo.

A good description answers:

1. What worked before?
2. What new path or mechanism was added?
3. Does it reuse existing business logic?
4. What turns it on?
5. Which consumer has not turned it on yet?
6. Why is activation separate, and what is the tradeoff?

## Example

Before this MR, Parts had:

- An OpenAPI document at `/openapi.json`
- A working oRPC API at `/orpc/*`
- No server listening at `/api/v1/*`

The OpenAPI document described the contract, but a document does not create callable routes by itself.

This MR adds an optional second "translator" to `@beta/server-app`:

```text
                             ┌── RPC translator ─────── /orpc/*
Client ── HTTP request ──────┤
                             └── OpenAPI translator ─── /api/v1/*
                                    ↑
                              new in this MR
```

Both translators call the same business logic:

```text
/orpc/inventory/listPartFilterOptions ───┐
                                         ├── inventory.listPartFilterOptions()
/api/v1/inventory/listPartFilterOptions ─┘
```

The new translator is turned on with one configuration line:

```ts
openapi: {
  prefix: '/api/v1', // new switch
  contract: partsContract,
  info: { /* ... */ },
}
```

Parts does not include that line yet. As committed, `/openapi.json` and `/orpc/*` continue to work, while `/api/v1/*` still returns `404`.

Keeping activation separate makes the shared transport change easier to review and roll back without also publishing a new service API. The tradeoff is that the foundation MR has no new service-visible behavior. Say what the pilot must ship with the switch, such as public routing, an accurate authentication description, client migration, and deployed smoke tests.
