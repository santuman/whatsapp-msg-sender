const fs = require('fs-extra');
const path = require('path');
const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');
const schedule = require('node-schedule');
const logger = console;

// Load environment variables
require('dotenv').config();

const IMAGE_DIR = process.env.IMAGE_DIR || './images';
const IMAGE_RETENTION_DAYS = parseInt(process.env.IMAGE_RETENTION_DAYS || '1', 10);

// Ensure the images directory exists
fs.ensureDirSync(IMAGE_DIR);

/**
 * Convert HTML content to an image and save it locally
 * @param {string} htmlContent - The HTML content to convert
 * @param {number} vh - The viewport height
 * @param {number} vw - The viewport
 * @returns {Promise<{filePath: string, fileName: string}>} - Path to the saved image
 */
async function htmlToImage({htmlContent, vh, vw}) {
  let browser = null;

  const width = vw ? vw : 800;
    const height = vh ? vh : 800;

  try {
    // Launch a headless browser
    browser = await puppeteer.launch({
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
      headless: 'new',
    });

    const page = await browser.newPage();

    // Set content and wait for rendering
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Generate a unique filename
    const fileName = `${uuidv4()}.png`;
    const filePath = path.join(IMAGE_DIR, fileName);

    // Take a screenshot and save it
    await page.setViewport({width, height, deviceScaleFactor: 2});
    await page.screenshot({ path: filePath, fullPage: true, });

    logger.info(`HTML converted to image and saved at: ${filePath}`);
    return { filePath, fileName };
  } catch (error) {
    logger.error('Error converting HTML to image:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Schedule cleanup of images older than the retention period
 */
function setupImageCleanupScheduler() {
  // Run cleanup daily at midnight
  schedule.scheduleJob('0 0 * * *', async () => {
    try {
      logger.info('Running scheduled image cleanup');
      await cleanupOldImages();
    } catch (error) {
      logger.error('Error during scheduled image cleanup:', error);
    }
  });
}

/**
 * Clean up images older than the retention period
 */
async function cleanupOldImages() {
  try {
    const files = await fs.readdir(IMAGE_DIR);
    const now = new Date();

    for (const file of files) {
      const filePath = path.join(IMAGE_DIR, file);
      const stats = await fs.stat(filePath);

      // Calculate file age in days
      const fileAge = (now - stats.mtime) / (1000 * 60 * 60 * 24);

      if (fileAge >= IMAGE_RETENTION_DAYS) {
        await fs.unlink(filePath);
        logger.info(`Deleted old image: ${filePath}`);
      }
    }

    logger.info('Image cleanup completed');
  } catch (error) {
    logger.error('Error cleaning up old images:', error);
    throw error;
  }
}

module.exports = {
  htmlToImage,
  setupImageCleanupScheduler,
  cleanupOldImages
};
