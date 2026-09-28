# Submission — Take-Home Assignment: The Untested API

**Contents:** test suite · bug report · one fix · one new endpoint

---

## 1. Summary

I read the source in `src/` end to end before writing anything, then wrote 73
tests against the documented contract in `README.md` — 26 unit tests against
`taskService` directly, 47 integration tests driving the real Express app through
Supertest.

The suite surfaced **four genuine bugs**, all of them silent-corruption or
wrong-data bugs that a code read would plausibly have missed. They are written up
in full, with locations and root causes, in [`BUG_REPORT.md`](./BUG_REPORT.md).

I fixed **Bug #1** (pagination off by one page on every request) and added
**`PATCH /tasks/:id/assign`** with 11 tests covering its validation and edge
cases.

| Deliverable | Where | Status |
|---|---|---|
| Test suite (73 tests) | `tests/` | Complete — 96.17% statements, 91.2% branches |
| Bug report (4 bugs) | `BUG_REPORT.md` | Complete |
| Bug fix (pagination) | `src/services/taskService.js:22` | Complete, tests updated |
| `PATCH /tasks/:id/assign` | `src/routes/tasks.js:81`, `src/services/taskService.js:110` | Complete, 11 tests |

### The one-line version

The store is a single module-level array mutated by hand-written service
functions, and three of the four bugs come from spread-merging caller data
straight onto that array's objects without a boundary. The bugs are not random —
they are all the same mistake in four places.

---

## 2. Approach

**Test the contract, not the implementation.** I derived expectations from
`README.md` and `ASSIGNMENT.md`, wrote assertions against those, and treated
mismatches as findings rather than adjusting the assertions to match the code.
That ordering is the whole reason four bugs were found rather than zero — had I
written tests to match observed behaviour, all 73 would have passed on day one
and told me nothing.

**Test through the public surface.** Unit tests call `taskService` functions
directly; integration tests go through Supertest against the real app. The
service is a plain module with no injected dependencies, so `taskService._reset()`
in `beforeEach` gives full isolation without mocking. I deliberately did not
mock `taskService` inside the route tests — the bugs I found live in the seam
between the route and the service, so mocking that seam would have hidden all of
them.

**Cover behaviour, including what should *not* change.** Several of the most
valuable tests are the ones asserting that unrelated fields survive an operation:
that priority survives `PUT`, that `PATCH /assign` does not clobber `title` or
`createdAt`. Those are exactly the assertions that caught Bugs #3 and #4.

**Leave open bugs visible rather than quietly fixed.** The brief asks for one
fix, so the other three stay in the code. Each has a `BUG:`-prefixed test
asserting its current behaviour, plus a `KNOWN BUG #n` comment in the source.
Consequence: CI stays green, the defect stays documented, and fixing any one of
them later is flipping an assertion rather than chasing a new failure. The
tradeoff is real and worth naming — a green suite that asserts incorrect
behaviour can read as "working" to anyone who skims it, which is why the naming
and comments are load-bearing rather than cosmetic.

---

## 3. The fix — Bug #1, pagination

`getPaginated` computed `offset = page * limit`, treating a 1-based page number
as a 0-based row offset. `?page=1` returned page two, every subsequent page was
shifted by one, and the final page was always empty. Found by creating twelve
tasks and asserting `?page=1&limit=10` returns ten; it returned two.

```diff
- const offset = page * limit;
+ const offset = (safePage - 1) * safeLimit;
```

The `Math.max(..., 1)` clamp was already there for non-numeric input and I kept
it, so `page=0` and negative values now degrade to the first page instead of
producing a negative offset. The three `BUG:`-prefixed pagination tests were
rewritten to assert the correct contract.

**Why this one:** it is the only bug that corrupts *no* data — it just returns
the wrong rows — which makes it the safest to change, and the fix is one line
with no contract to negotiate.

**One thing to flag:** the fix changes results for any client that has already
worked around the old behaviour. If this API has consumers, the change is
breaking for them and should ship behind a version bump rather than as a silent
patch. That is question 1 in §6.

---

## 4. New feature — `PATCH /tasks/:id/assign`

```
PATCH /tasks/:id/assign
Body: { "assignee": "string" }
→ 200 with the updated task
```

Implementation: `src/routes/tasks.js:81` (validation, status codes) and
`src/services/taskService.js:110` (the write). Eleven tests in
`tests/tasks.assign.routes.test.js`.

### Design decisions

**Validation lives in the route, not the service.** `assignTask` is a thin data
layer; it takes an `id` and a name and either writes or returns `null`. All
input rules are enforced at the HTTP boundary, consistent with how
`validateCreateTask` / `validateUpdateTask` are already used in this codebase. I
did not introduce a new `validateAssignTask` helper because a single required
non-empty string did not justify another export.

