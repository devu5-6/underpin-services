const { v4: uuidv4 } = require('uuid');

let tasks = [];

const getAll = () => tasks.map((t) => ({ ...t }));

const findById = (id) => {
  const task = tasks.find((t) => t.id === id);
  return task ? { ...task } : undefined;
};

// KNOWN BUG #2 (BUG_REPORT.md): substring matching on status. `?status=o`
// matches both "todo" and "in_progress", and unknown statuses silently
// return []. Expected behaviour is exact matching plus a 400 for unknown
// statuses at the route level. Left unfixed per the assignment ("fix one").
const getByStatus = (status) => tasks.filter((t) => t.status.includes(status)).map((t) => ({ ...t }));

// FIXED BUG #1 (BUG_REPORT.md): `page` is 1-based for API consumers (the
// route layer defaults it to 1), so the offset must be (page - 1) * limit.
// This previously computed page * limit, which made ?page=1 silently skip
// the first `limit` items — pagination was off by one page on every request.
const getPaginated = (page, limit) => {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.max(Number(limit) || 10, 1);
  const offset = (safePage - 1) * safeLimit;
  return tasks.slice(offset, offset + safeLimit).map((t) => ({ ...t }));
};

const getStats = () => {
  const now = new Date();
  const counts = { todo: 0, in_progress: 0, done: 0 };
  let overdue = 0;

  tasks.forEach((t) => {
    if (counts[t.status] !== undefined) counts[t.status]++;
    if (t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now) {
      overdue++;
    }
  });

  return { ...counts, overdue };
};

const create = ({
  title,
  description = '',
  status = 'todo',
  priority = 'medium',
  dueDate = null,
}) => {
  const task = {
    id: uuidv4(),
    title,
    description,
    status,
    priority,
    dueDate,
    completedAt: null,
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  return { ...task };
};

// KNOWN BUG #4 (BUG_REPORT.md): spreads every client-supplied field onto the
// task, so PUT can overwrite id, createdAt and completedAt. Expected: strip
// protected fields before merging. Left unfixed per the assignment.
const update = (id, fields) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated = { ...tasks[index], ...fields };
  tasks[index] = updated;
  return { ...updated };
};

const remove = (id) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;

  tasks.splice(index, 1);
  return true;
};

// KNOWN BUG #3 (BUG_REPORT.md): silently resets priority to 'medium' when a
// task is completed. Expected: only status/completedAt should change.
// Left unfixed per the assignment.
const completeTask = (id) => {
  const task = findById(id);
  if (!task) return null;

  const updated = {
    ...task,
    priority: 'medium',
    status: 'done',
    completedAt: new Date().toISOString(),
  };
  const index = tasks.findIndex((t) => t.id === id);
  tasks[index] = updated;
  return { ...updated };
};

// NEW (Part C): assignment feature.
// Design decisions (see SUBMISSION.md):
//  - Reassignment is allowed: assigning over an existing assignee just
//    overwrites it and refreshes assignedAt (an ownership-transfer use case).
//  - Empty/whitespace/missing assignee is rejected with 400 by the route;
//    the service itself stays a thin data layer.
//  - assignedAt is server-generated and never client-supplied.
const assignTask = (id, assignee) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const updated = {
    ...tasks[index],
    assignee,
    assignedAt: new Date().toISOString(),
  };
  tasks[index] = updated;
  return { ...updated };
};

const _reset = () => {
  tasks = [];
};

module.exports = {
  getAll,
  findById,
  getByStatus,
  getPaginated,
  getStats,
  create,
  update,
  remove,
  completeTask,
  assignTask,
  _reset,
};
