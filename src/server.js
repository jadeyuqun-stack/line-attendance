require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { Client } = require('@line/bot-sdk');
const db = require('./database');
const bot = require('./bot');
const admin = require('./admin');
const report = require('./report');

async function main() {
  await db.initDatabase();

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

  // 健康檢查
  app.get('/health', (_, res) => res.json({ status: 'ok' }));
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
      }
    } catch (e) {
      console.error('[webhook] error:', e.message);
    }
    res.status(200).send('OK');
  });

  app.use('/admin', admin);

  // Rich Menu 設定（一次性）
  app.get('/admin/setup-richmenu', async (_, res) => {
    try {
      const id = await bot.setupRichMenu();
      res.json(id ? { success: true, richMenuId: id } : { error: '失敗，請看 Render logs' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 啟動每日報表排程
  report.startScheduler(client);

  // 把 client 存到 app 供 admin 使用
  app.locals.lineClient = client;

  app.listen(PORT, () => console.log(`[Server] http://localhost:${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
