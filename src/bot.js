const db = require('./database');
const states = new Map();

// 國定假日快取（請假時數需扣除）
var _holidays = [];

async function refreshHolidays() {
  try {
    var raw = await db.getSetting('tw_holidays') || '[]';
    _holidays = JSON.parse(raw);
    console.log('[Bot] 國定假日快取已更新：' + _holidays.length + ' 天');
  } catch(e) { _holidays = []; }
}

// 中文字型初始化（從 Google Fonts 下載子集）
var _cnFontFamily = null;
var _fontReady = false;
async function initFont() {
	try {
		var canvasLib = require('canvas');
		var fs = require('fs');
		var https = require('https');
		var path = require('path');

		// 檢查 macOS 是否有內建中文字型
		var testFonts = [
			'/System/Library/Fonts/STHeiti Medium.ttc',
			'/System/Library/Fonts/PingFang.ttc',
			'/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
			'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
		];

		for (var i = 0; i < testFonts.length; i++) {
			if (fs.existsSync(testFonts[i])) {
				canvasLib.registerFont(testFonts[i], { family: 'CnFont' });
				_cnFontFamily = 'CnFont';
				_fontReady = true;
				console.log('[Font] 使用系統字型:', testFonts[i]);
				return;
			}
		}

		// 從 Google Fonts 下載完整字型（Bold 700，涵蓋所有中文字元，不加 subset 限制）
		var cssUrl = 'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@700';

		console.log('[Font] 下載字型...');
		var css = await new Promise(function(resolve, reject) {
			https.get(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
				var body = '';
				res.on('data', function(c) { body += c; });
				res.on('end', function() { resolve(body); });
			}).on('error', reject);
		});

		// 解析字型 URL
		var match = css.match(/url\((https:\/\/[^)]+)\)/);
		if (!match) {
			console.log('[Font] 無法解析字型 URL，使用無文字模式');
			return;
		}

		var fontUrl = match[1];
		var fontPath = path.join('/tmp', 'cn-font-subset.ttf');

		// 下載字型檔
		await new Promise(function(resolve, reject) {
			var file = fs.createWriteStream(fontPath);
			https.get(fontUrl, function(res) {
				res.pipe(file);
				file.on('finish', function() { file.close(); resolve(); });
			}).on('error', function(e) { fs.unlink(fontPath, function(){}); reject(e); });
		});

		canvasLib.registerFont(fontPath, { family: 'CnFont' });
		_cnFontFamily = 'CnFont';
		_fontReady = true;
		console.log('[Font] 字型已註冊');

	} catch (e) {
		console.log('[Font] 字型初始化失敗（將使用簡單模式）:', e.message);
	}
}

const GPS_BUTTONS = { items: [] };
const APPROVER_BUTTONS = {
  items: [
    { type: 'action', action: { type: 'message', label: '✅ 核准全部', text: '核准全部' } },
    { type: 'action', action: { type: 'message', label: '❌ 駁回全部', text: '駁回全部' } },
  ]
};

function getMenu(emp) {
  if (!emp) return GPS_BUTTONS;
  var role = emp.role || '';
  if (role === '老闆' || role === 'boss') return GPS_BUTTONS;
  if (role === '簽核人員' || role === '經理' || emp.can_approve) return APPROVER_BUTTONS;
  return GPS_BUTTONS;
}
function withMenu(text, emp) {
  var qr = emp ? getMenu(emp) : GPS_BUTTONS;
  if (!qr.items || qr.items.length === 0) return { type: 'text', text: text };
  return { type: 'text', text: text, quickReply: qr };
}
// 文字 + 選單 + 日期時間選擇器（保留選單按鈕）
function withDatePicker(text, data) {
  return { type: 'text', text: text, quickReply: { items: [
    { type: 'action', action: { type: 'datetimepicker', label: '📅 點我選日期時間', data: data, mode: 'datetime' } }
  ]}};
}

// pushMessage 含 429 重試 (LINE API rate limit)
async function pushWithRetry(client, uid, messages, retries) {
  retries = retries || 3;
  for (var attempt = 0; attempt < retries; attempt++) {
    try {
      return await client.pushMessage(uid, messages);
    } catch (e) {
      if (e.statusCode === 429 && attempt < retries - 1) {
        var delay = Math.pow(2, attempt) * 1000;
        console.log('[push] 429 retry ' + (attempt + 1) + '/' + retries + ' delay ' + delay + 'ms uid=' + uid);
        await new Promise(function (resolve) { setTimeout(resolve, delay); });
      } else {
        throw e;
      }
    }
  }
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
          assignRichMenu(uid, emp.role).catch(function(e2) { console.error('[RichMenu] assign error:', e2.message); });
          await pushWithRetry(client, uid, [withMenu('歡迎回來，' + emp.name + '！🎉\n\n📋 下方圖文選單可直接點選操作')]);
        } else {
          await pushWithRetry(client, uid, [{ type: 'text', text: '👋 歡迎使用公司打卡系統！\n\n🔹 請輸入「員工編號」綁定帳號\n🔹 或輸入「我的ID」取得 LINE ID\n\n📌 請洽管理員取得員工編號' }]);
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
    if (ok) {
      var newEmp = await db.getEmployeeByLineId(uid);
      if (newEmp) assignRichMenu(uid, newEmp.role).catch(function(e2) {});
      return client.replyMessage(replyToken, [withMenu('✅ 綁定成功！歡迎，' + (name || cmd) + '\n\n📋 下方圖文選單可直接點選操作')]);
    }
    return client.replyMessage(replyToken, [withMenu('❌ 找不到員工編號「' + cmd + '」\n\n🆔 輸入「我的ID」取得 LINE ID 洽管理員')]);
  }


  if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
    return client.replyMessage(replyToken, [withMenu('🆔 LINE User ID：' + uid + '\n✅ 已綁定：' + emp.name + '（' + emp.employee_no + '）')]);
  }
  if (cmd === '請假' || cmd === '请假') return startLeaveFlow(uid, client, replyToken);
  if (cmd === '查詢當天考勤') return queryTodayAttendance(emp, client, replyToken);
  if (cmd === '查詢當月考勤') return queryMonthAttendance(emp, client, replyToken);
  if (cmd === '公司今日考勤') return queryBossTodayStatus(emp, client, replyToken);
  if (cmd === '本月請假累計') return queryBossMonthLeaves(emp, client, replyToken);
  if (cmd === '本月遲到累計') return queryBossMonthLates(emp, client, replyToken);
  if (cmd === '本月加班累計') return queryBossMonthOvertime(emp, client, replyToken);
  if (cmd === '加班') return startOvertimeFlow(uid, client, replyToken);
  if (cmd === '補打卡' || cmd === '补打卡') return startMissedPunch(uid, client, replyToken);
  if (cmd === '核准全部') return batchApproveAll(emp, client, replyToken, 'leave');
  if (cmd === '駁回全部') return batchRejectAll(emp, client, replyToken, 'leave');
  if (cmd === '加班核准全部') return batchApproveAll(emp, client, replyToken, 'overtime');
  if (cmd === '加班駁回全部') return batchRejectAll(emp, client, replyToken, 'overtime');
  if (cmd === '取消' && states.has(uid)) { states.delete(uid); return client.replyMessage(replyToken, [withMenu('已取消操作。')]); }
  if (states.has(uid)) {
    var state2 = states.get(uid);
    if (state2.flow === 'reject_leave' || state2.flow === 'reject_ot' || state2.flow === 'reject_missed') {
      return handleRejectReason(cmd, uid, client, replyToken, emp);
    }
    return handleFlow(cmd, uid, client, replyToken, emp);
  }
  if (cmd.includes('上班')) { states.set(uid, { flow: 'gps_check', type: 'check_in' }); return client.replyMessage(replyToken, [{ type: 'text', text: '📍 請分享您的位置進行上班打卡：', quickReply: { items: [{ type: 'action', action: { type: 'location', label: '📍 分享位置' } }] } }]); }
  if (cmd.includes('下班')) { states.set(uid, { flow: 'gps_check', type: 'check_out' }); return client.replyMessage(replyToken, [{ type: 'text', text: '📍 請分享您的位置進行下班打卡：', quickReply: { items: [{ type: 'action', action: { type: 'location', label: '📍 分享位置' } }] } }]); }
  if (cmd.includes('查詢') || cmd.includes('記錄')) return doQuery(emp, client, replyToken);
  if (cmd.includes('幫助')) return client.replyMessage(replyToken, [withMenu('📖 功能選單\n📍傳位置→打卡 🏖請假 🕐加班\n📋查詢 🆔我的ID\n✅核准全部 ❌駁回全部')]);
  return client.replyMessage(replyToken, [withMenu('請點選下方選單，或輸入：上班 / 下班 / 查詢 / 請假 / 加班 / 我的ID')]);
}

function fmt(d) {
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  var h = d.getHours(), min = d.getMinutes();
  return y + ' ' + m + '月' + day + '日 ' + String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

// 格式化日期字串，去除 T00:00:00+08 等後綴
function fmtDt(str) {
  if (!str) return '';
  var s = typeof str === 'string' ? str : String(str);
  // 處理 ISO 格式 2026-07-03T00:00:00+08:00 或 2026-07-03T14:30:00
  var tIdx = s.indexOf('T');
  if (tIdx !== -1) {
    var datePart = s.substring(0, tIdx);
    var timePart = s.substring(tIdx + 1, tIdx + 6); // HH:MM
    if (timePart === '00:00') return datePart;
    return datePart + ' ' + timePart;
  }
  // 處理空格分隔格式 2026-07-03 00:00:00
  var spIdx = s.indexOf(' ');
  if (spIdx !== -1) {
    var dp2 = s.substring(0, spIdx);
    var tp2 = s.substring(spIdx + 1, spIdx + 6);
    if (tp2 === '00:00') return dp2;
    return dp2 + ' ' + tp2;
  }
  return s;
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

  // 檢查是否是從 Rich Menu 觸發的 GPS 打卡流程
  var state = states.get(uid);
  var intendedType = (state && state.flow === 'gps_check') ? state.type : null;
  states.delete(uid);

  var today = await db.getTodayCheckins(emp.id);
  var hasIn = today.some(function(r) { return r.type === 'check_in'; });
  var hasOut = today.some(function(r) { return r.type === 'check_out'; });
  var loc = { latitude: msg.latitude, longitude: msg.longitude, address: msg.address || '' };
  var gps = await checkGpsRange(msg.latitude, msg.longitude);

  if (intendedType === 'check_in') {
    if (hasIn) return client.replyMessage(replyToken, [withMenu('⚠️ 今天已上班打卡')]);
    return doCheckIn(emp, client, replyToken, loc, gps);
  }
  if (intendedType === 'check_out') {
    if (!hasIn) return client.replyMessage(replyToken, [withMenu('⚠️ 尚未上班打卡')]);
    if (hasOut) return client.replyMessage(replyToken, [withMenu('⚠️ 今天已下班打卡')]);
    return doCheckOut(emp, client, replyToken, loc, gps);
  }

  // 直接傳送位置訊息（無狀態）— 向後相容
  if (hasIn && !hasOut) return doCheckOut(emp, client, replyToken, loc, gps);
  if (!hasIn) return doCheckIn(emp, client, replyToken, loc, gps);
  return client.replyMessage(replyToken, [withMenu('今日已完成打卡。')]);
}

// ===== Check-in Flex =====
async function doCheckIn(emp, client, replyToken, loc, gps) {
  if (emp.role === '老闆' || emp.role === 'boss') return client.replyMessage(replyToken, [{ type: 'text', text: '您不需要打卡。' }]);
  const today = await db.getTodayCheckins(emp.id);
  if (today.some(r => r.type === 'check_in')) {
    return client.replyMessage(replyToken, [withMenu('⚠️ 今天已上班打卡')]);
  }
  const r = await db.recordCheckin(emp.id, 'check_in', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const now = r.check_time ? new Date(r.check_time) : new Date();
  var todayStr2 = now.toISOString().split('T')[0];
  var holiday = await isHoliday(todayStr2);
  const late = holiday ? 0 : checkLate(now);

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
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: contents } }
  }]);
}

