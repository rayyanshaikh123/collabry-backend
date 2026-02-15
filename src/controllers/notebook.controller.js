const Notebook = require('../models/Notebook');
const Quiz = require('../models/Quiz');
const MindMap = require('../models/MindMap');
const Friendship = require('../models/Friendship');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const notificationService = require('../services/notification.service');
const transcriptionService = require('../services/transcription.service');
const { getIO } = require('../socket');
const { emitNotificationToUser } = require('../socket/notificationNamespace');

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '../../uploads/sources');
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(console.error);

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Helper function to extract text content from source
 */
async function extractSourceContent(source) {
  if (source.type === 'audio' && source.transcriptionSegments?.length > 0) {
    return source.transcriptionSegments
      .map(seg => `[${formatTime(seg.start)}] ${seg.text}`)
      .join('\n');
  }

  // Check for cached content first
  if (source.content && source.content.trim().length > 0) {
    return source.content;
  }

  if (source.type === 'text' || source.type === 'audio') {
    return source.content || source.transcription || '';
  } else if (source.type === 'pdf' || source.type === 'document') {
    if (source.filePath) {
      try {
        console.log(`Extracting text from PDF: ${source.filePath}`);
        const dataBuffer = await fs.readFile(source.filePath);
        const pdfData = await pdfParse(dataBuffer, {
          max: 0,
          verbosity: 0
        });
        const text = pdfData.text;
        console.log(`✓ Extracted ${text.length} characters from PDF: ${source.name}`);
        if (!text || text.length < 10) {
          return `[PDF Document: ${source.name} - No text content extracted.]`;
        }
        return text;
      } catch (err) {
        console.error('Failed to extract text from PDF:', err.message);
        return `[PDF Document: ${source.name} - Unable to extract text. Error: ${err.message}]`;
      }
    }
  } else if (source.type === 'website') {
    return source.content || `[Website: ${source.url}]`;
  }
  return '';
}

function normalizeWebsiteUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  // Add scheme if missing
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractTextFromHtml(html) {
  const $ = cheerio.load(html);

  // Remove non-content
  $('script, style, noscript, svg, canvas, iframe').remove();

  // Prefer main/article content
  const title = ($('title').first().text() || '').trim();
  const candidates = ['main', 'article', '[role="main"]'];
  let text = '';
  for (const selector of candidates) {
    const el = $(selector).first();
    if (el && el.length) {
      text = el.text();
      break;
    }
  }
  if (!text) {
    text = $('body').text();
  }

  // Collapse whitespace
  text = String(text || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

  return { title, text };
}

async function scrapeWebsite(url) {
  const normalized = normalizeWebsiteUrl(url);
  if (!normalized) {
    throw new AppError('Invalid URL. Only http(s) URLs are allowed.', 400);
  }

  const response = await axios.get(normalized, {
    timeout: 20000,
    maxRedirects: 5,
    headers: {
      // Some sites block empty UA
      'User-Agent': 'CollabryBot/1.0 (Study Notebook Website Source)'
    },
    responseType: 'text',
    validateStatus: (status) => status >= 200 && status < 400,
  });

  const contentType = String(response.headers?.['content-type'] || '');
  if (contentType && !contentType.includes('text/html')) {
    // We can still try parsing, but this usually means a PDF/image/etc.
    console.warn(`Website scrape non-HTML content-type: ${contentType}`);
  }

  const html = String(response.data || '');
  const { title, text } = extractTextFromHtml(html);

  if (!text || text.length < 50) {
    throw new AppError('Failed to extract readable text from the website.', 422);
  }

  // Hard cap to keep ingestion predictable
  const maxChars = 200_000;
  const clipped = text.length > maxChars ? text.slice(0, maxChars) + '\n\n[...clipped]' : text;

  return {
    normalizedUrl: normalized,
    title,
    content: `Source URL: ${normalized}\n${title ? `Title: ${title}\n` : ''}\n${clipped}`
  };
}

/**
 * Ingest source content into AI engine's RAG system
 */
async function ingestSourceToRAG(notebook, source, authToken) {
  try {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`RAG INGESTION: ${source.name}`);
    console.log(`${'='.repeat(70)}`);

    // Extract content from source
    const content = await extractSourceContent(source);

    console.log(`Extracted content length: ${content.length} characters`);

    // Skip if extraction failed or content is an error message
    if (!content || content.length < 10) {
      console.log('⚠ Skipping RAG ingest - no content or too short');
      return;
    }

    // Skip if content is an error placeholder
    if (content.startsWith('[PDF Document:') && content.includes('Unable to extract')) {
      console.log('⚠ Skipping RAG ingest - PDF extraction failed');
      return;
    }

    // Send to AI engine's ingest endpoint
    console.log(`Sending to AI engine: ${AI_ENGINE_URL}/ai/upload`);

    const response = await axios.post(
      `${AI_ENGINE_URL}/ai/upload`,
      {
        content: content,
        filename: source.name,
        metadata: {
          notebook_id: notebook._id.toString(),
          source_id: source._id.toString(),
          session_id: notebook.aiSessionId,
          source_type: source.type,
          url: source.url
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      }
    );

    console.log(`✓ RAG ingestion request sent!`);
    console.log(`  Task ID: ${response.data.task_id}`);
    console.log(`  Initial Status: ${response.data.status}`);

    // Poll task status until completed
    const taskId = response.data.task_id;
    let status = response.data.status;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    while (status === 'processing' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      attempts++;

      try {
        const statusResponse = await axios.get(
          `${AI_ENGINE_URL}/ai/upload/status/${taskId}`,
          {
            headers: { 'Authorization': `Bearer ${authToken}` },
            timeout: 5000
          }
        );
        status = statusResponse.data.status;
        console.log(`  Polling (${attempts}s): ${status}`);

        if (status === 'failed' && statusResponse.data && statusResponse.data.error) {
          console.error(`  ❌ Ingestion error: ${statusResponse.data.error}`);
        }

        // If task is unknown (server restarted), assume it completed
        if (status === 'unknown') {
          console.log(`  ℹ Task status unknown (server may have restarted), assuming completed`);
          status = 'completed';
          break;
        }
      } catch (pollErr) {
        console.warn(`  Warning: Failed to poll task status:`, pollErr.message);
        // If it's a 404, the task likely completed and was cleaned up
        if (pollErr.response && pollErr.response.status === 404) {
          console.log(`  ℹ Task not found (404), assuming completed`);
          status = 'completed';
        }
        // If it's a 403, there's an auth issue - log details but continue
        else if (pollErr.response && pollErr.response.status === 403) {
          console.error(`  ⚠️ Auth error (403) accessing task status - user_id mismatch?`);
          console.error(`  Response:`, pollErr.response.data);
          // Don't assume completed for 403 - this is a real error
          status = 'failed';
        }
        break; // Stop polling on error
      }
    }

    if (status === 'completed') {
      console.log(`✅ RAG ingestion completed successfully!`);
    } else if (status === 'failed') {
      console.error(`❌ RAG ingestion failed!`);
    } else {
      console.warn(`⚠ RAG ingestion timeout (still ${status})`);
    }
    console.log(`${'='.repeat(70)}\n`);
  } catch (err) {
    console.error(`\n${'='.repeat(70)}`);
    console.error('❌ RAG INGESTION FAILED');
    console.error(`Error: ${err.message}`);
    if (err.response) {
      console.error(`Response status: ${err.response.status}`);
      console.error(`Response data:`, err.response.data);
    }
    console.error(`${'='.repeat(70)}\n`);
    // Don't throw - this is async and shouldn't block source addition
  }
}


/**
 * @desc    Get all notebooks for current user
 * @route   GET /api/notebook/notebooks
 * @access  Private
 */
exports.getNotebooks = asyncHandler(async (req, res) => {
  const mongoose = require('mongoose');
  const userId = new mongoose.Types.ObjectId(req.user._id);

  const notebooks = await Notebook.find({
    $or: [
      { userId: userId },
      {
        collaborators: {
          $elemMatch: {
            userId: userId,
            status: 'accepted'
          }
        }
      }
    ],
    isArchived: false,
    deletedAt: null
  })
    .sort({ lastAccessed: -1 })
    .select('-sources.content'); // Don't send full content in list

  res.json({
    success: true,
    count: notebooks.length,
    data: notebooks
  });
});

/**
 * @desc    Get single notebook by ID
 * @route   GET /api/notebook/notebooks/:id
 * @access  Private
 */
exports.getNotebook = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id)
    .populate('userId', 'name email avatar')
    .populate('collaborators.userId', 'name email avatar');

  if (!notebook || notebook.deletedAt) {
    throw new AppError('Notebook not found', 404);
  }

  const role = notebook.canAccess(req.user._id);
  if (!role) {
    throw new AppError('You do not have access to this notebook', 403);
  }

  // Create AI session if missing (for notebooks created before AI engine was running)
  if (!notebook.aiSessionId) {
    const token = req.headers.authorization;
    try {
      const aiResponse = await axios.post(
        `${AI_ENGINE_URL}/ai/sessions`,
        {
          title: notebook.title || 'Notebook Session',
          notebook_id: notebook._id
        },
        { headers: { Authorization: token } }
      );
      notebook.aiSessionId = aiResponse.data.id;
      console.log(`✓ Created AI session for notebook: ${notebook._id}`);
    } catch (error) {
      console.error('Failed to create AI session:', error.message);
      // Continue without AI session
    }
  }

  // Update last accessed
  notebook.lastAccessed = new Date();
  await notebook.save();

  res.json({
    success: true,
    data: notebook
  });
});

