const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const encryptionService = require('../utils/encryption');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const axios = require('axios');

/**
 * Validate OpenAI API key by making a test request
 * @param {string} apiKey - OpenAI API key to validate
 * @returns {Promise<{valid: boolean, model?: string, error?: string}>}
 */
async function validateOpenAIKey(apiKey) {
  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 10000
    });

    if (response.status === 200 && response.data.data) {
      // Get available models
      const models = response.data.data.map(m => m.id);
      const hasGPT4 = models.some(m => m.includes('gpt-4'));
      const defaultModel = hasGPT4 ? 'gpt-4' : 'gpt-3.5-turbo';
      
      return { 
        valid: true, 
        model: defaultModel,
        availableModels: models.slice(0, 10) // Return first 10 models
      };
    }

    return { valid: false, error: 'Invalid response from OpenAI API' };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      if (status === 401) {
        return { valid: false, error: 'Invalid API key' };
      } else if (status === 429) {
        return { valid: false, error: 'Rate limit exceeded. Please try again later.' };
      }
      return { valid: false, error: `OpenAI API error: ${status}` };
    }
    
    return { valid: false, error: 'Failed to connect to OpenAI API' };
  }
}

/**
 * @desc    Add or update OpenAI API key
 * @route   POST /api/user/api-keys/openai
 * @access  Private
 */
router.post('/openai', protect, asyncHandler(async (req, res) => {
  const { apiKey } = req.body;

  if (!apiKey || !apiKey.trim()) {
    throw new AppError('API key is required', 400);
  }

  // Validate key format
  if (!apiKey.startsWith('sk-')) {
    throw new AppError('Invalid OpenAI API key format. Key should start with "sk-"', 400);
  }

  // Validate key with OpenAI
  console.log(`Validating OpenAI API key for user ${req.user._id}...`);
  const validation = await validateOpenAIKey(apiKey);

  if (!validation.valid) {
    throw new AppError(validation.error || 'Invalid API key', 400);
  }

  // Encrypt the key
  const encryptedKey = encryptionService.encrypt(apiKey, req.user._id.toString());

  // Save to user document
  const user = await User.findById(req.user._id);
  
  if (!user.apiKeys) {
    user.apiKeys = new Map();
  }

  user.apiKeys.set('openai', {
    encryptedKey,
    provider: 'openai',
    model: validation.model,
    isActive: true,
    isValid: true,
    lastValidated: new Date(),
    addedAt: new Date(),
    errorCount: 0
  });

  // Enable BYOK
  user.byokSettings = {
    enabled: true,
    activeProvider: 'openai',
    fallbackToSystem: true
  };

  await user.save();

  console.log(`✓ OpenAI API key saved for user ${req.user._id}`);

  res.json({
    success: true,
    message: 'API key saved successfully',
    provider: 'openai',
    model: validation.model,
    availableModels: validation.availableModels
  });
}));

/**
 * @desc    Remove OpenAI API key
 * @route   DELETE /api/user/api-keys/openai
 * @access  Private
 */
router.delete('/openai', protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user.apiKeys && user.apiKeys.has('openai')) {
    user.apiKeys.delete('openai');
    
    // Disable BYOK if no keys remain
    if (user.apiKeys.size === 0) {
      user.byokSettings.enabled = false;
      user.byokSettings.activeProvider = null;
    }
    
    await user.save();
    console.log(`✓ OpenAI API key removed for user ${req.user._id}`);
  }

  res.json({
    success: true,
    message: 'API key removed successfully'
  });
}));

/**
 * @desc    Get API keys status (without exposing actual keys)
 * @route   GET /api/user/api-keys/status
 * @access  Private
 */
router.get('/status', protect, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  const status = {
    byokEnabled: user.byokSettings?.enabled || false,
    activeProvider: user.byokSettings?.activeProvider || null,
    fallbackToSystem: user.byokSettings?.fallbackToSystem !== false,
    keys: {}
  };

  // Get status for each provider
  if (user.apiKeys) {
    for (const [provider, keyData] of user.apiKeys.entries()) {
      status.keys[provider] = {
        enabled: keyData.isActive,
        isValid: keyData.isValid,
        lastValidated: keyData.lastValidated,
        lastUsed: keyData.lastUsed,
        model: keyData.model,
        errorCount: keyData.errorCount,
        maskedKey: 'sk-...****' // Never expose actual key
      };
    }
  }

  res.json(status);
}));

/**
 * @desc    Get decrypted API key for a user (internal service use only)
 * @route   GET /api/user/:userId/api-key/:provider
 * @access  Private (Service-to-service)
 * @note    This endpoint should be protected by service authentication
 */
router.get('/:userId/api-key/:provider', asyncHandler(async (req, res) => {
  const { userId, provider } = req.params;

  // TODO: Add service-to-service authentication here
  // For now, this is accessible but requires knowing the exact user ID

  const user = await User.findById(userId);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  if (!user.apiKeys || !user.apiKeys.has(provider)) {
    return res.json({ enabled: false });
  }

  const keyData = user.apiKeys.get(provider);

  if (!keyData.isActive) {
    return res.json({ enabled: false });
  }

  try {
    // Decrypt the key
    const decryptedKey = encryptionService.decrypt(keyData.encryptedKey, userId);

    // Update last used timestamp
    keyData.lastUsed = new Date();
    user.apiKeys.set(provider, keyData);
    await user.save();

    res.json({
      enabled: true,
      key: decryptedKey,
      model: keyData.model,
      provider: keyData.provider
    });
  } catch (error) {
    console.error(`Failed to decrypt API key for user ${userId}:`, error.message);
    throw new AppError('Failed to retrieve API key', 500);
  }
}));

/**
 * @desc    Toggle BYOK on/off
 * @route   PATCH /api/user/api-keys/toggle
 * @access  Private
 */
router.patch('/toggle', protect, asyncHandler(async (req, res) => {
  const { enabled } = req.body;

  const user = await User.findById(req.user._id);

  if (!user.apiKeys || user.apiKeys.size === 0) {
    throw new AppError('No API keys configured. Please add a key first.', 400);
  }

  user.byokSettings.enabled = enabled !== false;
  await user.save();

  res.json({
    success: true,
    enabled: user.byokSettings.enabled,
    message: `BYOK ${user.byokSettings.enabled ? 'enabled' : 'disabled'}`
  });
}));

module.exports = router;
