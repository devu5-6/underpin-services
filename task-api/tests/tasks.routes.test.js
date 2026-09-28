// Integration tests for the /tasks API routes (Supertest against the Express app).
// Tests marked "BUG" document current buggy behaviour and link to BUG_REPORT.md —
// they should be revisited (and updated to the expected behaviour) once fixed.

const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

const createTask = (overrides = {}) => {
  const body = { title: `task-${Math.random().toString(36).slice(2)}`, ...overrides };
  return request(app).post('/tasks').send(body).expect(201);
};

describe('GET /', () => {
  // Health/index route so the deployed root URL returns something useful.
  it('returns service status and an endpoint index', async () => {
    const res = await request(app).get('/').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('Task Manager API');
    expect(res.body.endpoints).toMatchObject({
      listAll: 'GET /tasks',
      assign: 'PATCH /tasks/:id/assign',
      stats: 'GET /tasks/stats',
    });
  });
});

describe('GET /tasks', () => {
  it('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks').expect(200);
    expect(res.body).toEqual([]);
  });

  it('returns all created tasks', async () => {
    await createTask();
    await createTask();

    const res = await request(app).get('/tasks').expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns tasks in insertion order', async () => {
    await createTask({ title: 'first' });
    await createTask({ title: 'second' });
    await createTask({ title: 'third' });

    const res = await request(app).get('/tasks').expect(200);
    expect(res.body.map((t) => t.title)).toEqual(['first', 'second', 'third']);
  });

  // The store is a module-level array, so a response that handed back live
  // references would let any client corrupt the data through a GET.
  it('returns copies, so mutating the response does not mutate the store', async () => {
    await createTask({ title: 'original' });

    const res = await request(app).get('/tasks').expect(200);
    res.body[0].title = 'mutated';
    res.body.pop();

    const second = await request(app).get('/tasks').expect(200);
    expect(second.body).toHaveLength(1);
    expect(second.body[0].title).toBe('original');
  });
});

describe('GET /tasks?status=', () => {
  it('filters by status', async () => {
    await createTask({ status: 'todo' });
    await createTask({ status: 'in_progress' });

    const res = await request(app).get('/tasks?status=in_progress').expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('in_progress');
  });

  it('returns an empty array for a status with no tasks', async () => {
    await createTask();
    const res = await request(app).get('/tasks?status=done').expect(200);
    expect(res.body).toEqual([]);
  });

  // BUG #2 (BUG_REPORT.md): unknown statuses are not rejected — anything that
  // is a substring of a real status returns results, anything else returns [].
  it('BUG: accepts an unknown status string and does substring matching', async () => {
    await createTask({ status: 'todo' });
    const res = await request(app).get('/tasks?status=to').expect(200);
    expect(res.body).toHaveLength(1); // expected: a 400 validation error
  });
});

