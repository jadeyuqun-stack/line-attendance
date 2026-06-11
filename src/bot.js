const db = require('./database');

const states = new Map();

// 常用快速回覆按鈕
const MENU_BUTTONS = {
  items: [
    { type: 'action', action: { type: 'message', label: '上班', text: '上班' } },
    { type: 'action', action: { type: 'message', label: '下班', text: '下班' } },
    { type: 'action', action: { type: 'message', label: '查詢', text: '查詢' } },
    { type: 'action', action: { type: 'message', label: '請假', text: '請假' } },
    { type: 'action', action: { type: 'message', label: '幫助', text: '幫助' } },
    { type: 'action', action: { type: 'message', label: '我的ID', text: '我的ID' } },
  ]
};

function withMenu(text) {
  return { type: 'text', text: text, quickReply: MENU_BUTTONS };
}

async function handleEvents(events, client) {
  for (const evt of events) {
    try {
      if (evt.source.type !== 'user') continue;
      const uid = evt.source.userId;

      if (evt.type === 'follow') {
        const emp = await db.getEmployeeByLineId(uid);
        await client.pushMessage(uid, [withMenu(emp
          ? '歡迎回來，' + emp.name + '！🎉\n\n📍傳位置→GPS打卡\n💬下方選單可直接點選'
          : '👋 歡迎！\n請輸入你的「員工編號」完成綁定。\n\n📌 若不確定編號，請洽管理員。')]);
      }

      if (evt.type === 'message' && evt.message) {
        if (evt.message.type === 'text') {
          await handleText(evt.message.text, uid, client, evt.replyToken);
        } else if (evt.message.type === 'location') {
          await handleLocation(evt.message, uid, client, evt.replyToken);
        }
      }

      if (evt.type === 'postback') {
        await handlePostback(evt.postback, uid, client, evt.replyToken);
      }
    } catch (e) {
      console.error('[bot] error:', e.message);
    }
  }
}

async function handleText(text, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  const cmd = text.trim();

  if (!emp) {
    if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
      return client.replyMessage(replyToken, [withMenu('🆔 你的 LINE User ID：\n\n' + uid + '\n\n請將這組 ID 提供給管理員綁定。')]);
    }
    let name = '';
    try { const p = await client.getProfile(uid); name = p.displayName; } catch (e) {}
    const ok = await db.bindLineUser(cmd, uid, name);
    return client.replyMessage(replyToken, [withMenu(ok
      ? '✅ 綁定成功！\n📍傳位置→GPS打卡\n💬下方選單可直接點選'
      : '❌ 找不到員工編號「' + cmd + '」\n\n🆔 輸入「我的ID」查看 LINE ID，提供給管理員綁定。')]);
  }

  if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
    return client.replyMessage(replyToken, [withMenu('🆔 LINE User ID：\n\n' + uid + '\n\n✅ 已綁定：' + emp.name + '（' + emp.employee_no + '）')]);
  }

  if (cmd === '請假' || cmd === '请假') return startLeaveFlow(uid, client, replyToken);
  if (states.has(uid)) return handleLeaveFlow(cmd, uid, client, replyToken, emp);

  if (cmd.includes('上班')) return doCheckIn(emp, client, replyToken);
  if (cmd.includes('下班')) return doCheckOut(emp, client, replyToken);
  if (cmd.includes('查詢') || cmd.includes('記錄')) return doQuery(emp, client, replyToken);
  if (cmd.includes('幫助')) {
    return client.replyMessage(replyToken, [withMenu('📖 指令列表\n\n💬「上班」「下班」→打卡\n📍傳位置→GPS打卡\n📋「查詢」→記錄\n🏖「請假」→申請請假\n🆔「我的ID」→查看LINE ID')]);
  }
  return client.replyMessage(replyToken, [withMenu('❓ 請點選下方選單，或輸入指令')]);
}

// =========== 請假（含日期選擇器）==========
const LEAVE_TYPES = { '特休': 'annual', '事假': 'personal', '病假': 'sick', '公假': 'official' };

async function startLeaveFlow(uid, client, replyToken) {
  states.set(uid, { step: 'type' });
  return client.replyMessage(replyToken, [{
    type: 'text', text: '🏖 請假申請\n\n請選擇假別：',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '特休', text: '特休' } },
        { type: 'action', action: { type: 'message', label: '事假', text: '事假' } },
        { type: 'action', action: { type: 'message', label: '病假', text: '病假' } },
        { type: 'action', action: { type: 'message', label: '公假', text: '公假' } },
      ]
    }
  }]);
}