/**
 * @desc    Create new notebook
 * @route   POST /api/notebook/notebooks
 * @access  Private
 */
exports.createNotebook = asyncHandler(async (req, res) => {
  const { title, description } = req.body;

  const notebook = new Notebook({
    userId: req.user._id,
    title: title || 'Untitled Notebook',
    description
  });

  // Create AI session for this notebook
  const token = req.headers.authorization;
  try {
    const aiResponse = await axios.post(
      `${AI_ENGINE_URL}/ai/sessions`,
      {
        title: title || 'New Notebook Session',
        notebook_id: notebook._id
      },
      { headers: { Authorization: token } }
    );
    notebook.aiSessionId = aiResponse.data.id;
  } catch (error) {
    console.error('Failed to create AI session:', error.message);
    // Continue without AI session - can be created later
  }

  await notebook.save();

  res.status(201).json({
    success: true,
    data: notebook
  });
});

/**
 * @desc    Update notebook
 * @route   PUT /api/notebook/notebooks/:id
 * @access  Private
 */
exports.updateNotebook = asyncHandler(async (req, res) => {
  const { title, description } = req.body;

  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  const role = notebook.canAccess(req.user._id);
  if (role !== 'owner' && role !== 'editor') {
    throw new AppError('You do not have permission to update this notebook', 403);
  }

  if (title) notebook.title = title;
  if (description !== undefined) notebook.description = description;

  await notebook.save();

  res.json({
    success: true,
    data: notebook
  });
});

/**
 * @desc    Delete notebook (soft-delete → moves to recycle bin)
 * @route   DELETE /api/notebook/notebooks/:id
 * @access  Private
 */
exports.deleteNotebook = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findOne({
    _id: req.params.id,
    userId: req.user._id,
    deletedAt: null
  });

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  // Soft-delete: move to recycle bin and wipe collaborators
  notebook.deletedAt = new Date();
  notebook.collaborators = [];
  await notebook.save();

  res.json({
    success: true,
    message: 'Notebook moved to recycle bin'
  });
});

/**
 * @desc    Add source to notebook
 * @route   POST /api/notebook/notebooks/:id/sources
 * @access  Private
 */
exports.addSource = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  if (!notebook.hasPermission(req.user._id, 'canAddSources')) {
    throw new AppError('You do not have permission to add sources to this notebook', 403);
  }

  const { type, name, url, content } = req.body;
  const file = req.file;

  const source = {
    type,
    name: name || file?.originalname || 'Untitled Source',
    selected: true,
    dateAdded: new Date(),
    uploadedBy: req.user._id
  };

  // Handle different source types
  if (type === 'pdf' || type === 'document') {
    if (!file) {
      throw new AppError('File is required for PDF/document sources', 400);
    }

    // Save file to local storage
    const fileName = `${Date.now()}-${file.originalname}`;
    const filePath = path.join(UPLOADS_DIR, fileName);
    await fs.writeFile(filePath, file.buffer);

    source.filePath = filePath;
    source.size = file.size;

    // PERFORMANCE: Extract text immediately during upload for caching
    try {
      console.log(`[PERF] Early extraction for ${source.name}`);
      const text = await extractSourceContent(source);
      if (text && !text.startsWith('[PDF Document:')) {
        source.content = text;
      }
    } catch (err) {
      console.warn(`[PERF] Early extraction failed: ${err.message}`);
    }
  } else if (type === 'website') {
    if (!url) {
      throw new AppError('URL is required for website sources', 400);
    }

    // Scrape website server-side so ingestion uses real text (like PDFs)
    const scraped = await scrapeWebsite(url);
    source.url = scraped.normalizedUrl;
    source.content = scraped.content;
    source.size = scraped.content.length;

    // If the client passed name=url, replace with page title/hostname for nicer UI
    const clientName = String(name || '').trim();
    const derivedName = scraped.title || new URL(scraped.normalizedUrl).hostname;
    if (!clientName || clientName === url || clientName === scraped.normalizedUrl) {
      source.name = derivedName;
    }
  } else if (type === 'audio') {
    if (!file) {
      throw new AppError('Audio file is required for audio sources', 400);
    }

    // Save audio file to local storage
    const fileName = `${Date.now()}-${file.originalname}`;
    const filePath = path.join(UPLOADS_DIR, fileName);
    await fs.writeFile(filePath, file.buffer);

    source.filePath = filePath;
    source.size = file.size;
    source.transcriptionStatus = 'pending';
  } else if (type === 'text') {
    if (!content) {
      throw new AppError('Content is required for text sources', 400);
    }
    source.content = content;
    source.size = content.length;
  } else {
    throw new AppError('Invalid source type', 400);
  }

  notebook.sources.push(source);
  await notebook.save();

  // Track storage usage
  const sourceSize = source.size || 0;
  if (sourceSize > 0) {
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, { $inc: { storageUsed: sourceSize } });
  }

  // Track file upload milestone
  if (type === 'pdf' || type === 'document' || type === 'audio') {
    const { trackFileUpload } = require('../middleware/usageEnforcement');
    await trackFileUpload(req.user._id);
  }

  // Get the added source with its ID
  const addedSource = notebook.sources[notebook.sources.length - 1];

  // START BACKGROUND PROCESSING (Transcription -> Ingestion)
  // We don't await this so the user gets a 201 immediately
  const authToken = req.headers.authorization?.split(' ')[1];
  processSourceInBackground(notebook._id, addedSource._id, authToken, req.user._id);

  res.status(201).json({
    success: true,
    data: addedSource
  });
});

