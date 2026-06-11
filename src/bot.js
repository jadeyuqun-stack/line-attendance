const db = require('./database');

async function handleEvents(events, client) {
  console.log('[bot] events received:', JSON.stringify(events.map(e => ({ type: e.type, msgType: e.message && e.message.type, text: e.message && e.message.text }))));

  for (const evt of events) {
    try {
      if (evt.source.type !== 'user') continue;
      const uid = evt.source.userId;
      console.log('[bot] uid:', uid, 'type:', evt.type);

      if (evt.type === 'follow') {
        const emp = await db.getEmployeeByLineId(uid);
        if (emp) {
          await client.pushMessage(uid, [{ type: 'text', text: `歡迎回來，${emp.name}！🎉\n\n📍傳位置→GPS打卡\n💬「上班」「下班」→打卡\n📋「查詢」→記錄` }]);
        } else {
          await client.pushMessage(uid, [{ type: 'text', text: '👋 歡迎！\n請輸入你的「員工編號」完成綁定。' }]);
        }
      }

      if (evt.type === 'message' && evt.message) {
        console.log('[bot] message type:', evt.message.type, 'replyToken:', evt.replyToken ? 'yes' : 'no');
        try {
          if (evt.message.type === 'text') {
            await handleText(evt.message.text, uid, client, evt.replyToken);
          } else if (evt.message.type === 'location') {
            await handleLocation(evt.message, uid, client, evt.replyToken);
          } else {
            await client.replyMessage(evt.replyToken, [{ type: 'text', text: '請傳送文字或位置訊息。' }]);
          }
        } catch (innerErr) {
          console.error('[bot] handleText/handleLocation error:', innerErr.message);
          // 嘗試回錯誤訊息
          try {
            await client.replyMessage(evt.replyToken, [{ type: 'text', text: '系統錯誤，請稍後再試。' }]);
          } catch (e2) {
            console.error('[bot] fallback reply also failed:', e2.message);
          }
        }
      }
    } catch (e) {
      console.error('[bot] event error:', e.message);
    }
  }
}

async function handleText(text, uid, client, replyToken) {
  console.log('[bot] handleText:', text);

  const emp = await db.getEmployeeByLineId(uid);
  console.log('[bot] employee found:', emp ? emp.name : 'none');

  if (!emp) {
    let name = '';
    try {
      const p = await client.getProfile(uid);
      name = p.displayName;
      console.log('[bot] profile:', name);
    } catch (e) {
      console.error('[bot] getProfile error:', e.message);
    }
    const ok = await db.bindLineUser(text.trim(), uid, name);
    console.log('[bot] bind result:', ok);
    const replyText = ok ? '✅ 綁定成功！\n📍傳位置→GPS打卡\n💬「上班」「下班」→打卡' : '❌ 找不到員工編號「' + text.trim() + '」';
    console.log('[bot] replying:', replyText);
    await client.replyMessage(replyToken, [{ type: 'text', text: replyText }]);
    console.log('[bot] reply sent successfully');
    return;
  }

  const cmd = text.trim();
  console.log('[bot] command:', cmd);

  if (cmd.includes('上班')) {
    await doCheckIn(emp, client, replyToken);
  } else if (cmd.includes('下班')) {
    await doCheckOut(emp, client, replyToken);
  } else if (cmd.includes('查詢') || cmd.includes('記錄')) {
    await doQuery(emp, client, replyToken);
  } else if (cmd.includes('幫助')) {
    await client.replyMessage(replyToken, [{ type: 'text', text: '📖 使用說明\n\n📍傳送位置→GPS打卡\n💬「上班」「下班」→打卡\n📋「查詢」→查看記錄' }]);
  } else {
    await client.replyMessage(replyToken, [{ type: 'text', text: '❓ 請輸入：上班 / 下班 / 查詢 / 幫助' }]);
  }
}