async function handleLeaveFlow(text, uid, client, replyToken, emp) {
  const state = states.get(uid);

  if (state.step === 'type') {
    const type = LEAVE_TYPES[text];
    if (!type) return client.replyMessage(replyToken, [{ type: 'text', text: '請選擇假別：特休 / 事假 / 病假 / 公假' }]);
    state.type = type;
    state.typeLabel = text;
    state.step = 'start_date';
    // 日期選擇器：開始日期
    return client.replyMessage(replyToken, [{
      type: 'template', altText: '請選擇開始日期',
      template: {
        type: 'buttons',
        text: '📅 請選擇「開始日期」',
        actions: [{ type: 'datetimepicker', label: '選擇開始日期', data: 'leave_start', mode: 'date' }]
      }
    }]);
  }

  if (state.step === 'start_date') {
    // 不會從文字來，由 postback 處理
    return client.replyMessage(replyToken, [{ type: 'text', text: '請點選上方「選擇開始日期」按鈕。' }]);
  }

  if (state.step === 'end_date') {
    // 同理由 postback 處理
    return client.replyMessage(replyToken, [{ type: 'text', text: '請點選上方「選擇結束日期」按鈕。' }]);
  }

  if (state.step === 'reason') {
    state.reason = text;
    try {
      const leaveId = await db.createLeaveRequest(emp.id, state.type, state.startDate, state.endDate, state.reason);
      states.delete(uid);

      const mgr = await db.findManager(emp.id);
      if (mgr) {
        const days = Math.ceil((new Date(state.endDate) - new Date(state.startDate)) / 86400000) + 1;
        await client.pushMessage(mgr.line_user_id, [{
          type: 'flex', altText: '📋 ' + emp.name + ' 請假申請',
          contents: {
            type: 'bubble',
            body: {
              type: 'box', layout: 'vertical',
              contents: [
                { type: 'text', text: '📋 請假申請', weight: 'bold', size: 'lg' },
                { type: 'text', text: '員工：' + emp.name + '（' + emp.employee_no + '）', margin: 'md' },
                { type: 'text', text: '假別：' + state.typeLabel, margin: 'sm' },
                { type: 'text', text: '日期：' + state.startDate + ' ~ ' + state.endDate + '（' + days + '天）', margin: 'sm' },
                { type: 'text', text: '原因：' + state.reason, margin: 'sm', wrap: true },
              ]
            },
            footer: {
              type: 'box', layout: 'horizontal', spacing: 'sm',
              contents: [
                { type: 'button', style: 'primary', color: '#06c755', action: { type: 'postback', label: '核准', data: 'leave_approve_' + leaveId }, flex: 1 },
                { type: 'button', style: 'secondary', color: '#e74c3c', action: { type: 'postback', label: '駁回', data: 'leave_reject_' + leaveId }, flex: 1 },
              ]
            }
          }
        }]);
      }

      return client.replyMessage(replyToken, [{
        type: 'text',
        text: '✅ 請假申請已送出！\n\n假別：' + state.typeLabel + '\n日期：' + state.startDate + ' ~ ' + state.endDate + '\n原因：' + state.reason + '\n\n狀態：等待主管核准 ⏳',
        quickReply: MENU_BUTTONS
      }]);
    } catch (e) {
      console.error('[leave] error:', e);
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('❌ 申請失敗，請稍後再試。')]);
    }
  }
}

// =========== Postback（含日期選擇器回傳）==========
async function handlePostback(postback, uid, client, replyToken) {
  const data = postback.data || '';
  const params = postback.params || {};
  console.log('[postback]', data, JSON.stringify(params));

  // 日期選擇器回傳
  if (data === 'leave_start') {
    const state = states.get(uid);
    if (!state || state.step !== 'start_date') return;
    state.startDate = params.date;
    state.step = 'end_date';
    return client.replyMessage(replyToken, [{
      type: 'template', altText: '請選擇結束日期',
      template: {
        type: 'buttons',
        text: '📅 開始日期：' + params.date + '\n請選擇「結束日期」',
        actions: [{ type: 'datetimepicker', label: '選擇結束日期', data: 'leave_end', mode: 'date' }]
      }
    }]);
  }

  if (data === 'leave_end') {
    const state = states.get(uid);
    if (!state || state.step !== 'end_date') return;
    state.endDate = params.date;
    state.step = 'reason';
    return client.replyMessage(replyToken, [{ type: 'text', text: '📅 ' + state.startDate + ' ~ ' + params.date + '\n\n📝 請輸入請假原因：' }]);
  }

  // 主管簽核
  if (data.startsWith('leave_approve_') || data.startsWith('leave_reject_')) {
    const leaveId = parseInt(data.split('_').pop());
    const mgr = await db.getEmployeeByLineId(uid);
    if (!mgr || (mgr.role !== 'manager' && mgr.role !== 'admin')) {
      return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 你沒有審核權限。' }]);
    }
    const leave = await db.getLeaveById(leaveId);
    if (!leave || leave.status !== 'pending') {
      return client.replyMessage(replyToken, [{ type: 'text', text: '此申請已處理過。' }]);
    }
    if (data.startsWith('leave_approve_')) {
      await db.updateLeaveStatus(leaveId, 'approved', mgr.id);
      const e = await db.getEmployeeById(leave.employee_id);
      if (e && e.line_user_id) {
        await client.pushMessage(e.line_user_id, [{ type: 'text', text: '🎉 你的請假申請已核准！\n日期：' + leave.start_date + ' ~ ' + leave.end_date }]);
      }
      return client.replyMessage(replyToken, [{ type: 'text', text: '✅ 已核准申請。' }]);
    } else {
      await db.updateLeaveStatus(leaveId, 'rejected', mgr.id);
      const e = await db.getEmployeeById(leave.employee_id);
      if (e && e.line_user_id) {
        await client.pushMessage(e.line_user_id, [{ type: 'text', text: '❌ 你的請假申請被駁回。\n日期：' + leave.start_date + ' ~ ' + leave.end_date }]);
      }
      return client.replyMessage(replyToken, [{ type: 'text', text: '已駁回申請。' }]);
    }
  }
}

