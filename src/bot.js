const db = require('./database');

// 對話狀態暫存（請假申請流程用）
const states = new Map();

async function handleEvents(events, client) {
  console.log('[bot] events:', events.length);

  for (const evt of events) {
    try {
      if (evt.source.type !== 'user') continue;
      const uid = evt.source.userId;

      if (evt.type === 'follow') {
        const emp = await db.getEmployeeByLineId(uid);
        if (emp) {
          await client.pushMessage(uid, [{ type: 'text', text: `歡迎回來，${emp.name}！🎉\n\n📍傳位置→GPS打卡\n💬「上班」「下班」→打卡\n📋「查詢」→記錄\n🏖「請假」→申請請假\n🆔「我的ID」→查看LINE ID` }]);
        } else {
          await client.pushMessage(uid, [{ type: 'text', text: '👋 歡迎！\n請輸入你的「員工編號」完成綁定。\n\n📌 若不確定編號，請洽管理員。\n🆔 輸入「我的ID」可查看你的 LINE User ID。' }]);
        }
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

// =========== 文字指令 ===========
async function handleText(text, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  const cmd = text.trim();

  // 未綁定 → 嘗試綁定（或查詢 ID）
  if (!emp) {
    // 「我的ID」指令
    if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
      return client.replyMessage(replyToken, [{ type: 'text', text: '🆔 你的 LINE User ID 是：\n\n' + uid + '\n\n請將這組 ID 提供給管理員，請他幫你在後台綁定。' }]);
    }
    // 嘗試綁定
    let name = '';
    try { const p = await client.getProfile(uid); name = p.displayName; } catch (e) {}
    const ok = await db.bindLineUser(cmd, uid, name);
    if (ok) {
      return client.replyMessage(replyToken, [{ type: 'text', text: '✅ 綁定成功！\n📍傳位置→GPS打卡\n💬「上班」「下班」→打卡\n📋「查詢」→記錄' }]);
    }
    return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 找不到員工編號「' + cmd + '」\n\n🆔 輸入「我的ID」可查看你的 LINE User ID，提供給管理員綁定。' }]);
  }

  // 已綁定
  if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
    return client.replyMessage(replyToken, [{ type: 'text', text: '🆔 你的 LINE User ID：\n\n' + uid + '\n\n✅ 你已綁定為：' + emp.name + '（' + emp.employee_no + '）' }]);
  }

  // 請假流程
  if (cmd === '請假' || cmd === '请假') {
    return startLeaveFlow(uid, client, replyToken);
  }

  // 處理請假對話狀態
  if (states.has(uid)) {
    return handleLeaveFlow(cmd, uid, client, replyToken, emp);
  }

  if (cmd.includes('上班')) return doCheckIn(emp, client, replyToken);
  if (cmd.includes('下班')) return doCheckOut(emp, client, replyToken);
  if (cmd.includes('查詢') || cmd.includes('記錄')) return doQuery(emp, client, replyToken);
  if (cmd.includes('幫助')) {
    return client.replyMessage(replyToken, [{ type: 'text', text: '📖 指令列表\n\n💬「上班」「下班」→ 打卡\n📍 傳送位置 → GPS 打卡\n📋「查詢」→ 今日記錄\n🏖「請假」→ 申請請假\n🆔「我的ID」→ 查看 LINE ID' }]);
  }
  return client.replyMessage(replyToken, [{ type: 'text', text: '❓ 請輸入：上班 / 下班 / 查詢 / 請假 / 幫助 / 我的ID' }]);
}

// =========== 請假對話流程 ===========
const LEAVE_TYPES = { '特休': 'annual', '事假': 'personal', '病假': 'sick', '公假': 'official' };

async function startLeaveFlow(uid, client, replyToken) {
  states.set(uid, { step: 'type' });
  return client.replyMessage(replyToken, [{
    type: 'text',
    text: '🏖 請假申請\n\n請選擇假別：',
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
    if (!type) {
      return client.replyMessage(replyToken, [{ type: 'text', text: '請選擇假別：特休 / 事假 / 病假 / 公假' }]);
    }
    state.type = type;
    state.typeLabel = text;
    state.step = 'dates';
    return client.replyMessage(replyToken, [{ type: 'text', text: '📅 請輸入日期範圍（YYYY-MM-DD YYYY-MM-DD）：\n\n例如：2026-06-15 2026-06-16' }]);
  }

  if (state.step === 'dates') {
    const parts = text.split(/\s+/);
    if (parts.length !== 2) {
      return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 格式錯誤\n請輸入：YYYY-MM-DD YYYY-MM-DD\n例如：2026-06-15 2026-06-16' }]);
    }
    state.startDate = parts[0];
    state.endDate = parts[1];
    state.step = 'reason';
    return client.replyMessage(replyToken, [{ type: 'text', text: '📝 請輸入請假原因：' }]);
  }

  if (state.step === 'reason') {
    state.reason = text;
    state.step = 'done';
    // 建立請假申請
    try {
      const leaveId = await db.createLeaveRequest(emp.id, state.type, state.startDate, state.endDate, state.reason);
      states.delete(uid);

      // 通知主管
      const mgr = await db.findManager(emp.id);
      if (mgr) {
        const days = Math.ceil((new Date(state.endDate) - new Date(state.startDate)) / 86400000) + 1;
        await client.pushMessage(mgr.line_user_id, [{
          type: 'flex',
          altText: '📋 ' + emp.name + ' 請假申請',
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

      return client.replyMessage(replyToken, [{ type: 'text', text: '✅ 請假申請已送出！\n\n假別：' + state.typeLabel + '\n日期：' + state.startDate + ' ~ ' + state.endDate + '\n原因：' + state.reason + '\n\n狀態：等待主管核准 ⏳' }]);
    } catch (e) {
      console.error('[leave] error:', e);
      states.delete(uid);
      return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 申請失敗，請稍後再試。' }]);
    }
  }
}

// =========== 主管簽核處理 ===========
async function handlePostback(postback, uid, client, replyToken) {
  const data = postback.data || '';

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
      // 通知員工
      const emp = await db.getEmployeeByNo((await getEmployeeById(leave.employee_id)).employee_no);
      const e = await getEmployeeById(leave.employee_id);
      if (e && e.line_user_id) {
        await client.pushMessage(e.line_user_id, [{ type: 'text', text: '🎉 你的請假申請已核准！\n\n日期：' + leave.start_date + ' ~ ' + leave.end_date }]);
      }
      return client.replyMessage(replyToken, [{ type: 'text', text: '✅ 已核准 ' + (e ? e.name : '') + ' 的請假申請。' }]);
    } else {
      await db.updateLeaveStatus(leaveId, 'rejected', mgr.id);
      const e = await getEmployeeById(leave.employee_id);
      if (e && e.line_user_id) {
        await client.pushMessage(e.line_user_id, [{ type: 'text', text: '❌ 你的請假申請被駁回。\n日期：' + leave.start_date + ' ~ ' + leave.end_date + '\n請洽主管了解原因。' }]);
      }
      return client.replyMessage(replyToken, [{ type: 'text', text: '已駁回申請。' }]);
    }
  }
}

async function getEmployeeById(id) {
  return db.getEmployeeById(id);
}

// =========== GPS 距離計算 ===========
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
  if (!officeLat || !officeLng) return { inRange: true, distance: 0 }; // 未設定辦公室 → 不檢查
  const dist = haversineDistance(officeLat, officeLng, lat, lng);
  return { inRange: dist <= range, distance: dist };
}

// =========== 打卡 ===========
async function handleLocation(msg, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  if (!emp) return client.replyMessage(replyToken, [{ type: 'text', text: '請先輸入員工編號綁定。\n🆔 輸入「我的ID」查看你的 LINE ID。' }]);

  const today = await db.getTodayCheckins(emp.id);
  const hasIn = today.some(r => r.type === 'check_in');
  const hasOut = today.some(r => r.type === 'check_out');
  const loc = { latitude: msg.latitude, longitude: msg.longitude, address: msg.address || '' };
  const gps = await checkGpsRange(msg.latitude, msg.longitude);

  if (hasIn && !hasOut) return doCheckOut(emp, client, replyToken, loc, gps);
  if (!hasIn) return doCheckIn(emp, client, replyToken, loc, gps);
  return client.replyMessage(replyToken, [{ type: 'text', text: '今日已完成上下班打卡。' }]);
}

async function doCheckIn(emp, client, replyToken, loc, gps) {
  const today = await db.getTodayCheckins(emp.id);
  if (today.some(r => r.type === 'check_in')) {
    return client.replyMessage(replyToken, [{ type: 'text', text: '⚠️ 今天已上班打卡。' }]);
  }
  const r = await db.recordCheckin(emp.id, 'check_in', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const now = r.check_time ? new Date(r.check_time) : new Date();
  let msg = '✅ 上班打卡成功！\n⏰ ' + fmt(now);
  const late = checkLate(now);
  if (late > 0) msg += '\n⚠️ 遲到 ' + late + ' 分鐘';
  if (loc) msg += '\n📍 ' + (loc.address || loc.latitude + ',' + loc.longitude);
  if (gps && !gps.inRange) msg += '\n⚠️ 你不在公司範圍內（距離 ' + gps.distance + ' 公尺）';
  return client.replyMessage(replyToken, [{ type: 'text', text: msg }]);
}

async function doCheckOut(emp, client, replyToken, loc, gps) {
  const today = await db.getTodayCheckins(emp.id);
  if (!today.some(r => r.type === 'check_in')) return client.replyMessage(replyToken, [{ type: 'text', text: '⚠️ 尚未上班打卡。' }]);
  if (today.some(r => r.type === 'check_out')) return client.replyMessage(replyToken, [{ type: 'text', text: '⚠️ 今天已下班打卡。' }]);
  const r = await db.recordCheckin(emp.id, 'check_out', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const ci = new Date(today.find(r => r.type === 'check_in').check_time);
  const co = r.check_time ? new Date(r.check_time) : new Date();
  const h = Math.round(Math.max(0, (co - ci) / 3600000) * 10) / 10;
  let msg = '✅ 下班打卡成功！\n⏰ ' + fmt(co) + '\n📊 今日工時：約 ' + h + ' 小時';
  if (loc) msg += '\n📍 ' + (loc.address || loc.latitude + ',' + loc.longitude);
  if (gps && !gps.inRange) msg += '\n⚠️ 你不在公司範圍內（距離 ' + gps.distance + ' 公尺）';
  msg += '\n\n辛苦了！🏠';
  return client.replyMessage(replyToken, [{ type: 'text', text: msg }]);
}

async function doQuery(emp, client, replyToken) {
  const records = await db.getTodayCheckins(emp.id);
  if (records.length === 0) return client.replyMessage(replyToken, [{ type: 'text', text: '📋 ' + emp.name + ' 今日尚無記錄。' }]);
  let msg = '📋 ' + emp.name + ' 今日記錄\n\n';
  for (const r of records) {
    msg += (r.type === 'check_in' ? '🔵上班' : '🔴下班') + '：' + fmt(new Date(r.check_time)) + '\n';
    if (r.address) msg += '   📍' + r.address + '\n';
    if (r.in_range === false) msg += '   ⚠️ 超出公司範圍\n';
  }
  return client.replyMessage(replyToken, [{ type: 'text', text: msg }]);
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
