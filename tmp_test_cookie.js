const { PrismaClient } = require('@prisma/client');
const https = require('https');
const crypto = require('crypto');
const p = new PrismaClient();
const VERSION_CODE = '5.8.0', PLATFORM_CODE = '7';
const WEB_ID = '7444838473275573797';
const UID_TT = crypto.randomUUID().replace(/-/g, '');  // 模块级固定

function generateCookie(refreshToken) {
  return [
    '_tea_web_id=' + WEB_ID,
    'is_staff_user=false',
    'store-region=cn-gd',
    'store-region-src=uid',
    'sid_guard=' + refreshToken + '%7C' + Math.floor(Date.now() / 1000) + '%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT',
    'uid_tt=' + UID_TT,
    'uid_tt_ss=' + UID_TT,
    'sid_tt=' + refreshToken,
    'sessionid=' + refreshToken,
    'sessionid_ss=' + refreshToken
  ].join('; ');
}

function md5(v) { return crypto.createHash('md5').update(v).digest('hex'); }

async function getCredit(sid) {
  const uri = '/commerce/v1/benefits/user_credit';
  const deviceTime = Math.floor(Date.now() / 1000);
  const sign = md5('9e2c|' + uri.slice(-7) + '|' + PLATFORM_CODE + '|' + VERSION_CODE + '|' + deviceTime + '||11ac');
  const cookie = generateCookie(sid);
  return new Promise((resolve, reject) => {
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
      res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 300) }));
    });
    req.on('error', reject);
    req.write('{}'); req.end();
  });
}

(async () => {
  // 从 DB 取第一个账号（sessionid 是加密的，需要 decrypt）
  // 直接从 jimeng-core 的加密逻辑复制 decrypt 不现实，改为用前端的明文测试
  // 用参考项目已知可用的方式：直接测一个我们导入的 sid
  const accts = await p.jimengAccount.findMany({ select: { id: true, sessionid: true, status: true } });
  console.log('accounts:', accts.length);
  // sessionid 是加密的，跳过解密，直接用原始值测试 API 格式
  for (const a of accts.slice(0, 1)) {
    console.log('Testing encrypted sessionid (raw, will fail decrypt but shows format):', a.sessionid.slice(0, 20) + '...');
  }
  process.exit(0);
})();
