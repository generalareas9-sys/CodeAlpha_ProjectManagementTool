function sendError(res, status, message, code = 'REQUEST_ERROR', details = undefined) {
  const payload = { error: { code, message } };
  if (details) payload.error.details = details;
  return res.status(status).json(payload);
}

function sendOk(res, data = {}) {
  return res.json({ data });
}

module.exports = { sendError, sendOk };
