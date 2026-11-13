#!/usr/bin/env python3
"""美得得员工表（xls）→ 换掉 staff 表的 SQL，打印到屏幕。只取 员工编号 / 员工姓名 / 所属门店，在职的。
用法：/tmp/xv/bin/python tools/staff-sql.py ~/Desktop/员工表.xls > /tmp/staff.sql   （输出别放进项目目录，仓库是公开的）"""
import sys, xlrd
sh = xlrd.open_workbook(sys.argv[1]).sheet_by_index(0)
h = [str(x).strip() for x in sh.row_values(0)]
ci, cn, cs, cz = h.index('员工编号'), h.index('员工姓名'), h.index('所属门店'), h.index('就职状态')
q = lambda s: "'" + str(s).strip().replace("'", "''") + "'"
vals = []
for r in range(1, sh.nrows):
    v = sh.row_values(r)
    no = str(v[ci]).strip()
    if no.endswith('.0'): no = no[:-2]
    if not no or str(v[cz]).strip() != '在职' or not str(v[cs]).strip(): continue
    if '临时' in str(v[cn]) or '工号' in str(v[cn]): continue   # 2026-11-13 用户：去除所有临时工号
    vals.append('(%s,%s,%s)' % (q(no), q(v[cn]), q(v[cs])))
print('DELETE FROM staff; INSERT INTO staff (no, name, store) VALUES ' + ','.join(vals) + ';')
