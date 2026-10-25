const request = require('supertest');
const { parseStringPromise } = require('xml2js');
jest.mock('../app/services/netsapiensService', () => ({
  fetchVoicemails: jest.fn(), fetchVoicemailDetail: jest.fn(), forwardVoicemail: jest.fn(),
  saveVoicemail: jest.fn(), deleteVoicemail: jest.fn(), playbackUrl: jest.fn(value => value),
}));
const service = require('../app/services/netsapiensService');
const config = require('../config/default');
const app = require('../server');
const identity = 'user_id=1000&domain=example.test&auth=' + config.phoneAccessToken;
const message = { filename: 'vm-123.wav', 'voicemail-from-name': 'Caller & Friend', 'voicemail-from-caller-id-number': '1001', 'recorded-datetime': '2026-10-05T12:00:00Z', 'file-duration-seconds': 9, 'file-access-url': 'https://media.example.test/audio?auth=a%2Fb&file=vm.wav' };
const route = (action = '', extra = '') => '/yealink_vv' + action + '?' + identity + extra;
beforeEach(() => jest.clearAllMocks());
test('health check does not access NetSapiens', async () => {
  expect((await request(app).get('/healthz')).body).toEqual({ status: 'ok' });
  expect(service.fetchVoicemails).not.toHaveBeenCalled();
});
test('rejects missing identity and invalid key without an API call', async () => {
  expect((await request(app).get('/yealink_vv')).status).toBe(400);
  expect((await request(app).get('/yealink_vv?user_id=1000&domain=example.test')).status).toBe(403);
  expect((await request(app).get('/yealink_vv?user_id=1000&domain=example.test&auth=wrong')).status).toBe(403);
  expect(service.fetchVoicemails).not.toHaveBeenCalled();
});
test.each(['/voicemail_detail', '/voicemail_transcript', '/execute_play', '/execute_stop', '/save_voicemail', '/delete_voicemail', '/forward_voicemail_input', '/forward_voicemail'])('auth protects %s and its legacy alias', async action => {
  for (const prefix of ['/yealink_vv', '']) expect((await request(app).get(prefix + action + '?user_id=1000&domain=example.test&folder=new&file=vm.wav')).status).toBe(403);
  expect(service.fetchVoicemailDetail).not.toHaveBeenCalled();
  expect(service.deleteVoicemail).not.toHaveBeenCalled();
});
test('folders retain dynamic identity and key in valid XML', async () => {
  const response = await request(app).get(route());
  const doc = await parseStringPromise(response.text);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const items = doc.YealinkIPPhoneTextMenu.MenuItem;
  expect(items.map(item => item.Prompt[0])).toEqual(['New', 'Saved', 'Trash']);
  for (const item of items) {
    const url = new URL(item.URI[0]);
    expect(url.origin).toBe(config.publicBaseUrl);
    expect(url.searchParams.get('user_id')).toBe('1000');
    expect(url.searchParams.get('domain')).toBe('example.test');
    expect(url.searchParams.get('auth')).toBe(config.phoneAccessToken);
  }
  expect(items[1].URI[0]).toContain('folder=save');
});
test('identities remain dynamic for another domain and extension', async () => {
  const response = await request(app).get('/yealink_vv?user_id=2020&domain=another.example&auth=' + config.phoneAccessToken);
  expect(response.status).toBe(200); expect(response.text).toContain('user_id=2020'); expect(response.text).toContain('domain=another.example');
});
test('list failure is an error screen rather than an empty folder', async () => {
  service.fetchVoicemails.mockRejectedValueOnce(new Error('secret upstream body'));
  const response = await request(app).get(route('', '&folder=new'));
  expect(response.status).toBe(502); expect(response.text).not.toContain('secret upstream body'); expect(response.text).not.toContain('No voicemails');
});
test('empty folder and saved alias are supported', async () => {
  service.fetchVoicemails.mockResolvedValueOnce([]);
  const response = await request(app).get(route('', '&folder=saved'));
  expect(response.status).toBe(200); expect(response.text).toContain('No voicemails');
  expect(service.fetchVoicemails).toHaveBeenCalledWith('1000', 'example.test', 'save');
});
test('list is escaped and paginated with encoded message links', async () => {
  service.fetchVoicemails.mockResolvedValueOnce(Array.from({ length: 23 }, (_, index) => ({ ...message, filename: 'vm-' + index + '.wav' })));
  const response = await request(app).get(route('', '&folder=new'));
  const doc = await parseStringPromise(response.text);
  expect(doc.YealinkIPPhoneTextMenu.MenuItem).toHaveLength(21);
  expect(response.text).toContain('Caller &amp; Friend'); expect(response.text).toContain('Next page');
});
test('detail contains play, stop, restore and forward actions', async () => {
  service.fetchVoicemailDetail.mockResolvedValueOnce(message);
  const response = await request(app).get(route('/voicemail_detail', '&folder=trash&file=vm-123.wav'));
  const doc = await parseStringPromise(response.text);
  expect(doc.YealinkIPPhoneTextMenu.MenuItem.map(item => item.Prompt[0])).toEqual(['Play', 'Stop', 'Restore to Saved', 'Delete permanently', 'Forward']);
  expect(response.text).toContain('1001'); expect(response.text).toContain('9s');
  expect(response.text).not.toContain(message['file-access-url']);
});
test.each([['/execute_play', 'Wav.Play'], ['/execute_stop', 'Wav.Stop']])('%s uses direct audio URL with XML escaping', async (action, command) => {
  service.fetchVoicemailDetail.mockResolvedValueOnce(message);
  const response = await request(app).get(route(action, '&folder=new&file=vm-123.wav'));
  const doc = await parseStringPromise(response.text);
  expect(doc.YealinkIPPhoneExecute.ExecuteItem[0].$.URI).toBe(command + ':' + message['file-access-url']);
});
test('missing message is 404', async () => {
  service.fetchVoicemailDetail.mockResolvedValueOnce(null);
  expect((await request(app).get(route('/voicemail_detail', '&folder=new&file=vm.wav'))).status).toBe(404);
});

