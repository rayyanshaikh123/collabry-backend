const axios = require('axios');

const AI_ENGINE_BASE_URL = process.env.AI_ENGINE_URL || 'http://localhost:8000';

class AIService {
  constructor() {
    this.client = axios.create({
      baseURL: AI_ENGINE_BASE_URL,
      timeout: 60000, // 60 seconds for AI operations
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Forward request to AI engine with user's JWT token
   * If user has BYOK enabled, include custom API key headers
   */
  async forwardToAI(endpoint, data, userToken, userId = null) {
    try {
      const headers = {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      };

      // Check if user has BYOK (Bring Your Own Key) enabled
      if (userId) {
        const User = require('../models/User');
        const user = await User.findById(userId).select('byokSettings apiKeys');
        
        if (user && user.hasByokEnabled()) {
          const keyInfo = await user.getDecryptedApiKey(user.byokSettings.activeProvider);
          
          if (keyInfo) {
            headers['X-User-Api-Key'] = keyInfo.apiKey;
            headers['X-User-Base-Url'] = keyInfo.baseUrl;
            headers['X-User-Provider'] = keyInfo.provider;
            
            console.log(`[BYOK] Forwarding request with user's ${keyInfo.provider} key`);
            
            // Update last used timestamp
            const keyData = user.apiKeys.get(user.byokSettings.activeProvider);
            keyData.lastUsed = new Date();
            user.apiKeys.set(user.byokSettings.activeProvider, keyData);
            await user.save();
          }
        }
      }

      const response = await this.client.post(endpoint, data, { headers });
      return response.data;
    } catch (error) {
      console.error('AI Engine Error:', error.message);
      
      // If user key fails and fallback is enabled, retry with system key
      if (error.response?.status === 401 && userId) {
        const User = require('../models/User');
        const user = await User.findById(userId).select('byokSettings apiKeys');
        
        if (user?.byokSettings.fallbackToSystem && user.byokSettings.activeProvider) {
          console.log('[BYOK] User key failed, falling back to system key');
          
          // Mark user key as invalid
          const keyData = user.apiKeys.get(user.byokSettings.activeProvider);
          keyData.isValid = false;
          keyData.errorCount += 1;
          user.apiKeys.set(user.byokSettings.activeProvider, keyData);
          await user.save();
          
          // Retry without BYOK headers
          const headers = {
            Authorization: `Bearer ${userToken}`,
            'Content-Type': 'application/json'
          };
          const response = await this.client.post(endpoint, data, { headers });
          return response.data;
        }
      }
      
      throw new Error(
        error.response?.data?.error || 'AI Engine request failed'
      );
    }
  }

  /**
   * Chat with AI
   */
  async chat(message, userId, conversationId, userToken) {
    return this.forwardToAI(
      '/api/chat',
      {
        message,
        user_id: userId,
        conversation_id: conversationId,
      },
      userToken,
      userId
    );
  }

  /**
   * Streaming chat with AI
   */
  async chatStream(message, userId, conversationId, userToken) {
    return this.forwardToAI(
      '/api/chat/stream',
      {
        message,
        user_id: userId,
        conversation_id: conversationId,
      },
      userToken,
      userId
    );
  }

  /**
   * Summarize text
   */
  async summarize(text, userId, userToken) {
    return this.forwardToAI(
      '/api/summarize',
      {
        text,
        user_id: userId,
      },
      userToken,
      userId
    );
  }

  /**
   * Generate Q&A from text
   */
  async generateQA(text, userId, userToken) {
    return this.forwardToAI(
      '/api/qa/generate',
      {
        text,
        user_id: userId,
      },
      userToken,
      userId
    );
  }

  /**
   * Generate quizzes from text using AI engine with optional RAG
   */
  async generateQuiz(content, options = {}, userToken) {
    try {
      console.log('Calling AI engine /ai/qa/generate with:', {
        textLength: content.length,
        count: options.count,
        difficulty: options.difficulty,
        useRag: options.useRag
      });

      const response = await this.client.post('/ai/qa/generate', {
        text: content,
        num_questions: options.count || 10,
        difficulty: options.difficulty || 'medium',
        include_options: true, // Always generate multiple choice
        use_rag: options.useRag !== undefined ? options.useRag : false, // Disable RAG by default for now
        topic: options.topic || null // Optional topic for RAG filtering
      }, {
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      });
      
      console.log('AI engine response:', {
        status: response.status,
        hasData: !!response.data,
        questionsCount: response.data?.questions?.length || 0
      });

      // Transform AI engine response to quiz format
      const questions = response.data.questions || [];
      
      if (questions.length === 0) {
        console.error('No questions returned from AI engine. Response:', response.data);
        throw new Error('AI engine returned no questions');
      }

      console.log('Sample question from AI engine:', JSON.stringify(questions[0], null, 2));

      return questions.map((q, idx) => {
        // Clean options - remove empty strings and trim
        let validOptions = (q.options || [])
          .map(opt => typeof opt === 'string' ? opt.trim() : String(opt).trim())
          .filter(opt => opt && opt !== '');
        
        // Get answer, default to first option if empty
        let answer = q.answer && q.answer.trim() ? q.answer.trim() : '';
        
        // If answer is empty but we have options, use first option
        if (!answer && validOptions.length > 0) {
          answer = validOptions[0];
          console.warn(`Question ${idx + 1}: Empty answer, using first option: "${answer}"`);
        }
        
        // If still no valid options, create defaults
        if (validOptions.length === 0) {
          validOptions = [answer || 'Option 1', 'Option 2', 'Option 3', 'Option 4'];
          console.warn(`Question ${idx + 1}: No valid options, created defaults`);
        }
        
        // Ensure answer is in options
        if (!validOptions.includes(answer) && answer) {
          validOptions[0] = answer;
        }
        
        // Ensure we have at least the answer
        if (!answer) {
          answer = validOptions[0] || 'No answer provided';
          console.error(`Question ${idx + 1}: Still no answer after processing, using: "${answer}"`);
        }
        
        const transformed = {
          question: q.question || 'Question not provided',
          options: validOptions,
          correctAnswer: answer,
          explanation: q.explanation || '',
          difficulty: q.difficulty || options.difficulty || 'medium',
          points: 10
        };
        
        if (idx === 0) {
          console.log('Transformed first question:', JSON.stringify(transformed, null, 2));
        }
        
        return transformed;
      });
    } catch (error) {
      console.error('AI generateQuiz error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.detail || 'Failed to generate quiz from AI engine');
    }
  }

  /**
   * Generate quiz from uploaded file using AI engine
   */
  async generateQuizFromFile(file, options = {}, userToken) {
    try {
      const FormData = require('form-data');
      const formData = new FormData();
      
      // Append file buffer
      formData.append('file', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
      });
      
      // Append other form fields
      formData.append('num_questions', options.count || 5);
      formData.append('difficulty', options.difficulty || 'medium');
      formData.append('include_options', 'true');
      
      console.log('Calling AI engine /ai/qa/generate/file with:', {
        fileName: file.originalname,
        fileSize: file.size,
        count: options.count,
        difficulty: options.difficulty
      });

      const response = await this.client.post('/ai/qa/generate/file', formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${userToken}`
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });
      
      console.log('AI engine file response:', {
        status: response.status,
        hasData: !!response.data,
        questionsCount: response.data?.questions?.length || 0
      });

      // Transform AI engine response to quiz format
      const questions = response.data.questions || [];
      
      if (questions.length === 0) {
        console.error('No questions returned from AI engine. Response:', response.data);
        throw new Error('AI engine returned no questions');
      }

      console.log('Sample question from AI engine (file):', JSON.stringify(questions[0], null, 2));

      return questions.map((q, idx) => {
        // Clean options - remove empty strings and trim
        let validOptions = (q.options || [])
          .map(opt => typeof opt === 'string' ? opt.trim() : String(opt).trim())
          .filter(opt => opt && opt !== '');
        
        // Get answer, default to first option if empty
        let answer = q.answer && q.answer.trim() ? q.answer.trim() : '';
        
        // If answer is empty but we have options, use first option
        if (!answer && validOptions.length > 0) {
          answer = validOptions[0];
          console.warn(`Question ${idx + 1}: Empty answer, using first option: "${answer}"`);
        }
        
        // If still no valid options, create defaults
        if (validOptions.length === 0) {
          validOptions = [answer || 'Option 1', 'Option 2', 'Option 3', 'Option 4'];
          console.warn(`Question ${idx + 1}: No valid options, created defaults`);
        }
        
        // Ensure answer is in options
        if (!validOptions.includes(answer) && answer) {
          validOptions[0] = answer;
        }
        
        // Ensure we have at least the answer
        if (!answer) {
          answer = validOptions[0] || 'No answer provided';
          console.error(`Question ${idx + 1}: Still no answer after processing, using: "${answer}"`);
        }
        
        const transformed = {
          question: q.question || 'Question not provided',
          options: validOptions,
          correctAnswer: answer,
          explanation: q.explanation || '',
          difficulty: q.difficulty || options.difficulty || 'medium',
          points: 10
        };
        
        if (idx === 0) {
          console.log('Transformed first question (file):', JSON.stringify(transformed, null, 2));
        }
        
        return transformed;
      });
    } catch (error) {
      console.error('AI generateQuizFromFile error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.detail || 'Failed to generate quiz from file');
    }
  }

  /**
   * Generate mind map from topic using AI agent (tool calling)
   */
  async generateMindMap(topic, options = {}, userToken) {
    try {
      const mapTopic = topic || 'Concept';
      
      console.log('Calling AI agent for mindmap generation via chat:', mapTopic);
      
      // Use the chat agent which will route to the generate_mindmap tool
      const response = await this.client.post(
        '/ai/chat',
        {
          message: `Generate a mind map for: ${mapTopic}`,
          user_id: 'system', // Temporary user ID for generation
          session_id: `mindmap_${Date.now()}`, // Unique session for this generation
          notebook_id: null,
          use_rag: options.useRag || false,
          source_ids: null,
          stream: false
        },
        {
          headers: {
            Authorization: `Bearer ${userToken}`
          }
        }
      );

      // The agent returns the tool output in response field
      const agentResponse = response.data;
      console.log('AI agent response received:', {
        hasResponse: !!agentResponse.response,
        responsePreview: (agentResponse.response || '').substring(0, 100)
      });
      
      // Parse the mindmap from the agent's response
      let mindmapData;
      try {
        // The agent returns JSON as a string in the response field
        let responseText = agentResponse.response || '';
        
        // Remove common prefixes that the AI might add
        responseText = responseText
          .replace(/^\[MINDMAP_GENERATION_REQUEST\]\s*/i, '')
          .replace(/^\[MINDMAP\]\s*/i, '')
          .trim();
        
        mindmapData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse mindmap JSON from agent response:', parseError);
        console.log('Raw response:', (agentResponse.response || '').substring(0, 500));
        
        // Try to extract JSON from markdown code blocks
        let responseText = agentResponse.response || '';
        
        // Remove prefixes again before markdown extraction
        responseText = responseText
          .replace(/^\[MINDMAP_GENERATION_REQUEST\]\s*/i, '')
          .replace(/^\[MINDMAP\]\s*/i, '')
          .trim();
          
        if (responseText.includes('```json')) {
          const jsonMatch = responseText.match(/```json\s*\n?([\s\S]*?)\n?```/);
          if (jsonMatch && jsonMatch[1]) {
            responseText = jsonMatch[1].trim();
          }
        } else if (responseText.includes('```')) {
          const jsonMatch = responseText.match(/```\s*\n?([\s\S]*?)\n?```/);
          if (jsonMatch && jsonMatch[1]) {
            responseText = jsonMatch[1].trim();
          }
        }
        
        // Try parsing the cleaned text
        try {
          mindmapData = JSON.parse(responseText);
        } catch (secondParseError) {
          // Last resort: extract first JSON object from text
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            mindmapData = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error('Agent did not return valid mindmap JSON');
          }
        }
      }

      console.log('Parsed mindmap data:', {
        hasRoot: !!mindmapData.root || !!mindmapData.id,
        hasLabel: !!mindmapData.label,
        hasChildren: !!(mindmapData.children || mindmapData.root?.children)
      });

      // Normalize the structure - handle both {root: {...}} and {id, label, children}
      let rootNode = mindmapData.root || mindmapData;
      if (!rootNode.id) rootNode.id = 'root';
      if (!rootNode.label) rootNode.label = mapTopic;
      if (!rootNode.children) rootNode.children = [];

      // Convert the tree structure to flat nodes and edges for frontend
      const nodes = [];
      const edges = [];
      let nodeCounter = 0;

      function traverseTree(node, parentId = null, level = 0) {
        const currentId = node.id || `node_${nodeCounter++}`;
        
        nodes.push({
          id: currentId,
          label: node.label,
          type: level === 0 ? 'root' : 'branch',
          level: level
        });

        if (parentId) {
          edges.push({
            id: `edge_${edges.length}`,
            from: parentId,
            to: currentId
          });
        }

        if (node.children && node.children.length > 0) {
          node.children.forEach(child => traverseTree(child, currentId, level + 1));
        }
      }

      traverseTree(rootNode);

      console.log('Converted to nodes/edges:', { nodeCount: nodes.length, edgeCount: edges.length });

      // Return the hierarchical tree structure for frontend rendering
      // Frontend will handle visualization using ReactFlow, vis.js, or mermaid
      return {
        tree: rootNode,  // Original hierarchical structure
        nodes,           // Flat node list for graph libraries
        edges,           // Edges connecting nodes
        metadata: {
          topic: mapTopic,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          maxDepth: Math.max(...nodes.map(n => n.level))
        }
      };

    } catch (error) {
      console.error('AI generateMindMap error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.detail || 'Failed to generate mind map from AI engine');
    }
  }

  /**
   * Ingest document for RAG
   */
  async ingestDocument(content, metadata, userId, userToken) {
    return this.forwardToAI(
      '/api/ingest',
      {
        content,
        metadata,
        user_id: userId,
      },
      userToken,
      userId
    );
  }

  /**
   * Health check for AI engine
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health');
      return response.data;
    } catch (error) {
      return {
        status: 'error',
        message: 'AI Engine is not available',
      };
    }
  }
}

module.exports = new AIService();
