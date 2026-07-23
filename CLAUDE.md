# LINE 打卡系統 — 專案總覽

## 專案定位
玉群環境科技考勤系統，基於 LINE Messaging API 的 GPS 打卡系統，約 50 人使用。

## 技術棧
- **後端**: Node.js + Express（純 JS，無 TypeScript）
- **資料庫**: PostgreSQL（Supabase 免費 500MB）
- **LINE SDK**: @line/bot-sdk v9
- **部署**: Render 免費方案（Singapore 區）
- **套件**: pg, express-session, multer, xlsx, dotenv
- **Node 版本**: >= 20.0.0

## 檔案結構

```
src/
├── server.js    — Express 入口，webhook、/health、啟動排程
├── bot.js       — LINE Bot 核心邏輯（~750 行）：打卡/請假/加班/補打卡/簽核
├── database.js  — PostgreSQL CRUD（~520 行）：schema、查詢、簽核流程
├── admin.js     — 後台管理面板（~1040 行）：SSR HTML + API 路由
└── report.js    — 每日出勤報表（~200 行）：Keep-Alive + setTimeout + 事件驅動
.github/
├── workflows/backup.yml   — GitHub Actions 每日自動備份（台灣凌晨 2:00）
└── scripts/backup.js      — 備份腳本（連 Supabase 匯出 JSON）
```

## 程式碼風格
- **必須用 `var`**（不用 `let`/`const`，除非是 `require`）
- **縮排用 tab**
- **字串用單引號**（偏好），SQL 內用雙引號
- **不用箭頭函數**，用 `function` 關鍵字
- **不用 `**` 運算子**，用 `Math.pow()`
- **函數宣告** `function foo() {}` 而非 `const foo = function() {}`
- **PostgreSQL**: `TIMESTAMPTZ` 存時間，`TEXT` 存日期字串（靈活處理 datetime）
- **時區**: `process.env.TZ = 'Asia/Taipei'` + pool `SET timezone TO 'Asia/Taipei'`

## 核心功能與卡控

### GPS 打卡
- 上班/下班透過 Quick Reply 位置按鈕或 Rich Menu 文字指令
- 卡控：今日已打卡 → 阻擋、未上班先打下班 → 阻擋
- 遲到判斷：上班時間 + 緩衝分鐘後算遲到
- GPS 範圍檢查：Haversine 公式，超出範圍標示警告但不阻擋
- 檔案：`bot.js` — `doCheckIn()`, `doCheckOut()`, `handleLocation()`

### 請假
- 流程：選假別 → 選開始日期時間 → 選結束日期時間 → **先驗證** → 輸入原因
- 驗證：結束 ≥ 開始、不可與已打卡日期重疊、開始日不可早於入職日
- 時數：逐日計算，跳週末/國定假日，每日最多 8h，午休 12:00-13:00 依比例扣
- 非末日 dayEnd = `max(17:00, e.getHours():e.getMinutes())`（跟隨請假結束時間）
- 簽核：最多三階（L1→L2→L3），每階通過通知下一階
- 檔案：`bot.js` — `startLeaveFlow()`, `leaveHours()`, postback `leave_start`/`leave_end`

### 加班
- 流程：選開始 → 選結束 → **先驗證 17:30~23:00** → 輸入原因
- 簽核：同請假三階
- 檔案：`bot.js` — `startOvertimeFlow()`, postback `ot_start`/`ot_end`

### 補打卡
- 流程：選類型 → 選日期時間 → **先驗證** → 輸入原因
- 驗證：不可未來時間、限 3 天內、當天不可有同類型打卡
- 核准後自動寫入 checkins 表
- 檔案：`bot.js` — `startMissedPunch()`, postback `missed_dt`

### 批次核准
- LINE：有簽核權限者選單多「核准全部」「駁回全部」
- 後台：請假/加班管理頁面有批次按鈕
- `canBatch` 邏輯：只認 L1/L2 指定人 + can_approve 全體簽核
- 檔案：`bot.js` — `batchApproveAll()`, `batchRejectAll()`