test('transcript menu follows message text availability', async () => {
  for (const text of ['', '   ', 'Hello & <friend>']) {
    service.fetchVoicemailDetail.mockResolvedValueOnce({ ...message, 'file-transcript-text': text });
    const response = await request(app).get(route('/voicemail_detail', '&folder=new&file=vm-123.wav'));
    const doc = await parseStringPromise(response.text);
    const item = doc.YealinkIPPhoneTextMenu.MenuItem.find(item => item.Prompt[0] === 'Read Transcript');
    expect(Boolean(item)).toBe(Boolean(text.trim()));
    if (item) expect(new URL(item.URI[0]).pathname).toBe('/yealink_vv/voicemail_transcript');
  }
});

test('transcript is escaped and Back retains authenticated mailbox identity', async () => {
  service.fetchVoicemailDetail.mockResolvedValueOnce({ ...message, 'file-transcript-text': 'Hello & <friend>\u0001 😀' });
  const response = await request(app).get(route('/voicemail_transcript', '&folder=save&file=vm-123.wav'));
  expect(response.status).toBe(200);
  const screen = (await parseStringPromise(response.text)).YealinkIPPhoneTextScreen;
  expect(screen.Text[0]).toBe('Hello & <friend> 😀');
  const back = new URL(screen.SoftKey.find(key => key.Label[0] === 'Back').URI[0]);
  expect(back.pathname).toBe('/yealink_vv/voicemail_detail');
  expect(Object.fromEntries(back.searchParams)).toEqual({ user_id: '1000', domain: 'example.test', auth: config.phoneAccessToken, folder: 'save', file: 'vm-123.wav' });
  expect(service.saveVoicemail).not.toHaveBeenCalled();
});

test('long transcripts paginate without losing text or splitting emoji', async () => {
  const text = ('Words & 😀 '.repeat(130) + 'end').trim();
  service.fetchVoicemailDetail.mockResolvedValue({ ...message, 'file-transcript-text': text });
  let url = route('/voicemail_transcript', '&folder=new&file=vm-123.wav');
  let combined = '';
  let count = 0;
  while (url) {
    const response = await request(app).get(url);
    const screen = (await parseStringPromise(response.text)).YealinkIPPhoneTextScreen;
    const chunk = screen.Text[0];
    expect(Array.from(chunk).length).toBeLessThanOrEqual(500);
    expect(chunk).not.toMatch(/\uFFFD/);
    combined += chunk;
    if (count++) expect(screen.SoftKey.some(key => key.Label[0] === 'Previous')).toBe(true);
    const next = screen.SoftKey.find(key => key.Label[0] === 'Next');
    url = next ? new URL(next.URI[0]).pathname + new URL(next.URI[0]).search : null;
  }
  expect(count).toBeGreaterThan(1);
  expect(combined).toBe(text);
  const last = await request(app).get(route('/voicemail_transcript', '&folder=new&file=vm-123.wav&page=999999'));
  expect(last.text).not.toContain('<Label>Next</Label>');
});

