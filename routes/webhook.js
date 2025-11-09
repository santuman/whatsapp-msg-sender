const express = require('express');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const { htmlToImage } = require('../utils/imageUtils');
const { getWhatsAppClient } = require('../whatsappclient');
const logger = console;

// Create router
const router = express.Router();

// Middleware to check API key
const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid API Key' });
  }

  next();
};

/**
 * Helper function to prepare media message for Baileys
 * @param {string} mediaPath - Path to the media file
 * @param {string} mimeType - MIME type of the media
 * @param {string} caption - Caption for the media
 * @returns {Object} - Baileys message object
 */
function prepareMediaMessage(mediaPath, mimeType, caption = '') {
  const mediaBuffer = fs.readFileSync(mediaPath);

  if (mimeType.startsWith('image/')) {
    return {
      image: mediaBuffer,
      caption: caption || undefined,
    };
  } else if (mimeType.startsWith('video/')) {
    return {
      video: mediaBuffer,
      caption: caption || undefined,
    };
  } else if (mimeType.startsWith('audio/')) {
    return {
      audio: mediaBuffer,
      mimetype: mimeType,
    };
  } else {
    return {
      document: mediaBuffer,
      mimetype: mimeType,
      fileName: caption || 'document',
    };
  }
}

/**
 * Helper function to prepare media from base64
 * @param {string} base64Data - Base64 encoded media
 * @param {string} mimeType - MIME type of the media
 * @param {string} caption - Caption for the media
 * @returns {Object} - Baileys message object
 */
function prepareBase64Media(base64Data, mimeType, caption = '') {
  const mediaBuffer = Buffer.from(base64Data, 'base64');

  if (mimeType.startsWith('image/')) {
    return {
      image: mediaBuffer,
      caption: caption || undefined,
    };
  } else if (mimeType.startsWith('video/')) {
    return {
      video: mediaBuffer,
      caption: caption || undefined,
    };
  } else if (mimeType.startsWith('audio/')) {
    return {
      audio: mediaBuffer,
      mimetype: mimeType,
    };
  } else {
    return {
      document: mediaBuffer,
      mimetype: mimeType,
      fileName: caption || 'document',
    };
  }
}

/**
 * Helper function to download media from URL
 * @param {string} url - URL to download from
 * @returns {Promise<Buffer>} - Media buffer
 */
