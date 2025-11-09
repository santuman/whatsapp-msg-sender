# Migration Guide: whatsapp-web.js to Baileys

This document provides a comprehensive guide for the migration from `whatsapp-web.js` to `@whiskeysockets/baileys`.

## Overview

The application has been migrated from `whatsapp-web.js` (v1.33.2) to `@whiskeysockets/baileys` (v6.7.9). This migration brings several improvements:

### Benefits

1. **Reduced Resource Usage**: Baileys doesn't require a full Chromium browser for WhatsApp connection
2. **Lower Memory Footprint**: Significantly reduced memory consumption
3. **Better Performance**: Faster message sending and processing
4. **Active Development**: Baileys is actively maintained with regular updates
5. **Native Protocol**: Uses WhatsApp's native protocol instead of web automation

### Breaking Changes

#### 1. Authentication Storage
- **Old**: `.wwebjs_auth/` folder
- **New**: `baileys_auth/` folder
- **Impact**: You'll need to re-authenticate by scanning the QR code

#### 2. Group ID Format
- **Old**: Could be flexible
- **New**: Must be in format `1234567890-1234567890@g.us` for groups or `1234567890@s.whatsapp.net` for individual chats
- **Impact**: The webhook automatically handles format conversion, but ensure your group IDs are correct

#### 3. Message Media Handling
- **Old**: Used `MessageMedia` class from whatsapp-web.js
- **New**: Uses native Buffer objects with Baileys message format
- **Impact**: Internal change only; API interface remains the same

#### 4. Puppeteer Usage
- **Old**: Required for WhatsApp client connection
- **New**: Only required for HTML to image conversion
- **Impact**: Reduced Puppeteer usage = lower resource consumption

## Migration Steps

### Step 1: Backup Current Installation (Optional)

```bash
# Backup your authentication data (optional)
cp -r .wwebjs_auth .wwebjs_auth.backup

# Backup environment variables
cp .env .env.backup
```

### Step 2: Update Dependencies

```bash
# Remove node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Install new dependencies
npm install
```

### Step 3: Update Environment Variables

Your existing `.env` file should work, but you can add new optional variables:

```bash
# Optional: Set logging level (debug, info, warn, error)
LOG_LEVEL=info

# Optional: Batch message settings
MAX_BATCH_SIZE=1000
MESSAGE_DELAY_MS=5000
```

### Step 4: Clean Up Old Authentication (Optional)

```bash
# Remove old whatsapp-web.js authentication data
rm -rf .wwebjs_auth .wwebjs_cache
```

### Step 5: Start the Application

```bash
# Start normally
node index.js

# Or with PM2
pm2 start pm2.config.js
pm2 logs wbot-sender
```

### Step 6: Re-authenticate

1. The application will generate a QR code in the terminal
2. Open WhatsApp on your phone
3. Go to Settings → Linked Devices → Link a Device
4. Scan the QR code displayed in the terminal
5. Wait for "WhatsApp connection opened successfully!" message

## API Compatibility

### Good News! 🎉

The API endpoints remain **100% compatible**. No changes required to your existing API calls.

All existing endpoints work exactly the same:
- `POST /api/webhook/send` - Send single message
- `POST /api/webhook/send-batch` - Send batch messages
- `GET /api/webhook/health` - Health check
- `GET /api/status` - Client status

## Testing the Migration

### 1. Test Basic Connection

```bash
# Check if the client is ready
curl http://localhost:3000/api/status
```

Expected response:
```json
{
  "success": true,
  "message": "WhatsApp client is ready."
}
```

### 2. Test Text Message

```bash
curl -X POST http://localhost:3000/api/webhook/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "groupId": "YOUR_GROUP_ID@g.us",
    "message": "Test message from Baileys!"
  }'
```

### 3. Test Image Message

```bash
curl -X POST http://localhost:3000/api/webhook/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "groupId": "YOUR_GROUP_ID@g.us",
    "message": "Test image",
    "mediaType": "url",
    "mediaContent": "https://picsum.photos/200"
  }'
```

### 4. Test HTML to Image

