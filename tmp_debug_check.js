const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const https = require('https');
const p = new PrismaClient();

const SECRET = process.env.SESSION_SECRET || 'dev-session-secret';
function decrypt(enc) {
  if (!enc) return '';
  const [ivHex, data] = enc.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.createHash('sha256').update(SECRET).digest();
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let dec = decipher.update(data, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

(async () => {
  const acc = await p.jimengAccount.findFirst();
  const sid = decrypt(acc.sessionid);
  console.log('decrypted sessionid:', sid.slice(0, 30) + '...');
  console.log('decrypted sessionid len:', sid.length);

  const VERSION_CODE = '5.8.0', PLATFORM_CODE = '7';
  const WEB_ID = '7444838473275573797';
  const UID_TT = crypto.randomUUID().replace(/-/g, '');
  const cookie = [
    '_tea_web_id=' + WEB_ID,
    'is_staff_user=false',
    'store-region=cn-gd',
    'store-region-src=uid',
    'sid_guard=' + sid + '%7C' + Math.floor(Date.now() / 1000) + '%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT',
    'uid_tt=' + UID_TT,
    'uid_tt_ss=' + UID_TT,
    'sid_tt=' + sid,
    'sessionid=' + sid,
    'sessionid_ss=' + sid
  ].join('; ');
  const uri = '/commerce/v1/benefits/user_credit';
  const deviceTime = Math.floor(Date.now() / 1000);
  const sign = crypto.createHash('md5').update('9e2c|' + uri.slice(-7) + '|' + PLATFORM_CODE + '|' + VERSION_CODE + '|' + deviceTime + '||11ac').digest('hex');
  const url = 'https://jimeng.jianying.com' + uri + '?aid=513695&device_platform=web&region=CN&webId=' + WEB_ID;
  const req = https.request(url, { method: 'POST', headers: {
    'Content-Type': 'application/json',
    'Cookie': cookie,
    'Device-Time': String(deviceTime),
    'Sign': sign,
    'Sign-Ver': '1',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    'Origin': 'https://jimeng.jianying.com',
    'Referer': 'https://jimeng.jianying.com/ai-tool/image/generate'
  }}, res => {
    let b = ''; res.on('data', c => b += c);
    res.on('end', () => {
      console.log('STATUS:', res.statusCode);
      console.log('BODY:', b.slice(0, 500));
      process.exit(0);
    });
  });
  req.on('error', e => { console.error('ERR:', e.message); process.exit(1); });
  req.write('{}'); req.end();
})();
