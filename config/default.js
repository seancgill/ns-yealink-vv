const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
function url(name, api = false) {
  const value = process.env[name] || '';
  if (!value) return '';
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error(name + ' must be an HTTP(S) URL without credentials, query, or fragment');
  if (api ? parsed.pathname.replace(/\/$/, '') !== '/ns-api/v2' : parsed.pathname !== '/') throw new Error(api ? name + ' must end in /ns-api/v2' : name + ' must contain only an origin');
  return value.replace(/\/$/, '');
}
function domainTokens() {
  if (!process.env.NS_API_TOKENS_BY_DOMAIN) return {};
  let tokens;
  try { tokens = JSON.parse(process.env.NS_API_TOKENS_BY_DOMAIN); }
  catch { throw new Error('NS_API_TOKENS_BY_DOMAIN must be valid JSON'); }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)
      || Object.entries(tokens).some(([domain, token]) => !/^[A-Za-z0-9_.-]{1,64}$/.test(domain) || ['.', '..'].includes(domain)
        || typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token))) {
    throw new Error('NS_API_TOKENS_BY_DOMAIN must map domain names to nonempty tokens');
  }
  return tokens;
}
const config = {
  nsApiBaseUrl: url('NS_API_BASE_URL', true), publicBaseUrl: url('PUBLIC_BASE_URL'),
  mediaPublicOrigin: url('MEDIA_PUBLIC_ORIGIN'),
  apiToken: process.env.NS_API_TOKEN || '', apiTokensByDomain: domainTokens(), phoneAccessToken: process.env.PHONE_ACCESS_TOKEN || '',
  host: process.env.LISTEN_HOST || '127.0.0.1', port: Number(process.env.PORT || 5000),
  apiTimeout: Number(process.env.API_TIMEOUT_MS || 10000), pageSize: 20,
};
config.validate = () => {
  for (const name of ['nsApiBaseUrl', 'publicBaseUrl']) if (!config[name]) throw new Error('Missing configuration: ' + name + '; see .env.example');
  if (!config.apiToken && !Object.keys(config.apiTokensByDomain).length) throw new Error('Configure NS_API_TOKEN or NS_API_TOKENS_BY_DOMAIN');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(config.phoneAccessToken) || config.phoneAccessToken.startsWith('replace-with')) throw new Error('Generate PHONE_ACCESS_TOKEN with npm run generate-key');
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid PORT');
  if (!Number.isInteger(config.apiTimeout) || config.apiTimeout < 1 || config.apiTimeout > 120000) throw new Error('Invalid API_TIMEOUT_MS');
  if (process.env.DISPLAY_TIMEZONE) new Intl.DateTimeFormat('en-US', { timeZone: process.env.DISPLAY_TIMEZONE });
};
config.tokenForDomain = domain => {
  if (Object.keys(config.apiTokensByDomain).length) {
    if (Object.hasOwn(config.apiTokensByDomain, domain)) return config.apiTokensByDomain[domain];
    const error = new Error('Domain is not enabled for voicemail');
    error.status = 403;
    throw error;
  }
  if (config.apiToken) return config.apiToken;
  throw new Error('No API token configured');
};
module.exports = config;
