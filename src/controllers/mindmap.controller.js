const mindMapService = require('../services/mindmap.service');
const notificationService = require('../services/notification.service');
const { getIO } = require('../socket');
const { emitNotificationToUser } = require('../socket/notificationNamespace');

class MindMapController {
  /**
   * Create mind map
   * POST /api/visual-aids/mindmaps
   */
  async createMindMap(req, res, next) {
    try {
      const userId = req.user.id;
      const mindMap = await mindMapService.createMindMap(userId, req.body);

      // Send notification about mindmap generation
      try {
        const notification = await notificationService.notifyMindmapGenerated(
          userId,
          mindMap
        );

        const io = getIO();
        emitNotificationToUser(io, userId, notification);
      } catch (err) {
        console.error('Failed to send mindmap notification:', err);
      }
      
      res.status(201).json({
        success: true,
        data: mindMap
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all mind maps for user
   * GET /api/visual-aids/mindmaps
   */
  async getMindMaps(req, res, next) {
    try {
      const userId = req.user.id;
      const { subjectId, includeArchived } = req.query;
      
      const mindMaps = await mindMapService.getUserMindMaps(
        userId, 
        subjectId, 
        includeArchived === 'true'
      );
      
      res.json({
        success: true,
        count: mindMaps.length,
        data: mindMaps
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single mind map
   * GET /api/visual-aids/mindmaps/:id
   */
  async getMindMapById(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const mindMap = await mindMapService.getMindMapById(id, userId, isAdmin);
      
      res.json({
        success: true,
        data: mindMap
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update mind map
   * PUT /api/visual-aids/mindmaps/:id
   */
  async updateMindMap(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      const { createVersion } = req.query;
      
      const mindMap = await mindMapService.updateMindMap(
        id, 
        userId, 
        req.body, 
        createVersion === 'true',
        isAdmin
      );
      
      res.json({
        success: true,
        data: mindMap
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete mind map
   * DELETE /api/visual-aids/mindmaps/:id
   */
  async deleteMindMap(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const result = await mindMapService.deleteMindMap(id, userId, isAdmin);
      
      res.json({
        success: true,
        message: result.message
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create new version of mind map
   * POST /api/visual-aids/mindmaps/:id/version
   */
  async createVersion(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const newVersion = await mindMapService.createVersion(id, userId, isAdmin);
      
      res.status(201).json({
        success: true,
        data: newVersion
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get version history
   * GET /api/visual-aids/mindmaps/:id/versions
   */
  async getVersionHistory(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const versions = await mindMapService.getVersionHistory(id, userId, isAdmin);
      
      res.json({
        success: true,
        count: versions.length,
        data: versions
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Archive mind map
   * POST /api/visual-aids/mindmaps/:id/archive
   */
  async archiveMindMap(req, res, next) {
    try {
      const userId = req.user.id;
      const isAdmin = req.user.role === 'admin';
      const { id } = req.params;
      
      const mindMap = await mindMapService.archiveMindMap(id, userId, isAdmin);
      
      res.json({
        success: true,
        data: mindMap
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new MindMapController();
