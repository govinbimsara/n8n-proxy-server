require('dotenv').config();
const Redis = require('ioredis');

const redis = new Redis(process.env.UPSTASH_REDIS_URL);
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_MINUTES) * 60;

async function testRedis() {
  console.log('Testing Redis connection...\n');

  try {
    await redis.ping();
    console.log('✓ Redis connection successful\n');

    const testUserId = 'test-user-' + Date.now();
    const testSessionId = 'session-' + Date.now();

    console.log('Testing session storage...');
    await redis.setex('session:' + testUserId, SESSION_TTL_SECONDS, testSessionId);
    console.log('✓ Session stored:', testUserId, '->', testSessionId);

    const retrieved = await redis.get('session:' + testUserId);
    console.log('✓ Session retrieved:', retrieved);

    const ttl = await redis.ttl('session:' + testUserId);
    console.log('✓ Session TTL:', ttl, 'seconds (', Math.round(ttl / 60), 'minutes)\n');

    await redis.del('session:' + testUserId);
    console.log('✓ Test session cleaned up\n');

    console.log('All tests passed!');
  } catch (error) {
    console.error('✗ Test failed:', error.message);
  } finally {
    redis.disconnect();
  }
}

testRedis();
