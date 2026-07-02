const db = require('./database');
const states = new Map();

const GPS_BUTTONS = {
  items: [
    { type: 'action', action: { type: 'location', label: '📍 上班打卡' } },
    { type: 'action', action: { type: 'location', label: '📍 下班打卡' } },
    { type: 'action', action: { type: 'message', label: '📋 查詢', text: '查詢' } },
    { type: 'action', action: { type: 'message', label: '🏖 請假', text: '請假' } },
    { type: 'action', action: { type: 'message', label: '🕐 加班', text: '加班' } },
    { type: 'action', action: { type: 'message', label: '📝 補打卡', text: '補打卡' } },
  ]
};
const APPROVER_BUTTONS = {
  items: [
    { type: 'action', action: { type: 'location', label: '📍 上班打卡' } },
    { type: 'action', action: { type: 'location', label: '📍 下班打卡' } },
    { type: 'action', action: { type: 'message', label: '📋 查詢', text: '查詢' } },
    { type: 'action', action: { type: 'message', label: '🏖 請假', text: '請假' } },
    { type: 'action', action: { type: 'message', label: '🕐 加班', text: '加班' } },
    { type: 'action', action: { type: 'message', label: '📝 補打卡', text: '補打卡' } },
    { type: 'action', action: { type: 'message', label: '✅ 核准全部', text: '核准全部' } },
    { type: 'action', action: { type: 'message', label: '❌ 駁回全部', text: '駁回全部' } },
  ]
};

function getMenu(emp) { return (emp && emp.can_approve) ? APPROVER_BUTTONS : GPS_BUTTONS; }
function withMenu(text, emp) { return { type: 'text', text: text, quickReply: emp ? getMenu(emp) : GPS_BUTTONS }; }
// 文字 + 選單 + 日期時間選擇器（保留選單按鈕）
function withDatePicker(text, data) {
  var items = [];
  items.push({ type: 'action', action: { type: 'datetimepicker', label: '📅 點我選日期時間', data: data, mode: 'datetime' } });
  items = items.concat(GPS_BUTTONS.items);
  return { type: 'text', text: text, quickReply: { items: items } };
}

async function handleEvents(events, client) {
  console.log('[bot] events:', events.length, events.map(function(e){return e.type+':'+(e.message?e.message.type:'');}));
  for (const evt of events) {
    try {
      if (evt.source.type !== 'user') continue;
      const uid = evt.source.userId;
      if (evt.type === 'follow') {
        const emp = await db.getEmployeeByLineId(uid);
        if (emp) {
          await client.pushMessage(uid, [withMenu('歡迎回來，' + emp.name + '！🎉\n\n📍 傳送位置訊息 → GPS 打卡\n💬 下方選單可直接點選')]);
        } else {
          await client.pushMessage(uid, [{ type: 'text', text: '👋 歡迎使用公司打卡系統！\n\n🔹 請輸入「員工編號」綁定帳號\n🔹 或輸入「我的ID」取得 LINE ID\n\n📌 請洽管理員取得員工編號', quickReply: GPS_BUTTONS }]);
        }
      }
      if (evt.type === 'message' && evt.message) {
        if (evt.message.type === 'text') await handleText(evt.message.text, uid, client, evt.replyToken);
        else if (evt.message.type === 'location') { console.log('[bot] location msg:', evt.message.latitude, evt.message.longitude, evt.message.address || 'no-addr'); await handleLocation(evt.message, uid, client, evt.replyToken); }
      }
      if (evt.type === 'postback') await handlePostback(evt.postback, uid, client, evt.replyToken);
    } catch (e) { console.error('[bot] error:', e.message, e.originalError && e.originalError.response && e.originalError.response.data ? JSON.stringify(e.originalError.response.data) : ''); }
  }
}

// ===== Commands =====
async function handleText(text, uid, client, replyToken) {
  const emp = await db.getEmployeeByLineId(uid);
  const cmd = text.trim();

  if (!emp) {
    if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
      return client.replyMessage(replyToken, [withMenu('🆔 你的 LINE User ID：\n\n' + uid + '\n\n請提供給管理員在後台綁定。')]);
    }
    let name = '';
    try { const p = await client.getProfile(uid); name = p.displayName; } catch (e) {}
    const ok = await db.bindLineUser(cmd, uid, name);
    return client.replyMessage(replyToken, [withMenu(ok
      ? '✅ 綁定成功！歡迎，' + (name || cmd) + '\n\n📍 傳送位置訊息 → GPS 打卡\n💬 下方選單可直接點選'
      : '❌ 找不到員工編號「' + cmd + '」\n\n🆔 輸入「我的ID」取得 LINE ID 洽管理員')]);
  }

  if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
    return client.replyMessage(replyToken, [withMenu('🆔 LINE User ID：' + uid + '\n✅ 已綁定：' + emp.name + '（' + emp.employee_no + '）')]);
  }
  if (cmd === '請假' || cmd === '请假') return startLeaveFlow(uid, client, replyToken);
  if (cmd === '加班') return startOvertimeFlow(uid, client, replyToken);
  if (cmd === '補打卡' || cmd === '补打卡') return startMissedPunch(uid, client, replyToken);
  if (cmd === '核准全部') return batchApproveAll(emp, client, replyToken, 'leave');
  if (cmd === '駁回全部') return batchRejectAll(emp, client, replyToken, 'leave');
  if (cmd === '加班核准全部') return batchApproveAll(emp, client, replyToken, 'overtime');
  if (cmd === '加班駁回全部') return batchRejectAll(emp, client, replyToken, 'overtime');
  if (cmd === '取消' && states.has(uid)) { states.delete(uid); return client.replyMessage(replyToken, [withMenu('已取消操作。')]); }
  if (states.has(uid)) return handleFlow(cmd, uid, client, replyToken, emp);
  if (cmd.includes('上班')) { states.delete(uid); return doCheckIn(emp, client, replyToken); }
  if (cmd.includes('下班')) { states.delete(uid); return doCheckOut(emp, client, replyToken); }
  if (cmd.includes('查詢') || cmd.includes('記錄')) return doQuery(emp, client, replyToken);
  if (cmd.includes('幫助')) return client.replyMessage(replyToken, [withMenu('📖 功能選單\n📍傳位置→打卡 🏖請假 🕐加班\n📋查詢 🆔我的ID\n✅核准全部 ❌駁回全部')]);
  return client.replyMessage(replyToken, [withMenu('請點選下方選單，或輸入：上班 / 下班 / 查詢 / 請假 / 加班 / 我的ID')]);
}

