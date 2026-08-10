# LINE 打卡系統 — 專案總覽

## 專案定位
玉群環境科技考勤系統，基於 LINE Messaging API 的 GPS 打卡系統，約 50 人使用。含考勤、簽核、津貼、薪資發送、Excel 匯出。

## 技術棧
- **後端**: Node.js + Express（純 JS，無 TypeScript）
- **資料庫**: PostgreSQL（Supabase 免費 500MB）
- **LINE SDK**: @line/bot-sdk v9
- **部署**: Render 免費方案（Singapore 區）
- **套件**: pg, express-session, multer, xlsx, exceljs, canvas, dotenv
- **Node 版本**: >= 20.0.0

## 檔案結構

```
src/
├── server.js       — Express 入口，webhook、/health、啟動排程、掛載 /admin 與 /emp
├── bot.js          — LINE Bot 核心（~3900 行）：打卡/請假/加班/補打卡/簽核/查詢
├── database.js     — PostgreSQL CRUD（~1300 行）：schema、查詢、簽核、津貼
├── admin.js        — 後台管理面板（~2700 行）：SSR HTML + API + 匯出
├── emp.js          — 員工端路由（/emp）：主管津貼登入 + 填寫/匯總/項目定義
├── excel.js        — 統一匯出樣式 helper（exceljs：標題/置中/邊框/高亮）
├── salary-img.js   — 薪資 Excel 解析 + 個人薪資單 PNG 渲染（上傳產圖用）
├── report.js       — 每日出勤報表：Keep-Alive + setTimeout + 事件驅動
└── scripts/
    └── gen-salary-preview.js — 批次產生薪資預覽圖（讀 Salary sample.xlsx + /tmp/latest-backup.json）
.github/
├── workflows/backup.yml   — GitHub Actions 每日自動備份（台灣凌晨 2:00）
└── scripts/backup.js      — 連 Supabase 匯出 latest-backup.json 推至 backups 分支
```

## 程式碼風格
- **必須用 `var`**（不用 `let`/`const`，除非是 `require`）
- **縮排用 tab**
- **字串用單引號**（偏好），SQL 內用雙引號
- **不用箭頭函數**，用 `function` 關鍵字
- **不用 `**` 運算子**，用 `Math.pow()`
- **PostgreSQL**: `TIMESTAMPTZ` 存時間，`TEXT` 存日期字串
- **時區**: `process.env.TZ = 'Asia/Taipei'` + pool `SET timezone TO 'Asia/Taipei'`
- 瀏覽器端 JS 常以單引號字串包在 `+ '...'` 串接；字串內要放 HTML 屬性引號需用 `\\"`（執行期變 `\"`）。**改動這類內嵌 JS 後務必組裝驗證**（見下方「內嵌 JS 驗證」）

## 職稱系統（取代舊角色，2026-08 更新）

**職稱下拉（後台員工管理）**：採樣工程師 / 分析工程師 / 行政人員 / 業務專員 / 副理 / 副主任 / 主任 / 經理 / 董事長
- 舊角色對應：老闆/boss → 董事長；員工/簽核人員 → 依部門（採樣→採樣工程師、分析→分析工程師、業務→業務專員、管理→行政人員）
- 員工管理頁職稱欄點擊 → **下拉 modal 編輯**（editRole/saveRole）

**層級權限**（bot.js/database.js/emp.js 檢查需對上）：
- **董事長**（= 舊老闆）：不需打卡、排除考勤/日報、4 格 Rich Menu
- **副理/副主任**：簽核主管權限（待簽核、核准、8 格選單、主管津貼登入）
- **主任/經理/簽核人員**：既有主管權限
- 一般工程師/行政/業務：6 格選單

## 核心功能與卡控

### GPS 打卡
- 上班/下班 Quick Reply 位置或 Rich Menu；卡控：今日已打卡/未上班先下班/已下班重打
- 遲到：上班時間 + 緩衝分鐘後；GPS：Haversine 超範圍警告不阻擋
- 檔案：`bot.js` — `doCheckIn()`, `doCheckOut()`, `handleLocation()`