### 每日報表
- 策略：UptimeRobot 每 5 分鐘 ping /health 防休眠 + setTimeout 定時 + webhook 事件驅動
- 發送前檢查：啟用、推播日、時間已到、同日不重複（可設定開關）
- 內容：總人數、已上班/下班、請假中、未打卡、遲到名單、請假名單、未打卡名單
- 檔案：`report.js` — `trySendReport()`, `doSendReport()`, `startKeepAlive()`

### Excel 匯出
- 打卡記錄（含補打卡）、請假記錄（含時數）、加班記錄（含時數）
- **出勤彙總**：每人每天工時（含午休扣除）、是否 <9h、遲到/曠職/請假狀態
- 可選日期範圍，支援 `start`/`end` 或 `month` 參數
- 檔案：`admin.js` — `/admin/export/checkins|leaves|overtime|summary`

### 薪資發送
- 後台輸入文字 + 上傳圖片，儲存草稿，選擇日期時間發送
- 透過 LINE pushMessage 送給已綁定員工
- 檔案：`admin.js` — `/admin/salary`

### 資料庫備份還原
- **後台手動**：`/admin/backup` — 下載備份 JSON（8 張表完整匯出）+ 上傳還原
- **自動備份**：GitHub Actions 每日台灣時間凌晨 2:00 執行
  - 連線 Supabase 匯出 `latest-backup.json`（格式與後台 export 一致）
  - 推到 `backups` 分支強制覆蓋，永遠只留最新一份
  - 還原：GitHub → backups 分支 → 下載 → 後台上傳還原
  - 檔案：`.github/workflows/backup.yml` + `.github/scripts/backup.js`
  - GitHub Secret：`SUPABASE_DATABASE_URL`（Session pooler port 5432）

## 後台頁面

| 路由 | 功能 |
|------|------|
| `/admin` | 儀表板 — 5 格統計 + 出勤率 + 今日請假 + 最近打卡 |
| `/admin/records` | 打卡記錄 — 篩選(日期/月份/員工) + 考勤狀態 + 遲到統計 + 清除 + 匯出 + 彙總 |
| `/admin/employees` | 員工管理 — 新增/編輯/離職/刪除 + LINE 綁定 + L1/L2/L3 簽核人 |
| `/admin/leaves` | 請假管理 — 篩選 + 個人時數 + 核決 + 批次 + 單筆刪除 + 匯出（顯示核准人） |
| `/admin/overtime` | 加班管理 — 篩選 + 核決 + 批次 + 單筆刪除 + 匯出（顯示核准人） |
| `/admin/missed` | 補打卡 — 待審核/已核准 + 手動核決（顯示核准人） |
| `/admin/salary` | 薪資發送 — 文字+圖片 + 儲存/排程/發送 |
| `/admin/settings` | 系統設定 — 上下班時間 + GPS + 日報(啟用/時間/推播日/不重複) |
| `/admin/backup` | 備份還原 — 下載 JSON 備份 + 上傳還原（含預覽） |
| `/admin/data` | 資料彙整 — Excel 匯出 + 清除舊資料 |

## 資料庫關鍵表

- `employees` — approver_id, approver2_id, approver3_id, can_approve, hire_date
- `checkins` — employee_id, type, check_time (TIMESTAMPTZ), latitude, longitude, address, in_range
- `leave_requests` — start_date/end_date (TEXT), leave_type, approval_level, status, approved_by
- `overtime_requests` — start_time/end_time (TEXT), approval_level, status, approved_by
- `missed_punch` — punch_date/punch_time (TEXT), punch_type, status, approved_by
- `settings` — key/value (啟用/時間/GPS/日報設定)
- `salary_records` — employee_id, content, has_image, month_label
- `pending_notifications` — 待發送 LINE 通知（核准/駁回時寫入，bot 處理時清除）

## 注意事項