**400 for absent / non-string / empty / whitespace-only `assignee`.** The brief
asked me to decide, and I rejected all of these rather than accepting them. An
assignment to nobody is a no-op that a caller would read as success, and it is
indistinguishable downstream from "assigned, but we lost the name". I trim before
validating, so `"  "` is rejected while `"  Alice  "` stores `"Alice"` — the
common client bug is an untrimmed field from a text input, and storing it
verbatim would make lookups by assignee unreliable.

**404 for an unknown task**, and validation runs *before* the existence check.
That ordering is deliberate and tested: a malformed request to a nonexistent id
returns `400`, and — more importantly — no request that fails validation ever
touches the store. A test asserts the store is still empty afterwards, because a
handler that validates late and mutates as it goes is how you get partial writes.

**Reassignment is allowed and simply overwrites.** The brief asked what should
happen when a task is already assigned. I chose to allow it: assigning over an
existing assignee refreshes `assignee` and `assignedAt`, which supports the
ownership-transfer case (Alice hands a task to Bob) with no extra endpoint. The
alternative — `409 Conflict` — is defensible, but it makes a common, harmless
operation an error and would force clients to add an unassign-then-assign dance.
Note the flip side: without an auth model, "reassignment" is indistinguishable
from "anyone can steal anyone's task", which is why ownership is my first item
in §5.

**`assignedAt` is server-generated** and is never read from the request body —
the same reason `createdAt` and `completedAt` are. I set it in the service, not
the route, so it stays correct no matter which caller reaches the function.

**Returned object is a copy.** `{ ...tasks[index] }` on the way out, matching
every other function in the service, so a caller holding the response cannot
mutate the store by reference. This was already the house style; I followed it
rather than inventing a new convention.

### Known limitation of the feature

`assignee` is a free-text string, so `"alice"`, `"Alice"` and `"Alice Smith"` are
three different owners. Real ownership needs a user identifier validated against
an identity source. I did not build that, but I would not ship assignment
without it.

---

## 5. What I'd test next

**Concurrency, first and without question.** The store is a module-level array
and nothing serialises writes. `update`, `remove`, `completeTask` and
`assignTask` all follow read-index-write-back, which is a lost-update race the
moment two requests touch the same task. I would write parallel Supertest
requests mutating one task and assert the result, then either document the
single-process assumption explicitly or move to a store that can be swapped for
a real one behind an interface. This is the gap I am least comfortable shipping
with, and it is invisible to the current suite because every test is sequential.

**Property-based pagination.** Page and limit need testing at boundaries the way
Bug #1 should have been caught: `0`, negatives, `NaN`, floats, values far past
the collection size, and the invariant that the union of all pages equals the
unpaginated list with no gaps or duplicates. A single off-by-one fixture would
not have found Bug #1; that property would have, in one run.

**A repository interface for the store.** Extract persistence behind a small
interface so in-memory and file- or DB-backed implementations can be tested
independently, and so `_reset()` stops being a test-only export in production
code. It also gives Bug #4 a natural home — protected fields belong at the
persistence boundary.

**Auth and ownership.** Nothing stops any client from assigning, completing, or
deleting any task. I would test the authorisation rules and then build them.
Without identity checks, `PATCH /tasks/:id/assign` is a feature I would not
expose outside a trusted network.

**The validators themselves.** `validators.js` is exercised only through the
routes. A direct unit suite would cover the remaining branch gaps and let me test
`validateUpdateTask` with `body` being `undefined` — which currently throws a
`TypeError` rather than returning a `400` if a client sends a `PUT` with no body
at all. I have not filed that as a bug because Express normally supplies `{}`;
it is a latent 500 rather than an observed one, and I would want a reproduction
before spending a slot on it.

---

## 6. What surprised me

**The bugs are not four independent bugs — they are one mistake in four places.**
Three of the four (`#2`, `#3`, `#4`) come from the same pattern: caller-supplied
data spread onto a stored object with no boundary in between. `getByStatus` lets
a query string decide the comparison operator, `completeTask` re-applies a
creation-time default, `update` merges an unfiltered body. Once I had found the
third one I stopped treating them as separate findings and started asking "where
else does raw input meet the store", which is how I knew there was nothing left
to find. I would not have made that connection from reading the code once.

**Every one of the four is invisible in code review.** None of them is
conspicuous: `priority: 'medium'` reads as a default, `{ ...task, ...fields }`
reads as idiomatic shorthand, `String.includes` reads as a reasonable choice
between `===` and a regex. All three are lines that would pass any review I have
attended. This is the strongest argument I can make for why the test suite is
worth more than the code review it replaced.

