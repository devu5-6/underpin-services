# Bug Report — Task API

**Scope:** `src/`, as committed at the start of the assignment
**Method:** Behaviour-driven — the suite was written against the API contract
documented in `README.md` and `ASSIGNMENT.md`, then run. None of the issues below
were found by reading the code first; each one surfaced as a failing or
suspiciously-passing test.
**Status:** 1 of 4 fixed (Bug #1), per the brief's instruction to fix a single bug.
The remaining three are left in place, with the source annotated in-line via
`KNOWN BUG #n` comments, and each carries a regression test that documents the
current behaviour. The suite is 73 tests in total, all passing.

## Summary

| # | Severity | Component | Issue | Status |
|---|----------|-----------|-------|--------|
| 1 | **Critical** | `taskService.getPaginated` | Pagination off by one page on every request | **Fixed** |
| 2 | High | `taskService.getByStatus` | Substring match on a closed enum; unknown statuses return `200 []` | Open |
| 3 | High | `taskService.completeTask` | Completing a task silently resets `priority` to `medium` | Open |
| 4 | High | `taskService.update` + `PUT` route | Clients can overwrite server-owned fields, including `id` | Open |

Severity is assessed by blast radius: **Critical** = silently returns wrong data
to every caller; **High** = silently corrupts stored data or returns incorrect
results for a subset of inputs.

---

## Bug #1 — Pagination is off by one page *(Fixed)*

**Severity:** Critical
**Location:** `src/services/taskService.js:22` — `getPaginated()`

### Expected behaviour

`GET /tasks?page=1&limit=10` returns the **first** ten tasks. `page` is 1-based
from the client's perspective: the route layer defaults it to `1`
(`src/routes/tasks.js:22`), and `?page=1` reads as the first page of results.

### Actual behaviour

The offset was computed as `offset = page * limit`, treating the 1-based page
number as a 0-based row offset. The consequences were:

- `?page=1` skipped the first `limit` items and returned page two.
- `?page=2` returned what the caller believed to be page one — every subsequent
  page was shifted by one.
- The final page was always empty, because the offset overran the collection.

No paginated request through this endpoint returned the rows its URL implied.

### How it was discovered

A route test (`tests/tasks.routes.test.js:83`) created twelve tasks and asserted
that `GET /tasks?page=1&limit=10` returns ten items. It returned two.

### Fix applied

```js
// src/services/taskService.js
const safePage  = Math.max(Number(page)  || 1,  1);
const safeLimit = Math.max(Number(limit) || 10, 1);
const offset    = (safePage - 1) * safeLimit;
return tasks.slice(offset, offset + safeLimit).map((t) => ({ ...t }));
```

The clamp is retained so out-of-range input (`page=0`, negative values,
non-numeric strings) degrades to the first page rather than producing a negative
offset. The three `BUG: ...` tests covering pagination were rewritten to assert
the correct contract and now pass; `tests/taskService.test.js` additionally
covers page two, a partial last page, and reading past the end.

---

## Bug #2 — Status filtering performs substring matching

**Severity:** High
**Location:** `src/services/taskService.js:16` — `getByStatus()`

### Expected behaviour

`?status=` matches against a closed set of known statuses (`todo`, `in_progress`,
`done`) by exact equality. An unknown value should be rejected with `400` rather
than silently treated as a filter that happens to match nothing.

### Actual behaviour

```js
tasks.filter((t) => t.status.includes(status))
```

`String.prototype.includes` is a substring test, not an equality test. Two
distinct failures follow:

1. **Over-matching.** `?status=o` returns every task whose status contains the
   character `o` — both `todo` and `in_progress`. Any single-character or short
   fragment query silently widens the result set instead of narrowing it.
2. **Silent acceptance of invalid input.** `?status=xyz` returns `200 []`. A
   caller typo — `in progress` for `in_progress`, or the README's documented
   `pending` / `in-progress` / `completed` spelling — is indistinguishable from a
   legitimate "no matches" and produces no error to debug against.

### How it was discovered

A unit test (`tests/taskService.test.js:87`) created one `todo` and one
`in_progress` task and queried status `"o"`. Both were returned. The route-level
test at `tests/tasks.routes.test.js:51` covers the `200 []` case.

### Suggested fix

Match exactly, and validate at the boundary:

```js
const getByStatus = (status) =>
  tasks.filter((t) => t.status === status).map((t) => ({ ...t }));
```

…plus a whitelist check in `GET /tasks` returning `400` for values outside
`VALID_STATUSES`. That constant is already declared in both
`src/routes/tasks.js:6` and `src/utils/validators.js:1` and is currently unused
at the route layer — the validation was evidently intended and never wired up.

**Left unfixed** per the brief. **Note for the reviewer:** the `400` half of this
is a breaking change for any client that treats an empty array as a valid
response, so it should ship behind a version bump.

---

## Bug #3 — Completing a task silently resets its priority

**Severity:** High
**Location:** `src/services/taskService.js:94` — `completeTask()`

### Expected behaviour

`PATCH /tasks/:id/complete` changes exactly two things: `status` → `done`, and
`completedAt` is stamped with the current time. All other fields are preserved.

### Actual behaviour

The update object hard-codes a `priority`:

```js
const updated = {
  ...task,
  priority: 'medium',        // <-- clobbers whatever the user set
  status: 'done',
  completedAt: new Date().toISOString(),
};
```

Any priority a user had set — `high` or `low` — is overwritten with `medium` the
moment the task is completed. The write is persisted to the store, so the
original value is unrecoverable. It is also invisible in code review, because
`priority: 'medium'` is indistinguishable at a glance from a deliberate default.

### How it was discovered

An integration test (`tests/tasks.routes.test.js:217`) created a task with
`priority: 'high'`, called `PATCH /tasks/:id/complete`, and asserted that
priority survives. It came back `'medium'`. The unit-level equivalent is at
`tests/taskService.test.js:167`.

### Suggested fix

Delete the `priority` line from the spread. The `create` defaults already handle
`priority` when a task is first created (`taskService.js:48`), so re-applying a
default at completion time serves no purpose.

**Left unfixed** per the brief. **Open question for the product owner:** is
priority-downgrade-on-completion intentional? If so it belongs in the API
documentation; if not it is silent data loss.

---

## Bug #4 — `PUT` allows clients to overwrite server-owned fields

**Severity:** High
**Location:** `src/services/taskService.js:72` (`update`) and
`src/routes/tasks.js:48` (the route passes `req.body` through unfiltered)

### Expected behaviour

`id`, `createdAt` and `completedAt` are server-generated and immutable through
the client-facing update path. A `PUT` body should be able to change
`title`, `description`, `status`, `priority` and `dueDate` — and nothing else.

### Actual behaviour

The service merges the entire caller-supplied object:

```js
const updated = { ...tasks[index], ...fields };
```

and the route hands it `req.body` verbatim. `validateUpdateTask`
(`src/utils/validators.js:20`) checks `title`, `status`, `priority` and `dueDate`
but never rejects unknown keys, so a client can write any property it likes.

Concretely, `PUT /tasks/:id` with a body of
`{ "id": "hacked", "createdAt": "1999-01-01T00:00:00.000Z" }` overwrites both
fields. The corrupted `id` is written back to the store, so the task becomes
permanently unreachable — its original id no longer resolves, and it is still
consuming a row in the collection. There is no endpoint that can restore it.

### How it was discovered

An integration test (`tests/tasks.routes.test.js:169`) sent `id` and `createdAt`
through `PUT`, then read the result back via `taskService.findById` using the
original id. The lookup returned `undefined` — the task had been orphaned by its
own update.

### Suggested fix

Strip server-owned keys before merging, so the protection lives in the service
where it cannot be bypassed by a new route:

```js
const PROTECTED_FIELDS = ['id', 'createdAt', 'completedAt'];

const update = (id, fields) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !PROTECTED_FIELDS.includes(key))
  );

  const updated = { ...tasks[index], ...safeFields };
  tasks[index] = updated;
  return { ...updated };
};
```

An allow-list (`title`, `description`, `status`, `priority`, `dueDate`) is
stricter and worth considering, since it also drops misspelled fields instead of
persisting them silently.

**Left unfixed** per the brief.

---

## Not filed as bugs

Two observations that look like defects but were judged to be design decisions
rather than bugs, and so are not counted in the four above:

- **No `total` / `totalPages` in the list response.** Pagination is implemented
  but not surfaced, so a client cannot know how many pages exist. Recorded as a
  gap, not a defect.
- **`completedAt` can be set without `status: 'done'`.** The two are not
  coupled. Whether that is acceptable depends on the intended workflow, so it
  needs a product answer rather than a code fix.

---

## Test results

```
$ npm run coverage

Test Suites: 3 passed, 3 total
Tests:       73 passed, 73 total

File             | % Stmts | % Branch | % Funcs | % Lines
-----------------|---------|----------|---------|---------
All files        |   96.17 |     91.2 |   93.75 |   95.74
 src             |   69.23 |        75 |       0 |   69.23
  app.js         |   69.23 |        75 |       0 |   69.23
 src/routes      |     100 |    96.42 |     100 |     100
  tasks.js       |     100 |    96.42 |     100 |     100
 src/services    |     100 |        88 |     100 |     100
  taskService.js |     100 |        88 |     100 |     100
 src/utils       |   91.3 |     91.17 |     100 |    91.3
  validators.js  |    91.3 |     91.17 |     100 |    91.3
```

All 73 tests pass, so the three open bugs are covered by tests that *assert the
current (incorrect) behaviour* and are named with a `BUG:` prefix. This is
deliberate: it keeps the defects visible in CI and means fixing any of them is a
matter of flipping an assertion, not discovering a new failure. The
`src/**/*.js` lines also carry `KNOWN BUG #n` comments pointing back here.

Uncovered: `app.js:10-11,17-18` is the `listen()` / 404-fallback / error-handler
path, which is unreachable when the app is mounted in-process by Supertest —
hence the 0% function coverage on that file. Branch gaps are the `req.body || {}`
fallback (`tasks.js:82`) and the `Number()` / `Math.max()` clamps in
`getPaginated` (`taskService.js:23-25`).
