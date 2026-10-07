const axios = require('axios');
const config = require('../../config/default');
const { validIdentity } = require('../utils/phoneAuth');
const api = axios.create({
  baseURL: config.nsApiBaseUrl, timeout: config.apiTimeout, maxRedirects: 0,
  headers: { accept: 'application/json' },
});
function mailboxPath(user, domain, folder, file) {
  if (!validIdentity(user, domain)) throw new Error('Invalid mailbox identity');
  const apiFolder = folder === 'saved' ? 'save' : folder;
  if (!['new', 'save', 'trash'].includes(apiFolder)) throw new Error('Invalid folder');
  if (file !== undefined && (typeof file !== 'string' || !/^[A-Za-z0-9_.-]{1,255}$/.test(file) || file.includes('..'))) throw new Error('Invalid voicemail filename');
  return '/domains/' + encodeURIComponent(domain) + '/users/' + encodeURIComponent(user) + '/voicemails/' + apiFolder
    + (file === undefined ? '' : '/' + encodeURIComponent(file));
}
async function request(method, url, data, domain) {
  const headers = domain === undefined ? undefined : { authorization: 'Bearer ' + config.tokenForDomain(domain) };
  try { return (await api.request({ method, url, data, headers })).data; }
  catch (cause) {
    // Axios errors contain credentials. Never expose the original error or response body.
    const error = new Error('NetSapiens request failed');
    error.status = cause.response?.status || 502;
    throw error;
  }
}
function normalize(vm) {
  if (!vm || typeof vm !== 'object' || Array.isArray(vm)) throw new Error('Invalid voicemail response');
  return {
    filename: vm.filename,
    'voicemail-from-name': vm['voicemail-from-name'] || vm.FromName || 'Unknown',
    'voicemail-from-caller-id-number': vm['voicemail-from-caller-id-number'] || vm.FromUser || vm.NmsAni || 'Unknown',
    'recorded-datetime': vm['recorded-datetime'] || vm.RecordTime || vm['created-datetime'] || vm.filedate,
    'file-duration-seconds': vm['file-duration-seconds'] ?? vm.NmsRecDuration ?? vm.length ?? 0,
    'file-access-url': vm['file-access-url'] || vm['file-access-url '] || vm.remotepath,
  };
}
function playbackUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing playback URL');
  // Decode only a fully encoded URL, preserving escapes inside normal signed URLs.
  const raw = /^https?%3A/i.test(value) ? decodeURIComponent(value) : value;
  const parsed = new URL(raw.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid playback URL');
  if (['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    if (!config.mediaPublicOrigin) throw new Error('Configure MEDIA_PUBLIC_ORIGIN for loopback audio URLs');
    const publicUrl = new URL(config.mediaPublicOrigin);
    parsed.protocol = publicUrl.protocol; parsed.hostname = publicUrl.hostname; parsed.port = publicUrl.port;
  }
  return parsed.toString();
}
exports.fetchVoicemails = async (user, domain, folder = 'new') => {
  const data = await request('GET', mailboxPath(user, domain, folder), undefined, domain);
  if (!Array.isArray(data)) throw new Error('Invalid voicemail list response');
  return data.map(normalize);
};
exports.fetchVoicemailDetail = async (user, domain, file, folder) => {
  let data;
  try { data = await request('GET', mailboxPath(user, domain, folder, file), undefined, domain); }
  catch (error) { if (error.status === 404) return null; throw error; }
  const vm = Array.isArray(data) ? data[0] : data;
  return vm ? normalize(vm) : null;
};
function messagePath(user, domain, folder, file) {
  if (file === undefined) throw new Error('Invalid voicemail filename');
  return mailboxPath(user, domain, folder, file);
}
exports.saveVoicemail = (user, domain, file, folder) => request('PATCH', messagePath(user, domain, folder, file) + '/save', {}, domain);
exports.deleteVoicemail = (user, domain, folder, file) => request('DELETE', messagePath(user, domain, folder, file), undefined, domain);
exports.forwardVoicemail = (user, domain, file, destination, folder) => {
  if (typeof destination !== 'string' || !/^\d{1,16}$/.test(destination)) throw new Error('Invalid destination extension');
  return request('PATCH', messagePath(user, domain, folder, file) + '/forward', { 'voicemail-forward-new-destination': destination }, domain);
};
exports.playbackUrl = playbackUrl;
exports.readVersion = () => request('GET', '/version');
