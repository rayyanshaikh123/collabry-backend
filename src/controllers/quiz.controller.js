const quizService = require('../services/quiz.service');
const notificationService = require('../services/notification.service');
const { getIO } = require('../socket');
const { emitNotificationToUser } = require('../socket/notificationNamespace');

class QuizController {
  /**
   * Create quiz
   * POST /api/visual-aids/quizzes
   */
  async createQuiz(req, res, next) {
    try {
      const userId = req.user._id; // Use ObjectId for consistency
      const quiz = await quizService.createQuiz(userId, req.body);

      // Send notification about quiz generation
      try {
        const notification = await notificationService.notifyQuizGenerated(
          userId,
          quiz
        );

        const io = getIO();
        emitNotificationToUser(io, userId, notification);
      } catch (err) {
        console.error('Failed to send quiz notification:', err);
      }

      res.status(201).json({
        success: true,
        data: quiz
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all quizzes for user
   * GET /api/visual-aids/quizzes
   */
  async getQuizzes(req, res, next) {
    try {
      const userId = req.user.id;
      const { subjectId } = req.query;
      
      const quizzes = await quizService.getUserQuizzes(userId, subjectId);
      
      res.json({
        success: true,
        count: quizzes.length,
        data: quizzes
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single quiz
   * GET /api/visual-aids/quizzes/:id
   */
  async getQuizById(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      const { includeAnswers } = req.query;
      
      const quiz = await quizService.getQuizById(
        id, 
        userId, 
        isAdmin,
        includeAnswers !== 'false'
      );
      
      res.json({
        success: true,
        data: quiz
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update quiz
   * PUT /api/visual-aids/quizzes/:id
   */
  async updateQuiz(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const quiz = await quizService.updateQuiz(id, userId, req.body, isAdmin);
      
      res.json({
        success: true,
        data: quiz
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete quiz
   * DELETE /api/visual-aids/quizzes/:id
   */
  async deleteQuiz(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const result = await quizService.deleteQuiz(id, userId, isAdmin);
      
      res.json({
        success: true,
        message: result.message
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create quiz from flashcard set
   * POST /api/visual-aids/quizzes/from-flashcards/:setId
   */
  async createFromFlashcards(req, res, next) {
    try {
      const userId = req.user.id;
      const { setId } = req.params;
      
      const quiz = await quizService.createQuizFromFlashcards(setId, userId, req.body);
      
      res.status(201).json({
        success: true,
        data: quiz
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Submit quiz attempt
   * POST /api/visual-aids/quizzes/:id/attempts
   */
  async submitAttempt(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { answers } = req.body;
      
      const attempt = await quizService.submitAttempt(id, userId, answers);
      
      res.status(201).json({
        success: true,
        data: attempt
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's quiz attempts
   * GET /api/visual-aids/quizzes/attempts
   */
  async getUserAttempts(req, res, next) {
    try {
      const userId = req.user.id;
      const { quizId } = req.query;
      
      const attempts = await quizService.getUserAttempts(userId, quizId);
      
      res.json({
        success: true,
        count: attempts.length,
        data: attempts
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get quiz statistics
   * GET /api/visual-aids/quizzes/:id/statistics
   */
  async getStatistics(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const stats = await quizService.getQuizStatistics(id, userId, isAdmin);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new QuizController();
