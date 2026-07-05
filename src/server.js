require('dotenv').config();
// 強制使用台北時區（打卡記錄、日期比較都需要）
process.env.TZ = 'Asia/Taipei';

const express = require('express');
const session = require('express-session');
const { Client } = require('@line/bot-sdk');
const db = require('./database');
const bot = require('./bot');
const admin = require('./admin');
const report = require('./report');

async function main() {
  await db.initDatabase();

  // 初始化中文字型（Rich Menu 用）
  bot.initFont().catch(function(e) { console.error('[Server] font init error:', e.message); });

  const client = new Client({
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });

  const app = express();
  const PORT = process.env.PORT || 3000;

  // JSON parsing（LINE webhook 需要）
  app.use(express.json());

  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
  }));

  // 健康檢查（也會觸發日報檢查）
  app.get('/health', (_, res) => {
    res.json({ status: 'ok' });
    report.trySendReport(app.locals.lineClient).catch(e => {});
  });
  app.get('/', (_, res) => res.send('LINE Attendance System OK'));
  app.post('/', (req, res) => { res.status(200).send('OK'); });

  // LINE Webhook
  app.post('/webhook', (req, res) => {
    try {
      const events = req.body && req.body.events;
      if (events && events.length > 0) {
        for (var i = 0; i < events.length; i++) {
          var evt = events[i];
          // 任何群組來源的事件 → 自動記錄群組 ID
          if (evt.source && evt.source.type === 'group' && evt.source.groupId) {
            db.setSetting('report_group_id', evt.source.groupId);
            console.log('[Webhook] 記錄群組 ID:', evt.source.groupId);
          }
        }
        bot.handleEvents(events, client).catch(e => console.error(e));
        // 每次 LINE 事件都檢查是否需要發送日報（解決 Render 休眠問題）
        report.trySendReport(client).catch(e => console.error('[Report] check error:', e.message));
      }
    } catch (e) {
      console.error('[webhook] error:', e.message);
    }
    res.status(200).send('OK');
  });

  app.use('/admin', admin);

  // Rich Menu 診斷 / 設定
  app.get('/admin/setup-richmenu', async (req, res) => {
    try {
      var check = req.query.check;
      if (check === '1') {
        // 診斷模式：列出目前的 Rich Menu 和預設狀態
        var token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };
        var existing = await fetch('https://api.line.me/v2/bot/richmenu/list', { headers });
        var list = await existing.json();
        var defaultRm = '無';
        try {
          var dr = await fetch('https://api.line.me/v2/bot/user/all/richmenu', { headers });
          if (dr.status === 200) {
            var drData = await dr.json();
            defaultRm = drData.richMenuId || '無';
          } else {
            defaultRm = 'API 錯誤 ' + dr.status;
          }
        } catch (e2) {
          defaultRm = '查詢失敗: ' + e2.message;
        }
        var html = '<h2>Rich Menu 診斷</h2>';
        html += '<p><b>現有 Rich Menu 數量：</b>' + (list.richmenus ? list.richmenus.length : 0) + '</p>';
        if (list.richmenus) {
          for (var i = 0; i < list.richmenus.length; i++) {
            var rm = list.richmenus[i];
            html += '<p style="margin-left:16px">📋 ' + rm.richMenuId + ' — ' + (rm.name || '無名稱') + ' (' + (rm.selected ? '已選取' : '未選取') + ')</p>';
          }
        }
        html += '<p><b>所有用戶預設 Rich Menu：</b>' + defaultRm + '</p>';
        html += '<p style="color:#e74c3c;margin-top:16px">⚠️ 如 Rich Menu 未顯示，請檢查：<br>';
        html += '1. <a href="https://manager.line.biz/" target="_blank">LINE Official Account Manager</a> → 設定 → 回訊設定 → 啟用 <b>圖文選單</b><br>';
        html += '2. 重新加入好友或關閉重開 LINE 聊天室<br>';
        html += '3. <a href="/admin/richmenu-preview" target="_blank">📷 預覽 6 格</a> | <a href="/admin/richmenu-preview?type=8" target="_blank">📷 預覽 8 格</a> | <a href="/admin/richmenu-preview?type=boss" target="_blank">📷 預覽老闆4格</a></p>';
        html += '<p><a href="/admin/setup-richmenu">🔄 重新建立 Rich Menu</a> | <a href="/admin/setup-richmenu?check=1">🔍 重新診斷</a></p>';
        return res.send(html);
      }
      var result = await bot.setupRichMenu();
      if (result.error) {
        var errHtml = '<h2>❌ Rich Menu 設定失敗</h2>';
        errHtml += '<p style="color:#e74c3c"><b>錯誤：</b>' + result.error + '</p>';
        errHtml += '<p><a href="/admin/setup-richmenu?check=1">🔍 診斷狀態</a></p>';
        return res.send(errHtml);
      }
      if (result.richMenuId) {
        var html2 = '<h2>✅ Rich Menu 建立成功</h2>';
        html2 += '<p>6 格選單（預設）: <code>' + result.richMenuId + '</code></p>';
        if (result.menu8Id) html2 += '<p>8 格選單（主管）: <code>' + result.menu8Id + '</code></p>';
        if (result.menuBossId) html2 += '<p>4 格選單（老闆）: <code>' + result.menuBossId + '</code></p>';
        html2 += '<p style="color:#27ae60">✔ 圖片上傳完成<br>✔ 6 格已設為所有用戶預設<br>✔ 主管角色自動連結 8 格選單<br>✔ 老闆角色自動連結 4 格選單</p>';
        html2 += '<p>🔍 <b>若 LINE 仍未顯示：</b></p>';
        html2 += '<ol style="color:#e74c3c">';
        html2 += '<li>關閉 LINE 聊天室 → 重新打開（必要！）</li>';
        html2 += '<li>確認已加 Bot 為好友</li>';
        html2 += '<li>前往 <a href="https://manager.line.biz/" target="_blank">LINE Official Account Manager</a> → 設定 → 回訊設定 → 確認 <b>圖文選單</b> 已啟用</li>';
        html2 += '<li><a href="/admin/richmenu-preview" target="_blank">📷 預覽 6 格</a> | <a href="/admin/richmenu-preview?type=8" target="_blank">📷 預覽 8 格</a> | <a href="/admin/richmenu-preview?type=boss" target="_blank">📷 預覽老闆4格</a></li>';
        html2 += '</ol>';
        html2 += '<p><a href="/admin/setup-richmenu?check=1">🔍 診斷 Rich Menu 狀態</a></p>';
        res.send(html2);
      } else {
        res.json({ error: '未知錯誤' });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Rich Menu PNG 預覽
  app.get('/admin/richmenu-preview', async (req, res) => {
    try {
      var is8 = req.query.type === '8';
      var isBoss = req.query.type === 'boss';
      var png = isBoss ? bot.makePngBoss() : (is8 ? bot.makePng8() : bot.makePng());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline; filename=richmenu' + (isBoss ? 'boss' : (is8 ? '8' : '')) + '.png');
      res.end(png);
    } catch (e) {
      res.status(500).send('PNG 產生失敗: ' + e.message);
    }
  });

  // 啟動每日報表排程
  report.startScheduler(client);

  // 把 client 存到 app 供 admin 使用
  app.locals.lineClient = client;

  app.listen(PORT, () => console.log(`[Server] http://localhost:${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
