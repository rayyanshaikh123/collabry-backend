const MindMap = require('../models/MindMap');

class MindMapService {
  /**
   * Create a new mind map
   */
  async createMindMap(userId, data) {
    const mindMap = new MindMap({
      ...data,
      createdBy: userId,
      version: 1
    });

    await mindMap.save();
    return mindMap;
  }

  /**
   * Get all mind maps for a user (with optional subject filter)
   */
  async getUserMindMaps(userId, subjectId = null, includeArchived = false) {
    const query = {
      $or: [
        { createdBy: userId },
        { visibility: 'shared' }
      ]
    };

    if (subjectId) {
      query.subject = subjectId;
    }

    if (!includeArchived) {
      query.isArchived = false;
    }

    const mindMaps = await MindMap.find(query)
      .populate('subject', 'name code')
      .populate('createdBy', 'name email')
      .sort({ updatedAt: -1 });

    return mindMaps;
  }

  /**
   * Get mind map by ID
   */
  async getMindMapById(mindMapId, userId, isAdmin = false) {
    const mindMap = await MindMap.findById(mindMapId)
      .populate('subject', 'name code')
      .populate('createdBy', 'name email')
      .populate('parentVersion', 'title version createdAt');

    if (!mindMap) {
      throw new Error('Mind map not found');
    }

    // Authorization check
    if (!isAdmin && mindMap.visibility === 'private' && mindMap.createdBy._id.toString() !== userId) {
      throw new Error('Unauthorized access to private mind map');
    }

    return mindMap;
  }

  /**
   * Update mind map (creates new version for significant changes)
   */
  async updateMindMap(mindMapId, userId, updates, createVersion = false, isAdmin = false) {
    const mindMap = await MindMap.findById(mindMapId);

    if (!mindMap) {
      throw new Error('Mind map not found');
    }

    // Authorization check
    if (!isAdmin && mindMap.createdBy.toString() !== userId) {
      throw new Error('Unauthorized to update this mind map');
    }

    // If creating a new version (for structural changes)
    if (createVersion && (updates.nodes || updates.edges)) {
      const newVersion = new MindMap({
        title: updates.title || mindMap.title,
        topic: updates.topic || mindMap.topic,
        subject: mindMap.subject,
        createdBy: userId,
        sourceType: mindMap.sourceType,
        visibility: updates.visibility || mindMap.visibility,
        nodes: updates.nodes || mindMap.nodes,
        edges: updates.edges || mindMap.edges,
        version: mindMap.version + 1,
        parentVersion: mindMap._id,
        tags: updates.tags || mindMap.tags,
        metadata: updates.metadata || mindMap.metadata
      });

      await newVersion.save();

      // Archive old version
      mindMap.isArchived = true;
      await mindMap.save();

      return newVersion;
    }

    // Regular update (no versioning)
    const allowedUpdates = ['title', 'topic', 'visibility', 'nodes', 'edges', 'tags', 'metadata'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        mindMap[field] = updates[field];
      }
    });

    await mindMap.save();
    return mindMap;
  }

  /**
   * Delete mind map
   */
  async deleteMindMap(mindMapId, userId, isAdmin = false) {
    const mindMap = await MindMap.findById(mindMapId);

    if (!mindMap) {
      throw new Error('Mind map not found');
    }

    // Authorization check
    if (!isAdmin && mindMap.createdBy.toString() !== userId) {
      throw new Error('Unauthorized to delete this mind map');
    }

    await mindMap.deleteOne();

    return { message: 'Mind map deleted successfully' };
  }

  /**
   * Get version history
   */
  async getVersionHistory(mindMapId, userId, isAdmin = false) {
    const mindMap = await MindMap.findById(mindMapId);

    if (!mindMap) {
      throw new Error('Mind map not found');
    }

    // Authorization check
    if (!isAdmin && mindMap.visibility === 'private' && mindMap.createdBy.toString() !== userId) {
      throw new Error('Unauthorized access');
    }

    // Find all versions in the lineage
    const versions = [];
    let currentId = mindMapId;

    while (currentId) {
      const version = await MindMap.findById(currentId)
        .select('title version createdAt updatedAt parentVersion')
        .populate('createdBy', 'name');
      
      if (!version) break;
      
      versions.push(version);
      currentId = version.parentVersion;
    }

    return versions.sort((a, b) => b.version - a.version);
  }

  /**
   * Create a new version explicitly
   */
  async createVersion(mindMapId, userId, isAdmin = false) {
    return this.updateMindMap(mindMapId, userId, {}, true, isAdmin);
  }

  /**
   * Archive a mind map
   */
  async archiveMindMap(mindMapId, userId, isAdmin = false) {
    const mindMap = await MindMap.findById(mindMapId);

    if (!mindMap) {
      throw new Error('Mind map not found');
    }

    // Authorization check
    if (!isAdmin && mindMap.createdBy.toString() !== userId) {
      throw new Error('Unauthorized to archive this mind map');
    }

    mindMap.isArchived = true;
    await mindMap.save();

    return mindMap;
  }
}

module.exports = new MindMapService();
