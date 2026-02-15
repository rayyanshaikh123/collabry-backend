const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 4,
      maxlength: 20,
    },
    
    // Discount configuration
    discountType: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    
    // Currency for fixed discounts
    currency: {
      type: String,
      default: 'INR',
    },
    
    // Maximum discount (for percentage discounts)
    maxDiscount: {
      type: Number,
      default: null, // null means no cap
    },
    
    // Minimum order/subscription amount required
    minimumAmount: {
      type: Number,
      default: 0,
    },
    
    // Applicable plans (empty = all plans)
    applicablePlans: [{
      type: String,
      enum: ['basic', 'pro', 'enterprise'],
    }],
    
    // Validity period
    validFrom: {
      type: Date,
      default: Date.now,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    
    // Usage limits
    maxUsageTotal: {
      type: Number,
      default: null, // null means unlimited
    },
    maxUsagePerUser: {
      type: Number,
      default: 1,
    },
    currentUsageCount: {
      type: Number,
      default: 0,
    },
    
    // Users who have used this coupon
    usedBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      usedAt: {
        type: Date,
        default: Date.now,
      },
      subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subscription',
      },
      discountApplied: {
        type: Number,
      },
    }],
    
    // Coupon status
    isActive: {
      type: Boolean,
      default: true,
    },
    
    // First-time subscriber only
    firstTimeOnly: {
      type: Boolean,
      default: false,
    },
    
    // Description/Notes
    description: {
      type: String,
      maxlength: 500,
    },
    
    // Internal notes (admin only)
    internalNotes: {
      type: String,
      maxlength: 1000,
    },
    
    // Campaign tracking
    campaign: {
      type: String,
      default: null,
    },
    
    // Created by admin
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
couponSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });
couponSchema.index({ campaign: 1 });

// Virtual for checking if coupon is valid
couponSchema.virtual('isValid').get(function () {
  const now = new Date();
  return (
    this.isActive &&
    now >= this.validFrom &&
    now <= this.validUntil &&
    (this.maxUsageTotal === null || this.currentUsageCount < this.maxUsageTotal)
  );
});

// Method to check if a user can use this coupon
couponSchema.methods.canBeUsedBy = async function (userId, plan, amount) {
  // Check if coupon is active and valid
  if (!this.isValid) {
    return { valid: false, reason: 'Coupon is no longer valid' };
  }
  
  // Check applicable plans
  if (this.applicablePlans.length > 0 && !this.applicablePlans.includes(plan)) {
    return { valid: false, reason: `Coupon not applicable for ${plan} plan` };
  }
  
  // Check minimum amount
  if (amount < this.minimumAmount) {
    return { 
      valid: false, 
      reason: `Minimum amount of ₹${this.minimumAmount / 100} required` 
    };
  }
  
  // Check usage limit per user
  const userUsageCount = this.usedBy.filter(
    (usage) => usage.user.toString() === userId.toString()
  ).length;
  
  if (userUsageCount >= this.maxUsagePerUser) {
    return { valid: false, reason: 'You have already used this coupon' };
  }
  
  // Check first-time only restriction
  if (this.firstTimeOnly) {
    const Subscription = require('./Subscription');
    const previousSubs = await Subscription.countDocuments({
      user: userId,
      plan: { $ne: 'free' },
    });
    
    if (previousSubs > 0) {
      return { valid: false, reason: 'Coupon is only for first-time subscribers' };
    }
  }
  
  return { valid: true };
};

// Method to calculate discount
couponSchema.methods.calculateDiscount = function (amount) {
  let discount;
  
  if (this.discountType === 'percentage') {
    discount = Math.round((amount * this.discountValue) / 100);
    
    // Apply max discount cap if set
    if (this.maxDiscount !== null && discount > this.maxDiscount) {
      discount = this.maxDiscount;
    }
  } else {
    // Fixed discount
    discount = this.discountValue;
  }
  
  // Discount cannot exceed the amount
  return Math.min(discount, amount);
};

// Method to apply coupon (record usage)
couponSchema.methods.apply = async function (userId, subscriptionId, discountApplied) {
  this.usedBy.push({
    user: userId,
    usedAt: new Date(),
    subscriptionId,
    discountApplied,
  });
  
  this.currentUsageCount += 1;
  
  await this.save();
  
  return true;
};

// Static method to generate a random coupon code
couponSchema.statics.generateCode = function (length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Static method to validate and get coupon
couponSchema.statics.validateAndGet = async function (code, userId, plan, amount) {
  const coupon = await this.findOne({ 
    code: code.toUpperCase(),
    isActive: true,
  });
  
  if (!coupon) {
    return { valid: false, reason: 'Invalid coupon code' };
  }
  
  const canUse = await coupon.canBeUsedBy(userId, plan, amount);
  
  if (!canUse.valid) {
    return canUse;
  }
  
  const discount = coupon.calculateDiscount(amount);
  
  return {
    valid: true,
    coupon,
    discount,
    finalAmount: amount - discount,
  };
};

const Coupon = mongoose.model('Coupon', couponSchema);

module.exports = Coupon;
