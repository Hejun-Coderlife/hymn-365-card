// 2026-11-12：店员账号从「一个共用」拆成「每家店一个」，各自最多 5 台设备。
// 打印要执行的 SQL（一行一条，逐条用 wrangler d1 execute --command 跑）。
// 新店账号的密码先复制原来共用店员账号的（库里只有哈希，这里不出现明文），之后在后台「账号与设备」里逐店重置。
// 用法：node tools/store-accounts.js migrate   → 改表结构 + 建 43 店账号 + 删掉原来的共用店员账号（只跑一次）
//       node tools/store-accounts.js add       → 只补建还没有账号的店（以后 stores.js 加了新店时用；从任意一个店员账号复制密码）
global.window = {};
require('../public/stores.js');
const stores = [].concat(...window.STORES.map(([, l]) => l));
const q = s => "'" + s.replace(/'/g, "''") + "'";
const out = [];
if (process.argv[2] === 'migrate') {
  out.push(
    'CREATE TABLE users_new (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, store TEXT, salt TEXT NOT NULL, hash TEXT NOT NULL, dev_limit INTEGER NOT NULL DEFAULT 5, fails INTEGER NOT NULL DEFAULT 0, lock_until INTEGER NOT NULL DEFAULT 0)',
    'INSERT INTO users_new (id, role, store, salt, hash, dev_limit, fails, lock_until) SELECT id, role, NULL, salt, hash, dev_limit, fails, lock_until FROM users',
    'DROP TABLE users',
    'ALTER TABLE users_new RENAME TO users',
    "CREATE UNIQUE INDEX IF NOT EXISTS users_role_store ON users(role, COALESCE(store, ''))",
    // 多行 VALUES（D1 不让 UNION ALL 连 43 个 SELECT：too many terms in compound SELECT）；密码从原共用店员账号复制
    'INSERT INTO users (role, store, salt, hash, dev_limit) VALUES ' + stores.map(x => "('staff', " + q(x) + ", (SELECT salt FROM users WHERE role = 'staff' AND store IS NULL), (SELECT hash FROM users WHERE role = 'staff' AND store IS NULL), 5)").join(', '),
    // 下面三条只有 43 店账号都建好了才会删到东西（防上一步失败时把共用账号删了）
    "DELETE FROM sessions WHERE uid IN (SELECT id FROM users WHERE role = 'staff' AND store IS NULL) AND (SELECT COUNT(*) FROM users WHERE role = 'staff' AND store IS NOT NULL) >= " + stores.length,
    "DELETE FROM devices WHERE uid IN (SELECT id FROM users WHERE role = 'staff' AND store IS NULL) AND (SELECT COUNT(*) FROM users WHERE role = 'staff' AND store IS NOT NULL) >= " + stores.length,
    "DELETE FROM users WHERE role = 'staff' AND store IS NULL AND (SELECT COUNT(*) FROM users WHERE role = 'staff' AND store IS NOT NULL) >= " + stores.length
  );
} else if (process.argv[2] === 'add') {
  const have = "(SELECT salt FROM users WHERE role = 'staff' LIMIT 1)", hh = "(SELECT hash FROM users WHERE role = 'staff' LIMIT 1)";
  stores.forEach(x => out.push("INSERT INTO users (role, store, salt, hash, dev_limit) SELECT 'staff', " + q(x) + ', ' + have + ', ' + hh + ", 5 WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'staff' AND store = " + q(x) + ')'));
} else { console.error('用法见文件头'); process.exit(1); }
console.log(out.join('\n'));
