const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const {
	default: makeWASocket,
	useMultiFileAuthState,
	DisconnectReason,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { router: webhookRouter } = require('./routes/webhook');
const { setupImageCleanupScheduler } = require('./utils/imageUtils');
const { setWhatsAppClient } = require('./whatsappclient');

process.setMaxListeners(15);
const logFilePath = path.join(__dirname, 'sc_commands.txt');

// Load environment variables
require('dotenv').config();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

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
		res.status(503).json({
			success: false,
			message: 'WhatsApp client is not ready.',
		});
	}
});

// Global variable to hold the socket connection
let sock = null;
let isConnected = false;

// Initialize WhatsApp client with Baileys
async function initializeClient() {
	try {
		const authFolder = path.join(__dirname, 'baileys_auth');

		// Ensure auth folder exists
		if (!fs.existsSync(authFolder)) {
			fs.mkdirSync(authFolder, { recursive: true });
		}

		// Load auth state
		const { state, saveCreds } = await useMultiFileAuthState(authFolder);

		// Get latest baileys version
		const { version, isLatest } = await fetchLatestBaileysVersion();
		logger.info(`Using Baileys version ${version}, isLatest: ${isLatest}`);

		// Create socket connection
		sock = makeWASocket({
			version,
			logger: pino({ level: 'silent' }), // Use silent mode for Baileys internal logging
			printQRInTerminal: false, // We'll handle QR manually
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(
					state.keys,
					pino({ level: 'silent' })
				),
			},
			generateHighQualityLinkPreview: true,
			// Browser info
			browser: ['WhatsApp Webhook', 'Chrome', '120.0.0'],
			markOnlineOnConnect: true,
		});

		// Handle connection updates
		sock.ev.on('connection.update', async (update) => {
			const { connection, lastDisconnect, qr } = update;

			// Display QR code
			if (qr) {
				qrcode.generate(qr, { small: true });
				logger.info('QR Code generated. Scan with WhatsApp to log in.');
			}

			// Handle connection status
			if (connection === 'close') {
				const shouldReconnect =
					lastDisconnect?.error?.output?.statusCode !==
					DisconnectReason.loggedOut;
				logger.warn(
					'Connection closed. Reason:',
					lastDisconnect?.error?.message
				);

				if (shouldReconnect) {
					logger.info('Reconnecting...');
					setTimeout(() => {
						initializeClient();
					}, 5000);
				} else {
					logger.error(
						'Logged out. Please delete baileys_auth folder and restart.'
					);
					isConnected = false;
					setWhatsAppClient(null);
				}
			} else if (connection === 'open') {
				logger.info('WhatsApp connection opened successfully!');
				isConnected = true;
				setWhatsAppClient(sock);
			} else if (connection === 'connecting') {
				logger.info('Connecting to WhatsApp...');
				isConnected = false;
			}
		});

		// Save credentials whenever they're updated
		sock.ev.on('creds.update', saveCreds);

		// Handle incoming messages
		sock.ev.on('messages.upsert', async ({ messages, type }) => {
			try {
				if (type !== 'notify') return;

				for (const message of messages) {
					// Skip if message is from self
					if (message.key.fromMe) continue;

					const messageContent =
						message.message?.conversation ||
						message.message?.extendedTextMessage?.text ||
						'';

					logger.debug(
						`Message received from ${message.key.remoteJid}: ${messageContent}`
					);

					// Handle SchoolCode messages
					if (messageContent.startsWith('SchoolCode:')) {
						const groupId = message.key.remoteJid;
						const logEntry = `${messageContent.trim()}, ${groupId}\n`;

						const requestBody = {
							schoolCode: messageContent.split(':')[1]?.trim(),
							groupId,
						};

						const requestOptions = {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
								Accept: 'application/json',
								'x-api-key': process.env.AA_WAPP_KEY,
							},
							body: JSON.stringify(requestBody),
						};

						await fetch(
							`${process.env.AA_WAPP_KEY}/config/whatsapp`,
							requestOptions
						);

						fs.appendFile(logFilePath, logEntry, (err) => {
							if (err) {
								logger.error(
									'Error writing to SchoolCode commands log file:',
									err
								);
							} else {
								logger.info(
									`Recorded SchoolCode command from group: ${groupId}`
								);
							}
						});
					}
				}
			} catch (error) {
				logger.error('Error handling message:', error);
			}
		});

		// Handle group updates
		sock.ev.on('groups.update', (updates) => {
			for (const update of updates) {
				logger.debug(`Group updated: ${update.id}`);
			}
		});

		// Handle presence updates (optional)
		sock.ev.on('presence.update', ({ id, presences }) => {
			// You can handle presence updates here if needed
		});
	} catch (error) {
		logger.error('Error initializing WhatsApp client:', error);
		setTimeout(() => {
			logger.info('Retrying initialization...');
			initializeClient();
		}, 10000);
	}
}

// Process shutdown handling
process.on('SIGINT', async () => {
	logger.info('SIGINT received. Shutting down gracefully...');
	try {
		if (sock) {
			await sock.logout();
			logger.info('WhatsApp client logged out successfully');
		}
	} catch (error) {
		logger.error('Error during graceful shutdown:', error);
	}
	process.exit(0);
});

process.on('SIGTERM', async () => {
	logger.info('SIGTERM received. Shutting down gracefully...');
	try {
		if (sock) {
			await sock.logout();
			logger.info('WhatsApp client logged out successfully');
		}
	} catch (error) {
		logger.error('Error during graceful shutdown:', error);
	}
	process.exit(0);
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
	logger.error('Uncaught exception:', error);
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
	logger.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the Express server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
	logger.info(`Webhook server is running on port ${PORT}`);
});

// Set up image cleanup scheduler
setupImageCleanupScheduler();

// Initialize WhatsApp client
logger.info('Initializing WhatsApp client with Baileys...');
initializeClient();