async function doCheckOut(emp, client, replyToken, loc, gps) {
  if (emp.role === '老闆' || emp.role === 'boss') return client.replyMessage(replyToken, [{ type: 'text', text: '您不需要打卡。' }]);
  const today = await db.getTodayCheckins(emp.id);
  if (!today.some(r => r.type === 'check_in')) return client.replyMessage(replyToken, [withMenu('⚠️ 尚未上班打卡')]);
  if (today.some(r => r.type === 'check_out')) return client.replyMessage(replyToken, [withMenu('⚠️ 今天已下班打卡')]);

  const r = await db.recordCheckin(emp.id, 'check_out', loc, gps ? gps.inRange : true, gps ? gps.distance : 0);
  const ci = new Date(today.find(r => r.type === 'check_in').check_time);
  const co = r.check_time ? new Date(r.check_time) : new Date();
  // 總工時 = 實際打卡時間差，淨工時 = 總工時 - 午休 1h
  const totalH = Math.round(Math.max(0, (co - ci) / 3600000) * 10) / 10;
  var lunchDeduct = (ci.getHours() < 12 && co.getHours() >= 13) ? 1 : 0;
  var netH = Math.round((totalH - lunchDeduct) * 10) / 10;
  // 正常工時：僅計算 8:00-17:30 區間，17:30 後屬加班不計入
  var normalEnd = new Date(ci);
  normalEnd.setHours(17, 30, 0, 0);
  var cappedCo = co > normalEnd ? normalEnd : co;
  var normalH = Math.round(Math.max(0, (cappedCo - ci) / 3600000) * 10) / 10;

  var contents = [
    { type: 'text', text: '🏠 下班打卡成功', weight: 'bold', size: 'lg', color: '#3498db' },
    { type: 'text', text: '👤 ' + emp.name + '  ' + emp.employee_no, margin: 'md', size: 'sm', color: '#666666' },
    { type: 'text', text: '⏰ ' + fmt(co), margin: 'md', size: 'xl', weight: 'bold' },
    { type: 'text', text: '📊 總工時：' + totalH + 'h / 淨工時：' + netH + 'h', margin: 'sm', size: 'sm' },
  ];
  if (normalH < 9) {
    contents.push({ type: 'text', text: '⚠️ 正常工時（8:00-17:30）未滿 9 小時\n請記得申請請假補足時數', margin: 'sm', color: '#f39c12', size: 'sm', wrap: true });
  }
  if (co.getHours() >= 19 || (co.getHours() === 18 && co.getMinutes() >= 30)) {
    contents.push({ type: 'text', text: '⚠️ 下班時間超過 18:30，記得報加班', margin: 'sm', color: '#e67e22', size: 'sm' });
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
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: contents } }
  }]);
}

// ===== Query Flex =====
async function doQuery(emp, client, replyToken) {
  var now = new Date();
  var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var monthStart = thisMonth + '-01';
  var todayStr = now.toISOString().split('T')[0];
  var lastDay = String(new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()).padStart(2,'0');
  var monthEnd = thisMonth + '-' + lastDay;

  // 打卡記錄
  var records = await db.getTodayCheckins(emp.id);

  // 今日概況 (Flex Message)
  var contents = [
    { type: 'text', text: '📋 ' + emp.name + ' 今日概況', weight: 'bold', size: 'lg', color: '#06c755' },
  ];

  var checkIn = records.find(r => r.type === 'check_in');
  var checkOut = records.find(r => r.type === 'check_out');
  var punchText = '🔵 上班：' + (checkIn ? fmt(new Date(checkIn.check_time)) : '--:--');
  if (checkIn && checkIn.address) punchText += '\n   📍' + checkIn.address;
  punchText += '\n🔴 下班：' + (checkOut ? fmt(new Date(checkOut.check_time)) : '--:--');
  if (checkOut && checkOut.address) punchText += '\n   📍' + checkOut.address;
  if (checkIn && checkOut) {
    var ciDt = new Date(checkIn.check_time), coDt = new Date(checkOut.check_time);
    var rawWorkH = Math.round(Math.max(0, (coDt - ciDt) / 3600000) * 10) / 10;
    var lunchDed = (ciDt.getHours() < 12 && coDt.getHours() >= 13) ? 1 : 0;
    var workH = Math.round((rawWorkH - lunchDed) * 10) / 10;
    var nEnd = new Date(ciDt); nEnd.setHours(17, 30, 0, 0);
    var normalWH = Math.round(Math.max(0, ((coDt > nEnd ? nEnd : coDt) - ciDt) / 3600000) * 10) / 10;
    punchText += '\n📊 總工時 ' + rawWorkH + 'h / 淨工時 ' + workH + 'h' + (normalWH < 9 ? ' ⚠️未滿9h' : '');
  }
  contents.push({ type: 'text', text: punchText, margin: 'md', size: 'sm', wrap: true });
  contents.push({ type: 'separator', margin: 'md' });
  contents.push({ type: 'text', text: '💡 輸入「請假」申請 │ 點下方選單操作', size: 'xs', color: '#aaaaaa', margin: 'md' });

  // 當月考勤明細 (text message)
  var lateMin = parseInt(await db.getSetting('late_buffer_minutes') || process.env.LATE_BUFFER_MINUTES || '30');
  var startH = parseInt(await db.getSetting('work_start_hour') || process.env.WORK_START_HOUR || '8');
  var startM = parseInt(await db.getSetting('work_start_minute') || '0');
  var lateThreshold = startH * 60 + startM + lateMin;

  var monthCheckins = await db.queryCheckins(null, monthStart, todayStr, 500, 0);
  var allLeaves = await db.getLeaveRequests('approved', 2000);
  var allOTs = await db.getOvertimeRequests('approved', 500);

  var lines = ['📅 當月考勤明細（' + monthStart.substring(5) + ' ~ ' + todayStr.substring(5) + '）'];

  // 遲到記錄
  var lateRecords = [];
  for (var ci = 0; ci < monthCheckins.length; ci++) {
    var mc = monthCheckins[ci];
    if (mc.employee_id !== emp.id || mc.type !== 'check_in') continue;
    var mct = new Date(mc.check_time);
    var totalMin2 = mct.getHours() * 60 + mct.getMinutes();
    if (totalMin2 <= lateThreshold) continue;
    var fds = mct.getFullYear() + '-' + String(mct.getMonth()+1).padStart(2,'0') + '-' + String(mct.getDate()).padStart(2,'0');
    if (await isHoliday(fds)) continue;
    var lateMins = totalMin2 - lateThreshold;
    var dateStr = String(mct.getMonth()+1).padStart(2,'0') + '-' + String(mct.getDate()).padStart(2,'0');
    var timeStr = String(mct.getHours()).padStart(2,'0') + ':' + String(mct.getMinutes()).padStart(2,'0');
    var covered = false;
    var ctMs = mct.getTime();
    for (var cl = 0; cl < allLeaves.length; cl++) {
      var clv = allLeaves[cl];
      if (clv.employee_id !== emp.id || clv.status !== 'approved') continue;
      if (ctMs >= new Date(clv.start_date).getTime() && ctMs <= new Date(clv.end_date).getTime()) {
        covered = true; break;
      }
    }
    lateRecords.push({ date: dateStr, time: timeStr, lateMin: lateMins, covered: covered });
  }
  if (lateRecords.length > 0) {
    lines.push('\n⚠️ 遲到（' + lateRecords.length + ' 次）：');
    for (var lr = 0; lr < lateRecords.length; lr++) {
      var lr2 = lateRecords[lr];
      lines.push('  ' + lr2.date + ' ' + lr2.time + ' 晚 ' + lr2.lateMin + ' 分' + (lr2.covered ? ' 已請假' : ''));
    }
  } else {
    lines.push('\n⚠️ 遲到：無');
  }

  // 請假記錄
  var myLeaves = await db.getEmployeeLeaveRequests(emp.id, null, 50);
  var leaveRecords = [];
  var leaveTotalH = 0;
  for (var li = 0; li < myLeaves.length; li++) {
    var ml = myLeaves[li];
    if (ml.status !== 'approved') continue;
    var mls = typeof ml.start_date === 'string' ? ml.start_date.substring(0, 10) : '';
    var mle = typeof ml.end_date === 'string' ? ml.end_date.substring(0, 10) : '';
    if (mle < monthStart || mls > monthEnd) continue;
    var leaveLabel = ml.leave_type === 'annual' ? '特休' : ml.leave_type === 'personal' ? '事假' : ml.leave_type === 'sick' ? '病假' : ml.leave_type === 'official' ? '公假' : ml.leave_type === 'outing' ? '外出' : (ml.leave_type || '請假');
    var lh = leaveHours(ml.start_date, ml.end_date);
    leaveRecords.push({
      start: fmtDt(ml.start_date).length > 7 ? fmtDt(ml.start_date).substring(5) : fmtDt(ml.start_date),
      end: fmtDt(ml.end_date).length > 7 ? fmtDt(ml.end_date).substring(5) : fmtDt(ml.end_date),
      type: leaveLabel, hours: lh
    });
    leaveTotalH += lh;
  }
  if (leaveRecords.length > 0) {
    lines.push('\n🏖 請假（累計 ' + leaveTotalH + 'h）：');
    for (var lr3 = 0; lr3 < leaveRecords.length; lr3++) {
      var lr4 = leaveRecords[lr3];
      lines.push('  ' + lr4.start + ' ~ ' + lr4.end + ' ' + lr4.type + '（' + lr4.hours + 'h）');
    }
  } else {
    lines.push('\n🏖 請假：無');
  }

  // 加班記錄
  var otRecords = [];
  var otTotalH = 0;
  for (var oi = 0; oi < allOTs.length; oi++) {
    var mo2 = allOTs[oi];
    if (mo2.employee_id !== emp.id) continue;
    var os2 = typeof mo2.start_time === 'string' ? mo2.start_time.substring(0, 10) : '';
    if (os2 < monthStart || os2 > todayStr) continue;
    var otH = 0;
    if (mo2.start_time && mo2.end_time) {
      var diffMs2 = new Date(mo2.end_time) - new Date(mo2.start_time);
      if (diffMs2 > 0) otH = Math.round(diffMs2 / 3600000 * 10) / 10;
    }
    otRecords.push({
      start: fmtDt(mo2.start_time).substring(5),
      end: edtTime(mo2.end_time),
      hours: otH
    });
    otTotalH += otH;
  }
  if (otRecords.length > 0) {
    lines.push('\n🕐 加班（累計 ' + Math.round(otTotalH * 10) / 10 + 'h）：');
    for (var or2 = 0; or2 < otRecords.length; or2++) {
      var or3 = otRecords[or2];
      lines.push('  ' + or3.start + ' ~ ' + or3.end + '（' + or3.hours + 'h）');
    }
  } else {
    lines.push('\n🕐 加班：無');
  }

  var png = textToImage(lines[0], lines.join('\n'));
  var imgUrl = '';
  if (png) {
    var imgId = 'q_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    storeImage(imgId, png);
    var baseUrl = process.env.APP_URL || ('https://' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'));
    imgUrl = baseUrl + '/img/' + imgId;
  }
  var messages = [
    { type: 'flex', altText: '📋 今日打卡記錄', contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: contents } } }
  ];
  if (imgUrl) {
    messages.push({ type: 'image', originalContentUrl: imgUrl, previewImageUrl: imgUrl });
  } else {
    messages.push({ type: 'text', text: lines.join('\n') });
  }
  return client.replyMessage(replyToken, messages);
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

  // 逐日計算，跳過週六(6)週日(0)及國定假日
  var sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var eDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());

  var total = 0;
  var current = new Date(sDay);
  while (current <= eDay) {
    var dow = current.getDay();
    var ds = current.getFullYear() + '-' + String(current.getMonth()+1).padStart(2,'0') + '-' + String(current.getDate()).padStart(2,'0');
    if (dow !== 0 && dow !== 6 && _holidays.indexOf(ds) === -1) {
      // 工作日（非週末、非國定假日）：決定當天的起訖時間
      var dayStart = current.getTime() === sDay.getTime() ? s : new Date(current);
      var dayEnd;
      if (current.getTime() === eDay.getTime()) {
        dayEnd = e;
      } else {
        // 中間日：到當天 23:59:59
        dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59);
      }
      var dayDiff = dayEnd - dayStart;
      if (dayDiff > 0) {
        var dayRaw = Math.ceil(dayDiff / 3600000);
        // 午休扣除：跨越 12:00-13:00 扣 1 小時
        var lunch = (dayStart.getHours() < 12 && dayEnd.getHours() >= 13) ? 1 : 0;
        var dayHours = dayRaw - lunch;
        if (dayHours > 8) dayHours = 8;
        if (dayHours > 0) total += dayHours;
      }
    }
    current.setDate(current.getDate() + 1);
  }
  if (total < 1) total = 1;
  return total;
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
          await pushWithRetry(client, approvers[j].line_user_id, [{
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
      } catch(e) { console.error('[mp] error:', e.message || e, e.stack || ''); states.delete(uid); return client.replyMessage(replyToken, [withMenu("❌ 申請失敗")]); }
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
      // 先回覆成功給使用者，再推播給簽核人（push 失敗不影響使用者）
      await client.replyMessage(replyToken, [{
        type: "text", text: "✅ 加班申請已送出！\n\n時間：" + fmtDt(state.otStart) + " ~ " + fmtDt(state.otEnd) + "\n原因：" + state.reason + "\n\n⏳ 等待第1階簽核：" + (approvers.length > 0 ? approvers[0].name : '') + " ⏳"
      }]);
      for (var j = 0; j < approvers.length; j++) {
        try {
          await pushWithRetry(client, approvers[j].line_user_id, [{
            type: "flex", altText: "🕐 " + emp.name + " 加班申請",
            contents: { type: "bubble",
              body: { type: "box", layout: "vertical", contents: [
                { type: "text", text: "🕐 加班申請", weight: "bold", size: "lg", color: "#f39c12" },
                { type: "text", text: "員工：" + emp.name + "（" + emp.employee_no + "）", margin: "md", size: "sm", color: "#666666" },
                { type: "text", text: "時間：" + fmtDt(state.otStart) + " ~ " + fmtDt(state.otEnd), margin: "sm", size: "sm" },
                { type: "text", text: "原因：" + state.reason, margin: "sm", size: "sm", wrap: true, color: "#666666" },
              ]},
              footer: { type: "box", layout: "horizontal", spacing: "sm", contents: [
                { type: "button", style: "primary", color: "#06c755", action: { type: "postback", label: "核准", data: "ot_approve_" + otId }, flex: 1, height: "sm" },
                { type: "button", style: "secondary", color: "#e74c3c", action: { type: "postback", label: "駁回", data: "ot_reject_" + otId }, flex: 1, height: "sm" },
              ]}
            }
          }]);
        } catch(pe) { console.error('[ot] push to approver failed:', pe.message); }
      }
    } catch(e) { console.error('[ot] error:', e.message || e, e.stack || ''); states.delete(uid); return client.replyMessage(replyToken, [withMenu("❌ 申請失敗")]); }
  }
  if (!state.flow && state.step === 'reason') {
    state.reason = text;
    try {
      const leaveId = await db.createLeaveRequest(emp.id, state.type, state.startDateTime, state.endDateTime, state.reason);
      states.delete(uid);
      const approvers = await db.findApprovers(emp.id);
      var hours = leaveHours(state.startDateTime, state.endDateTime);
      var st2 = new Date(state.startDateTime), et2 = new Date(state.endDateTime);
      // 先回覆成功給使用者，再推播給簽核人（push 失敗不影響使用者）
      await client.replyMessage(replyToken, [
        { type: 'flex', altText: '✅ 請假已送出',
          contents: { type: 'bubble',
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '✅ 請假申請已送出', weight: 'bold', size: 'lg', color: '#06c755' },
              { type: 'text', text: '假別：' + state.typeLabel, margin: 'md', size: 'sm' },
              { type: 'text', text: '時間：' + fmtDt(state.startDateTime) + ' ~ ' + fmtDt(state.endDateTime), margin: 'sm', size: 'sm', wrap: true },
              { type: 'text', text: '原因：' + state.reason, margin: 'sm', size: 'sm', color: '#666666', wrap: true },
              { type: 'text', text: '⏳ 等待第1階簽核：' + (approvers.length > 0 ? approvers[0].name : ''), margin: 'md', size: 'sm', color: '#f39c12' }
            ]}
          }
        }
      ]);
      for (const appr of approvers) {
        try {
          await pushWithRetry(client, appr.line_user_id, [{
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
        } catch(pe) { console.error('[leave] push to approver failed:', pe.message); }
      }
    } catch (e) {
      console.error('[leave] error:', e.message || e, e.stack || '');
      states.delete(uid);
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
    state.endDateTime = dt; state.step = 'reason';
    var hours = leaveHours(state.startDateTime, dt);
    return client.replyMessage(replyToken, [withMenu('📅 ' + fmtDt(state.startDateTime) + ' ~ ' + fmtDt(dt) + '（' + hours + ' 小時）\n\n📝 請輸入請假原因：')]);
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
    state.otEnd = dt; state.step = 'reason';
    return client.replyMessage(replyToken, [withMenu('🕐 ' + fmtDt(state.otStart) + ' ~ ' + fmtDt(dt) + '\n\n📝 請輸入加班原因：')]);
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
      if (mpEmp && mpEmp.line_user_id) await pushWithRetry(client, mpEmp.line_user_id, [{ type: "text", text: "🎉 補打卡已核准！\n" + fmtDt(mp.punch_date) + " " + mp.punch_time }]);
      return client.replyMessage(replyToken, [withMenu("✅ 已核准")]);
    } else {
      states.set(uid, { flow: 'reject_missed', id: mpId, approverId: mpApprover.id });
      return client.replyMessage(replyToken, [withMenu('📝 請輸入駁回原因（或輸入「取消」放棄）：')]);
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
          await pushWithRetry(client, result.approvers[n].line_user_id, [{
            type: 'flex', altText: '📋 請假申請（第'+result.level+'階）',
            contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '📋 請假申請（第'+result.level+'階簽核）', weight: 'bold', size: 'lg', color: '#f39c12' },
              { type: 'text', text: '員工：' + leaveEmp.name, margin: 'md', size: 'sm', color: '#666666' },
              { type: 'text', text: '時間：' + fmtDt(leave.start_date) + ' ~ ' + fmtDt(leave.end_date), margin: 'sm', size: 'sm', wrap: true },
              { type: 'text', text: '原因：' + (leave.reason || ''), margin: 'sm', size: 'sm', color: '#666666', wrap: true },
            ]}, footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
              { type: 'button', style: 'primary', color: '#06c755', action: { type: 'postback', label: '核准', data: 'leave_approve_' + leaveId }, flex: 1, height: 'sm' },
              { type: 'button', style: 'secondary', color: '#e74c3c', action: { type: 'postback', label: '駁回', data: 'leave_reject_' + leaveId }, flex: 1, height: 'sm' },
            ]}}
          }]);
        }
        if (leaveEmp && leaveEmp.line_user_id) await pushWithRetry(client, leaveEmp.line_user_id, [{ type: "text", text: "📋 請假進度\n\n已通過第"+(result.level-1)+"階，等待第"+result.level+"階：" + result.approvers[0].name + "\n時間：" + fmtDt(leave.start_date) + " ~ " + fmtDt(leave.end_date) }]);
        return client.replyMessage(replyToken, [withMenu('✅ 已核准，已送第'+result.level+'階簽核')]);
      }
      if (leaveEmp && leaveEmp.line_user_id) {
        await pushWithRetry(client, leaveEmp.line_user_id, [{ type: 'text', text: '🎉 請假已核准！\n' + fmtDt(leave.start_date) + ' ~ ' + fmtDt(leave.end_date) }]);
      }
      return client.replyMessage(replyToken, [withMenu('✅ 已核准')]);
    } else {
      // 先要求輸入駁回原因
      states.set(uid, { flow: 'reject_leave', id: leaveId, approverId: approver.id });
      return client.replyMessage(replyToken, [withMenu('📝 請輸入駁回原因（或輸入「取消」放棄）：')]);
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
          await pushWithRetry(client, otResult.approvers[n2].line_user_id, [{
            type: 'flex', altText: '🕐 加班申請（第'+otResult.level+'階）',
            contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '🕐 加班申請（第'+otResult.level+'階簽核）', weight: 'bold', size: 'lg', color: '#f39c12' },
              { type: 'text', text: '員工：' + otEmp.name, margin: 'md', size: 'sm', color: '#666666' },
              { type: 'text', text: '時間：' + fmtDt(ot.start_time) + ' ~ ' + fmtDt(ot.end_time), margin: 'sm', size: 'sm', wrap: true },
              { type: 'text', text: '原因：' + (ot.reason || ''), margin: 'sm', size: 'sm', color: '#666666', wrap: true },
            ]}, footer: { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
              { type: 'button', style: 'primary', color: '#06c755', action: { type: 'postback', label: '核准', data: 'ot_approve_' + otId }, flex: 1, height: 'sm' },
              { type: 'button', style: 'secondary', color: '#e74c3c', action: { type: 'postback', label: '駁回', data: 'ot_reject_' + otId }, flex: 1, height: 'sm' },
            ]}}
          }]);
        }
        if (otEmp && otEmp.line_user_id) await pushWithRetry(client, otEmp.line_user_id, [{ type: "text", text: "🕐 加班進度\n\n已通過第"+(otResult.level-1)+"階，等待第"+otResult.level+"階：" + otResult.approvers[0].name + "\n時間：" + fmtDt(ot.start_time) + " ~ " + fmtDt(ot.end_time) }]);
        return client.replyMessage(replyToken, [withMenu('✅ 已核准，已送第'+otResult.level+'階簽核')]);
      }
      if (otEmp && otEmp.line_user_id) {
        await pushWithRetry(client, otEmp.line_user_id, [{ type: 'text', text: '🎉 加班已核准！\n' + fmtDt(ot.start_time) + ' ~ ' + fmtDt(ot.end_time) }]);
      }
      return client.replyMessage(replyToken, [withMenu('✅ 已核准')]);
    } else {
      states.set(uid, { flow: 'reject_ot', id: otId, approverId: otApprover.id });
      return client.replyMessage(replyToken, [withMenu('📝 請輸入駁回原因（或輸入「取消」放棄）：')]);
    }
  }
}

