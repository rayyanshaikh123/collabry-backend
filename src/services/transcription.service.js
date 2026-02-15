const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Transcribe audio file using OpenAI Whisper API
 * @param {Buffer|string} audioInput - Audio buffer or file path
 * @param {string} filename - Original filename
 * @param {string} language - Language code (optional, defaults to auto-detect)
 * @returns {Promise<{text: string, duration: number, segments: Array}>}
 */
async function transcribeAudio(audioInput, filename, language = 'en') {
  try {
    console.log(`🎤 Starting transcription for: ${filename}`);
    
    // Create a temporary file if input is a buffer
    let filePath;
    let shouldCleanup = false;
    
    if (Buffer.isBuffer(audioInput)) {
      const tempDir = path.join(__dirname, '../../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      filePath = path.join(tempDir, `temp_${Date.now()}_${filename}`);
      fs.writeFileSync(filePath, audioInput);
      shouldCleanup = true;
    } else {
      filePath = audioInput;
    }
    
    // Transcribe using Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1',
      language: language,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });
    
    // Clean up temporary file
    if (shouldCleanup && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    console.log(`✅ Transcription completed: ${transcription.text.length} characters`);
    
    return {
      text: transcription.text,
      duration: transcription.duration || 0,
      segments: transcription.segments || [],
      language: transcription.language || language
    };
    
  } catch (error) {
    console.error('❌ Transcription error:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

/**
 * Get supported audio formats
 */
function getSupportedFormats() {
  return ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'ogg', 'flac'];
}

/**
 * Check if file format is supported
 * @param {string} filename
 * @returns {boolean}
 */
function isSupportedFormat(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  return getSupportedFormats().includes(ext);
}

/**
 * Estimate transcription cost (Whisper pricing: $0.006 per minute)
 * @param {number} durationSeconds
 * @returns {number} Cost in USD
 */
function estimateCost(durationSeconds) {
  const minutes = durationSeconds / 60;
  return minutes * 0.006;
}

module.exports = {
  transcribeAudio,
  getSupportedFormats,
  isSupportedFormat,
  estimateCost
};
