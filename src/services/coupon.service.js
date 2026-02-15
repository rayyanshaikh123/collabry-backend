const Coupon = require('../models/Coupon');

/**
 * Create a new coupon
 */
const createCoupon = async (couponData, adminUserId) => {
  try {
    // Generate code if not provided
    if (!couponData.code) {
      couponData.code = Coupon.generateCode();
    }
    
    const coupon = new Coupon({
      ...couponData,
      createdBy: adminUserId,
    });
    
    await coupon.save();
    
    return coupon;
  } catch (error) {
    if (error.code === 11000) {
      throw new Error('Coupon code already exists');
    }
    throw error;
  }
};

/**
 * Validate a coupon code
 */
const validateCoupon = async (code, userId, plan, amount) => {
  const result = await Coupon.validateAndGet(code, userId, plan, amount);
  
  if (!result.valid) {
    return {
      valid: false,
      error: result.reason,
    };
  }
  
  return {
    valid: true,
    coupon: {
      code: result.coupon.code,
      discountType: result.coupon.discountType,
      discountValue: result.coupon.discountValue,
      description: result.coupon.description,
    },
    discount: result.discount,
    originalAmount: amount,
    finalAmount: result.finalAmount,
  };
};

/**
 * Apply a coupon to a subscription
 */
const applyCoupon = async (code, userId, subscriptionId, originalAmount) => {
  const coupon = await Coupon.findOne({ 
    code: code.toUpperCase(),
    isActive: true,
  });
  
  if (!coupon) {
    throw new Error('Invalid coupon code');
  }
  
  // Calculate discount
  const discount = coupon.calculateDiscount(originalAmount);
  
  // Record usage
  await coupon.apply(userId, subscriptionId, discount);
  
  return {
    couponCode: coupon.code,
    discount,
    originalAmount,
    finalAmount: originalAmount - discount,
  };
};

/**
 * Get all coupons (admin)
 */
const getAllCoupons = async (filters = {}) => {
  const query = {};
  
  if (filters.isActive !== undefined) {
    query.isActive = filters.isActive;
  }
  
  if (filters.campaign) {
    query.campaign = filters.campaign;
  }
  
  if (filters.validOnly) {
    const now = new Date();
    query.isActive = true;
    query.validFrom = { $lte: now };
    query.validUntil = { $gte: now };
  }
  
  const coupons = await Coupon.find(query)
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });
  
  return coupons;
};

/**
 * Get coupon by code
 */
const getCouponByCode = async (code) => {
  const coupon = await Coupon.findOne({ code: code.toUpperCase() });
  return coupon;
};

/**
 * Get coupon by ID
 */
const getCouponById = async (couponId) => {
  const coupon = await Coupon.findById(couponId)
    .populate('createdBy', 'name email')
    .populate('usedBy.user', 'name email');
  
  return coupon;
};

/**
 * Update a coupon
 */
const updateCoupon = async (couponId, updateData) => {
  // Don't allow updating the code
  delete updateData.code;
  delete updateData.usedBy;
  delete updateData.currentUsageCount;
  
  const coupon = await Coupon.findByIdAndUpdate(
    couponId,
    updateData,
    { new: true, runValidators: true }
  );
  
  if (!coupon) {
    throw new Error('Coupon not found');
  }
  
  return coupon;
};

/**
 * Deactivate a coupon
 */
const deactivateCoupon = async (couponId) => {
  const coupon = await Coupon.findByIdAndUpdate(
    couponId,
    { isActive: false },
    { new: true }
  );
  
  if (!coupon) {
    throw new Error('Coupon not found');
  }
  
  return coupon;
};

/**
 * Delete a coupon
 */
const deleteCoupon = async (couponId) => {
  const coupon = await Coupon.findById(couponId);
  
  if (!coupon) {
    throw new Error('Coupon not found');
  }
  
  // Don't delete if coupon has been used
  if (coupon.currentUsageCount > 0) {
    throw new Error('Cannot delete a coupon that has been used. Deactivate it instead.');
  }
  
  await coupon.deleteOne();
  
  return true;
};

/**
 * Get coupon usage statistics
 */
const getCouponStats = async (couponId) => {
  const coupon = await Coupon.findById(couponId);
  
  if (!coupon) {
    throw new Error('Coupon not found');
  }
  
  // Calculate total discount given
  const totalDiscount = coupon.usedBy.reduce(
    (sum, usage) => sum + (usage.discountApplied || 0),
    0
  );
  
  // Calculate usage rate
  const usageRate = coupon.maxUsageTotal 
    ? (coupon.currentUsageCount / coupon.maxUsageTotal) * 100 
    : null;
  
  return {
    code: coupon.code,
    totalUsage: coupon.currentUsageCount,
    maxUsage: coupon.maxUsageTotal,
    usageRate,
    totalDiscountGiven: totalDiscount,
    isActive: coupon.isActive,
    isValid: coupon.isValid,
    validUntil: coupon.validUntil,
    recentUsage: coupon.usedBy.slice(-10).reverse(),
  };
};

/**
 * Get campaign statistics
 */
const getCampaignStats = async (campaign) => {
  const coupons = await Coupon.find({ campaign });
  
  const stats = {
    campaign,
    totalCoupons: coupons.length,
    activeCoupons: coupons.filter(c => c.isActive).length,
    totalUsage: 0,
    totalDiscountGiven: 0,
    coupons: [],
  };
  
  for (const coupon of coupons) {
    const couponDiscount = coupon.usedBy.reduce(
      (sum, usage) => sum + (usage.discountApplied || 0),
      0
    );
    
    stats.totalUsage += coupon.currentUsageCount;
    stats.totalDiscountGiven += couponDiscount;
    stats.coupons.push({
      code: coupon.code,
      usage: coupon.currentUsageCount,
      discountGiven: couponDiscount,
      isActive: coupon.isActive,
    });
  }
  
  return stats;
};

/**
 * Bulk create coupons (for campaigns)
 */
const bulkCreateCoupons = async (count, baseData, adminUserId) => {
  const coupons = [];
  
  for (let i = 0; i < count; i++) {
    const couponData = {
      ...baseData,
      code: Coupon.generateCode(),
      createdBy: adminUserId,
    };
    
    const coupon = new Coupon(couponData);
    coupons.push(coupon);
  }
  
  await Coupon.insertMany(coupons);
  
  return coupons;
};

/**
 * Get public coupon info (for display)
 */
const getPublicCouponInfo = (coupon) => {
  return {
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    description: coupon.description,
    minimumAmount: coupon.minimumAmount,
    maxDiscount: coupon.maxDiscount,
    applicablePlans: coupon.applicablePlans,
    validUntil: coupon.validUntil,
  };
};

module.exports = {
  createCoupon,
  validateCoupon,
  applyCoupon,
  getAllCoupons,
  getCouponByCode,
  getCouponById,
  updateCoupon,
  deactivateCoupon,
  deleteCoupon,
  getCouponStats,
  getCampaignStats,
  bulkCreateCoupons,
  getPublicCouponInfo,
};