// 處理駁回原因輸入
async function handleRejectReason(text, uid, client, replyToken, approver) {
  var state = states.get(uid);
  if (text === '取消') {
    states.delete(uid);
    return client.replyMessage(replyToken, [withMenu('已取消駁回')]);
  }
  var reason = text;

  try {
    if (state.flow === 'reject_leave') {
      var leave = await db.getLeaveById(state.id);
      var leaveEmp = leave ? await db.getEmployeeById(leave.employee_id) : null;
      await db.updateLeaveStatus(state.id, 'rejected', approver.id, reason);
      if (leaveEmp && leaveEmp.line_user_id && leave) {
        await pushWithRetry(client, leaveEmp.line_user_id, [{
          type: 'text', text: '❌ 請假被駁回\n時間：' + fmtDt(leave.start_date) + ' ~ ' + fmtDt(leave.end_date) + '\n駁回原因：' + reason
        }]);
      }
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('已駁回請假申請（原因：' + reason + '）')]);
    }

    if (state.flow === 'reject_ot') {
      var ot = await db.getOvertimeById(state.id);
      var otEmp = ot ? await db.getEmployeeById(ot.employee_id) : null;
      await db.updateOvertimeStatus(state.id, 'rejected', approver.id, reason);
      if (otEmp && otEmp.line_user_id && ot) {
        await pushWithRetry(client, otEmp.line_user_id, [{
          type: 'text', text: '❌ 加班被駁回\n時間：' + fmtDt(ot.start_time) + ' ~ ' + fmtDt(ot.end_time) + '\n駁回原因：' + reason
        }]);
      }
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('已駁回加班申請（原因：' + reason + '）')]);
    }

    if (state.flow === 'reject_missed') {
      var mp = await db.getMissedPunchById(state.id);
      var mpEmp = mp ? await db.getEmployeeById(mp.employee_id) : null;
      await db.updateMissedPunchStatus(state.id, 'rejected', approver.id, reason);
      if (mpEmp && mpEmp.line_user_id && mp) {
        await pushWithRetry(client, mpEmp.line_user_id, [{
          type: 'text', text: '❌ 補打卡被駁回\n' + fmtDt(mp.punch_date) + ' ' + mp.punch_time + '\n駁回原因：' + reason
        }]);
      }
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('已駁回補打卡申請（原因：' + reason + '）')]);
    }
  } catch (e) {
    console.error('[reject] error:', e);
    states.delete(uid);
    return client.replyMessage(replyToken, [withMenu('❌ 駁回失敗')]);
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

		// ===== Menu A: 6 格（一般員工預設） =====
		var menu6 = {
			size: { width: 2500, height: 843 }, selected: true, name: '一般員工選單', chatBarText: '📋 點此開啟功能選單',
			areas: [
				{ bounds: { x: 0, y: 0, width: 833, height: 421 }, action: { type: 'message', text: '上班' } },
				{ bounds: { x: 833, y: 0, width: 834, height: 421 }, action: { type: 'message', text: '請假' } },
				{ bounds: { x: 1667, y: 0, width: 833, height: 421 }, action: { type: 'message', text: '下班' } },
				{ bounds: { x: 0, y: 421, width: 833, height: 422 }, action: { type: 'message', text: '加班' } },
				{ bounds: { x: 833, y: 421, width: 834, height: 422 }, action: { type: 'message', text: '補打卡' } },
				{ bounds: { x: 1667, y: 421, width: 833, height: 422 }, action: { type: 'message', text: '查詢' } },
			]
		};
		var res6a = await fetch('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers, body: JSON.stringify(menu6) });
		var data6 = await res6a.json();
		if (!data6 || !data6.richMenuId) {
			console.error('[RichMenu] 6格建立失敗:', JSON.stringify(data6));
			return { error: '6格選單建立失敗: ' + JSON.stringify(data6) };
		}
		var menu6Id = data6.richMenuId;
		console.log('[RichMenu] 6格選單建立成功:', menu6Id);

		// 上傳 6 格圖片
		var png6 = makePng();
		console.log('[RichMenu] 6格PNG大小:', png6.length, 'bytes');
		var res6b = await fetch('https://api-data.line.me/v2/bot/richmenu/' + menu6Id + '/content', {
			method: 'POST',
			headers: { 'Content-Type': 'image/png', 'Authorization': 'Bearer ' + token },
			body: png6
		});
		if (res6b.status !== 200) {
			var err6 = await res6b.text();
			console.error('[RichMenu] 6格圖片上傳失敗:', res6b.status, err6);
			await fetch('https://api.line.me/v2/bot/richmenu/' + menu6Id, { method: 'DELETE', headers });
			return { error: '6格圖片上傳失敗 HTTP ' + res6b.status + ': ' + err6 };
		}
		console.log('[RichMenu] 6格圖片上傳成功');

		// 設為所有用戶預設
		var res6c = await fetch('https://api.line.me/v2/bot/user/all/richmenu/' + menu6Id, { method: 'POST', headers });
		if (res6c.status !== 200) {
			var err6c = await res6c.text();
			console.error('[RichMenu] 6格設定預設失敗:', res6c.status, err6c);
			return { error: '6格設定預設失敗 HTTP ' + res6c.status + ': ' + err6c, richMenuId: menu6Id };
		}
		console.log('[RichMenu] 6格已設為所有用戶預設');

		// ===== Menu B: 8 格（經理/老闆/簽核人員） =====
		var menu8 = {
			size: { width: 2500, height: 843 }, selected: false, name: '主管選單', chatBarText: '📋 點此開啟功能選單',
			areas: [
				{ bounds: { x: 0, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '上班' } },
				{ bounds: { x: 625, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '請假' } },
				{ bounds: { x: 1250, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '補打卡' } },
				{ bounds: { x: 1875, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '下班' } },
				{ bounds: { x: 0, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '加班' } },
				{ bounds: { x: 625, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '查詢' } },
				{ bounds: { x: 1250, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '查詢當天考勤' } },
				{ bounds: { x: 1875, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '查詢當月考勤' } },
			]
		};
		var res8a = await fetch('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers, body: JSON.stringify(menu8) });
		var data8 = await res8a.json();
		if (!data8 || !data8.richMenuId) {
			console.error('[RichMenu] 8格建立失敗:', JSON.stringify(data8));
			// 6格已成功，8格失敗仍可繼續
			return { richMenuId: menu6Id, error: '8格選單建立失敗: ' + JSON.stringify(data8) };
		}
		var menu8Id = data8.richMenuId;
		_richMenuId8 = menu8Id;
		console.log('[RichMenu] 8格選單建立成功:', menu8Id);
		await db.setSetting('richmenu_8_id', menu8Id);

		// 上傳 8 格圖片
		var png8 = makePng8();
		console.log('[RichMenu] 8格PNG大小:', png8.length, 'bytes');
		var res8b = await fetch('https://api-data.line.me/v2/bot/richmenu/' + menu8Id + '/content', {
			method: 'POST',
			headers: { 'Content-Type': 'image/png', 'Authorization': 'Bearer ' + token },
			body: png8
		});
		if (res8b.status !== 200) {
			var err8 = await res8b.text();
			console.error('[RichMenu] 8格圖片上傳失敗:', res8b.status, err8);
			await fetch('https://api.line.me/v2/bot/richmenu/' + menu8Id, { method: 'DELETE', headers });
			_richMenuId8 = null;
			return { richMenuId: menu6Id, error: '8格圖片上傳失敗 HTTP ' + res8b.status + ': ' + err8 };
		}
		console.log('[RichMenu] 8格圖片上傳成功');

		// ===== Menu C: 4 格（老闆 2×2） =====
		var menuBoss = {
			size: { width: 2500, height: 843 }, selected: false, name: '老闆選單', chatBarText: '📋 點此開啟功能選單',
			areas: [
				{ bounds: { x: 0, y: 0, width: 1250, height: 421 }, action: { type: 'message', text: '公司今日考勤' } },
				{ bounds: { x: 1250, y: 0, width: 1250, height: 421 }, action: { type: 'message', text: '本月請假累計' } },
				{ bounds: { x: 0, y: 421, width: 1250, height: 422 }, action: { type: 'message', text: '本月遲到累計' } },
				{ bounds: { x: 1250, y: 421, width: 1250, height: 422 }, action: { type: 'message', text: '本月加班累計' } },
			]
		};
		var resBa = await fetch('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers, body: JSON.stringify(menuBoss) });
		var dataB = await resBa.json();
		var menuBossId = null;
		if (dataB && dataB.richMenuId) {
			menuBossId = dataB.richMenuId;
			_richMenuIdBoss = menuBossId;
			console.log('[RichMenu] 老闆4格選單建立成功:', menuBossId);
			await db.setSetting('richmenu_boss_id', menuBossId);

			// 上傳老闆圖片
			var pngBoss = makePngBoss();
			console.log('[RichMenu] 老闆PNG大小:', pngBoss.length, 'bytes');
			var resBb = await fetch('https://api-data.line.me/v2/bot/richmenu/' + menuBossId + '/content', {
				method: 'POST',
				headers: { 'Content-Type': 'image/png', 'Authorization': 'Bearer ' + token },
				body: pngBoss
			});
			if (resBb.status !== 200) {
				var errB = await resBb.text();
				console.error('[RichMenu] 老闆圖片上傳失敗:', resBb.status, errB);
				await fetch('https://api.line.me/v2/bot/richmenu/' + menuBossId, { method: 'DELETE', headers });
				_richMenuIdBoss = null;
			} else {
				console.log('[RichMenu] 老闆圖片上傳成功');
			}
		} else {
			console.error('[RichMenu] 老闆4格建立失敗:', JSON.stringify(dataB));
		}

		return { richMenuId: menu6Id, menu8Id: menu8Id, menuBossId: menuBossId };
	} catch (e) {
		console.error('[RichMenu] error:', e.message);
		return { error: e.message };
	}
}
function makePng() {
	var canvasLib;
	try {
		canvasLib = require('canvas');
	} catch (e) {
		return makeSimplePng();
	}

	var w = 2500, h = 843;
	var cv = canvasLib.createCanvas(w, h);
	var ctx = cv.getContext('2d');

	// 深色背景
	ctx.fillStyle = '#0f172a';
	ctx.fillRect(0, 0, w, h);

	var gap = 4;
	var areas = [
		{ x: 0, y: 0, w: 833, h: 421, color: '#059669', label: '上班' },
		{ x: 833 + gap, y: 0, w: 833 - gap, h: 421, color: '#0d9488', label: '請假' },
		{ x: 1667 + gap, y: 0, w: 833 - gap, h: 421, color: '#d97706', label: '下班' },
		{ x: 0, y: 421 + gap, w: 833, h: 422 - gap, color: '#7c3aed', label: '加班' },
		{ x: 833 + gap, y: 421 + gap, w: 833 - gap, h: 422 - gap, color: '#4f46e5', label: '補打卡' },
		{ x: 1667 + gap, y: 421 + gap, w: 833 - gap, h: 422 - gap, color: '#2563eb', label: '查詢' },
	];

	var fontFamily = _cnFontFamily || '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "STHeiti", "Microsoft JhengHei", sans-serif';

	for (var i = 0; i < areas.length; i++) {
		var a = areas[i];
		var cx = a.x + a.w / 2;

		// 主色背景
		ctx.fillStyle = a.color;
		ctx.fillRect(a.x, a.y, a.w, a.h);

		// 頂部亮邊
		ctx.fillStyle = 'rgba(255,255,255,0.12)';
		ctx.fillRect(a.x, a.y, a.w, 6);

		// 大型 label 文字（置中偏上）
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = 'bold 80px ' + fontFamily;
		ctx.fillText(a.label, cx, a.y + a.h * 0.48);

		// 簡約底部線條圖示
		ctx.strokeStyle = 'rgba(255,255,255,0.35)';
		ctx.lineWidth = 7;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		var iy = a.y + a.h * 0.80;

		switch (i) {
			case 0: // 上班 ▲
				ctx.moveTo(cx - 32, iy + 16);
				ctx.lineTo(cx, iy - 16);
				ctx.lineTo(cx + 32, iy + 16);
				break;
			case 1: // 請假 三條線
				ctx.moveTo(cx - 24, iy - 16);
				ctx.lineTo(cx - 24, iy + 16);
				ctx.moveTo(cx, iy - 16);
				ctx.lineTo(cx, iy + 16);
				ctx.moveTo(cx + 24, iy - 16);
				ctx.lineTo(cx + 24, iy + 16);
				break;
			case 2: // 下班 ▼
				ctx.moveTo(cx - 32, iy - 16);
				ctx.lineTo(cx, iy + 16);
				ctx.lineTo(cx + 32, iy - 16);
				break;
			case 3: // 加班 ◉
				ctx.arc(cx, iy, 24, 0, Math.PI * 2);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx, iy - 16);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx + 14, iy);
				break;
			case 4: // 補打卡
				ctx.moveTo(cx - 18, iy - 20);
				ctx.lineTo(cx + 10, iy - 4);
				ctx.lineTo(cx + 22, iy + 12);
				ctx.moveTo(cx + 10, iy - 4);
				ctx.lineTo(cx - 6, iy + 20);
				break;
			case 5: // 查詢
				ctx.arc(cx - 2, iy, 22, 0, Math.PI * 2);
				ctx.moveTo(cx + 16, iy + 16);
				ctx.lineTo(cx + 34, iy + 34);
				break;
		}
		ctx.stroke();
	}

	return cv.toBuffer('image/png');
}

