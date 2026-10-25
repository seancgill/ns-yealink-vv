jest.mock('axios', () => ({ create: jest.fn(() => ({ request: jest.fn() })) }));
const axios = require('axios');
const service = require('../app/services/netsapiensService');
const config = require('../config/default');
const api = axios.create.mock.results[0].value;
beforeEach(() => { api.request.mockReset(); config.mediaPublicOrigin = ''; config.apiTokensByDomain = {}; });
test('API client has timeout and redirects disabled', () => {
  expect(axios.create).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.example.test/ns-api/v2', timeout: 10000, maxRedirects: 0, headers: { accept: 'application/json' } }));
});
test('saved alias maps to canonical save and metadata is normalized', async () => {
  api.request.mockResolvedValueOnce({ data: [{ filename: 'vm.wav', FromName: 'Example', FromUser: '1001', RecordTime: '2026-10-05T12:00:00Z', length: '5', remotepath: 'https://media.example.test/vm.wav' }] });
  const data = await service.fetchVoicemails('1000', 'example.test', 'saved');
  expect(api.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: '/domains/example.test/users/1000/voicemails/save' }));
  expect(data[0]['voicemail-from-name']).toBe('Example'); expect(data[0]['file-duration-seconds']).toBe('5');
});
test.each([{ data: [] }, { data: [{ filename: 'vm.wav', 'file-duration-seconds': 7 }] }])('array detail is normalized', async ({ data }) => {
  api.request.mockResolvedValueOnce({ data });
  const result = await service.fetchVoicemailDetail('1000', 'example.test', 'vm.wav', 'new');
  expect(result?.filename || null).toBe(data.length ? 'vm.wav' : null);
});
test('object detail remains supported', async () => {
  api.request.mockResolvedValueOnce({ data: { filename: 'vm.wav' } });
  expect((await service.fetchVoicemailDetail('1000', 'example.test', 'vm.wav', 'new')).filename).toBe('vm.wav');
});

test.each([
  [{ 'file-transcript-text': 'Live text', transcription: 'Fallback' }, 'Live text'],
  [{ transcription: 'Fallback' }, 'Fallback'],
  [{ 'file-transcript-text': '', transcription: 'Fallback' }, ''],
  [{ 'file-transcript-text': null, transcription: 'Fallback' }, 'Fallback'],
  [{ transcription: {} }, ''],
])('normalizes transcript fields safely: %j', async (fields, expected) => {
  api.request.mockResolvedValueOnce({ data: { filename: 'vm.wav', ...fields } });
  const vm = await service.fetchVoicemailDetail('1000', 'example.test', 'vm.wav', 'new');
  expect(vm['file-transcript-text']).toBe(expected);
});
test('API failures throw sanitized errors and only detail 404 becomes null', async () => {
  api.request.mockRejectedValueOnce({ message: 'Bearer secret', response: { status: 401, data: 'secret' } });
  await expect(service.fetchVoicemails('1000', 'example.test', 'new')).rejects.toMatchObject({ message: 'NetSapiens request failed', status: 401 });
  api.request.mockRejectedValueOnce({ response: { status: 404 } });
  expect(await service.fetchVoicemailDetail('1000', 'example.test', 'vm.wav', 'new')).toBeNull();
});
test('malformed list fails instead of masquerading as empty', async () => {
  api.request.mockResolvedValueOnce({ data: { error: 'no permission' } });
  await expect(service.fetchVoicemails('1000', 'example.test', 'new')).rejects.toThrow('Invalid voicemail list');
});
test('save/delete/forward use the v45 contract without retries', async () => {
  api.request.mockResolvedValue({ data: {} });
  await service.saveVoicemail('1000', 'example.test', 'vm.wav', 'trash');
  await service.deleteVoicemail('1000', 'example.test', 'new', 'vm.wav');
  await service.forwardVoicemail('1000', 'example.test', 'vm.wav', '2000', 'saved');
  expect(api.request.mock.calls.map(([{ headers, ...request }]) => request)).toEqual([
    { method: 'PATCH', url: '/domains/example.test/users/1000/voicemails/trash/vm.wav/save', data: {} },
    { method: 'DELETE', url: '/domains/example.test/users/1000/voicemails/new/vm.wav', data: undefined },
    { method: 'PATCH', url: '/domains/example.test/users/1000/voicemails/save/vm.wav/forward', data: { 'voicemail-forward-new-destination': '2000' } },
  ]);
});
test.each(['../vm.wav', 'vm/other.wav', undefined])('invalid mutation filename is rejected: %s', file => {
  expect(() => service.deleteVoicemail('1000', 'example.test', 'new', file)).toThrow('Invalid voicemail filename');
  expect(api.request).not.toHaveBeenCalled();
});
test('signed URL escapes are preserved and loopback rewrite is explicit', () => {
  const original = 'https://media.example.test/audio?auth=a%2Fb%26c&file=vm.wav';
  expect(service.playbackUrl(original)).toBe(original);
  expect(service.playbackUrl(encodeURIComponent(original))).toBe(original);
  expect(() => service.playbackUrl('http://127.0.0.1/audio?auth=a%2Fb')).toThrow('MEDIA_PUBLIC_ORIGIN');
  config.mediaPublicOrigin = 'https://core.example.test';
  expect(service.playbackUrl('http://127.0.0.1:8080/audio?auth=a%2Fb')).toBe('https://core.example.test/audio?auth=a%2Fb');
});
test.each(['file:///tmp/vm.wav', 'https://user:pass@example.test/vm.wav', 'not-a-url'])('unsafe audio URL rejected: %s', value => {
  expect(() => service.playbackUrl(value)).toThrow();
});

