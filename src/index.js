/* 365金卡导入表 —— Cloudflare Worker + D1，挂 card.hemei.asia（2026-11-11 起）
   页面是 public/ 下的静态文件，这里只管 /api/*。登录、设备认证照搬会员助手 hymn-vip。

   两个共用账号（用户选的）：
     op    = 操作员（用户本人也用它）：电脑上用完整工具，看店员提交、载入名单、导出 xls、改两个账号的密码
     staff = 店员：手机上填 工号 + 姓名 + 手机号 + 日期 + 新开卡/续卡，提交到云端
   每个账号最多 5 台设备；第 6 台登录时自动挤掉最久没用的那台（用户选的，不拦）。
   提交记录只改状态不真删（pending / done / del）。 */

const DAY = 86400000;
const SESSION_DAYS = 60;
const PBKDF2_ITER = 30000;          // 免费版每次请求只有 10ms CPU
const DEVICE_DAYS = 3650;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m);
function json(o, status, headers) {
  const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  Object.keys(headers || {}).forEach((k) => [].concat(headers[k]).forEach((v) => h.append(k, v)));
  return new Response(JSON.stringify(o), { status: status || 200, headers: h });
}
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
async function pbkdf2(pass, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITER }, key, 256));
}
function sameStr(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
function cookie(req, name) { const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : ''; }
async function body(req) { try { return await req.json(); } catch (e) { throw bad('请求格式不对'); } }
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 100);
async function audit(db, role, act, info) {
  await db.prepare('INSERT INTO audit (at, role, act, info) VALUES (?, ?, ?, ?)').bind(Date.now(), role || null, act, info ? String(info).slice(0, 300) : null).run();
}
function deviceLabel(ua) {
  ua = String(ua || '');
  const m = ua.match(/\((?:Linux; )?Android [\d.]+; ([^;)]+)/);
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : m ? m[1].replace(/ Build.*$/, '').trim() : /Android/.test(ua) ? '安卓手机' : /Macintosh/.test(ua) ? 'Mac 电脑' : /Windows/.test(ua) ? 'Windows 电脑' : '其他设备';
  const app = /MicroMessenger/.test(ua) ? '微信' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '浏览器';
  return (kind + ' · ' + app).slice(0, 60);
}
const ROLE_NAME = { op: '操作员', staff: '店员' };

/* ---- 会话 / 设备 ---- */
const sessionCookie = (t, age) => 'c365_s=' + t + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + age;
async function currentUser(req, db) {
  const t = cookie(req, 'c365_s');
  if (!t) return null;
  const u = await db.prepare('SELECT u.id, u.role, s.did FROM sessions s JOIN users u ON u.id = s.uid JOIN devices d ON d.id = s.did WHERE s.th = ? AND s.expires > ?')
    .bind(await sha256(t), Date.now()).first();
  if (u) await db.prepare('UPDATE devices SET last_at = ? WHERE id = ?').bind(Date.now(), u.did).run();
  return u;
}
// 认设备：已登记的直接用；新设备登记上，超过 5 台就把最久没用的挤掉（连同它的会话）
async function bindDevice(req, db, u, now) {
  let dk = cookie(req, 'c365_d'), setCookie = null;
  if (!/^[0-9a-f]{40}$/.test(dk)) { dk = randHex(20); setCookie = 'c365_d=' + dk + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + DEVICE_DAYS * 86400; }
  const dh = await sha256(dk), label = deviceLabel(req.headers.get('User-Agent'));
  const d = await db.prepare('SELECT id FROM devices WHERE uid = ? AND dh = ?').bind(u.id, dh).first();
  if (d) { await db.prepare('UPDATE devices SET last_at = ?, label = ? WHERE id = ?').bind(now, label, d.id).run(); return { did: d.id, setCookie }; }
  const r = await db.prepare('INSERT INTO devices (uid, dh, label, created, last_at) VALUES (?, ?, ?, ?, ?)').bind(u.id, dh, label, now, now).run();
  const all = (await db.prepare('SELECT id, label FROM devices WHERE uid = ? ORDER BY last_at DESC, id DESC').bind(u.id).all()).results;
  const out = all.slice(u.dev_limit || 5);
  for (const x of out) {
    await db.batch([db.prepare('DELETE FROM sessions WHERE did = ?').bind(x.id), db.prepare('DELETE FROM devices WHERE id = ?').bind(x.id)]);
    await audit(db, u.role, 'device_kick', '超过 ' + (u.dev_limit || 5) + ' 台，挤掉 ' + x.label);
  }
  await audit(db, u.role, 'device_new', label);
  return { did: r.meta.last_row_id, setCookie };
}

