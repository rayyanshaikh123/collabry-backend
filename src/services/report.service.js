const Report = require('../models/Report');
const User = require('../models/User');
const Board = require('../models/Board');
const AppError = require('../utils/AppError');

class ReportService {
  /**
   * Create a new report
   */
  async createReport(userId, data) {
    const report = await Report.create({
      reportedBy: userId,
      ...data
    });

    return report;
  }

  /**
   * Get all reports with filters
   */
  async getReports(options = {}) {
    const {
      status,
      contentType,
      priority,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const query = {};
    
    if (status) query.status = status;
    if (contentType) query.contentType = contentType;
    if (priority) query.priority = priority;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [reports, total] = await Promise.all([
      Report.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Report.countDocuments(query)
    ]);

    return {
      reports,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit)
      }
    };
  }

  /**
   * Get report by ID
   */
  async getReportById(reportId) {
    const report = await Report.findById(reportId);
    
    if (!report) {
      throw new AppError('Report not found', 404);
    }

    // Get additional content details
    let contentDetails = {};
    
    if (report.contentType === 'board') {
      const board = await Board.findById(report.contentId)
        .select('title description owner')
        .populate('owner', 'name email');
      contentDetails = board;
    } else if (report.contentType === 'user') {
      const user = await User.findById(report.contentId)
        .select('name email role isActive');
      contentDetails = user;
    }

    return {
      ...report.toObject(),
      contentDetails
    };
  }

  /**
   * Review a report
   */
  async reviewReport(reportId, adminId, data) {
    const report = await Report.findById(reportId);
    
    if (!report) {
      throw new AppError('Report not found', 404);
    }

    report.status = 'reviewing';
    report.reviewedBy = adminId;
    report.reviewNotes = data.reviewNotes || report.reviewNotes;
    report.priority = data.priority || report.priority;
    report.updatedAt = new Date();

    await report.save();
    return report;
  }

  /**
   * Resolve a report
   */
  async resolveReport(reportId, adminId, data) {
    const report = await Report.findById(reportId);
    
    if (!report) {
      throw new AppError('Report not found', 404);
    }

    report.status = 'resolved';
    report.reviewedBy = adminId;
    report.reviewNotes = data.reviewNotes || report.reviewNotes;
    report.action = data.action || 'none';
    report.resolvedAt = new Date();
    report.updatedAt = new Date();

    await report.save();

    // Perform action if needed
    if (data.action === 'user_suspended' || data.action === 'user_banned') {
      await this.handleUserAction(report.contentId, data.action);
    }

    return report;
  }

  /**
   * Dismiss a report
   */
  async dismissReport(reportId, adminId, reason) {
    const report = await Report.findById(reportId);
    
    if (!report) {
      throw new AppError('Report not found', 404);
    }

    report.status = 'dismissed';
    report.reviewedBy = adminId;
    report.reviewNotes = reason;
    report.resolvedAt = new Date();
    report.updatedAt = new Date();

    await report.save();
    return report;
  }

  /**
   * Get report statistics
   */
  async getReportStats() {
    const [
      total,
      pending,
      reviewing,
      resolved,
      dismissed,
      byType,
      byPriority,
      recent
    ] = await Promise.all([
      Report.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'reviewing' }),
      Report.countDocuments({ status: 'resolved' }),
      Report.countDocuments({ status: 'dismissed' }),
      Report.aggregate([
        { $group: { _id: '$contentType', count: { $sum: 1 } } }
      ]),
      Report.aggregate([
        { $group: { _id: '$priority', count: { $sum: 1 } } }
      ]),
      Report.find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
    ]);

    return {
      total,
      pending,
      reviewing,
      resolved,
      dismissed,
      byType: byType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      byPriority: byPriority.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      recent
    };
  }

  /**
   * Handle user action (suspend/ban)
   */
  async handleUserAction(userId, action) {
    if (action === 'user_suspended' || action === 'user_banned') {
      await User.findByIdAndUpdate(userId, {
        isActive: false,
        suspendedAt: new Date(),
        suspensionReason: action === 'user_banned' ? 'banned' : 'suspended'
      });
    }
  }

  /**
   * Bulk delete reports
   */
  async bulkDeleteReports(reportIds) {
    const result = await Report.deleteMany({
      _id: { $in: reportIds },
      status: { $in: ['resolved', 'dismissed'] }
    });

    return result;
  }
}

module.exports = new ReportService();
