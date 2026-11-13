/* 365金卡导入表 —— Cloudflare Worker + D1，挂 card.hemei.asia（2026-11-11 起）
   页面是 public/ 下的静态文件，这里只管 /api/*。登录、设备认证照搬会员助手 hymn-vip。

   两个共用账号（用户选的）：
     op    = 操作员（用户本人也用它）：电脑上用完整工具，看店员提交、载入名单、导出 xls、改两个账号的密码
     staff = 店员：手机上填 工号 + 姓名 + 手机号 + 日期 + 新开卡/续卡，提交到云端
   每个账号最多 5 台设备；第 6 台登录时自动挤掉最久没用的那台（用户选的，不拦）。
   提交记录只改状态不真删（pending / done / del）。 */

const DAY = 86400000;
const SESSION_DAYS = 60;
const LOCK_MS = 2 * 3600000;   // 载入锁 2 小时没导出自动失效
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
// 操作记录：只增不删（库里有触发器，DELETE / UPDATE 都会被拒，2026-11-11 用户要求「不可删除」）。
// 每条带设备（从 User-Agent 看出来的型号 · 浏览器）和 IP
async function audit(req, db, role, act, info) {
  await db.prepare('INSERT INTO audit (at, role, act, info, dev, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), role || null, act, info ? String(info).slice(0, 4000) : null, deviceLabel(req.headers.get('User-Agent')), req.headers.get('CF-Connecting-IP') || null).run();
}
function deviceLabel(ua) {
  ua = String(ua || '');
  const m = ua.match(/\((?:Linux; )?Android [\d.]+; ([^;)]+)/);
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : m ? m[1].replace(/ Build.*$/, '').trim() : /Android/.test(ua) ? '安卓手机' : /Macintosh/.test(ua) ? 'Mac 电脑' : /Windows/.test(ua) ? 'Windows 电脑' : '其他设备';
  const app = /MicroMessenger/.test(ua) ? '微信' : /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : '浏览器';
  return (kind + ' · ' + app).slice(0, 60);
}
const ROLE_NAME = { op: '操作员', staff: '店员' };
// 区域经理 → 负责的门店（2026-11-12 用户：3 个区域经理的工号能出现在她们负责的每家店里）。跟 public/stores.js 的 STORES 保持一致
const MGR_STORES = {
  官卜妮: ['崇寿珀莱雅', '范市赫眉', '西坞赫眉', '塘下赫眉', '古林珀莱雅', '周巷珀莱雅', '邱隘赫眉思美', '天元赫眉', '龙山赫眉', '三横赫眉',
    '海曙龙湖天街', '邱隘赫眉倾城', '鄞州万达赫眉', '横溪赫眉', '联丰路赫眉', '恒一赫眉', '姜山1437', '横街赫眉', '嘉悦赫眉', '溪口赫眉'],
  杜海霞: ['慈城赫眉', '美时百货', '柴桥自然堂', '红联赫眉', '高塘赫眉', '洪塘赫眉', '庄市珀莱雅', '华悦美妆'],
  张维: ['泗门赫眉', '新河珀莱雅', '潘郎赫眉', '横峰赫眉', '钱清赫眉', '蓬街赫眉', '泗门珀莱雅', '丈亭赫眉', '低塘珀莱雅', '马渚赫眉',
    '金清赫眉', '梅林赫眉', '石浦赫眉', '义桥赫眉']
};
const mgrOf = (store) => Object.keys(MGR_STORES).find((m) => MGR_STORES[m].indexOf(store) >= 0) || '';
// 一家店能选的工号 = 这家店的员工 + 负责这家店的区域经理（经理按姓名在 staff 表里找工号，排最后，标「区域经理」）
async function storeStaff(db, store) {
  const own = (await db.prepare('SELECT no, name FROM staff WHERE store = ? ORDER BY no').bind(store).all()).results;
  const m = mgrOf(store);
  if (!m) return own;
  const mg = (await db.prepare('SELECT no, name FROM staff WHERE name = ? ORDER BY no').bind(m).all()).results;
  return own.filter((x) => !mg.some((g) => g.no === x.no)).concat(mg.map((g) => ({ no: g.no, name: g.name + '（区域经理）' })));
}
// 所有门店的员工（只要还在门店名单里的店，去掉的店比如江北万达不出现），按区域经理 → 门店 → 工号排
async function allStaff(db) {
  // 「总部」放最后（2026-11-13 用户：其它人员里加徐萍 777），不属于任何门店，只在「其它」里出现
  const order = [].concat(...Object.values(MGR_STORES), ['总部']);
  const r = (await db.prepare('SELECT no, name, store FROM staff ORDER BY no').all()).results.filter((x) => order.indexOf(x.store) >= 0);
  return r.sort((a, b) => order.indexOf(a.store) - order.indexOf(b.store) || (a.no < b.no ? -1 : 1));
}
// 2026-11-12 起每家店一个店员账号（users.store），各自最多 5 台设备。操作记录的 role 写成 staff:店名，看得出是哪家店
// 后台也分人（2026-11-12 用户：何俊、金晓锋、叶金虎、毛毛各一个，users.name），操作记录写 op:姓名
const who = (u) => u.role === 'staff' && u.store ? 'staff:' + u.store : u.role === 'op' && u.name ? 'op:' + u.name : u.role;
const acctName = (u) => u.role === 'staff' ? (u.store || '店员') : u.name ? '后台 ' + u.name : ROLE_NAME[u.role] || u.role;
// 套餐（2026-11-12 用户：新开卡 / 续卡后面必须 4 选 1）。名字只要海报上的头两行；存全名，跟 public/stores.js 的 PKGS 一致
const PKGS = ['女神季度管理 1980套餐', '女神全套季度管理 3980套餐', '女神全套半年度管理 6980套餐', '女神全套年度管理 19800套餐'];
const KIND_NAME = { new: '新开365卡', renew: '365续卡', other: '其它', refund: '退货' };   // refund 2026-11-12 加：只给后台处理，不导表   // 2026-11-12 用户改的叫法
const subDesc = (s) => s.kind === 'refund' ? '退货 ' + (s.pkg || '') + (s.qty > 1 ? ' ×' + s.qty : '') + ' · ' + s.sdate + (s.note ? '（' + s.note + '）' : '') : s.kind === 'other' ? '其它（' + (s.note || '') + '）' : KIND_NAME[s.kind] + ' ' + (s.pkg || '') + (s.qty > 1 ? ' ×' + s.qty : '') + (s.kind === 'renew' ? ' · 原卡到期 ' : ' · ') + s.sdate +
  (s.giver_phone ? ' · 送朋友：' + (s.giver_name || '') + ' ' + s.giver_phone + ' 送的' : '') + (s.birth ? ' · 生日 ' + s.birth : '');

/* ---- 会话 / 设备 ---- */
const sessionCookie = (t, age) => 'c365_s=' + t + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + age;
async function currentUser(req, db) {
  const t = cookie(req, 'c365_s');
  if (!t) return null;
  const u = await db.prepare('SELECT u.id, u.role, u.store, u.name, s.did FROM sessions s JOIN users u ON u.id = s.uid JOIN devices d ON d.id = s.did WHERE s.th = ? AND s.expires > ?')
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
    await audit(req, db, who(u), 'device_kick', '超过 ' + (u.dev_limit || 5) + ' 台，挤掉 ' + x.label);
  }
  await audit(req, db, who(u), 'device_new', label);
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
  const kind = str(b.kind, 10);
  if (!KIND_NAME[kind]) throw bad('请选新开卡 / 续卡 / 其它');
  let pkg = null, note = null;
  if (kind === 'other') { note = str(b.note, 200).replace(/[\r\n\t]+/g, ' '); if (!note) throw bad('选了其它，请写备注'); }
  else {
    pkg = str(b.pkg, 40); if (PKGS.indexOf(pkg) < 0) throw bad('请选套餐');   // 退货也要选退的是哪个套餐（2026-11-12 用户）
    if (kind === 'refund') { note = str(b.note, 200).replace(/[\r\n\t]+/g, ' ') || null; if (!str(b.name, 30)) throw bad('退货请填顾客姓名'); }
  }
  // 套餐数量（2026-11-12 用户：默认 1，可以改）
  const flat = kind === 'other';   // 其它没有套餐 / 数量；退货有套餐和数量，但没有送朋友
  const qty = flat ? null : Number(b.qty == null || b.qty === '' ? 1 : b.qty);
  if (qty !== null && !(Number.isInteger(qty) && qty >= 1 && qty <= 99)) throw bad('套餐数量要 1~99');
  // 送朋友（2026-11-12 用户）：送的人、被送的人都要填名字和电话；卡办在被送的人（phone）名下
  let giver_name = null, giver_phone = null;
  if (b.gift && !flat && kind !== 'refund') {
    giver_name = str(b.giver_name, 30).replace(/[\r\n\t]/g, ' ');
    giver_phone = str(b.giver_phone, 20).replace(/\D/g, '');
    if (!giver_name) throw bad('请填送的人姓名');
    if (!/^1\d{10}$/.test(giver_phone)) throw bad('送的人手机号要 11 位');
    if (!str(b.name, 30)) throw bad('请填被送的人姓名');
    if (giver_phone === phone) throw bad('送的人和被送的人手机号一样');
  }
  const staff_no = str(b.staff_no, 20);
  if (!staff_no) throw bad('请选工号');
  const name = str(b.name, 30).replace(/[\r\n\t]/g, ' ');
  const store = str(b.store, 30);
  if (!store) throw bad('请选门店');
  // 会员生日（2026-11-12 用户：新开365卡加会员生日）。只有新开卡存；送朋友时是被送的人（卡在她名下）的生日
  let birth = null;
  if (kind === 'new' && str(b.birth, 10)) {
    birth = str(b.birth, 10);
    const bm = birth.match(/^(\d{4})-(\d{2})-(\d{2})$/), bd = bm && new Date(Date.UTC(+bm[1], +bm[2] - 1, +bm[3]));
    if (!bd || bd.getUTCMonth() !== +bm[2] - 1 || +bm[1] < 1900 || bd.getTime() > Date.now()) throw bad(bd && bd.getTime() > Date.now() ? '生日不能晚于今天，请重选年份' : '生日不对');
  }
  return { name, phone, sdate, kind, pkg, qty, note, giver_name, giver_phone, birth, staff_no, store };
}
const SUB_COLS = 'id, name, phone, sdate, kind, pkg, qty, note, giver_name, giver_phone, birth, staff_no, store, created, status, done_at, del_at, del_by, edit_n, edit_at';

