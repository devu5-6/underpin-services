const express = require('express');
const router = express.Router();
const taskService = require('../services/taskService');
const { validateCreateTask, validateUpdateTask } = require('../utils/validators');

const VALID_STATUSES = ['todo', 'in_progress', 'done'];

router.get('/stats', (req, res) => {
  const stats = taskService.getStats();
  res.json(stats);
});

router.get('/', (req, res) => {
  const { status, page, limit } = req.query;

  if (status) {
    const tasks = taskService.getByStatus(status);
    return res.json(tasks);
  }

  if (page !== undefined || limit !== undefined) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const tasks = taskService.getPaginated(pageNum, limitNum);
    return res.json(tasks);
  }

  const tasks = taskService.getAll();
  res.json(tasks);
});

router.post('/', (req, res) => {
  const error = validateCreateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.create(req.body);
  res.status(201).json(task);
});

router.put('/:id', (req, res) => {
  const error = validateUpdateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.update(req.params.id, req.body);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

router.delete('/:id', (req, res) => {
  const deleted = taskService.remove(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.status(204).send();
});

router.patch('/:id/complete', (req, res) => {
  const task = taskService.completeTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

// NEW (Part C): assign a task to a user.
// Validation rules (see SUBMISSION.md):
//  - 400 when the body is missing or `assignee` is absent / not a string /
//    empty or whitespace-only — a nameless assignment is meaningless.
//  - 404 when the task doesn't exist (checked before any mutation).
//  - Reassignment is intentionally allowed and just overwrites the previous
//    assignee, refreshing `assignedAt` (ownership-transfer use case).
router.patch('/:id/assign', (req, res) => {
  const { assignee } = req.body || {};

  if (typeof assignee !== 'string' || assignee.trim() === '') {
    return res
      .status(400)
      .json({ error: 'assignee is required and must be a non-empty string' });
  }

  const task = taskService.assignTask(req.params.id, assignee.trim());
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

module.exports = router;
