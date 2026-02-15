const asyncHandler = require('express-async-handler');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');

/**
 * @desc    Get all subscriptions with filters
 * @route   GET /api/admin/subscriptions
 * @access  Private/Admin
 */
const getAllSubscriptions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, plan, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (status) query.status = status;
  if (plan) query.plan = plan;

  const pipeline = [
    { $match: query },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userData',
      },
    },
    { $unwind: '$userData' },
  ];

  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { 'userData.name': { $regex: search, $options: 'i' } },
          { 'userData.email': { $regex: search, $options: 'i' } },
        ],
      },
    });
  }

  const countPipeline = [...pipeline, { $count: 'total' }];
  pipeline.push(
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: parseInt(limit) },
    {
      $project: {
        _id: 1,
        plan: 1,
        status: 1,
        amount: 1,
        currency: 1,
        interval: 1,
        currentPeriodStart: 1,
        currentPeriodEnd: 1,
        cancelAtPeriodEnd: 1,
        nextBillingDate: 1,
        cancelledAt: 1,
        createdAt: 1,
        updatedAt: 1,
        'userData._id': 1,
        'userData.name': 1,
        'userData.email': 1,
        'userData.avatar': 1,
      },
    }
  );

  const [subscriptions, totalResult] = await Promise.all([
    Subscription.aggregate(pipeline),
    Subscription.aggregate(countPipeline),
  ]);

  const total = totalResult[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: {
      subscriptions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

/**
 * @desc    Get subscription stats
 * @route   GET /api/admin/subscriptions/stats
 * @access  Private/Admin
 */
const getSubscriptionStats = asyncHandler(async (req, res) => {
  const [byPlan, byStatus, revenueByMonth] = await Promise.all([
    Subscription.aggregate([
      { $group: { _id: '$plan', count: { $sum: 1 } } },
    ]),
    Subscription.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Payment.aggregate([
      { $match: { status: 'captured' } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          revenue: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ]),
  ]);

  const totalRevenue = await Payment.aggregate([
    { $match: { status: 'captured' } },
    { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);

  res.status(200).json({
    success: true,
    data: {
      byPlan: byPlan.reduce((acc, p) => { acc[p._id] = p.count; return acc; }, {}),
      byStatus: byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {}),
      revenueByMonth: revenueByMonth.map((r) => ({
        month: `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
        revenue: r.revenue,
        count: r.count,
      })),
      totalRevenue: totalRevenue[0]?.total || 0,
      totalPayments: totalRevenue[0]?.count || 0,
    },
  });
});

/**
 * @desc    Get all payments with filters
 * @route   GET /api/admin/payments
 * @access  Private/Admin
 */
const getAllPayments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (status) query.status = status;

  const pipeline = [
    { $match: query },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userData',
      },
    },
    { $unwind: '$userData' },
  ];

  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { 'userData.name': { $regex: search, $options: 'i' } },
          { 'userData.email': { $regex: search, $options: 'i' } },
          { razorpay_payment_id: { $regex: search, $options: 'i' } },
        ],
      },
    });
  }

  const countPipeline = [...pipeline, { $count: 'total' }];
  pipeline.push(
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: parseInt(limit) },
    {
      $project: {
        _id: 1,
        razorpay_payment_id: 1,
        amount: 1,
        currency: 1,
        status: 1,
        method: 1,
        description: 1,
        couponCode: 1,
        originalAmount: 1,
        discountApplied: 1,
        capturedAt: 1,
        createdAt: 1,
        'userData._id': 1,
        'userData.name': 1,
        'userData.email': 1,
        'userData.avatar': 1,
      },
    }
  );

  const [payments, totalResult] = await Promise.all([
    Payment.aggregate(pipeline),
    Payment.aggregate(countPipeline),
  ]);

  const total = totalResult[0]?.total || 0;

  res.status(200).json({
    success: true,
    data: {
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    },
  });
});

module.exports = { getAllSubscriptions, getSubscriptionStats, getAllPayments };
