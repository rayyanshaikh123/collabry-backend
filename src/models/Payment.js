const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
    },
    
    // Razorpay IDs
    razorpay_payment_id: {
      type: String,
      required: true,
      unique: true,
    },
    razorpay_order_id: {
      type: String,
      default: null,
    },
    razorpay_signature: {
      type: String,
    },
    
    // Payment details
    amount: {
      type: Number,
      required: true, // in smallest currency unit (paise)
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: ['pending', 'authorized', 'captured', 'failed', 'refunded'],
      default: 'pending',
    },
    method: {
      type: String, // card, netbanking, wallet, upi
    },
    
    // Invoice details
    invoiceId: {
      type: String,
    },
    invoiceUrl: {
      type: String,
    },
    
    // Description
    description: {
      type: String,
    },
    notes: {
      type: Map,
      of: String,
    },
    
    // Failure details
    errorCode: {
      type: String,
    },
    errorDescription: {
      type: String,
    },
    failureReason: {
      type: String,
    },
    capturedAt: {
      type: Date,
    },
    
    // Refund
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundReason: {
      type: String,
    },
    refundedAt: {
      type: Date,
    },
    
    // Coupon/Discount
    couponCode: {
      type: String,
    },
    originalAmount: {
      type: Number,
    },
    discountApplied: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
paymentSchema.index({ user: 1, createdAt: -1 });
// razorpay_payment_id already has unique: true
// razorpay_order_id already has sparse index
paymentSchema.index({ status: 1 });

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
