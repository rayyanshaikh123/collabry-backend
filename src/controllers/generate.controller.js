const aiService = require('../services/ai.service');
const quizService = require('../services/quiz.service');
const mindMapService = require('../services/mindmap.service');

class GenerateController {
  /**
   * Generate quiz using AI
   * POST /api/visual-aids/generate/quiz
   */
  async generateQuiz(req, res, next) {
    try {
      const userId = req.user.id;
      const { content, text, subject, subjectId, count, difficulty, save, title } = req.body;
      const file = req.file; // Multer file object
      
      console.log('Generate quiz request body:', {
        hasContent: !!content,
        hasText: !!text,
        hasFile: !!file,
        fileName: file?.originalname,
        count,
        difficulty,
        save,
        saveType: typeof save,
        subjectId,
        title
      });
      
      // Extract JWT token from authorization header
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Authorization token required'
        });
      }

      let generatedQuestions;

      // If file is uploaded, use the AI engine's file endpoint
      if (file) {
        console.log('Using AI engine file upload endpoint for PDF/file processing');
        generatedQuestions = await aiService.generateQuizFromFile(
          file,
          {
            count: count || 5,
            difficulty: difficulty || 'medium',
            useRag: req.body.useRag === true ? true : false,
            topic: req.body.topic || null
          },
          token
        );
      } else {
        // Use content or text as input for text-based generation
        const inputText = content || text;
        
        // Validate required fields
        if (!inputText) {
          return res.status(400).json({
            success: false,
            message: 'Content, text, or file is required'
          });
        }

        // Generate quiz using AI with user's token (RAG disabled by default)
        generatedQuestions = await aiService.generateQuiz(
          inputText,
          {
            count: count || 5,
            difficulty: difficulty || 'medium',
            useRag: req.body.useRag === true ? true : false, // Explicitly disable RAG unless requested
            topic: req.body.topic || null
          },
          token
        );
      }

      console.log('Quiz generation result:', {
        questionsGenerated: generatedQuestions.length,
        willSave: save
      });

      // If save is true, create quiz in database (subject optional)
      if (save) {
        try {
          console.log('Attempting to save quiz to database...');
          const quiz = await quizService.createQuiz(userId, {
            title: title || `AI-Generated Quiz${subject ? `: ${subject}` : ''}`,
            description: `Auto-generated from provided content`,
            subject: subjectId || null, // Subject is optional
            questions: generatedQuestions,
            timeLimit: (count || 5) * 2, // 2 minutes per question
            passingScore: 70,
            settings: {
              shuffleQuestions: true,
              shuffleOptions: true,
              showExplanations: true,
              allowReview: true
            }
          });

          console.log('Quiz saved to database:', {
            quizId: quiz._id,
            title: quiz.title,
            questionsCount: quiz.questions.length,
            userId: userId,
            subject: quiz.subject
          });

          return res.status(201).json({
            success: true,
            data: quiz
          });
        } catch (saveError) {
          console.error('Error saving quiz to database:', saveError);
          // Return generated questions even if save fails
          return res.json({
            success: true,
            data: { questions: generatedQuestions },
            warning: 'Quiz generated but failed to save to database'
          });
        }
      }

      // Return generated questions without saving
      res.json({
        success: true,
        data: { questions: generatedQuestions }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generate mind map using AI
   * POST /api/visual-aids/generate/mindmap
   */
  async generateMindMap(req, res, next) {
    try {
      const userId = req.user.id;
      const token = req.headers.authorization?.split(' ')[1];
      const { text, topic, subjectId, maxNodes, save, useRag } = req.body;

      // Use defaults if topic not provided or empty
      const mapTopic = (topic && topic.trim()) || 'Concept Map';

      // Generate mind map using AI engine
      console.log('GenerateMindMap request:', { topic: mapTopic, maxNodes, useRag: !!useRag });
      const generatedMap = await aiService.generateMindMap(
        mapTopic,
        {
          text: text || '',
          maxNodes: maxNodes || 20,
          useRag: useRag === true
        },
        token
      );

      // If save is true, create mind map in database. Subject is optional
      if (save) {
        try {
          const mindMap = await mindMapService.createMindMap(userId, {
            title: `AI-Generated Mind Map: ${mapTopic}`,
            topic: mapTopic,
            subject: subjectId || null,
            nodes: generatedMap.nodes,
            edges: generatedMap.edges,
            tree: generatedMap.tree,  // Hierarchical structure for rendering
            metadata: generatedMap.metadata  // Additional metadata
          });

          return res.status(201).json({
            success: true,
            data: mindMap
          });
        } catch (saveErr) {
          console.error('Failed to save mind map to DB:', saveErr);
          // Return generated map even if save fails
          return res.json({
            success: true,
            data: generatedMap,
            warning: 'Mind map generated but failed to save to database'
          });
        }
      }

      // Return generated mind map without saving
      res.json({
        success: true,
        data: generatedMap
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new GenerateController();