// =========== GPS ===========
function haversineDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function checkGpsRange(lat, lng) {
  const officeLat = parseFloat(await db.getSetting('office_lat') || '0');
  const officeLng = parseFloat(await db.getSetting('office_lng') || '0');
  const range = parseInt(await db.getSetting('gps_range_meters') || '200');
  if (!officeLat || !officeLng) return { inRange: true, distance: 0 };
  const dist = haversineDistance(officeLat, officeLng, lat, lng);
  return { inRange: dist <= range, distance: dist };
}

// =========== 打卡 ===========
async function handleLocation(msg, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  if (!emp) return client.replyMessage(replyToken, [withMenu('請先輸入員工編號綁定。')]);
  const today = await db.getTodayCheckins(emp.id);
  const hasIn = today.some(r => r.type === 'check_in');
  const hasOut = today.some(r => r.type === 'check_out');
  const loc = { latitude: msg.latitude, longitude: msg.longitude, address: msg.address || '' };
  const gps = await checkGpsRange(msg.latitude, msg.longitude);
  if (hasIn && !hasOut) return doCheckOut(emp, client, replyToken, loc, gps);
  if (!hasIn) return doCheckIn(emp, client, replyToken, loc, gps);
  return client.replyMessage(replyToken, [withMenu('今日已完成上下班打卡。')]);
}

