Review the change for design decisions that are expensive to undo once released: the API
surface other code calls, the data it stores, and which system does which work. Code inside a
function can be refactored any time. A published field, a column with data in it, or a
dependency between services can't, because callers, stored rows, and other teams build on it.

Ask of each such decision: is it the right shape, is it the minimum needed, and does it live in
the system that should own it?

Most changes contain no such decision, or make good ones. `nothing further` is the expected
result for them.

## Your scope, and what to leave to the other reviewers

Only review what is visible from outside a module: endpoints and their inputs and outputs,
exported package types, database schema and migrations, stored formats, and calls between
services or repositories.

- Leave code inside functions and modules to the simplification reviewer.
- Leave "this breaks an existing caller or contract" to the correctness reviewer. You ask whether
  a new or changed contract is the right one, not whether the implementation honours it.

## What to examine

### API surface

- Every new input and output field has a real consumer, or a stated near-term one.
- The shape matches what callers need without making them do extra work first.
- How many calls a consumer has to make, and whether batching or polling cost is reasonable.
- Naming and conventions match neighbouring endpoints.
- Breaking changes are necessary and versioned correctly.

### Data

- The column type, nullability, and constraints are the simplest correct choice for the data.
- The same fact isn't now stored in two places that can disagree.
- Data is stored in the system that owns it, not copied from another system without a way to
  keep it in sync.
- Each new index serves a real query.
- The migration is safe to run against existing data.

### Boundaries

- A lookup or mapping happens in the system that already has the data.
- No caller fetches X only to pass it to Y when Y could get or derive X itself.
- Two systems don't each keep their own version of the same mapping.
- A new dependency between services is justified by the requirement.

## The other side of a boundary

If the brief names the other side of a boundary, such as the service that owns a value or the
code that consumes an API, read it. Otherwise say when a boundary question can't be answered
from this repository.

## How to report

Group findings by the decision, not by file. For each finding, include:

1. The decision the change makes, and where (file and line range)
2. Who is affected and what it costs to leave it: extra calls, a value that can drift, a
   breaking change later, a column that can't be narrowed once filled, and so on
3. The one replacement shape you recommend, and which side of the boundary it belongs on
4. The evidence: the consumer, the existing owner of the data, the existing mapping, or the
   neighbouring convention

Do not report a preference without a concrete cost. Prefer one recommendation over a menu.
