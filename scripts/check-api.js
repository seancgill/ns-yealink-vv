// Read-only compatibility check. Never prints tokens, identities, callers, or signed audio URLs.
const config = require('../config/default');
const service = require('../app/services/netsapiensService');
(async () => {
  config.validate();
  const version = await service.readVersion();
  const major = Number(String(version.apiversion).split('.')[0]);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), apiversion: version.apiversion, hostname: version.hostname }));
  if (major !== 45) throw new Error('This release is validated against the v45 contract only; verify other majors independently.');
  const [user, domain] = process.argv.slice(2);
  if (user || domain) {
    if (!user || !domain) throw new Error('Supply both extension and domain');
    for (const folder of ['new', 'save', 'trash']) {
      const messages = await service.fetchVoicemails(user, domain, folder);
      console.log(JSON.stringify({ folder, count: messages.length }));
      if (messages.length) {
        const vm = await service.fetchVoicemailDetail(user, domain, messages[0].filename, folder);
        if (!vm) throw new Error('First listed message was not found');
        service.playbackUrl(vm['file-access-url']);
        console.log(JSON.stringify({ folder, detail: 'ok', playbackUrl: 'valid; handset download not tested' }));
      }
    }
  }
})().catch(() => { console.error('API check failed. Verify configuration, permissions, API version, and connectivity. No voicemail was changed.'); process.exitCode = 1; });