### 請假
- 流程：假別 → 開始 → 結束 → **先驗證** → 原因；簽核最多三階
- 時數：逐日跳週末/假日、每日上限 8h、扣午休
- 檔案：`bot.js` — `startLeaveFlow()`, `leaveHours()`

### 加班 / 補打卡
- 加班：17:30~23:00 驗證；補打卡：不可未來、限 3 天內、當天無同類
- 檔案：`bot.js` — `startOvertimeFlow()`, `startMissedPunch()`

### 簽核（統一層級敏感）
- 統一判斷：`bot.js` 的 `isMyTurnToApprove()`（請假/加班）、`isMyTurnMissedPunch()`（補打卡）
- **只認當階指定簽核人**（L1/L2）；`can_approve` 僅額外可簽「員工無任何指定簽核人」的項目
- 五處一致：待簽核查詢、逾期提醒、計數、批次核准（`canBatch` 層級敏感）、postback 預檢查
- 後台 API 以 `approvedBy = null` 代表管理員操作跳過權限
- 核准/駁回寫入 `pending_notifications`，bot 下次互動推送

### 每日報表
- UptimeRobot ping + setTimeout + webhook 事件驅動；請假名單含起訖時間、中文假別
- 檔案：`report.js`

### Excel 匯出（全用 excel.js，樣式統一）
- 所有匯出（checkins/leaves/overtime/summary/all/monthly）透過 `src/excel.js`（exceljs）
- 樣式：標題列（篩選範圍）、深藍表頭 FF2F5496 白粗體、細灰邊框 B7B7B7、資料置中、自動篩選
- **highlightPositive**：月結彙總/假期餘額中 >0 的數字亮黃底+粗體+深紅字
- 匯出路由：`/admin/export/checkins|leaves|overtime|summary|monthly|all`

### 月結彙總（/admin/export/monthly）
- **21 欄逐人彙總**（2026-08 移除「請假天數(整日)」）：員工編號,姓名,部門,出勤天數,請假時數合計,特休,事假,病假,補休,公假,婚假/陪產假,喪假,考勤異常次數,考勤異常分鐘合計,考勤異常請假時數,曠職天數,未下班次數,加班總時數,加班2小時內,加班超2小時,津貼
- `buildMonthlySummary()` 共用；/export/all 含此 sheet（共 6 sheet：出勤彙總/打卡紀錄/請假紀錄/加班紀錄/月結彙總/假期餘額）
- **假期餘額 sheet**：`buildLeaveBalanceData()` 每人特休/婚假/喪假/補休/年度事假病假
- 注意：請假與匯出範圍無重疊要跳過（避免 clamp 起訖顛倒回傳 0.5h）；只計 approved

### 津貼系統（2026-08 新增）
**資料表**：
- `allowance_items` — 津貼項目（name, amount, active），全公司共用
- `allowances` — 津貼記錄（employee_id, **work_date** 每日粒度, month_label, item_id, amount, note），UNIQUE(employee_id, work_date, item_id)

**後台**：`/admin/allowances` — 項目 CRUD + 各部門填寫狀況；員工管理可設密碼（🔑）

**員工端** `/emp/*`（src/emp.js，主管登入）：
- `/emp/login`：員工編號+密碼（角色須主任/副主任/副理/經理/簽核人員）
- `/emp/allowances`：津貼輸入（選員工 → 每日 5 下拉＋2 預留空位、金額自動帶入、日薪小計×工作天數、每日/當月自動加總；「🔥高溫津貼一次全選」偵測名稱含「高溫」項目）
- `/emp/allowance-summary`：每人當月累計津貼
- `/emp/allowance-items`：津貼項目定義（主管可維護）
- 權限防護：POST 端以 session 部門驗證 employee_id

### 薪資發送（2026-08 改版，/admin/salary）
- **上傳 Excel** → 自動為每位已綁定員工產生薪資單圖片
- 月份：**年份/月份分開下拉**（可選未來月份）；圖片標題/結算區間隨月份、發放日=當天
- 職稱取員工管理目前設定；特休取系統餘額（含手動補登）
- 支援：單筆預覽/單筆發送、勾選批量、**預約發送**（setTimeout，頁面需保持開啟）
- 路由：`/admin/salary/upload-excel|send-one|send-all|clear`；圖片 `/salary/img/:id`
- 模組：`src/salary-img.js`（parseSalaryWorkbook + renderSalaryImage）
- **字型註冊須跨平台**（Render Linux 無 macOS 字型）：候選清單 + try/catch
- **LINE 圖片 URL 必須 HTTPS**：`process.env.APP_URL` 或 `https://`+`RENDER_EXTERNAL_HOSTNAME`
- 圖片路由 no-cache + 縮圖 cache-buster（避免重新上傳顯示舊月份）

