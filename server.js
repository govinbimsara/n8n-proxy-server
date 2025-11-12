require('dotenv').config();
const express = require('express');
const { GoogleAuth } = require('google-auth-library');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

const AGENT_ENGINE_ENDPOINT = process.env.AGENT_ENGINE_ENDPOINT;
const SERVICE_ACCOUNT_KEY = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString()
);

const auth = new GoogleAuth({
  credentials: SERVICE_ACCOUNT_KEY,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const redis = new Redis(process.env.UPSTASH_REDIS_URL);
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_MINUTES) * 60;

app.post('/api/chat', async (req, res) => {
  // Handle both direct body and n8n wrapped body format
  const body = req.body.body || req.body;
  const { userId, message } = body;
  console.log('📨 Received request:', { userId, message: message?.substring(0, 50) });

  try {
    // Get or create session
    let sessionId = await redis.get('session:' + userId);
    console.log('🔍 Redis lookup:', { userId, sessionId });
    
    if (!sessionId) {
      console.log('🆕 Creating new session for user:', userId);
      const authClient = await auth.getClient();
      const accessTokenResponse = await authClient.getAccessToken();
      console.log('✅ Got access token');
      
      const sessionEndpoint = `${AGENT_ENGINE_ENDPOINT}:query`;
      console.log('📡 Session creation endpoint:', sessionEndpoint);
      
      const createSessionRes = await fetch(sessionEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessTokenResponse.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          class_method: 'create_session',
          input: {
            user_id: userId,
          },
        }),
      });
      
      console.log('📥 Session creation response:', {
        status: createSessionRes.status,
        statusText: createSessionRes.statusText,
        contentType: createSessionRes.headers.get('content-type')
      });
      
      const responseText = await createSessionRes.text();
      console.log('📄 Session creation response body:', responseText.substring(0, 500));
      
      let sessionData;
      try {
        sessionData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('❌ Failed to parse session response as JSON:', parseError.message);
        return res.status(500).json({ 
          error: 'Session creation failed - invalid response format',
          details: responseText.substring(0, 200)
        });
      }
      
      sessionId = sessionData.output?.id;
      console.log('🆔 Extracted sessionId:', sessionId);
      
      if (!sessionId) {
        console.error('❌ No sessionId in response:', sessionData);
        return res.status(500).json({ error: 'Failed to create session' });
      }
      
      await redis.setex('session:' + userId, SESSION_TTL_SECONDS, sessionId);
      console.log('💾 Saved session to Redis with TTL:', SESSION_TTL_SECONDS);
    }

    // Query agent using streamQuery endpoint
    console.log('🚀 Starting stream query:', { userId, sessionId, message: message?.substring(0, 50) });
    
    const authClient = await auth.getClient();
    const accessTokenResponse = await authClient.getAccessToken();
    const token = accessTokenResponse.token;
    console.log('✅ Got access token for stream query');
    
    const streamEndpoint = `${AGENT_ENGINE_ENDPOINT}:streamQuery`;
    console.log('📡 Stream query endpoint:', streamEndpoint);
    
    const response = await fetch(streamEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        class_method: 'stream_query',
        input: {
          user_id: userId,
          session_id: sessionId,
          message: message,
        },
      }),
    });
    
    console.log('📥 Stream query response:', {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type')
    });

    // Read streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';
    let finalData = null;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Process complete JSON objects (separated by newlines)
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const chunk = JSON.parse(line);
          console.log('📦 Stream chunk:', { 
            finish_reason: chunk.finish_reason,
            has_text: !!chunk.content?.parts?.some(p => p.text)
          });
          
          // Accumulate text from non-thought parts
          if (chunk.content?.parts) {
            const textParts = chunk.content.parts
              .filter(p => p.text && !p.thought)
              .map(p => p.text);
            accumulatedText += textParts.join('');
          }
          
          // Check if stream is complete (STOP + has accumulated text)
          if (chunk.finish_reason === 'STOP' && accumulatedText.length > 0) {
            finalData = chunk;
            console.log('✅ Stream complete, accumulated text length:', accumulatedText.length);
            break;
          }
        } catch (parseError) {
          console.error('⚠️ Failed to parse chunk:', line.substring(0, 100));
        }
      }
      
      if (finalData) break;
    }
    
    const text = accumulatedText || 'No response';

    console.log('✅ Sending response:', { textLength: text.length, sessionId });
    res.json({ text, sessionId });
  } catch (error) {
    console.error('❌ Error in /api/chat:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001, () => console.log('Proxy running on port 3001'));
