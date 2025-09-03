const express = require('express');
const { MessageMedia } = require('whatsapp-web.js');
const { htmlToImage } = require('../utils/imageUtils');
const { getWhatsAppClient, whatsappClient } = require('../whatsappclient');
const logger = console;
const { delay } = require('util');

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

// Add these helper functions
async function sendMessageWithRetry(client, groupId, content, options = {}) {
  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Make sure client is properly initialized before each attempt
      if (!client.pupPage || !client.pupBrowser) {
        throw new Error('WhatsApp client not fully initialized');
      }

      // Wait a bit to ensure client is ready
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Attempt to send the message
      const result = await client.sendMessage(groupId, content, options);
      return result;
    } catch (error) {
      lastError = error;
      logger.warn(`Attempt ${attempt}/${MAX_RETRIES} failed:`, error.message);

      // Check if it's a WidFactory error or other initialization error
      if (error.message.includes('WidFactory') ||
          error.message.includes('undefined') ||
          error.message.includes('not fully initialized')) {

        // Wait longer between retries (exponential backoff)
        const retryDelay = Math.pow(2, attempt) * 3000;
        logger.info(`Waiting ${retryDelay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));

        // Try to ensure client is ready
        try {
          // Force client to refresh state if possible
          if (client.refreshState) {
            await client.refreshState();
          }
        } catch (refreshError) {
          logger.warn('Failed to refresh client state:', refreshError.message);
        }
      } else {
        // For other errors, don't retry
        break;
      }
    }
  }

  // If we got here, all retries failed
  throw lastError;
}

// Webhook endpoint to send messages
router.post('/send', apiKeyAuth, async (req, res) => {
  try {
    const { groupId, message, mediaType, mediaContent, html,sendHd } = req.body;

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
    if (!whatsappClient || !whatsappClient.info) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp client is not ready yet. Please try again later.'
      });
    }

    let media = null;
    let captionText = message || '';

    // Process HTML content if provided
    if (html) {
      try {
        const { filePath, fileName } = await htmlToImage(html);
        console.log(filePath, fileName);
        media = MessageMedia.fromFilePath(
            `./${filePath}`
        );
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
        // Handle base64 media content
        if (mediaType === 'base64') {
          // Try to determine the mime type from the base64 data
          let mimeType = 'image/png';  // Default
          if (mediaContent.startsWith('data:')) {
            const matches = mediaContent.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              mimeType = matches[1];
              mediaContent = matches[2];
            }
          }
          media = new MessageMedia(mimeType, mediaContent);
        }
        // Handle remote URL media content
        else if (mediaType === 'url') {
          media = await MessageMedia.fromUrl(mediaContent);
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
    if (media) {
        const mediaOptions = {
            caption: captionText,
            // Set quality to 100 for HD images while still showing preview
            sendVideoAsGif: false,
        }
        await whatsappClient.sendMessage(groupId, media, mediaOptions);
      logger.info(`Message with media sent to ${groupId}`);
    } else {
      await whatsappClient.sendMessage(groupId, captionText);
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
    const MESSAGE_DELAY_MS = parseInt(process.env.MESSAGE_DELAY_MS || '5000'); // Increased delay

    // Validation checks remain the same
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
      logger.error('WhatsApp client is not ready', whatsappClient);
      return res.status(503).json({
        success: false,
        message: 'WhatsApp client is not ready yet. Please try again later.'
      });
    }

    // Wait a bit to ensure client is ready
    // logger.info('Waiting to ensure WhatsApp client is ready...');
    // await new Promise(resolve => setTimeout(resolve, 3000));

    let successCount = 0;
    let failureCount = 0;

    // Send immediate response
    res.status(202).json({
      success: true,
      message: `Processing ${messages.length} messages sequentially with ${MESSAGE_DELAY_MS}ms delay between each`,
      totalMessages: messages.length
    });

    // Process messages sequentially instead of in parallel
    for (let i = 0; i < messages.length; i++) {
      try {
        const messageData = messages[i];
        const { groupId, message, mediaType, mediaContent, html, sendHd, vh,vw } = messageData;

        // Validate this specific message
        if (!groupId) {
          failureCount++;
          logger.warn(`Message ${i+1}/${messages.length} missing groupId`);
          continue; // Skip to next message
        }

        if (!message && !mediaContent && !html) {
          failureCount++;
          logger.warn(`Message ${i+1}/${messages.length} missing content for group ${groupId}`);
          continue; // Skip to next message
        }

        let media = null;
        let captionText = message || '';

        // Process HTML content if provided
        if (html) {
          try {
            const { filePath, fileName } = await htmlToImage({
                htmlContent: html,
                vw,
                vh
            });
            media = MessageMedia.fromFilePath(`./${filePath}`);
            logger.info(`HTML converted to image: ${fileName}`);
          } catch (error) {
            failureCount++;
            logger.error(`Error converting HTML to image for message ${i+1}/${messages.length}:`, error);
            continue; // Skip to next message
          }
        }
        // Process media content if provided
        else if (mediaContent && mediaType) {
          try {
            if (mediaType === 'base64') {
              let mimeType = 'image/png';  // Default
              let processedContent = mediaContent;
              if (mediaContent.startsWith('data:')) {
                const matches = mediaContent.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                  mimeType = matches[1];
                  processedContent = matches[2];
                }
              }
              media = new MessageMedia(mimeType, processedContent);
            }
            else if (mediaType === 'url') {
              media = await MessageMedia.fromUrl(mediaContent);
            }
            else {
              failureCount++;
              logger.warn(`Invalid mediaType for message ${i+1}/${messages.length}, group ${groupId}: ${mediaType}`);
              continue; // Skip to next message
            }
          } catch (error) {
            failureCount++;
            logger.error(`Error processing media content for message ${i+1}/${messages.length}:`, error);
            continue; // Skip to next message
          }
        }

        // Send message with retry mechanism
        try {
          if (media) {
            const mediaOptions = {
              caption: captionText,
              sendVideoAsGif: false,
            };

            await sendMessageWithRetry(whatsappClient, groupId, media, mediaOptions);
            logger.info(`Message ${i+1}/${messages.length} with media sent to ${groupId}`);
          } else {
            await sendMessageWithRetry(whatsappClient, groupId, captionText);
            logger.info(`Text message ${i+1}/${messages.length} sent to ${groupId}`);
          }

          successCount++;
        } catch (sendError) {
          failureCount++;
          logger.error(`All retries failed for message ${i+1}/${messages.length}:`, sendError);

          // If we're getting WidFactory errors, we should increase the delay
          if (sendError.message.includes('WidFactory')) {
            logger.info(`Increasing delay to ensure client stabilizes...`);
            await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS * 2));
          }
        }

        // Add longer delay between messages to prevent overwhelming the client
        if (i < messages.length - 1) {
          logger.info(`Waiting ${MESSAGE_DELAY_MS}ms before processing next message...`);
          await new Promise(resolve => setTimeout(resolve, MESSAGE_DELAY_MS));
        }

        // Log progress every message
        logger.info(`Batch progress: ${i+1}/${messages.length} messages processed (${successCount} successful, ${failureCount} failed)`);

        // Free up memory
        if (media) {
          media = null;
        }
      } catch (messageError) {
        failureCount++;
        logger.error(`Unexpected error processing message ${i+1}/${messages.length}:`, messageError);
      }
    }

    logger.info(`Batch processing completed: ${successCount} successful, ${failureCount} failed`);
  } catch (error) {
    console.log(error)
    logger.error('Fatal error in batch processing:', error);
  }
});

// Health check endpoint (not requiring API key)
router.get('/health', (req, res) => {
  const status = whatsappClient && whatsappClient.info ? 'ready' : 'initializing';
  res.status(200).json({
    success: true,
    service: 'whatsapp-webhook',
    status
  });
});

module.exports = {
  router,

};
