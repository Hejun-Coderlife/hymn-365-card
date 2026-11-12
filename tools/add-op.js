// 加一个后台账号：node tools/add-op.js 姓名 密码 → 打印一条 INSERT（库里只存 PBKDF2 哈希；密码别写进任何文件，仓库是公开的）
const crypto = require('crypto');
const [name, pw] = process.argv.slice(2);
if (!name || !pw) { console.error('用法：node tools/add-op.js 姓名 密码'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(pw, salt, 30000, 32, 'sha256').toString('hex');
console.log(`INSERT INTO users (role, name, salt, hash, dev_limit) VALUES ('op', '${name.replace(/'/g, "''")}', '${salt}', '${hash}', 5)`);