async function downloadFromUrl(url) {
  const https = require('https');
  const http = require('http');

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Send message with retry logic
 */
async function sendMessageWithRetry(client, groupId, message, options = {}) {
  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Ensure groupId has correct format (should end with @g.us for groups or @s.whatsapp.net for individuals)
      let formattedGroupId = groupId;
      if (!groupId.includes('@')) {
        // If it's a group, it should end with @g.us
        formattedGroupId = groupId.includes('-') ? `${groupId}@g.us` : `${groupId}@s.whatsapp.net`;
      }

      // Send message using Baileys
      const result = await client.sendMessage(formattedGroupId, message, options);
      return result;
    } catch (error) {
      lastError = error;
      logger.warn(`Attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);

      if (attempt < MAX_RETRIES) {
        // Exponential backoff
        const retryDelay = Math.pow(2, attempt) * 1000;
        logger.info(`Waiting ${retryDelay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  // If we got here, all retries failed
  throw lastError;
}

// Webhook endpoint to send messages
router.post('/send', apiKeyAuth, async (req, res) => {
  try {
    const { groupId, message, mediaType, mediaContent, html, sendHd } = req.body;

    // Validate required parameters
    if (!groupId) {
      return res.status(400).json({ success: false, message: 'Group ID is required' });
    }

    if (!message && !mediaContent && !html) {
      return res.status(400).json({
        success: false,
        message: 'At least one of message, mediaContent, or html must be provided'
      });
    }

    // Check if client is ready
    const whatsappClient = getWhatsAppClient();
    if (!whatsappClient) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp client is not ready yet. Please try again later.'
      });
    }

    let messageContent = null;
    const captionText = message || '';

    // Process HTML content if provided
    if (html) {
      try {
        const { filePath, fileName } = await htmlToImage({ htmlContent: html });
        messageContent = prepareMediaMessage(filePath, 'image/png', captionText);
        logger.info(`HTML converted to image: ${fileName}`);
      } catch (error) {
        logger.error('Error converting HTML to image:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to convert HTML to image',
          error: error.message
        });
      }
    }
    // Process media content if provided and no HTML
    else if (mediaContent && mediaType) {
      try {
        if (mediaType === 'base64') {
          // Handle base64 media content
          let mimeType = 'image/png'; // Default
          let base64Data = mediaContent;

          if (mediaContent.startsWith('data:')) {
            const matches = mediaContent.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              mimeType = matches[1];
              base64Data = matches[2];
            }
          }

          messageContent = prepareBase64Media(base64Data, mimeType, captionText);
        }
        // Handle remote URL media content
        else if (mediaType === 'url') {
          const mediaBuffer = await downloadFromUrl(mediaContent);

          // Try to determine MIME type from URL or default to image
          let mimeType = 'image/jpeg';
          if (mediaContent.includes('.png')) mimeType = 'image/png';
          else if (mediaContent.includes('.gif')) mimeType = 'image/gif';
          else if (mediaContent.includes('.mp4')) mimeType = 'video/mp4';
          else if (mediaContent.includes('.pdf')) mimeType = 'application/pdf';

          if (mimeType.startsWith('image/')) {
            messageContent = { image: mediaBuffer, caption: captionText || undefined };
          } else if (mimeType.startsWith('video/')) {
            messageContent = { video: mediaBuffer, caption: captionText || undefined };
          } else {
            messageContent = { document: mediaBuffer, mimetype: mimeType, fileName: captionText || 'document' };
          }
        }
        else {
          return res.status(400).json({
            success: false,
            message: 'Invalid mediaType. Supported types: base64, url'
          });
        }
      } catch (error) {
        logger.error('Error processing media content:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to process media content',
          error: error.message
        });
      }
    }

    // Send message with or without media
    if (messageContent) {
      await sendMessageWithRetry(whatsappClient, groupId, messageContent);
      logger.info(`Message with media sent to ${groupId}`);
    } else {
      await sendMessageWithRetry(whatsappClient, groupId, { text: captionText });
      logger.info(`Text message sent to ${groupId}`);
    }

    return res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      groupId
    });

  } catch (error) {
    logger.error('Error sending message via webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

router.post('/send-batch', apiKeyAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    const MAX_BATCH_SIZE = parseInt(process.env.MAX_BATCH_SIZE || '1000');
    const MESSAGE_DELAY_MS = parseInt(process.env.MESSAGE_DELAY_MS || '5000');

    // Validation checks
    if (!Array.isArray(messages)) {
      logger.error('Invalid messages parameter:', messages);
      return res.status(400).json({
        success: false,
        message: 'The messages parameter must be an array'
      });
    }

    if (messages.length === 0) {
      logger.error('Empty messages array');
      return res.status(400).json({
        success: false,
        message: 'The messages array cannot be empty'
      });
    }

    if (messages.length > MAX_BATCH_SIZE) {
      logger.error('Batch size exceeds maximum allowed:', messages.length);
      return res.status(400).json({
        success: false,
        message: `Batch size exceeds maximum allowed (${MAX_BATCH_SIZE})`
      });
    }

    const whatsappClient = getWhatsAppClient();
    if (!whatsappClient) {
      logger.error('WhatsApp client is not ready');
      return res.status(503).json({
        success: false,
        message: 'WhatsApp client is not ready yet. Please try again later.'
      });
    }

    let successCount = 0;
    let failureCount = 0;

    // Send immediate response
    res.status(202).json({
      success: true,
      message: `Processing ${messages.length} messages sequentially with ${MESSAGE_DELAY_MS}ms delay between each`,
      totalMessages: messages.length
    });

    // Process messages sequentially
    for (let i = 0; i < messages.length; i++) {
      try {
        const messageData = messages[i];
        const { groupId, message, mediaType, mediaContent, html, sendHd, vh, vw } = messageData;

        // Validate this specific message
        if (!groupId) {
          failureCount++;
          logger.warn(`Message ${i+1}/${messages.length} missing groupId`);
          continue;
        }

        if (!message && !mediaContent && !html) {
          failureCount++;
          logger.warn(`Message ${i+1}/${messages.length} missing content for group ${groupId}`);
          continue;
        }

        let messageContent = null;
        const captionText = message || '';

        // Process HTML content if provided
        if (html) {
          try {
            const { filePath, fileName } = await htmlToImage({
              htmlContent: html,
              vw,
              vh
            });
            messageContent = prepareMediaMessage(filePath, 'image/png', captionText);
            logger.info(`HTML converted to image: ${fileName}`);
          } catch (error) {
            failureCount++;
            logger.error(`Error converting HTML to image for message ${i+1}/${messages.length}:`, error);
            continue;
          }
        }
        // Process media content if provided
        else if (mediaContent && mediaType) {
          try {
            if (mediaType === 'base64') {
              let mimeType = 'image/png';
              let base64Data = mediaContent;

              if (mediaContent.startsWith('data:')) {
                const matches = mediaContent.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                  mimeType = matches[1];
                  base64Data = matches[2];
                }
              }

              messageContent = prepareBase64Media(base64Data, mimeType, captionText);
            }
            else if (mediaType === 'url') {
              const mediaBuffer = await downloadFromUrl(mediaContent);

              let mimeType = 'image/jpeg';
              if (mediaContent.includes('.png')) mimeType = 'image/png';
              else if (mediaContent.includes('.gif')) mimeType = 'image/gif';
              else if (mediaContent.includes('.mp4')) mimeType = 'video/mp4';
              else if (mediaContent.includes('.pdf')) mimeType = 'application/pdf';

              if (mimeType.startsWith('image/')) {
                messageContent = { image: mediaBuffer, caption: captionText || undefined };
              } else if (mimeType.startsWith('video/')) {
                messageContent = { video: mediaBuffer, caption: captionText || undefined };
              } else {
                messageContent = { document: mediaBuffer, mimetype: mimeType, fileName: captionText || 'document' };
              }
            }
            else {
              failureCount++;
              logger.warn(`Invalid mediaType for message ${i+1}/${messages.length}, group ${groupId}: ${mediaType}`);
              continue;
            }
          } catch (error) {
            failureCount++;
            logger.error(`Error processing media content for message ${i+1}/${messages.length}:`, error);
            continue;
          }
        }

        // Send message with retry mechanism
        try {
          if (messageContent) {
            await sendMessageWithRetry(whatsappClient, groupId, messageContent);
            logger.info(`Message ${i+1}/${messages.length} with media sent to ${groupId}`);
          } else {
            await sendMessageWithRetry(whatsappClient, groupId, { text: captionText });
            logger.info(`Text message ${i+1}/${messages.length} sent to ${groupId}`);
          }

          successCount++;
        } catch (sendError) {
          failureCount++;
          logger.error(`All retries failed for message ${i+1}/${messages.length}:`, sendError);
        }

        // Add delay between messages
        if (i < messages.length - 1) {
          logger.info(`Waiting ${MESSAGE_DELAY_MS}ms before processing next message...`);
          await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
        }

        // Log progress
        logger.info(`Batch progress: ${i+1}/${messages.length} messages processed (${successCount} successful, ${failureCount} failed)`);

        // Free up memory
        if (messageContent) {
          messageContent = null;
        }
      } catch (messageError) {
        failureCount++;
        logger.error(`Unexpected error processing message ${i+1}/${messages.length}:`, messageError);
      }
    }

    logger.info(`Batch processing completed: ${successCount} successful, ${failureCount} failed`);
  } catch (error) {
    logger.error('Fatal error in batch processing:', error);
  }
});

// Health check endpoint (not requiring API key)
router.get('/health', (req, res) => {
  const client = getWhatsAppClient();
  const status = client ? 'ready' : 'initializing';
  res.status(200).json({
    success: true,
    service: 'whatsapp-webhook',
    status
  });
});

module.exports = {
  router,
};