/**
 * Background worker to handle transcription and RAG ingestion
 */
async function processSourceInBackground(notebookId, sourceId, authToken, uploaderId) {
  try {
    console.log(`[BACKGROUND] Starting processing for source ${sourceId} in notebook ${notebookId}`);
    
    // 1. Fetch fresh notebook and source
    const notebook = await Notebook.findById(notebookId);
    if (!notebook) return;
    const source = notebook.sources.id(sourceId);
    if (!source) return;

    const io = getIO();
    const room = `notebook:${notebookId}`;

    // 2. Handle Transcription (if audio and not already done)
    if (source.type === 'audio' && source.transcriptionStatus !== 'completed') {
      try {
        source.transcriptionStatus = 'processing';
        await notebook.save();
        
        // Broadcast start
        if (io) io.of('/notebook-collab').to(room).emit('source:update', { action: 'updated', source });

        const results = await transcriptionService.transcribeAudio(source.filePath, source.name);
        
        source.transcription = results.text;
        source.content = results.text;
        source.duration = results.duration;
        source.transcriptionSegments = results.segments;
        source.transcriptionStatus = 'completed';
        await notebook.save();

        console.log(`[BACKGROUND] Transcription completed for ${source.name}`);
        if (io) io.of('/notebook-collab').to(room).emit('source:update', { action: 'updated', source });
      } catch (err) {
        console.error(`[BACKGROUND] Transcription failed:`, err.message);
        source.transcriptionStatus = 'failed';
        source.transcriptionError = err.message;
        source.content = `[Audio File: ${source.name} - Transcription failed: ${err.message}]`;
        await notebook.save();
        if (io) io.of('/notebook-collab').to(room).emit('source:update', { action: 'updated', source });
      }
    }

    // 3. Handle RAG Ingestion
    if (authToken && notebook.aiSessionId) {
      try {
        source.ragStatus = 'processing';
        await notebook.save();
        if (io) io.of('/notebook-collab').to(room).emit('source:update', { action: 'updated', source });

        await ingestSourceToRAG(notebook, source, authToken);
        
        // Re-fetch source status (ingestSourceToRAG doesn't update source object in this scope)
        // Wait, ingestSourceToRAG should ideally update the source status. 
        // Let's modify ingestSourceToRAG to update the database.
        
        source.ragStatus = 'completed';
        await notebook.save();
        console.log(`[BACKGROUND] RAG Ingestion completed for ${source.name}`);

        // Notify user via notification system
        try {
          const notification = await notificationService.notifyDocumentProcessed(uploaderId, source.name);
          emitNotificationToUser(io, uploaderId, notification);
        } catch (e) { /* ignore */ }

        if (io) io.of('/notebook-collab').to(room).emit('source:update', { action: 'updated', source });
      } catch (err) {
        console.error(`[BACKGROUND] RAG Ingestion failed:`, err.message);
        source.ragStatus = 'failed';
        source.ragError = err.message;
        await notebook.save();
        if (io) io.of('/notebook-collab').to(room).emit('source:update', { action: 'updated', source });
      }
    }

  } catch (err) {
    console.error(`[BACKGROUND] Fatal error in background processing:`, err);
  }
}