test('concurrent requests select separate keys by domain without shared-header mutation', async () => {
  config.apiTokensByDomain = { 'enterprise.com': 'enterprise-test-key', sedemotwo: 'sedemotwo-test-key' };
  api.request.mockResolvedValue({ data: [] });
  await Promise.all([service.fetchVoicemails('1000', 'enterprise.com', 'new'), service.fetchVoicemails('2000', 'sedemotwo', 'save')]);
  expect(api.request.mock.calls.map(([req]) => req.headers.authorization)).toEqual(['Bearer enterprise-test-key', 'Bearer sedemotwo-test-key']);
});
test('all mutation actions use the mailbox domain key', async () => {
  config.apiTokensByDomain = { 'enterprise.com': 'enterprise-test-key', sedemotwo: 'sedemotwo-test-key' };
  api.request.mockResolvedValue({ data: {} });
  await service.saveVoicemail('1000', 'enterprise.com', 'vm.wav', 'new');
  await service.deleteVoicemail('2000', 'sedemotwo', 'new', 'vm.wav');
  await service.forwardVoicemail('1000', 'enterprise.com', 'vm.wav', '1001', 'new');
  expect(api.request.mock.calls.map(([req]) => req.headers.authorization)).toEqual(['Bearer enterprise-test-key', 'Bearer sedemotwo-test-key', 'Bearer enterprise-test-key']);
});
test('mapped mode rejects unknown domains without falling back to the single token', async () => {
  config.apiTokensByDomain = { 'enterprise.com': 'enterprise-test-key' };
  await expect(service.fetchVoicemails('1000', 'unknown.test', 'new')).rejects.toMatchObject({ status: 403 });
  expect(api.request).not.toHaveBeenCalled();
});
test('single-token installs retain their per-request bearer header', async () => {
  api.request.mockResolvedValue({ data: [] });
  await service.fetchVoicemails('1000', 'example.test', 'new');
  expect(api.request.mock.calls[0][0].headers.authorization).toBe('Bearer test-api-token');
});
test('version check sends no mailbox key', async () => {
  api.request.mockResolvedValue({ data: { apiversion: '45.0.1' } });
  await service.readVersion();
  expect(api.request.mock.calls[0][0].headers).toBeUndefined();
});
