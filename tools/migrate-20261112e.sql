-- 2026-11-12：后台名字排序（用户：何俊排到叶金虎后面）
ALTER TABLE users ADD COLUMN sort INTEGER;
UPDATE users SET sort = CASE name WHEN '金晓锋' THEN 1 WHEN '叶金虎' THEN 2 WHEN '何俊' THEN 3 WHEN '毛益萍' THEN 4 END WHERE role = 'op';
