const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const { protect } = require('../middlewares/auth.middleware');

// Public routes
router.get('/plans', subscriptionController.getPlans);

// Protected routes (require authentication)
router.use(protect); // Apply auth middleware to all routes below

router.get('/current', subscriptionController.getCurrentSubscription);
router.post('/create-order', subscriptionController.createOrder);
router.post('/verify-payment', subscriptionController.verifyPayment);
router.post('/cancel', subscriptionController.cancelSubscription);
router.post('/reactivate', subscriptionController.reactivateSubscription);
router.get('/payment-history', subscriptionController.getPaymentHistory);
router.get('/feature-access/:feature', subscriptionController.checkFeatureAccess);

module.exports = router;
