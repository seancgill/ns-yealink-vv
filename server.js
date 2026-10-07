const express = require('express');
const config = require('./config/default');
const xml = require('./app/utils/xmlBuilder');
const app = express();
app.disable('x-powered-by');
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer');
  // Log status only; query strings carry the phone access key and media URLs carry signatures.
  res.on('finish', () => { if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ event: 'request', status: res.statusCode })); });
  next();
});
const route = require('./app/routes/voicemail');
// Short entry URL for Yealink programmable-key values limited to 99 characters.
app.use('/v', (req, res, next) => {
  const keys = Object.keys(req.query);
  if (req.path !== '/' || keys.some(key => !['u', 'd', 'k'].includes(key))
      || ['u', 'd', 'k'].some(key => typeof req.query[key] !== 'string')) {
    return res.status(400).type('application/xml').send(xml.error('Voicemail Error', 'Invalid compact entry URL.'));
  }
  req.url = '/?' + new URLSearchParams({ user_id: req.query.u, domain: req.query.d, auth: req.query.k });
  next();
}, route);
app.use('/yealink_vv', route);
app.use('/', route);
app.use((req, res) => res.status(404).type('application/xml').send(xml.error('Not Found', 'Unknown voicemail screen.')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Unexpected voicemail request failure');
  res.status(500).type('application/xml').send(xml.error('Voicemail Error', 'Unable to complete this request.'));
});
function startServer() {
  config.validate();
  return app.listen(config.port, config.host, () => console.log('Yealink voicemail listening on ' + config.host + ':' + config.port));
}
if (require.main === module) {
  const server = startServer();
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 15000).unref();
  });
}
module.exports = app;
module.exports.startServer = startServer;
