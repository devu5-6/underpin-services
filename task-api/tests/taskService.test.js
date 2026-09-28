// Unit tests for the in-memory task service.
// NOTE: a few tests document *current* buggy behaviour on purpose, so the suite
// stays green while the bug is still unfixed. Each one is tagged with a
// "BUG" comment that points at BUG_REPORT.md.

const taskService = require('../src/services/taskService');

beforeEach(() => {
  taskService._reset();
});

describe('create', () => {
  it('creates a task with defaults when only a title is given', () => {
    const task = taskService.create({ title: 'Write tests' });

    expect(task.title).toBe('Write tests');
    expect(task.description).toBe('');
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.dueDate).toBeNull();
    expect(task.completedAt).toBeNull();
  });

  it('assigns a unique id and a createdAt timestamp', () => {
    const a = taskService.create({ title: 'a' });
    const b = taskService.create({ title: 'b' });

    expect(a.id).toBeDefined();
    expect(b.id).toBeDefined();
    expect(a.id).not.toBe(b.id);
    expect(new Date(a.createdAt).toString()).not.toBe('Invalid Date');
  });

  it('stores the fields it is given', () => {
    const task = taskService.create({
      title: 'Ship it',
      description: 'final checks',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2030-01-01T00:00:00.000Z',
    });

    expect(task.description).toBe('final checks');
    expect(task.status).toBe('in_progress');
    expect(task.priority).toBe('high');
    expect(task.dueDate).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('getAll / findById', () => {
  it('returns a copy of the list, not the internal array', () => {
    taskService.create({ title: 'a' });
    const all = taskService.getAll();
    all.pop();

    expect(taskService.getAll()).toHaveLength(1);
  });

  it('finds a task by id', () => {
    const created = taskService.create({ title: 'a' });
    expect(taskService.findById(created.id).title).toBe('a');
  });

  it('returns undefined for an unknown id', () => {
    expect(taskService.findById('nope')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  it('filters tasks by exact status', () => {
    taskService.create({ title: 'a', status: 'todo' });
    taskService.create({ title: 'b', status: 'in_progress' });

    const result = taskService.getByStatus('in_progress');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('b');
  });

  it('returns an empty array when nothing matches', () => {
    taskService.create({ title: 'a', status: 'todo' });
    expect(taskService.getByStatus('done')).toEqual([]);
  });

  // BUG #2 (BUG_REPORT.md): getByStatus uses String.includes, so it does
  // substring matching. Expected: only exact status matches; a request for an
  // unknown status should return nothing (and ideally be rejected upstream).
  it('BUG: does substring matching, so "o" matches both todo and in_progress', () => {
    taskService.create({ title: 'a', status: 'todo' });
    taskService.create({ title: 'b', status: 'in_progress' });

    const result = taskService.getByStatus('o');
    expect(result).toHaveLength(2); // expected: 0
  });
});

describe('getPaginated', () => {
  beforeEach(() => {
    for (let i = 1; i <= 25; i++) {
      taskService.create({ title: `task ${i}` });
    }
  });

  it('returns the first page of results', () => {
    const page = taskService.getPaginated(1, 10);
    expect(page).toHaveLength(10);
    expect(page[0].title).toBe('task 1');
    expect(page[9].title).toBe('task 10');
  });

  it('returns the second page of results', () => {
    const page = taskService.getPaginated(2, 10);
    expect(page[0].title).toBe('task 11');
  });

  it('returns fewer items on a partial last page', () => {
    expect(taskService.getPaginated(3, 10)).toHaveLength(5);
  });

  it('returns an empty array past the end', () => {
    expect(taskService.getPaginated(4, 10)).toEqual([]);
  });
});

describe('update', () => {
  it('updates the given fields on an existing task', () => {
    const created = taskService.create({ title: 'a' });
    const updated = taskService.update(created.id, { title: 'renamed', priority: 'high' });

    expect(updated.title).toBe('renamed');
    expect(updated.priority).toBe('high');
    expect(updated.status).toBe('todo'); // untouched
    expect(taskService.findById(created.id).title).toBe('renamed');
  });

  it('returns null for an unknown id', () => {
    expect(taskService.update('nope', { title: 'x' })).toBeNull();
  });
});

describe('remove', () => {
  it('deletes an existing task and returns true', () => {
    const created = taskService.create({ title: 'a' });
    expect(taskService.remove(created.id)).toBe(true);
    expect(taskService.findById(created.id)).toBeUndefined();
  });

  it('returns false for an unknown id', () => {
    expect(taskService.remove('nope')).toBe(false);
  });
});

describe('completeTask', () => {
  it('marks a task done and stamps completedAt', () => {
    const created = taskService.create({ title: 'a' });
    const done = taskService.completeTask(created.id);

    expect(done.status).toBe('done');
    expect(done.completedAt).not.toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(taskService.completeTask('nope')).toBeNull();
  });

  // BUG #3 (BUG_REPORT.md): completeTask resets priority to 'medium'.
  // Expected: completing a task changes status/completedAt only.
  it('BUG: silently resets an existing priority to medium', () => {
    const created = taskService.create({ title: 'a', priority: 'high' });
    const done = taskService.completeTask(created.id);

    expect(done.priority).toBe('medium'); // expected: 'high'
  });
});

describe('assignTask', () => {
  it('sets the assignee and stamps assignedAt', () => {
    const created = taskService.create({ title: 'a' });
    const assigned = taskService.assignTask(created.id, 'Alice');

    expect(assigned.assignee).toBe('Alice');
    expect(new Date(assigned.assignedAt).toString()).not.toBe('Invalid Date');
  });

  it('persists the assignment in the store', () => {
    const created = taskService.create({ title: 'a' });
    taskService.assignTask(created.id, 'Alice');

    expect(taskService.findById(created.id).assignee).toBe('Alice');
  });

  it('overwrites a previous assignee (reassignment allowed)', () => {
    const created = taskService.create({ title: 'a' });
    taskService.assignTask(created.id, 'Alice');
    const reassigned = taskService.assignTask(created.id, 'Bob');

    expect(reassigned.assignee).toBe('Bob');
  });

  it('returns null for an unknown id', () => {
    expect(taskService.assignTask('nope', 'Alice')).toBeNull();
  });
});

describe('getStats', () => {
  it('counts tasks by status and overdue correctly', () => {
    taskService.create({ title: 'a', status: 'todo', dueDate: '2020-01-01T00:00:00.000Z' });
    taskService.create({ title: 'b', status: 'todo' });
    taskService.create({ title: 'c', status: 'in_progress' });
    taskService.create({ title: 'd', status: 'done', dueDate: '2020-01-01T00:00:00.000Z' });

    const stats = taskService.getStats();
    expect(stats.todo).toBe(2);
    expect(stats.in_progress).toBe(1);
    expect(stats.done).toBe(1);
    expect(stats.overdue).toBe(1); // done tasks are not overdue
  });

  it('reports zero counts and zero overdue for an empty store', () => {
    expect(taskService.getStats()).toEqual({
      todo: 0,
      in_progress: 0,
      done: 0,
      overdue: 0,
    });
  });
});
