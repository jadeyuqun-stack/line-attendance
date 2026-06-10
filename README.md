# LINE 打卡系統 - Render 部署

## 費用：$0（永久免費）

| 服務 | 用途 | 費用 |
|------|------|------|
| Render | 託管 Node.js 後端 | 免費 750hr/月 |
| Supabase | PostgreSQL 資料庫 | 免費 500MB |
| LINE | Bot API | 免費 |

---

## 第 1 步：建立 GitHub 專案（5 分鐘）

### 1A. 註冊 GitHub
1. 打開 https://github.com
2. 用你的 Gmail 註冊帳號
3. 驗證 Email

### 1B. 建立 Repository
1. 登入後點右上角 **＋ → New repository**
2. Repository name：`line-attendance`
3. 選 **Private**（私人）
4. **不要**勾選任何初始化選項
5. 點 **Create repository**

### 1C. 上傳程式碼

在你的 Mac 終端機執行：

```bash
cd /Users/pl2210106/Documents/Claude/line-attendance-render

# 初始化 git
git init
git add .
git commit -m "初始版本"

# 推到 GitHub（把 YOUR_USERNAME 換成你的 GitHub 帳號）
git remote add origin https://github.com/YOUR_USERNAME/line-attendance.git
git branch -M main
git push -u origin main
```

> 會跳出 GitHub 登入 → 用你的帳密或 token 登入

---

## 第 2 步：建立 Supabase 資料庫（5 分鐘）

1. 打開 https://supabase.com
2. 點 **Start your project** → 用 GitHub 帳號登入
3. 點 **New project**
4. 填寫：
   - Name：`attendance-db`
   - Database Password：**自己設一個密碼（記下來！）**
   - Region：選 `Northeast Asia (Tokyo)` 或 `Southeast Asia (Singapore)`
5. 點 **Create new project**（等 2 分鐘建立）
6. 建立後，左側選單 → **Project Settings → Database**
7. 找到 **Connection string** → 複製 `URI` 那行
   - 格式：`postgresql://postgres.xxxx:your_password@aws-0-ap-...:5432/postgres`
8. **把 `[YOUR-PASSWORD]` 換成你剛才設的密碼**
9. 這串就是 `DATABASE_URL`，存起來

---

## 第 3 步：在 Render 部署（5 分鐘）

### 3A. 註冊 Render
1. 打開 https://render.com
2. 點 **Get Started** → 用 GitHub 登入

### 3B. 建立 Web Service
1. 點 **New + → Web Service**
2. 選擇你剛剛建立的 `line-attendance` repo
3. 設定：

| 欄位 | 值 |
|------|-----|
| Name | `line-attendance` |
| Region | `Singapore` |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `node src/server.js` |
| Instance Type | **Free** |

4. 往下到 **Environment Variables**，新增：

| Key | Value |
|-----|-------|
| `LINE_CHANNEL_SECRET` | 你的 LINE Channel Secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | 你的 LINE Access Token |
| `DATABASE_URL` | 第 2 步複製的 Supabase URI |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | 自己設一個密碼 |
| `SESSION_SECRET` | 亂打一串英文數字 |
| `COMPANY_NAME` | 你的公司名稱 |
| `WORK_START_HOUR` | `9` |
| `WORK_END_HOUR` | `18` |
| `LATE_BUFFER_MINUTES` | `10` |

5. 點 **Deploy Web Service**
6. 等 3-5 分鐘建置（Logs 區會顯示進度）
7. 看到 `[Server] http://localhost:3000` → 部署成功！

---

## 第 4 步：設定 LINE Webhook（2 分鐘）

1. Render Dashboard → 你的 Web Service
2. 複製 URL（格式：`https://line-attendance.onrender.com`）
3. 到 LINE Developers Console → Messaging API
4. Webhook URL 貼上：**`https://你的app.onrender.com/webhook`**
5. 點 **Verify** → ✅ **Success！**

---

## 第 5 步：開始使用

### 加入員工
1. 打開 `https://你的app.onrender.com/admin`
2. 用 ADMIN_USERNAME / ADMIN_PASSWORD 登入
3. 「員工管理」→ 新增員工

### 員工綁定 + 打卡
- 掃 LINE Bot QR Code → 加好友 → 輸入員工編號
- 傳位置訊息或「上班」「下班」打卡

---

## 重要提醒

### Render 免費方案
- 閒置 15 分鐘會休眠
- 休眠後第一次請求需等 30-60 秒（冷啟動）
- 有請求就會自動醒來
- 每月 750 小時，一個服務剛好

### Supabase 免費方案
- 500MB 儲存空間
- 50 人公司永遠不會超過

### 備份
每月到 Supabase Dashboard → 備份 → 下載 dump

---

## 遇到問題？

檢查 Render Logs：
1. Render Dashboard → line-attendance → Logs
2. 看紅色錯誤訊息
3. 最常見：DATABASE_URL 格式錯誤（檢查密碼有沒有改）
