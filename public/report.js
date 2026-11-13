/* 365金卡战报（2026-11-11 用户：像抖音看板的战报，能选日 / 周 / 月 / 年，生成时能筛店员或门店）
   画法照抄抖音看板 assets/report.js：Canvas 直接画，540 宽 ×2 出 1080px PNG，白底 + 顶上品牌粉细带 + 宋体标题 + Didot 大数字 + 排名条。
   口径：按「提交时间」落在这段时间里的算（店员手机提交 / 操作员也能提交），删掉的不算；新开卡、续卡都算办卡。 */
(function () {
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(); };
  const md = d => `${d.getMonth() + 1}/${d.getDate()}`;

  // 时间段：[from, to) 毫秒 + 标题
  function range(P) {
    const d = parse(P.date);
    let a, b, title;
    if (P.mode === 'day') { a = d; b = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); title = `${d.getMonth() + 1} 月 ${d.getDate()} 日`; }
    else if (P.mode === 'week') {
      a = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7);
      b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7);
      title = `${md(a)} – ${md(new Date(b - 864e5))} 这一周`;
    } else if (P.mode === 'month') { a = new Date(d.getFullYear(), d.getMonth(), 1); b = new Date(d.getFullYear(), d.getMonth() + 1, 1); title = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`; }
    else if (P.mode === 'year') { a = new Date(d.getFullYear(), 0, 1); b = new Date(d.getFullYear() + 1, 0, 1); title = `${d.getFullYear()} 年`; }
    else {
      let f = parse(P.from), t = parse(P.to); if (f > t) [f, t] = [t, f];
      a = f; b = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      title = iso(f) === iso(t) ? `${f.getMonth() + 1} 月 ${f.getDate()} 日` : `${md(f)} – ${md(t)}`;
    }
    return { from: a.getTime(), to: b.getTime(), title, fromD: a, toD: new Date(b - 864e5) };
  }

  // rows：/api/report 拿到的（store, staff_no, kind, created）。F = { mgr, store, staff, by }
  function compute(rows, F, r) {
    const nos = (F.staff || '').split(/[\s,，、]+/).filter(Boolean);
    const inScope = st => (!F.mgr || STORE_MGR[st] === F.mgr) && (!F.store || st === F.store);
    const hit = rows.filter(x => inScope(x.store || '') && (!nos.length || nos.indexOf(x.staff_no) >= 0));
    const per = {};
    const add = (key, o) => { per[key] = per[key] || Object.assign({ n: 0, nw: 0, rn: 0, ot: 0 }, o); return per[key]; };
    // 按门店排时，范围里一张都没办的店也列出来（排在后面），一眼看到谁没动
    if (F.by === 'store' && !nos.length) STORES.forEach(([m, list]) => list.forEach(st => { if (inScope(st)) add(st, { name: st, sub: m }); }));
    hit.forEach(x => {
      const st = x.store || '未填门店';
      let o;
      if (F.by === 'store') o = add(st, { name: st, sub: STORE_MGR[st] || '' });
      else {   // 2026-11-13 用户：按店员排显示名字；同一个人在不同店（或不同工号）按名字并成一行，门店/工号都列出来
        o = add(x.staff_name ? 'n|' + x.staff_name : 'no|' + x.staff_no, { name: x.staff_name || '工号 ' + x.staff_no, nos: [], sts: [] });
        if (o.nos.indexOf(x.staff_no) < 0) o.nos.push(x.staff_no);
        if (o.sts.indexOf(st) < 0) o.sts.push(st);
        o.no = o.nos.join('、'); o.sub = o.sts.join('、');
      }
      const w = x.kind === 'other' ? 1 : (x.qty || 1);   // 2026-11-12 起按套餐份数算（一单可以买几份）
      o.n += w; x.kind === 'renew' ? o.rn += w : x.kind === 'other' ? o.ot += w : o.nw += w;
    });
    const list = Object.values(per).sort((a, b) => b.n - a.n || b.nw - a.nw || a.name.localeCompare(b.name, 'zh'));
    const W = x => x.kind === 'other' ? 1 : (x.qty || 1), sum = a => a.reduce((t, x) => t + W(x), 0);
    const total = sum(hit), nw = sum(hit.filter(x => x.kind === 'new')), ot = sum(hit.filter(x => x.kind === 'other'));
    const nStore = F.store ? 1 : STORES.reduce((s, [m, l]) => s + (!F.mgr || F.mgr === m ? l.length : 0), 0);
    const scope = [F.store || (F.mgr ? `${F.mgr} · ${nStore} 家店` : `全部 ${nStore} 家店`), nos.length ? '工号 ' + nos.join('、') : ''].filter(Boolean).join(' · ');
    return { r, list, total, nw, rn: total - nw - ot, ot, scope, by: F.by };
  }

  function spaced(g, text, x, y, sp, align) {
    const cs = text.split(''); let w = -sp; cs.forEach(c => { w += g.measureText(c).width + sp; });
    let cx = align === 'right' ? x - w : x; const old = g.textAlign; g.textAlign = 'left';
    cs.forEach(c => { g.fillText(c, cx, y); cx += g.measureText(c).width + sp; }); g.textAlign = old;
  }
  function fit(g, s, w) { if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }

  function draw(D, logo) {
    const W = 540, PAD = 36, ROW = 38, S2 = 2;
    const C = { ink: '#16140F', t3: '#9C958A', line: '#E3DFD6', track: '#EFEBE3', paper: '#FAF7F2', gold: '#C9A15A', deep: '#A27B3A', light: '#F0D9A8' };   // 2026-11-11 用户：粉色太淡，改金色系（同侧栏 365 金卡的金光）
    const NUM = 'Didot, "Bodoni 72", Georgia, serif', SANS = '"PingFang SC", "Helvetica Neue", sans-serif', SONG = '"Songti SC", "STSong", serif';
    const rows = D.list.length ? D.list : [];
    const listH = Math.max(1, rows.length) * ROW, H = 250 + 44 + listH + 70;
    const cv = document.createElement('canvas'); cv.width = W * S2; cv.height = H * S2;
    const g = cv.getContext('2d'); g.scale(S2, S2);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const band = g.createLinearGradient(0, 0, W, 0); band.addColorStop(0, C.deep); band.addColorStop(0.5, C.light); band.addColorStop(1, C.deep);
    g.fillStyle = band; g.fillRect(0, 0, W, 4);
    // 背景水印「365」（2026-11-12 用户，跟会员战报「VIP」、抖音战报「抖」同一位置）：右上角大字，淡金，压在内容下面
    g.save(); g.globalAlpha = 0.08; g.fillStyle = C.gold; g.font = 'italic 140px ' + NUM; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillText('365', W - PAD + 8, 205); g.restore();
    let y = 44;
    if (logo) g.drawImage(logo, PAD, y - 16, 84, 84 * logo.height / logo.width);
    g.font = '10px ' + SANS; g.fillStyle = C.t3; spaced(g, '套餐销售战报', W - PAD, y, 2.5, 'right');
    y = 104; g.fillStyle = C.ink; g.font = '26px ' + SONG; g.fillText(D.r.title, PAD, y);
    g.font = '12px ' + SANS; g.fillStyle = C.t3; g.fillText(D.scope, PAD, y + 24);
    // 大数字：办卡总数
    y = 196; g.fillStyle = C.deep; g.font = '64px ' + NUM; g.fillText(String(D.total), PAD - 2, y);
    const pw = g.measureText(String(D.total)).width; g.font = '15px ' + SANS; g.fillText('份', PAD + pw + 6, y);
    g.font = '11px ' + SANS; g.fillStyle = C.t3; g.fillText('总份数', PAD, y + 22);
    const colW = (W - PAD * 2) / 4;   // 2026-11-12 加「其它」
    [[String(D.nw), '新开365卡'], [String(D.rn), '365续卡'], [String(D.ot), '其它']].forEach((s, i) => {
      const x = PAD + colW * (i + 1) + 10;
      g.fillStyle = C.line; g.fillRect(x - 12, y - 44, 1, 70);
      g.fillStyle = C.ink; g.font = '30px ' + NUM; g.fillText(s[0], x, y);
      g.fillStyle = C.t3; g.font = '11px ' + SANS; g.fillText(s[1], x, y + 22);
    });
    y = 250; g.fillStyle = C.ink; g.fillRect(PAD, y, W - PAD * 2, 1);
    g.font = '11px ' + SANS; g.fillStyle = C.t3; spaced(g, D.by === 'store' ? '门店排名' : '店员排名', PAD, y + 26, 2);
    g.textAlign = 'right'; g.fillText('份数 · 新开 / 续卡 / 其它', W - PAD, y + 26); g.textAlign = 'left';
    y += 44;
    const max = Math.max(1, ...rows.map(o => o.n)), nameW = 150, barX = PAD + 28 + nameW, barW = 120;   // 条短一点，右边给「新 · 续 · 其」留地方
    const subs = new Set(rows.map(o => o.sub)), showSub = D.by === 'staff' || subs.size > 1;
    if (!rows.length) { g.fillStyle = C.t3; g.font = '13px ' + SANS; g.fillText('这段时间还没有登记', PAD + 28, y + ROW / 2 + 4); }
    rows.forEach((o, i) => {
      const cy = y + i * ROW, mid = cy + ROW / 2 + 4;
      if (i % 2) { g.fillStyle = C.paper; g.fillRect(PAD - 8, cy, W - PAD * 2 + 16, ROW); }
      g.fillStyle = i < 3 && o.n ? C.deep : C.t3; g.font = '15px ' + NUM; g.textAlign = 'right'; g.fillText(String(i + 1), PAD + 18, mid);
      g.textAlign = 'left'; g.fillStyle = o.n ? C.ink : C.t3; g.font = '13px ' + SANS;
      const sub = showSub ? o.sub : '';
      g.font = '13px ' + SANS; const nm = fit(g, o.name, nameW - 8 - (sub ? (D.by === 'staff' ? 64 : 34) : 0)); g.fillText(nm, PAD + 28, mid);
      if (sub) { const nx = PAD + 28 + g.measureText(nm).width + 6; g.font = '11px ' + SANS; g.fillStyle = C.t3; g.fillText(fit(g, sub, barX - nx - 8), nx, mid); }
      g.fillStyle = C.track; g.fillRect(barX, mid - 7, barW, 6);
      if (o.n) { g.fillStyle = C.gold; g.fillRect(barX, mid - 7, Math.max(2, barW * o.n / max), 6); }
      g.textAlign = 'right'; g.font = '17px ' + NUM; g.fillStyle = o.n ? C.ink : C.t3; g.fillText(String(o.n), barX + barW + 40, mid);
      g.font = '11px ' + SANS; g.fillStyle = C.t3; g.fillText(`新 ${o.nw} · 续 ${o.rn}` + (o.ot ? ` · 其 ${o.ot}` : ''), W - PAD, mid); g.textAlign = 'left';
    });
    y += listH + 30;
    g.fillStyle = C.line; g.fillRect(PAD, y - 14, W - PAD * 2, 1);
    g.font = '10.5px ' + SANS; g.fillStyle = C.t3;
    const now = new Date();
    g.fillText(`按提交时间统计 · 生成于 ${now.getMonth() + 1}/${now.getDate()} ${pad(now.getHours())}:${pad(now.getMinutes())}`, PAD, y + 6);
    spaced(g, 'HYMN STUDIO', W - PAD, y + 6, 3, 'right');
    return cv;
  }

  window.Report365 = { range, compute, draw, iso };
})();
