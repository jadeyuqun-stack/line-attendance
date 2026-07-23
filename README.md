# LINE 打卡系統

基於 LINE Messaging API 的 GPS 打卡系統，支援請假/加班/補打卡簽核、薪資發送、每日報表。

## 功能總覽

### 📍 GPS 打卡
- **上班打卡**：傳送位置訊息或點選「📍 上班打卡」→ 自動記錄 GPS 座標
- **下班打卡**：傳送位置訊息或點選「📍 下班打卡」→ 計算當日工時
- **卡控規則**：
  - 當天已有上班打卡 → 顯示「⚠️ 今天已上班打卡」
  - 未上班先打下班 → 顯示「⚠️ 尚未上班打卡」
  - 已下班再打下班 → 顯示「⚠️ 今天已下班打卡」
  - 上下班打卡均完成 → 顯示「今日已完成打卡」
- **遲到判斷**：上班時間（預設 8:00）+ 緩衝（30 分鐘）後打卡 → 標示遲到及分鐘數
- **GPS 範圍**：可設定公司座標與允許範圍（預設 200m），超出範圍會顯示警告（仍可打卡）

### 📋 查詢
- 點選「📋 查詢」或輸入「查詢」
- 顯示：
  - 今日上班/下班時間與位置
  - 當日工時（不足 8 小時標示警告）
  - 本月/累計請假時數（已核准）
  - 待審核筆數

### 🏖 請假申請
- **流程**：選擇假別 → 選開始日期時間 → 選結束日期時間 → 輸入原因
- **假別**：特休、事假、病假、公假、外出、其他
- **卡控規則**：
  - 結束時間必須 ≥ 開始時間（在選完結束時間後立即檢查）
- **時數計算**：跨天每日最多 8 小時，午休 12:00-13:00 自動扣除 1 小時
- **簽核流程**：最多三階簽核（L1 → L2 → L3），每階通過後自動通知下一階簽核人
  - 全數通過 → 通知申請人「已核准」
  - 任一駁回 → 通知申請人「被駁回」

### 🕐 加班申請
- **流程**：選開始日期時間 → 選結束日期時間 → 輸入原因
- **時間限制**：僅允許 **17:30 ~ 23:00**（在選完結束時間後立即檢查）
- **簽核流程**：同請假，最多三階簽核

### 📝 補打卡
- **流程**：選補上班/補下班 → 選日期時間 → 輸入原因
- **卡控規則**（選完日期時間後立即檢查）：
  - ❌ 不能補打卡未來時間
  - ❌ 只能補打 3 天內的卡
  - ❌ 當天已有上班打卡記錄 → 不能補上班卡
  - ❌ 當天已有下班打卡記錄 → 不能補下班卡
- **核准後**：自動寫入打卡記錄（等同當天有打卡）

### ✅ 批次核准
- **LINE 操作**：有簽核權限者下方選單顯示「✅ 核准全部」「❌ 駁回全部」
- **後台操作**：請假管理 / 加班管理頁面提供批次核准按鈕
- **規則**：只處理待審核（pending）且申請人簽核鏈中有自己的單

---

## 後台管理面板

| 頁面 | 功能 |
|------|------|
| 📊 儀表板 | 今日打卡人數統計、出勤概況 |
| 📋 打卡記錄 | 篩選（日期/月份/員工）、考勤狀態、遲到統計、清除記錄 |
| 👥 員工管理 | 新增/編輯/離職/永久刪除、LINE 綁定、L1/L2/L3 簽核人設定 |
| 🏖 請假管理 | 篩選（員工/狀態/月份）、手動核准/駁回、批次核准、清除記錄 |
| 🕐 加班管理 | 篩選（員工/狀態/月份）、手動核准/駁回、批次核准、清除記錄 |
| 📝 補打卡 | 待審核/已核准列表、手動核准/駁回 |
| 💵 薪資發送 | 文字+圖片薪資單、儲存草稿、排程發送、預覽 |
| ⚙️ 系統設定 | 上下班時間、公司座標、GPS 範圍、日報設定 |

### 考勤判斷邏輯（打卡記錄頁面）
| 狀態 | 條件 |
|------|------|
| ✅ 出勤 | 有上班打卡且未遲到 |
| ⚠️ 遲到 | 上班打卡超過 `上班時間 + 緩衝分鐘` |
| 🏖 請假 | 當天無上班打卡，有核准的請假 |
| 📝 已補卡 | 當天無上班打卡，有核准的補打卡 |
| ❌ 曠職 | 當天無上班打卡、無請假、無補打卡 |

---

## LINE 操作指令

