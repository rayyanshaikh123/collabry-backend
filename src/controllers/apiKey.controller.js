const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const User = require('../models/User');
const encryption = require('../utils/encryption');
const axios = require('axios');

/**
 * @route   GET /api/apikeys
 * @desc    List user's API keys (without actual keys)
 * @access  Private
 */
exports.listKeys = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  const keys = [];
  if (user.apiKeys) {
    for (const [provider, data] of user.apiKeys) {
      keys.push({
        provider: data.provider,
        isActive: data.isActive,
        isValid: data.isValid,
        lastValidated: data.lastValidated,
        addedAt: data.addedAt,
        lastUsed: data.lastUsed,
        errorCount: data.errorCount,
        baseUrl: data.baseUrl,
        model: data.model
        // Note: encryptedKey is never returned
      });
    }
  }

  res.json({
    success: true,
    data: {
      keys,
      settings: user.byokSettings
    }
  });
});

/**
 * @route   POST /api/apikeys
 * @desc    Add/Update API key for a provider
 * @access  Private
 */
exports.addKey = asyncHandler(async (req, res) => {
  const { provider, apiKey, baseUrl, model } = req.body;
  const user = await User.findById(req.user._id);

  // Validate key before saving
  const isValid = await validateProviderKey(provider, apiKey, baseUrl);
  if (!isValid) {
    throw new AppError('Invalid API key. Please check and try again.', 400);
  }

  // Encrypt the key
  const encryptedKey = encryption.encrypt(apiKey, user._id.toString());

  // Add or update key
  const keyData = {
    encryptedKey,
    provider,
    baseUrl: baseUrl || getDefaultBaseUrl(provider),
    model: model || getDefaultModel(provider),
    isActive: false,  // Not active by default
    isValid: true,
    lastValidated: new Date(),
    addedAt: user.apiKeys.has(provider) ? user.apiKeys.get(provider).addedAt : new Date(),
    errorCount: 0
  };

  user.apiKeys.set(provider, keyData);
  await user.save();

  res.json({
    success: true,
    message: 'API key added successfully',
    data: {
      provider,
      isActive: keyData.isActive,
      isValid: keyData.isValid,
      lastValidated: keyData.lastValidated
    }
  });
});

/**
 * @route   PUT /api/apikeys/:provider
 * @desc    Update key settings (activate/deactivate)
 * @access  Private
 */
exports.updateKey = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const { isActive, baseUrl, model } = req.body;
  
  const user = await User.findById(req.user._id);

  if (!user.apiKeys.has(provider)) {
    throw new AppError('API key not found for this provider', 404);
  }

  const keyData = user.apiKeys.get(provider);

  if (isActive !== undefined) {
    keyData.isActive = isActive;
    
    // If activating this key, update BYOK settings
    if (isActive) {
      user.byokSettings.enabled = true;
      user.byokSettings.activeProvider = provider;
      
      // Deactivate other providers
      for (const [p, data] of user.apiKeys) {
        if (p !== provider) {
          data.isActive = false;
        }
      }
    }
  }

  if (baseUrl !== undefined) keyData.baseUrl = baseUrl;
  if (model !== undefined) keyData.model = model;

  user.apiKeys.set(provider, keyData);
  await user.save();

  res.json({
    success: true,
    message: 'API key updated successfully',
    data: {
      provider,
      isActive: keyData.isActive,
      settings: user.byokSettings
    }
  });
});

/**
 * @route   DELETE /api/apikeys/:provider
 * @desc    Delete API key
 * @access  Private
 */
exports.deleteKey = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const user = await User.findById(req.user._id);

  if (!user.apiKeys.has(provider)) {
    throw new AppError('API key not found', 404);
  }

  user.apiKeys.delete(provider);

  // If this was the active provider, disable BYOK
  if (user.byokSettings.activeProvider === provider) {
    user.byokSettings.enabled = false;
    user.byokSettings.activeProvider = null;
  }

  await user.save();

  res.json({
    success: true,
    message: 'API key deleted successfully'
  });
});

/**
 * @route   POST /api/apikeys/:provider/validate
 * @desc    Validate API key (test it works)
 * @access  Private
 */
exports.validateKey = asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const user = await User.findById(req.user._id).select('+apiKeys');

  if (!user.apiKeys.has(provider)) {
    throw new AppError('API key not found', 404);
  }

  // Get encrypted key manually since select: false
  const keyInfo = await user.getDecryptedApiKey(provider);
  if (!keyInfo) {
    throw new AppError('Failed to decrypt API key', 500);
  }

  const isValid = await validateProviderKey(provider, keyInfo.apiKey, keyInfo.baseUrl);

  // Update validation status
  const keyData = user.apiKeys.get(provider);
  keyData.isValid = isValid;
  keyData.lastValidated = new Date();
  if (!isValid) {
    keyData.errorCount += 1;
  }
  user.apiKeys.set(provider, keyData);
  await user.save();

  res.json({
    success: true,
    data: {
      provider,
      isValid,
      lastValidated: keyData.lastValidated
    }
  });
});

/**
 * @route   POST /api/apikeys/settings
 * @desc    Update BYOK settings
 * @access  Private
 */
exports.updateSettings = asyncHandler(async (req, res) => {
  const { enabled, activeProvider, fallbackToSystem } = req.body;
  const user = await User.findById(req.user._id);

  if (enabled !== undefined) {
    user.byokSettings.enabled = enabled;
    
    // If disabling, deactivate all keys
    if (!enabled) {
      for (const [provider, data] of user.apiKeys) {
        data.isActive = false;
      }
      user.byokSettings.activeProvider = null;
    }
  }

  if (activeProvider !== undefined) {
    if (activeProvider && !user.apiKeys.has(activeProvider)) {
      throw new AppError('Provider key not found', 400);
    }
    user.byokSettings.activeProvider = activeProvider;
    
    // Activate the selected provider
    if (activeProvider) {
      for (const [p, data] of user.apiKeys) {
        data.isActive = (p === activeProvider);
      }
    }
  }

  if (fallbackToSystem !== undefined) {
    user.byokSettings.fallbackToSystem = fallbackToSystem;
  }

  await user.save();

  res.json({
    success: true,
    message: 'Settings updated successfully',
    data: user.byokSettings
  });
});

// Helper functions
function getDefaultBaseUrl(provider) {
  const defaults = {
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1'
  };
  return defaults[provider] || null;
}

function getDefaultModel(provider) {
  const defaults = {
    openai: 'gpt-4o-mini',
    groq: 'llama-3.3-70b-versatile',
    gemini: 'gemini-2.0-flash-exp'
  };
  return defaults[provider] || null;
}

async function validateProviderKey(provider, apiKey, baseUrl) {
  try {
    if (provider === 'openai' || provider === 'groq') {
      // Test with a small completion request
      const response = await axios.post(
        `${baseUrl || getDefaultBaseUrl(provider)}/chat/completions`,
        {
          model: getDefaultModel(provider),
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      return response.status === 200;
    } else if (provider === 'gemini') {
      // Gemini uses query param for key
      const response = await axios.post(
        `${baseUrl || getDefaultBaseUrl(provider)}/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: 'Hi' }] }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );
      return response.status === 200;
    }
    return false;
  } catch (error) {
    console.error('Key validation failed:', error.message);
    return false;
  }
}
