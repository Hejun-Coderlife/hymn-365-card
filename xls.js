/* 自写的 .xls（BIFF8）生成器 —— 2026-11-11
   为什么自己写：用户的导入系统必须收 .xls；而 SheetJS 社区版写 biff8 时不带任何样式/冻结/筛选，
   ExcelJS 只能写 .xlsx。用户又要求所有表「标题行浅灰 + 冻结 + 筛选」，只好自己拼 BIFF8 记录，
   外层 OLE 复合文档用 SheetJS 自带的 XLSX.CFB 打包。
   结构参照用户模板 ~/Desktop/365金卡生成模板.xls（WPS 存的，本身就冻结了首行）。

   用法：XLS.write(XLSX.CFB, [{ name, widths:[字符宽...], rows:[[单元格...], ...] }]) → Uint8Array
   单元格：字符串 / 数字 / {date: Excel序列号} / null（空）。第 1 行是标题行。 */
(function (root) {
  // ---------- 小工具 ----------
  class Buf {
    constructor() { this.a = []; }
    u8(v) { this.a.push(v & 255); return this; }
    u16(v) { this.a.push(v & 255, (v >>> 8) & 255); return this; }
    u32(v) { this.a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); return this; }
    f64(v) { const b = new Uint8Array(new Float64Array([v]).buffer); for (const x of b) this.a.push(x); return this; }
    utf16(s) { for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i)); return this; }
    bytes(arr) { for (const x of arr) this.a.push(x); return this; }
    get length() { return this.a.length; }
  }
  const rec = (out, type, body) => { out.u16(type).u16(body.length); out.bytes(body.a || body); };
  const shortStr = s => new Buf().u8(s.length).u8(1).utf16(s);        // ShortXLUnicodeString
  const longStr = s => new Buf().u16(s.length).u8(1).utf16(s);        // XLUnicodeString

  // Excel 97 默认调色板（索引 8~63）。把 0x16（银灰 C0C0C0）改成标题浅灰 EFEFEF。
  const PAL = ['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','EFEFEF','808080',
    '9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF',
    '00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696',
    '003366','339966','003300','333300','993300','993366','333399','333333'];
  const ICV_GRAY = 0x16, ICV_DARK = 0x3F;   // 浅灰底 / 333333 深灰字

  const FMT_DATE = 164;
  // XF 索引：0~14 样式 XF，15 默认单元格，16 标题，17 日期
  const XF_DEF = 15, XF_HEAD = 16, XF_DATE = 17;

  function font(bold, color) {
    const b = new Buf().u16(240).u16(bold ? 1 : 0).u16(color).u16(bold ? 700 : 400).u16(0).u8(0).u8(0).u8(0x86).u8(0);
    return b.bytes(shortStr('宋体').a);                 // 12 号宋体，同模板
  }
  function xf({ fnt = 0, fmt = 0, style = false, align = 0x20, used = 0, fill = 0, fore = 0x40 }) {
    const b = new Buf().u16(fnt).u16(fmt).u16(style ? 0xFFF5 : 0x0001);
    b.u8(align).u8(0).u8(0).u8(used << 2);
    b.u32(0);                                             // 无边框
    b.u32(fill << 26);                                    // 填充样式（1=实心）
    b.u16((fore & 0x7F) | (0x41 << 7));                   // 前景色 + 背景色
    return b;
  }

  function write(CFB, sheets) {
    // 共享字符串表
    const sst = [], sstIdx = new Map(); let sstTotal = 0;
    const sidx = s => { sstTotal++; if (!sstIdx.has(s)) { sstIdx.set(s, sst.length); sst.push(s); } return sstIdx.get(s); };

    // ---------- 先写各工作表子流 ----------
    const sheetStreams = sheets.map((sh, si) => {
      const o = new Buf();
      const nr = sh.rows.length, nc = sh.widths.length;
      rec(o, 0x0809, new Buf().u16(0x0600).u16(0x0010).u16(0x0DBB).u16(0x07CC).u32(0).u32(6));  // BOF 工作表
      rec(o, 0x0055, new Buf().u16(8));                                                         // DEFCOLWIDTH
      sh.widths.forEach((w, c) => rec(o, 0x007D, new Buf().u16(c).u16(c).u16(Math.round(w * 256)).u16(XF_DEF).u16(0).u16(0)));
      rec(o, 0x009D, new Buf().u16(nc));                                                        // AUTOFILTERINFO：整行标题都带筛选
      rec(o, 0x0200, new Buf().u32(0).u32(nr).u16(0).u16(nc).u16(0));                           // DIMENSIONS
      for (let r = 0; r < nr; r++) {
        rec(o, 0x0208, new Buf().u16(r).u16(0).u16(nc).u16(400).u16(0).u16(0).u32(0x000F0140)); // ROW 行高 20 磅
      }
      sh.rows.forEach((row, r) => row.forEach((v, c) => {
        if (v === null || v === undefined || v === '') return;
        const xfi = r === 0 ? XF_HEAD : (typeof v === 'object' ? XF_DATE : XF_DEF);
        if (typeof v === 'string') rec(o, 0x00FD, new Buf().u16(r).u16(c).u16(xfi).u32(sidx(v)));   // LABELSST
        else rec(o, 0x0203, new Buf().u16(r).u16(c).u16(xfi).f64(typeof v === 'object' ? v.date : v)); // NUMBER
      }));
      const first = si === 0;
      // WINDOW2：网格线/行列号/冻结；第一张表设为选中+活动
      rec(o, 0x023E, new Buf().u16(0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x80 | 0x100 | (first ? 0x600 : 0)).u16(0).u16(0).u32(0x40).u16(0).u16(0).u32(0));
      rec(o, 0x0041, new Buf().u16(0).u16(1).u16(1).u16(0).u16(2));                             // PANE：冻结首行
      rec(o, 0x001D, new Buf().u8(2).u16(1).u16(0).u16(0).u16(1).u16(1).u16(1).u8(0).u8(0));    // SELECTION
      rec(o, 0x000A, new Buf());                                                                // EOF
      return o;
    });

    // ---------- 工作簿全局 ----------
    const g = new Buf();
    rec(g, 0x0809, new Buf().u16(0x0600).u16(0x0005).u16(0x0DBB).u16(0x07CC).u32(0).u32(6));
    rec(g, 0x0042, new Buf().u16(1200));                                                        // CODEPAGE UTF-16
    rec(g, 0x003D, new Buf().u16(0).u16(0).u16(0x4000).u16(0x2000).u16(0x38).u16(0).u16(0).u16(1).u16(0x258)); // WINDOW1
    for (let i = 0; i < 4; i++) rec(g, 0x0031, font(false, 0x7FFF));                           // 字体 0~3（4 号按规范跳过）
    rec(g, 0x0031, font(true, ICV_DARK));                                                       // 字体 5：标题加粗深灰
    rec(g, 0x041E, new Buf().u16(FMT_DATE).bytes(longStr('yyyy/m/d').a));                      // FORMAT
    for (let i = 0; i < 15; i++) rec(g, 0x00E0, xf({ style: true, used: i ? 0x3D : 0 }));      // 样式 XF
    rec(g, 0x00E0, xf({}));                                                                     // 15 默认
    rec(g, 0x00E0, xf({ fnt: 5, align: 0x12, used: 0x3F, fill: 1, fore: ICV_GRAY }));          // 16 标题：居中+浅灰+加粗
    rec(g, 0x00E0, xf({ fmt: FMT_DATE, used: 0x01 }));                                         // 17 日期
    rec(g, 0x0293, new Buf().u16(0x8000).u8(0).u8(0xFF));                                       // STYLE Normal
    const pal = new Buf().u16(56); PAL.forEach(h => pal.u8(parseInt(h.slice(0, 2), 16)).u8(parseInt(h.slice(2, 4), 16)).u8(parseInt(h.slice(4), 16)).u8(0));
    rec(g, 0x0092, pal);                                                                        // PALETTE
    const bsPos = [];
    sheets.forEach(sh => { bsPos.push(g.length + 4); rec(g, 0x0085, new Buf().u32(0).u8(0).u8(0).bytes(shortStr(sh.name).a)); });
    // 筛选范围：内部 SUPBOOK + EXTERNSHEET + 每张表一个隐藏的内置名 _FilterDatabase
    rec(g, 0x01AE, new Buf().u16(sheets.length).u16(0x0401));
    const ext = new Buf().u16(sheets.length); sheets.forEach((_, i) => ext.u16(0).u16(i).u16(i)); rec(g, 0x0017, ext);
    sheets.forEach((sh, i) => {
      const fm = new Buf().u8(0x3B).u16(i).u16(0).u16(sh.rows.length - 1).u16(0).u16(sh.widths.length - 1);  // PtgArea3d
      rec(g, 0x0018, new Buf().u16(0x0021).u8(0).u8(1).u16(fm.length).u16(0).u16(i + 1).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0x0D).bytes(fm.a));
    });
    // SST（字符串在记录边界处换 CONTINUE，字符串本身不拆）+ EXTSST
    const isst = [];          // 每 8 个字符串记一次位置
    let cur = new Buf().u32(sstTotal).u32(sst.length), recType = 0x00FC, recStart = g.length;
    const flush = () => { rec(g, recType, cur); };
    sst.forEach((s, i) => {
      const b = longStr(s);
      if (cur.length + b.length > 8224) { flush(); recType = 0x003C; cur = new Buf(); recStart = g.length; }
      if (i % 8 === 0) isst.push([recStart + 4 + cur.length, 4 + cur.length]);
      cur.bytes(b.a);
    });
    flush();
    const ex = new Buf().u16(8); isst.forEach(([ib, cb]) => ex.u32(ib).u16(cb).u16(0)); rec(g, 0x00FF, ex);
    rec(g, 0x000A, new Buf());

    // ---------- 拼起来，回填各表位置 ----------
    let off = g.length;
    sheetStreams.forEach((s, i) => { const p = bsPos[i]; g.a[p] = off & 255; g.a[p + 1] = (off >>> 8) & 255; g.a[p + 2] = (off >>> 16) & 255; g.a[p + 3] = (off >>> 24) & 255; off += s.length; });
    let all = g.a; sheetStreams.forEach(s => { all = all.concat(s.a); });
    while (all.length < 4096) all.push(0);   // 小于 4096 字节会进迷你流，老版 Excel 不认

    const cfb = CFB.utils.cfb_new();
    CFB.utils.cfb_add(cfb, 'Workbook', new Uint8Array(all));
    return CFB.write(cfb, { type: 'array' });
  }

  const api = { write };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XLS = api;
})(this);
