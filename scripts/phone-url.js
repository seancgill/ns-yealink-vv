const config = require('../config/default');
const { compactToken } = require('../app/utils/phoneAuth');
if (!config.publicBaseUrl) throw new Error('Configure PUBLIC_BASE_URL first');
// Private app access URL: do not commit or share in public tickets.
console.log(config.publicBaseUrl + '/v?u=[[user_1]]&d=[[domain]]&k=' + compactToken());
