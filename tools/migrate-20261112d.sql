-- 2026-11-12：后台分人（users.name）；原 op 账号是何俊。新增人用 node tools/add-op.js 姓名 密码 出 SQL（密码不进仓库）
ALTER TABLE users ADD COLUMN name TEXT;
UPDATE users SET name = '何俊' WHERE role = 'op' AND name IS NULL;
DROP INDEX IF EXISTS users_role_store;
CREATE UNIQUE INDEX IF NOT EXISTS users_uniq ON users(role, COALESCE(store, ''), COALESCE(name, ''));
