/* 中文日期选择（2026-11-11 用户：日期改成中文）
   浏览器自带的日期框跟着系统 / 浏览器语言走（用户的 Chrome 是英文界面，弹出来是 November、Jan…），网页改不了，只能自己画。
   用法：DatePick.attach(inputEl)。原来的 <input type="date"> 留着当「值」（YYYY-MM-DD），
   页面上原有的 .value 读写、oninput 监听都不用改；它旁边多一个按钮显示「2026年11月11日 周三」，点开是中文日历。 */
(function () {
  const WK = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const label = d => d ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日<small>周${WK[d.getDay()]}</small>` : '<small>选日期</small>';

  const css = `
.dp-btn{flex:1;display:flex;align-items:baseline;gap:8px;border:0;background:none;padding:12px 0;font-family:Didot,"Bodoni 72",Georgia,"Songti SC",serif;font-size:inherit;color:inherit;cursor:pointer;text-align:left;min-width:0;width:100%}
.dp-btn small{font-family:-apple-system,"PingFang SC",sans-serif;font-size:12px;color:#9C958A}
.dp-pop{position:fixed;z-index:100;background:#fff;border:1px solid #E3DFD6;box-shadow:0 8px 28px rgba(22,20,15,.12);width:300px;padding:14px 16px 12px;font-family:-apple-system,"PingFang SC",sans-serif;color:#16140F}
.dp-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.dp-hd b{font-weight:500;font-size:15px;letter-spacing:.04em}
.dp-hd button{border:1px solid #E3DFD6;background:#fff;width:32px;height:30px;cursor:pointer;font-size:14px;color:#4A453C}
.dp-g{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.dp-g span{text-align:center;font-size:12px;color:#9C958A;padding:4px 0}
.dp-g button{border:0;background:none;height:34px;font-family:Didot,"Bodoni 72",Georgia,serif;font-size:15px;color:#16140F;cursor:pointer}
.dp-g button:hover{background:#FAFAF8}
.dp-g button.o{color:#C9C3B8}
.dp-g button.t{color:#B9808B;box-shadow:inset 0 -2px 0 #D9A6AE}
.dp-g button.s{background:var(--dp-sel,#16140F);color:#fff;box-shadow:none}
.dp-hd b.sw{cursor:pointer;padding:4px 8px;border-bottom:1px solid #E3DFD6}
.dp-hd b.sw:after{content:" ▾";font-size:10px;color:#9C958A}
.dp-mg{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:4px 0}
.dp-mg button{border:1px solid #F0EDE6;background:#fff;height:46px;font-size:15px;color:#16140F;cursor:pointer}
.dp-mg button:hover{background:#FAFAF8}
.dp-mg button.t{color:#B9808B}
.dp-mg button.s{background:var(--dp-sel,#16140F);border-color:var(--dp-sel,#16140F);color:#fff}
.dp-ft{display:flex;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid #F0EDE6}
.dp-ft button{flex:1;border:1px solid #E3DFD6;background:#fff;padding:7px 0;font-size:13px;color:#4A453C;cursor:pointer}
.dp-mask{position:fixed;inset:0;z-index:99}
@media (max-width:600px){.dp-pop{left:0!important;right:0;bottom:0;top:auto!important;width:auto;padding:16px 18px calc(16px + env(safe-area-inset-bottom))}.dp-g button{height:42px;font-size:17px}.dp-mask{background:rgba(22,20,15,.25)}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function attach(inp) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dp-btn';
    inp.style.display = 'none';
    inp.parentNode.insertBefore(btn, inp.nextSibling);
    const paint = () => { btn.innerHTML = label(parse(inp.value)); };
    // 页面代码直接给 input.value 赋值时（比如切到续卡自动填下月 1 号），按钮跟着变
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(inp, 'value', { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); paint(); }, configurable: true });
    paint();
    btn.onclick = () => open(inp, btn);
  }

  function open(inp, btn) {
    const sel = parse(inp.value), today = new Date();
    let y = (sel || today).getFullYear(), m = (sel || today).getMonth(), mv = false;   // mv = 选年月视图（2026-11-12 用户：跨年一个月一个月翻不好用）
    const mask = document.createElement('div'); mask.className = 'dp-mask';
    const pop = document.createElement('div'); pop.className = 'dp-pop';
    const close = () => { mask.remove(); pop.remove(); };
    mask.onclick = close;
    const pick = d => { inp.value = iso(d); inp.dispatchEvent(new Event('input', { bubbles: true })); close(); };
    function draw() {
      if (mv) {   // 年月视图：‹ › 换年，点月份回到日历
        pop.innerHTML = `<div class="dp-hd"><button type="button" data-y="-1">‹</button><b class="sw">${y}年</b><button type="button" data-y="1">›</button></div>
          <div class="dp-mg">${Array.from({ length: 12 }, (_, i) => `<button type="button" data-m="${i}" class="${y === today.getFullYear() && i === today.getMonth() ? 't' : ''} ${sel && y === sel.getFullYear() && i === sel.getMonth() ? 's' : ''}">${i + 1}月</button>`).join('')}</div>`;
        pop.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { y += +b.dataset.y; draw(); });
        pop.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { m = +b.dataset.m; mv = false; draw(); });
        pop.querySelector('.sw').onclick = () => { mv = false; draw(); };
        return;
      }
      const first = new Date(y, m, 1), start = new Date(y, m, 1 - first.getDay());
      let g = WK.map(w => `<span>${w}</span>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const c = [d.getMonth() !== m ? 'o' : '', iso(d) === iso(today) ? 't' : '', sel && iso(d) === iso(sel) ? 's' : ''].join(' ');
        g += `<button type="button" class="${c}" data-d="${iso(d)}">${d.getDate()}</button>`;
      }
      pop.innerHTML = `<div class="dp-hd"><button type="button" data-n="-1">‹</button><b class="sw">${y}年${m + 1}月</b><button type="button" data-n="1">›</button></div>
        <div class="dp-g">${g}</div>
        <div class="dp-ft"><button type="button" data-q="today">今天</button><button type="button" data-q="next1">下月1号</button></div>`;
      pop.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { m += +b.dataset.n; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } draw(); });
      pop.querySelector('.sw').onclick = () => { mv = true; draw(); };
      pop.querySelectorAll('[data-d]').forEach(b => b.onclick = () => pick(parse(b.dataset.d)));
      pop.querySelector('[data-q=today]').onclick = () => pick(today);
      pop.querySelector('[data-q=next1]').onclick = () => pick(new Date(today.getFullYear(), today.getMonth() + 1, 1));
    }
    draw();
    document.body.append(mask, pop);
    // 电脑上贴着按钮弹，放不下就往上翻；手机上（≤600px）CSS 改成底部抽屉
    const r = btn.getBoundingClientRect(), h = pop.offsetHeight;
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = (r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
  }
  window.DatePick = { attach };
})();
