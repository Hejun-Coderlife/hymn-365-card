/* 自画下拉框（2026-11-11 用户：「所有下拉表自己设计」，系统自带的是灰色圆角气泡，跟页面不搭）
   用法：XSel.attach(selectEl)。原生 <select> 留着当「值」，隐藏起来；页面原来的 .value / onchange / innerHTML 重填都照常用，
   旁边多一个按钮，点开是自己画的列表（带 optgroup 分组标题，超过 10 项自动带搜索框；手机上从底部弹出）。 */
(function () {
  const css = `
.xs-btn{display:inline-flex;align-items:center;justify-content:space-between;gap:10px;height:38px;padding:0 12px;min-width:140px;border:1px solid #E3DFD6;background:#fff;font:inherit;font-size:13px;color:#16140F;cursor:pointer;text-align:left;box-sizing:border-box;white-space:nowrap}
.xs-btn:hover,.xs-btn.open{border-color:#16140F}
.xs-btn .v{overflow:hidden;text-overflow:ellipsis}
.xs-btn .v.ph{color:#B4ADA1}
.xs-btn svg{flex:none;color:#9C958A}
.xs-pop{position:fixed;z-index:100;background:#fff;border:1px solid #16140F;box-shadow:0 8px 24px rgba(22,20,15,.10);font-family:-apple-system,"PingFang SC",sans-serif;font-size:13px;color:#16140F;display:flex;flex-direction:column;max-height:360px}
.xs-q{margin:8px;border:1px solid #E3DFD6;padding:7px 10px;font:inherit;outline:none}
.xs-q:focus{border-color:#16140F}
.xs-list{overflow:auto;padding:4px 0}
.xs-g{padding:10px 14px 4px;font-size:11px;letter-spacing:.16em;color:#9C958A}
.xs-o{display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer;white-space:nowrap}
.xs-o:hover,.xs-o.hi{background:#FAFAF8}
.xs-o .ck{width:12px;flex:none;color:#16140F}
.xs-o.on{font-weight:500}
.xs-none{padding:14px;color:#B4ADA1}
.xs-mask{position:fixed;inset:0;z-index:99}
@media (max-width:600px){.xs-pop{left:0!important;right:0;bottom:0;top:auto!important;width:auto!important;max-height:70vh;border:0;border-top:1px solid #E3DFD6;padding-bottom:env(safe-area-inset-bottom)}.xs-o{padding:13px 18px;font-size:16px}.xs-g{padding:14px 18px 4px}.xs-q{font-size:16px;margin:12px 14px}.xs-mask{background:rgba(22,20,15,.25)}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CHEV = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 1l4 4 4-4"/></svg>';

  function attach(sel, opt) {
    opt = opt || {};
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'xs-btn' + (opt.cls ? ' ' + opt.cls : '');
    sel.style.display = 'none';
    sel.parentNode.insertBefore(btn, sel.nextSibling);
    const paint = () => {
      const o = sel.options[sel.selectedIndex];
      const empty = !o || (o.value === '' && opt.placeholder);
      btn.innerHTML = `<span class="v${empty && opt.placeholder ? ' ph' : ''}">${esc(o ? o.textContent : '')}</span>${CHEV}`;
    };
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', { get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); paint(); }, configurable: true });
    new MutationObserver(paint).observe(sel, { childList: true, subtree: true });   // 页面用 innerHTML 重填选项时跟着变
    paint();
    btn.onclick = () => open(sel, btn, paint, opt);
  }

  function open(sel, btn, paint, opt) {
    const items = [];
    [...sel.children].forEach(n => {
      if (n.tagName === 'OPTGROUP') { items.push({ g: n.label }); [...n.children].forEach(o => items.push({ v: o.value, t: o.textContent, grp: n.label })); }
      else if (!(opt.placeholder && n.value === '')) items.push({ v: n.value, t: n.textContent });   // 「选你的门店」这种提示不当选项
    });
    const nOpt = items.filter(x => !x.g).length;
    const mask = document.createElement('div'); mask.className = 'xs-mask';
    const pop = document.createElement('div'); pop.className = 'xs-pop';
    pop.innerHTML = (nOpt > 10 ? '<input class="xs-q" placeholder="搜索">' : '') + '<div class="xs-list"></div>';
    const list = pop.querySelector('.xs-list'), q = pop.querySelector('.xs-q');
    const close = () => { mask.remove(); pop.remove(); btn.classList.remove('open'); };
    const pick = v => { sel.value = v; paint(); sel.dispatchEvent(new Event('change', { bubbles: true })); close(); };
    function draw() {
      const kw = q ? q.value.trim() : '';
      const hit = items.filter(x => x.g ? !kw || items.some(y => y.grp === x.g && y.t.indexOf(kw) >= 0) : !kw || x.t.indexOf(kw) >= 0 || (x.grp || '').indexOf(kw) >= 0);
      list.innerHTML = hit.length ? hit.map(x => x.g ? `<div class="xs-g">${esc(x.g)}</div>`
        : `<div class="xs-o${x.v === sel.value ? ' on' : ''}" data-v="${esc(x.v)}"><span class="ck">${x.v === sel.value ? '✓' : ''}</span>${esc(x.t)}</div>`).join('') : '<div class="xs-none">没有对上的</div>';
      list.querySelectorAll('.xs-o').forEach(o => o.onclick = () => pick(o.dataset.v));
    }
    draw();
    mask.onclick = close;
    if (q) {
      q.oninput = draw;
      q.onkeydown = e => { if (e.key === 'Enter') { const f = list.querySelector('.xs-o'); if (f) pick(f.dataset.v); } if (e.key === 'Escape') close(); };
    }
    document.body.append(mask, pop);
    btn.classList.add('open');
    const r = btn.getBoundingClientRect();
    pop.style.minWidth = r.width + 'px';
    const h = pop.offsetHeight, w = pop.offsetWidth;
    pop.style.left = Math.min(r.left, innerWidth - w - 8) + 'px';
    pop.style.top = (r.bottom + 4 + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
    const on = list.querySelector('.xs-o.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    if (q && innerWidth > 600) q.focus();   // 手机上不自动弹键盘
  }
  window.XSel = { attach };
})();
