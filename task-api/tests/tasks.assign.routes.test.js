// Tests for PATCH /tasks/:id/assign (Part C of the assignment).
// Design decisions are documented in SUBMISSION.md.

const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

const createTask = (overrides = {}) =>
  request(app)
    .post('/tasks')
    .send({ title: `task-${Math.random().toString(36).slice(2)}`, ...overrides })
    .expect(201);

describe('PATCH /tasks/:id/assign', () => {
  it('assigns a task and stamps assignedAt', async () => {
    const created = (await createTask()).body;

    const res = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: 'Alice' })
      .expect(200);

    expect(res.body.assignee).toBe('Alice');
    expect(res.body.assignedAt).toBeDefined();
    expect(new Date(res.body.assignedAt).toString()).not.toBe('Invalid Date');
  });

  it('persists the assignment in the store', async () => {
    const created = (await createTask()).body;
    await request(app).patch(`/tasks/${created.id}/assign`).send({ assignee: 'Alice' }).expect(200);

    const list = await request(app).get('/tasks').expect(200);
    expect(list.body[0].assignee).toBe('Alice');
  });

  it('allows reassignment and refreshes assignedAt', async () => {
    const created = (await createTask()).body;

    const first = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: 'Alice' })
      .expect(200);
    const second = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: 'Bob' })
      .expect(200);

    expect(second.body.assignee).toBe('Bob');
    expect(new Date(second.body.assignedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.body.assignedAt).getTime()
    );
  });

  it('does not clobber other task fields', async () => {
    const created = (await createTask({ priority: 'high' })).body;

    const res = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: 'Alice' })
      .expect(200);

    expect(res.body.title).toBe(created.title);
    expect(res.body.priority).toBe('high');
    expect(res.body.createdAt).toBe(created.createdAt);
  });

  it('trims whitespace around the assignee name', async () => {
    const created = (await createTask()).body;

    const res = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: '  Alice  ' })
      .expect(200);

    expect(res.body.assignee).toBe('Alice');
  });

  it('returns 400 when the body is empty', async () => {
    const created = (await createTask()).body;

    const res = await request(app).patch(`/tasks/${created.id}/assign`).send({}).expect(400);
    expect(res.body.error).toMatch(/assignee/i);
  });

  it('returns 400 when assignee is an empty string', async () => {
    const created = (await createTask()).body;

    const res = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: '' })
      .expect(400);
    expect(res.body.error).toMatch(/assignee/i);
  });

  it('returns 400 when assignee is whitespace-only', async () => {
    const created = (await createTask()).body;

    const res = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: '   ' })
      .expect(400);
    expect(res.body.error).toMatch(/assignee/i);
  });

  it('returns 400 when assignee is not a string', async () => {
    const created = (await createTask()).body;

    const res = await request(app)
      .patch(`/tasks/${created.id}/assign`)
      .send({ assignee: 42 })
      .expect(400);
    expect(res.body.error).toMatch(/assignee/i);
  });

  it('returns 404 when the task does not exist', async () => {
    const res = await request(app)
      .patch('/tasks/does-not-exist/assign')
      .send({ assignee: 'Alice' })
      .expect(404);
    expect(res.body.error).toBe('Task not found');
  });

  it('rejects an assignee before checking the id, and never mutates the store', async () => {
    const res = await request(app)
      .patch('/tasks/does-not-exist/assign')
      .send({ assignee: '' })
      .expect(400);

    expect(res.body.error).toMatch(/assignee/i);
    expect(taskService.getAll()).toHaveLength(0);
  });
});
