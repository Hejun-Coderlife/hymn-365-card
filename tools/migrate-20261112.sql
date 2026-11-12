-- 2026-11-12：套餐 4 选 1 + 其它备注；门店改在登录页选；工号下拉（员工表）
ALTER TABLE subs ADD COLUMN pkg TEXT;
ALTER TABLE subs ADD COLUMN note TEXT;
ALTER TABLE sessions ADD COLUMN store TEXT;
CREATE TABLE IF NOT EXISTS staff (no TEXT PRIMARY KEY, name TEXT, store TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS staff_store ON staff(store);
DROP TRIGGER IF EXISTS subs_no_edit;
ALTER TABLE subs ADD COLUMN edit_n INTEGER;
ALTER TABLE subs ADD COLUMN edit_at INTEGER;
CREATE TRIGGER subs_no_edit BEFORE UPDATE OF name, phone, sdate, kind, pkg, note, staff_no, store, created ON subs
  WHEN NEW.created IS NOT OLD.created OR COALESCE(NEW.edit_n, 0) <> COALESCE(OLD.edit_n, 0) + 1
  BEGIN SELECT RAISE(ABORT, '提交记录内容只能经后台「修改」改（会留记录）'); END;
-- 改之前的旧内容，只增不删（2026-11-12 用户：后台允许修改，但要留下记录）
CREATE TABLE IF NOT EXISTS sub_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, sid INTEGER NOT NULL, at INTEGER NOT NULL, before TEXT, after TEXT, dev TEXT);
CREATE INDEX IF NOT EXISTS sub_edits_sid ON sub_edits(sid);
CREATE TRIGGER IF NOT EXISTS sub_edits_no_delete BEFORE DELETE ON sub_edits BEGIN SELECT RAISE(ABORT, '修改记录不能删除'); END;
CREATE TRIGGER IF NOT EXISTS sub_edits_no_update BEFORE UPDATE ON sub_edits BEGIN SELECT RAISE(ABORT, '修改记录不能修改'); END;
