const express = require('express');
const router = express.Router();
const multer = require('multer');

// Configure multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Import controllers
const mindMapController = require('../controllers/mindmap.controller');
const quizController = require('../controllers/quiz.controller');
const generateController = require('../controllers/generate.controller');
const subjectController = require('../controllers/subject.controller');

// Import middleware
const { protect } = require('../middlewares/auth.middleware');
const { validateFlashcardSet, validateFlashcard, validateMindMap, validateQuiz } = require('../middlewares/validation.middleware');
const { checkAIUsageLimit, checkFileUploadLimit } = require('../middleware/usageEnforcement');

// ============================================================================
// MIND MAPS ROUTES
// ============================================================================

router.post('/mindmaps', protect, ...validateMindMap, mindMapController.createMindMap);
router.get('/mindmaps', protect, mindMapController.getMindMaps);
router.get('/mindmaps/:id', protect, mindMapController.getMindMapById);
router.put('/mindmaps/:id', protect, ...validateMindMap, mindMapController.updateMindMap);
router.delete('/mindmaps/:id', protect, mindMapController.deleteMindMap);

// Mind Map Versioning
router.post('/mindmaps/:id/version', protect, mindMapController.createVersion);
router.get('/mindmaps/:id/versions', protect, mindMapController.getVersionHistory);
router.post('/mindmaps/:id/archive', protect, mindMapController.archiveMindMap);

// ============================================================================
// QUIZZES ROUTES
// ============================================================================

router.post('/quizzes', protect, ...validateQuiz, quizController.createQuiz);
router.get('/quizzes', protect, (req, res, next) => {
  // Disable caching
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}, quizController.getQuizzes);
router.get('/quizzes/:id', protect, quizController.getQuizById);
router.put('/quizzes/:id', protect, ...validateQuiz, quizController.updateQuiz);
router.delete('/quizzes/:id', protect, quizController.deleteQuiz);

// Quiz from Flashcards
router.post('/quizzes/from-flashcards/:setId', protect, quizController.createFromFlashcards);

// Quiz Attempts
router.post('/quizzes/:id/attempts', protect, quizController.submitAttempt);
router.get('/quizzes/attempts', protect, quizController.getUserAttempts);

// Quiz Statistics
router.get('/quizzes/:id/statistics', protect, quizController.getStatistics);

// ============================================================================
// AI GENERATION ROUTES
// ============================================================================

router.post('/generate/quiz', protect, checkAIUsageLimit, upload.single('file'), generateController.generateQuiz);
router.post('/generate/mindmap', protect, checkAIUsageLimit, generateController.generateMindMap);

// ============================================================================
// VISUAL ENCYCLOPEDIA (FUTURE PLACEHOLDER)
// ============================================================================

router.get('/encyclopedia/topics', protect, (req, res) => {
  res.json({
    success: true,
    message: 'Visual Encyclopedia coming soon!',
    data: {
      placeholder: true,
      features: [
        'Interactive visual knowledge base',
        'Interconnected concepts',
        'Visual learning pathways',
        'Collaborative knowledge building'
      ]
    }
  });
});

// ============================================================================
// SUBJECTS ROUTES
// ============================================================================

router.get('/subjects', protect, subjectController.getSubjects);
router.get('/subjects/:id', protect, subjectController.getSubjectById);
router.post('/subjects', protect, subjectController.createSubject);
router.put('/subjects/:id', protect, subjectController.updateSubject);
router.delete('/subjects/:id', protect, subjectController.deleteSubject);

module.exports = router;
