const { Resend } = require('resend');
const config = require('../config/env');

/**
 * Email Service for sending emails using Resend
 */
class EmailService {
  constructor() {
    this.resend = null;
    this.devMode = false;
    this.initialize();
  }

  /**
   * Initialize Resend client
   */
  initialize() {
    try {
      const apiKey = config.email.resendApiKey;
      const isProd = process.env.NODE_ENV === 'production';

      if (!apiKey) {
        if (isProd) {
          console.error('❌ Email service initialization failed: Missing RESEND_API_KEY');
          return;
        }

        // Dev fallback — log emails instead of sending
        this.devMode = true;
        console.warn('⚠️ RESEND_API_KEY missing — emails will be logged, not delivered');
        return;
      }

      this.resend = new Resend(apiKey);
      console.log('✉️ Email service initialized (Resend)');
    } catch (error) {
      console.error('❌ Email service initialization failed:', error.message);
    }
  }

  /**
   * Send email
   * @param {Object} options - Email options
   * @param {string} options.to - Recipient email
   * @param {string} options.subject - Email subject
   * @param {string} options.html - HTML content
   * @param {string} options.text - Plain text content (optional)
   */
  async sendEmail({ to, subject, html, text }) {
    try {
      if (this.devMode) {
        console.log(`📩 [DEV] Email to: ${to} | Subject: ${subject}`);
        return { success: true, messageId: `dev-${Date.now()}` };
      }

      if (!this.resend) {
        throw new Error('Resend client not initialized');
      }

      const { data, error } = await this.resend.emails.send({
        from: `${config.email.fromName} <${config.email.from}>`,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });

      if (error) {
        throw new Error(error.message);
      }

      console.log('📧 Email sent successfully:', data.id);
      return { success: true, messageId: data.id };
    } catch (error) {
      console.error('❌ Email sending failed:', error.message);
      throw error;
    }
  }

  /**
   * Send password reset email
   * @param {string} email - User email
   * @param {string} name - User name
   * @param {string} resetToken - Password reset token
   */
  async sendPasswordResetEmail(email, name, resetToken) {
    const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .container {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 10px;
            padding: 40px;
            text-align: center;
          }
          .content {
            background: white;
            border-radius: 8px;
            padding: 30px;
            margin-top: 20px;
          }
          h1 {
            color: white;
            margin: 0;
            font-size: 28px;
          }
          .button {
            display: inline-block;
            padding: 15px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
          }
          .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #666;
          }
          .warning {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔐 Collabry</h1>
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>Hi ${name},</p>
            <p>We received a request to reset your password for your Collabry account.</p>
            <p>Click the button below to reset your password:</p>
            
            <a href="${resetUrl}" class="button">Reset Password</a>
            
            <div class="warning">
              <strong>⚠️ Important:</strong>
              <ul style="margin: 10px 0; padding-left: 20px; text-align: left;">
                <li>This link will expire in <strong>1 hour</strong></li>
                <li>If you didn't request this, please ignore this email</li>
                <li>Your password won't change until you create a new one</li>
              </ul>
            </div>
            
            <p style="margin-top: 20px; font-size: 14px; color: #666;">
              Or copy and paste this URL into your browser:<br/>
              <a href="${resetUrl}" style="color: #667eea; word-break: break-all;">${resetUrl}</a>
            </p>
          </div>
          
          <div class="footer">
            <p>© 2026 Collabry - AI Collaborative Study Platform</p>
            <p>This is an automated email, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'Reset Your Collabry Password',
      html,
    });
  }

  /**
   * Send password reset confirmation email
   * @param {string} email - User email
   * @param {string} name - User name
   */
  async sendPasswordResetConfirmation(email, name) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .container {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 10px;
            padding: 40px;
            text-align: center;
          }
          .content {
            background: white;
            border-radius: 8px;
            padding: 30px;
            margin-top: 20px;
          }
          h1 {
            color: white;
            margin: 0;
            font-size: 28px;
          }
          .success-icon {
            font-size: 60px;
            color: #28a745;
          }
          .button {
            display: inline-block;
            padding: 15px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
          }
          .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔐 Collabry</h1>
          <div class="content">
            <div class="success-icon">✓</div>
            <h2>Password Successfully Reset</h2>
            <p>Hi ${name},</p>
            <p>Your password has been successfully changed.</p>
            <p>You can now log in with your new password.</p>
            
            <a href="${config.frontendUrl}/login" class="button">Go to Login</a>
            
            <p style="margin-top: 30px; font-size: 14px; color: #666;">
              If you didn't make this change, please contact support immediately.
            </p>
          </div>
          
          <div class="footer">
            <p>© 2026 Collabry - AI Collaborative Study Platform</p>
            <p>This is an automated email, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'Password Reset Successful - Collabry',
      html,
    });
  }

  /**
   * Send email verification link
   * @param {string} email - User email
   * @param {string} name - User name
   * @param {string} verificationToken - Raw verification token
   */
  async sendEmailVerification(email, name, verificationToken) {
    const verifyUrl = `${config.frontendUrl}/verify-email?token=${verificationToken}`;

    // Helpful for local/dev when no API key is set.
    if (this.devMode) {
      console.log('📩 [DEV] Email verification link:', verifyUrl);
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .container {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 10px;
            padding: 40px;
            text-align: center;
          }
          .content {
            background: white;
            border-radius: 8px;
            padding: 30px;
            margin-top: 20px;
          }
          h1 {
            color: white;
            margin: 0;
            font-size: 28px;
          }
          .button {
            display: inline-block;
            padding: 15px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
            font-weight: bold;
          }
          .footer {
            margin-top: 30px;
            font-size: 12px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Welcome to Collabry!</h1>
          <div class="content">
            <h2>Verify Your Email</h2>
            <p>Hi ${name},</p>
            <p>Thanks for signing up! Please verify your email address to activate your account.</p>
            
            <a href="${verifyUrl}" class="button">Verify Email</a>
            
            <p style="margin-top: 20px; font-size: 14px; color: #666;">
              This link will expire in <strong>24 hours</strong>.
            </p>
            <p style="font-size: 14px; color: #666;">
              Or copy and paste this URL into your browser:<br/>
              <a href="${verifyUrl}" style="color: #667eea; word-break: break-all;">${verifyUrl}</a>
            </p>
          </div>
          
          <div class="footer">
            <p>&copy; 2026 Collabry - AI Collaborative Study Platform</p>
            <p>If you didn't create an account, please ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: email,
      subject: 'Verify Your Email - Collabry',
      html,
    });
  }

  /**
   * Verify email configuration
   */
  async verifyConnection() {
    try {
      if (this.devMode) {
        console.log('✅ Email service in dev mode (no verification needed)');
        return true;
      }
      if (!this.resend) {
        throw new Error('Resend client not initialized');
      }
      // Resend doesn't have a verify method — just check the client exists
      console.log('✅ Email service connection verified (Resend)');
      return true;
    } catch (error) {
      console.error('❌ Email service verification failed:', error.message);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