// 備用：無 canvas 時用純色塊 PNG
function makeSimplePng() {
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
	function p(x, y, r, g, b) {
		if (x < 0 || x >= w || y < 0 || y >= h) return;
		var o = y * (1 + w * 4) + 1 + x * 4;
		d[o] = r; d[o+1] = g; d[o+2] = b; d[o+3] = 255;
	}
	function fr(x, y, w2, h2, r, g, b) {
		for (var yy = y; yy < y + h2; yy++)
			for (var xx = x; xx < x + w2; xx++)
				p(xx, yy, r, g, b);
	}
	var colors = [
		[6, 199, 85], [26, 188, 156], [243, 156, 18],
		[155, 89, 182], [52, 73, 94], [52, 152, 219]
	];
	var labels = ['上班', '請假', '下班', '加班', '補打卡', '查詢'];
	for (var i = 0; i < 6; i++) {
		var col = i % 3, row = Math.floor(i / 3);
		var bx = col < 1 ? 0 : (col === 1 ? 833 : 1667);
		var bw = col === 1 ? 834 : 833;
		var by = row < 1 ? 0 : 421;
		var bh = row < 1 ? 421 : 422;
		fr(bx, by, bw, bh, colors[i][0], colors[i][1], colors[i][2]);
	}
	var deflated = zlib.deflateSync(d);
	function crc(b) {
		var c = 0xffffffff;
		var t = new Uint32Array(256);
		for (var n = 0; n < 256; n++) {
			var cc = n;
			for (var k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
			t[n] = cc;
		}
		for (var i2 = 0; i2 < b.length; i2++) c = t[(c ^ b[i2]) & 0xff] ^ (c >>> 8);
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
	return Buffer.concat([sig, ch('IHDR', ihdr), ch('IDAT', deflated), ch('IEND', Buffer.alloc(0))]);
}
// 檢查是否為假日（週末或國定假日）
var _holidaysCache = null;
var _holidaysCacheDate = '';
async function isHoliday(dateStr) {
  var d = new Date(dateStr);
  var day = d.getDay();
  if (day === 0 || day === 6) return true;
  // 檢查國定假日設定
  var todayStr = new Date().toISOString().split('T')[0];
  if (_holidaysCacheDate !== todayStr) {
    var raw = await db.getSetting('tw_holidays') || '[]';
    try { _holidaysCache = JSON.parse(raw); } catch(e) { _holidaysCache = []; }
    _holidaysCacheDate = todayStr;
  }
  if (_holidaysCache && _holidaysCache.indexOf(dateStr) !== -1) return true;
  return false;
}

function checkLate(now) {
  return Math.max(0, now.getHours() * 60 + now.getMinutes() - (parseInt(process.env.WORK_START_HOUR || '8') * 60 + parseInt(process.env.LATE_BUFFER_MINUTES || '30')));
}

// 儲存 8 格 Rich Menu ID（供 assignRichMenu 使用）
var _richMenuId8 = null;

// 角色是否可查詢全體（經理/老闆）
function canQueryAll(emp) {
  var role = emp.role || '';
  return role === '經理' || role === '老闆' || role === 'boss';
}

// 角色是否為簽核人員（只能查自己簽核的員工）
function isApproverRole(emp) {
  var role = emp.role || '';
  return role === '簽核人員';
}

// 查詢被簽核人員當天考勤（遲到/曠職/請假/GPS超出範圍）
async function queryTodayAttendance(emp, client, replyToken) {
  var role = emp.role || '';
  if (role !== '經理' && role !== '老闆' && role !== 'boss' && role !== '簽核人員' && !emp.can_approve) {
    return client.replyMessage(replyToken, [withMenu('❌ 無查詢權限')]);
  }

  var today = new Date().toISOString().split('T')[0];
  var lateMin = parseInt(await db.getSetting('late_buffer_minutes') || process.env.LATE_BUFFER_MINUTES || '30');
  var startH = parseInt(await db.getSetting('work_start_hour') || process.env.WORK_START_HOUR || '8');
  var startM = parseInt(await db.getSetting('work_start_minute') || '0');
  var lateThreshold = startH * 60 + startM + lateMin;

  var designatedIds = {};
  if (isApproverRole(emp) && !canQueryAll(emp)) {
    var designated = await db.getDesignatedEmployeeIds(emp.id);
    for (var d = 0; d < designated.length; d++) {
      designatedIds[designated[d].id] = true;
    }
  }

  var allCheckins = await db.queryCheckins(null, today, today, 2000, 0);
  var allLeaves = await db.getLeaveRequests('approved', 500);
  var allEmps = await db.listAttendanceEmployees();

  // 過濾指定員工
  if (Object.keys(designatedIds).length > 0) {
    allCheckins = allCheckins.filter(function(c) { return designatedIds[c.employee_id]; });
  }

  var seen = {};
  var lateList = [];
  var orList = [];
  var orSeen = {};
  for (var i = 0; i < allCheckins.length; i++) {
    var c = allCheckins[i];
    if (c.type === 'check_in' && !seen[c.employee_id]) {
      seen[c.employee_id] = true;
      var ct = new Date(c.check_time);
      var totalMin = ct.getHours() * 60 + ct.getMinutes();
      if (totalMin > lateThreshold) {
        var checkDateStr = ct.getFullYear() + '-' + String(ct.getMonth()+1).padStart(2,'0') + '-' + String(ct.getDate()).padStart(2,'0');
        if (!(await isHoliday(checkDateStr))) {
          // 檢查是否被請假覆蓋
          var covered = false;
          var ctMs = ct.getTime();
          for (var cl = 0; cl < allLeaves.length; cl++) {
            var clv = allLeaves[cl];
            if (clv.employee_id !== c.employee_id || clv.status !== 'approved') continue;
            if (ctMs >= new Date(clv.start_date).getTime() && ctMs <= new Date(clv.end_date).getTime()) {
              covered = true; break;
            }
          }
          lateList.push({ employee_id: c.employee_id, check_time: ct, late_min: totalMin - lateThreshold, covered: covered });
        }
      }
    }
    if (c.in_range === false && !orSeen[c.employee_id]) {
      orSeen[c.employee_id] = true;
      if (Object.keys(designatedIds).length > 0 && !designatedIds[c.employee_id]) continue;
      var gEmp = await db.getEmployeeById(c.employee_id);
      if (gEmp) orList.push(gEmp);
    }
  }

  // 今日請假
  var leaveEmpMap = {};
  for (var li = 0; li < allLeaves.length; li++) {
    var al = allLeaves[li];
    if (Object.keys(designatedIds).length > 0 && !designatedIds[al.employee_id]) continue;
    var als = typeof al.start_date === 'string' ? al.start_date.split('T')[0] : '';
    var ale = typeof al.end_date === 'string' ? al.end_date.split('T')[0] : '';
    if (als <= today && ale >= today) {
      var leaveLabel = al.leave_type === 'annual' ? '特休' : al.leave_type === 'personal' ? '事假' : al.leave_type === 'sick' ? '病假' : al.leave_type === 'official' ? '公假' : al.leave_type === 'outing' ? '外出' : (al.leave_type || '請假');
      var lEmp = await db.getEmployeeById(al.employee_id);
      if (lEmp) leaveEmpMap[al.employee_id] = lEmp.name + '（' + lEmp.employee_no + '） ' + leaveLabel;
    }
  }

  // 今日曠職（沒打卡且沒請假）
  var absentList = [];
  for (var a = 0; a < allEmps.length; a++) {
    var ae = allEmps[a];
    if (Object.keys(designatedIds).length > 0 && !designatedIds[ae.id]) continue;
    if (seen[ae.id]) continue;
    if (leaveEmpMap[ae.id]) continue;
    absentList.push(ae);
  }

  if (lateList.length === 0 && absentList.length === 0 && orList.length === 0 && Object.keys(leaveEmpMap).length === 0) {
    return client.replyMessage(replyToken, [withMenu('✅ 今日考勤正常，無異常人員')]);
  }

  var lines = ['📋 今日考勤狀態（' + today.substring(5) + '）'];
  if (lateList.length > 0) {
    lines.push('\n⚠️ 遲到（' + lateList.length + ' 人）：');
    for (var k = 0; k < lateList.length; k++) {
      var le = lateList[k];
      var e3 = await db.getEmployeeById(le.employee_id);
      var t = le.check_time;
      var timeStr = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      lines.push('  ' + (e3 ? e3.name + '（' + e3.employee_no + '）' : '員工#' + le.employee_id) + ' ' + timeStr + ' 遲到 ' + le.late_min + ' 分' + (le.covered ? ' 已請假' : ''));
    }
  }
  if (absentList.length > 0) {
    lines.push('\n❌ 曠職（' + absentList.length + ' 人）：');
    for (var m = 0; m < absentList.length; m++) {
      lines.push('  ' + absentList[m].name + '（' + absentList[m].employee_no + '）');
    }
  }
  if (orList.length > 0) {
    lines.push('\n📍 GPS 超出範圍（' + orList.length + ' 人）：');
    for (var n = 0; n < orList.length; n++) {
      lines.push('  ' + orList[n].name + '（' + orList[n].employee_no + '）');
    }
  }
  var leaveKeys = Object.keys(leaveEmpMap);
  if (leaveKeys.length > 0) {
    lines.push('\n🏖 請假中（' + leaveKeys.length + ' 人）：');
    for (var li2 = 0; li2 < leaveKeys.length; li2++) {
      lines.push('  ' + leaveEmpMap[leaveKeys[li2]]);
    }
  }

	var title1 = lines[0];
  return sendTableImage(client, replyToken, title1, lines.join('\n'));
}

// 查詢被簽核人員當月考勤（遲到+請假備註/請假/加班細項與累加，1號～當天）
async function queryMonthAttendance(emp, client, replyToken) {
  var role = emp.role || '';
  if (role !== '經理' && role !== '老闆' && role !== 'boss' && role !== '簽核人員' && !emp.can_approve) {
    return client.replyMessage(replyToken, [withMenu('❌ 無查詢權限')]);
  }

  var now = new Date();
  var monthStart = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
  var lastDay = String(new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()).padStart(2,'0');
  var monthEnd = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + lastDay;
  var today = now.toISOString().split('T')[0];
  var lateMin = parseInt(await db.getSetting('late_buffer_minutes') || process.env.LATE_BUFFER_MINUTES || '30');
  var startH = parseInt(await db.getSetting('work_start_hour') || process.env.WORK_START_HOUR || '8');
  var startM = parseInt(await db.getSetting('work_start_minute') || '0');
  var lateThreshold = startH * 60 + startM + lateMin;

  var designatedIds = {};
  if (isApproverRole(emp) && !canQueryAll(emp)) {
    var designated = await db.getDesignatedEmployeeIds(emp.id);
    for (var d = 0; d < designated.length; d++) {
      designatedIds[designated[d].id] = true;
    }
  }

  var allCheckins = await db.queryCheckins(null, monthStart, today, 5000, 0);
  var allLeaves = await db.getLeaveRequests('approved', 2000);

  // 過濾指定員工
  if (Object.keys(designatedIds).length > 0) {
    allCheckins = allCheckins.filter(function(c) { return designatedIds[c.employee_id]; });
  }

  // 遲到彙整（1號～當天）
  var empLateMap = {};
  for (var i = 0; i < allCheckins.length; i++) {
    var c = allCheckins[i];
    if (c.type !== 'check_in') continue;
    var ct = new Date(c.check_time);
    var totalMin = ct.getHours() * 60 + ct.getMinutes();
    if (totalMin <= lateThreshold) continue;
    var fullDateStr2 = ct.getFullYear() + '-' + String(ct.getMonth()+1).padStart(2,'0') + '-' + String(ct.getDate()).padStart(2,'0');
    if (await isHoliday(fullDateStr2)) continue;

    var lateMins = totalMin - lateThreshold;
    var dateStr = String(ct.getMonth()+1).padStart(2,'0') + '-' + String(ct.getDate()).padStart(2,'0');
    if (!empLateMap[c.employee_id]) {
      empLateMap[c.employee_id] = { name: c.name, no: c.employee_no, records: [], count: 0 };
    }
    var timeStr = String(ct.getHours()).padStart(2, '0') + ':' + String(ct.getMinutes()).padStart(2, '0');
    var covered3 = false;
    var ctMs3 = ct.getTime();
    for (var cl3 = 0; cl3 < allLeaves.length; cl3++) {
      var clv3 = allLeaves[cl3];
      if (clv3.employee_id !== c.employee_id || clv3.status !== 'approved') continue;
      var cls3 = new Date(clv3.start_date).getTime();
      var cle3 = new Date(clv3.end_date).getTime();
      if (ctMs3 >= cls3 && ctMs3 <= cle3) { covered3 = true; break; }
    }
    empLateMap[c.employee_id].records.push({ date: dateStr, time: timeStr, lateMin: lateMins, covered: covered3 });
    empLateMap[c.employee_id].count++;
  }

  // 本月請假彙整（1號～月底）
  var empLeaveMap = {};
  for (var li = 0; li < allLeaves.length; li++) {
    var l = allLeaves[li];
    if (Object.keys(designatedIds).length > 0 && !designatedIds[l.employee_id]) continue;
    var ls = typeof l.start_date === 'string' ? l.start_date.substring(0, 10) : '';
    var le2 = typeof l.end_date === 'string' ? l.end_date.substring(0, 10) : ls;
    if (le2 < monthStart || ls > monthEnd) continue;

    var leaveLabel = l.leave_type === 'annual' ? '特休' : l.leave_type === 'personal' ? '事假' : l.leave_type === 'sick' ? '病假' : l.leave_type === 'official' ? '公假' : l.leave_type === 'outing' ? '外出' : (l.leave_type || '請假');
    var hours = leaveHours(l.start_date, l.end_date);
    if (!empLeaveMap[l.employee_id]) {
      empLeaveMap[l.employee_id] = { name: l.name, no: l.employee_no, records: [], totalHours: 0 };
    }
    empLeaveMap[l.employee_id].records.push({
      start: fmtDt(l.start_date).length > 7 ? fmtDt(l.start_date).substring(5) : fmtDt(l.start_date),
      end: fmtDt(l.end_date).length > 7 ? fmtDt(l.end_date).substring(5) : fmtDt(l.end_date),
      type: leaveLabel, hours: hours
    });
    empLeaveMap[l.employee_id].totalHours += hours;
  }

  // 本月加班
  var allOTs = await db.getOvertimeRequests('approved', 2000);
  var empOTMap = {};
  for (var oi = 0; oi < allOTs.length; oi++) {
    var ot = allOTs[oi];
    if (Object.keys(designatedIds).length > 0 && !designatedIds[ot.employee_id]) continue;
    var os3 = typeof ot.start_time === 'string' ? ot.start_time.substring(0, 10) : '';
    if (os3 < monthStart || os3 > today) continue;
    var otHours = 0;
    if (ot.start_time && ot.end_time) {
      var diffMs = new Date(ot.end_time) - new Date(ot.start_time);
      if (diffMs > 0) otHours = Math.round(diffMs / 3600000 * 10) / 10;
    }
    if (!empOTMap[ot.employee_id]) {
      empOTMap[ot.employee_id] = { name: ot.name, no: ot.employee_no, records: [], totalHours: 0 };
    }
    empOTMap[ot.employee_id].records.push({
      start: fmtDt(ot.start_time).substring(5),
      end: edtTime(ot.end_time),
      hours: otHours
    });
    empOTMap[ot.employee_id].totalHours += otHours;
  }

  // 輸出
  var lateKeys = Object.keys(empLateMap);
  var leaveKeys = Object.keys(empLeaveMap);
  var otKeys = Object.keys(empOTMap);
  if (lateKeys.length === 0 && leaveKeys.length === 0 && otKeys.length === 0) {
    return client.replyMessage(replyToken, [withMenu('✅ 本月無異常人員')]);
  }

  var lines = ['📋 當月考勤（' + monthStart.substring(5) + ' ~ ' + today.substring(5) + '）'];

  if (lateKeys.length > 0) {
    lateKeys.sort(function(a, b) { return (empLateMap[a].no || '').localeCompare(empLateMap[b].no || ''); });
    lines.push('\n⚠️ 遲到累計：');
    var totalLate = 0;
    for (var k = 0; k < lateKeys.length; k++) {
      var info = empLateMap[lateKeys[k]];
      totalLate += info.count;
      lines.push('  ' + info.name + '（' + info.no + '） 遲到 ' + info.count + ' 次');
      for (var r = 0; r < info.records.length; r++) {
        var rec = info.records[r];
        lines.push('      ' + rec.date + ' ' + rec.time + '（晚 ' + rec.lateMin + ' 分）' + (rec.covered ? ' 已請假' : ''));
      }
    }
    lines.push('  📊 遲到合計：' + totalLate + ' 次');
  }

  if (leaveKeys.length > 0) {
    leaveKeys.sort(function(a, b) { return (empLeaveMap[a].no || '').localeCompare(empLeaveMap[b].no || ''); });
    lines.push('\n🏖 請假累計（當月）：');
    var totalLeave = 0;
    for (var k2 = 0; k2 < leaveKeys.length; k2++) {
      var info2 = empLeaveMap[leaveKeys[k2]];
      totalLeave += info2.totalHours;
      lines.push('  ' + info2.name + '（' + info2.no + '） 累計 ' + info2.totalHours + 'h');
      for (var r2 = 0; r2 < info2.records.length; r2++) {
        var rec2 = info2.records[r2];
        lines.push('      ' + rec2.start + ' ~ ' + rec2.end + ' ' + rec2.type + '（' + rec2.hours + 'h）');
      }
    }
    lines.push('  📊 請假合計：' + totalLeave + ' 小時');
  }

  if (otKeys.length > 0) {
    otKeys.sort(function(a, b) { return (empOTMap[a].no || '').localeCompare(empOTMap[b].no || ''); });
    lines.push('\n🕐 加班累計：');
    var totalOT = 0;
    for (var k3 = 0; k3 < otKeys.length; k3++) {
      var info3 = empOTMap[otKeys[k3]];
      totalOT += info3.totalHours;
      lines.push('  ' + info3.name + '（' + info3.no + '） 累計 ' + info3.totalHours + 'h');
      for (var r3 = 0; r3 < info3.records.length; r3++) {
        var rec3 = info3.records[r3];
        lines.push('      ' + rec3.start + ' ~ ' + rec3.end + '（' + rec3.hours + 'h）');
      }
    }
    lines.push('  📊 加班合計：' + Math.round(totalOT * 10) / 10 + ' 小時');
  }

  var title2 = lines[0];
  return sendTableImage(client, replyToken, title2, lines.join('\n'));
}

// 為使用者連結 8 格 Rich Menu
async function assignRichMenu(uid, role, token) {
  try {
    var t = token || process.env.LINE_CHANNEL_ACCESS_TOKEN;
    var headers = { 'Authorization': 'Bearer ' + t };
    if (role === '老闆' || role === 'boss') {
      // 老闆使用 4 格選單
      if (!_richMenuIdBoss) _richMenuIdBoss = await db.getSetting('richmenu_boss_id');
      if (!_richMenuIdBoss) {
        console.log('[RichMenu] 老闆選單尚未建立');
        return false;
      }
      var res = await fetch('https://api.line.me/v2/bot/user/' + uid + '/richmenu/' + _richMenuIdBoss, { method: 'POST', headers });
      console.log('[RichMenu] assign boss 4-btn to', uid, 'status:', res.status);
      return res.status === 200;
    }
    if (!_richMenuId8) {
      _richMenuId8 = await db.getSetting('richmenu_8_id');
    }
    if (!_richMenuId8) {
      console.log('[RichMenu] 8格選單尚未建立，請先至 /admin/setup-richmenu');
      return false;
    }
    if (role === '經理' || role === '簽核人員') {
      // 連結 8 格選單
      var res = await fetch('https://api.line.me/v2/bot/user/' + uid + '/richmenu/' + _richMenuId8, { method: 'POST', headers });
      console.log('[RichMenu] assign 8-btn to', uid, 'role:', role, 'status:', res.status);
      return res.status === 200;
    } else {
      // 一般員工：取消個人選單，使用預設 6 格
      var res2 = await fetch('https://api.line.me/v2/bot/user/' + uid + '/richmenu', { method: 'DELETE', headers });
      console.log('[RichMenu] unlink personal menu for', uid, 'status:', res2.status);
      return true;
    }
  } catch (e) {
    console.error('[RichMenu] assign error:', e.message);
    return false;
  }
}

// 8 格 Rich Menu PNG（4×2）
function makePng8() {
  var canvasLib;
  try {
    canvasLib = require('canvas');
  } catch (e) {
    return makeSimplePng8();
  }

  var w = 2500, h = 843;
  var cv = canvasLib.createCanvas(w, h);
  var ctx = cv.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  var gap = 3;
  var areas = [
    { x: 0, y: 0, w: 625, h: 421, color: '#059669', label: '上班' },
    { x: 625 + gap, y: 0, w: 625 - gap, h: 421, color: '#0d9488', label: '請假' },
    { x: 1250 + gap, y: 0, w: 625 - gap, h: 421, color: '#4f46e5', label: '補打卡' },
    { x: 1875 + gap, y: 0, w: 625 - gap, h: 421, color: '#d97706', label: '下班' },
    { x: 0, y: 421 + gap, w: 625, h: 422 - gap, color: '#7c3aed', label: '加班' },
    { x: 625 + gap, y: 421 + gap, w: 625 - gap, h: 422 - gap, color: '#2563eb', label: '查詢' },
    { x: 1250 + gap, y: 421 + gap, w: 625 - gap, h: 422 - gap, color: '#ea580c', label: '查詢當天考勤' },
    { x: 1875 + gap, y: 421 + gap, w: 625 - gap, h: 422 - gap, color: '#b91c1c', label: '查詢當月考勤' },
  ];

  var fontFamily = _cnFontFamily || '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "STHeiti", "Microsoft JhengHei", sans-serif';

  for (var i = 0; i < areas.length; i++) {
    var a = areas[i];
    var cx = a.x + a.w / 2;

    ctx.fillStyle = a.color;
    ctx.fillRect(a.x, a.y, a.w, a.h);

    // 頂部亮邊
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(a.x, a.y, a.w, 5);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var label = a.label;
    if (label.indexOf('\n') !== -1) {
      var parts = label.split('\n');
      ctx.font = 'bold 42px ' + fontFamily;
      ctx.fillText(parts[0], cx, a.y + a.h * 0.42);
      ctx.fillText(parts[1], cx, a.y + a.h * 0.62);
    } else {
      if (label.length <= 2) {
        ctx.font = 'bold 62px ' + fontFamily;
      } else if (label.length <= 3) {
        ctx.font = 'bold 52px ' + fontFamily;
      } else if (label.length <= 4) {
        ctx.font = 'bold 44px ' + fontFamily;
      } else {
        ctx.font = 'bold 38px ' + fontFamily;
      }
      ctx.fillText(label, cx, a.y + a.h * 0.50);
    }

    // 底部簡約圖示
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    var iy = a.y + a.h * 0.84;

    switch (i) {
      case 0:
        ctx.moveTo(cx - 24, iy + 12);
        ctx.lineTo(cx, iy - 12);
        ctx.lineTo(cx + 24, iy + 12);
        break;
      case 1: case 4:
        ctx.moveTo(cx - 16, iy - 12);
        ctx.lineTo(cx - 16, iy + 12);
        ctx.moveTo(cx, iy - 12);
        ctx.lineTo(cx, iy + 12);
        ctx.moveTo(cx + 16, iy - 12);
        ctx.lineTo(cx + 16, iy + 12);
        break;
      case 2:
        ctx.moveTo(cx - 12, iy - 14);
        ctx.lineTo(cx + 8, iy - 2);
        ctx.lineTo(cx + 16, iy + 8);
        ctx.moveTo(cx + 8, iy - 2);
        ctx.lineTo(cx - 4, iy + 14);
        break;
      case 3:
        ctx.moveTo(cx - 24, iy - 12);
        ctx.lineTo(cx, iy + 12);
        ctx.lineTo(cx + 24, iy - 12);
        break;
      case 5:
        ctx.arc(cx - 2, iy, 16, 0, Math.PI * 2);
        ctx.moveTo(cx + 12, iy + 12);
        ctx.lineTo(cx + 24, iy + 24);
        break;
      case 6:
        ctx.moveTo(cx - 16, iy - 8);
        ctx.lineTo(cx - 16, iy + 8);
        ctx.moveTo(cx + 8, iy - 8);
        ctx.lineTo(cx + 8, iy + 8);
        ctx.moveTo(cx + 20, iy - 8);
        ctx.lineTo(cx + 20, iy + 4);
        break;
      case 7:
        ctx.arc(cx, iy, 12, 0, Math.PI * 2);
        ctx.moveTo(cx + 14, iy);
        ctx.lineTo(cx + 27, iy);
        break;
    }
    ctx.stroke();
  }

  return cv.toBuffer('image/png');
}

// 8 格備用 PNG
function makeSimplePng8() {
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
  function p(x, y, r, g, b) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    var o = y * (1 + w * 4) + 1 + x * 4;
    d[o] = r; d[o+1] = g; d[o+2] = b; d[o+3] = 255;
  }
  function fr(x, y, w2, h2, r, g, b) {
    for (var yy = y; yy < y + h2; yy++)
      for (var xx = x; xx < x + w2; xx++)
        p(xx, yy, r, g, b);
  }
  var colors = [
    [6, 199, 85], [26, 188, 156], [52, 73, 94], [243, 156, 18],
    [155, 89, 182], [52, 152, 219], [230, 126, 34], [231, 76, 60]
  ];
  for (var i = 0; i < 8; i++) {
    var col = i % 4, row = Math.floor(i / 4);
    var bx = col * 625;
    var bw = 625;
    var by = row < 1 ? 0 : 421;
    var bh = row < 1 ? 421 : 422;
    fr(bx, by, bw, bh, colors[i][0], colors[i][1], colors[i][2]);
  }
  var deflated = zlib.deflateSync(d);
  function crc(b) {
    var c = 0xffffffff;
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var cc = n;
      for (var k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
      t[n] = cc;
    }
    for (var i2 = 0; i2 < b.length; i2++) c = t[(c ^ b[i2]) & 0xff] ^ (c >>> 8);
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
  return Buffer.concat([sig, ch('IHDR', ihdr), ch('IDAT', deflated), ch('IEND', Buffer.alloc(0))]);
}

// ===== 老闆 Rich Menu 2×2 PNG =====
function makePngBoss() {
	var canvasLib;
	try {
		canvasLib = require('canvas');
	} catch (e) {
		return makeSimplePngBoss();
	}

	var w = 2500, h = 843;
	var cv = canvasLib.createCanvas(w, h);
	var ctx = cv.getContext('2d');

	ctx.fillStyle = '#0f172a';
	ctx.fillRect(0, 0, w, h);

	var gap = 4;
	var areas = [
		{ x: 0, y: 0, w: 1250, h: 421, color: '#0ea5e9', label: '公司今日考勤' },
		{ x: 1250 + gap, y: 0, w: 1250 - gap, h: 421, color: '#059669', label: '本月請假累計' },
		{ x: 0, y: 421 + gap, w: 1250, h: 422 - gap, color: '#ea580c', label: '本月遲到累計' },
		{ x: 1250 + gap, y: 421 + gap, w: 1250 - gap, h: 422 - gap, color: '#7c3aed', label: '本月加班累計' },
	];

	var fontFamily = _cnFontFamily || '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "STHeiti", "Microsoft JhengHei", sans-serif';

	for (var i = 0; i < areas.length; i++) {
		var a = areas[i];
		var cx = a.x + a.w / 2;

		ctx.fillStyle = a.color;
		ctx.fillRect(a.x, a.y, a.w, a.h);

		// 頂部亮邊
		ctx.fillStyle = 'rgba(255,255,255,0.15)';
		ctx.fillRect(a.x, a.y, a.w, 8);

		// 主 label
		ctx.fillStyle = '#ffffff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		var label = a.label;
		ctx.font = 'bold 68px ' + fontFamily;
		ctx.fillText(label, cx, a.y + a.h * 0.55);

		// 底部簡約圖示
		ctx.strokeStyle = 'rgba(255,255,255,0.35)';
		ctx.lineWidth = 8;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		var iy = a.y + a.h * 0.84;

		switch (i) {
			case 0: // 儀表板
				ctx.arc(cx, iy, 26, 0, Math.PI * 2);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx, iy - 18);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx + 15, iy);
				break;
			case 1: // 文件/請假
				ctx.moveTo(cx - 24, iy - 20);
				ctx.lineTo(cx - 24, iy + 20);
				ctx.moveTo(cx, iy - 20);
				ctx.lineTo(cx, iy + 20);
				ctx.moveTo(cx + 24, iy - 20);
				ctx.lineTo(cx + 24, iy + 20);
				break;
			case 2: // 時鐘/遲到
				ctx.arc(cx, iy, 26, 0, Math.PI * 2);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx, iy - 18);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx + 14, iy);
				ctx.moveTo(cx, iy + 28);
				ctx.lineTo(cx - 12, iy + 18);
				ctx.lineTo(cx + 12, iy + 18);
				break;
			case 3: // 兌/加班
				ctx.arc(cx, iy, 26, 0, Math.PI * 2);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx, iy - 16);
				ctx.moveTo(cx, iy);
				ctx.lineTo(cx + 12, iy);
				break;
		}
		ctx.stroke();
	}

	return cv.toBuffer('image/png');
}

