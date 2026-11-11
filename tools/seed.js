// 生成两个账号的 SQL：node tools/seed.js 操作员密码 店员密码  → 打印 INSERT 语句（密码只在这里出现，库里只存 PBKDF2）
const crypto = require('crypto');
const mk = (role, pw) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(pw, salt, 30000, 32, 'sha256').toString('hex');
  return `INSERT OR REPLACE INTO users (id, role, salt, hash, dev_limit) VALUES (${role === 'op' ? 1 : 2}, '${role}', '${salt}', '${hash}', 5);`;
};
console.log(mk('op', process.argv[2]) + ' ' + mk('staff', process.argv[3]));