### Render 免費方案
- 15 分鐘閒置休眠 → UptimeRobot 每 5 分鐘 ping /health 對抗
- 休眠期間 setTimeout 失效 → 事件驅動 trySendReport 補救
- 冷啟動 30-60 秒

### 時區
- DB session: `SET timezone TO 'Asia/Taipei'`（pool on connect）
- Node.js: `process.env.TZ = 'Asia/Taipei'`
- `CURRENT_DATE` 和 `check_time::date` 都基於台北時間

### LINE 訊息
- Flex Message color 必須用 `#rrggbb`（6 碼），`#666` 會 400 錯誤
- Quick Reply 最多 13 個 items
- Rich Menu 2500×843 PNG（程式生成）
- chatBarText: "玉群考勤系統功能選單"

### 簽核邏輯
- 三階簽核：`approver_id`(L1) → `approver2_id`(L2) → `approver3_id`(L3)
- `updateLeaveStatus`/`updateOvertimeStatus` 回傳 `{ advanced, level, approvers }`
- **LINE 端簽核**：必須是該階指定簽核人（L1/L2），或具有 `can_approve` 全體簽核權限
- **若該階無指定簽核人**：LINE 端不可簽核，僅後台管理員可簽（`approvedBy = null`）
- **不可跨部門**：只看 L1/L2 指定關係，不看 department 欄位
- `can_approve` 為全體簽核權限，可跳過指定簽核人檢查
- 後台單筆/批次 API 以 `approvedBy = null` 代表管理員操作，跳過權限檢查
- 核准/駁回時寫入 `pending_notifications` 表，bot 下次處理訊息時推送通知

### 請假時數計算
- 四處需同步：`bot.js leaveHours()`、`admin.js calcLeaveHours()`、`admin.js exportLeaveHours()`、`database.js calcPeriodHours()`
- 逐日迭代，跳過週六(6)週日(0)及國定假日
- 午休 12:00-13:00 依實際重疊比例扣除（round to 0.5h）
- 每日上限 8h
- **非末日 dayEnd**：取 `max(17:00, 請假結束時間)`，確保末日時間一致套用到前幾日
- 首日 dayStart = 實際開始時間，非首日 dayStart = max(8:00, current)

### 角色系統
- 五種角色：`員工`（一般員工）、`簽核人員`、`主任`、`經理`、`老闆`
- 老闆不打卡、不列入考勤統計與日報
- `listAttendanceEmployees()` 排除老闆，用於打卡/報表/統計
- **主任**：可查詢部門為「採樣」或「分析」的員工考勤（`getDirectorDepartmentEmployeeIds()`）
- **簽核人員**：只能查詢自己簽核的員工（L1/L2/L3）+ 只能簽自己指定的員工
- Rich Menu：一般員工 6 格（3×2），經理/老闆/簽核人員/主任 8 格（4×2），老闆另有多一組 4 格選單
- `getDesignatedEmployeeIds(approverId)` — 查詢該簽核人員負責的員工清單
- 核准/駁回按鈕僅簽核人員/經理角色可見
- 後台員工管理角色下拉選單：一般員工 / 簽核人員 / 經理 / 主任 / 老闆

### Rich Menu 三版本
- `setupRichMenu()` 同時建立 6 格（預設）、8 格（主管）、4 格（老闆）三組 Rich Menu
- `assignRichMenu(uid, role)` 在 follow 事件或綁定時為主管/主任角色連結 8 格選單，老闆連結 4 格選單
- 一般員工使用預設 6 格選單
- `makePng()` — 6 格 PNG，`makePng8()` — 8 格 PNG，`makePngBoss()` — 4 格 PNG
- `/admin/richmenu-preview` — 預覽 6 格，8 格加 `?type=8`，老闆加 `?type=boss`
- `/admin/setup-richmenu` — 重建 Rich Menu，`?check=1` 診斷狀態

### Edit 工具注意
- 檔案使用 tab 縮排，Edit 需精確匹配 tab
- 複雜多行替換建議用 Python 腳本處理