function makeSimplePngBoss() {
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
	function p(x, y, r, g, b) {
		if (x < 0 || x >= w || y < 0 || y >= h) return;
		var o = y * (1 + w * 4) + 1 + x * 4;
		d[o] = r; d[o+1] = g; d[o+2] = b; d[o+3] = 255;
	}
	function fr(x, y, w2, h2, r, g, b) {
		for (var yy = y; yy < y + h2; yy++)
			for (var xx = x; xx < x + w2; xx++)
				p(xx, yy, r, g, b);
	}
	var colors = [
		[6, 199, 85], [52, 152, 219],
		[230, 126, 34], [155, 89, 182]
	];
	for (var i = 0; i < 4; i++) {
		var col = i % 2, row = Math.floor(i / 2);
		var bx = col * 1250;
		var by = row === 0 ? 0 : 421;
		var bh = row === 0 ? 421 : 422;
		fr(bx, by, 1250, bh, colors[i][0], colors[i][1], colors[i][2]);
	}
	var deflated = zlib.deflateSync(d);
	function crc(b) {
		var c = 0xffffffff;
		var t = new Uint32Array(256);
		for (var n = 0; n < 256; n++) {
			var cc = n;
			for (var k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
			t[n] = cc;
		}
		for (var i2 = 0; i2 < b.length; i2++) c = t[(c ^ b[i2]) & 0xff] ^ (c >>> 8);
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
	return Buffer.concat([sig, ch('IHDR', ihdr), ch('IDAT', deflated), ch('IEND', Buffer.alloc(0))]);
}

// ===== 老闆查詢功能 =====
var _richMenuIdBoss = null;

// 查詢公司今日考勤狀態（遲到/曠職/GPS超出/請假）
async function queryBossTodayStatus(emp, client, replyToken) {
	var role = emp.role || '';
	if (role !== '老闆' && role !== 'boss') {
		return client.replyMessage(replyToken, [withMenu('❌ 無查詢權限')]);
	}

	var today = new Date().toISOString().split('T')[0];
	var lateMin = parseInt(await db.getSetting('late_buffer_minutes') || process.env.LATE_BUFFER_MINUTES || '30');
	var startH = parseInt(await db.getSetting('work_start_hour') || process.env.WORK_START_HOUR || '8');
	var startM = parseInt(await db.getSetting('work_start_minute') || '0');
	var lateThreshold = startH * 60 + startM + lateMin;

	var allCheckins = await db.queryCheckins(null, today, today, 2000, 0);
	var allLeaves = await db.getLeaveRequests('approved', 500);
	var allEmps = await db.listAttendanceEmployees();

	var seen = {};
	var lateList = [];
	var orList = [];
	var orSeen = {};
	for (var i = 0; i < allCheckins.length; i++) {
		var c = allCheckins[i];
		if (c.type === 'check_in' && !seen[c.employee_id]) {
			seen[c.employee_id] = true;
			var ct = new Date(c.check_time);
			var totalMin = ct.getHours() * 60 + ct.getMinutes();
			if (totalMin > lateThreshold) {
				var checkDateStr = ct.getFullYear() + '-' + String(ct.getMonth()+1).padStart(2,'0') + '-' + String(ct.getDate()).padStart(2,'0');
				if (!(await isHoliday(checkDateStr))) {
					lateList.push({ employee_id: c.employee_id, check_time: ct, late_min: totalMin - lateThreshold });
				}
			}
		}
		if (c.in_range === false && !orSeen[c.employee_id]) {
			orSeen[c.employee_id] = true;
			var gEmp = await db.getEmployeeById(c.employee_id);
			if (gEmp) orList.push(gEmp);
		}
	}

	// 請假
	var leaveEmpMap = {};
	for (var li = 0; li < allLeaves.length; li++) {
		var al = allLeaves[li];
		var als = typeof al.start_date === 'string' ? al.start_date.split('T')[0] : '';
		var ale = typeof al.end_date === 'string' ? al.end_date.split('T')[0] : '';
		if (als <= today && ale >= today) {
			var lEmp = await db.getEmployeeById(al.employee_id);
			if (lEmp) leaveEmpMap[al.employee_id] = lEmp.name + '（' + lEmp.employee_no + '）' + ' ' + (al.leave_type || '請假');
		}
	}

	// 曠職
	var absentList = [];
	for (var a = 0; a < allEmps.length; a++) {
		var ae = allEmps[a];
		if (seen[ae.id]) continue;
		if (leaveEmpMap[ae.id]) continue;
		absentList.push(ae);
	}

	if (lateList.length === 0 && absentList.length === 0 && orList.length === 0 && Object.keys(leaveEmpMap).length === 0) {
		return client.replyMessage(replyToken, [withMenu('✅ 今日公司考勤正常，無異常人員')]);
	}

	var lines = ['📋 今日公司考勤狀態'];
	if (lateList.length > 0) {
		lines.push('\n⚠️ 遲到（' + lateList.length + ' 人）：');
		for (var k = 0; k < lateList.length; k++) {
			var le = lateList[k];
			var e3 = await db.getEmployeeById(le.employee_id);
			var t = le.check_time;
			var timeStr = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
			lines.push('  ' + (e3 ? e3.name + '（' + e3.employee_no + '）' : '員工#' + le.employee_id) + ' ' + timeStr + ' 遲到 ' + le.late_min + ' 分' + (le.covered ? ' 已請假' : ''));
		}
	}
	if (absentList.length > 0) {
		lines.push('\n❌ 曠職（' + absentList.length + ' 人）：');
		for (var m = 0; m < absentList.length; m++) {
			lines.push('  ' + absentList[m].name + '（' + absentList[m].employee_no + '）');
		}
	}
	if (orList.length > 0) {
		lines.push('\n📍 GPS 超出範圍（' + orList.length + ' 人）：');
		for (var n = 0; n < orList.length; n++) {
			lines.push('  ' + orList[n].name + '（' + orList[n].employee_no + '）');
		}
	}
	var leaveKeys = Object.keys(leaveEmpMap);
	if (leaveKeys.length > 0) {
		lines.push('\n🏖 請假中（' + leaveKeys.length + ' 人）：');
		for (var li2 = 0; li2 < leaveKeys.length; li2++) {
			lines.push('  ' + leaveEmpMap[leaveKeys[li2]]);
		}
	}

	var titleB1 = lines[0];
	return sendTableImage(client, replyToken, titleB1, lines.join('\n'));
}

// 當月公司人員請假累計
async function queryBossMonthLeaves(emp, client, replyToken) {
	var role = emp.role || '';
	if (role !== '老闆' && role !== 'boss') {
		return client.replyMessage(replyToken, [withMenu('❌ 無查詢權限')]);
	}

	var now = new Date();
	var monthStart = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
	var lastDay = String(new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()).padStart(2,'0');
	var monthEnd = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + lastDay;

	var allLeaves = await db.getLeaveRequests('approved', 2000);
	var empLeaveMap = {}; // employee_id -> { name, no, records: [{start, end, hours}], totalHours }

	for (var i = 0; i < allLeaves.length; i++) {
		var l = allLeaves[i];
		var lsFull = fmtDt(l.start_date);
		var leFull = fmtDt(l.end_date);
		var lsDate = typeof l.start_date === 'string' ? l.start_date.substring(0, 10) : '';
		var leDate = typeof l.end_date === 'string' ? l.end_date.substring(0, 10) : lsDate;
		// 請假區間與本月重疊
		if (leDate < monthStart || lsDate > monthEnd) continue;

		var leaveType = l.leave_type || '請假';
		var leaveLabel = leaveType === 'annual' ? '特休' : leaveType === 'personal' ? '事假' : leaveType === 'sick' ? '病假' : leaveType === 'official' ? '公假' : leaveType === 'outing' ? '外出' : leaveType;
		var hours = leaveHours(l.start_date, l.end_date);
		if (!empLeaveMap[l.employee_id]) {
			empLeaveMap[l.employee_id] = { name: l.name, no: l.employee_no, records: [], totalHours: 0 };
		}
		empLeaveMap[l.employee_id].records.push({ start: lsFull.length > 7 ? lsFull.substring(5) : lsFull, end: leFull.length > 7 ? leFull.substring(5) : leFull, hours: hours, type: leaveLabel });
		empLeaveMap[l.employee_id].totalHours += hours;
	}

	var keys = Object.keys(empLeaveMap);
	if (keys.length === 0) {
		return client.replyMessage(replyToken, [withMenu('📋 本月無請假記錄')]);
	}

	// 按員工編號排序
	keys.sort(function(a, b) { return (empLeaveMap[a].no || '').localeCompare(empLeaveMap[b].no || ''); });

	var lines = ['📋 本月請假累計（' + monthStart.substring(5) + ' ~ ' + monthEnd.substring(5) + '）'];
	var totalAll = 0;
	for (var k = 0; k < keys.length; k++) {
		var info = empLeaveMap[keys[k]];
		totalAll += info.totalHours;
		lines.push('\n👤 ' + info.name + '（' + info.no + '） 累計 ' + info.totalHours + 'h');
		for (var r = 0; r < info.records.length; r++) {
			var rec = info.records[r];
			lines.push('    ' + rec.start + ' ~ ' + rec.end + ' ' + rec.type + '（' + rec.hours + 'h）');
		}
	}
	lines.push('\n📊 全公司本月請假合計：' + totalAll + ' 小時');

	var titleB2 = lines[0];
	return sendTableImage(client, replyToken, titleB2, lines.join('\n'));
}

// 當月公司人員遲到累計
async function queryBossMonthLates(emp, client, replyToken) {
	var role = emp.role || '';
	if (role !== '老闆' && role !== 'boss') {
		return client.replyMessage(replyToken, [withMenu('❌ 無查詢權限')]);
	}

	var now = new Date();
	var monthStart = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
	var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

	var lateMin = parseInt(await db.getSetting('late_buffer_minutes') || process.env.LATE_BUFFER_MINUTES || '30');
	var startH = parseInt(await db.getSetting('work_start_hour') || process.env.WORK_START_HOUR || '8');
	var startM = parseInt(await db.getSetting('work_start_minute') || '0');
	var lateThreshold = startH * 60 + startM + lateMin;

	var allCheckins = await db.queryCheckins(null, monthStart, todayStr, 5000, 0);
	var allMonthLeaves = await db.getLeaveRequests('approved', 2000);
	var empLateMap = {}; // employee_id -> { name, no, records: [{date, time, lateMin}], count }

	for (var i = 0; i < allCheckins.length; i++) {
		var c = allCheckins[i];
		if (c.type !== 'check_in') continue;
		var ct = new Date(c.check_time);
		var totalMin = ct.getHours() * 60 + ct.getMinutes();
		if (totalMin <= lateThreshold) continue;

		var lateMins = totalMin - lateThreshold;
		var fullDateStr = ct.getFullYear() + '-' + String(ct.getMonth()+1).padStart(2,'0') + '-' + String(ct.getDate()).padStart(2,'0');
		// 假日/國定假日不計遲到
		if (await isHoliday(fullDateStr)) continue;
		var dateStr = String(ct.getMonth()+1).padStart(2,'0') + '-' + String(ct.getDate()).padStart(2,'0');
		if (!empLateMap[c.employee_id]) {
			empLateMap[c.employee_id] = { name: c.name, no: c.employee_no, records: [], count: 0 };
		}
		var timeStr = String(ct.getHours()).padStart(2, '0') + ':' + String(ct.getMinutes()).padStart(2, '0');
		// 檢查是否已有請假覆蓋此時段
		var coveredByLeave = false;
		var ctMs = ct.getTime();
		for (var cl = 0; cl < allMonthLeaves.length; cl++) {
			var clv = allMonthLeaves[cl];
			if (clv.employee_id !== c.employee_id || clv.status !== 'approved') continue;
			var cls = new Date(clv.start_date).getTime();
			var cle = new Date(clv.end_date).getTime();
			if (ctMs >= cls && ctMs <= cle) { coveredByLeave = true; break; }
		}
		empLateMap[c.employee_id].records.push({ date: dateStr, time: timeStr, lateMin: lateMins, covered: coveredByLeave });
		empLateMap[c.employee_id].count++;
	}

	var keys = Object.keys(empLateMap);
	if (keys.length === 0) {
		return client.replyMessage(replyToken, [withMenu('✅ 本月無遲到記錄')]);
	}

	keys.sort(function(a, b) { return (empLateMap[a].no || '').localeCompare(empLateMap[b].no || ''); });

	var lines = ['📋 本月遲到累計（' + monthStart.substring(5) + ' ~ ' + todayStr.substring(5) + '）'];
	var totalCount = 0;
	for (var k = 0; k < keys.length; k++) {
		var info = empLateMap[keys[k]];
		totalCount += info.count;
		lines.push('\n👤 ' + info.name + '（' + info.no + '） 遲到 ' + info.count + ' 次');
		for (var r = 0; r < info.records.length; r++) {
			var rec = info.records[r];
			lines.push('    ' + rec.date + ' ' + rec.time + '（晚 ' + rec.lateMin + ' 分）' + (rec.covered ? ' 已請假' : ''));
		}
	}
	lines.push('\n📊 全公司本月遲到合計：' + totalCount + ' 次');

	var titleB3 = lines[0];
	return sendTableImage(client, replyToken, titleB3, lines.join('\n'));
}

// 當月公司人員加班累計
async function queryBossMonthOvertime(emp, client, replyToken) {
	var role = emp.role || '';
	if (role !== '老闆' && role !== 'boss') {
		return client.replyMessage(replyToken, [withMenu('❌ 無查詢權限')]);
	}

	var now = new Date();
	var monthStart = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-01';
	var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

	var allOTs = await db.getOvertimeRequests('approved', 2000);
	var empOTMap = {}; // employee_id -> { name, no, records: [{start, end, hours}], totalHours }

	for (var i = 0; i < allOTs.length; i++) {
		var ot = allOTs[i];
		var os = typeof ot.start_time === 'string' ? (ot.start_time.indexOf(' ')!==-1 ? ot.start_time.split(' ')[0] : ot.start_time.split('T')[0]) : '';
		// 加班日期在本月範圍內
		if (os < monthStart || os > todayStr) continue;

		var otHours = 0;
		if (ot.start_time && ot.end_time) {
			var s2 = new Date(ot.start_time), e2 = new Date(ot.end_time);
			var diffMs = e2 - s2;
			if (diffMs > 0) otHours = Math.round(diffMs / 3600000 * 10) / 10;
		}
		if (!empOTMap[ot.employee_id]) {
			empOTMap[ot.employee_id] = { name: ot.name, no: ot.employee_no, records: [], totalHours: 0 };
		}
		empOTMap[ot.employee_id].records.push({ start: fmtDt(ot.start_time).substring(5), end: edtTime(ot.end_time), hours: otHours });
		empOTMap[ot.employee_id].totalHours += otHours;
	}

	var keys = Object.keys(empOTMap);
	if (keys.length === 0) {
		return client.replyMessage(replyToken, [withMenu('📋 本月無加班記錄')]);
	}

	keys.sort(function(a, b) { return (empOTMap[a].no || '').localeCompare(empOTMap[b].no || ''); });

	var lines = ['📋 本月加班累計（' + monthStart.substring(5) + ' ~ ' + todayStr.substring(5) + '）'];
	var totalAll = 0;
	for (var k = 0; k < keys.length; k++) {
		var info = empOTMap[keys[k]];
		totalAll += info.totalHours;
		lines.push('\n👤 ' + info.name + '（' + info.no + '） 累計 ' + info.totalHours + 'h');
		for (var r = 0; r < info.records.length; r++) {
			var rec = info.records[r];
			lines.push('    ' + rec.start + ' ~ ' + rec.end + '（' + rec.hours + 'h）');
		}
	}
	lines.push('\n📊 全公司本月加班合計：' + Math.round(totalAll * 10) / 10 + ' 小時');

	var titleB4 = lines[0];
	return sendTableImage(client, replyToken, titleB4, lines.join('\n'));
}

// 提取時間部分（HH:MM），用於加班結束時間顯示
function edtTime(str) {
  if (!str) return '';
  var s = fmtDt(str);
  var sp = s.indexOf(' ');
  return sp !== -1 ? s.substring(sp + 1) : s;
}

// ===== 表格圖片產生器 =====
var _emojiImages = {};
var _emojiLoaded = false;

// 預載 Emoji 圖片（從 Twemoji CDN）
async function loadEmojiImages() {
  try {
    var canvasLib = require('canvas');
    var https = require('https');
    var baseUrl = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/72x72/';
    var codes = {
      '⚠': '26a0', '❌': '274c', '✅': '2705', '📍': '1f4cd',
      '🏖': '1f3d6', '🕐': '1f550', '📊': '1f4ca', '👤': '1f464',
      '🔵': '1f535', '🔴': '1f534', '📋': '1f4cb', '📅': '1f4c5',
    };
    var keys = Object.keys(codes);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      try {
        var img = await canvasLib.loadImage(baseUrl + codes[key] + '.png');
        _emojiImages[key] = img;
      } catch(e2) {}
    }
    _emojiLoaded = true;
    console.log('[Emoji] loaded', Object.keys(_emojiImages).length, 'images');
  } catch(e) {
    console.log('[Emoji] load failed:', e.message);
  }
}

var _imageStore = {};
var _imageStoreCleanup = {};

// 清理過期圖片（5 分鐘後自動清除）
function storeImage(id, buf) {
  _imageStore[id] = buf;
  if (_imageStoreCleanup[id]) clearTimeout(_imageStoreCleanup[id]);
  _imageStoreCleanup[id] = setTimeout(function() {
    delete _imageStore[id];
    delete _imageStoreCleanup[id];
  }, 300000);
}
function getStoredImage(id) {
  return _imageStore[id] || null;
}

// 將文字轉為 PNG 表格圖片
function textToImage(title, bodyText) {
  var canvasLib;
  try {
    canvasLib = require('canvas');
  } catch (e) {
    return null;
  }

  // 替換 emoji 為標記字元（後續用 emoji 圖片取代）
  var emojiMap = {
    '⚠️': '! ', '⚠': '! ',
    '❌': 'X ',
    '✅': 'V ',
    '📍': '@ ',
    '🏖': '~ ',
    '🕐': 'O ',
    '📊': '= ',
    '👤': '* ',
    '🔵': '+ ',
    '🔴': '- ',
    '📋': '',
    '📅': '',
    '📦': ''
  };
  // 標記 → 原始 emoji（用於查找 emoji 圖片）
  var markerToEmoji = {
    '!': '⚠', 'X': '❌', 'V': '✅', '@': '📍',
    '~': '🏖', 'O': '🕐', '=': '📊', '*': '👤',
    '+': '🔵', '-': '🔴'
  };
  // 標記對應的顏色（emoji 圖片載入失敗時降級用）
  var iconColors = {
    '!': '#f59e0b', 'X': '#ef4444', 'V': '#22c55e', '@': '#3b82f6',
    '~': '#eab308', 'O': '#a855f7', '=': '#10b981', '*': '#6b7280',
    '+': '#3b82f6', '-': '#ef4444'
  };
  var emojiKeys = Object.keys(emojiMap);
  for (var ei = 0; ei < emojiKeys.length; ei++) {
    var ek = emojiKeys[ei];
    while (title.indexOf(ek) !== -1) title = title.replace(ek, '');
    while (bodyText.indexOf(ek) !== -1) bodyText = bodyText.replace(ek, emojiMap[ek]);
  }

  var fontFamily = _cnFontFamily || '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "STHeiti", "Microsoft JhengHei", sans-serif';

  var lines = bodyText.split('\n');
  var fontSize = 26;
  var lineHeight = 38;
  var paddingX = 24;
  var paddingY = 20;
  var titleHeight = 56;
  var titleFontSize = 30;

  // 計算所需寬度
  var cvTemp = canvasLib.createCanvas(2000, 100);
  var ctxTemp = cvTemp.getContext('2d');
  ctxTemp.font = fontSize + 'px ' + fontFamily;
  var maxW = ctxTemp.measureText(title).width;
  for (var i = 0; i < lines.length; i++) {
    var lw = ctxTemp.measureText(lines[i]).width;
    if (lw > maxW) maxW = lw;
  }
  var width = Math.max(800, Math.ceil(maxW + paddingX * 2));
  var height = Math.ceil(paddingY * 2 + titleHeight + lines.length * lineHeight);

  var cv = canvasLib.createCanvas(width, height);
  var ctx = cv.getContext('2d');

  // 白色背景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 標題列
  ctx.fillStyle = '#06c755';
  ctx.fillRect(0, 0, width, titleHeight + paddingY);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + titleFontSize + 'px ' + fontFamily;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, paddingX, paddingY + titleHeight / 2);

  // 資料行
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  var iconR = 11; // 彩色圓點半徑
  for (var i = 0; i < lines.length; i++) {
    var y = paddingY + titleHeight + i * lineHeight + lineHeight / 2;
    var line = lines[i];

    // 偵測行首標記（略過前導空白，找單字元 + 空格）
    var trimmed = line.replace(/^ +/, '');
    var marker = trimmed.length >= 2 ? trimmed.charAt(0) : '';
    var hasMarker = marker && trimmed.charAt(1) === ' ' && iconColors[marker];
    var indent = line.length - trimmed.length; // 前導空白數
    var displayText = hasMarker ? trimmed.substring(2) : line;

    // 判斷行類型
    if (line.indexOf('---') === 0 || line.length === 0) {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, y - lineHeight / 2, width, lineHeight);
    } else if (hasMarker) {
      // 有標記 → 繪製 emoji 圖片 + 文字
      var isSection = (marker === '!' || marker === 'X' || marker === '@' || marker === '~' || marker === 'O');
      var isTotal = (marker === '=');
      var textX = paddingX + indent * 10;
      var emojiSize = 30; // emoji 圖片大小

      // 區段標題 / 合計行才加背景
      if (isSection || isTotal) {
        ctx.fillStyle = isTotal ? '#e6f9ee' : '#f8fcf9';
        ctx.fillRect(0, y - lineHeight / 2, width, lineHeight);
      }

      // 嘗試繪製 emoji 圖片
      var origEmoji = markerToEmoji[marker];
      var emojiImg = origEmoji ? _emojiImages[origEmoji] : null;
      if (emojiImg) {
        // 繪製真實 emoji PNG
        ctx.drawImage(emojiImg, textX, y - emojiSize / 2, emojiSize, emojiSize);
      } else {
        // 降級：繪製彩色圓點
        var dotColor = iconColors[marker] || '#999';
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(textX + iconR + 2, y, iconR, 0, Math.PI * 2);
        ctx.fill();
      }

      // 文字（emoji 後留空間）
      var textOffsetX = emojiImg ? (emojiSize + 6) : (iconR * 2 + 10);
      ctx.fillStyle = isTotal ? '#06c755' : (isSection ? '#333333' : '#555555');
      ctx.font = (isSection || isTotal ? 'bold ' : '') + fontSize + 'px ' + fontFamily;
      ctx.fillText(displayText, textX + textOffsetX, y);
    } else if (line.indexOf('  ') === 0) {
      // 縮排明細
      ctx.fillStyle = '#666666';
      ctx.font = (fontSize - 2) + 'px ' + fontFamily;
      ctx.fillText(line, paddingX, y);
    } else {
      // 一般資料行
      ctx.fillStyle = '#333333';
      ctx.font = fontSize + 'px ' + fontFamily;
      ctx.fillText(line, paddingX, y);
    }
  }

  // 底部邊框
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, height);

  return cv.toBuffer('image/png');
}

// 傳送表格圖片（取代文字）
async function sendTableImage(client, replyToken, title, bodyText) {
  var png = textToImage(title, bodyText);
  if (!png) {
    // 降級：無法產生圖片時用文字
    return client.replyMessage(replyToken, [{ type: 'text', text: bodyText }]);
  }
  var imgId = 'q_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
  storeImage(imgId, png);
  var baseUrl = process.env.APP_URL || ('https://' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'));
  var imgUrl = baseUrl + '/img/' + imgId;
  return client.replyMessage(replyToken, [
    { type: 'image', originalContentUrl: imgUrl, previewImageUrl: imgUrl }
  ]);
}

module.exports = { handleEvents, setupRichMenu, makePng, makePng8, makePngBoss, assignRichMenu, initFont, loadEmojiImages, getStoredImage, leaveHours, refreshHolidays };
