const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
// const FlashcardSet = require('../models/FlashcardSet');
// const Flashcard = require('../models/Flashcard');

class QuizService {
  /**
   * Create a new quiz
   */
  async createQuiz(userId, data) {
    const quiz = new Quiz({
      ...data,
      createdBy: userId
    });

    await quiz.save();
    return quiz;
  }

  /**
   * Get all quizzes for a user (with optional subject filter)
   */
  async getUserQuizzes(userId, subjectId = null) {
    const query = {
      $or: [
        { createdBy: userId },
        { visibility: 'shared' }
      ]
    };

    if (subjectId) {
      query.subject = subjectId;
    }

    const quizzes = await Quiz.find(query)
      .populate('createdBy', 'name email')
      .sort({ updatedAt: -1 });

    return quizzes;
  }

  /**
   * Get quiz by ID
   */
  async getQuizById(quizId, userId, isAdmin = false, includeAnswers = true) {
    const quiz = await Quiz.findById(quizId)
      .populate('createdBy', 'name email')
      .populate('linkedSetId', 'title');

    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Authorization check
    if (!isAdmin && quiz.visibility === 'private' && quiz.createdBy._id.toString() !== userId) {
      throw new Error('Unauthorized access to private quiz');
    }

    // Remove correct answers if requested (for taking quiz)
    if (!includeAnswers) {
      const quizObj = quiz.toObject();
      quizObj.questions = quizObj.questions.map(q => ({
        _id: q._id,
        question: q.question,
        options: q.options,
        difficulty: q.difficulty,
        points: q.points,
        order: q.order
      }));
      return quizObj;
    }

    return quiz;
  }