/* ---- 提交校验 ---- */
function checkSub(b) {
  const phone = str(b.phone, 20).replace(/\D/g, '');
  if (!/^1\d{10}$/.test(phone)) throw bad('手机号要 11 位');
  const sdate = str(b.sdate, 10);
  const m = sdate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dt = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!dt || dt.getUTCMonth() !== +m[2] - 1 || +m[1] < 2020 || +m[1] > 2100) throw bad('日期不对');
  const kind = b.kind === 'renew' ? 'renew' : 'new';
  const staff_no = str(b.staff_no, 20);
  if (!staff_no) throw bad('请填工号');
  const name = str(b.name, 30).replace(/[\r\n\t]/g, ' ');
  return { name, phone, sdate, kind, staff_no };
}
const SUB_COLS = 'id, name, phone, sdate, kind, staff_no, created, status, done_at, del_at, del_by';

async function handle(req, env) {
  const url = new URL(req.url), p = url.pathname.replace(/^\/api/, ''), db = env.DB, now = Date.now();
  if (req.method === 'POST' && req.headers.get('X-Hymn') !== '1') throw new HttpError(403, '请求来源不对');

  if (p === '/login' && req.method === 'POST') {
    const b = await body(req);
    const u = await db.prepare('SELECT * FROM users WHERE role = ?').bind(str(b.role, 10)).first();
    const generic = new HttpError(401, '密码不对');
    if (!u) throw generic;
    if (u.lock_until > now) throw new HttpError(429, '输错太多次，' + Math.ceil((u.lock_until - now) / 60000) + ' 分钟后再试');
    if (!sameStr(await pbkdf2(String(b.password || ''), u.salt), u.hash)) {
      const f = u.fails + 1;
      await db.prepare('UPDATE users SET fails = ?, lock_until = ? WHERE id = ?').bind(f >= 5 ? 0 : f, f >= 5 ? now + 10 * 60000 : 0, u.id).run();
      if (f >= 5) await audit(db, u.role, 'locked', '连续输错 5 次');
      throw generic;
    }
    await db.batch([db.prepare('UPDATE users SET fails = 0, lock_until = 0 WHERE id = ?').bind(u.id), db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now)]);
    const dv = await bindDevice(req, db, u, now);
    const token = randHex(32);
    await db.prepare('INSERT INTO sessions (th, uid, did, expires) VALUES (?, ?, ?, ?)').bind(await sha256(token), u.id, dv.did, now + SESSION_DAYS * DAY).run();
    await audit(db, u.role, 'login', deviceLabel(req.headers.get('User-Agent')));
    const cookies = [sessionCookie(token, SESSION_DAYS * 86400)];
    if (dv.setCookie) cookies.push(dv.setCookie);
    return json({ ok: true, role: u.role }, 200, { 'Set-Cookie': cookies });
  }
  if (p === '/logout' && req.method === 'POST') {
    const t = cookie(req, 'c365_s');
    if (t) await db.prepare('DELETE FROM sessions WHERE th = ?').bind(await sha256(t)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const u = await currentUser(req, db);
  if (!u) throw new HttpError(401, '请先登录');
  const isOp = u.role === 'op';
  const needOp = () => { if (!isOp) throw new HttpError(403, '没有权限'); };

  if (p === '/me') return json({ role: u.role });

  // 提交一个会员（店员手机上用；操作员也能用）
  if (p === '/sub' && req.method === 'POST') {
    const s = checkSub(await body(req));
    const dup = await db.prepare("SELECT id, staff_no, created FROM subs WHERE phone = ? AND status = 'pending'").bind(s.phone).first();
    if (dup) throw bad('这个手机号已经提交过、还没处理（工号 ' + dup.staff_no + '），不用重复提交');
    const r = await db.prepare('INSERT INTO subs (name, phone, sdate, kind, staff_no, created, did) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(s.name, s.phone, s.sdate, s.kind, s.staff_no, now, u.did).run();
    await audit(db, u.role, 'sub_add', s.staff_no + ' 提交 ' + (s.name || '') + ' ' + s.phone + ' ' + s.sdate + (s.kind === 'renew' ? ' 续卡' : ''));
    return json({ ok: true, id: r.meta.last_row_id });
  }
  // 列表：店员只能看自己工号最近 30 天的；操作员看待处理的全部 + 最近 30 天处理过的
  if (p === '/subs' && req.method === 'GET') {
    if (!isOp) {
      const no = str(url.searchParams.get('staff_no'), 20);
      if (!no) return json({ subs: [] });
      const r = await db.prepare('SELECT ' + SUB_COLS + " FROM subs WHERE staff_no = ? AND created > ? AND status <> 'del' ORDER BY id DESC LIMIT 200").bind(no, now - 30 * DAY).all();
      return json({ subs: r.results });
    }
    const pend = await db.prepare('SELECT ' + SUB_COLS + " FROM subs WHERE status = 'pending' ORDER BY id").all();
    const done = await db.prepare('SELECT ' + SUB_COLS + " FROM subs WHERE status <> 'pending' AND COALESCE(done_at, del_at) > ? ORDER BY COALESCE(done_at, del_at) DESC LIMIT 300").bind(now - 30 * DAY).all();
    return json({ pending: pend.results, recent: done.results });
  }
  // 删除（只能删待处理的）：店员只能删自己工号的
  if (p === '/sub/del' && req.method === 'POST') {
    const b = await body(req);
    const s = await db.prepare('SELECT * FROM subs WHERE id = ?').bind(Number(b.id) || 0).first();
    if (!s || s.status !== 'pending') throw bad('这条已经处理过，不能删了');
    if (!isOp && s.staff_no !== str(b.staff_no, 20)) throw new HttpError(403, '只能删自己工号提交的');
    await db.prepare("UPDATE subs SET status = 'del', del_at = ?, del_by = ? WHERE id = ?").bind(now, isOp ? '操作员' : '工号 ' + s.staff_no, s.id).run();
    await audit(db, u.role, 'sub_del', s.staff_no + ' ' + (s.name || '') + ' ' + s.phone);
    return json({ ok: true });
  }
  // 操作员导出后标「已导出」
  if (p === '/subs/done' && req.method === 'POST') {
    needOp();
    const ids = ((await body(req)).ids || []).map(Number).filter((x) => x > 0).slice(0, 500);
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      await db.prepare("UPDATE subs SET status = 'done', done_at = ? WHERE status = 'pending' AND id IN (" + part.map(() => '?').join(',') + ')').bind(now, ...part).run();
    }
    if (ids.length) await audit(db, u.role, 'sub_done', ids.length + ' 条标为已导出');
    return json({ ok: true });
  }
  // 撤回「已导出」（点错了）
  if (p === '/sub/undo' && req.method === 'POST') {
    needOp();
    const id = Number((await body(req)).id) || 0;
    await db.prepare("UPDATE subs SET status = 'pending', done_at = NULL WHERE id = ? AND status = 'done'").bind(id).run();
    await audit(db, u.role, 'sub_undo', '#' + id);
    return json({ ok: true });
  }
  // 设备列表 / 改密码（只有操作员）
  if (p === '/devices' && req.method === 'GET') {
    needOp();
    const r = await db.prepare('SELECT d.id, u.role, d.label, d.created, d.last_at FROM devices d JOIN users u ON u.id = d.uid ORDER BY u.role, d.last_at DESC').all();
    return json({ devices: r.results, me: u.did });
  }
  // 账号与设备页：两个账号 + 各自登录的设备
  if (p === '/accounts' && req.method === 'GET') {
    needOp();
    const us = (await db.prepare('SELECT id, role, dev_limit FROM users ORDER BY id').all()).results;
    const ds = (await db.prepare('SELECT id, uid, label, created, last_at FROM devices ORDER BY last_at DESC').all()).results;
    return json({ me: u.did, accounts: us.map((x) => ({ role: x.role, dev_limit: x.dev_limit, devices: ds.filter((d) => d.uid === x.id) })) });
  }
  // 手动移出一台设备（连同它的会话，马上下线）；不能移出自己这台
  if (p === '/devices/del' && req.method === 'POST') {
    needOp();
    const id = Number((await body(req)).id) || 0;
    if (id === u.did) throw bad('不能移出你正在用的这台');
    const d = await db.prepare('SELECT d.label, u.role FROM devices d JOIN users u ON u.id = d.uid WHERE d.id = ?').bind(id).first();
    if (!d) throw bad('这台设备已经不在了');
    await db.batch([db.prepare('DELETE FROM sessions WHERE did = ?').bind(id), db.prepare('DELETE FROM devices WHERE id = ?').bind(id)]);
    await audit(db, u.role, 'device_remove', ROLE_NAME[d.role] + ' ' + d.label);
    return json({ ok: true });
  }
  if (p === '/password' && req.method === 'POST') {
    needOp();
    const b = await body(req), role = b.role === 'staff' ? 'staff' : 'op', pass = String(b.password || '');
    if (pass.length < 6) throw bad('密码至少 6 位');
    const t = await db.prepare('SELECT id FROM users WHERE role = ?').bind(role).first();
    const salt = randHex(16);
    const keep = role === 'op' ? await sha256(cookie(req, 'c365_s')) : '';
    await db.batch([
      db.prepare('UPDATE users SET salt = ?, hash = ?, fails = 0, lock_until = 0 WHERE id = ?').bind(salt, await pbkdf2(pass, salt), t.id),
      db.prepare('DELETE FROM sessions WHERE uid = ? AND th <> ?').bind(t.id, keep)   // 改完其他设备都要重新登录
    ]);
    await audit(db, u.role, 'password', ROLE_NAME[role] + '账号改了密码');
    return json({ ok: true });
  }
  throw new HttpError(404, '没有这个接口');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { return await handle(req, env); }
    catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: '服务器出错了，请稍后再试' }, 500);
    }
  }
};