function fmt(d) {
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  var h = d.getHours(), min = d.getMinutes();
  return y + ' ' + m + '月' + day + '日 ' + String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

async function startMissedPunch(uid, client, replyToken) {
  states.set(uid, { flow: "missed", step: "type" });
  return client.replyMessage(replyToken, [{
    type: "text", text: "📝 補打卡申請\n\n請選擇補打卡類型：",
    quickReply: { items: [
      { type: "action", action: { type: "message", label: "🔵 補上班卡", text: "補上班" } },
      { type: "action", action: { type: "message", label: "🔴 補下班卡", text: "補下班" } },
      { type: "action", action: { type: "message", label: "取消", text: "取消" } }
    ]}}]);
}

async function batchApproveAll(emp, client, replyToken, type) {
  if (!emp.can_approve) return client.replyMessage(replyToken, [withMenu('❌ 無簽核權限')]);
  var requests = type === 'overtime' ? await db.getOvertimeRequests('pending', 200) : await db.getLeaveRequests('pending', 200);
  var count = 0;
  for (var i = 0; i < requests.length; i++) {
    var r = requests[i];
    var reqEmp = await db.getEmployeeById(r.employee_id);
    if (!reqEmp) continue;
    var designated = reqEmp.approver_id === emp.id || reqEmp.approver2_id === emp.id || reqEmp.approver3_id === emp.id;
    if (!reqEmp.approver_id && !reqEmp.approver2_id && !reqEmp.approver3_id) designated = true;
    if (designated || emp.can_approve) {
      if (type === 'overtime') await db.updateOvertimeStatus(r.id, 'approved', emp.id);
      else await db.updateLeaveStatus(r.id, 'approved', emp.id);
      count++;
    }
  }
  return client.replyMessage(replyToken, [withMenu('✅ 已核准 ' + count + ' 筆' + (type === 'overtime' ? '加班' : '請假') + '申請')]);
}

async function batchRejectAll(emp, client, replyToken, type) {
  if (!emp.can_approve) return client.replyMessage(replyToken, [withMenu('❌ 無簽核權限')]);
  var requests = type === 'overtime' ? await db.getOvertimeRequests('pending', 200) : await db.getLeaveRequests('pending', 200);
  var count = 0;
  for (var i = 0; i < requests.length; i++) {
    var r = requests[i];
    var reqEmp = await db.getEmployeeById(r.employee_id);
    if (!reqEmp) continue;
    var designated = reqEmp.approver_id === emp.id || reqEmp.approver2_id === emp.id || reqEmp.approver3_id === emp.id;
    if (!reqEmp.approver_id && !reqEmp.approver2_id && !reqEmp.approver3_id) designated = true;
    if (designated || emp.can_approve) {
      if (type === 'overtime') await db.updateOvertimeStatus(r.id, 'rejected', emp.id);
      else await db.updateLeaveStatus(r.id, 'rejected', emp.id);
      count++;
    }
  }
  return client.replyMessage(replyToken, [withMenu('已駁回 ' + count + ' 筆' + (type === 'overtime' ? '加班' : '請假') + '申請')]);
}

// ===== GPS location handler =====
async function handleLocation(msg, uid, client, replyToken) {
  var emp = await db.getEmployeeByLineId(uid);
  if (!emp) return client.replyMessage(replyToken, [withMenu('請先綁定員工編號。')]);
  var today = await db.getTodayCheckins(emp.id);
  var hasIn = today.some(function(r) { return r.type === 'check_in'; });
  var hasOut = today.some(function(r) { return r.type === 'check_out'; });
  var loc = { latitude: msg.latitude, longitude: msg.longitude, address: msg.address || '' };
  var gps = await checkGpsRange(msg.latitude, msg.longitude);
  if (hasIn && !hasOut) return doCheckOut(emp, client, replyToken, loc, gps);
  if (!hasIn) return doCheckIn(emp, client, replyToken, loc, gps);
  return client.replyMessage(replyToken, [withMenu('今日已完成打卡。')]);
}

// ===== Check-in Flex =====
async function doCheckIn(emp, client, replyToken, loc, gps) {
  const today = await db.getTodayCheckins(emp.id);
  if (today.some(r => r.type === 'check_in')) {
    return client.replyMessage(replyToken, [withMenu('⚠️ 今天已上班打卡')]);
  }
  const r = await db.recordCheckin(emp.id, 'check_in', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const now = r.check_time ? new Date(r.check_time) : new Date();
  const late = await checkLate(now);

  var contents = [
    { type: 'text', text: '✅ 上班打卡成功', weight: 'bold', size: 'lg', color: '#06c755' },
    { type: 'text', text: '👤 ' + emp.name + '  ' + emp.employee_no, margin: 'md', size: 'sm', color: '#666666' },
    { type: 'text', text: '⏰ ' + fmt(now), margin: 'md', size: 'xl', weight: 'bold' },
  ];
  if (late > 0) contents.push({ type: 'text', text: '⚠️ 遲到 ' + late + ' 分鐘', margin: 'sm', color: '#e74c3c', size: 'sm' });
  if (loc) {
    var locText = '📍 ' + (loc.address || loc.latitude.toFixed(4) + ', ' + loc.longitude.toFixed(4));
    if (gps && !gps.inRange) locText += '\n⚠️ 不在公司範圍（' + gps.distance + 'm）';
    contents.push({ type: 'text', text: locText, margin: 'sm', size: 'sm', color: '#999999', wrap: true });
  } else {
    contents.push({ type: 'text', text: '⚠️ 未提供 GPS 位置', margin: 'sm', color: '#f39c12', size: 'xs' });
  }

  return client.replyMessage(replyToken, [{
    type: 'flex', altText: '✅ 上班打卡成功 ' + fmt(now),
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: contents } },
    quickReply: GPS_BUTTONS
  }]);
}

async function doCheckOut(emp, client, replyToken, loc, gps) {
  const today = await db.getTodayCheckins(emp.id);
  if (!today.some(r => r.type === 'check_in')) return client.replyMessage(replyToken, [withMenu('⚠️ 尚未上班打卡')]);
  if (today.some(r => r.type === 'check_out')) return client.replyMessage(replyToken, [withMenu('⚠️ 今天已下班打卡')]);

  const r = await db.recordCheckin(emp.id, 'check_out', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const ci = new Date(today.find(r => r.type === 'check_in').check_time);
  const co = r.check_time ? new Date(r.check_time) : new Date();
  const h = Math.round(Math.max(0, (co - ci) / 3600000) * 10) / 10;
  const requiredHours = 8;

  var contents = [
    { type: 'text', text: '🏠 下班打卡成功', weight: 'bold', size: 'lg', color: '#3498db' },
    { type: 'text', text: '👤 ' + emp.name + '  ' + emp.employee_no, margin: 'md', size: 'sm', color: '#666666' },
    { type: 'text', text: '⏰ ' + fmt(co), margin: 'md', size: 'xl', weight: 'bold' },
    { type: 'text', text: '📊 今日工時：約 ' + h + ' 小時', margin: 'sm', size: 'sm' },
  ];
  if (co < new Date(ci.getTime() + requiredHours * 3600000)) {
    contents.push({ type: 'text', text: '⚠️ 工時不足 ' + requiredHours + ' 小時\n請記得申請請假補足時數', margin: 'sm', color: '#f39c12', size: 'sm', wrap: true });
  }
  if (loc) {
    var locText = '📍 ' + (loc.address || loc.latitude.toFixed(4) + ', ' + loc.longitude.toFixed(4));
    if (gps && !gps.inRange) locText += '\n⚠️ 不在公司範圍（' + gps.distance + 'm）';
    contents.push({ type: 'text', text: locText, margin: 'sm', size: 'sm', color: '#999999', wrap: true });
  } else {
    contents.push({ type: 'text', text: '⚠️ 未提供 GPS 位置', margin: 'sm', color: '#f39c12', size: 'xs' });
  }

  return client.replyMessage(replyToken, [{
    type: 'flex', altText: '🏠 下班打卡成功 ' + fmt(co),
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: contents } },
    quickReply: GPS_BUTTONS
  }]);
}

