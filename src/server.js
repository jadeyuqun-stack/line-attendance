require('dotenv').config();

const express = require('express');
const session = require('express-session');
const { Client, middleware } = require('@line/bot-sdk');
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

  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 8 * 60 * 60 * 1000 },
  }));

  app.get('/health', (_, res) => res.json({ status: 'ok' }));

  app.post('/webhook', middleware({
    channelSecret: process.env.LINE_CHANNEL_SECRET,
  }), (req, res) => {
    const events = req.body.events;
    if (events && events.length > 0) {
      bot.handleEvents(events, client).catch(e => console.error(e));
    }
    res.status(200).send('OK');
  });

  app.use('/admin', admin);

  app.listen(PORT, () => console.log(`[Server] http://localhost:${PORT}`));
}

main().catch(e => { console.error(e); process.exit(1); });
