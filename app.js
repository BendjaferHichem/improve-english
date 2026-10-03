require('dotenv').config();
const express = require('express');
const { errorHandler, notFound } = require('./middleware/errors');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use('/api', require('./routes'));
app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
