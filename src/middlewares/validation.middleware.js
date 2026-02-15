const { body, validationResult } = require('express-validator');

/**
 * Validation middleware runner
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

/**
 * Flashcard Set validation
 */
const validateFlashcardSet = [
  body('title')
    .trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
  body('subject')
    .optional({ checkFalsy: true })
    .isMongoId().withMessage('Invalid subject ID'),
  body('sourceType')
    .optional()
    .isIn(['manual', 'ai', 'study_buddy']).withMessage('Invalid source type'),
  body('visibility')
    .optional()
    .isIn(['private', 'shared']).withMessage('Invalid visibility option'),
  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array'),
  validate
];

/**
 * Flashcard validation
 */
const validateFlashcard = [
  body('question')
    .trim()
    .notEmpty().withMessage('Question is required'),
  body('answer')
    .trim()
    .notEmpty().withMessage('Answer is required'),
  body('difficulty')
    .optional()
    .isIn(['easy', 'medium', 'hard']).withMessage('Invalid difficulty level'),
  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array'),
  body('options')
    .optional()
    .isArray().withMessage('Options must be an array'),
  body('explanation')
    .optional()
    .trim(),
  body('order')
    .optional()
    .isInt({ min: 0 }).withMessage('Order must be a positive integer'),
  body('confidence')
    .optional()
    .isInt({ min: 0, max: 5 }).withMessage('Confidence must be between 0 and 5'),
  validate
];

/**
 * Mind Map validation
 */
const validateMindMap = [
  body('title')
    .trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
  body('topic')
    .trim()
    .notEmpty().withMessage('Topic is required'),
  body('subject')
    .optional({ checkFalsy: true })
    .isMongoId().withMessage('Invalid subject ID'),
  body('sourceType')
    .optional()
    .isIn(['manual', 'ai', 'study_buddy']).withMessage('Invalid source type'),
  body('visibility')
    .optional()
    .isIn(['private', 'shared']).withMessage('Invalid visibility option'),
  body('nodes')
    .optional()
    .isArray().withMessage('Nodes must be an array'),
  body('nodes.*.id')
    .optional()
    .notEmpty().withMessage('Node ID is required'),
  body('nodes.*.label')
    .optional()
    .trim()
    .notEmpty().withMessage('Node label is required'),
  body('nodes.*.type')
    .optional()
    .isIn(['root', 'branch', 'leaf', 'concept', 'example', 'note']).withMessage('Invalid node type'),
  body('edges')
    .optional()
    .isArray().withMessage('Edges must be an array'),
  body('edges.*.id')
    .optional()
    .notEmpty().withMessage('Edge ID is required'),
  body('edges.*.from')
    .optional()
    .notEmpty().withMessage('Edge from is required'),
  body('edges.*.to')
    .optional()
    .notEmpty().withMessage('Edge to is required'),
  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array'),
  validate
];

/**
 * Quiz validation
 */
const validateQuiz = [
  body('title')
    .trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ max: 200 }).withMessage('Title cannot exceed 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
  body('subject')
    .optional({ checkFalsy: true })
    .isMongoId().withMessage('Invalid subject ID'),
  body('linkedSetId')
    .optional({ checkFalsy: true })
    .isMongoId().withMessage('Invalid linked set ID'),
  body('sourceType')
    .optional()
    .isIn(['manual', 'ai', 'study_buddy', 'flashcards']).withMessage('Invalid source type'),
  body('visibility')
    .optional()
    .isIn(['private', 'shared']).withMessage('Invalid visibility option'),
  body('questions')
    .optional()
    .isArray().withMessage('Questions must be an array'),
  body('questions.*.question')
    .optional()
    .trim()
    .notEmpty().withMessage('Question text is required'),
  body('questions.*.options')
    .optional()
    .isArray().withMessage('Options must be an array')
    .custom((options) => options.length >= 2).withMessage('At least 2 options required'),
  body('questions.*.correctAnswer')
    .optional()
    .trim()
    .notEmpty().withMessage('Correct answer is required'),
  body('questions.*.difficulty')
    .optional()
    .isIn(['easy', 'medium', 'hard']).withMessage('Invalid difficulty level'),
  body('questions.*.points')
    .optional()
    .isInt({ min: 1 }).withMessage('Points must be at least 1'),
  body('timeLimit')
    .optional()
    .isInt({ min: 1 }).withMessage('Time limit must be positive'),
  body('passingScore')
    .optional()
    .isInt({ min: 0, max: 100 }).withMessage('Passing score must be between 0 and 100'),
  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array'),
  validate
];

module.exports = {
  validateFlashcardSet,
  validateFlashcard,
  validateMindMap,
  validateQuiz
};
