const couponService = require('../services/coupon.service');

/**
 * Validate a coupon code
 * POST /api/coupons/validate
 * Body: { code, plan, amount }
 */
const validateCoupon = async (req, res) => {
  try {
    const { code, plan, amount } = req.body;
    const userId = req.user?.id || req.user?._id;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Coupon code is required',
      });
    }
    
    if (!plan) {
      return res.status(400).json({
        success: false,
        error: 'Plan is required',
      });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required',
      });
    }
    
    const result = await couponService.validateCoupon(code, userId, plan, amount);
    
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        error: result.error,
      });
    }
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate coupon',
      message: error.message,
    });
  }
};

/**
 * Get coupon info by code (public)
 * GET /api/coupons/:code
 */
const getCouponInfo = async (req, res) => {
  try {
    const { code } = req.params;
    
    const coupon = await couponService.getCouponByCode(code);
    
    if (!coupon || !coupon.isActive) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found or inactive',
      });
    }
    
    // Only return public info
    const publicInfo = couponService.getPublicCouponInfo(coupon);
    
    res.json({
      success: true,
      data: publicInfo,
    });
  } catch (error) {
    console.error('Error getting coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get coupon',
      message: error.message,
    });
  }
};

// ============= ADMIN ROUTES =============

/**
 * Create a new coupon (admin)
 * POST /api/coupons/admin
 */
const createCoupon = async (req, res) => {
  try {
    const adminUserId = req.user?.id || req.user?._id;
    const couponData = req.body;
    
    // Validate required fields
    if (!couponData.discountType) {
      return res.status(400).json({
        success: false,
        error: 'Discount type is required',
      });
    }
    
    if (couponData.discountValue === undefined || couponData.discountValue < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid discount value is required',
      });
    }
    
    if (!couponData.validUntil) {
      return res.status(400).json({
        success: false,
        error: 'Expiry date is required',
      });
    }
    
    // Validate percentage is <= 100
    if (couponData.discountType === 'percentage' && couponData.discountValue > 100) {
      return res.status(400).json({
        success: false,
        error: 'Percentage discount cannot exceed 100%',
      });
    }
    
    const coupon = await couponService.createCoupon(couponData, adminUserId);
    
    res.status(201).json({
      success: true,
      data: coupon,
      message: 'Coupon created successfully',
    });
  } catch (error) {
    console.error('Error creating coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create coupon',
      message: error.message,
    });
  }
};

/**
 * Get all coupons (admin)
 * GET /api/coupons/admin
 */
const getAllCoupons = async (req, res) => {
  try {
    const { isActive, campaign, validOnly } = req.query;
    
    const filters = {};
    if (isActive !== undefined) {
      filters.isActive = isActive === 'true';
    }
    if (campaign) {
      filters.campaign = campaign;
    }
    if (validOnly !== undefined) {
      filters.validOnly = validOnly === 'true';
    }
    
    const coupons = await couponService.getAllCoupons(filters);
    
    res.json({
      success: true,
      data: coupons,
      count: coupons.length,
    });
  } catch (error) {
    console.error('Error getting coupons:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get coupons',
      message: error.message,
    });
  }
};

/**
 * Get coupon by ID (admin)
 * GET /api/coupons/admin/:id
 */
const getCouponById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const coupon = await couponService.getCouponById(id);
    
    if (!coupon) {
      return res.status(404).json({
        success: false,
        error: 'Coupon not found',
      });
    }
    
    res.json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    console.error('Error getting coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get coupon',
      message: error.message,
    });
  }
};

/**
 * Update a coupon (admin)
 * PUT /api/coupons/admin/:id
 */
const updateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const coupon = await couponService.updateCoupon(id, updateData);
    
    res.json({
      success: true,
      data: coupon,
      message: 'Coupon updated successfully',
    });
  } catch (error) {
    console.error('Error updating coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update coupon',
      message: error.message,
    });
  }
};

/**
 * Deactivate a coupon (admin)
 * POST /api/coupons/admin/:id/deactivate
 */
const deactivateCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    
    const coupon = await couponService.deactivateCoupon(id);
    
    res.json({
      success: true,
      data: coupon,
      message: 'Coupon deactivated successfully',
    });
  } catch (error) {
    console.error('Error deactivating coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate coupon',
      message: error.message,
    });
  }
};

/**
 * Delete a coupon (admin)
 * DELETE /api/coupons/admin/:id
 */
const deleteCoupon = async (req, res) => {
  try {
    const { id } = req.params;
    
    await couponService.deleteCoupon(id);
    
    res.json({
      success: true,
      message: 'Coupon deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete coupon',
      message: error.message,
    });
  }
};

/**
 * Get coupon statistics (admin)
 * GET /api/coupons/admin/:id/stats
 */
const getCouponStats = async (req, res) => {
  try {
    const { id } = req.params;
    
    const stats = await couponService.getCouponStats(id);
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error getting coupon stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get coupon stats',
      message: error.message,
    });
  }
};

/**
 * Get campaign statistics (admin)
 * GET /api/coupons/admin/campaign/:campaign/stats
 */
const getCampaignStats = async (req, res) => {
  try {
    const { campaign } = req.params;
    
    const stats = await couponService.getCampaignStats(campaign);
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error getting campaign stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get campaign stats',
      message: error.message,
    });
  }
};

/**
 * Bulk create coupons (admin)
 * POST /api/coupons/admin/bulk
 */
const bulkCreateCoupons = async (req, res) => {
  try {
    const adminUserId = req.user?.id || req.user?._id;
    const { count, ...baseData } = req.body;
    
    if (!count || count < 1 || count > 100) {
      return res.status(400).json({
        success: false,
        error: 'Count must be between 1 and 100',
      });
    }
    
    const coupons = await couponService.bulkCreateCoupons(count, baseData, adminUserId);
    
    res.status(201).json({
      success: true,
      data: coupons,
      count: coupons.length,
      message: `${coupons.length} coupons created successfully`,
    });
  } catch (error) {
    console.error('Error bulk creating coupons:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to bulk create coupons',
      message: error.message,
    });
  }
};

module.exports = {
  // Public
  validateCoupon,
  getCouponInfo,
  
  // Admin
  createCoupon,
  getAllCoupons,
  getCouponById,
  updateCoupon,
  deactivateCoupon,
  deleteCoupon,
  getCouponStats,
  getCampaignStats,
  bulkCreateCoupons,
};