/**
 * @desc    Remove source from notebook
 * @route   DELETE /api/notebook/notebooks/:id/sources/:sourceId
 * @access  Private
 */
exports.removeSource = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  const source = notebook.sources.id(req.params.sourceId);

  if (!source) {
    throw new AppError('Source not found', 404);
  }

  // Check permissions: Owner can remove any source, collaborators only their own
  const role = notebook.canAccess(req.user._id);
  const isUploader = source.uploadedBy && source.uploadedBy.toString() === req.user._id.toString();

  if (role !== 'owner' && !isUploader) {
    throw new AppError('You do not have permission to remove this source', 403);
  }

  // Delete file if exists
  if (source.filePath) {
    try {
      await fs.unlink(source.filePath);
      console.log(`✓ Deleted file: ${source.filePath}`);
    } catch (error) {
      console.error(`Failed to delete file: ${source.filePath}`, error.message);
    }
  }

  // Delete from FAISS index
  if (notebook.aiSessionId) {
    const token = req.headers.authorization;
    try {
      await axios.delete(
        `${AI_ENGINE_URL}/ai/documents/source/${source._id}`,
        { headers: { Authorization: token } }
      );
      console.log(`✓ Deleted FAISS documents for source: ${source._id}`);
    } catch (error) {
      console.error('Failed to delete source from FAISS:', error.message);
    }
  }

  // Reclaim storage
  const sourceSize = source.size || 0;
  if (sourceSize > 0) {
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, { $inc: { storageUsed: -sourceSize } });
  }

  source.deleteOne();
  await notebook.save();

  res.json({
    success: true,
    message: 'Source removed successfully'
  });
});

/**
 * @desc    Toggle source selection
 * @route   PATCH /api/notebook/notebooks/:id/sources/:sourceId
 * @access  Private
 */
exports.toggleSource = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  const role = notebook.canAccess(req.user._id);
  if (!role || role === 'viewer') {
    throw new AppError('You do not have permission to toggle sources', 403);
  }

  const source = notebook.sources.id(req.params.sourceId);

  if (!source) {
    throw new AppError('Source not found', 404);
  }

  source.selected = !source.selected;
  await notebook.save();

  res.json({
    success: true,
    data: source
  });
});

/**
 * @desc    Get source content (for chat context)
 * @route   GET /api/notebook/notebooks/:id/sources/:sourceId/content
 * @access  Private
 */
exports.getSourceContent = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  if (!notebook.canAccess(req.user._id)) {
    throw new AppError('Access denied', 403);
  }

  const source = notebook.sources.id(req.params.sourceId);

  if (!source) {
    throw new AppError('Source not found', 404);
  }

  let content = '';

  try {
    content = await extractSourceContent(source);
  } catch (error) {
    content = `[Error extracting content: ${source.name}]`;
  }

  res.json({
    success: true,
    data: {
      id: source._id,
      name: source.name,
      type: source.type,
      content,
      // Include audio-specific fields if available
      transcription: source.transcription,
      transcriptionSegments: source.transcriptionSegments,
      transcriptionStatus: source.transcriptionStatus,
      duration: source.duration
    }
  });
});

/**
 * @desc    Stream audio source file
 * @route   GET /api/notebook/notebooks/:id/sources/:sourceId/audio
 * @access  Private
 */
exports.streamAudioSource = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  if (!notebook.canAccess(req.user._id)) {
    throw new AppError('Access denied', 403);
  }

  const source = notebook.sources.id(req.params.sourceId);

  if (!source || source.type !== 'audio' || !source.filePath) {
    throw new AppError('Audio source not found or invalid', 404);
  }

  try {
    const stats = await fs.stat(source.filePath);
    
    // Set appropriate content type
    const ext = path.extname(source.filePath).toLowerCase();
    let contentType = 'audio/mpeg'; // default
    if (ext === '.wav') contentType = 'audio/wav';
    else if (ext === '.m4a') contentType = 'audio/mp4';
    else if (ext === '.ogg') contentType = 'audio/ogg';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes'
    });

    const stream = require('fs').createReadStream(source.filePath);
    stream.pipe(res);
  } catch (err) {
    console.error(`[AUDIO STREAM] Error: ${err.message}`);
    throw new AppError('Error streaming audio file', 500);
  }
});