**The README documents an API that does not exist.** It specifies
`pending` / `in-progress` / `completed`; the code implements `todo` /
`in_progress` / `done`. It also implies a separate store, while `taskService`
owns the data itself. A client written from the README alone would get a `400`
on its first create. I tested the code, since that is what actually runs — but
this is the kind of drift that makes "the docs say it works" a false signal, and
it is worth reconciling before anyone trusts either artifact.

**`VALID_STATUSES` is declared in `src/routes/tasks.js:6` and never used.** A
module-level constant, defined correctly, in the exact file that would need it
to validate `?status=`, left dead. That is a strong tell: someone intended the
`400` for unknown statuses, started it, and stopped. It also confirms Bug #2 is
a half-finished feature rather than a design decision, which changes how I would
talk to the person who wrote it.

**The test-only `_reset()` export is in production code.** `taskService._reset`
(`taskService.js:123`) is a public export of a production module, used by nothing
but the tests. Correct and pragmatic, but it means the store has two
initialisation paths and a test can silently wipe live state if it ever leaks
into non-test code.

**The in-memory store is shared mutable module state, and nothing guards it.**
`tasks` is reassigned by `_reset()` but the array is mutated in place by
`create`, so a reference captured before a reset points at the old array. Harmless
today because nothing holds a long-lived reference, but it is a sharp edge that
`const` does not protect against.

---

## 7. Questions I'd ask before shipping

**Who consumes this, and is the current pagination contract already depended
upon?** My fix changes results for anyone who worked around the old behaviour. I
cannot tell from the code whether the service has shipped, and it determines
whether this is a patch or a breaking change.

**Is resetting `priority` on completion intentional product behaviour?** If yes
it needs documenting; if no it is silent data loss and should be fixed before
this is exposed to anyone.

**Should an unknown `?status=` return `400` or `200 []`?** I think `400` is
right, but it is a breaking change for clients that treat an empty array as a
valid answer, and it is a product call rather than a technical one.

**What are the expected volume and lifetime of this data?** The in-memory store
and the `O(n)` scans in `findById` and `getStats` are fine for hundreds of tasks
and unsuitable for hundreds of thousands. Nothing in the code says which regime
this is for, and the answer changes whether the data layer is a placeholder or
the architecture.

**Is an auth model planned, and does assignment imply ownership?** Related to
the decision above: if `assignee` is meant to mean "responsible for this task",
then completing and deleting it should be restricted, and that is a contract
change rather than a bug fix.

**Which is authoritative — the README's status values or the code's?** The README
documents `pending` / `in-progress` / `completed`; the code implements `todo` /
`in_progress` / `done`. I tested the code, since that is what runs, but the
documented contract is unreachable through the API. The same mismatch exists for
the file layout — `taskService` owns the data rather than a separate store as
the README's structure implies. Someone should reconcile the documentation; a
client written from the README alone would fail against this API.

---

## 8. Test results

```
$ npm run coverage

Test Suites: 3 passed, 3 total
Tests:       73 passed, 73 total
Snapshots:   0 total

File             | % Stmts | % Branch | % Funcs | % Lines | Uncovered
-----------------|---------|----------|---------|---------|-----------
All files        |   96.17 |     91.2 |   93.75 |   95.74 |
 src             |   69.23 |        75 |       0 |   69.23 | 10-11,17-18
  app.js         |   69.23 |        75 |       0 |   69.23 |
 src/routes      |     100 |    96.42 |     100 |     100 |
  tasks.js       |     100 |    96.42 |     100 |     100 | 82
 src/services    |     100 |        88 |     100 |     100 |
  taskService.js |     100 |        88 |     100 |     100 | 23-25
 src/utils       |    91.3 |     91.17 |     100 |    91.3 | 28,31
  validators.js  |    91.3 |     91.17 |     100 |    91.3 |
```

Above the 80% target on every metric. The `app.js` gap is the `listen()` and
404-fallback path, which is unreachable when the app is mounted in-process by
Supertest — hence 0% function coverage on that file and the slightly misleading
directory-level figure underneath it.

### Suite breakdown

| File | Tests | Covers |
|---|---:|---|
| `tests/taskService.test.js` | 26 | Every `taskService` function directly, including defaults, immutability of returned copies, unknown-id paths, and 2 `BUG:` regressions |
| `tests/tasks.routes.test.js` | 36 | All 8 endpoints via Supertest — happy path plus at least 2 edge cases for each, including 3 `BUG:` regressions |
| `tests/tasks.assign.routes.test.js` | 11 | The new endpoint: persistence, reassignment, non-clobbering, trimming, 4 validation rejections, 404, and no-mutation-on-failure |

### Reproducing

```bash
cd task-api
npm install
npm run coverage
```
