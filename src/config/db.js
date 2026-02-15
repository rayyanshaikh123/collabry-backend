const mongoose = require('mongoose');
const dns = require('dns');
const config = require('./env');

// Fix for Node.js c-ares DNS resolver failing SRV lookups on some machines.
// The OS resolves fine, but Node's internal resolver (c-ares) may refuse
// connections to the local router DNS for SRV queries.
// Using public DNS servers (Google + Cloudflare) as fallback.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const connectDB = async () => {
  const maxRetries = 5;
  const baseDelayMs = 1000;

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // safe display of host for logs (don't print credentials)
  const extractHost = (uri) => {
    try {
      // remove credentials if present
      const withoutCreds = uri.replace(/mongodb(\+srv)?:\/\/.*@/, 'mongodb$1://');
      // try to capture host part
      const m = withoutCreds.match(/mongodb(\+srv)?:\/\/([^\/\?]+)/);
      if (m && m[2]) return m[2];
      return withoutCreds;
    } catch (e) {
      return 'unknown-host';
    }
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const conn = await mongoose.connect(config.mongodb.uri, config.mongodb.options);
      console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

      // Handle connection events
      mongoose.connection.on('error', (err) => {
        console.error(`❌ MongoDB connection error: ${err}`);
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('⚠️  MongoDB disconnected');
      });

      return conn;
    } catch (error) {
      const host = extractHost(config.mongodb.uri || '');
      console.error(`❌ Error connecting to MongoDB (attempt ${attempt} of ${maxRetries}) to host ${host}: ${error.message}`);

      // SRV/DNS specific hint
      if ((error.message && error.message.toLowerCase().includes('querysrv')) || (error.code === 'ENOTFOUND') || (error.code === 'ECONNREFUSED')) {
        if ((config.mongodb.uri || '').startsWith('mongodb+srv://')) {
          console.warn('ℹ️  Detected SRV/DNS issue for mongodb+srv connection string.');
          console.warn('   - Check your network/DNS or try a standard mongodb:// connection string.');
          console.warn('   - If you are behind a firewall or using localhost DNS overrides, SRV lookups may fail.');
        }
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.log(`⏳ Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      console.error('⛔ All retries to connect to MongoDB have been exhausted.');
      console.error('Please verify your MONGODB_URI, network connectivity, and DNS for SRV records.');
      // show a short diagnostic of the URI host only
      console.error(`Attempted host: ${host}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