/**
 * @desc    Link artifact to notebook
 * @route   POST /api/notebook/notebooks/:id/artifacts
 * @access  Private
 */
exports.linkArtifact = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  if (!notebook.hasPermission(req.user._id, 'canGenerateArtifacts')) {
    throw new AppError('You do not have permission to link artifacts', 403);
  }

  const { type, referenceId, title, data } = req.body;

  // Validate artifact exists (only for types with backend collections)
  if (type === 'quiz') {
    // Quiz model stores owner in `createdBy`
    const quiz = await Quiz.findOne({ _id: referenceId, createdBy: req.user._id });
    if (!quiz) throw new AppError('Quiz not found', 404);
  } else if (type === 'mindmap') {
    // MindMap model stores owner in `createdBy`
    const mindmap = await MindMap.findOne({ _id: referenceId, createdBy: req.user._id });
    if (!mindmap) throw new AppError('Mind map not found', 404);
  }
  // Note: flashcards and infographic types don't have backend collections yet
  // They store data inline in the artifact

  // Check if already linked
  const existing = notebook.artifacts.find(
    a => a.type === type && a.referenceId.toString() === referenceId.toString()
  );

  if (existing) {
    return res.json({
      success: true,
      message: 'Artifact already linked',
      data: existing
    });
  }

  const artifactData = {
    type,
    referenceId,
    title: title || `${type.charAt(0).toUpperCase() + type.slice(1)}`
  };

  // Add inline data if provided (for flashcards, infographics)
  if (data) {
    artifactData.data = data;
  }

  notebook.artifacts.push(artifactData);

  await notebook.save();

  const addedArtifact = notebook.artifacts[notebook.artifacts.length - 1];

  res.status(201).json({
    success: true,
    data: addedArtifact
  });
});

/**
 * @desc    Unlink artifact from notebook
 * @route   DELETE /api/notebook/notebooks/:id/artifacts/:artifactId
 * @access  Private
 */
exports.unlinkArtifact = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  const role = notebook.canAccess(req.user._id);
  if (role !== 'owner' && role !== 'editor') {
    throw new AppError('You do not have permission to unlink artifacts', 403);
  }

  const artifact = notebook.artifacts.id(req.params.artifactId);

  if (!artifact) {
    throw new AppError('Artifact not found', 404);
  }

  artifact.deleteOne();
  await notebook.save();

  res.json({
    success: true,
    message: 'Artifact unlinked successfully'
  });
});

/**
 * @desc    Get selected sources content for chat context
 * @route   GET /api/notebook/notebooks/:id/context
 * @access  Private
 */
exports.getNotebookContext = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  if (!notebook.canAccess(req.user._id)) {
    throw new AppError('Access denied', 403);
  }

  const selectedSources = notebook.sources.filter(s => s.selected);
  const context = [];

  let hasMisingContent = false;

  for (const source of selectedSources) {
    let content = source.content || '';

    // Lazy caching: if content missing, extract it now
    if (!content || content.length < 10) {
      try {
        console.log(`[PERF] Lazy caching content for source: ${source.name}`);
        content = await extractSourceContent(source);
        if (content && !content.startsWith('[PDF Document:')) {
          source.content = content;
          hasMisingContent = true;
        }
      } catch (error) {
        content = `[Error extracting content: ${source.name}]`;
      }
    }

    context.push({
      id: source._id,
      name: source.name,
      type: source.type,
      content: content.substring(0, 10000) // Limit to prevent huge payloads
    });
  }

  // Save changes if any sources were lazy-cached
  if (hasMisingContent) {
    console.log(`[PERF] Saving notebook ${notebook._id} with lazy-cached source content`);
    await notebook.save();
  }

  res.json({
    success: true,
    data: {
      notebookId: notebook._id,
      aiSessionId: notebook.aiSessionId,
      sources: context
    }
  });
});


/**
 * @desc    Get all collaborators for a notebook
 * @route   GET /api/notebook/notebooks/:id/collaborators
 * @access  Private
 */
exports.getCollaborators = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id)
    .populate('collaborators.userId', 'name email avatar')
    .populate('collaborators.invitedBy', 'name');

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  if (!notebook.canAccess(req.user._id)) {
    throw new AppError('Access denied', 403);
  }

  res.json({
    success: true,
    data: notebook.collaborators
  });
});

/**
 * @desc    Invite collaborator to notebook
 * @route   POST /api/notebook/notebooks/:id/collaborators/invite
 * @access  Private
 */
