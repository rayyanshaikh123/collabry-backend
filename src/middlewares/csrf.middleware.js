const crypto = require('crypto');

/**
 * Double-Submit Cookie CSRF Protection
 *
 * How it works:
 * 1. On any GET request (or a dedicated endpoint), a random CSRF token is set in
 *    a readable (non-httpOnly) cookie: `csrfToken`.
 * 2. The frontend reads this cookie and sends it back in the `x-csrf-token` header
 *    on every state-mutating request (POST, PUT, PATCH, DELETE).
 * 3. This middleware compares the cookie value with the header value. If they don't
 *    match (or are missing), the request is rejected.
 *
 * Why this works:
 * - An attacker on another origin can trigger cross-site requests (form POST, etc.)
 *   but cannot read the cookie value (same-origin policy on cookies + SameSite).
 * - So they can't set the matching header.
 *
 * Safe methods (GET, HEAD, OPTIONS) are exempt because they should be idempotent.
 */

const CSRF_COOKIE_NAME = 'csrfToken';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_LENGTH = 32; // bytes → 64-char hex string

/**
 * Generate a new CSRF token
 */
const generateCsrfToken = () => {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
};

/**
 * Middleware: Ensure a CSRF cookie exists (set one if missing)
 */
const ensureCsrfToken = (req, res, next) => {
  let token = req.cookies[CSRF_COOKIE_NAME];
  
  if (!token) {
    token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false, // Frontend JS MUST be able to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
    // Also set it on the request so verify can use it in the same cycle
    req.cookies[CSRF_COOKIE_NAME] = token;
  }
  
  // Expose token via res.locals so controllers can include it in response body
  // This is needed for cross-origin setups where frontend can't read backend cookies
  res.locals.csrfToken = token;
  
  next();
};

/**
 * Middleware: Verify CSRF token on state-mutating requests
 *
 * @param {Object} options
 * @param {string[]} options.excludePaths - Array of path prefixes to exempt (e.g., webhooks)
 */
const verifyCsrfToken = (options = {}) => {
  const { excludePaths = [] } = options;

  return (req, res, next) => {
    // Safe methods — no CSRF check needed
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
      return next();
    }

    // Check excluded paths (e.g., webhook endpoints that come from Razorpay)
    const isExcluded = excludePaths.some((prefix) => req.path.startsWith(prefix));
    if (isExcluded) {
      return next();
    }

    const cookieToken = req.cookies[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME];

    if (!cookieToken || !headerToken) {
      return res.status(403).json({
        success: false,
        error: 'CSRF token missing',
        message: 'This request requires a CSRF token. Read the csrfToken cookie and send it in the x-csrf-token header.',
      });
    }

    // Constant-time comparison to prevent timing attacks
    try {
      const cookieBuf = Buffer.from(cookieToken, 'utf8');
      const headerBuf = Buffer.from(headerToken, 'utf8');

      if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
        return res.status(403).json({
          success: false,
          error: 'CSRF token mismatch',
        });
      }
    } catch {
      return res.status(403).json({
        success: false,
        error: 'CSRF token validation failed',
      });
    }

    next();
  };
};

module.exports = {
  ensureCsrfToken,
  verifyCsrfToken,
  CSRF_COOKIE_NAME,
};