### 薪資預覽圖腳本（scripts/gen-salary-preview.js）
- 讀 Salary sample XX.xlsx + `/tmp/latest-backup.json`（先 `git fetch origin backups` 取得最新備份）
- 職稱自動對應、特休含手動補登、可指定單一員工或全員
- 版面：公司名大字 + 月份、工號/姓名/部門/到職日/發放日/結算區間、三欄表格（應付/應扣/不計入(匯入勞退專用帳戶)）、匯付所得(A-B-日薪減扣款)＋現金行、假期資訊、個人備註

### 資料庫備份還原
- 後台手動 `/admin/backup`（含 allowance_items/allowances/password_hash）；自動 GitHub Actions 每日推 backups 分支
- **取得最新員工資料**：`git fetch origin backups` → `git show origin/backups:latest-backup.json`

## 後台頁面

| 路由 | 功能 |
|------|------|
| `/admin` | 儀表板 + 特休更新（含滿半年偵測） |
| `/admin/records` | 打卡記錄 — 日/月模式（月模式=逐日明細表） |
| `/admin/employees` | 員工管理 — 職稱下拉編輯 + LINE 綁定 + 密碼 + L1/L2/L3 |
| `/admin/leave-balances` | 假期設定 — 額度編輯 + 全部補休歸零 |
| `/admin/leaves` / `/admin/overtime` | 請假/加班管理 — 核決 + 批次 + 匯出 |
| `/admin/missed` | 補打卡 |
| `/admin/allowances` | 津貼項目 + 填寫狀況 |
| `/admin/salary` | 薪資發送 — 上傳 Excel 產圖 + 單筆/批量/預約 |
| `/admin/settings` | 系統設定 |
| `/admin/backup` | 備份還原 |
| `/admin/data` | 資料彙整 — 月結彙總 + 全部匯出卡片 |

## 資料庫關鍵表

- `employees` — 含 approver_id/2/3, can_approve, hire_date, role, **password_hash**, 特休/婚假/喪假/補休額度, annual_leave_used_manual, annual_leave_manual_reset_period
- `checkins`, `leave_requests`, `overtime_requests`, `missed_punch`, `settings`, `salary_records`, `pending_notifications`
- `allowance_items`, `allowances`（津貼）

## 注意事項

### Render 免費方案
- 15 分鐘閒置休眠 → UptimeRobot ping /health；冷啟動 30-60 秒
- setTimeout 排程（日報/薪資預約）需頁面或事件保持伺服器清醒

### 時區 / LINE 訊息
- 全台北時區；Flex Message color 必須 `#rrggbb`；Quick Reply ≤13 items

### 內嵌 JS 驗證（重要）
- admin.js/emp.js 大量前端 JS 是包在 `+ '...'` 字串裡。改動後**必須組裝驗證**：
  1. `node -c src/admin.js`（檔案語法）
  2. 抽出該字串組裝後 `new Function(...)` 驗證瀏覽器端可解析（若 JS 有誤會導致整頁功能失效，如 editRole 未定義）
- 已知坑：`+ '...'` 字串內若要輸出 HTML 屬性 `"`，檔案內需寫 `\\"`；行尾 `';` 會提前結束 return 串接（勿加）

### 特休計算
- `getAnnualLeaveBalance` = 額度（曆年制 calculateAnnualLeaveEntitlement，滿半年/週年）× 8h − 已核准特休時數 − **手動補登（annual_leave_used_manual）**
- 儀表板特休更新偵測：入職週年 + 滿半年（入職日+6個月比較，避免月底溢位）

## Edit 工具注意
- 檔案使用 tab 縮排，Edit 需精確匹配 tab
- 複雜多行替換建議用 Python 腳本處理
