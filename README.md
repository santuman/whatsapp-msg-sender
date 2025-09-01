# WhatsApp Message Sender Webhook

A WhatsApp bot that provides a webhook API for sending messages to WhatsApp groups, with support for text, images (via URL or base64), and HTML content.

## Features

- **Webhook API**: Send messages to WhatsApp groups via API calls
- **API Key Authentication**: Secure your webhook endpoints with API key authentication
- **Multiple Message Types**: Support for text, media (via URL or base64), and HTML content
- **HTML to Image Conversion**: Automatically converts HTML content to images
- **Automatic Cleanup**: Automatically deletes generated images after the specified retention period

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and configure:
   ```
   cp .env.example .env
   ```
4. Set a secure API key in the `.env` file
5. Start the server:
   ```
   node index.js
   ```
6. Scan the generated QR code with your WhatsApp to authenticate

## API Endpoints

### Health Check

```
GET /api/webhook/health
```

Returns the status of the WhatsApp client.

### Send Message

```
POST /api/webhook/send
```

Headers:
```
X-API-Key: your_api_key_here
Content-Type: application/json
```

Request Body:

```json
{
  "groupId": "1234567890-group@g.us",
  "message": "Hello from the webhook!",
  "mediaType": "url",
  "mediaContent": "https://example.com/image.jpg",
  "html": "<div style='background-color: blue; color: white; padding: 20px;'>This HTML will be converted to an image</div>"
}
```

Parameters:
- `groupId` (required): The WhatsApp group ID to send the message to
- `message` (optional): The text message to send
- `mediaType` (optional): The type of media, can be "url" or "base64"
- `mediaContent` (optional): The media content, either a URL or base64 string
- `html` (optional): HTML content to be converted to an image

At least one of `message`, `mediaContent`, or `html` must be provided.

## Examples

### Sending a Text Message

```json
{
  "groupId": "1234567890-group@g.us",
  "message": "Hello from the webhook!"
}
```

### Sending an Image from URL with Caption

```json
{
  "groupId": "1234567890-group@g.us",
  "message": "Check out this image!",
  "mediaType": "url",
  "mediaContent": "https://example.com/image.jpg"
}
```

### Sending an Image from Base64 with Caption

```json
{
  "groupId": "1234567890-group@g.us",
  "message": "Base64 encoded image",
  "mediaType": "base64",
  "mediaContent": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQE..."
}
```

### Sending HTML Content as Image

```json
{
  "groupId": "1234567890-group@g.us",
  "message": "HTML converted to image",
  "html": "<div style='background-color: blue; color: white; padding: 20px; font-family: Arial;'><h1>Hello World</h1><p>This HTML has been converted to an image.</p></div>"
}
```

## Environment Variables

- `PORT`: The port to run the webhook server on (default: 3000)
- `API_KEY`: The API key for authentication
- `USER_AGENT`: The user agent to use for WhatsApp Web
- `IMAGE_DIR`: Directory to store converted HTML images (default: ./images)
- `IMAGE_RETENTION_DAYS`: Number of days to keep images before deletion (default: 1)
- `PUPPETEER_EXECUTABLE_PATH`: Optional path to Chromium executable

## License

MIT