exports.inviteCollaborator = asyncHandler(async (req, res) => {
  const { email, role = 'editor' } = req.body;

  if (!email) {
    throw new AppError('Email is required', 400);
  }

  const notebook = await Notebook.findById(req.params.id);

  if (!notebook || notebook.deletedAt) {
    throw new AppError('Notebook not found', 404);
  }

  // Only owner or those with 'canInvite' permission
  if (!notebook.hasPermission(req.user._id, 'canInvite')) {
    throw new AppError('You do not have permission to invite collaborators', 403);
  }

  // Find user by email
  const User = require('../models/User');
  const userToInvite = await User.findOne({ email: email.toLowerCase().trim() });

  if (!userToInvite) {
    throw new AppError('User not found with this email', 404);
  }

  // Check if already a collaborator or owner
  if (notebook.userId.toString() === userToInvite._id.toString()) {
    throw new AppError('User is already the owner of this notebook', 400);
  }

  const existingCollab = notebook.collaborators.find(
    c => c.userId.toString() === userToInvite._id.toString()
  );

  if (existingCollab) {
    if (existingCollab.status === 'accepted' || !existingCollab.status) {
      throw new AppError('User is already a collaborator in this notebook', 400);
    }
    // If already pending, we'll just resend the notification below
  } else {
    // Add collaborator with pending status
    notebook.collaborators.push({
      userId: userToInvite._id,
      role,
      invitedBy: req.user._id,
      status: 'pending'
    });
    await notebook.save();
  }

  // Send notification to invited user
  try {
    const notification = await notificationService.notifyNotebookInvite(
      userToInvite._id,
      notebook.title,
      req.user.name,
      notebook._id
    );

    const io = getIO();
    emitNotificationToUser(io, userToInvite._id, notification);
  } catch (err) {
    console.error('Failed to send invite notification:', err);
  }

  res.json({
    success: true,
    message: 'Invitation sent successfully'
  });
});/**
 * @desc    Remove collaborator from notebook
 * @route   DELETE /api/notebook/notebooks/:id/collaborators/:userId
 * @access  Private
 */
exports.removeCollaborator = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  // Only owner can remove collaborators (or a collaborator can remove themselves)
  const isOwner = notebook.userId.toString() === req.user._id.toString();
  const isSelf = req.params.userId === req.user._id.toString();

  if (!isOwner && !isSelf) {
    throw new AppError('You do not have permission to remove collaborators', 403);
  }

  notebook.collaborators = notebook.collaborators.filter(
    c => c.userId.toString() !== req.params.userId
  );

  await notebook.save();

  res.json({
    success: true,
    message: 'Collaborator removed successfully'
  });
});

/**
 * @desc    Update collaborator role/permissions
 * @route   PATCH /api/notebook/notebooks/:id/collaborators/:userId/role
 * @access  Private
 */
exports.updateCollaboratorRole = asyncHandler(async (req, res) => {
  const { role, permissions } = req.body;

  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  // Only owner can update roles
  if (notebook.userId.toString() !== req.user._id.toString()) {
    throw new AppError('Only the owner can update collaborator roles', 403);
  }

  const collab = notebook.collaborators.find(
    c => c.userId.toString() === req.params.userId
  );

  if (!collab) {
    throw new AppError('Collaborator not found', 404);
  }

  if (role) collab.role = role;
  if (permissions) {
    collab.permissions = { ...collab.permissions.toObject(), ...permissions };
  }

  await notebook.save();

  res.json({
    success: true,
    message: 'Collaborator role updated successfully'
  });
});

/**
 * @desc    Generate/get share code for notebook
 * @route   POST /api/notebook/notebooks/:id/share-link
 * @access  Private
 */