async function handleLocation(msg, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  if (!emp) {
    await client.replyMessage(replyToken, [{ type: 'text', text: '請先輸入員工編號綁定。' }]);
    return;
  }
  const today = await db.getTodayCheckins(emp.id);
  const hasIn = today.some(r => r.type === 'check_in');
  const hasOut = today.some(r => r.type === 'check_out');
  const loc = { latitude: msg.latitude, longitude: msg.longitude, address: msg.address || '' };
  if (hasIn && !hasOut) await doCheckOut(emp, client, replyToken, loc);
  else if (!hasIn) await doCheckIn(emp, client, replyToken, loc);
  else await client.replyMessage(replyToken, [{ type: 'text', text: '今日已完成上下班打卡。' }]);
}

async function doCheckIn(emp, client, replyToken, loc) {
  const today = await db.getTodayCheckins(emp.id);
  if (today.some(r => r.type === 'check_in')) {
    await client.replyMessage(replyToken, [{ type: 'text', text: '⚠️ 今天已上班打卡。' }]);
    return;
  }
  const r = await db.recordCheckin(emp.id, 'check_in', loc);
  const now = r.check_time ? new Date(r.check_time) : new Date();
  let msg = '✅ 上班打卡成功！\n⏰ ' + fmt(now);
  const late = checkLate(now);
  if (late > 0) msg += '\n⚠️ 遲到 ' + late + ' 分鐘';
  if (loc) msg += '\n📍 ' + (loc.address || loc.latitude + ',' + loc.longitude);
  await client.replyMessage(replyToken, [{ type: 'text', text: msg }]);
}

async function doCheckOut(emp, client, replyToken, loc) {
  const today = await db.getTodayCheckins(emp.id);
  if (!today.some(r => r.type === 'check_in')) {
    await client.replyMessage(replyToken, [{ type: 'text', text: '⚠️ 尚未上班打卡。' }]);
    return;
  }
  if (today.some(r => r.type === 'check_out')) {
    await client.replyMessage(replyToken, [{ type: 'text', text: '⚠️ 今天已下班打卡。' }]);
    return;
  }
  const r = await db.recordCheckin(emp.id, 'check_out', loc);
  const ci = new Date(today.find(r => r.type === 'check_in').check_time);
  const co = r.check_time ? new Date(r.check_time) : new Date();
  const h = Math.round(Math.max(0, (co - ci) / 3600000) * 10) / 10;
  let msg = '✅ 下班打卡成功！\n⏰ ' + fmt(co) + '\n📊 今日工時：約 ' + h + ' 小時';
  if (loc) msg += '\n📍 ' + (loc.address || loc.latitude + ',' + loc.longitude);
  msg += '\n\n辛苦了！🏠';
  await client.replyMessage(replyToken, [{ type: 'text', text: msg }]);
}

async function doQuery(emp, client, replyToken) {
  const records = await db.getTodayCheckins(emp.id);
  if (records.length === 0) {
    await client.replyMessage(replyToken, [{ type: 'text', text: '📋 ' + emp.name + ' 今日尚無記錄。' }]);
    return;
  }
  let msg = '📋 ' + emp.name + ' 今日記錄\n\n';
  for (const r of records) {
    msg += (r.type === 'check_in' ? '🔵上班' : '🔴下班') + '：' + fmt(new Date(r.check_time)) + '\n';
    if (r.address) msg += '   📍' + r.address + '\n';
  }
  await client.replyMessage(replyToken, [{ type: 'text', text: msg }]);
}

function fmt(d) {
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  const ap = h >= 12 ? '下午' : '上午';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return ap + ' ' + String(h12).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function checkLate(now) {
  const start = parseInt(process.env.WORK_START_HOUR || '9');
  const buf = parseInt(process.env.LATE_BUFFER_MINUTES || '10');
  return Math.max(0, now.getHours() * 60 + now.getMinutes() - (start * 60 + buf));
}

module.exports = { handleEvents };
