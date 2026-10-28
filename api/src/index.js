require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');
const referenceRoutes = require('./routes/reference');
const productRoutes = require('./routes/products');
const stockRoutes = require('./routes/stock');
const requisitionRoutes = require('./routes/requisitions');
const movementRoutes = require('./routes/movements');
const quoteRoutes = require('./routes/quotes');
const jobRoutes = require('./routes/jobs');
const sheetsRoutes = require('./routes/sheets');
const fileRoutes = require('./routes/files');
const systemRoutes = require('./routes/system');
const legacyRoutes = require('./routes/legacy');
const { Database } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (for rate limiting behind Cloudflare)
app.set('trust proxy', 1);

// CORS - allow frontend domain
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting (frontend makes many calls per session — keep generous)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX || '2000', 10),
  message: { status: 'error', message: 'Too many requests, please try again later' }
});
app.use(limiter);

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: { status: 'error', message: 'Too many auth attempts, please try again later' }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize database
const db = new Database({ DB: null }); // Will be set by Cloudflare Workers binding
app.locals.db = db;

// Routes
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/reference', referenceRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/stock', stockRoutes);
app.use('/api/v1/requisitions', requisitionRoutes);
app.use('/api/v1/movements', movementRoutes);
app.use('/api/v1/quotes', quoteRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/sheets', sheetsRoutes);
app.use('/api/v1/files', fileRoutes);
app.use('/api/v1/system', systemRoutes);
app.use('/api/v1/legacy', legacyRoutes);

// Serve the frontend (login.html, index.html, js/, css/, modules/)
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

// For Cloudflare Workers, export the app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = app;
}

// For local development
if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`RECON ERP API running on port ${PORT}`);
    console.log(`  effective PORT = ${process.env.PORT} (source: ${process.env.PORT !== undefined ? 'environment variable' : '.env / default'})`);
    console.log(`  DB_PATH        = ${process.env.DB_PATH || '(default)'}`);
  });
  server.on('error', (err) => {
    console.error(`Failed to start server on port ${PORT}:`, err.message);
    process.exit(1);
  });
}