// ===== Query Flex =====
async function doQuery(emp, client, replyToken) {
  var now = new Date();
  var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');

  // 打卡記錄
  var records = await db.getTodayCheckins(emp.id);
  // 請假記錄
  var myLeaves = await db.getEmployeeLeaveRequests(emp.id, null, 50);

  var contents = [
    { type: 'text', text: '📋 ' + emp.name + ' 今日概況', weight: 'bold', size: 'lg', color: '#06c755' },
  ];

  // 打卡區
  var checkIn = records.find(r => r.type === 'check_in');
  var checkOut = records.find(r => r.type === 'check_out');
  var punchText = '🔵 上班：' + (checkIn ? fmt(new Date(checkIn.check_time)) : '--:--');
  if (checkIn && checkIn.address) punchText += '\n   📍' + checkIn.address;
  punchText += '\n🔴 下班：' + (checkOut ? fmt(new Date(checkOut.check_time)) : '--:--');
  if (checkOut && checkOut.address) punchText += '\n   📍' + checkOut.address;
  if (checkIn && checkOut) {
    var workH = Math.round(Math.max(0, (new Date(checkOut.check_time) - new Date(checkIn.check_time)) / 3600000) * 10) / 10;
    punchText += '\n📊 ' + workH + 'h' + (workH < 8 ? ' ⚠️不足8h' : '');
  }
  contents.push({ type: 'text', text: punchText, margin: 'md', size: 'sm', wrap: true });

  // 請假區（安全轉換日期 → 字串）
  function sd(v) { return typeof v === 'string' ? v : (v ? new Date(v).toISOString().split('T')[0] : ''); }
  var leaves = myLeaves.filter(function(l) { var s = sd(l.start_date); return s && s.indexOf(thisMonth) === 0; });
  var monthHours = 0, totalHours = 0;
  for (var i = 0; i < myLeaves.length; i++) {
    var l = myLeaves[i];
    if (l.status !== 'approved') continue;
    var h2 = leaveHours(l.start_date, l.end_date);
    if (h2 === 0) h2 = 1;
    var s = sd(l.start_date);
    if (s && s.indexOf(thisMonth) === 0) monthHours += h2;
    totalHours += h2;
  }
  if (myLeaves.length > 0) {
    contents.push({ type: 'separator', margin: 'md' });
    var leaveText = '🏖 本月請假：' + monthHours + ' 小時（已核准）\n📅 累計請假：' + totalHours + ' 小時';
    var pendingCount = myLeaves.filter(function(l) { return l.status === 'pending'; }).length;
    if (pendingCount > 0) leaveText += '\n⏳ 待審核：' + pendingCount + ' 筆';
    contents.push({ type: 'text', text: leaveText, margin: 'md', size: 'sm', color: '#f39c12', wrap: true });
  }

  contents.push({ type: 'separator', margin: 'md' });
  contents.push({ type: 'text', text: '💡 輸入「請假」申請 │ 點下方選單操作', size: 'xs', color: '#aaaaaa', margin: 'md' });

  return client.replyMessage(replyToken, [{
    type: 'flex', altText: '📋 今日打卡記錄',
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: contents } },
    quickReply: GPS_BUTTONS
  }]);
}

// ===== Leave flow (unchanged) =====
const LEAVE_TYPES = { '特休': 'annual', '事假': 'personal', '病假': 'sick', '公假': 'official', '外出': 'outing', '其他': 'other' };

function ceilHours(diffMs) { return Math.ceil(Math.max(0, diffMs) / 3600000); }
// 請假時數：取整後，跨天每日最多 8 小時
function haversineDistance(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return null;
  var R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
async function checkGpsRange(lat, lng) {
  var officeLat = parseFloat(await db.getSetting('office_lat') || '0');
  var officeLng = parseFloat(await db.getSetting('office_lng') || '0');
  var range = parseInt(await db.getSetting('gps_range_meters') || '200');
  if (!officeLat || !officeLng) return { inRange: true, distance: 0 };
  var dist = haversineDistance(officeLat, officeLng, lat, lng);
  return { inRange: dist <= range, distance: dist };
}

function leaveHours(startStr, endStr) {
  if (!startStr) return 0;
  var s = new Date(startStr), e = new Date(endStr||startStr);
  var diff = e - s;
  if (diff <= 0) return 1;
  var raw = Math.ceil(diff / 3600000);
  var days = Math.ceil(diff / 86400000);
  var cap = Math.min(raw, days * 8);
  if (days <= 1 && s.getHours() < 12 && e.getHours() >= 13) cap = Math.max(1, cap - 1);
  return cap;
}

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
        { type: 'action', action: { type: 'message', label: '外出', text: '外出' } },
        { type: 'action', action: { type: 'message', label: '其他', text: '其他' } },
        { type: 'action', action: { type: 'message', label: '取消', text: '取消' } },
      ]
    }
  }]);
}

function validateOvertimeTime(dt) {
  var d = new Date(dt);
  var h = d.getHours(), m = d.getMinutes();
  var totalMin = h * 60 + m;
  return totalMin >= 1050 && totalMin <= 1380;
}

async function startOvertimeFlow(uid, client, replyToken) {
  states.set(uid, { flow: "overtime", step: "start" });
  return client.replyMessage(replyToken, [withDatePicker("🕐 加班申請\n\n請選擇「開始日期時間」", "ot_start")]);
}

