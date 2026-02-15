const express = require('express');
const { healthCheck, readinessCheck } = require('../controllers/healthController');

const router = express.Router();

// Liveness probe - fast check
router.get('/', healthCheck);

// Readiness probe - comprehensive check
router.get('/ready', readinessCheck);

module.exports = router;
