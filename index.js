const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, } = require('whatsapp-web.js');
const { router: webhookRouter } = require('./routes/webhook');
const { setupImageCleanupScheduler } = require('./utils/imageUtils');
const { setWhatsAppClient } = require('./whatsappclient');
const logger = console;

process.setMaxListeners(15); // Increase the limit from default 10 to 15
const logFilePath = path.join(__dirname, 'sc_commands.txt')


// Load environment variables
require('dotenv').config();


const config = {
    puppeteerOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--ignore-certificate-errors-spki-list',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      headless: true,
      timeout: 180000, // Increased timeout
      defaultViewport: null,
    },
    retry: {
      maxAttempts: 3,
      initialDelay: 5000,
      maxDelay: 30000,
    },
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
    server: {
      port: process.env.PORT || 3000,
    }
};

// Initialize Express server
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Add webhook routes
app.use('/api/webhook', webhookRouter);

    // Add status endpoint
    app.get('/api/status', (req, res) => {
      const { getWhatsAppClient } = require('./whatsappclient');
      const client = getWhatsAppClient();
      if (client) {
        res.json({ success: true, message: 'WhatsApp client is ready.' });
      } else {
        res.status(503).json({ success: false, message: 'WhatsApp client is not ready.' });
      }
    });

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
    puppeteer: config.puppeteerOptions,
    restartOnAuthFail: true,
    qrMaxRetries: 5,
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});


// Error handling for client connection issues
client.on('disconnected', (reason) => {
  logger.warn('Client disconnected:', reason);
  setTimeout(() => {
    logger.info('Attempting to reconnect...');
    initializeClient();
  }, 15000); // Increased delay
});

// Add browser disconnect handler
client.on('browser_disconnect', () => {
  logger.warn('Browser disconnected. Attempting to restart...');
  setTimeout(() => {
    initializeClient();
  }, 10000);
});

// Share the WhatsApp client instance with the webhook router

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    logger.info('QR Code generated. Scan with WhatsApp to log in.');
  });

  client.on('authenticated', () => {
    logger.info('Authentication successful!');
  });

  client.on('auth_failure', (msg) => {
    logger.error('Authentication failure:', msg);

    setTimeout(() => {
      logger.info('Attempting to reconnect after auth failure...');
      client.initialize().catch(err =>
        logger.error('Failed to re-initialize after auth failure:', err)
      );
    }, 10000);
  });

  // Event: Ready
  client.on('ready', () => {
    setWhatsAppClient(client);
    logger.info('WhatsApp client is ready!');
  });

  // Add more detailed event logging
  client.on('loading_screen', (percent, message) => {
    logger.info(`Loading screen: ${percent}% - ${message}`);
  });

  client.on('change_state', (state) => {
    logger.info(`Client state changed to: ${state}`);
  });

  client.on('message', async (message) => {
    try {
      logger.debug(`Message received from ${message.from}: ${message.body}`);

      if (message.body.startsWith('SchoolCode:')) {
        const groupId = message.from;
        const logEntry = `${message.body.trim()}, ${groupId}\n`;

        // Append to file
        fs.appendFile(logFilePath, logEntry, (err) => {
          if (err) {
            logger.error('Error writing to SchoolCode commands log file:', err);
          } else {
            logger.info(`Recorded SchoolCode command from group: ${groupId}`);
          }
        });
      }
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  });



  // Event: Disconnected - moved up to avoid duplication
  // (Handled above after client creation)

  // Process shutdown handling
  process.on('SIGINT', async () => {
    logger.info('SIGINT received. Shutting down gracefully...');
    try {
      await client.destroy();
      logger.info('WhatsApp client destroyed successfully');
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    try {
      await client.destroy();
      logger.info('WhatsApp client destroyed successfully');
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
    }
    process.exit(0);
  });

  // Uncaught exception handler
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', error);
  });

  // Start the Express server
  const server = app.listen(config.server.port, () => {
    logger.info(`Webhook server is running on port ${config.server.port}`);
  });

  // Set up image cleanup scheduler
  setupImageCleanupScheduler();

  logger.info('Initializing WhatsApp client...');

  // Initialize client with proper error handling
  let initAttempts = 0;
  const maxInitAttempts = 5;

  const initializeClient = async () => {
    if (initAttempts >= maxInitAttempts) {
      logger.error('Max initialization attempts reached. Stopping retries.');
      return;
    }

    initAttempts++;
    logger.info(`Initialization attempt ${initAttempts}/${maxInitAttempts}`);

    try {
      await client.initialize();
      logger.info('Client initialization started successfully');
      initAttempts = 0; // Reset on success
    } catch (err) {
      logger.error(`Failed to initialize client (attempt ${initAttempts}):`, err.message);

      // Wait longer between retries for network issues
      const delay = err.message.includes('ERR_INTERNET_DISCONNECTED') ? 30000 : 15000;

      setTimeout(() => {
        logger.info(`Retrying initialization in ${delay/1000} seconds...`);
        initializeClient();
      }, delay);
    }
  };

  initializeClient();
