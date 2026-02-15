const express = require('express');
const router = express.Router();
const boardController = require('../controllers/board.controller');
const { protect } = require('../middlewares/auth.middleware');
const { body, param, query, validationResult } = require('express-validator');
const { checkBoardLimit } = require('../middleware/usageEnforcement');

// Validation middleware
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

// Validation middleware
const validateBoardCreation = [
  body('title')
    .trim()
    .notEmpty().withMessage('Board title is required')
    .isLength({ max: 100 }).withMessage('Title cannot exceed 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('isPublic')
    .optional()
    .isBoolean().withMessage('isPublic must be a boolean'),
  body('tags')
    .optional()
    .isArray().withMessage('Tags must be an array'),
  validate
];

const validateBoardUpdate = [
  body('title')
    .optional()
    .trim()
    .notEmpty().withMessage('Board title cannot be empty')
    .isLength({ max: 100 }).withMessage('Title cannot exceed 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('isPublic')
    .optional()
    .isBoolean().withMessage('isPublic must be a boolean'),
  validate
];

const validateMemberAdd = [
  body('userId')
    .notEmpty().withMessage('User ID is required')
    .isMongoId().withMessage('Invalid user ID'),
  body('role')
    .optional()
    .isIn(['editor', 'viewer']).withMessage('Role must be either editor or viewer'),
  validate
];

const validateMemberRoleUpdate = [
  body('role')
    .notEmpty().withMessage('Role is required')
    .isIn(['editor', 'viewer']).withMessage('Role must be either editor or viewer'),
  validate
];

const validateObjectId = [
  param('id').isMongoId().withMessage('Invalid board ID'),
  validate
];

// All routes require authentication
router.use(protect);

// Search boards (must be before /:id routes)
router.get('/search', boardController.searchBoards);

// Board CRUD
router.route('/')
  .get(boardController.getBoards)
  .post(validateBoardCreation, checkBoardLimit, boardController.createBoard);

// Board actions (before /:id to avoid conflicts)
router.post('/:id/invite', 
  validateObjectId,
  body('email').isEmail().withMessage('Valid email is required'),
  body('role').optional().isIn(['editor', 'viewer']).withMessage('Role must be either editor or viewer'),
  validate,
  boardController.inviteMember
);

router.patch('/:id/archive', validateObjectId, boardController.archiveBoard);
router.post('/:id/duplicate', validateObjectId, checkBoardLimit, boardController.duplicateBoard);

// Member management
router.route('/:id/members')
  .post(validateObjectId, validateMemberAdd, boardController.addMember);

router.route('/:id/members/:userId')
  .delete(validateObjectId, boardController.removeMember)
  .patch(validateObjectId, validateMemberRoleUpdate, boardController.updateMemberRole);

// Board CRUD by ID (must be after specific routes)
router.route('/:id')
  .get(validateObjectId, boardController.getBoard)
  .patch(validateObjectId, validateBoardUpdate, boardController.updateBoard)
  .delete(validateObjectId, boardController.deleteBoard);

module.exports = router;
