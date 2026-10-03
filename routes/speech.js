const express = require('express');
const { wrap } = require('../middleware/errors');
const speech = require('../services/speechService');

const router = express.Router();
// Placeholders for a future server-side provider; they answer 501 until one is configured.
router.post('/transcribe', wrap(async (req, res) => res.json(await speech.transcribe())));
router.post('/synthesize', wrap(async (req, res) => res.json(await speech.synthesize())));

module.exports = router;