async function handleFlow(text, uid, client, replyToken, emp) {
  const state = states.get(uid);
  // 補打卡先處理，避免被請假攔截
  if (state.flow === "missed") {
    if (state.step === "type") {
      if (text === "取消") { states.delete(uid); return client.replyMessage(replyToken, [withMenu("已取消")]); }
      var pt = text === "補上班" ? "check_in" : text === "補下班" ? "check_out" : null;
      if (!pt) return client.replyMessage(replyToken, [withMenu("請選擇補上班或補下班")]);
      state.punchType = pt; state.step = "dt";
      var items = [{ type: 'action', action: { type: 'datetimepicker', label: '📅 選擇日期時間', data: 'missed_dt', mode: 'datetime' } }];
      for (var k = 0; k < GPS_BUTTONS.items.length; k++) items.push(GPS_BUTTONS.items[k]);
      return client.replyMessage(replyToken, [{ type: 'text', text: '📝 請選擇補卡日期時間', quickReply: { items: items } }]);
    }
    if (state.step === "reason") {
      state.reason = text;
      try {
        var mpId = await db.createMissedPunch(emp.id, state.punchType, state.punchDate, state.punchTime, state.reason);
        states.delete(uid);
        var approvers = await db.findApprovers(emp.id);
        for (var j = 0; j < approvers.length; j++) {
          await client.pushMessage(approvers[j].line_user_id, [{
            type: "flex", altText: "📝 補打卡申請",
            contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: [
              { type: "text", text: "📝 補打卡申請", weight: "bold", size: "lg", color: "#f39c12" },
              { type: "text", text: "員工：" + emp.name, margin: "md", size: "sm" },
              { type: "text", text: "類型：" + (state.punchType === "check_in" ? "🔵補上班" : "🔴補下班"), margin: "sm", size: "sm" },
              { type: "text", text: "日期：" + state.punchDate + " " + state.punchTime, margin: "sm", size: "sm" },
              { type: "text", text: "原因：" + state.reason, margin: "sm", size: "sm", wrap: true },
            ]}, footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
              { type: "button", style: "primary", color: "#06c755", action: { type: "postback", label: "核准", data: "mp_approve_" + mpId }, flex: 1, height: "sm" },
              { type: "button", style: "secondary", color: "#e74c3c", action: { type: "postback", label: "駁回", data: "mp_reject_" + mpId }, flex: 1, height: "sm" },
            ]}}
          }]);
        }
        return client.replyMessage(replyToken, [withMenu("✅ 補打卡申請已送出！\n\n" + (state.punchType === "check_in" ? "🔵補上班" : "🔴補下班") + "\n日期：" + state.punchDate + " " + state.punchTime + "\n⏳ 等待簽核")]);
      } catch(e) { console.error(e); states.delete(uid); return client.replyMessage(replyToken, [withMenu("❌ 申請失敗")]); }
    }
    return;
  }
  if (state.step === 'type') {
    if (text === '取消') { states.delete(uid); return client.replyMessage(replyToken, [withMenu('已取消請假。')]); }
    const type = LEAVE_TYPES[text];
    if (!type) return client.replyMessage(replyToken, [withMenu('請選擇假別，或點「取消」退出')]);
    state.type = type; state.typeLabel = text; state.step = 'start_date';
    return client.replyMessage(replyToken, [withDatePicker('🏖 請假：選擇「開始日期時間」\n\n選日期時間後請點「傳送」', 'leave_start')]);
  }
  if (state.flow === "overtime" && state.step === 'reason') {
    state.reason = text;
    try {
      var otId = await db.createOvertimeRequest(emp.id, state.otStart, state.otEnd, state.reason);
      states.delete(uid);
      var approvers = await db.findApprovers(emp.id);
      for (var j = 0; j < approvers.length; j++) {
        await client.pushMessage(approvers[j].line_user_id, [{
          type: "flex", altText: "🕐 " + emp.name + " 加班申請",
          contents: { type: "bubble",
            body: { type: "box", layout: "vertical", contents: [
              { type: "text", text: "🕐 加班申請", weight: "bold", size: "lg", color: "#f39c12" },
              { type: "text", text: "員工：" + emp.name + "（" + emp.employee_no + "）", margin: "md", size: "sm", color: "#666666" },
              { type: "text", text: "時間：" + state.otStart + " ~ " + state.otEnd, margin: "sm", size: "sm" },
              { type: "text", text: "原因：" + state.reason, margin: "sm", size: "sm", wrap: true, color: "#666666" },
            ]},
            footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
              { type: "button", style: "primary", color: "#06c755", action: { type: "postback", label: "核准", data: "ot_approve_" + otId }, flex: 1, height: "sm" },
              { type: "button", style: "secondary", color: "#e74c3c", action: { type: "postback", label: "駁回", data: "ot_reject_" + otId }, flex: 1, height: "sm" },
            ]}
          }
        }]);
      }
      return client.replyMessage(replyToken, [{
        type: "text", text: "✅ 加班申請已送出！\n\n時間：" + state.otStart + " ~ " + state.otEnd + "\n原因：" + state.reason + "\n\n⏳ 等待第1階簽核：" + (approvers.length > 0 ? approvers[0].name : '') + " ⏳",
        quickReply: GPS_BUTTONS
      }]);
    } catch(e) { console.error('[ot] error:', e); states.delete(uid); return client.replyMessage(replyToken, [withMenu("❌ 申請失敗")]); }
  }
  if (!state.flow && state.step === 'reason') {
    state.reason = text;
    try {
      const leaveId = await db.createLeaveRequest(emp.id, state.type, state.startDateTime, state.endDateTime, state.reason);
      states.delete(uid);
      const approvers = await db.findApprovers(emp.id);
      if (approvers.length > 0) {
        var hours = leaveHours(state.startDateTime, state.endDateTime);
        var st2 = new Date(state.startDateTime), et2 = new Date(state.endDateTime);
        for (const appr of approvers) {
          await client.pushMessage(appr.line_user_id, [{
            type: 'flex', altText: '📋 ' + emp.name + ' 請假申請',
            contents: {
              type: 'bubble',
              body: { type: 'box', layout: 'vertical', contents: [
                { type: 'text', text: '📋 請假申請', weight: 'bold', size: 'lg', color: '#f39c12' },
                { type: 'text', text: '員工：' + emp.name + '（' + emp.employee_no + '）', margin: 'md', size: 'sm', color: '#666666' },
                { type: 'text', text: '假別：' + state.typeLabel, margin: 'sm', size: 'sm' },
                { type: 'text', text: '時間：' + fmt(st2) + ' ~ ' + fmt(et2) + '（' + hours + ' 小時）', margin: 'sm', size: 'sm' },
                { type: 'text', text: '原因：' + state.reason, margin: 'sm', size: 'sm', wrap: true, color: '#666666' },
                { type: 'text', text: '申請時間：' + fmt(new Date()), margin: 'sm', size: 'xs', color: '#aaaaaa' },
              ]},
              footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
                { type: 'button', style: 'primary', color: '#06c755', action: { type: 'postback', label: '核准', data: 'leave_approve_' + leaveId }, flex: 1, height: 'sm' },
                { type: 'button', style: 'secondary', color: '#e74c3c', action: { type: 'postback', label: '駁回', data: 'leave_reject_' + leaveId }, flex: 1, height: 'sm' },
              ]}
            }
          }]);
        }
      }
      return client.replyMessage(replyToken, [
        { type: 'flex', altText: '✅ 請假已送出',
          contents: { type: 'bubble',
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '✅ 請假申請已送出', weight: 'bold', size: 'lg', color: '#06c755' },
              { type: 'text', text: '假別：' + state.typeLabel, margin: 'md', size: 'sm' },
              { type: 'text', text: '時間：' + state.startDateTime + ' ~ ' + state.endDateTime, margin: 'sm', size: 'sm' },
              { type: 'text', text: '原因：' + state.reason, margin: 'sm', size: 'sm', color: '#666666', wrap: true },
              { type: 'text', text: '⏳ 等待第1階簽核：' + (approvers.length > 0 ? approvers[0].name : ''), margin: 'md', size: 'sm', color: '#f39c12' }
            ]}
	          },
	          quickReply: GPS_BUTTONS
	        }
      ]);
    } catch (e) {
      console.error('[leave] error:', e); states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('❌ 申請失敗，請稍後再試。')]);
    }
  }
}

