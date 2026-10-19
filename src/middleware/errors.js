const { sendError } = require('../lib/response');

function notFound(req, res) {
  if (req.path.startsWith('/api/')) return sendError(res, 404, 'The requested resource was not found.', 'NOT_FOUND');
  return res.status(404).sendFile('index.html', { root: require('node:path').join(__dirname, '../../public') });
}

function errorHandler(err, req, res, _next) {
  console.error(err);
  if (res.headersSent) return;
  const status = Number.isInteger(err.status) ? err.status : 500;
  const message = status >= 500 ? 'Something went wrong on the server.' : err.message;
  return sendError(res, status, message, err.code || 'INTERNAL_ERROR');
}

module.exports = { notFound, errorHandler };
