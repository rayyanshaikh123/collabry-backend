const express = require('express');
const router = express.Router();
const multer = require('multer');
const notebookController = require('../controllers/notebook.controller');
const { protect } = require('../middlewares/auth.middleware');
const { checkFileUploadLimit, checkStorageLimit, checkNotebookLimit } = require('../middleware/usageEnforcement');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// ============================================================================
// NOTEBOOK MANAGEMENT
// ============================================================================

router.get('/notebooks', protect, notebookController.getNotebooks);
router.post('/notebooks', protect, checkNotebookLimit, notebookController.createNotebook);
router.get('/notebooks/:id', protect, notebookController.getNotebook);
router.put('/notebooks/:id', protect, notebookController.updateNotebook);
router.delete('/notebooks/:id', protect, notebookController.deleteNotebook);

// ============================================================================
// SOURCE MANAGEMENT
// ============================================================================

router.post('/notebooks/:id/sources', protect, checkFileUploadLimit, checkStorageLimit, upload.single('file'), notebookController.addSource);
router.delete('/notebooks/:id/sources/:sourceId', protect, notebookController.removeSource);
router.patch('/notebooks/:id/sources/:sourceId', protect, notebookController.toggleSource);
router.get('/notebooks/:id/sources/:sourceId/content', protect, notebookController.getSourceContent);
router.get('/notebooks/:id/sources/:sourceId/audio', protect, notebookController.streamAudioSource);

// ============================================================================
// ARTIFACT LINKING
// ============================================================================

router.post('/notebooks/:id/artifacts', protect, notebookController.linkArtifact);
router.delete('/notebooks/:id/artifacts/:artifactId', protect, notebookController.unlinkArtifact);

// ============================================================================
// CONTEXT RETRIEVAL (for AI chat)
// ============================================================================

router.get('/notebooks/:id/context', protect, notebookController.getNotebookContext);

// ============================================================================
// COLLABORATION
// ============================================================================

router.get('/notebooks/:id/collaborators', protect, notebookController.getCollaborators);
router.post('/notebooks/:id/collaborators/invite', protect, notebookController.inviteCollaborator);
router.delete('/notebooks/:id/collaborators/:userId', protect, notebookController.removeCollaborator);
router.patch('/notebooks/:id/collaborators/:userId/role', protect, notebookController.updateCollaboratorRole);
router.post('/notebooks/:id/share-link', protect, notebookController.generateShareLink);
router.post('/notebooks/join/:shareCode', protect, notebookController.joinViaShareCode);

// Invitation Management
router.get('/invitations/pending', protect, notebookController.getPendingInvitations);
router.post('/notebooks/:id/invitations/accept', protect, notebookController.acceptInvitation);
router.post('/notebooks/:id/invitations/reject', protect, notebookController.rejectInvitation);

// Friends Integration
router.get('/notebooks/:id/friends', protect, notebookController.getFriendsToInvite);

module.exports = router;