async function doCheckIn(emp, client, replyToken, loc, gps) {
  const today = await db.getTodayCheckins(emp.id);
  if (today.some(r => r.type === 'check_in')) return client.replyMessage(replyToken, [withMenu('⚠️ 今天已上班打卡。')]);
  const r = await db.recordCheckin(emp.id, 'check_in', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const now = r.check_time ? new Date(r.check_time) : new Date();
  let msg = '✅ 上班打卡成功！\n⏰ ' + fmt(now);
  const late = checkLate(now);
  if (late > 0) msg += '\n⚠️ 遲到 ' + late + ' 分鐘';
  if (loc) msg += '\n📍 ' + (loc.address || loc.latitude + ',' + loc.longitude);
  if (gps && !gps.inRange) msg += '\n⚠️ 不在公司範圍內（距離 ' + gps.distance + ' 公尺）';
  return client.replyMessage(replyToken, [withMenu(msg)]);
}

async function doCheckOut(emp, client, replyToken, loc, gps) {
  const today = await db.getTodayCheckins(emp.id);
  if (!today.some(r => r.type === 'check_in')) return client.replyMessage(replyToken, [withMenu('⚠️ 尚未上班打卡。')]);
  if (today.some(r => r.type === 'check_out')) return client.replyMessage(replyToken, [withMenu('⚠️ 今天已下班打卡。')]);
  const r = await db.recordCheckin(emp.id, 'check_out', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const ci = new Date(today.find(r => r.type === 'check_in').check_time);
  const co = r.check_time ? new Date(r.check_time) : new Date();
  const h = Math.round(Math.max(0, (co - ci) / 3600000) * 10) / 10;
  let msg = '✅ 下班打卡成功！\n⏰ ' + fmt(co) + '\n📊 今日工時：約 ' + h + ' 小時';
  if (loc) msg += '\n📍 ' + (loc.address || loc.latitude + ',' + loc.longitude);
  if (gps && !gps.inRange) msg += '\n⚠️ 不在公司範圍內（距離 ' + gps.distance + ' 公尺）';
  msg += '\n\n辛苦了！🏠';
  return client.replyMessage(replyToken, [withMenu(msg)]);
}

async function doQuery(emp, client, replyToken) {
  const records = await db.getTodayCheckins(emp.id);
  if (records.length === 0) return client.replyMessage(replyToken, [withMenu('📋 ' + emp.name + ' 今日尚無記錄。')]);
  let msg = '📋 ' + emp.name + ' 今日記錄\n\n';
  for (const r of records) {
    msg += (r.type === 'check_in' ? '🔵上班' : '🔴下班') + '：' + fmt(new Date(r.check_time)) + '\n';
    if (r.address) msg += '   📍' + r.address + '\n';
    if (r.in_range === false) msg += '   ⚠️ 超出範圍\n';
  }
  return client.replyMessage(replyToken, [withMenu(msg)]);
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

// =========== Rich Menu 設定 ===========
async function setupRichMenu() {
  try {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

    // 1. 刪除舊 Rich Menu
    const existing = await fetch('https://api.line.me/v2/bot/richmenu/list', { headers });
    const list = await existing.json();
    for (const rm of (list.richmenus || [])) {
      await fetch('https://api.line.me/v2/bot/richmenu/' + rm.richMenuId, { method: 'DELETE', headers });
    }

    // 2. 建立新 Rich Menu
    const menu = {
      size: { width: 2500, height: 843 },
      selected: true,
      name: '主選單',
      chatBarText: '📋 點此開啟功能選單',
      areas: [
        { bounds: { x: 0, y: 0, width: 1250, height: 421 }, action: { type: 'message', text: '上班' } },
        { bounds: { x: 1250, y: 0, width: 1250, height: 421 }, action: { type: 'message', text: '下班' } },
        { bounds: { x: 0, y: 421, width: 833, height: 422 }, action: { type: 'message', text: '查詢' } },
        { bounds: { x: 833, y: 421, width: 834, height: 422 }, action: { type: 'message', text: '請假' } },
        { bounds: { x: 1667, y: 421, width: 833, height: 422 }, action: { type: 'message', text: '幫助' } },
      ]
    };
    const res1 = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST', headers, body: JSON.stringify(menu)
    });
    const data = await res1.json();
    console.log('[RichMenu] created:', data.richMenuId);

    // 3. 上傳圖片（簡單灰白底 PNG）
    const png = makePng();
    const imgHeaders = { 'Content-Type': 'image/png', 'Authorization': 'Bearer ' + token };
    await fetch('https://api.line.me/v2/bot/richmenu/' + data.richMenuId + '/content', {
      method: 'POST', headers: imgHeaders, body: png
    });
    console.log('[RichMenu] image uploaded');

    // 4. 設為預設
    await fetch('https://api.line.me/v2/bot/user/all/richmenu/' + data.richMenuId, {
      method: 'POST', headers
    });
    console.log('[RichMenu] set as default ✅');
    return data.richMenuId;
  } catch (e) {
    console.error('[RichMenu] error:', e.message);
    return null;
  }
}

// 產生簡單 Rich Menu 圖片（灰白底，2500x843）
function makePng() {
  const zlib = require('zlib');
  const w = 2500, h = 843;
  // 建立 raw pixel data（RGBA 每行 filter byte + 4 bytes per pixel）
  const rawData = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowOff = y * (1 + w * 4);
    rawData[rowOff] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const off = rowOff + 1 + x * 4;
      if (y < 421) {
        // 第一列：綠 + 橘
        rawData[off] = x < 1250 ? 0x06 : 0xf3;     // R
        rawData[off+1] = x < 1250 ? 0xc7 : 0x9c;   // G
        rawData[off+2] = x < 1250 ? 0x55 : 0x12;   // B
      } else {
        // 第二列：藍 + 灰 + 淺灰
        if (x < 833) { rawData[off]=0x34; rawData[off+1]=0x98; rawData[off+2]=0xdb; }
        else if (x < 1667) { rawData[off]=0x95; rawData[off+1]=0xa5; rawData[off+2]=0xa6; }
        else { rawData[off]=0xb0; rawData[off+1]=0xbe; rawData[off+2]=0xc5; }
      }
      rawData[off+3] = 255; // alpha
    }
  }
  const deflated = zlib.deflateSync(rawData);

  // 組出完整 PNG
  function crc(buf) {
    let c = 0xffffffff;
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let cc = n; for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1; table[n] = cc; }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type);
    const all = Buffer.concat([len, t, data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([all, c]);
  }

  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, color type RGBA

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflated), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { handleEvents, setupRichMenu };
