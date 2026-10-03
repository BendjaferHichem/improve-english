class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: 'That endpoint does not exist.' } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'The request could not be read.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.' } });
}

module.exports = { AppError, wrap, notFound, errorHandler };