describe('GET /tasks pagination', () => {
  beforeEach(async () => {
    for (let i = 0; i < 12; i++) {
      await createTask();
    }
  });

  it('returns the requested page with default limit of 10', async () => {
    const res = await request(app).get('/tasks?page=1&limit=10').expect(200);
    expect(res.body).toHaveLength(10);
  });

  it('returns the remaining items on the last page', async () => {
    const res = await request(app).get('/tasks?page=2&limit=10').expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('falls back to sensible defaults for non-numeric values', async () => {
    const res = await request(app).get('/tasks?page=abc&limit=xyz').expect(200);
    expect(res.body).toHaveLength(10);
  });

  // FIXED BUG #1 (BUG_REPORT.md): page used to be treated as a 0-based
  // offset, so ?page=1 skipped the first `limit` items. Now that the fix is
  // in, page=1 must return the first page of results.
  it('returns the first page of results when page=1 (bug #1 fixed)', async () => {
    const res = await request(app).get('/tasks?page=1&limit=10').expect(200);
    const firstPageTitles = res.body.map((t) => t.title);
    const allTitles = (await request(app).get('/tasks').expect(200)).body.map((t) => t.title);

    expect(firstPageTitles).toEqual(allTitles.slice(0, 10));
  });
});

describe('POST /tasks', () => {
  it('creates a task and returns 201 with the task', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Write tests' }).expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe('Write tests');
    expect(res.body.status).toBe('todo');
    expect(res.body.priority).toBe('medium');
    expect(res.body.completedAt).toBeNull();
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/tasks').send({}).expect(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('returns 400 when title is an empty/whitespace string', async () => {
    const res = await request(app).post('/tasks').send({ title: '   ' }).expect(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('returns 400 for an invalid status', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', status: 'archived' }).expect(400);
    expect(res.body.error).toMatch(/status/i);
  });

  it('returns 400 for an invalid priority', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', priority: 'urgent' }).expect(400);
    expect(res.body.error).toMatch(/priority/i);
  });

  it('returns 400 for an unparseable dueDate', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', dueDate: 'not-a-date' }).expect(400);
    expect(res.body.error).toMatch(/dueDate/i);
  });

  it('accepts a valid dueDate', async () => {
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'x', dueDate: '2030-01-01T00:00:00.000Z' })
      .expect(201);
    expect(res.body.dueDate).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('PUT /tasks/:id', () => {
  it('updates an existing task', async () => {
    const created = (await createTask()).body;

    const res = await request(app)
      .put(`/tasks/${created.id}`)
      .send({ title: 'renamed', priority: 'high' })
      .expect(200);

    expect(res.body.title).toBe('renamed');
    expect(res.body.priority).toBe('high');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/tasks/does-not-exist').send({ title: 'x' }).expect(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('returns 400 for an invalid title', async () => {
    const created = (await createTask()).body;
    const res = await request(app).put(`/tasks/${created.id}`).send({ title: '' }).expect(400);
    expect(res.body.error).toMatch(/title/i);
  });

  it('returns 400 for an invalid status', async () => {
    const created = (await createTask()).body;
    const res = await request(app).put(`/tasks/${created.id}`).send({ status: 'bogus' }).expect(400);
    expect(res.body.error).toMatch(/status/i);
  });

  // BUG #4 (BUG_REPORT.md): PUT spreads arbitrary body fields onto the task,
  // so clients can overwrite id, createdAt and completedAt.
  it('BUG: lets the client overwrite protected fields like id and createdAt', async () => {
    const created = (await createTask()).body;

    const res = await request(app)
      .put(`/tasks/${created.id}`)
      .send({ title: 'renamed', id: 'hacked', createdAt: '1999-01-01T00:00:00.000Z' })
      .expect(200);

    expect(res.body.id).toBe('hacked'); // expected: created.id
    expect(res.body.createdAt).toBe('1999-01-01T00:00:00.000Z'); // expected: original

    // ...and the corrupted id is now persisted in the store:
    expect(taskService.findById(created.id)).toBeUndefined();
  });
});

describe('DELETE /tasks/:id', () => {
  it('deletes a task and returns 204 with no body', async () => {
    const created = (await createTask()).body;

    const res = await request(app).delete(`/tasks/${created.id}`).expect(204);
    expect(res.text).toBe('');

    const list = await request(app).get('/tasks').expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/tasks/does-not-exist').expect(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('returns 404 when the same id is deleted twice', async () => {
    const created = (await createTask()).body;

    await request(app).delete(`/tasks/${created.id}`).expect(204);
    const res = await request(app).delete(`/tasks/${created.id}`).expect(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('deletes only the requested task and leaves the others intact', async () => {
    const keep = (await createTask({ title: 'keep' })).body;
    const drop = (await createTask({ title: 'drop' })).body;

    await request(app).delete(`/tasks/${drop.id}`).expect(204);

    const list = await request(app).get('/tasks').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(keep.id);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  it('marks a task done and stamps completedAt', async () => {
    const created = (await createTask()).body;

    const res = await request(app).patch(`/tasks/${created.id}/complete`).expect(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).not.toBeNull();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/tasks/does-not-exist/complete').expect(404);
    expect(res.body.error).toBe('Task not found');
  });

  // BUG #3 (BUG_REPORT.md): completing a task resets its priority to 'medium'.
  it('BUG: resets the priority to medium when completing', async () => {
    const created = (await createTask({ priority: 'high' })).body;

    const res = await request(app).patch(`/tasks/${created.id}/complete`).expect(200);
    expect(res.body.priority).toBe('medium'); // expected: 'high'
  });
});

describe('GET /tasks/stats', () => {
  it('returns counts by status plus overdue', async () => {
    await createTask({ status: 'todo', dueDate: '2020-01-01T00:00:00.000Z' });
    await createTask({ status: 'todo' });
    await createTask({ status: 'done' });

    const res = await request(app).get('/tasks/stats').expect(200);
    expect(res.body).toEqual({ todo: 2, in_progress: 0, done: 1, overdue: 1 });
  });

  it('returns zeros when the store is empty', async () => {
    const res = await request(app).get('/tasks/stats').expect(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  // A task that is not yet due must never be counted as overdue. A far-future
  // date is used rather than "now" so the assertion cannot go flaky.
  it('does not count a task with a future dueDate as overdue', async () => {
    await createTask({ dueDate: '2030-01-01T00:00:00.000Z' });

    const res = await request(app).get('/tasks/stats').expect(200);
    expect(res.body).toEqual({ todo: 1, in_progress: 0, done: 0, overdue: 0 });
  });

  it('does not count a done task with a past dueDate as overdue', async () => {
    await createTask({ status: 'done', dueDate: '2020-01-01T00:00:00.000Z' });

    const res = await request(app).get('/tasks/stats').expect(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 1, overdue: 0 });
  });

  it('counts in_progress tasks in their own bucket', async () => {
    await createTask({ status: 'in_progress', dueDate: '2020-01-01T00:00:00.000Z' });

    const res = await request(app).get('/tasks/stats').expect(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 1, done: 0, overdue: 1 });
  });

  // /stats is computed over the whole store, not just the page or filter in the
  // query string, so the counts must not change when one is supplied.
  it('ignores status, page and limit query parameters', async () => {
    await createTask({ status: 'todo', dueDate: '2020-01-01T00:00:00.000Z' });
    await createTask({ status: 'done' });

    const res = await request(app).get('/tasks/stats?status=todo&page=1&limit=1').expect(200);
    expect(res.body).toEqual({ todo: 1, in_progress: 0, done: 1, overdue: 1 });
  });
});