exports.generateShareLink = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);

  if (!notebook) {
    throw new AppError('Notebook not found', 404);
  }

  if (notebook.userId.toString() !== req.user._id.toString()) {
    throw new AppError('Only the owner can manage share links', 403);
  }

  const shareCode = notebook.generateShareCode();
  notebook.isShared = true;
  await notebook.save();

  res.json({
    success: true,
    data: {
      shareCode,
      shareUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/notebooks/join/${shareCode}`
    }
  });
});

/**
 * @desc    Join notebook via share code
 * @route   POST /api/notebook/notebooks/join/:shareCode
 * @access  Private
 */
exports.joinViaShareCode = asyncHandler(async (req, res) => {
  const { shareCode } = req.params;

  const notebook = await Notebook.findOne({ shareCode, isShared: true });

  if (!notebook) {
    throw new AppError('Invalid or expired share link', 404);
  }

  // Check if already owner or collaborator
  const existingRole = notebook.canAccess(req.user._id);
  if (existingRole) {
    return res.json({
      success: true,
      message: 'You already have access to this notebook',
      data: { notebookId: notebook._id }
    });
  }

  // Add as collaborator (default to editor or viewer based on notebook settings)
  notebook.collaborators.push({
    userId: req.user._id,
    role: notebook.settings?.defaultShareRole || 'editor',
    status: 'accepted',
    joinedAt: new Date()
  });

  await notebook.save();

  res.json({
    success: true,
    message: 'Successfully joined notebook',
    data: { notebookId: notebook._id }
  });
});

module.exports = exports;

/**
 * @desc    Get friends that can be invited to a notebook
 * @route   GET /api/notebook/notebooks/:id/friends
 * @access  Private
 */
exports.getFriendsToInvite = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);
  if (!notebook || notebook.deletedAt) {
    throw new AppError('Notebook not found', 404);
  }

  // Get active friendships
  const friendships = await Friendship.find({
    $or: [{ user1: req.user._id }, { user2: req.user._id }],
    status: 'active'
  }).populate('user1 user2', 'name email avatar');

  // Extract friend user objects
  const friends = friendships.map(f => {
    return f.user1._id.toString() === req.user._id.toString() ? f.user2 : f.user1;
  });

  // Filter out those who are already collaborators OR the owner
  const collaboratorIds = notebook.collaborators.map(c => c.userId.toString());
  collaboratorIds.push(notebook.userId.toString());

  const inviteableFriends = friends.filter(friend =>
    !collaboratorIds.includes(friend._id.toString())
  );

  res.json({
    success: true,
    data: inviteableFriends
  });
});

/**
 * @desc    Get all pending invitations for the current user
 * @route   GET /api/notebook/invitations/pending
 * @access  Private
 */
exports.getPendingInvitations = asyncHandler(async (req, res) => {
  const notebooks = await Notebook.find({
    deletedAt: null, // Only non-deleted notebooks
    collaborators: {
      $elemMatch: {
        userId: req.user._id,
        status: 'pending'
      }
    }
  }).populate('userId', 'name email avatar').select('title description userId collaborators createdAt');

  // Format response to include who invited them
  const invitations = notebooks.map(nb => {
    const collabInfo = nb.collaborators.find(c => c.userId.toString() === req.user._id.toString());

    // Safety check just in case
    if (!collabInfo) return null;

    return {
      notebookId: nb._id,
      title: nb.title,
      description: nb.description,
      owner: nb.userId,
      invitedBy: collabInfo.invitedBy,
      role: collabInfo.role,
      invitedAt: collabInfo.status === 'pending' ? collabInfo.invitedAt : collabInfo.joinedAt
    };
  }).filter(Boolean); // Remove nulls if safety check triggered

  res.json({
    success: true,
    data: invitations
  });
});

/**
 * @desc    Accept a notebook invitation
 * @route   POST /api/notebook/notebooks/:id/invitations/accept
 * @access  Private
 */
exports.acceptInvitation = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);
  if (!notebook || notebook.deletedAt) {
    throw new AppError('Notebook not found', 404);
  }

  const collaborator = notebook.collaborators.find(
    c => c.userId.toString() === req.user._id.toString()
  );

  if (!collaborator) {
    throw new AppError('Invitation not found', 404);
  }

  if (collaborator.status === 'accepted') {
    return res.json({ success: true, message: 'Invitation already accepted' });
  }

  collaborator.status = 'accepted';
  collaborator.joinedAt = new Date();

  await notebook.save();

  res.json({
    success: true,
    message: 'Invitation accepted successfully'
  });
});

/**
 * @desc    Reject a notebook invitation
 * @route   POST /api/notebook/notebooks/:id/invitations/reject
 * @access  Private
 */
exports.rejectInvitation = asyncHandler(async (req, res) => {
  const notebook = await Notebook.findById(req.params.id);
  if (!notebook || notebook.deletedAt) {
    throw new AppError('Notebook not found', 404);
  }

  // Remove the user from collaborators array
  const initialCount = notebook.collaborators.length;
  notebook.collaborators = notebook.collaborators.filter(
    c => c.userId.toString() !== req.user._id.toString()
  );

  if (notebook.collaborators.length === initialCount) {
    throw new AppError('Invitation not found', 404);
  }

  await notebook.save();

  res.json({
    success: true,
    message: 'Invitation rejected successfully'
  });
});
