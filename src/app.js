/**
 * Express Application Setup
 * Configures middleware, security, routes, and global error handling.
 */

const express = require('express');
const { corsMiddleware, corsPreflight } = require('./middleware/cors.middleware');
const { requestLogger } = require('./middleware/logger.middleware');
const { notFoundHandler, globalErrorHandler } = require('./middleware/error.middleware');
const routes = require('./routes');

const app = express();

// 1. Trust proxy for cloud deployments (Render, Heroku, etc.)
app.set('trust proxy', 1);

// 2. CORS handling
app.use(corsMiddleware);
app.options('*', corsPreflight);

// 3. Request parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Request logging
app.use(requestLogger);

// 5. Mount API routes
app.use('/', routes);

// 6. 404 & Centralized Error handling
app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
