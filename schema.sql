-- 365金卡导入表 · 表结构（全部 IF NOT EXISTS，重复执行不动已有数据）
-- 本地：npm run db:local

-- 账号只有两个共用的（2026-11-11 用户选的）：op = 操作员（你也用这个），staff = 店员（提交时填工号区分是谁）
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT UNIQUE NOT NULL,          -- op / staff
  salt       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  dev_limit  INTEGER NOT NULL DEFAULT 5,    -- 每个账号最多 5 台设备，第 6 台登录自动挤掉最久没用的
  fails      INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  th      TEXT PRIMARY KEY,   -- token 的 SHA-256
  uid     INTEGER NOT NULL,
  did     INTEGER NOT NULL,   -- 设备被挤掉，会话跟着作废
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  uid     INTEGER NOT NULL,
  dh      TEXT NOT NULL,      -- 设备标记 cookie 的 SHA-256
  label   TEXT,
  created INTEGER,
  last_at INTEGER
);
CREATE INDEX IF NOT EXISTS dev_uid ON devices(uid, dh);

-- 店员在手机上提交的会员。只改状态不真删：pending 待处理 / done 已导出 / del 删了
CREATE TABLE IF NOT EXISTS subs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT,
  phone    TEXT NOT NULL,
  sdate    TEXT NOT NULL,     -- 起算日 YYYY-MM-DD（新开卡=开卡日，续卡=续卡从哪天算）
  kind     TEXT NOT NULL,     -- new / renew
  staff_no TEXT NOT NULL,     -- 工号
  created  INTEGER NOT NULL,
  did      INTEGER,
  status   TEXT NOT NULL DEFAULT 'pending',
  done_at  INTEGER,
  del_at   INTEGER,
  del_by   TEXT
);
CREATE INDEX IF NOT EXISTS subs_status ON subs(status, created);
CREATE INDEX IF NOT EXISTS subs_staff ON subs(staff_no, created);

-- 操作记录，只增不删
CREATE TABLE IF NOT EXISTS audit (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  at   INTEGER NOT NULL,
  role TEXT,
  act  TEXT NOT NULL,
  info TEXT
);