```bash
curl -X POST http://localhost:3000/api/webhook/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "groupId": "YOUR_GROUP_ID@g.us",
    "message": "HTML Test",
    "html": "<div style=\"background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; font-family: Arial; border-radius: 10px;\"><h1>Migration Successful!</h1><p>Your WhatsApp bot is now running on Baileys.</p></div>"
  }'
```

### 5. Test Batch Messages

```bash
curl -X POST http://localhost:3000/api/webhook/send-batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "messages": [
      {
        "groupId": "GROUP_ID_1@g.us",
        "message": "Batch message 1"
      },
      {
        "groupId": "GROUP_ID_2@g.us",
        "message": "Batch message 2"
      }
    ]
  }'
```

## Troubleshooting

### Issue: QR Code Not Displaying

**Solution**: Make sure you're running the application in a terminal that supports QR code rendering. If not, the QR code data will be logged and you can use an online QR generator.

### Issue: Connection Keeps Dropping

**Possible causes**:
1. Network instability
2. Multiple instances running
3. Firewall blocking WebSocket connections

**Solutions**:
- Check your internet connection
- Ensure only one instance is running: `pm2 delete wbot-sender && pm2 start pm2.config.js`
- Check firewall settings

### Issue: "WhatsApp client is not ready"

**Solution**: Wait for the client to fully initialize. This can take 10-30 seconds after scanning the QR code.

### Issue: Messages Not Sending

**Possible causes**:
1. Incorrect group ID format
2. Client not authenticated
3. Rate limiting

**Solutions**:
- Verify group ID format (should end with `@g.us` for groups)
- Check client status: `curl http://localhost:3000/api/status`
- Increase `MESSAGE_DELAY_MS` in `.env` if sending many messages

### Issue: High Memory Usage

**Solution**: Baileys uses much less memory than whatsapp-web.js, but if you still see high usage:
- Restart the application periodically
- Reduce batch size (`MAX_BATCH_SIZE`)
- Increase delay between messages (`MESSAGE_DELAY_MS`)

## Performance Comparison

### Memory Usage
- **whatsapp-web.js**: ~300-500MB (with Chromium)
- **Baileys**: ~50-150MB

### CPU Usage
- **whatsapp-web.js**: High (browser rendering)
- **Baileys**: Low (native protocol)

### Connection Time
- **whatsapp-web.js**: 20-60 seconds
- **Baileys**: 5-15 seconds

## Rollback Plan

If you need to rollback to whatsapp-web.js:

1. Restore the backup:
```bash
git checkout HEAD -- package.json index.js routes/webhook.js
```

2. Reinstall dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

3. Restore authentication (if backed up):
```bash
cp -r .wwebjs_auth.backup .wwebjs_auth
```

4. Restart the application

## Code Changes Summary

### Files Modified
1. ✅ `package.json` - Updated dependencies
2. ✅ `index.js` - Complete rewrite to use Baileys
3. ✅ `routes/webhook.js` - Updated message handling for Baileys
4. ✅ `.gitignore` - Added `baileys_auth/` folder
5. ✅ `README.md` - Updated documentation

### Files Unchanged
- ✅ `whatsappclient.js` - No changes (wrapper still works)
- ✅ `utils/imageUtils.js` - No changes (HTML to image still uses Puppeteer)
- ✅ `pm2.config.js` - No changes
- ✅ All environment variable names (backward compatible)

## Support

If you encounter any issues during migration:

1. Check the logs: `pm2 logs wbot-sender` (if using PM2) or check console output
2. Verify all dependencies installed: `npm list`
3. Ensure Node.js version is compatible (Node.js 16+ recommended)
4. Check the [Baileys documentation](https://github.com/WhiskeySockets/Baileys)

## Conclusion

The migration to Baileys provides a more efficient, lightweight, and performant WhatsApp bot solution while maintaining complete API compatibility with your existing integrations.

**Timeline**:
- Initial setup: 5-10 minutes
- Re-authentication: 1-2 minutes
- Testing: 5-10 minutes
- **Total**: ~15-25 minutes

Happy messaging! 🚀
