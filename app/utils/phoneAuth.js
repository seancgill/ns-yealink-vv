const { timingSafeEqual, createHmac } = require('node:crypto');
const config = require('../../config/default');
const validIdentity = (user, domain) => typeof user === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(user)
  && typeof domain === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(domain)
  && ![user, domain].some(value => value === '.' || value === '..');
function verify(token) {
  if (typeof token !== 'string' || config.phoneAccessToken.length < 32) return false;
  const actual = Buffer.from(token);
  return [config.phoneAccessToken, compactToken()].some(value => {
    const expected = Buffer.from(value);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
function compactToken() {
  if (config.phoneAccessToken.length < 32) throw new Error('Phone access key is not configured');
  return createHmac('sha256', config.phoneAccessToken).update('yealink-vv-compact-url-v1').digest('base64url').slice(0, 32);
}
module.exports = { verify, validIdentity, compactToken };