test('transcript handles unavailable, missing, invalid and failed requests', async () => {
  service.fetchVoicemailDetail.mockResolvedValueOnce(message);
  const unavailable = await request(app).get(route('/voicemail_transcript', '&folder=new&file=vm.wav'));
  expect(unavailable.status).toBe(200);
  expect(unavailable.text).toContain('Transcription not available');
  service.fetchVoicemailDetail.mockResolvedValueOnce(null);
  expect((await request(app).get(route('/voicemail_transcript', '&folder=new&file=vm.wav'))).status).toBe(404);
  expect((await request(app).get(route('/voicemail_transcript'))).status).toBe(400);
  expect((await request(app).get(route('/voicemail_transcript', '&folder=new&file=vm.wav&page=-1'))).status).toBe(400);
  service.fetchVoicemailDetail.mockRejectedValueOnce(new Error('secret'));
  const failed = await request(app).get(route('/voicemail_transcript', '&folder=new&file=vm.wav'));
  expect(failed.status).toBe(502);
  expect(failed.text).not.toContain('secret');
});
test.each(['&folder=other', '&folder=new&file=..%2Fsecret', '&folder=new&file[]=vm.wav', '&folder=new&page=-1'])('rejects malformed navigation %s', async extra => {
  expect((await request(app).get(route('', extra))).status).toBe(400);
  expect(service.fetchVoicemails).not.toHaveBeenCalled();
});
test('save validates required identifiers and returns folders', async () => {
  expect((await request(app).get(route('/save_voicemail'))).status).toBe(400);
  service.saveVoicemail.mockResolvedValueOnce({});
  expect((await request(app).get(route('/save_voicemail', '&folder=trash&file=vm.wav'))).status).toBe(200);
  expect(service.saveVoicemail).toHaveBeenCalledWith('1000', 'example.test', 'vm.wav', 'trash');
});
test('delete requires confirmation before API mutation', async () => {
  const first = await request(app).get(route('/delete_voicemail', '&folder=trash&file=vm.wav'));
  expect(first.text).toContain('Permanently delete?'); expect(service.deleteVoicemail).not.toHaveBeenCalled();
  service.deleteVoicemail.mockResolvedValueOnce({});
  expect((await request(app).get(route('/delete_voicemail', '&folder=trash&file=vm.wav&confirm=1'))).status).toBe(200);
  expect(service.deleteVoicemail).toHaveBeenCalledWith('1000', 'example.test', 'trash', 'vm.wav');
});
test('forward prompts then validates extension and returns folders', async () => {
  const prompt = await request(app).get(route('/forward_voicemail_input', '&folder=new&file=vm.wav'));
  const doc = await parseStringPromise(prompt.text);
  expect(doc.YealinkIPPhoneInputScreen.InputField[0].Parameter[0]).toBe('forward_to');
  expect(doc.YealinkIPPhoneInputScreen.URL[0]).toContain('auth=' + config.phoneAccessToken);
  expect((await request(app).get(route('/forward_voicemail', '&folder=new&file=vm.wav&forward_to=..'))).status).toBe(400);
  service.forwardVoicemail.mockResolvedValueOnce({});
  expect((await request(app).get(route('/forward_voicemail', '&folder=new&file=vm.wav&forward_to=2000'))).status).toBe(200);
  expect(service.forwardVoicemail).toHaveBeenCalledWith('1000', 'example.test', 'vm.wav', '2000', 'new');
});
test.each(['/save_voicemail', '/delete_voicemail', '/forward_voicemail'])('mutation failures on %s return sanitized XML', async action => {
  service.saveVoicemail.mockRejectedValue(new Error('secret'));
  service.deleteVoicemail.mockRejectedValue(new Error('secret'));
  service.forwardVoicemail.mockRejectedValue(new Error('secret'));
  const response = await request(app).get(route(action, '&folder=new&file=vm.wav&confirm=1&forward_to=2000'));
  expect(response.status).toBe(502); expect(response.headers['content-type']).toMatch(/xml/); expect(response.text).not.toContain('secret');
});