// ===== Postback =====
async function handlePostback(postback, uid, client, replyToken) {
  const data = postback.data || '', params = postback.params || {};

  // Leave date pickers
  if (data === 'leave_start') {
    var state = states.get(uid);
    if (!state || state.step !== 'start_date') return;
    var dt = params.datetime || (params.date ? params.date + ' ' + (params.time || '00:00') : null);
    if (!dt) return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 日期錯誤' }]);
    state.startDateTime = dt; state.step = 'end_date';
    return client.replyMessage(replyToken, [withDatePicker('📅 開始：' + dt + '\n\n請選擇「結束日期時間」', 'leave_end')]);
  }
  if (data === 'leave_end') {
    var state = states.get(uid);
    if (!state || state.step !== 'end_date') return;
    var dt = params.datetime || (params.date ? params.date + ' ' + (params.time || '00:00') : null);
    if (!dt) return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 日期錯誤' }]);
    // 檢查結束 ≥ 開始
    if (new Date(dt) < new Date(state.startDateTime)) {
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('❌ 結束時間必須在開始時間之後')]);
    }
    // 檢查請假日期是否與已打卡記錄重複
    var leaveStartDate = state.startDateTime.indexOf(' ') !== -1 ? state.startDateTime.split(' ')[0] : state.startDateTime.split('T')[0];
    var leaveEndDate = dt.indexOf(' ') !== -1 ? dt.split(' ')[0] : dt.split('T')[0];
    var leaveEmp = await db.getEmployeeByLineId(uid);
    if (leaveEmp) {
      var overlapCheckins = await db.queryCheckins(leaveEmp.id, leaveStartDate, leaveEndDate, 100, 0);
      if (overlapCheckins.length > 0) {
        states.delete(uid);
        return client.replyMessage(replyToken, [withMenu('❌ ' + leaveStartDate + ' ~ ' + leaveEndDate + ' 期間已有打卡記錄\n\n請先刪除打卡記錄，或使用「補打卡」功能')]);
      }
    }
    state.endDateTime = dt; state.step = 'reason';
    var hours = leaveHours(state.startDateTime, dt);
    return client.replyMessage(replyToken, [withMenu('📅 ' + state.startDateTime + ' ~ ' + dt + '（' + hours + ' 小時）\n\n📝 請輸入請假原因：')]);
  }

  // Overtime date pickers
  if (data === 'ot_start') {
    var state = states.get(uid);
    if (!state || state.flow !== 'overtime' || state.step !== 'start') return;
    var dt = params.datetime || (params.date ? params.date + ' ' + (params.time || '00:00') : null);
    if (!dt) return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 日期錯誤' }]);
    state.otStart = dt; state.step = 'end';
    return client.replyMessage(replyToken, [withDatePicker('🕐 開始：' + dt + '\n\n請選擇「結束日期時間」', 'ot_end')]);
  }
  if (data === 'ot_end') {
    var state = states.get(uid);
    if (!state || state.flow !== 'overtime' || state.step !== 'end') return;
    var dt = params.datetime || (params.date ? params.date + ' ' + (params.time || '00:00') : null);
    if (!dt) return client.replyMessage(replyToken, [{ type: 'text', text: '❌ 日期錯誤' }]);
    // 驗證加班時間範圍（17:30~23:00）
    if (!validateOvertimeTime(state.otStart) || !validateOvertimeTime(dt)) {
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu("❌ 加班時間限於 17:30 ~ 23:00")]);
    }
    state.otEnd = dt; state.step = 'reason';
    return client.replyMessage(replyToken, [withMenu('🕐 ' + state.otStart + ' ~ ' + dt + '\n\n📝 請輸入加班原因：')]);
  }
  if (data === "missed_dt") {
    var state = states.get(uid);
    if (!state || state.flow !== "missed" || state.step !== "dt") return;
    var dt = params.datetime || (params.date ? params.date + "T" + (params.time || "00:00") : null);
    if (!dt) return client.replyMessage(replyToken, [{ type: "text", text: "❌ 日期時間錯誤" }]);
    // datetime 可能是 "2026-06-16T14:30" 格式
    var sep = dt.indexOf("T") !== -1 ? "T" : " ";
    var parts = dt.split(sep);
    state.punchDate = parts[0];
    state.punchTime = parts[1] || "00:00";
    // 驗證補打卡時間（移到輸入原因前）
    var punchDt = new Date(state.punchDate + 'T' + state.punchTime + ':00');
    var now2 = new Date();
    if (punchDt > now2) { states.delete(uid); return client.replyMessage(replyToken, [withMenu('❌ 不能補打卡未來時間')]); }
    var threeDaysAgo = new Date(now2);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    threeDaysAgo.setHours(0, 0, 0, 0);
    if (punchDt < threeDaysAgo) { states.delete(uid); return client.replyMessage(replyToken, [withMenu('❌ 只能補打 3 天內的卡')]); }
    var emp2 = await db.getEmployeeByLineId(uid);
    var todayCheckins = await db.queryCheckins(emp2.id, state.punchDate, state.punchDate, 10, 0);
    var alreadyIn2 = todayCheckins.some(function(r) { return r.type === 'check_in'; });
    var alreadyOut2 = todayCheckins.some(function(r) { return r.type === 'check_out'; });
    if (state.punchType === 'check_in' && alreadyIn2) { states.delete(uid); return client.replyMessage(replyToken, [withMenu('❌ 當天已有上班打卡記錄')]); }
    if (state.punchType === 'check_out' && alreadyOut2) { states.delete(uid); return client.replyMessage(replyToken, [withMenu('❌ 當天已有下班打卡記錄')]); }
    state.step = "reason";
    return client.replyMessage(replyToken, [withMenu("📝 補打卡：" + state.punchDate + " " + state.punchTime + "\n\n請輸入原因：")]);
  }

  // Missed punch approval
  if (data.indexOf("mp_approve_") === 0 || data.indexOf("mp_reject_") === 0) {
    var mpId = parseInt(data.split("_").pop());
    var mpApprover = await db.getEmployeeByLineId(uid);
    var mp = await db.getMissedPunchById(mpId);
    if (!mpApprover || !mp) return client.replyMessage(replyToken, [withMenu("❌ 無效請求")]);
    var mpEmp = await db.getEmployeeById(mp.employee_id);
    var mpDesignated = mpEmp && (mpEmp.approver_id===mpApprover.id || mpEmp.approver2_id===mpApprover.id || mpEmp.approver3_id===mpApprover.id);
    if (!mpApprover.can_approve && !mpDesignated) return client.replyMessage(replyToken, [withMenu("❌ 無簽核權限")]);
    if (mp.status !== "pending") return client.replyMessage(replyToken, [withMenu("已處理過")]);
    if (data.indexOf("mp_approve_") === 0) {
      await db.updateMissedPunchStatus(mpId, "approved", mpApprover.id);
      if (mpEmp && mpEmp.line_user_id) await client.pushMessage(mpEmp.line_user_id, [{ type: "text", text: "🎉 補打卡已核准！\n" + mp.punch_date + " " + mp.punch_time }]);
      return client.replyMessage(replyToken, [withMenu("✅ 已核准")]);
    } else {
      await db.updateMissedPunchStatus(mpId, "rejected", mpApprover.id);
      if (mpEmp && mpEmp.line_user_id) await client.pushMessage(mpEmp.line_user_id, [{ type: "text", text: "❌ 補打卡被駁回\n" + mp.punch_date + " " + mp.punch_time }]);
      return client.replyMessage(replyToken, [withMenu("已駁回")]);
    }
  }
  if (data.indexOf('leave_approve_') === 0 || data.indexOf('leave_reject_') === 0) {
    var leaveId = parseInt(data.split('_').pop());
    var approver = await db.getEmployeeByLineId(uid);
    var leave = await db.getLeaveById(leaveId);
    if (!approver || !leave) return client.replyMessage(replyToken, [withMenu('❌ 無效請求')]);
    var leaveEmp = await db.getEmployeeById(leave.employee_id);
    var isDesignated = leaveEmp && (leaveEmp.approver_id===approver.id || leaveEmp.approver2_id===approver.id || leaveEmp.approver3_id===approver.id);
    if (!approver.can_approve && !isDesignated) return client.replyMessage(replyToken, [withMenu('❌ 無簽核權限')]);
    if (leave.status !== 'pending') return client.replyMessage(replyToken, [withMenu('申請已處理過')]);

    if (data.indexOf('leave_approve_') === 0) {
      var result = await db.updateLeaveStatus(leaveId, 'approved', approver.id);
      if (result && result.advanced) {
        for (var n = 0; n < result.approvers.length; n++) {
          await client.pushMessage(result.approvers[n].line_user_id, [{
            type: 'flex', altText: '📋 請假申請（第'+result.level+'階）',
            contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '📋 請假申請（第'+result.level+'階簽核）', weight: 'bold', size: 'lg', color: '#f39c12' },
              { type: 'text', text: '員工：' + leaveEmp.name, margin: 'md', size: 'sm', color: '#666666' },
              { type: 'text', text: '時間：' + leave.start_date + ' ~ ' + leave.end_date, margin: 'sm', size: 'sm' },
            ]}, footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
              { type: 'button', style: 'primary', color: '#06c755', action: { type: 'postback', label: '核准', data: 'leave_approve_' + leaveId }, flex: 1, height: 'sm' },
              { type: 'button', style: 'secondary', color: '#e74c3c', action: { type: 'postback', label: '駁回', data: 'leave_reject_' + leaveId }, flex: 1, height: 'sm' },
            ]}}
          }]);
        }
        if (leaveEmp && leaveEmp.line_user_id) await client.pushMessage(leaveEmp.line_user_id, [{ type: "text", text: "📋 請假進度\n\n已通過第"+(result.level-1)+"階，等待第"+result.level+"階：" + result.approvers[0].name + "\n時間：" + leave.start_date + " ~ " + leave.end_date }]);
        return client.replyMessage(replyToken, [withMenu('✅ 已核准，已送第'+result.level+'階簽核')]);
      }
      if (leaveEmp && leaveEmp.line_user_id) {
        await client.pushMessage(leaveEmp.line_user_id, [{ type: 'text', text: '🎉 請假已核准！\n' + leave.start_date + ' ~ ' + leave.end_date }]);
      }
      return client.replyMessage(replyToken, [withMenu('✅ 已核准')]);
    } else {
      await db.updateLeaveStatus(leaveId, 'rejected', approver.id);
      if (leaveEmp && leaveEmp.line_user_id) {
        await client.pushMessage(leaveEmp.line_user_id, [{ type: 'text', text: '❌ 請假被駁回\n' + leave.start_date + ' ~ ' + leave.end_date }]);
      }
      return client.replyMessage(replyToken, [withMenu('已駁回')]);
    }
  }

  // Overtime approval
  if (data.indexOf('ot_approve_') === 0 || data.indexOf('ot_reject_') === 0) {
    var otId = parseInt(data.split('_').pop());
    var otApprover = await db.getEmployeeByLineId(uid);
    var ot = await db.getOvertimeById(otId);
    if (!otApprover || !ot) return client.replyMessage(replyToken, [withMenu('❌ 無效請求')]);
    var otEmp = await db.getEmployeeById(ot.employee_id);
    var otDesignated = otEmp && (otEmp.approver_id===otApprover.id || otEmp.approver2_id===otApprover.id || otEmp.approver3_id===otApprover.id);
    if (!otApprover.can_approve && !otDesignated) return client.replyMessage(replyToken, [withMenu('❌ 無簽核權限')]);
    if (ot.status !== 'pending') return client.replyMessage(replyToken, [withMenu('已處理過')]);

    if (data.indexOf('ot_approve_') === 0) {
      var otResult = await db.updateOvertimeStatus(otId, 'approved', otApprover.id);
      if (otResult && otResult.advanced) {
        for (var n2 = 0; n2 < otResult.approvers.length; n2++) {
          await client.pushMessage(otResult.approvers[n2].line_user_id, [{
            type: 'flex', altText: '🕐 加班申請（第'+otResult.level+'階）',
            contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🕐 加班申請（第'+otResult.level+'階簽核）', weight: 'bold', size: 'lg', color: '#f39c12' },
              { type: 'text', text: '員工：' + otEmp.name, margin: 'md', size: 'sm', color: '#666666' },
              { type: 'text', text: '時間：' + ot.start_time + ' ~ ' + ot.end_time, margin: 'sm', size: 'sm' },
            ]}, footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
              { type: 'button', style: 'primary', color: '#06c755', action: { type: 'postback', label: '核准', data: 'ot_approve_' + otId }, flex: 1, height: 'sm' },
              { type: 'button', style: 'secondary', color: '#e74c3c', action: { type: 'postback', label: '駁回', data: 'ot_reject_' + otId }, flex: 1, height: 'sm' },
            ]}}
          }]);
        }
        if (otEmp && otEmp.line_user_id) await client.pushMessage(otEmp.line_user_id, [{ type: "text", text: "🕐 加班進度\n\n已通過第"+(otResult.level-1)+"階，等待第"+otResult.level+"階：" + otResult.approvers[0].name + "\n時間：" + ot.start_time + " ~ " + ot.end_time }]);
        return client.replyMessage(replyToken, [withMenu('✅ 已核准，已送第'+otResult.level+'階簽核')]);
      }
      if (otEmp && otEmp.line_user_id) {
        await client.pushMessage(otEmp.line_user_id, [{ type: 'text', text: '🎉 加班已核准！\n' + ot.start_time + ' ~ ' + ot.end_time }]);
      }
      return client.replyMessage(replyToken, [withMenu('✅ 已核准')]);
    } else {
      await db.updateOvertimeStatus(otId, 'rejected', otApprover.id);
      if (otEmp && otEmp.line_user_id) {
        await client.pushMessage(otEmp.line_user_id, [{ type: 'text', text: '❌ 加班被駁回\n' + ot.start_time + ' ~ ' + ot.end_time }]);
      }
      return client.replyMessage(replyToken, [withMenu('已駁回')]);
    }
  }
}

