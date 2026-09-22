Review the change for behavior that is incorrect, unsafe, or inconsistent with its stated
intent. Do not spend this review on optional cleanup, style preferences, or ways to make working
code shorter.

Review every changed area and follow the affected behavior far enough to establish real impact.
Report issues that the author would reasonably fix if they knew about them, including:

- Incorrect results or behavior under reachable inputs
- Regressions in existing callers or workflows
- Validation that became weaker or silently coerces invalid input
- Broken API, schema, serialization, compatibility, or type contracts
- Authentication, authorization, tenant-isolation, or other security mistakes
- Data loss, destructive behavior, races, leaks, missing back pressure, or operational hazards
- Error handling that hides a real failure or reports success after failure
- Tests that pass while failing to exercise the changed behavior they claim to cover

Do not report unrelated pre-existing bugs. Do not rely on vague speculation that something
else might break: identify the reachable scenario and the affected code. Read related callers,
types, tests, and dependency behavior when needed to verify that connection.

## How to report

Group findings by the changed file and shortest useful line range. For each finding, include:

1. The reachable scenario that triggers the problem
2. What the code does and what it should do instead
3. The concrete impact
4. The evidence that connects the changed code to that impact

Use these priorities in the title:

- `[P0]` release- or operations-blocking in essentially every use
- `[P1]` urgent and likely to affect important real use
- `[P2]` a normal defect worth fixing
- `[P3]` a low-impact but still concrete defect