async function handle(req, env) {
  const url = new URL(req.url), p = url.pathname.replace(/^\/api/, ''), db = env.DB, now = Date.now();
  if (req.method === 'POST' && req.headers.get('X-Hymn') !== '1') throw new HttpError(403, '请求来源不对');

  if (p === '/login' && req.method === 'POST') {
    const b = await body(req);
    // 店员：每家店一个账号，按登录页选的门店找账号（2026-11-12 用户：43 家店分开账号，每家最多 5 台设备）
    const role = str(b.role, 10), store = role === 'staff' ? str(b.store, 30) : null, name = role === 'op' ? str(b.name, 20) : null;
    if (role === 'staff' && !store) throw bad('请先选门店');
    if (role === 'op' && !name) throw bad('请填姓名');
    const u = role === 'staff' ? await db.prepare("SELECT * FROM users WHERE role = 'staff' AND store = ?").bind(store).first()
      : await db.prepare("SELECT * FROM users WHERE role = 'op' AND name = ?").bind(name).first();
    const generic = new HttpError(401, '密码不对');
    if (!u) throw role === 'staff' ? bad('这家店还没有账号，请联系总部') : new HttpError(401, '没有这个后台账号');
    if (u.lock_until > now) await audit(req, db, who(u), 'login_locked', '锁定中还在尝试');
    if (u.lock_until > now) throw new HttpError(429, '输错太多次，' + Math.ceil((u.lock_until - now) / 60000) + ' 分钟后再试');
    if (!sameStr(await pbkdf2(String(b.password || ''), u.salt), u.hash)) {
      const f = u.fails + 1;
      await db.prepare('UPDATE users SET fails = ?, lock_until = ? WHERE id = ?').bind(f >= 5 ? 0 : f, f >= 5 ? now + 10 * 60000 : 0, u.id).run();
      await audit(req, db, who(u), 'login_fail', '密码不对（第 ' + f + ' 次）');
      if (f >= 5) await audit(req, db, who(u), 'locked', '连续输错 5 次，锁 10 分钟');
      throw generic;
    }
    await db.batch([db.prepare('UPDATE users SET fails = 0, lock_until = 0 WHERE id = ?').bind(u.id), db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now)]);
    const dv = await bindDevice(req, db, u, now);
    const token = randHex(32);
    await db.prepare('INSERT INTO sessions (th, uid, did, expires, store) VALUES (?, ?, ?, ?, ?)').bind(await sha256(token), u.id, dv.did, now + SESSION_DAYS * DAY, store).run();
    await audit(req, db, who(u), 'login', store);
    const cookies = [sessionCookie(token, SESSION_DAYS * 86400)];
    if (dv.setCookie) cookies.push(dv.setCookie);
    return json({ ok: true, role: u.role }, 200, { 'Set-Cookie': cookies });
  }
  // 后台登录页直接选名字（2026-11-12 用户）：只给姓名，不用登录
  if (p === '/opnames' && req.method === 'GET') {
    const r = await db.prepare("SELECT name FROM users WHERE role = 'op' AND name IS NOT NULL ORDER BY COALESCE(sort, 99), id").all();
    return json({ names: r.results.map((x) => x.name) });
  }
  if (p === '/logout' && req.method === 'POST') {
    const t = cookie(req, 'c365_s');
    if (t) {
      const w = await db.prepare('SELECT u.role, u.store, u.name FROM sessions s JOIN users u ON u.id = s.uid WHERE s.th = ?').bind(await sha256(t)).first();
      await db.prepare('DELETE FROM sessions WHERE th = ?').bind(await sha256(t)).run();
      if (w) await audit(req, db, who(w), 'logout', null);
    }
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  const u = await currentUser(req, db);
  if (!u) throw new HttpError(401, '请先登录');
  const isOp = u.role === 'op';
  const needOp = () => { if (!isOp) throw new HttpError(403, '没有权限'); };

  if (p === '/me') return json({ role: u.role, store: u.store || null, name: u.name || null });
  // 自己改自己的密码（2026-11-12 用户：支持自己修改）：要输旧密码；改完自己这台不掉线，别的设备要重登
  if (p === '/password/self' && req.method === 'POST') {
    const b = await body(req), pass = String(b.password || '');
    const me = await db.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
    if (!sameStr(await pbkdf2(String(b.old || ''), me.salt), me.hash)) throw bad('原密码不对');
    if (pass.length < 6) throw bad('新密码至少 6 位');
    const salt = randHex(16), keep = await sha256(cookie(req, 'c365_s'));
    await db.batch([
      db.prepare('UPDATE users SET salt = ?, hash = ?, fails = 0, lock_until = 0 WHERE id = ?').bind(salt, await pbkdf2(pass, salt), u.id),
      db.prepare('DELETE FROM sessions WHERE uid = ? AND th <> ?').bind(u.id, keep),
      db.prepare('DELETE FROM devices WHERE uid = ? AND id <> ?').bind(u.id, u.did)   // 设备也移出，n/5 才会变回 1（2026-11-12 用户：改了密码怎么还是 3/5）
    ]);
    await audit(req, db, who(u), 'password', acctName(u) + ' 自己改了密码');
    return json({ ok: true });
  }
  // 工号下拉：店员看登录时选的那家店的员工（+ 这家店的区域经理）；操作员可以 ?store= 看任意店
  if (p === '/staff' && req.method === 'GET') {
    // ?all=1：所有门店的人（2026-11-13 用户：工号下拉加「其它」，能选所有人、能搜，比如别的店来帮忙的人）
    if (url.searchParams.get('all')) return json({ staff: await allStaff(db) });
    const st = isOp ? str(url.searchParams.get('store'), 30) : u.store;
    if (!st) return json({ staff: [] });
    return json({ staff: await storeStaff(db, st) });
  }

  // 提交一个会员（店员手机上用；操作员也能用）
  if (p === '/sub' && req.method === 'POST') {
    const b0 = await body(req);
    // 店员：门店用登录时选的；操作员（2026-11-12 起能用店员版）：门店在页面上选，跟着请求来。工号都要是这家店的
    if (!isOp) { if (!u.store) throw new HttpError(401, '请重新登录并选门店'); b0.store = u.store; }
    const sno = str(b0.staff_no, 20);
    // 这家店的人，或者从「其它」里选的任何一家店的人（2026-11-13 用户）
    if (!(await storeStaff(db, str(b0.store, 30))).some((x) => x.no === sno) && !(await allStaff(db)).some((x) => x.no === sno)) throw bad('工号不对，请重新选');
    const s = checkSub(b0);
    if (s.kind === 'new' && !s.birth) throw bad('请选会员生日');   // 新提交必填；后台改老记录不强求
    // 同一手机号有没处理的就别重复提交；退货和办卡分开算（刚办的卡当天退也要能提交）
    const dup = await db.prepare("SELECT id, staff_no, created FROM subs WHERE phone = ? AND status = 'pending' AND (kind = 'refund') = ?").bind(s.phone, s.kind === 'refund' ? 1 : 0).first();
    if (dup) throw bad('这个手机号已经提交过、还没处理（工号 ' + dup.staff_no + '），不用重复提交');
    const r = await db.prepare('INSERT INTO subs (name, phone, sdate, kind, pkg, qty, note, giver_name, giver_phone, birth, staff_no, store, created, did) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(s.name, s.phone, s.sdate, s.kind, s.pkg, s.qty, s.note, s.giver_name, s.giver_phone, s.birth, s.staff_no, s.store, now, u.did).run();
    await audit(req, db, who(u), 'sub_add', '#' + r.meta.last_row_id + ' ' + s.store + ' 工号 ' + s.staff_no + '：' + (s.name || '未填姓名') + ' ' + s.phone + ' · ' + subDesc(s));
    return json({ ok: true, id: r.meta.last_row_id });
  }
  // 列表：店员只能看自己工号最近 30 天的；操作员看待处理的全部 + 最近 30 天处理过的
  if (p === '/subs' && req.method === 'GET') {
    if (!isOp || url.searchParams.has('staff_no')) {   // 店员版（操作员在店员版里也走这里，门店从参数来）
      const no = str(url.searchParams.get('staff_no'), 20), st = isOp ? str(url.searchParams.get('store'), 30) : u.store;
      if (!no) return json({ subs: [] });
      const r = await db.prepare('SELECT ' + SUB_COLS + " FROM subs WHERE staff_no = ? AND store = ? AND created > ? AND status <> 'del' ORDER BY id DESC LIMIT 200").bind(no, st || '', now - 30 * DAY).all();
      return json({ subs: r.results });
    }
    const pend = await db.prepare("SELECT s.id, s.name, s.phone, s.sdate, s.kind, s.pkg, s.qty, s.note, s.giver_name, s.giver_phone, s.birth, s.edit_n, s.edit_at, s.staff_no, s.store, s.created, s.status, s.lock_did, s.lock_at, d.label lock_dev FROM subs s LEFT JOIN devices d ON d.id = s.lock_did WHERE s.status = 'pending' ORDER BY s.id").all();
    pend.results.forEach((x) => { if (!x.lock_did || x.lock_at < now - LOCK_MS) { x.lock_did = null; x.lock_dev = null; } });
    const done = await db.prepare('SELECT ' + SUB_COLS + " FROM subs WHERE status <> 'pending' AND COALESCE(done_at, del_at) > ? ORDER BY COALESCE(done_at, del_at) DESC LIMIT 300").bind(now - 30 * DAY).all();
    // 工号带上名字；不是这家店的人（工号选了「其它」）标出是哪家店的，区域经理标「区域经理」（2026-11-13 用户）
    const sf = {}; (await db.prepare('SELECT no, name, store FROM staff').all()).results.forEach((x) => { sf[x.no] = x; });
    const tag = (x) => { const f = sf[x.staff_no]; if (!f) return; x.staff_name = f.name;
      if (f.store !== x.store) x.staff_from = mgrOf(x.store) === f.name ? '区域经理' : f.store + '的'; };
    pend.results.forEach(tag); done.results.forEach(tag);
    return json({ pending: pend.results, recent: done.results, me: u.did });
  }
  // 删除（只能删待处理的）：店员只能删自己工号的
  if (p === '/sub/del' && req.method === 'POST') {
    const b = await body(req);
    const s = await db.prepare('SELECT * FROM subs WHERE id = ?').bind(Number(b.id) || 0).first();
    if (!s || s.status !== 'pending') throw bad('这条已经处理过，不能删了');
    if (!isOp && (s.staff_no !== str(b.staff_no, 20) || s.store !== u.store)) throw new HttpError(403, '只能删自己工号提交的');
    await db.prepare("UPDATE subs SET status = 'del', del_at = ?, del_by = ? WHERE id = ?").bind(now, isOp ? '操作员' : '工号 ' + s.staff_no, s.id).run();
    await audit(req, db, who(u), 'sub_del', '#' + s.id + ' 删除（' + (isOp ? '操作员删的' : '工号 ' + s.staff_no + ' 自己删的') + '）：' + (s.name || '未填姓名') + ' ' + s.phone + ' · ' + subDesc(s) + ' · 原提交工号 ' + s.staff_no);
    return json({ ok: true });
  }
  // 操作员导出后标「已导出」
  if (p === '/subs/done' && req.method === 'POST') {
    needOp();
    const bd = await body(req), ids = (bd.ids || []).map(Number).filter((x) => x > 0).slice(0, 500);
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      await db.prepare("UPDATE subs SET status = 'done', done_at = ? WHERE status = 'pending' AND id IN (" + part.map(() => '?').join(',') + ')').bind(now, ...part).run();
    }
    if (ids.length) {
      const rows = [];
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50);
        rows.push(...(await db.prepare('SELECT id, name, phone FROM subs WHERE id IN (' + part.map(() => '?').join(',') + ')').bind(...part).all()).results);
      }
      await audit(req, db, who(u), 'sub_done', ids.length + ' 条标为' + (bd.other ? '已处理（其它 / 退货）' : '已导出') + '：' + rows.map((x) => '#' + x.id + ' ' + (x.name || '') + ' ' + x.phone).join('、'));
    }
    return json({ ok: true });
  }
  // 载入就锁定（2026-11-11 用户要的）：一台设备载入后，别的操作员不能再载入，防止同一批人被导出两遍。
  // 锁 2 小时没导出自动失效；force = 接手别人锁着的（记操作记录）
  if (p === '/subs/claim' && req.method === 'POST') {
    needOp();
    const b = await body(req), ids = (b.ids || []).map(Number).filter((x) => x > 0).slice(0, 500), force = !!b.force;
    const ok = [], busy = [];
    for (const id of ids) {
      const r = await db.prepare("UPDATE subs SET lock_did = ?, lock_at = ? WHERE id = ? AND status = 'pending' AND (lock_did IS NULL OR lock_did = ? OR lock_at < ? OR ?)")
        .bind(u.did, now, id, u.did, now - LOCK_MS, force ? 1 : 0).run();
      (r.meta.changes ? ok : busy).push(id);
    }
    if (force && ok.length) await audit(req, db, who(u), 'sub_take', '接手别的设备正在处理的 ' + ok.map((x) => '#' + x).join('、'));
    return json({ ok, busy });
  }
  if (p === '/subs/release' && req.method === 'POST') {
    needOp();
    const ids = ((await body(req)).ids || []).map(Number).filter((x) => x > 0).slice(0, 500);
    for (const id of ids) await db.prepare('UPDATE subs SET lock_did = NULL, lock_at = NULL WHERE id = ? AND lock_did = ?').bind(id, u.did).run();
    return json({ ok: true });
  }
  // 操作员改店员提交的内容（2026-11-12 用户：后台要允许修改，但修改后要留下记录）。
  // 库里触发器只放行 edit_n 正好 +1 的改动；改之前的旧内容先写进 sub_edits（只增不删），操作记录里也记一条「改了什么」
  if (p === '/sub/edit' && req.method === 'POST') {
    needOp();
    const b = await body(req);
    const old = await db.prepare('SELECT * FROM subs WHERE id = ?').bind(Number(b.id) || 0).first();
    if (!old) throw bad('这条提交不在了');
    if (old.status === 'del') throw bad('删掉的不能改');
    const n = checkSub(b);
    const F = { name: '姓名', phone: '手机号', sdate: '日期', kind: '办卡', pkg: '套餐', qty: '数量', note: '备注', giver_name: '送的人', giver_phone: '送的人手机', birth: '生日', staff_no: '工号', store: '门店' };
    const show = (k, v) => k === 'kind' ? KIND_NAME[v] || v : (v == null || v === '' ? '空' : v);
    const diff = Object.keys(F).filter((k) => String(old[k] == null ? '' : old[k]) !== String(n[k] == null ? '' : n[k])).map((k) => F[k] + ' ' + show(k, old[k]) + ' → ' + show(k, n[k]));
    if (!diff.length) return json({ ok: true, same: true });
    if (n.phone !== old.phone && await db.prepare("SELECT 1 FROM subs WHERE phone = ? AND status = 'pending' AND id <> ?").bind(n.phone, old.id).first()) throw bad('这个手机号已经有一条待处理的');
    await db.batch([
      db.prepare('INSERT INTO sub_edits (sid, at, before, after, dev) VALUES (?, ?, ?, ?, ?)').bind(old.id, now,
        JSON.stringify(Object.fromEntries(Object.keys(F).map((k) => [k, old[k]]))), JSON.stringify(Object.fromEntries(Object.keys(F).map((k) => [k, n[k]]))), deviceLabel(req.headers.get('User-Agent'))),
      db.prepare('UPDATE subs SET name = ?, phone = ?, sdate = ?, kind = ?, pkg = ?, qty = ?, note = ?, giver_name = ?, giver_phone = ?, birth = ?, staff_no = ?, store = ?, edit_n = COALESCE(edit_n, 0) + 1, edit_at = ? WHERE id = ?')
        .bind(n.name, n.phone, n.sdate, n.kind, n.pkg, n.qty, n.note, n.giver_name, n.giver_phone, n.birth, n.staff_no, n.store, now, old.id)
    ]);
    await audit(req, db, who(u), 'sub_edit', '#' + old.id + ' ' + (old.name || '') + ' ' + old.phone + ' 改了：' + diff.join('；'));
    return json({ ok: true });
  }
  if (p === '/sub/edits' && req.method === 'GET') {
    needOp();
    const r = await db.prepare('SELECT at, before, after, dev FROM sub_edits WHERE sid = ? ORDER BY id DESC').bind(Number(url.searchParams.get('id')) || 0).all();
    return json({ edits: r.results });
  }
  // 撤回「已导出」（点错了）
  if (p === '/sub/undo' && req.method === 'POST') {
    needOp();
    const id = Number((await body(req)).id) || 0;
    const s0 = await db.prepare('SELECT id, name, phone FROM subs WHERE id = ?').bind(id).first();
    await db.prepare("UPDATE subs SET status = 'pending', done_at = NULL WHERE id = ? AND status = 'done'").bind(id).run();
    await audit(req, db, who(u), 'sub_undo', '撤回已导出，变回待处理：' + (s0 ? '#' + s0.id + ' ' + (s0.name || '') + ' ' + s0.phone : '#' + id));
    return json({ ok: true });
  }
  // 设备列表 / 改密码（只有操作员）
  if (p === '/devices' && req.method === 'GET') {
    needOp();
    const r = await db.prepare('SELECT d.id, u.role, d.label, d.created, d.last_at FROM devices d JOIN users u ON u.id = d.uid ORDER BY u.role, d.last_at DESC').all();
    return json({ devices: r.results, me: u.did });
  }
  // 战报数据：时间段内提交的（不含删掉的），按提交时间算。只给统计要用的字段，不给姓名手机号
  if (p === '/report' && req.method === 'GET') {
    needOp();
    const from = Number(url.searchParams.get('from')) || 0, to = Number(url.searchParams.get('to')) || now;
    const r = await db.prepare("SELECT s.store, s.staff_no, (SELECT name FROM staff WHERE no = s.staff_no) staff_name, s.kind, s.pkg, s.qty, s.created FROM subs s WHERE s.status <> 'del' AND s.kind <> 'refund' AND s.created >= ? AND s.created < ? ORDER BY s.created").bind(from, to).all();
    return json({ rows: r.results });
  }
  // 页面上做的事（服务器看不到的）：导出、载入名单、下载模板
  if (p === '/log' && req.method === 'POST') {
    needOp();
    const b = await body(req), act = String(b.act || '');
    if (['export', 'load', 'tpl', 'report'].indexOf(act) < 0) throw bad('不认识的记录类型');
    await audit(req, db, who(u), act, str(b.info, 4000));
    return json({ ok: true });
  }
  // 操作记录：按 id 倒序分页；act 筛类型，q 搜详情 / 设备
  if (p === '/audit' && req.method === 'GET') {
    needOp();
    const before = Number(url.searchParams.get('before')) || 1e15, act = str(url.searchParams.get('act'), 20), q = str(url.searchParams.get('q'), 40);
    let sql = 'SELECT id, at, role, act, info, dev, ip FROM audit WHERE id < ?', args = [before];
    if (act) { sql += ' AND act = ?'; args.push(act); }
    if (q) { sql += ' AND (info LIKE ? OR dev LIKE ? OR ip LIKE ? OR role LIKE ?)'; const l = '%' + q.replace(/[%_]/g, '') + '%'; args.push(l, l, l, l); }
    const r = await db.prepare(sql + ' ORDER BY id DESC LIMIT 200').bind(...args).all();
    const n = await db.prepare('SELECT COUNT(*) n FROM audit').first();
    return json({ rows: r.results, total: n.n });
  }
  // 账号与设备页：两个账号 + 各自登录的设备
  if (p === '/accounts' && req.method === 'GET') {
    needOp();
    const us = (await db.prepare('SELECT id, role, store, name, dev_limit, lock_until FROM users ORDER BY COALESCE(sort, 99), id').all()).results;
    const ds = (await db.prepare('SELECT id, uid, label, created, last_at FROM devices ORDER BY last_at DESC').all()).results;
    return json({ me: u.did, accounts: us.map((x) => ({ id: x.id, role: x.role, store: x.store, name: x.name, dev_limit: x.dev_limit, locked: x.lock_until > now, devices: ds.filter((d) => d.uid === x.id) })) });
  }
  // 手动移出一台设备（连同它的会话，马上下线）；不能移出自己这台
  if (p === '/devices/del' && req.method === 'POST') {
    needOp();
    const id = Number((await body(req)).id) || 0;
    if (id === u.did) throw bad('不能移出你正在用的这台');
    const d = await db.prepare('SELECT d.label, d.uid, u.role, u.store, u.name FROM devices d JOIN users u ON u.id = d.uid WHERE d.id = ?').bind(id).first();
    if (!d) throw bad('这台设备已经不在了');
    if (d.role === 'op' && d.uid !== u.id) throw new HttpError(403, '后台账号只能移出自己的设备');   // 2026-11-12 用户：后台之间不能互相踢
    await db.batch([db.prepare('DELETE FROM sessions WHERE did = ?').bind(id), db.prepare('DELETE FROM devices WHERE id = ?').bind(id)]);
    await audit(req, db, who(u), 'device_remove', acctName(d) + ' ' + d.label);
    return json({ ok: true });
  }
  if (p === '/password' && req.method === 'POST') {
    needOp();
    const b = await body(req), pass = String(b.password || '');
    if (pass.length < 6) throw bad('密码至少 6 位');
    const t = await db.prepare('SELECT id, role, store, name FROM users WHERE id = ?').bind(Number(b.uid) || 0).first();
    if (!t) throw bad('没有这个账号');
    // 后台账号只能本人改（走 /password/self，要原密码）；别人谁都重置不了（2026-11-12 用户）
    if (t.role === 'op') throw new HttpError(403, t.id === u.id ? '改自己的密码请点「修改密码」，要输原密码' : '后台账号只能本人改密码');
    const salt = randHex(16);
    const keep = t.id === u.id ? await sha256(cookie(req, 'c365_s')) : '';
    await db.batch([
      db.prepare('UPDATE users SET salt = ?, hash = ?, fails = 0, lock_until = 0 WHERE id = ?').bind(salt, await pbkdf2(pass, salt), t.id),
      db.prepare('DELETE FROM sessions WHERE uid = ? AND th <> ?').bind(t.id, keep),   // 改完其他设备都要重新登录
      db.prepare('DELETE FROM devices WHERE uid = ? AND id <> ?').bind(t.id, t.id === u.id ? u.did : 0)   // 设备也一起移出，名额清空
    ]);
    await audit(req, db, who(u), 'password', acctName(t) + ' 账号改了密码');
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
