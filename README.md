# n8n Agent Engine Proxy

Simple proxy service for connecting n8n to Vertex AI Agent Engine.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your Agent Engine endpoint and service account key
```

3. Run:
```bash
npm start
```

## Usage in n8n

### HTTP Request Node Configuration

**Method**: POST  
**URL**: `http://localhost:3001/api/chat`  
**Body (JSON)**:
```json
{
  "userId": "{{ $json.from }}",
  "message": "{{ $json.message }}"
}
```

**Response**: 
```json
{
  "text": "Agent response text",
  "sessionId": "session-id-123"
}
```

## n8n Workflow Example

1. **Trigger**: WhatsApp/Telegram Webhook
2. **HTTP Request**: POST to proxy `/api/chat`
3. **Response**: Send `{{ $json.text }}` back to user

## Deploy to Production

Deploy this proxy to:
- Cloud Run (recommended)
- Vercel
- Railway
- Any Node.js hosting

Set environment variables in your hosting platform.
