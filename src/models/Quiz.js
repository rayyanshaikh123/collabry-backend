const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  options: [{
    type: String,
    required: true,
    trim: true
  }],
  correctAnswer: {
    type: String,
    required: true,
    trim: true
  },
  explanation: {
    type: String,
    trim: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  points: {
    type: Number,
    default: 1
  },
  order: {
    type: Number,
    default: 0
  }
}, { _id: true });

const quizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  subject: {
    type: String,
    required: false,
    default: null
  },
  linkedSetId: {
    type: String,
    required: false
  },
  questions: [questionSchema],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sourceType: {
    type: String,
    enum: ['manual', 'ai', 'study_buddy', 'flashcards'],
    default: 'manual'
  },
  visibility: {
    type: String,
    enum: ['private', 'shared'],
    default: 'private'
  },
  timeLimit: {
    type: Number, // in minutes
    default: null
  },
  passingScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 70
  },
  settings: {
    shuffleQuestions: {
      type: Boolean,
      default: false
    },
    shuffleOptions: {
      type: Boolean,
      default: false
    },
    showCorrectAnswers: {
      type: Boolean,
      default: true
    },
    allowRetake: {
      type: Boolean,
      default: true
    }
  },
  tags: [{
    type: String,
    trim: true
  }],
  // Statistics
  totalAttempts: {
    type: Number,
    default: 0
  },
  averageScore: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
quizSchema.index({ createdBy: 1, subject: 1 });
quizSchema.index({ subject: 1, visibility: 1 });
quizSchema.index({ linkedSetId: 1 });
quizSchema.index({ createdBy: 1, createdAt: -1 });

// Virtual for question count
quizSchema.virtual('questionCount').get(function() {
  return this.questions ? this.questions.length : 0;
});

// Virtual for total points
quizSchema.virtual('totalPoints').get(function() {
  return this.questions ? this.questions.reduce((sum, q) => sum + (q.points || 1), 0) : 0;
});

quizSchema.set('toJSON', { virtuals: true });
quizSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Quiz || mongoose.model('Quiz', quizSchema);