async function setupRichMenu() {
	try {
		var token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
		var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

		// Step 1: 刪除舊 Rich Menu
		var existing = await fetch('https://api.line.me/v2/bot/richmenu/list', { headers });
		var list = await existing.json();
		for (var i = 0; i < (list.richmenus || []).length; i++) {
			var rm = list.richmenus[i];
			await fetch('https://api.line.me/v2/bot/richmenu/' + rm.richMenuId, { method: 'DELETE', headers });
		}

		// Step 2: 建立新 Rich Menu
		var menu = {
			size: { width: 2500, height: 843 }, selected: true, name: '主選單', chatBarText: '📋 點此開啟功能選單',
			areas: [
				{ bounds: { x: 0, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '上班' } },
				{ bounds: { x: 625, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '下班' } },
				{ bounds: { x: 1250, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '查詢' } },
				{ bounds: { x: 1875, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '請假' } },
				{ bounds: { x: 0, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '加班' } },
				{ bounds: { x: 625, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '補打卡' } },
				{ bounds: { x: 1250, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '核准全部' } },
				{ bounds: { x: 1875, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '駁回全部' } },
			]
		};
		var res1 = await fetch('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers, body: JSON.stringify(menu) });
		var data = await res1.json();
		if (!data || !data.richMenuId) {
			console.error('[RichMenu] 建立失敗:', JSON.stringify(data));
			return { error: '建立失敗: ' + JSON.stringify(data) };
		}
		console.log('[RichMenu] 建立成功:', data.richMenuId);

		// Step 3: 上傳圖片
		var png = makePng();
		console.log('[RichMenu] PNG 大小:', png.length, 'bytes');
		var res2 = await fetch('https://api-data.line.me/v2/bot/richmenu/' + data.richMenuId + '/content', {
			method: 'POST',
			headers: { 'Content-Type': 'image/png', 'Authorization': 'Bearer ' + token },
			body: png
		});
		if (res2.status !== 200) {
			var err2 = await res2.text();
			console.error('[RichMenu] 圖片上傳失敗:', res2.status, err2);
			// 刪除已建立的 Rich Menu
			await fetch('https://api.line.me/v2/bot/richmenu/' + data.richMenuId, { method: 'DELETE', headers });
			return { error: '圖片上傳失敗 HTTP ' + res2.status + ': ' + err2 };
		}
		console.log('[RichMenu] 圖片上傳成功');

		// Step 4: 設為所有用戶預設
		var res3 = await fetch('https://api.line.me/v2/bot/user/all/richmenu/' + data.richMenuId, { method: 'POST', headers });
		if (res3.status !== 200) {
			var err3 = await res3.text();
			console.error('[RichMenu] 設定預設失敗:', res3.status, err3);
			return { error: '設定預設失敗 HTTP ' + res3.status + ': ' + err3, richMenuId: data.richMenuId };
		}
		console.log('[RichMenu] 已設為所有用戶預設');

		return { richMenuId: data.richMenuId };
	} catch (e) {
		console.error('[RichMenu] error:', e.message);
		return { error: e.message };
	}
}
function makePng() {
	var zlib = require('zlib');
	var w = 2500, h = 843;
	var d = Buffer.alloc(h * (1 + w * 4));
	for (var y = 0; y < h; y++) {
		var ro = y * (1 + w * 4);
		d[ro] = 0;
		for (var x = 0; x < w; x++) {
			var o = ro + 1 + x * 4;
			d[o] = 255; d[o+1] = 255; d[o+2] = 255; d[o+3] = 255;
		}
	}
	// Helper: draw pixel
	function p(x, y, r, g, b) {
		if (x < 0 || x >= w || y < 0 || y >= h) return;
		var o = y * (1 + w * 4) + 1 + x * 4;
		d[o] = r; d[o+1] = g; d[o+2] = b; d[o+3] = 255;
	}
	// Helper: fill rect
	function fr(x, y, w2, h2, r, g, b) {
		for (var yy = y; yy < y + h2; yy++)
			for (var xx = x; xx < x + w2; xx++)
				p(xx, yy, r, g, b);
	}
	// Helper: draw circle
	function circle(cx, cy, rad, r, g, b) {
		for (var y2 = cy - rad; y2 <= cy + rad; y2++)
			for (var x2 = cx - rad; x2 <= cx + rad; x2++)
				if (Math.pow(x2 - cx, 2) + Math.pow(y2 - cy, 2) <= Math.pow(rad, 2))
					p(x2, y2, r, g, b);
	}
	// Helper: draw line (Bresenham)
	function line(x1, y1, x2, y2, thick, r, g, b) {
		var dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
		var sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
		var err = dx - dy;
		while (true) {
			for (var ty = -Math.floor(thick/2); ty <= Math.floor(thick/2); ty++)
				for (var tx = -Math.floor(thick/2); tx <= Math.floor(thick/2); tx++)
					p(x1 + tx, y1 + ty, r, g, b);
			if (x1 === x2 && y1 === y2) break;
			var e2 = 2 * err;
			if (e2 > -dy) { err -= dy; x1 += sx; }
			if (e2 < dx) { err += dx; y1 += sy; }
		}
	}

	var bg = 248;
	fr(0, 0, w, h, bg, bg, bg);

	// ===== 上排 4 區（y: 0-421）=====
	// 1. 上班 (x: 0-625): 綠色 #06C755
	fr(0, 0, 625, 421, 6, 199, 85);
	// 2. 下班 (x: 625-1250): 橘色 #F39C12
	fr(625, 0, 625, 421, 243, 156, 18);
	// 3. 查詢 (x: 1250-1875): 藍色 #3498DB
	fr(1250, 0, 625, 421, 52, 152, 219);
	// 4. 請假 (x: 1875-2500): 青色 #1ABC9C
	fr(1875, 0, 625, 421, 26, 188, 156);

	// ===== 下排 4 區（y: 421-843）=====
	// 5. 加班 (x: 0-625): 紫色 #9B59B6
	fr(0, 421, 625, 422, 155, 89, 182);
	// 6. 補打卡 (x: 625-1250): 深藍灰 #34495E
	fr(625, 421, 625, 422, 52, 73, 94);
	// 7. 核准全部 (x: 1250-1875): 翠綠 #27AE60
	fr(1250, 421, 625, 422, 39, 174, 96);
	// 8. 駁回全部 (x: 1875-2500): 紅色 #E74C3C
	fr(1875, 421, 625, 422, 231, 76, 60);

	var WHT = 255;

	// ---- 繪製文字（5x7 點陣大字型）----
	function drawChar5x7(cx, cy, size, pattern, r, g, b) {
		var cell = Math.floor(size / 5);
		var offX = cx - Math.floor(5 * cell / 2);
		var offY = cy - 50;
		for (var row = 0; row < 7; row++) {
			for (var col = 0; col < 5; col++) {
				if (pattern[row] && pattern[row][col] === '#') {
					fr(offX + col * cell, offY + row * cell, cell, cell, r, g, b);
				}
			}
		}
	}

	// 5x7 點陣字型
	var font = {
		'上': ['..#..', '.###.', '..#..', '..#..', '..#..', '..#..', '#####'],
		'下': ['#####', '..#..', '..#..', '..#..', '..#..', '.###.', '..#..'],
		'班': ['#...#', '#.#.#', '#.#.#', '#####', '..#..', '.#.#.', '#...#'],
		'查': ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
		'詢': ['.####', '#....', '#....', '.####', '....#', '....#', '.####'],
		'請': ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
		'假': ['#.###', '#.#.#', '#.#.#', '#####', '.#.#.', '.#.#.', '.#.#.'],
		'加': ['#...#', '#...#', '#####', '#...#', '#...#', '.#.#.', '.###.'],
		'補': ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
		'打': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
		'卡': ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
		'核': ['#...#', '#.#.#', '#.#.#', '#####', '#...#', '#...#', '#...#'],
		'准': ['.#.#.', '.#.#.', '.#.#.', '.###.', '#####', '..#..', '..#..'],
		'駁': ['#####', '#...#', '#...#', '#####', '#...#', '#...#', '#####'],
		'回': ['#####', '....#', '....#', '.####', '#...#', '#...#', '.####'],
		'全': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
		'部': ['#####', '#...#', '#...#', '#####', '.#.#.', '.#.#.', '.#.#.'],
	};

	// 上排文字（y 中心 ~210）
	// 上班
	drawChar5x7(312 - 48, 180, 40, font['上'], WHT, WHT, WHT);
	drawChar5x7(312 + 48, 180, 40, font['班'], WHT, WHT, WHT);
	// 下班
	drawChar5x7(937 - 48, 180, 40, font['下'], WHT, WHT, WHT);
	drawChar5x7(937 + 48, 180, 40, font['班'], WHT, WHT, WHT);
	// 查詢
	drawChar5x7(1562 - 48, 180, 40, font['查'], WHT, WHT, WHT);
	drawChar5x7(1562 + 48, 180, 40, font['詢'], WHT, WHT, WHT);
	// 請假
	drawChar5x7(2187 - 48, 180, 40, font['請'], WHT, WHT, WHT);
	drawChar5x7(2187 + 48, 180, 40, font['假'], WHT, WHT, WHT);

	// 下排文字（y 中心 ~632）
	// 加班
	drawChar5x7(312 - 48, 602, 40, font['加'], WHT, WHT, WHT);
	drawChar5x7(312 + 48, 602, 40, font['班'], WHT, WHT, WHT);
	// 補打卡
	drawChar5x7(937 - 48, 602, 40, font['補'], WHT, WHT, WHT);
	drawChar5x7(937 + 48, 602, 40, font['打'], WHT, WHT, WHT);
	// 核准
	drawChar5x7(1562 - 48, 602, 40, font['核'], WHT, WHT, WHT);
	drawChar5x7(1562 + 48, 602, 40, font['准'], WHT, WHT, WHT);
	// 駁回
	drawChar5x7(2187 - 48, 602, 40, font['駁'], WHT, WHT, WHT);
	drawChar5x7(2187 + 48, 602, 40, font['回'], WHT, WHT, WHT);

	// ---- 繪製圖示（每區中央偏下）----
	// 區域 1 上班: 上箭頭
	var ax = 312, ay = 270;
	fr(ax - 10, ay - 20, 20, 45, WHT, WHT, WHT);
	line(ax - 32, ay - 10, ax, ay - 45, 10, WHT, WHT, WHT);
	line(ax + 32, ay - 10, ax, ay - 45, 10, WHT, WHT, WHT);

	// 區域 2 下班: 下箭頭
	ax = 937; ay = 270;
	fr(ax - 10, ay - 25, 20, 45, WHT, WHT, WHT);
	line(ax - 32, ay + 10, ax, ay + 45, 10, WHT, WHT, WHT);
	line(ax + 32, ay + 10, ax, ay + 45, 10, WHT, WHT, WHT);

	// 區域 3 查詢: 放大鏡
	ax = 1562; ay = 270;
	circle(ax - 5, ay - 5, 28, WHT, WHT, WHT);
	circle(ax - 5, ay - 5, 16, 52, 152, 219);
	fr(ax + 12, ay + 8, 10, 28, WHT, WHT, WHT);

	// 區域 4 請假: 文件
	ax = 2187; ay = 270;
	fr(ax - 32, ay - 28, 64, 56, WHT, WHT, WHT);
	fr(ax - 32, ay - 28, 64, 12, 26, 188, 156);
	fr(ax - 18, ay - 8, 14, 14, 26, 188, 156);
	fr(ax + 4, ay - 8, 14, 14, 26, 188, 156);
	fr(ax - 18, ay + 12, 36, 8, 200, 200, 200);

	// 區域 5 加班: 時鐘
	ax = 312; ay = 692;
	circle(ax, ay, 32, WHT, WHT, WHT);
	circle(ax, ay, 25, 155, 89, 182);
	fr(ax - 3, ay - 26, 6, 16, WHT, WHT, WHT);
	fr(ax - 3, ay - 6, 18, 6, WHT, WHT, WHT);

	// 區域 6 補打卡: 鉛筆
	ax = 937; ay = 692;
	fr(ax - 5, ay - 35, 10, 55, WHT, WHT, WHT);
	line(ax - 5, ay - 35, ax - 20, ay - 18, 8, WHT, WHT, WHT);
	line(ax + 5, ay - 35, ax + 20, ay - 18, 8, WHT, WHT, WHT);

	// 區域 7 核准全部: 打勾
	ax = 1562; ay = 692;
	line(ax - 30, ay + 6, ax - 5, ay + 30, 10, WHT, WHT, WHT);
	line(ax - 5, ay + 30, ax + 35, ay - 20, 10, WHT, WHT, WHT);

	// 區域 8 駁回全部: 叉叉
	ax = 2187; ay = 692;
	line(ax - 28, ay - 28, ax + 28, ay + 28, 10, WHT, WHT, WHT);
	line(ax + 28, ay - 28, ax - 28, ay + 28, 10, WHT, WHT, WHT);

	// ===== PNG 編碼輸出 =====
	var def = zlib.deflateSync(d);
	function crc(b) {
		var c = 0xffffffff;
		var t = new Uint32Array(256);
		for (var n = 0; n < 256; n++) {
			var cc = n;
			for (var k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
			t[n] = cc;
		}
		for (var i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	}
	function ch(type, dd) {
		var l = Buffer.alloc(4);
		l.writeUInt32BE(dd.length);
		var tt = Buffer.from(type), a = Buffer.concat([l, tt, dd]);
		var cc = Buffer.alloc(4);
		cc.writeUInt32BE(crc(Buffer.concat([tt, dd])));
		return Buffer.concat([a, cc]);
	}
	var sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	var ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	return Buffer.concat([sig, ch('IHDR', ihdr), ch('IDAT', def), ch('IEND', Buffer.alloc(0))]);
}
function checkLate(now) {
  return Math.max(0, now.getHours() * 60 + now.getMinutes() - (parseInt(process.env.WORK_START_HOUR || '8') * 60 + parseInt(process.env.LATE_BUFFER_MINUTES || '30')));
}

module.exports = { handleEvents, setupRichMenu, makePng };
