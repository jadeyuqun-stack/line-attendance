const db = require('./database');

async function handleEvents(events, client) {
  for (const evt of events) {
    try {
      if (evt.source.type !== 'user') continue;
      const uid = evt.source.userId;
      switch (evt.type) {
        case 'follow': {
          const emp = await db.getEmployeeByLineId(uid);
          if (emp) {
            await client.pushMessage(uid, [{ type: 'text', text: `歡迎回來，${emp.name}！🎉\n\n📍傳位置→GPS打卡\n💬「上班」「下班」→打卡\n📋「查詢」→記錄` }]);
          } else {
            await client.pushMessage(uid, [{ type: 'text', text: '👋 歡迎！\n請輸入你的「員工編號」完成綁定。' }]);
          }
          break;
        }
        case 'message': {
          const msg = evt.message;
          if (msg.type === 'text') await handleText(msg.text, uid, client, evt.replyToken);
          else if (msg.type === 'location') await handleLocation(msg, uid, client, evt.replyToken);
          break;
        }
      }
    } catch (e) { console.error(e); }
  }
}

async function handleText(text, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  if (!emp) {
    let name = '';
    try { const p = await client.getProfile(uid); name = p.displayName; } catch (e) {}
    const ok = await db.bindLineUser(text.trim(), uid, name);
    return reply(client, replyToken, ok ? '✅ 綁定成功！\n📍傳位置→GPS打卡\n💬「上班」「下班」→打卡' : '❌ 找不到員工編號「'+text.trim()+'」');
  }
  const cmd = text.trim();
  if (cmd.includes('上班')) return doCheckIn(emp, client, replyToken);
  if (cmd.includes('下班')) return doCheckOut(emp, client, replyToken);
  if (cmd.includes('查詢') || cmd.includes('記錄')) return doQuery(emp, client, replyToken);
  if (cmd.includes('幫助')) return reply(client, replyToken, '📖 使用說明\n\n📍傳送位置→GPS打卡\n💬「上班」「下班」→打卡\n📋「查詢」→查看記錄');
  return reply(client, replyToken, '❓ 請輸入：上班 / 下班 / 查詢 / 幫助');
}

async function handleLocation(msg, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  if (!emp) return reply(client, replyToken, '請先輸入員工編號綁定。');
  const today = await db.getTodayCheckins(emp.id);
  const hasIn = today.some(r => r.type === 'check_in');
  const hasOut = today.some(r => r.type === 'check_out');
  const loc = { latitude: msg.latitude, longitude: msg.longitude, address: msg.address || '' };
  if (hasIn && !hasOut) return doCheckOut(emp, client, replyToken, loc);
  if (!hasIn) return doCheckIn(emp, client, replyToken, loc);
  return reply(client, replyToken, '今日已完成上下班打卡。');
}

async function doCheckIn(emp, client, replyToken, loc) {
  const today = await db.getTodayCheckins(emp.id);
  if (today.some(r => r.type === 'check_in')) return reply(client, replyToken, '⚠️ 今天已上班打卡。');
  const r = await db.recordCheckin(emp.id, 'check_in', loc);
  const now = r.check_time ? new Date(r.check_time) : new Date();
  let msg = `✅ 上班打卡成功！\n⏰ ${fmt(now)}`;
  const late = checkLate(now);
  if (late > 0) msg += `\n⚠️ 遲到 ${late} 分鐘`;
  if (loc) msg += `\n📍 ${loc.address || loc.latitude+','+loc.longitude}`;
  return reply(client, replyToken, msg);
}

async function doCheckOut(emp, client, replyToken, loc) {
  const today = await db.getTodayCheckins(emp.id);
  if (!today.some(r => r.type === 'check_in')) return reply(client, replyToken, '⚠️ 尚未上班打卡。');
  if (today.some(r => r.type === 'check_out')) return reply(client, replyToken, '⚠️ 今天已下班打卡。');
  const r = await db.recordCheckin(emp.id, 'check_out', loc);
  const ci = new Date(today.find(r => r.type === 'check_in').check_time);
  const co = r.check_time ? new Date(r.check_time) : new Date();
  const h = Math.round(Math.max(0, (co - ci) / 3600000) * 10) / 10;
  let msg = `✅ 下班打卡成功！\n⏰ ${fmt(co)}\n📊 今日工時：約 ${h} 小時`;
  if (loc) msg += `\n📍 ${loc.address || loc.latitude+','+loc.longitude}`;
  msg += '\n\n辛苦了！🏠';
  return reply(client, replyToken, msg);
}

async function doQuery(emp, client, replyToken) {
  const records = await db.getTodayCheckins(emp.id);
  if (records.length === 0) return reply(client, replyToken, `📋 ${emp.name} 今日尚無記錄。`);
  let msg = `📋 ${emp.name} 今日記錄\n\n`;
  for (const r of records) {
    msg += `${r.type === 'check_in' ? '🔵上班' : '🔴下班'}：${fmt(new Date(r.check_time))}\n`;
    if (r.address) msg += `   📍${r.address}\n`;
  }
  return reply(client, replyToken, msg);
}

function reply(client, replyToken, text) {
  return client.replyMessage(replyToken, [{ type: 'text', text }]);
}

function fmt(d) {
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  const ap = h >= 12 ? '下午' : '上午';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ap} ${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function checkLate(now) {
  const start = parseInt(process.env.WORK_START_HOUR || '9');
  const buf = parseInt(process.env.LATE_BUFFER_MINUTES || '10');
  return Math.max(0, now.getHours() * 60 + now.getMinutes() - (start * 60 + buf));
}

module.exports = { handleEvents };