| 輸入 | 功能 |
|------|------|
| `上班` / `下班` | 文字打卡（無 GPS） |
| 📍 傳送位置訊息 | GPS 打卡 |
| `查詢` / `記錄` | 查詢今日打卡與請假 |
| `請假` | 啟動請假申請流程 |
| `加班` | 啟動加班申請流程 |
| `補打卡` | 啟動補打卡申請流程 |
| `核准全部` / `駁回全部` | 批次處理（需簽核權限） |
| `我的ID` | 顯示 LINE User ID（綁定用） |
| `取消` | 取消當前操作流程 |

---

## 每日報表

- 定時推播當日出勤報告到 LINE 群組
- 包含：總人數、已上班/下班人數、未打卡人數、遲到名單
- 可設定：推播時間、推播日（星期幾）、啟用/停用
- 將 Bot 加入群組後自動記錄群組 ID

---

## 技術架構

| 層 | 技術 |
|----|------|
| 後端 | Node.js + Express |
| 資料庫 | PostgreSQL（Supabase） |
| LINE SDK | @line/bot-sdk v9 |
| 部署 | Render（免費方案） |
| 訊息格式 | Flex Message + Quick Reply + Rich Menu |
| 圖片 | Rich Menu PNG 2500×843（程式生成） |

---

## 環境變數

| Key | 說明 |
|-----|------|
| `LINE_CHANNEL_SECRET` | LINE Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Access Token |
| `DATABASE_URL` | Supabase PostgreSQL 連線字串 |
| `ADMIN_USERNAME` | 後台帳號 |
| `ADMIN_PASSWORD` | 後台密碼 |
| `SESSION_SECRET` | Session 加密金鑰 |
| `COMPANY_NAME` | 公司名稱 |
| `WORK_START_HOUR` | 上班時間（小時，預設 8） |
| `WORK_END_HOUR` | 下班時間（小時，預設 17） |
| `LATE_BUFFER_MINUTES` | 遲到緩衝分鐘（預設 30） |

---

## 部署步驟（Render 免費方案）

### 費用：$0（永久免費）

| 服務 | 用途 | 費用 |
|------|------|------|
| Render | 託管 Node.js 後端 | 免費 750hr/月 |
| Supabase | PostgreSQL 資料庫 | 免費 500MB |
| LINE | Bot API | 免費 |

### 第 1 步：建立 GitHub 專案

1. 打開 https://github.com → 註冊/登入
2. 右上角 **＋ → New repository** → 名稱 `line-attendance` → Private
3. **不要**勾選任何初始化選項 → Create repository

```bash
cd /path/to/line-attendance-render
git init
git add .
git commit -m "初始版本"
git remote add origin https://github.com/YOUR_USERNAME/line-attendance.git
git branch -M main
git push -u origin main
```

### 第 2 步：建立 Supabase 資料庫

1. 打開 https://supabase.com → 登入 → New project
2. Name：`attendance-db`，設定密碼（記下來）
3. Region：`Northeast Asia (Tokyo)` 或 `Singapore`
4. 建立後 → Project Settings → Database → 複製 Connection string (URI)
5. 把 `[YOUR-PASSWORD]` 換成你的密碼 → 這就是 `DATABASE_URL`

### 第 3 步：在 Render 部署

1. 打開 https://render.com → 用 GitHub 登入
2. **New + → Web Service** → 選擇 `line-attendance` repo

| 欄位 | 值 |
|------|-----|
| Name | `line-attendance` |
| Region | `Singapore` |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node src/server.js` |
| Instance Type | **Free** |

3. Environment Variables 填入上方所有環境變數
4. 點 **Deploy Web Service**，等 3-5 分鐘

### 第 4 步：設定 LINE Webhook

1. Render Dashboard → 複製 URL（`https://line-attendance.onrender.com`）
2. LINE Developers Console → Webhook URL：`https://你的app.onrender.com/webhook`
3. 點 **Verify** → ✅ Success

### 第 5 步：設定 Rich Menu

1. 瀏覽器開啟 `https://你的app.onrender.com/admin/setup-richmenu`
2. 看到 `{"success":true}` → LINE 下方固定選單已建立
3. 強制關閉 LINE App 再重開即可看到

---

## 重要提醒

### Render 免費方案
- 閒置 15 分鐘會休眠，第一次請求需等 30-60 秒
- 每月 750 小時，一個服務剛好

### Supabase 免費方案
- 500MB 儲存空間，50 人以下綽綽有餘

### 時區
- 系統自動使用 **台北時區（Asia/Taipei）**
- 資料庫連線與 Node.js 皆已設定
