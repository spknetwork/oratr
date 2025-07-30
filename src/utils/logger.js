const winston = require('winston');
const path = require('path');
const { app } = require('electron');

// Create logs directory
const logsDir = app ? path.join(app.getPath('userData'), 'logs') : path.join(__dirname, '../../logs');

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // File output
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log')
    })
  ]
});

// Add method to log with metadata
logger.logWithMeta = (level, message, meta = {}) => {
  logger.log(level, message, {
    ...meta,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
};

module.exports = logger;