test('mapped credentials reject an unconfigured domain before displaying folders', async () => {
  config.apiTokensByDomain = { 'enterprise.com': 'enterprise-test-key' };
  try {
    const response = await request(app).get(route());
    expect(response.status).toBe(403);
    expect(service.fetchVoicemails).not.toHaveBeenCalled();
  } finally { config.apiTokensByDomain = {}; }
});

test('compact entry URL authenticates and returns dynamic folder links without redirect', async () => {
  const { compactToken } = require('../app/utils/phoneAuth');
  const res = await request(app).get('/v?u=1000&d=example.test&k=' + compactToken());
  expect(res.status).toBe(200);
  expect(res.headers.location).toBeUndefined();
  const doc = await parseStringPromise(res.text);
  for (const item of doc.YealinkIPPhoneTextMenu.MenuItem) {
    const link = new URL(item.URI[0]);
    expect(link.searchParams.get('user_id')).toBe('1000');
    expect(link.searchParams.get('domain')).toBe('example.test');
    expect(link.searchParams.get('auth')).toBe(compactToken());
  }
});
test.each(['/v?u=1000&d=example.test&k=wrong', '/v?u=1000&d=example.test&k[]=wrong', '/v?u=1000&d=example.test&k=wrong&extra=1'])('rejects bad compact URL %s', async url => {
  expect((await request(app).get(url)).status).toBeGreaterThanOrEqual(400);
});
test('compact entry fits this T57W value limit after provisioning expansion', () => {
  const { compactToken } = require('../app/utils/phoneAuth');
  const url = 'https://core1-iad.sedemotwo.ucaas.tech/v?u=1500&d=sedemotwo&k=' + compactToken();
  expect(url.length).toBeLessThanOrEqual(99);
});

test('list offers separate Play while Select still opens detail', async () => {
  service.fetchVoicemails.mockResolvedValueOnce([message]);
  const response = await request(app).get(route('', '&folder=new'));
  const menu = (await parseStringPromise(response.text)).YealinkIPPhoneTextMenu;
  expect(new URL(menu.MenuItem[0].URI[0]).pathname).toBe('/yealink_vv/voicemail_detail');
  expect(menu.MenuItem[0].Selection[0]).toBe(message.filename);
  expect(menu.SoftKey.map(key => key.Label[0])).toEqual(['Select', 'Play']);
  const play = new URL(menu.SoftKey.find(key => key.Label[0] === 'Play').URI[0]);
  expect(play.pathname).toBe('/yealink_vv/execute_play_selected');
  expect(play.searchParams.get('auth')).toBe(config.phoneAccessToken);
  service.fetchVoicemailDetail.mockResolvedValueOnce(message);
  const detail = await request(app).get(new URL(menu.MenuItem[0].URI[0]).pathname + new URL(menu.MenuItem[0].URI[0]).search + '&selection=' + message.filename);
  expect(detail.status).toBe(200);
});

test('selected Play fetches the highlighted message and returns Wav.Play', async () => {
  service.fetchVoicemailDetail.mockResolvedValueOnce(message);
  const response = await request(app).get(route('/execute_play_selected', '&folder=new&selection=vm-123.wav'));
  expect(response.status).toBe(200);
  expect(service.fetchVoicemailDetail).toHaveBeenCalledWith('1000', 'example.test', 'vm-123.wav', 'new');
  const doc = await parseStringPromise(response.text);
  expect(doc.YealinkIPPhoneExecute.ExecuteItem[0].$.URI).toBe('Wav.Play:' + message['file-access-url']);
});

test('selected Play rejects missing selection, invalid filenames and missing auth', async () => {
  for (const extra of ['&folder=new', '&folder=new&selection=..%2Fsecret', '&folder=new&selection[]=vm.wav']) {
    expect((await request(app).get(route('/execute_play_selected', extra))).status).toBe(400);
  }
  expect((await request(app).get('/yealink_vv/execute_play_selected?user_id=1000&domain=example.test&folder=new&selection=vm-123.wav')).status).toBe(403);
  expect(service.fetchVoicemailDetail).not.toHaveBeenCalled();
});