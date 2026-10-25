const router = require('express').Router();
const service = require('../services/netsapiensService');
const xml = require('../utils/xmlBuilder');
const config = require('../../config/default');
const { verify, validIdentity } = require('../utils/phoneAuth');
const actions = new Set(['/', '/voicemail_detail', '/voicemail_transcript', '/execute_play', '/execute_play_selected', '/execute_stop', '/save_voicemail', '/delete_voicemail', '/forward_voicemail_input', '/forward_voicemail']);
router.use((req, res, next) => {
  if (!actions.has(req.path)) return next('router');
  res.type('application/xml');
  const allowed = new Set(['user_id', 'domain', 'auth', 'folder', 'file', 'voicemail_id', 'page', 'confirm', 'forward_to', 'selection']);
  if (Object.keys(req.query).some(key => !allowed.has(key))) return res.status(400).send(xml.error('Voicemail Error', 'Invalid request parameters.'));
  const { user_id: user, domain, auth } = req.query;
  if (!validIdentity(user, domain)) return res.status(400).send(xml.error('Voicemail Error', 'Missing or invalid user ID or domain.'));
  if (!verify(auth)) return res.status(403).send(xml.error('Access Denied', 'Use the voicemail URL provisioned for this phone.'));
  try { config.tokenForDomain(domain); }
  catch { return res.status(403).send(xml.error('Access Denied', 'This domain is not enabled for voicemail.')); }
  const folder = req.query.folder === 'saved' ? 'save' : req.query.folder;
  const file = req.path === '/execute_play_selected' ? req.query.selection : (req.query.file ?? req.query.voicemail_id);
  if (req.query.selection !== undefined && (typeof req.query.selection !== 'string' || !/^[A-Za-z0-9_.-]{1,255}$/.test(req.query.selection) || req.query.selection.includes('..'))) return res.status(400).send(xml.error('Voicemail Error', 'Select a voicemail to play.', xml.uri({ user_id: user, domain, auth }, '', { folder })));
  if (req.path === '/execute_play_selected' && !file) return res.status(400).send(xml.error('Voicemail Error', 'Select a voicemail to play.', xml.uri({ user_id: user, domain, auth }, '', { folder })));
  if (req.path !== '/execute_play_selected' && req.query.selection !== undefined && req.query.selection !== file) return res.status(400).send(xml.error('Voicemail Error', 'Invalid message selection.'));
  if ((folder !== undefined && !['new', 'save', 'trash'].includes(folder))
      || (file !== undefined && (typeof file !== 'string' || !/^[A-Za-z0-9_.-]{1,255}$/.test(file) || file.includes('..')))) return res.status(400).send(xml.error('Voicemail Error', 'Invalid folder or voicemail filename.'));
  if (req.path !== '/' && (!folder || !file)) return res.status(400).send(xml.error('Voicemail Error', 'Missing folder or voicemail filename.'));
  if (req.query.page !== undefined && (typeof req.query.page !== 'string' || !/^\d{1,6}$/.test(req.query.page))) return res.status(400).send(xml.error('Voicemail Error', 'Invalid page.'));
  req.vm = { user_id: user, domain, auth, folder, file, page: Number(req.query.page || 0) };
  next();
});
function screen(handler) {
  return async (req, res) => {
    try { res.send(await handler(req.vm, req)); }
    catch (error) {
      res.status(error.status === 404 ? 404 : 502).send(xml.error('Voicemail Error', 'Unable to complete the request. Please try again.', xml.uri(req.vm)));
    }
  };
}
router.get('/', screen(async ctx => {
  if (!ctx.folder) return xml.folders(ctx);
  return xml.list(ctx, await service.fetchVoicemails(ctx.user_id, ctx.domain, ctx.folder));
}));
router.get('/voicemail_detail', screen(async ctx => {
  const vm = await service.fetchVoicemailDetail(ctx.user_id, ctx.domain, ctx.file, ctx.folder);
  if (!vm) { const error = new Error('Missing voicemail'); error.status = 404; throw error; }
  return xml.detail(ctx, vm);
}));
router.get('/voicemail_transcript', screen(async ctx => {
  const vm = await service.fetchVoicemailDetail(ctx.user_id, ctx.domain, ctx.file, ctx.folder);
  if (!vm) { const error = new Error('Missing voicemail'); error.status = 404; throw error; }
  return xml.transcript(ctx, vm);
}));
for (const [path, command] of [['/execute_play', 'Wav.Play'], ['/execute_play_selected', 'Wav.Play'], ['/execute_stop', 'Wav.Stop']]) router.get(path, screen(async ctx => {
  const vm = await service.fetchVoicemailDetail(ctx.user_id, ctx.domain, ctx.file, ctx.folder);
  if (!vm) { const error = new Error('Missing voicemail'); error.status = 404; throw error; }
  return xml.execute(command, service.playbackUrl(vm['file-access-url']));
}));
router.get('/save_voicemail', screen(async ctx => {
  await service.saveVoicemail(ctx.user_id, ctx.domain, ctx.file, ctx.folder);
  return xml.folders(ctx);
}));
router.get('/delete_voicemail', screen(async (ctx, req) => {
  if (req.query.confirm !== '1') return xml.confirmDelete(ctx);
  await service.deleteVoicemail(ctx.user_id, ctx.domain, ctx.folder, ctx.file);
  return xml.folders(ctx);
}));
router.get('/forward_voicemail_input', screen(ctx => xml.forward(ctx)));
router.get('/forward_voicemail', (req, res, next) => {
  if (typeof req.query.forward_to !== 'string' || !/^\d{1,16}$/.test(req.query.forward_to)) return res.status(400).send(xml.error('Voicemail Error', 'Enter a valid extension.', xml.uri(req.vm, '/forward_voicemail_input', { folder: req.vm.folder, file: req.vm.file })));
  next();
}, screen(async (ctx, req) => {
  await service.forwardVoicemail(ctx.user_id, ctx.domain, ctx.file, req.query.forward_to, ctx.folder);
  return xml.folders(ctx);
}));
module.exports = router;
