const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixedWindowRateLimiter } = require('../src/utils/rateLimit');

test('fixed window rate limiter rejects only after the configured limit', () => {
  const limiter = createFixedWindowRateLimiter({ windowMs: 1000, max: 2 });

  assert.equal(limiter.check('client', 100).allowed, true);
  assert.equal(limiter.check('client', 200).allowed, true);
  assert.equal(limiter.check('client', 300).allowed, false);
  assert.equal(limiter.check('client', 1100).allowed, true);
});
