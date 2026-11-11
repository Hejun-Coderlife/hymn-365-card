/* 365 金卡导入表生成逻辑（浏览器和 node 测试共用）
   模板：~/Desktop/365金卡生成模板.xls
   每人 42 行代金券：
     12 行「365金卡洗脸巾2」：从开卡当月 1 号起按自然月推，每张 1 号到月底（mode='calendar'）
                             或从开卡日起每满一个月一段（mode='rolling'）
     30 行「365金卡代金券」：开卡当天 → 一年后同一天
   券号 = 365 + 开卡年份后 2 位 + 手机号 + 序号 01~42（共 18 位），如 365 26 18968256111 01。
     2026-11-11 用户选的：网页会给多人在不同电脑上用，不联网也要保证不撞号；
     原来的 365001 连号只够 23 人，而且各电脑各编各的必撞。
     只有「同一手机号同一年开两次卡」会撞。
   「月份」页是旧的辅助表，已删；「开卡或续卡」页（模板里是空的）2026-11-11 用户说不要，也删了。 */
(function (root) {
  const WASH = 12, CASH = 30;

  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  // 加 n 个月，日子超出就落到月底（1/31 + 1 月 = 2/28）
  function addMonths(d, n) {
    const y = d.getFullYear(), m = d.getMonth() + n;
    const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
    return new Date(ty, tm, Math.min(d.getDate(), daysIn(ty, tm)));
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  // Excel 日期序列号（1900 体系）
  const serial = d => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5);

  function washPeriods(start, mode) {
    const out = [];
    for (let i = 0; i < WASH; i++) {
      if (mode === 'rolling') {
        out.push([addMonths(start, i), addDays(addMonths(start, i + 1), -1)]);
      } else {
        const s = new Date(start.getFullYear(), start.getMonth() + i, 1);   // 第 1 张也从当月 1 号算（2026-11-11 用户纠正：11 号开卡也是 11/1 开始）
        out.push([s, new Date(s.getFullYear(), s.getMonth() + 1, 0)]);
      }
    }
    return out;
  }

  const voucherNo = (date, phone, k) => '365' + String(date.getFullYear()).slice(-2) + phone + pad(k);

  // people: [{name, phone}]；返回每行的纯数据，预览和导出都用它
  function buildRows(people, opt) {
    const start = opt.date, end = addMonths(start, 12);
    const rows = [];
    const wash = washPeriods(start, opt.mode);
    for (const p of people) {
      let k = 1;
      const no = () => voucherNo(start, p.phone, k++);
      for (let i = 0; i < WASH; i++) {
        rows.push({ who: p, act: '365金卡洗脸巾2', no: no(), val: 15, obj: '分类一', objNo: '14',
          phone: p.phone, s: wash[i][0], e: wash[i][1], rule: '零售价', scene: '仅线下使用', min: 15 });
      }
      for (let i = 0; i < CASH; i++) {
        rows.push({ who: p, act: '365金卡代金券', no: no(), val: 10, obj: '', objNo: '',
          phone: p.phone, s: start, e: end, rule: '实收价', scene: '通用', min: 200 });
      }
    }
    return rows;
  }

  // 导出 .xls（用户：必须是 xls）。样式（标题浅灰加粗 + 冻结 + 筛选）由自写的 xls.js 负责，
  // 因为 SheetJS 社区版写 xls 不带样式、ExcelJS 只能写 xlsx。返回 Uint8Array。
  function buildXls(XLSX, XLS, people, opt) {
    const rows = buildRows(people, opt);
    const d = x => ({ date: serial(x) });
    const s1 = [['活动名称', '代金券号', '券面值', '可使用对象', '可使用对象编号', '会员编号', '开始日期', '截至日期',
      '取价规则', '使用场景', '可使用门店类型', '可使用门店编号', '需购满额', '取价规则']]
      .concat(rows.map(r => [r.act, r.no, r.val, r.obj || null, r.objNo || null, Number(r.phone), d(r.s), d(r.e),
        r.rule, r.scene, null, null, r.min, r.rule]));
    const s2 = [['会员编号', '卡项编号', '项目编号', '购买金额', '数量']]
      .concat(people.map(p => [String(p.phone), '1071', '1071', 0, 3]));
    return XLS.write(XLSX.CFB, [
      { name: '代金券', widths: [18, 22, 9, 12, 15, 14, 12, 12, 10, 12, 15, 15, 10, 10], rows: s1 },
      { name: '3次护理导入', widths: [14, 10, 10, 10, 8], rows: s2 },
    ]);
  }

  // 每个顾客单独一个文件（2026-11-11 用户要求「每个人单独一个表，不要做到一起」）
  const dstr = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const safe = t => String(t).replace(/[\\/:*?"<>|]/g, '');
  function fileName(p, date) {
    return `365金卡_${p.name ? safe(p.name) + '_' : ''}${p.phone}_${dstr(date)}.xls`;
  }
  function zipName(people, date) {
    return `365金卡_${people.length}人_${dstr(date)}.zip`;
  }

  const api = { voucherNo, buildRows, buildXls, fileName, zipName, ymd, addMonths, WASH, CASH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gen = api;
})(this);
