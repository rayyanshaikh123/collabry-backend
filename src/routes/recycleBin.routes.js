const express = require('express');
const router = express.Router();
const recycleBinController = require('../controllers/recycleBin.controller');
const { protect } = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(protect);

// List all trashed items
router.get('/', recycleBinController.getTrashItems);

// Empty entire recycle bin (must be before /:type/:id to avoid conflicts)
router.delete('/empty', recycleBinController.emptyRecycleBin);

// Restore a trashed item
router.patch('/:type/:id/restore', recycleBinController.restoreItem);

// Permanently delete a trashed item
router.delete('/:type/:id', recycleBinController.permanentlyDeleteItem);

module.exports = router;
