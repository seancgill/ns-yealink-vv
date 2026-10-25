const { Builder } = require('xml2js');
const config = require('../../config/default');
const { formatDate } = require('../helpers/dateHelper');
const build = (root, data) => new Builder().buildObject({ [root]: data });
const softkey = (index, Label, URI) => ({ $: { index: String(index) }, Label, URI });
const folderLabel = folder => folder === 'save' ? 'Saved' : folder[0].toUpperCase() + folder.slice(1);
function uri(ctx, action = '', params = {}) {
  const query = new URLSearchParams({ user_id: ctx.user_id, domain: ctx.domain, auth: ctx.auth, ...params });
  return config.publicBaseUrl + '/yealink_vv' + action + '?' + query;
}
function menu(Title, MenuItem, back, extraKeys = []) {
  return build('YealinkIPPhoneTextMenu', {
    $: { style: 'none', Beep: 'no', Timeout: '0' }, Title, MenuItem,
    SoftKey: [softkey(1, 'Select', 'SoftKey:Select'), ...(back === null ? [] : [softkey(2, 'Back', back || 'SoftKey:Exit')]), ...extraKeys],
  });
}
exports.uri = uri;
exports.error = (Title, Text, back = 'SoftKey:Exit') => build('YealinkIPPhoneTextScreen', { $: { Beep: 'yes' }, Title, Text, SoftKey: [softkey(1, 'Back', back)] });
exports.folders = ctx => menu('Voicemail', ['new', 'save', 'trash'].map(folder => ({ Prompt: folderLabel(folder), URI: uri(ctx, '', { folder }) })));
exports.list = (ctx, messages) => {
  if (!messages.length) return build('YealinkIPPhoneTextScreen', { Title: folderLabel(ctx.folder), Text: 'No voicemails in this folder.', SoftKey: [softkey(1, 'Back', uri(ctx))] });
  const page = Math.min(ctx.page, Math.floor((messages.length - 1) / config.pageSize));
  const items = messages.slice(page * config.pageSize, (page + 1) * config.pageSize).map(vm => ({
    Prompt: (vm['voicemail-from-name'] || 'Unknown') + ' - ' + formatDate(vm['recorded-datetime']),
    URI: uri(ctx, '/voicemail_detail', { folder: ctx.folder, file: vm.filename }),
    Selection: vm.filename,
  }));
  if (page > 0) items.push({ Prompt: 'Previous page', URI: uri(ctx, '', { folder: ctx.folder, page: page - 1 }) });
  if ((page + 1) * config.pageSize < messages.length) items.push({ Prompt: 'Next page', URI: uri(ctx, '', { folder: ctx.folder, page: page + 1 }) });
  return menu(folderLabel(ctx.folder) + ' (' + messages.length + ')', items, null, [
    softkey(3, 'Play', uri(ctx, '/execute_play_selected', { folder: ctx.folder })),
  ]);
};
exports.detail = (ctx, vm) => {
  const params = { folder: ctx.folder, file: ctx.file };
  return menu((vm['voicemail-from-caller-id-number'] || 'Unknown') + ' | ' + formatDate(vm['recorded-datetime']) + ' | ' + (vm['file-duration-seconds'] || 0) + 's', [
    { Prompt: 'Play', URI: uri(ctx, '/execute_play', params) },
    { Prompt: 'Stop', URI: uri(ctx, '/execute_stop', params) },
    ...(transcriptText(vm) ? [{ Prompt: 'Read Transcript', URI: uri(ctx, '/voicemail_transcript', params) }] : []),
    { Prompt: ctx.folder === 'trash' ? 'Restore to Saved' : 'Save', URI: uri(ctx, '/save_voicemail', params) },
    { Prompt: ctx.folder === 'trash' ? 'Delete permanently' : 'Delete', URI: uri(ctx, '/delete_voicemail', params) },
    { Prompt: 'Forward', URI: uri(ctx, '/forward_voicemail_input', params) },
  ], uri(ctx, '', { folder: ctx.folder }));
};
function transcriptText(vm) {
  const value = vm['file-transcript-text'];
  // Strip XML 1.0 forbidden controls before rendering upstream text.
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').trim() : '';
}
exports.transcript = (ctx, vm) => {
  const text = transcriptText(vm);
  // Conservative pilot size, not a verified handset limit. Count Unicode code points
  // so pagination cannot split surrogate pairs, and prefer word boundaries.
  const remaining = Array.from(text);
  const pages = [];
  let offset = 0;
  while (offset < remaining.length) {
    let end = Math.min(offset + 500, remaining.length);
    if (end < remaining.length) {
      for (let split = end; split > offset + 250; split--) {
        if (/\s/.test(remaining[split - 1])) { end = split; break; }
      }
    }
    pages.push(remaining.slice(offset, end).join(''));
    offset = end;
  }
  const page = Math.min(ctx.page || 0, Math.max(pages.length - 1, 0));
  const params = { folder: ctx.folder, file: ctx.file };
  const keys = [softkey(1, 'Back', uri(ctx, '/voicemail_detail', params))];
  if (page > 0) keys.push(softkey(2, 'Previous', uri(ctx, '/voicemail_transcript', { ...params, page: page - 1 })));
  if (page + 1 < pages.length) keys.push(softkey(3, 'Next', uri(ctx, '/voicemail_transcript', { ...params, page: page + 1 })));

  return build('YealinkIPPhoneTextScreen', {
    $: { Beep: 'no', Timeout: '0' },
    Title: pages.length > 1 ? 'Transcript (' + (page + 1) + '/' + pages.length + ')' : 'Transcript',
    Text: pages[page] || 'Transcription not available', SoftKey: keys,
  });
};
exports.confirmDelete = ctx => menu(ctx.folder === 'trash' ? 'Permanently delete?' : 'Move to Trash?', [
  { Prompt: 'Confirm delete', URI: uri(ctx, '/delete_voicemail', { folder: ctx.folder, file: ctx.file, confirm: 1 }) },
  { Prompt: 'Cancel', URI: uri(ctx, '/voicemail_detail', { folder: ctx.folder, file: ctx.file }) },
], uri(ctx, '/voicemail_detail', { folder: ctx.folder, file: ctx.file }));
exports.forward = ctx => build('YealinkIPPhoneInputScreen', {
  $: { Timeout: '60', LockIn: 'no', Beep: 'no' }, Title: 'Enter Extension',
  URL: uri(ctx, '/forward_voicemail', { folder: ctx.folder, file: ctx.file }),
  InputField: { Prompt: 'Extension:', Parameter: 'forward_to', DefaultValue: '', InputFlags: 'N' },
  // Use built-in Submit/Exit keys: touchscreen models may not support customized InputScreen keys.
});
exports.execute = (command, audioUrl) => build('YealinkIPPhoneExecute', { $: { Beep: 'no' }, ExecuteItem: { $: { URI: command + ':' + audioUrl } } });
