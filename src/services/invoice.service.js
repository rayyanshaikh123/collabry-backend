const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const emailService = require('../utils/emailService');

class InvoiceService {
  /**
   * Generate invoice PDF for a payment
   */
  async generateInvoice(paymentId) {
    const payment = await Payment.findById(paymentId)
      .populate('user', 'name email')
      .populate('subscription', 'plan interval');

    if (!payment) {
      throw new Error('Payment not found');
    }

    // Create invoices directory if it doesn't exist
    const invoicesDir = path.join(__dirname, '../../invoices');
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }

    // Generate invoice number
    const invoiceNumber = this.generateInvoiceNumber(payment);
    const fileName = `invoice-${invoiceNumber}.pdf`;
    const filePath = path.join(invoicesDir, fileName);

    // Create PDF
    await this.createInvoicePDF(payment, invoiceNumber, filePath);

    // Update payment with invoice details
    payment.invoiceId = invoiceNumber;
    payment.invoiceUrl = `/invoices/${fileName}`;
    await payment.save();

    return {
      invoiceNumber,
      invoiceUrl: payment.invoiceUrl,
      filePath,
    };
  }

  /**
   * Generate unique invoice number
   */
  generateInvoiceNumber(payment) {
    const date = new Date(payment.createdAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const id = payment._id.toString().slice(-6).toUpperCase();
    
    return `INV-${year}${month}${day}-${id}`;
  }

  /**
   * Create PDF invoice document
   */
  async createInvoicePDF(payment, invoiceNumber, filePath) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filePath);

      doc.pipe(stream);

      // Header
      doc.fontSize(20).text('INVOICE', { align: 'center' });
      doc.moveDown();

      // Company details
      doc.fontSize(12).text('Collabry', { align: 'left' });
      doc.fontSize(10).text('AI-Powered Learning Platform');
      doc.text('support@collabry.com');
      doc.moveDown();

      // Invoice details
      doc.fontSize(10);
      doc.text(`Invoice Number: ${invoiceNumber}`);
      doc.text(`Date: ${new Date(payment.createdAt).toLocaleDateString()}`);
      doc.text(`Status: ${payment.status.toUpperCase()}`);
      doc.moveDown();

      // Customer details
      doc.fontSize(12).text('Bill To:', { underline: true });
      doc.fontSize(10);
      doc.text(payment.user.name);
      doc.text(payment.user.email);
      doc.moveDown();

      // Line separator
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Items table header
      doc.fontSize(10).fillColor('#000');
      const tableTop = doc.y;
      doc.text('Description', 50, tableTop);
      doc.text('Amount', 400, tableTop, { width: 90, align: 'right' });
      
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      doc.moveDown();

      // Items
      const itemY = doc.y;
      const planName = payment.subscription ? 
        `${payment.subscription.plan} Plan - ${payment.subscription.interval}` : 
        'Subscription Payment';
      
      doc.text(payment.description || planName, 50, itemY);
      doc.text(`₹${(payment.amount / 100).toFixed(2)}`, 400, itemY, { width: 90, align: 'right' });
      doc.moveDown();

      // Line separator
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Total
      doc.fontSize(12).fillColor('#000');
      const totalY = doc.y;
      doc.text('Total:', 50, totalY);
      doc.text(`₹${(payment.amount / 100).toFixed(2)}`, 400, totalY, { width: 90, align: 'right' });
      doc.moveDown();

      // Payment details
      doc.moveDown();
      doc.fontSize(10);
      doc.text(`Payment Method: ${payment.method || 'Online'}`);
      doc.text(`Payment ID: ${payment.razorpay_payment_id}`);
      if (payment.razorpay_order_id) {
        doc.text(`Order ID: ${payment.razorpay_order_id}`);
      }
      doc.moveDown();

      // Footer
      doc.fontSize(8).fillColor('#666');
      doc.text('Thank you for your business!', { align: 'center' });
      doc.text('For support, contact us at support@collabry.com', { align: 'center' });

      doc.end();

      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  /**
   * Email invoice to user
   */
  async emailInvoice(paymentId) {
    const payment = await Payment.findById(paymentId)
      .populate('user', 'name email');

    if (!payment || !payment.invoiceUrl) {
      throw new Error('Invoice not found');
    }

    const invoicePath = path.join(__dirname, '../..', payment.invoiceUrl);
    
    if (!fs.existsSync(invoicePath)) {
      throw new Error('Invoice file not found');
    }

    const subject = `Invoice ${payment.invoiceId} - Collabry`;
    const html = `
      <h2>Thank you for your payment!</h2>
      <p>Hi ${payment.user.name},</p>
      <p>Thank you for your subscription payment. Please find your invoice attached.</p>
      <p><strong>Invoice Details:</strong></p>
      <ul>
        <li>Invoice Number: ${payment.invoiceId}</li>
        <li>Amount: ₹${(payment.amount / 100).toFixed(2)}</li>
        <li>Date: ${new Date(payment.createdAt).toLocaleDateString()}</li>
      </ul>
      <p>If you have any questions, please contact us at support@collabry.com</p>
      <p>Best regards,<br>The Collabry Team</p>
    `;

    await emailService.sendEmail({
      to: payment.user.email,
      subject,
      html,
      attachments: [
        {
          filename: `invoice-${payment.invoiceId}.pdf`,
          path: invoicePath,
        },
      ],
    });

    return { success: true };
  }

  /**
   * Get all invoices for a user
   */
  async getUserInvoices(userId) {
    const payments = await Payment.find({
      user: userId,
      status: 'captured',
      invoiceId: { $exists: true },
    })
      .populate('subscription', 'plan interval')
      .sort({ createdAt: -1 });

    return payments.map(payment => ({
      id: payment._id,
      invoiceNumber: payment.invoiceId,
      invoiceUrl: payment.invoiceUrl,
      amount: payment.amount,
      currency: payment.currency,
      date: payment.createdAt,
      status: payment.status,
      description: payment.description,
      plan: payment.subscription ? {
        name: payment.subscription.plan,
        interval: payment.subscription.interval,
      } : null,
    }));
  }

  /**
   * Generate invoice for payment (called from webhook or manually)
   */
  async generateAndEmailInvoice(paymentId) {
    try {
      // Generate invoice
      const invoice = await this.generateInvoice(paymentId);
      
      // Email invoice
      await this.emailInvoice(paymentId);
      
      return invoice;
    } catch (error) {
      console.error('Error generating/emailing invoice:', error);
      throw error;
    }
  }
}

module.exports = new InvoiceService();
