const Notebook = require('../models/Notebook');
const Board = require('../models/Board');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const fs = require('fs').promises;
const axios = require('axios');

const AI_ENGINE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';

/**
 * @desc    Get all trashed items (notebooks + boards)
 * @route   GET /api/recycle-bin
 * @access  Private
 */
exports.getTrashItems = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const [notebooks, boards] = await Promise.all([
        Notebook.find({ userId, deletedAt: { $ne: null } })
            .sort({ deletedAt: -1 })
            .select('-sources.content'),
        Board.find({
            $or: [{ owner: userId }],
            deletedAt: { $ne: null }
        })
            .sort({ deletedAt: -1 })
            .populate('owner', 'name email')
            .select('-elements')
    ]);

    // Merge into a unified list with type labels
    const items = [
        ...notebooks.map(n => ({
            _id: n._id,
            type: 'notebook',
            title: n.title,
            description: n.description,
            deletedAt: n.deletedAt,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            sourceCount: n.sources?.length || 0,
            artifactCount: n.artifacts?.length || 0
        })),
        ...boards.map(b => ({
            _id: b._id,
            type: 'board',
            title: b.title,
            description: b.description,
            deletedAt: b.deletedAt,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            memberCount: (b.members?.length || 0) + 1,
            isPublic: b.isPublic
        }))
    ].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

    res.json({
        success: true,
        count: items.length,
        data: items
    });
});

/**
 * @desc    Restore an item from recycle bin
 * @route   PATCH /api/recycle-bin/:type/:id/restore
 * @access  Private
 */
exports.restoreItem = asyncHandler(async (req, res) => {
    const { type, id } = req.params;
    const userId = req.user._id;

    if (type === 'notebook') {
        const notebook = await Notebook.findOne({ _id: id, userId, deletedAt: { $ne: null } });
        if (!notebook) throw new AppError('Notebook not found in recycle bin', 404);

        notebook.deletedAt = null;
        await notebook.save();

        return res.json({ success: true, message: 'Notebook restored successfully', data: { type: 'notebook', _id: id } });
    }

    if (type === 'board') {
        const board = await Board.findOne({ _id: id, owner: userId, deletedAt: { $ne: null } });
        if (!board) throw new AppError('Board not found in recycle bin', 404);

        board.deletedAt = null;
        await board.save();

        return res.json({ success: true, message: 'Board restored successfully', data: { type: 'board', _id: id } });
    }

    throw new AppError('Invalid item type. Must be "notebook" or "board".', 400);
});

/**
 * @desc    Permanently delete an item from recycle bin
 * @route   DELETE /api/recycle-bin/:type/:id
 * @access  Private
 */
exports.permanentlyDeleteItem = asyncHandler(async (req, res) => {
    const { type, id } = req.params;
    const userId = req.user._id;
    const authToken = req.headers.authorization?.split(' ')[1];

    if (type === 'notebook') {
        const notebook = await Notebook.findOne({ _id: id, userId, deletedAt: { $ne: null } });
        if (!notebook) throw new AppError('Notebook not found in recycle bin', 404);

        await permanentlyDeleteNotebook(notebook, authToken);

        return res.json({ success: true, message: 'Notebook permanently deleted' });
    }

    if (type === 'board') {
        const board = await Board.findOne({ _id: id, owner: userId, deletedAt: { $ne: null } });
        if (!board) throw new AppError('Board not found in recycle bin', 404);

        await board.deleteOne();

        return res.json({ success: true, message: 'Board permanently deleted' });
    }

    throw new AppError('Invalid item type. Must be "notebook" or "board".', 400);
});

/**
 * @desc    Empty entire recycle bin
 * @route   DELETE /api/recycle-bin/empty
 * @access  Private
 */
exports.emptyRecycleBin = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const authToken = req.headers.authorization?.split(' ')[1];

    // Find all trashed notebooks
    const trashedNotebooks = await Notebook.find({ userId, deletedAt: { $ne: null } });
    for (const notebook of trashedNotebooks) {
        await permanentlyDeleteNotebook(notebook, authToken);
    }

    // Delete all trashed boards
    await Board.deleteMany({ owner: userId, deletedAt: { $ne: null } });

    res.json({
        success: true,
        message: `Permanently deleted ${trashedNotebooks.length} notebook(s) and removed all trashed boards`
    });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Hard-delete a notebook: remove files, AI sessions, and the DB document.
 */
async function permanentlyDeleteNotebook(notebook, authToken) {
    // Delete all source files from disk
    for (const source of notebook.sources) {
        if (source.filePath) {
            try {
                await fs.unlink(source.filePath);
            } catch (err) {
                console.error(`Failed to delete file: ${source.filePath}`, err.message);
            }
        }
    }

    // Delete AI session and FAISS documents
    if (notebook.aiSessionId && authToken) {
        try {
            await axios.delete(
                `${AI_ENGINE_URL}/ai/sessions/${notebook.aiSessionId}`,
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            await axios.delete(
                `${AI_ENGINE_URL}/ai/documents/session/${notebook.aiSessionId}`,
                { headers: { Authorization: `Bearer ${authToken}` } }
            );
            console.log(`✓ Deleted AI session and FAISS documents for: ${notebook.aiSessionId}`);
        } catch (err) {
            console.error('Failed to delete AI session/documents:', err.message);
        }
    }

    await notebook.deleteOne();
}

// Export helper for use by cron job
exports._permanentlyDeleteNotebook = permanentlyDeleteNotebook;
