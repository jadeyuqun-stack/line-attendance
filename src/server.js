require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { Client } = require('@line/bot-sdk');
const db = require('./database');
const bot = require('./bot');
const admin = require('./admin');

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

  // LINE Webhook（不用 middleware，直接處理）
  app.post('/webhook', (req, res) => {
    try {
      const events = req.body && req.body.events;
      if (events && events.length > 0) {
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

  app.listen(PORT, () => console.log(`[Server] http://localhost:${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
