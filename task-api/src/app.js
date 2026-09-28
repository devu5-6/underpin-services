const express = require('express');
const taskRoutes = require('./routes/tasks');

const app = express();

app.use(express.json());
// Root health-check/index so visitors landing on the deployed URL see
// something useful instead of Express's default 404 ("Cannot GET /").
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Task Manager API',
    endpoints: {
      listAll: 'GET /tasks',
      filterByStatus: 'GET /tasks?status=todo|in_progress|done',
      paginate: 'GET /tasks?page=1&limit=10',
      create: 'POST /tasks',
      update: 'PUT /tasks/:id',
      delete: 'DELETE /tasks/:id',
      complete: 'PATCH /tasks/:id/complete',
      assign: 'PATCH /tasks/:id/assign',
      stats: 'GET /tasks/stats',
    },
  });
});

app.use('/tasks', taskRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Task API running on port ${PORT}`);
  });
}

module.exports = app;