  /**
   * Update quiz
   */
  async updateQuiz(quizId, userId, updates, isAdmin = false) {
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Authorization check
    if (!isAdmin && quiz.createdBy.toString() !== userId) {
      throw new Error('Unauthorized to update this quiz');
    }

    // Update allowed fields
    const allowedUpdates = ['title', 'description', 'visibility', 'questions', 'timeLimit', 'passingScore', 'settings', 'tags'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        quiz[field] = updates[field];
      }
    });

    await quiz.save();
    return quiz;
  }

  /**
   * Delete quiz
   */
  async deleteQuiz(quizId, userId, isAdmin = false) {
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Authorization check
    if (!isAdmin && quiz.createdBy.toString() !== userId) {
      throw new Error('Unauthorized to delete this quiz');
    }

    // Delete all attempts
    await QuizAttempt.deleteMany({ quizId: quiz._id });

    await quiz.deleteOne();

    return { message: 'Quiz deleted successfully' };
  }

  /**
   * Create quiz from flashcard set
   */
  async createQuizFromFlashcards(setId, userId, quizData) {
    const set = await FlashcardSet.findById(setId);

    if (!set) {
      throw new Error('Flashcard set not found');
    }

    // Get all cards
    const cards = await Flashcard.find({ setId }).sort({ order: 1 });

    if (cards.length === 0) {
      throw new Error('No flashcards found in set');
    }

    // Convert flashcards to quiz questions
    const questions = cards.map((card, index) => {
      const question = {
        question: card.question,
        correctAnswer: card.answer,
        difficulty: card.difficulty,
        order: index
      };

      // Use options if available, otherwise create from answer
      if (card.options && card.options.length > 0) {
        question.options = card.options;
      } else {
        // Generate dummy options (in real app, you'd want smarter generation)
        question.options = [
          card.answer,
          'Option B',
          'Option C',
          'Option D'
        ];
        // Shuffle options
        question.options.sort(() => Math.random() - 0.5);
      }

      if (card.explanation) {
        question.explanation = card.explanation;
      }

      return question;
    });

    const quiz = new Quiz({
      title: quizData.title || `Quiz: ${set.title}`,
      description: quizData.description || `Generated from ${set.title}`,
      subject: set.subject,
      linkedSetId: setId,
      questions,
      createdBy: userId,
      sourceType: 'flashcards',
      visibility: quizData.visibility || 'private',
      timeLimit: quizData.timeLimit,
      passingScore: quizData.passingScore || 70,
      settings: quizData.settings || {}
    });

    await quiz.save();
    return quiz;
  }

  /**
   * Submit quiz attempt
   */
  async submitAttempt(quizId, userId, answers) {
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Calculate score
    let correctAnswers = 0;
    let pointsEarned = 0;
    const totalPoints = quiz.totalPoints;

    const processedAnswers = quiz.questions.map(question => {
      const userAnswer = answers.find(a => a.questionId === question._id.toString());
      
      if (!userAnswer) {
        return {
          questionId: question._id,
          userAnswer: '',
          isCorrect: false,
          timeSpent: 0
        };
      }

      const isCorrect = userAnswer.answer.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase();
      
      if (isCorrect) {
        correctAnswers++;
        pointsEarned += question.points || 1;
      }

      return {
        questionId: question._id,
        userAnswer: userAnswer.answer,
        isCorrect,
        timeSpent: userAnswer.timeSpent || 0
      };
    });

    const score = (pointsEarned / totalPoints) * 100;
    const passed = score >= quiz.passingScore;

    const totalTimeSpent = processedAnswers.reduce((sum, a) => sum + a.timeSpent, 0);

    const attempt = new QuizAttempt({
      quizId,
      userId,
      answers: processedAnswers,
      score,
      pointsEarned,
      totalPoints,
      passed,
      timeSpent: totalTimeSpent
    });

    await attempt.save();

    // Update quiz statistics
    quiz.totalAttempts += 1;
    const allAttempts = await QuizAttempt.find({ quizId });
    const avgScore = allAttempts.reduce((sum, a) => sum + a.score, 0) / allAttempts.length;
    quiz.averageScore = avgScore;
    await quiz.save();

    return attempt;
  }

  /**
   * Get quiz attempts for a user
   */
  async getUserAttempts(userId, quizId = null) {
    const query = { userId };
    if (quizId) {
      query.quizId = quizId;
    }

    const attempts = await QuizAttempt.find(query)
      .populate('quizId', 'title subject')
      .sort({ completedAt: -1 });

    return attempts;
  }

  /**
   * Get quiz statistics
   */
  async getQuizStatistics(quizId, userId, isAdmin = false) {
    const quiz = await Quiz.findById(quizId);

    if (!quiz) {
      throw new Error('Quiz not found');
    }

    // Authorization check
    if (!isAdmin && quiz.createdBy.toString() !== userId) {
      throw new Error('Unauthorized to view statistics');
    }

    const attempts = await QuizAttempt.find({ quizId });

    const statistics = {
      totalAttempts: attempts.length,
      averageScore: quiz.averageScore,
      passRate: attempts.length > 0 ? (attempts.filter(a => a.passed).length / attempts.length) * 100 : 0,
      averageTimeSpent: attempts.length > 0 ? attempts.reduce((sum, a) => sum + a.timeSpent, 0) / attempts.length : 0,
      questionStats: []
    };

    // Per-question statistics
    quiz.questions.forEach((question, index) => {
      const questionAttempts = attempts.map(a => a.answers[index]).filter(Boolean);
      const correctCount = questionAttempts.filter(a => a.isCorrect).length;
      
      statistics.questionStats.push({
        questionId: question._id,
        question: question.question,
        totalAttempts: questionAttempts.length,
        correctCount,
        successRate: questionAttempts.length > 0 ? (correctCount / questionAttempts.length) * 100 : 0,
        averageTimeSpent: questionAttempts.length > 0 
          ? questionAttempts.reduce((sum, a) => sum + a.timeSpent, 0) / questionAttempts.length 
          : 0
      });
    });

    return statistics;
  }
}

module.exports = new QuizService();
