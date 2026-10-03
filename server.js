// Local development server: serves the static frontend and the API on one port.
const path = require('path');
const express = require('express');
const api = require('./app');

const server = express();
server.use(api);
server.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Outloud running at http://localhost:${port}`));
