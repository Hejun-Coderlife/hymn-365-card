# 365金卡导入表

线上 **https://card.hemei.asia**（Cloudflare Worker + D1，hemei.asia 在 CF 号 584298889@qq.com 下，同会员助手 hymn-vip）。
GitHub Pages 老地址 hejun-coderlife.github.io/hymn-365-card 只剩根目录 index.html 跳转。

## 谁用
- **操作员**（用户本人也用）：电脑开 `/`（public/index.html）。粘名单 / 拖 Excel / 载入店员提交 → 导出每人一个 .xls
- **店员**：手机开 `/store`（public/store.html），填 工号 + 新开卡/续卡 + 姓名 + 手机号 + 日期，提交到云端
- 两个**共用**账号（用户选的）：op / staff，登录页选角色 + 密码。每个账号最多 5 台设备，第 6 台登录**自动挤掉最久没用的**（用户选的，不拦）
- 店员提交 → 操作员「店员提交」列表 → 载入名单（每行带自己的日期、续卡标记）→ 导出成功后自动标「已导出」，店员手机上显示「已导入」。提交只改状态不真删（pending/done/del）
- 操作员页侧栏「管理 → 账号与设备」（#view=users，仿会员助手账号表）：两账号设备 n/5 点开看列表可「移出」、行内「重置密码」（改完该账号其他设备要重登）。仓库是公开的，密码绝不能写进任何文件

## 导出规则（用户逐条定的）
- 必须 **.xls**（导入系统只收 xls）。自写 BIFF8 生成器 `public/xls.js`：标题浅灰加粗 + 冻结 + 筛选，单元格类型与模板逐列一致（用户 WPS 验过）
- 每人一个文件 `365金卡[续卡]_姓名_手机号_日期.xls`；导出方式三选一：生成文件夹（Chrome/Edge，位置存 IndexedDB）/ zip / 散放
- 每人 42 行：洗脸巾2 ×12（从起算月 1 号起按自然月）+ 代金券 ×30（起算日 → 一年后同日）；页「3次护理导入」每人一行；「月份」「开卡或续卡」页不要
- 券号 = 365 + 起算年份 2 位 + 手机号 + 01~42（多电脑不撞号）
- 起算日：新开卡 = 开卡日期；续卡 = 续卡从哪天算（默认下月 1 号）；名单每行可写自己的日期 / 「续卡」覆盖统一设置
- 名单模板带「示例」行，导入时以「示例」开头的行自动跳过

## 开发 / 部署
- `npm run dev`（端口 8791）；本地库 `npx wrangler d1 execute hymn-365-card --local --file=schema.sql`，账号 `node tools/seed.js 操作员密码 店员密码` 出 SQL
- `npm run deploy`：先跑 bump.sh 给 html 里脚本换 `?v=`（出过缓存新旧混用导致点导出没反应），再带代理 deploy
- wrangler 全部要带代理 `HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 NO_PROXY=localhost,127.0.0.1`；远程 SQL 用 `--command`（`--file` 经代理会失败）
- 线上测试别用真账号登录真设备以外的浏览器太多次（会占设备名额）；测完 SQL 清 subs/devices/sessions
- 视觉照抖音看板：白底发丝线、直角、Didot 只给数字、粉只给要注意的量
- 所有网页刷新不丢（localStorage）；Excel 导出一律浅灰表头+冻结+筛选（用户全局要求）
