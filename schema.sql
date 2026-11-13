-- 365金卡导入表 · 表结构（全部 IF NOT EXISTS，重复执行不动已有数据）
-- 本地：npm run db:local

-- 账号：op = 操作员（后台，你也用这个）；staff = 店员，2026-11-12 起每家店一个（store = 店名），各自最多 5 台设备。
-- 新建库：先跑本文件，再 node tools/seed.js 出 op 和店员模板账号，再 node tools/store-accounts.js 出 43 家店的账号
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL,                 -- op / staff
  store      TEXT,                          -- 店员账号是哪家店；op 为空
  sort       INTEGER,                       -- 后台名字的排序（登录下拉、账号页），小的在前
  name       TEXT,                          -- 后台账号是谁（2026-11-12 起后台分人：何俊 / 金晓锋 / 叶金虎 / 毛毛）
  salt       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  dev_limit  INTEGER NOT NULL DEFAULT 5,    -- 每个账号最多 5 台设备，第 6 台登录自动挤掉最久没用的
  fails      INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS users_uniq ON users(role, COALESCE(store, ''), COALESCE(name, ''));

CREATE TABLE IF NOT EXISTS sessions (
  th      TEXT PRIMARY KEY,   -- token 的 SHA-256
  uid     INTEGER NOT NULL,
  did     INTEGER NOT NULL,   -- 设备被挤掉，会话跟着作废
  expires INTEGER NOT NULL,
  store   TEXT                -- 店员登录时选的门店（2026-11-12 起门店在登录页选）
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
  sdate    TEXT NOT NULL,     -- 起算日 YYYY-MM-DD（新开卡=开卡日，续卡=原卡到期日，新卡从这天算）
  kind     TEXT NOT NULL,     -- new / renew / other（2026-11-12 加「其它」，手写备注）
  pkg      TEXT,              -- 套餐（新开卡 / 续卡必选 4 选 1，存「女神季度管理 1980套餐」这样的全名）
  qty      INTEGER,           -- 套餐数量（默认 1，店员可改；其它没有）
  note     TEXT,              -- 其它：手写备注
  giver_name  TEXT,           -- 送朋友：送的人（name / phone 是被送的人，卡办在她名下）
  giver_phone TEXT,
  birth    TEXT,              -- 会员生日 YYYY-MM-DD（2026-11-12 加，只有新开365卡填；送朋友时是被送的人的）
  staff_no TEXT NOT NULL,     -- 工号
  store    TEXT,              -- 门店（2026-11-11 加，战报按门店筛）
  created  INTEGER NOT NULL,
  did      INTEGER,
  status   TEXT NOT NULL DEFAULT 'pending',
  done_at  INTEGER,
  del_at   INTEGER,
  del_by   TEXT,
  lock_did INTEGER,           -- 载入就锁定：哪台设备载入了（别人不能再载入），2 小时没导出失效
  lock_at  INTEGER,
  edit_n   INTEGER,           -- 后台改过几次（每次必须 +1，触发器靠它放行）
  edit_at  INTEGER
);
CREATE INDEX IF NOT EXISTS subs_status ON subs(status, created);
CREATE INDEX IF NOT EXISTS subs_staff ON subs(staff_no, created);

-- 员工：工号 / 姓名 / 门店（2026-11-12 用户给的美得得员工表，只取这三列；身份证、电话不进来）。
-- 仓库是公开的，名单只在库里（tools/staff-sql.py 从 xls 出 SQL），不进 git
CREATE TABLE IF NOT EXISTS staff (
  no    TEXT PRIMARY KEY,
  name  TEXT,
  store TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_store ON staff(store);

-- 操作记录，只增不删
CREATE TABLE IF NOT EXISTS audit (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  at   INTEGER NOT NULL,
  role TEXT,
  act  TEXT NOT NULL,
  info TEXT,
  dev  TEXT,     -- 设备（型号 · 浏览器）
  ip   TEXT
);

-- 不可删除（2026-11-11 用户：任何提交或删除的记录都要留下，不可删除）
-- 操作记录不能删也不能改；提交记录不能删，内容（姓名/手机/日期/工号/门店/提交时间）不能改，只能改状态
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, '操作记录不能删除'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, '操作记录不能修改'); END;
CREATE TRIGGER IF NOT EXISTS subs_no_delete BEFORE DELETE ON subs BEGIN SELECT RAISE(ABORT, '提交记录不能删除'); END;
-- 内容只能经后台「修改」改：edit_n 必须正好 +1，旧内容同时写进 sub_edits
CREATE TRIGGER IF NOT EXISTS subs_no_edit BEFORE UPDATE OF name, phone, sdate, kind, pkg, qty, note, giver_name, giver_phone, birth, staff_no, store, created ON subs
  WHEN NEW.created IS NOT OLD.created OR COALESCE(NEW.edit_n, 0) <> COALESCE(OLD.edit_n, 0) + 1
  BEGIN SELECT RAISE(ABORT, '提交记录内容只能经后台「修改」改（会留记录）'); END;
-- 改之前的旧内容，只增不删（2026-11-12 用户：后台允许修改，但要留下记录）
CREATE TABLE IF NOT EXISTS sub_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, sid INTEGER NOT NULL, at INTEGER NOT NULL, before TEXT, after TEXT, dev TEXT);
CREATE INDEX IF NOT EXISTS sub_edits_sid ON sub_edits(sid);
CREATE TRIGGER IF NOT EXISTS sub_edits_no_delete BEFORE DELETE ON sub_edits BEGIN SELECT RAISE(ABORT, '修改记录不能删除'); END;
CREATE TRIGGER IF NOT EXISTS sub_edits_no_update BEFORE UPDATE ON sub_edits BEGIN SELECT RAISE(ABORT, '修改记录不能修改'); END;

