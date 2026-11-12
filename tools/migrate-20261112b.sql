-- 2026-11-12：送朋友（送的人姓名 / 电话）
ALTER TABLE subs ADD COLUMN giver_name TEXT;
ALTER TABLE subs ADD COLUMN giver_phone TEXT;
DROP TRIGGER IF EXISTS subs_no_edit;
CREATE TRIGGER subs_no_edit BEFORE UPDATE OF name, phone, sdate, kind, pkg, note, giver_name, giver_phone, staff_no, store, created ON subs WHEN NEW.created IS NOT OLD.created OR COALESCE(NEW.edit_n, 0) <> COALESCE(OLD.edit_n, 0) + 1 BEGIN SELECT RAISE(ABORT, '提交记录内容只能经后台「修改」改（会留记录）'); END;
