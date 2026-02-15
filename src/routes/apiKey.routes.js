const express = require('express');
const router = express.Router();
const apiKeyController = require('../controllers/apiKey.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(protect);

// Validation rules
const addKeyValidation = [
  body('provider').isIn(['openai', 'groq', 'gemini']).withMessage('Invalid provider'),
  body('apiKey').isString().trim().notEmpty().withMessage('API key required'),
  body('baseUrl').optional().isURL().withMessage('Invalid base URL'),
  body('model').optional().isString().withMessage('Invalid model name')
];

const updateKeyValidation = [
  param('provider').isIn(['openai', 'groq', 'gemini']),
  body('isActive').optional().isBoolean(),
  body('baseUrl').optional().isURL(),
  body('model').optional().isString()
];

// Routes
router.get('/', apiKeyController.listKeys);
router.post('/', validate(addKeyValidation), apiKeyController.addKey);
router.put('/:provider', validate(updateKeyValidation), apiKeyController.updateKey);
router.delete('/:provider', apiKeyController.deleteKey);
router.post('/:provider/validate', apiKeyController.validateKey);
router.post('/settings', apiKeyController.updateSettings);

module.exports = router;
