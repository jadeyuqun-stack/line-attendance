const db = require('./database');
const states = new Map();
var _menuAssigned = {};

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
  ]
};

function getMenu(emp) {
  if (!emp) return GPS_BUTTONS;
  var role = emp.role || '';
  if (role === '老闆' || role === 'boss') return GPS_BUTTONS;
  if (role === '簽核人員' || role === '經理' || role === '主任' || emp.can_approve) return APPROVER_BUTTONS;
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
    { type: 'action', action: { type: 'datetimepicker', label: '📅 點我選日期時間', data: data, mode: 'datetime' } },
    { type: 'action', action: { type: 'message', label: '取消', text: '取消' } }
  ]}};
}


// 查詢待簽核項目（pull 模式，不耗 push quota）
var _pendingApprovalCache = {};

// pushMessage 含 429 重試 (LINE API rate limit)
// 取得 pushMessage 的 HTTP status code（相容 LINE SDK v9 / axios / raw）
function _getStatusCode(e) {
  if (e.statusCode) return e.statusCode;
  if (e.response && e.response.status) return e.response.status;
  if (e.originalError && e.originalError.status) return e.originalError.status;
  return 0;
}

function _getErrorDetail(e) {
  try {
    if (e.originalError && e.originalError.data) return JSON.stringify(e.originalError.data);
    if (e.response && e.response.data) return JSON.stringify(e.response.data);
    if (e.data) return JSON.stringify(e.data);
  } catch(_) {}
  return e.message || String(e);
}


// 查詢待簽核項目（pull 模式，不耗 push quota）
var _pendingApprovalCache = {};
async function checkPendingApprovals(client, uid, replyToken) {
  try {
    var emp = await db.getEmployeeByLineId(uid);
    if (!emp || (!emp.can_approve && emp.role !== '經理' && emp.role !== '老闆')) return false;
    var leaves = await db.getLeaveRequests('pending', 50);
    var ots = await db.getOvertimeRequests('pending', 50);
    var mps = await db.getMissedPunches('pending', 50);
    var myLeaves = [], myOTs = [], myMPs = [];
    for (var li = 0; li < leaves.length; li++) {
      var le = await db.getEmployeeById(leaves[li].employee_id);
      if (le) { var lv = leaves[li].approval_level || 1; var col = lv === 1 ? 'approver_id' : 'approver2_id'; var noAppL = !le.approver_id && !le.approver2_id ; if (le[col] === emp.id || (emp.can_approve && noAppL)) myLeaves.push(leaves[li]); }
    }
    for (var oi = 0; oi < ots.length; oi++) {
      var oe = await db.getEmployeeById(ots[oi].employee_id);
      if (oe) { var lv2 = ots[oi].approval_level || 1; var col2 = lv2 === 1 ? 'approver_id' : 'approver2_id'; var noAppO = !oe.approver_id && !oe.approver2_id; if (oe[col2] === emp.id || (emp.can_approve && noAppO)) myOTs.push(ots[oi]); }
    }
    for (var mi = 0; mi < mps.length; mi++) {
      var me = await db.getEmployeeById(mps[mi].employee_id);
      if (me) { var noAppM = !me.approver_id && !me.approver2_id; if (me.approver_id === emp.id || me.approver2_id === emp.id ||  (emp.can_approve && noAppM)) myMPs.push(mps[mi]); }
    }
    return myLeaves.length + myOTs.length + myMPs.length;
  } catch(e) { return 0; }
}

// 推播簽核通知到 LINE 群組（備用通道）
async function pushToGroup(client, text) {
  try {
    var groupId = await db.getSetting('report_group_id');
    if (groupId) { await client.pushMessage(groupId, [{ type: 'text', text: text }]); return true; }
  } catch(e) { /* 群組推播失敗不影響 */ }
  return false;
}

// pushMessage 含 429 重試 (LINE API rate limit)
async function pushWithRetry(client, uid, messages, retries, empIdForNotif) {
  // 若有提供 employee ID，同時存入資料庫通知（LINE 推播可能達上限）
  if (empIdForNotif && messages && messages.length > 0 && messages[0].text) {
    try { await db.addPendingNotification(empIdForNotif, messages[0].text); } catch(e) { console.error('[push] db notify error:', e.message); }
  }
  retries = retries || 3;
  for (var attempt = 0; attempt < retries; attempt++) {
    try {
      return await client.pushMessage(uid, messages);
    } catch (e) {
      var st = _getStatusCode(e);
      var detail = _getErrorDetail(e);
      if (attempt === 0) console.error('[push] uid=' + uid + ' attempt=0 status=' + st + ' detail=' + detail);
      if (st === 429 && attempt < retries - 1) {
        var delay = Math.pow(2, attempt) * 1000;
        console.log('[push] 429 retry ' + (attempt + 1) + '/' + retries + ' delay ' + delay + 'ms uid=' + uid);
        await new Promise(function (resolve) { setTimeout(resolve, delay); });
      } else {
        if (attempt > 0) console.error('[push] exhausted uid=' + uid + ' status=' + st + ' detail=' + detail);
        pushToGroup(client, '⚠️ 推播通知失敗（uid=' + uid + ' status=' + st + '）\n\n請簽核人員輸入「待簽核」查看待審項目').catch(function(){});
        return; // 靜默失敗，不影響使用者
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

  // 確保 Rich Menu 正確分配（每位用戶每重啟一次，僅執行一次）
  if (!_menuAssigned[uid]) {
    _menuAssigned[uid] = true;
    assignRichMenu(uid, emp.role).catch(function(e2) {});
  }

  // 簽核結果通知：下次互動時顯示（不耗 push 額度）
  var _notifMsg = '';
  try {
    var notifs = await db.getPendingNotifications(emp.id);
    if (notifs && notifs.length > 0) {
      var _msgs = notifs.map(function(n) { return n.message; }).join('\n\n');
      await db.clearPendingNotifications(emp.id);
      _notifMsg = '📬 ' + _msgs.replace(/\n/g, ' · ');
    }
  } catch(e) { console.error('[notif] check error:', e.message); }

  // 待簽核提醒：有新項目時顯示提示，但不阻擋指令
  var _pendingMsg = _notifMsg;
  try {
    if (emp && (emp.can_approve || emp.role === '經理' || emp.role === '老闆' || emp.role === '簽核人員')) {
      var _isApprovalCmd = cmd === '待簽核' || cmd === '查看待簽核' || cmd === 'pending' || cmd === '核准全部';
      var _isInApprovalFlow = states.has(uid) && (states.get(uid).flow === 'approval_browse' || states.get(uid).flow === 'reject_leave' || states.get(uid).flow === 'reject_ot' || states.get(uid).flow === 'reject_missed');
      if (!_isApprovalCmd && !_isInApprovalFlow) {
        var _pendingCount = await countPendingForApprover(emp);
        if (_pendingCount > 0) {
          _pendingMsg = (_pendingMsg ? _pendingMsg + '\n' : '') + '📋 您有 ' + _pendingCount + ' 筆待簽核，輸入「待簽核」查看';
        }
      }
    }
  } catch(e) { console.error('[reminder] check error:', e.message); }

  if (cmd === '我的ID' || cmd.toLowerCase() === 'my id') {
    return client.replyMessage(replyToken, _pendingMsg ? [{ type: 'text', text: _pendingMsg }, withMenu('🆔 LINE User ID：' + uid + '\n✅ 已綁定：' + emp.name + '（' + emp.employee_no + '）')] : [withMenu('🆔 LINE User ID：' + uid + '\n✅ 已綁定：' + emp.name + '（' + emp.employee_no + '）')]);
  }
  if (cmd === '請假' || cmd === '请假') return startLeaveFlow(uid, client, replyToken, _pendingMsg || undefined);
  if (cmd === '查詢當天考勤') return queryTodayAttendance(emp, client, replyToken);
  if (cmd === '查詢當月考勤') return queryMonthAttendance(emp, client, replyToken);
  if (cmd === '公司今日考勤') return queryBossTodayStatus(emp, client, replyToken);
  if (cmd === '本月請假累計') return queryBossMonthLeaves(emp, client, replyToken);
  if (cmd === '本月考勤異常累計') return queryBossMonthLates(emp, client, replyToken);
  if (cmd === '本月加班累計') return queryBossMonthOvertime(emp, client, replyToken);
  if (cmd === '待簽核' || cmd === '查看待簽核' || cmd === 'pending') return checkPendingApprovalsCmd(emp, client, replyToken, uid, _pendingMsg || undefined);
  if (cmd === '加班') return startOvertimeFlow(uid, client, replyToken, _pendingMsg || undefined);
  if (cmd === '補打卡' || cmd === '补打卡') return startMissedPunch(uid, client, replyToken, _pendingMsg || undefined);
  if (cmd === '核准全部') return batchApproveAll(emp, client, replyToken, _pendingMsg || undefined, uid);
  if (cmd === '駁回全部') return batchRejectAll(emp, client, replyToken, _pendingMsg || undefined, uid);
  if (cmd === '取消' && states.has(uid)) { states.delete(uid); return client.replyMessage(replyToken, _pendingMsg ? [{ type: 'text', text: _pendingMsg }, withMenu('已取消操作。')] : [withMenu('已取消操作。')]); }
  // 查詢/記錄可跳出任何進行中的流程（避免陷入迴圈）
  if ((cmd.includes('查詢') || cmd.includes('記錄')) && states.has(uid)) {
    states.delete(uid);
    return doQuery(emp, client, replyToken, _pendingMsg || undefined);
  }
  if (states.has(uid)) {
    var state2 = states.get(uid);
    if (state2.flow === 'reject_leave' || state2.flow === 'reject_ot' || state2.flow === 'reject_missed') {
      return handleRejectReason(cmd, uid, client, replyToken, emp);
    }
    if (state2.flow === 'approval_browse') {
      return handleApprovalBrowseInput(cmd, uid, client, replyToken, emp);
    }
    return handleFlow(cmd, uid, client, replyToken, emp, _pendingMsg);
  }
  if (cmd.includes('上班')) { states.set(uid, { flow: 'gps_check', type: 'check_in' }); var _gpsQR1 = { items: [{ type: 'action', action: { type: 'location', label: '📍 分享位置' } }, { type: 'action', action: { type: 'message', label: '取消', text: '取消' } }] }; var _msg1 = [{ type: 'text', text: '📍 請分享您的位置進行上班打卡：', quickReply: _gpsQR1 }]; if (_pendingMsg) _msg1.unshift({ type: 'text', text: _pendingMsg }); return client.replyMessage(replyToken, _msg1); }
  if (cmd.includes('下班')) { states.set(uid, { flow: 'gps_check', type: 'check_out' }); var _gpsQR2 = { items: [{ type: 'action', action: { type: 'location', label: '📍 分享位置' } }, { type: 'action', action: { type: 'message', label: '取消', text: '取消' } }] }; var _msg2 = [{ type: 'text', text: '📍 請分享您的位置進行下班打卡：', quickReply: _gpsQR2 }]; if (_pendingMsg) _msg2.unshift({ type: 'text', text: _pendingMsg }); return client.replyMessage(replyToken, _msg2); }
  if (cmd.includes('查詢') || cmd.includes('記錄')) return doQuery(emp, client, replyToken, _pendingMsg || undefined);
  // 經理測試模式切換
  if (cmd === '切換測試模式' || cmd === '測試模式') {
    if (emp.role !== '經理') return client.replyMessage(replyToken, [withMenu('❌ 僅經理可使用測試模式')]);
    var newMode = emp.manager_mode === 'test' ? 'normal' : 'test';
    await db.updateEmployee(emp.id, { manager_mode: newMode });
    emp.manager_mode = newMode;
    return client.replyMessage(replyToken, [withMenu(newMode === 'test' ? '🔬 已切換為測試模式，所有規則限制已暫停。\n\n任何打卡、請假、加班皆不檢查限制。\n\n輸入「切換測試模式」可恢復正常模式。' : '✅ 已切換為正常模式，規則限制已恢復。')]);
  }

  if (cmd.includes('幫助')) return client.replyMessage(replyToken, _pendingMsg ? [{ type: 'text', text: _pendingMsg }, withMenu('📖 功能選單\n📍傳位置→打卡 🏖請假 🕐加班\n📋查詢 🆔我的ID\n✅核准全部')] : [withMenu('📖 功能選單\n📍傳位置→打卡 🏖請假 🕐加班\n📋查詢 🆔我的ID\n✅核准全部')]);
  return client.replyMessage(replyToken, _pendingMsg ? [{ type: 'text', text: _pendingMsg }, withMenu('請點選下方選單，或輸入：上班 / 下班 / 查詢 / 請假 / 加班 / 我的ID')] : [withMenu('請點選下方選單，或輸入：上班 / 下班 / 查詢 / 請假 / 加班 / 我的ID')]);
}

// 待簽核查詢指令
// 請假類型對照
var _leaveTypeLabels = {
  'annual': '特休', 'personal': '事假', 'sick': '病假',
  'official': '公假', 'outing': '外出', 'other': '其他', 'marriage': '婚假(陪產假)', 'funeral': '喪假', 'comp': '補休'
};
function leaveTypeLabel(t) { return _leaveTypeLabels[t] || t || '請假'; }

// 計算工時（小時）
function calcHours(s, e) {
  if (!s || !e) return 0;
  var d = new Date(e) - new Date(s);
  return d > 0 ? Math.round(d / 3600000 * 10) / 10 : 0;
}

async function getOverdueApprovalReminder(emp) {
  if (!emp || (!emp.can_approve && emp.role !== '經理' && emp.role !== '老闆' && emp.role !== '簽核人員')) return null;
  var hoursStr = await db.getSetting('approval_remind_hours') || '0';
  var hours = parseInt(hoursStr);
  if (hours <= 0) return null;
  var threshold = new Date(Date.now() - hours * 60 * 60 * 1000);
  var pendingLeaves = await db.getLeaveRequests('pending', 200);
  var pendingOTs = await db.getOvertimeRequests('pending', 200);
  var pendingMPs = await db.getMissedPunches('pending', 200);
  var count = 0;
  for (var li = 0; li < pendingLeaves.length; li++) {
    var le = await db.getEmployeeById(pendingLeaves[li].employee_id);
    if (!le) continue;
    if (pendingLeaves[li].created_at && new Date(pendingLeaves[li].created_at) >= threshold) continue;
    var lv = pendingLeaves[li].approval_level || 1;
    var col = lv === 1 ? 'approver_id' : 'approver2_id';
    var isDes = le[col] === emp.id;
    var noApp = !le.approver_id && !le.approver2_id ;
    if (isDes || (emp.can_approve && noApp)) count++;
  }
  for (var oi = 0; oi < pendingOTs.length; oi++) {
    var oe = await db.getEmployeeById(pendingOTs[oi].employee_id);
    if (!oe) continue;
    if (pendingOTs[oi].created_at && new Date(pendingOTs[oi].created_at) >= threshold) continue;
    var lv2 = pendingOTs[oi].approval_level || 1;
    var col2 = lv2 === 1 ? 'approver_id' : 'approver2_id';
    var isDes2 = oe[col2] === emp.id;
    var noApp2 = !oe.approver_id && !oe.approver2_id;
    if (isDes2 || (emp.can_approve && noApp2)) count++;
  }
  for (var mi = 0; mi < pendingMPs.length; mi++) {
    var me = await db.getEmployeeById(pendingMPs[mi].employee_id);
    if (!me) continue;
    if (pendingMPs[mi].created_at && new Date(pendingMPs[mi].created_at) >= threshold) continue;
    var noApp3 = !me.approver_id && !me.approver2_id;
    var isDes3 = me.approver_id === emp.id || me.approver2_id === emp.id || me.approver3_id === emp.id;
    if (isDes3 || (emp.can_approve && noApp3)) count++;
  }
  if (count === 0) return null;
  return '您有 ' + count + ' 筆待簽核申請已超過 ' + hours + ' 小時未處理。';
}

// 計算該簽核人員目前當階待簽核總數（只看自己該階的項目）
async function countPendingForApprover(emp) {
  if (!emp || (!emp.can_approve && emp.role !== '經理' && emp.role !== '老闆' && emp.role !== '簽核人員')) return 0;
  try {
    var pl = await db.getLeaveRequests('pending', 200);
    var po = await db.getOvertimeRequests('pending', 200);
    var pm = await db.getMissedPunches('pending', 200);
    var c = 0;
    for (var i = 0; i < pl.length; i++) {
      var e = await db.getEmployeeById(pl[i].employee_id);
      if (!e) continue;
      var lv = pl[i].approval_level || 1;
      var col = lv === 1 ? 'approver_id' : 'approver2_id';
      var isDes = e[col] === emp.id;
      var noApprover = !e.approver_id && !e.approver2_id;
      if (isDes || (emp.can_approve && noApprover)) c++;
    }
    for (var i = 0; i < po.length; i++) {
      var e = await db.getEmployeeById(po[i].employee_id);
      if (!e) continue;
      var lv2 = po[i].approval_level || 1;
      var col2 = lv2 === 1 ? 'approver_id' : 'approver2_id';
      var isDes2 = e[col2] === emp.id;
      var noApprover2 = !e.approver_id && !e.approver2_id;
      if (isDes2 || (emp.can_approve && noApprover2)) c++;
    }
    for (var i = 0; i < pm.length; i++) {
      var e = await db.getEmployeeById(pm[i].employee_id);
      if (!e) continue;
      var noApprover3 = !e.approver_id && !e.approver2_id;
      var isDes3 = e.approver_id === emp.id || e.approver2_id === emp.id || e.approver3_id === emp.id;
      if (isDes3 || (emp.can_approve && noApprover3)) c++;
    }
    return c;
  } catch(e) { return 0; }
}

async function checkPendingApprovalsCmd(emp, client, replyToken, uid, _prefix) {
  if (!emp || (!emp.can_approve && emp.role !== '經理' && emp.role !== '老闆' && emp.role !== '簽核人員')) {
    return client.replyMessage(replyToken, [withMenu('❌ 無簽核權限')]);
  }
  try {
    var leaves = await db.getLeaveRequests('pending', 50);
    var ots = await db.getOvertimeRequests('pending', 50);
    var mps = await db.getMissedPunches('pending', 50);
    var items = [];
    for (var li = 0; li < leaves.length; li++) {
      var le = await db.getEmployeeById(leaves[li].employee_id);
      if (le) { var lv = leaves[li].approval_level || 1; var col = lv === 1 ? 'approver_id' : 'approver2_id'; var noAppL = !le.approver_id && !le.approver2_id ; if (le[col] === emp.id || (emp.can_approve && noAppL)) items.push({ type: 'leave', data: leaves[li], empName: le.name, empNo: le.employee_no }); }
    }
    for (var oi = 0; oi < ots.length; oi++) {
      var oe = await db.getEmployeeById(ots[oi].employee_id);
      if (oe) { var lv2 = ots[oi].approval_level || 1; var col2 = lv2 === 1 ? 'approver_id' : 'approver2_id'; var noAppO = !oe.approver_id && !oe.approver2_id; if (oe[col2] === emp.id || (emp.can_approve && noAppO)) items.push({ type: 'ot', data: ots[oi], empName: oe.name, empNo: oe.employee_no }); }
    }
    for (var mi = 0; mi < mps.length; mi++) {
      var me = await db.getEmployeeById(mps[mi].employee_id);
      if (me) { var noAppM = !me.approver_id && !me.approver2_id; if (me.approver_id === emp.id || me.approver2_id === emp.id ||  (emp.can_approve && noAppM)) items.push({ type: 'missed', data: mps[mi], empName: me.name, empNo: me.employee_no }); }
    }
    if (items.length === 0) return client.replyMessage(replyToken, [withMenu('✅ 目前無待簽核項目')]);
    // 儲存到 state
    states.set(uid, { flow: 'approval_browse', step: 'list', items: items });
    var msg = '📋 待簽核項目（共 ' + items.length + ' 筆）\n\n';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var icon = it.type === 'leave' ? '🏖' : it.type === 'ot' ? '🕐' : '📝';
      var numTag = '[' + (i + 1) + ']';
      msg += icon + ' ' + numTag + ' ' + it.empName + '（' + it.empNo + '）\n';
      if (it.type === 'leave') {
        var lh2 = leaveHours(it.data.start_date, it.data.end_date);
        msg += '    ' + leaveTypeLabel(it.data.leave_type) + '：' + fmtDt(it.data.start_date) + ' ~ ' + fmtDt(it.data.end_date) + '（' + lh2 + 'h）\n';
        if (it.data.reason) msg += '    原因：' + it.data.reason + '\n';
      } else if (it.type === 'ot') {
        var oh2 = calcHours(it.data.start_time, it.data.end_time);
        msg += '    ' + fmtDt(it.data.start_time) + ' ~ ' + fmtDt(it.data.end_time) + '（' + oh2 + 'h）\n';
        if (it.data.reason) msg += '    原因：' + it.data.reason + '\n';
      } else {
        msg += '    ' + (it.data.punch_type === 'check_in' ? '🔵補上班' : '🔴補下班') + '：' + it.data.punch_date + ' ' + (it.data.punch_time || '') + '\n';
        if (it.data.reason) msg += '    原因：' + it.data.reason + '\n';
      }
      msg += '\n';
    }
    msg += '💡 輸入編號進行核准/駁回\n🔙 取消 → 離開';
    var qr = {
      items: [
        { type: 'action', action: { type: 'message', label: '✅ 核准全部', text: '核准全部' } },
        { type: 'action', action: { type: 'message', label: '🔙 取消', text: '取消' } },
      ]
    };
    if (_prefix) msg = msg + '\n' + _prefix;
    return client.replyMessage(replyToken, [{ type: 'text', text: msg, quickReply: qr }]);
  } catch(e) { console.error('[approve] list error:', e.message || e); return client.replyMessage(replyToken, [withMenu('❌ 查詢失敗')]); }
}

// 處理待簽核瀏覽輸入
async function handleApprovalBrowseInput(text, uid, client, replyToken, emp) {
  var state = states.get(uid);
  if (!state || state.flow !== 'approval_browse') return;
  if (text === '取消') { states.delete(uid); return client.replyMessage(replyToken, [withMenu('已離開待簽核清單')]); }
    if (text === '核准全部') {
      states.delete(uid);
      return batchApproveAll(emp, client, replyToken, '', uid);
    }
  if (state.step === 'list') {
    var num = parseInt(text);
    if (isNaN(num) || num < 1 || num > state.items.length) {
      return client.replyMessage(replyToken, [withMenu('請輸入有效編號 1~' + state.items.length + '，或輸入「取消」離開')]);
    }
    var item = state.items[num - 1];
    state.selectedIdx = num - 1;
    state.step = 'detail';
    // 顯示詳細內容（純文字）
    if (item.type === 'leave') {
      var lh = leaveHours(item.data.start_date, item.data.end_date);
      var detailText = '🏖 請假申請\n';
      detailText += '員工：' + item.empName + '（' + item.empNo + '）\n';
      detailText += '假別：' + leaveTypeLabel(item.data.leave_type) + '\n';
      detailText += '時間：' + fmtDt(item.data.start_date) + ' ~ ' + fmtDt(item.data.end_date) + '（' + lh + ' 小時）\n';
      detailText += '原因：' + (item.data.reason || '未填寫');
      return client.replyMessage(replyToken, [{ type: 'text', text: detailText, quickReply: { items: [
        { type: 'action', action: { type: 'message', label: '✅ 核准', text: '核准' } },
        { type: 'action', action: { type: 'message', label: '❌ 駁回', text: '駁回 ' } },
        { type: 'action', action: { type: 'message', label: '🔙 返回', text: '返回' } },
        { type: 'action', action: { type: 'message', label: '取消', text: '取消' } }
      ] } }]);
    } else if (item.type === 'ot') {
      var oh = calcHours(item.data.start_time, item.data.end_time);
      var detailText = '🕐 加班申請\n';
      detailText += '員工：' + item.empName + '（' + item.empNo + '）\n';
      detailText += '時間：' + fmtDt(item.data.start_time) + ' ~ ' + fmtDt(item.data.end_time) + '（' + oh + ' 小時）\n';
      detailText += '原因：' + (item.data.reason || '未填寫');
      return client.replyMessage(replyToken, [{ type: 'text', text: detailText, quickReply: { items: [
        { type: 'action', action: { type: 'message', label: '✅ 核准', text: '核准' } },
        { type: 'action', action: { type: 'message', label: '❌ 駁回', text: '駁回 ' } },
        { type: 'action', action: { type: 'message', label: '🔙 返回', text: '返回' } },
        { type: 'action', action: { type: 'message', label: '取消', text: '取消' } }
      ] } }]);
    } else if (item.type === 'missed') {
      var detailText = '📝 補打卡申請\n';
      detailText += '員工：' + item.empName + '（' + item.empNo + '）\n';
      detailText += '類型：' + (item.data.punch_type === 'check_in' ? '🔵補上班' : '🔴補下班') + '\n';
      detailText += '日期：' + item.data.punch_date + ' ' + item.data.punch_time + '\n';
      detailText += '原因：' + (item.data.reason || '未填寫');
      return client.replyMessage(replyToken, [{ type: 'text', text: detailText, quickReply: { items: [
        { type: 'action', action: { type: 'message', label: '✅ 核准', text: '核准' } },
        { type: 'action', action: { type: 'message', label: '❌ 駁回', text: '駁回 ' } },
        { type: 'action', action: { type: 'message', label: '🔙 返回', text: '返回' } },
        { type: 'action', action: { type: 'message', label: '取消', text: '取消' } }
      ] } }]);
    }
  }
  // 從 detail 處理核准/駁回
  if (state.step === 'detail') {
    var selItem = state.items[state.selectedIdx];
    if (!selItem) return client.replyMessage(replyToken, [withMenu('❌ 無法取得申請資料')]);

    if (text === '核准') {
      states.delete(uid);
      try {
        var aprResult;
        if (selItem.type === 'leave') {
          aprResult = await db.updateLeaveStatus(selItem.data.id, 'approved', emp.id);
          var leaveEmp = await db.getEmployeeById(selItem.data.employee_id);
          if (leaveEmp && leaveEmp.line_user_id) await db.addPendingNotification(leaveEmp.id, '🎉 請假已核准！\n' + fmtDt(selItem.data.start_date) + ' ~ ' + fmtDt(selItem.data.end_date));
        } else if (selItem.type === 'ot') {
          aprResult = await db.updateOvertimeStatus(selItem.data.id, 'approved', emp.id);
          var otEmp = await db.getEmployeeById(selItem.data.employee_id);
          if (otEmp && otEmp.line_user_id) await db.addPendingNotification(otEmp.id, '🎉 加班已核准！\n' + fmtDt(selItem.data.start_time) + ' ~ ' + fmtDt(selItem.data.end_time));
        } else if (selItem.type === 'missed') {
          aprResult = await db.updateMissedPunchStatus(selItem.data.id, 'approved', emp.id);
          var mpEmp = await db.getEmployeeById(selItem.data.employee_id);
          if (mpEmp && mpEmp.line_user_id) await db.addPendingNotification(mpEmp.id, '🎉 補打卡已核准！\n' + fmtDt(selItem.data.punch_date) + ' ' + selItem.data.punch_time);
        }
        if (aprResult && aprResult.notYourTurn) {
          return client.replyMessage(replyToken, [withMenu('⏳ 此申請尚未輪到您簽核（目前在第 ' + (selItem.data.approval_level || 1) + ' 階）\n\n輸入「待簽核」返回清單')]);
        }
        return client.replyMessage(replyToken, [withMenu('✅ 已核准！\n\n輸入「待簽核」繼續查看其他項目')]);
      } catch(e) { console.error('[approve] error:', e.message); return client.replyMessage(replyToken, [withMenu('❌ 核准失敗')]); }
    }

    if (text.indexOf('駁回') === 0) {
      var reason = text.substring(2).trim();
      if (!reason) {
        // 只按了「駁回」按鈕未附原因 → 先要求輸入
        var _rejectFlow = selItem.type === 'leave' ? 'reject_leave' : selItem.type === 'ot' ? 'reject_ot' : 'reject_missed';
        states.set(uid, { flow: _rejectFlow, id: selItem.data.id, approverId: emp.id });
        return client.replyMessage(replyToken, [withMenu('📝 請輸入駁回原因（或輸入「取消」放棄）：')]);
      }
      states.delete(uid);
      try {
        if (selItem.type === 'leave') {
          await db.updateLeaveStatus(selItem.data.id, 'rejected', emp.id, reason);
          var leaveEmp2 = await db.getEmployeeById(selItem.data.employee_id);
          if (leaveEmp2 && leaveEmp2.line_user_id) await db.addPendingNotification(leaveEmp2.id, '❌ 請假被駁回\n時間：' + fmtDt(selItem.data.start_date) + ' ~ ' + fmtDt(selItem.data.end_date) + '\n駁回原因：' + reason);
        } else if (selItem.type === 'ot') {
          await db.updateOvertimeStatus(selItem.data.id, 'rejected', emp.id, reason);
          var otEmp2 = await db.getEmployeeById(selItem.data.employee_id);
          if (otEmp2 && otEmp2.line_user_id) await db.addPendingNotification(otEmp2.id, '❌ 加班被駁回\n時間：' + fmtDt(selItem.data.start_time) + ' ~ ' + fmtDt(selItem.data.end_time) + '\n駁回原因：' + reason);
        } else if (selItem.type === 'missed') {
          await db.updateMissedPunchStatus(selItem.data.id, 'rejected', emp.id, reason);
          var mpEmp2 = await db.getEmployeeById(selItem.data.employee_id);
          if (mpEmp2 && mpEmp2.line_user_id) await db.addPendingNotification(mpEmp2.id, '❌ 補打卡被駁回\n' + fmtDt(selItem.data.punch_date) + ' ' + selItem.data.punch_time + '\n駁回原因：' + reason);
        }
        return client.replyMessage(replyToken, [withMenu('已駁回（原因：' + reason + '）\n\n輸入「待簽核」繼續查看其他項目')]);
      } catch(e) { console.error('[reject] error:', e.message); return client.replyMessage(replyToken, [withMenu('❌ 駁回失敗')]); }
    }
  }
  // 從 detail 返回 list
  if (text === '返回' && state.step === 'detail') {
    state.step = 'list';
    // 重新顯示清單
    return checkPendingApprovalsCmd(emp, client, replyToken);
  }
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

async function startMissedPunch(uid, client, replyToken, _prefix) {
  states.set(uid, { flow: "missed", step: "type" });
  var _msg = [{
    type: "text", text: "📝 補打卡申請\n\n請選擇補打卡類型：",
    quickReply: { items: [
      { type: "action", action: { type: "message", label: "🔵 補上班卡", text: "補上班" } },
      { type: "action", action: { type: "message", label: "🔴 補下班卡", text: "補下班" } },
      { type: "action", action: { type: "message", label: "取消", text: "取消" } }
    ]}}];
if (_prefix) _msg.unshift({ type: "text", text: _prefix });
  return client.replyMessage(replyToken, _msg);
}

async function batchApproveAll(emp, client, replyToken, _prefix, uid) {
  if (uid) states.delete(uid);
  // 簽核人員（即使沒有 can_approve）也可用批次核准，限指定員工
  var isApproverRole = emp.role === '簽核人員' || emp.role === '經理' || emp.role === '老闆';
  if (!emp.can_approve && !isApproverRole) return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu('❌ 無簽核權限')] : [withMenu('❌ 無簽核權限')]);
  var leaves = await db.getLeaveRequests('pending', 200);
  var ots = await db.getOvertimeRequests('pending', 200);
  var mps = await db.getMissedPunches('pending', 200);
  // 非 can_approve 的簽核人員：只簽自己指定的員工
  var designatedIds = emp.can_approve ? null : (await db.getDesignatedEmployeeIds(emp.id)).map(function(d) { return d.id; });
  var lines = [];
  function canBatch(emp2, eid, appr) {
    if (appr && appr.can_approve) return true;
    if (emp2.approver_id === eid || emp2.approver2_id === eid) return true;
    if (designatedIds && designatedIds.indexOf(emp2.id) >= 0) {
      if (!emp2.approver_id && !emp2.approver2_id) return true;
    }
    return false;
  }
  for (var i = 0; i < leaves.length; i++) { var e = await db.getEmployeeById(leaves[i].employee_id); if (e && canBatch(e, emp.id, emp)) { var _r1 = await db.updateLeaveStatus(leaves[i].id, 'approved', emp.id); if (!_r1 || !_r1.notYourTurn) { lines.push('🏖 ' + e.name + ' ' + leaveTypeLabel(leaves[i].leave_type) + ' ' + fmtDt(leaves[i].start_date)); } } }
  for (var i = 0; i < ots.length; i++) { var e = await db.getEmployeeById(ots[i].employee_id); if (e && canBatch(e, emp.id, emp)) { var _r2 = await db.updateOvertimeStatus(ots[i].id, 'approved', emp.id); if (!_r2 || !_r2.notYourTurn) { lines.push('🕐 ' + e.name + ' 加班 ' + fmtDt(ots[i].start_time)); } } }
  for (var i = 0; i < mps.length; i++) { var e = await db.getEmployeeById(mps[i].employee_id); if (e && canBatch(e, emp.id, emp)) { var _r3 = await db.updateMissedPunchStatus(mps[i].id, 'approved', emp.id); if (_r3) { lines.push('📝 ' + e.name + ' ' + (mps[i].punch_type === 'check_in' ? '補上班' : '補下班') + ' ' + mps[i].punch_date); } } }
  if (lines.length === 0) return client.replyMessage(replyToken, _prefix ? [withMenu('✅ 無可核准的項目（可能非您簽核階段）')] : [withMenu('✅ 無可核准的項目（可能非您簽核階段）')]);
  return client.replyMessage(replyToken, _prefix ? [withMenu('✅ 已核准 ' + lines.length + ' 筆\n' + lines.join(' · ')), { type: 'text', text: _prefix }] : [withMenu('✅ 已核准 ' + lines.length + ' 筆\n' + lines.join(' · '))]);
}

async function batchRejectAll(emp, client, replyToken, _prefix, uid) {
  if (uid) states.delete(uid);
  var isApproverRole2 = emp.role === '簽核人員' || emp.role === '經理' || emp.role === '老闆';
  if (!emp.can_approve && !isApproverRole2) return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu('❌ 無簽核權限')] : [withMenu('❌ 無簽核權限')]);
  var leaves = await db.getLeaveRequests('pending', 200);
  var ots = await db.getOvertimeRequests('pending', 200);
  var mps = await db.getMissedPunches('pending', 200);
  var designatedIds2 = emp.can_approve ? null : (await db.getDesignatedEmployeeIds(emp.id)).map(function(d) { return d.id; });
  var lCount = 0, otCount = 0, mpCount = 0;
  function canBatch2(emp2, eid, appr) {
    if (appr && appr.can_approve) return true;
    if (emp2.approver_id === eid || emp2.approver2_id === eid) return true;
    if (designatedIds2 && designatedIds2.indexOf(emp2.id) >= 0) {
      if (!emp2.approver_id && !emp2.approver2_id) return true;
    }
    return false;
  }
  for (var i = 0; i < leaves.length; i++) { var e = await db.getEmployeeById(leaves[i].employee_id); if (e && canBatch2(e, emp.id, emp)) { await db.updateLeaveStatus(leaves[i].id, 'rejected', emp.id); lCount++; } }
  for (var i = 0; i < ots.length; i++) { var e = await db.getEmployeeById(ots[i].employee_id); if (e && canBatch2(e, emp.id, emp)) { await db.updateOvertimeStatus(ots[i].id, 'rejected', emp.id); otCount++; } }
  for (var i = 0; i < mps.length; i++) { var e = await db.getEmployeeById(mps[i].employee_id); if (e && canBatch2(e, emp.id, emp)) { await db.updateMissedPunchStatus(mps[i].id, 'rejected', emp.id); mpCount++; } }
  var detail = '';
  if (lCount > 0) detail += '🏖 請假：' + lCount + ' 筆 ';
  if (otCount > 0) detail += '🕐 加班：' + otCount + ' 筆 ';
  if (mpCount > 0) detail += '📝 補打卡：' + mpCount + ' 筆 ';
  return client.replyMessage(replyToken, _prefix ? [withMenu('已駁回 ' + (lCount+otCount+mpCount) + ' 筆\n' + detail), { type: 'text', text: _prefix }] : [withMenu('已駁回 ' + (lCount+otCount+mpCount) + ' 筆\n' + detail)]);
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
  if (late > 0) contents.push({ type: 'text', text: '⚠️ 考勤異常 ' + late + ' 分鐘', margin: 'sm', color: '#e74c3c', size: 'sm' });
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
  var _ls1 = new Date(ci); _ls1.setHours(12, 0, 0, 0);
	var _le1 = new Date(ci); _le1.setHours(13, 0, 0, 0);
	var _os1 = ci > _ls1 ? ci : _ls1;
	var _oe1 = co < _le1 ? co : _le1;
	var lunchDeduct = _os1 < _oe1 ? Math.round((_oe1 - _os1) / 1800000) * 0.5 : 0;
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
async function doQuery(emp, client, replyToken, _prefix) {
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
    var _ls2 = new Date(ciDt); _ls2.setHours(12, 0, 0, 0);
		var _le2 = new Date(ciDt); _le2.setHours(13, 0, 0, 0);
		var _os2 = ciDt > _ls2 ? ciDt : _ls2;
		var _oe2 = coDt < _le2 ? coDt : _le2;
		var lunchDed = _os2 < _oe2 ? Math.round((_oe2 - _os2) / 1800000) * 0.5 : 0;
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

  var _titleExtra = emp.hire_date ? ' | 📅 入職日：' + emp.hire_date : '';
  var lines = ['📅 當月考勤明細（' + monthStart.substring(5) + ' ~ ' + todayStr.substring(5) + '）' + _titleExtra + ''];

  // 考勤異常記錄
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
      if (isCoveredByLeave(ctMs, clv.start_date, clv.end_date)) {
        covered = true; break;
      }
    }
    lateRecords.push({ date: dateStr, time: timeStr, lateMin: lateMins, covered: covered });
  }
  if (lateRecords.length > 0) {
    lines.push('\n⚠️ 考勤異常（' + lateRecords.length + ' 次）：');
    for (var lr = 0; lr < lateRecords.length; lr++) {
      var lr2 = lateRecords[lr];
      lines.push('  ' + lr2.date + ' ' + lr2.time + ' 晚 ' + lr2.lateMin + ' 分' + (lr2.covered ? '' : ' （尚未請假）'));
    }
  } else {
    lines.push('\n⚠️ 考勤異常：無');
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
    var leaveLabel = leaveTypeLabel(ml.leave_type);
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

  // 
  // 入職日與年度請假統計

  try {
    var _allLeaves3 = await db.getEmployeeLeaveRequests(emp.id, 'approved', 200);
    var _yearStart3 = new Date().getFullYear() + '-01-01';
    var _personalTotal3 = 0, _sickTotal3 = 0;
    for (var _li3 = 0; _li3 < _allLeaves3.length; _li3++) {
      var _lv3 = _allLeaves3[_li3];
      if (_lv3.start_date < _yearStart3) continue;
      var _h3 = await db.calcPeriodHours(_lv3.start_date, _lv3.end_date);
      if (_lv3.leave_type === 'personal') _personalTotal3 += _h3;
      else if (_lv3.leave_type === 'sick') _sickTotal3 += _h3;
    }
    // 加上手動補登（後台設定）
    _personalTotal3 += parseFloat(emp.personal_ytd_manual || 0);
    _sickTotal3 += parseFloat(emp.sick_ytd_manual || 0);
    var _ytdLines3 = [];
    if (_personalTotal3 > 0) _ytdLines3.push('事假 ' + _personalTotal3 + 'h');
    if (_sickTotal3 > 0) _ytdLines3.push('病假 ' + _sickTotal3 + 'h');
  } catch(_ex4) {}
  // 假別額度餘額顯示
  try {
    var _annBal2 = await db.getAnnualLeaveBalance(emp.id);
    var _marBal2 = await db.getMarriageLeaveBalance(emp.id);
    var _funBal2 = await db.getFuneralLeaveBalance(emp.id);
    var _compBal2 = await db.getCompLeaveBalance(emp.id);
    var _balLines2 = [];
    _balLines2.push('🏖 特休：' + _annBal2.remaining_hours + '/' + _annBal2.entitlement_hours + 'h');
    if (_marBal2.total_hours > 0) _balLines2.push('💍 婚假(陪產假)：' + _marBal2.remaining_hours + '/' + _marBal2.total_hours + 'h');
    if (_funBal2.total_hours > 0) _balLines2.push('💐 喪假：' + _funBal2.remaining_hours + '/' + _funBal2.total_hours + 'h');
    if (_compBal2.total_hours > 0) _balLines2.push('⏰ 補休：' + _compBal2.remaining_hours + '/' + _compBal2.total_hours + 'h');
    lines.push('\n📊 剩餘/累計假期');
    for (var _bi3 = 0; _bi3 < _balLines2.length; _bi3++) {
      lines.push(_balLines2[_bi3]);
    }
  } catch(_ex2) {}
  if (_ytdLines3.length > 0) lines.push('✅ 年度累計：' + _ytdLines3.join(' · '));
  if (emp.role === '經理' && emp.manager_mode === 'test') {
    lines.push('🔬 測試模式（不限制規則）');
  }

  var png = textToImage(lines[0], lines.slice(1).join('\n'));
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
  if (_prefix) messages.unshift({ type: 'text', text: _prefix });
  return client.replyMessage(replyToken, messages);
}

// ===== Leave flow (unchanged) =====
const LEAVE_TYPES = { '特休': 'annual', '事假': 'personal', '病假': 'sick', '公假': 'official', '外出': 'outing', '其他': 'other', '婚假': 'marriage', '婚假(陪產假)': 'marriage', '喪假': 'funeral', '補休': 'comp' };

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
  if (diff <= 0) return 0.5;

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
      // 非首日：不早於上班時間，避免計入非工作時段
      if (current.getTime() !== sDay.getTime()) {
        var _ws = new Date(current); _ws.setHours(8, 0, 0, 0);
        if (dayStart < _ws) dayStart = _ws;
      }
      var dayEnd;
      if (current.getTime() === eDay.getTime()) {
        dayEnd = e;
      } else {
        // 非末日：不晚於下班時間
        dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 17, 0, 0);
      }
      var dayDiff = dayEnd - dayStart;
      if (dayDiff > 0) {
        var dayRaw = Math.round(dayDiff / 1800000) * 0.5;
        // 午休扣除：跨越 12:00-13:00 扣 1 小時
        var _ls3 = new Date(dayStart); _ls3.setHours(12, 0, 0, 0);
			var _le3 = new Date(dayStart); _le3.setHours(13, 0, 0, 0);
			var _os3 = dayStart > _ls3 ? dayStart : _ls3;
			var _oe3 = dayEnd < _le3 ? dayEnd : _le3;
			var lunch = _os3 < _oe3 ? Math.round((_oe3 - _os3) / 1800000) * 0.5 : 0;
        var dayHours = dayRaw - lunch;
        if (dayHours > 8) dayHours = 8;
        if (dayHours > 0) total += dayHours;
      }
    }
    current.setDate(current.getDate() + 1);
  }
  if (total < 0.5) total = 0.5;
  return total;
}

async function startLeaveFlow(uid, client, replyToken, _prefix) {
  states.set(uid, { step: 'type' });
  var _msg = [{
    type: 'text', text: '🏖 請假申請\n\n請選擇假別：',
    quickReply: {
      items: [
        { type: 'action', action: { type: 'message', label: '特休', text: '特休' } },
        { type: 'action', action: { type: 'message', label: '病假', text: '病假' } },
        { type: 'action', action: { type: 'message', label: '事假', text: '事假' } },
        { type: 'action', action: { type: 'message', label: '補休', text: '補休' } },
        { type: 'action', action: { type: 'message', label: '公假', text: '公假' } },
        { type: 'action', action: { type: 'message', label: '婚假(陪產假)', text: '婚假(陪產假)' } },
        { type: 'action', action: { type: 'message', label: '喪假', text: '喪假' } },
        { type: 'action', action: { type: 'message', label: '取消', text: '取消' } },
      ]
    }
  }];
  if (_prefix) _msg.unshift({ type: 'text', text: _prefix });
  return client.replyMessage(replyToken, _msg);
}

function validateOvertimeTime(dt) {
  var d = new Date(dt);
  var h = d.getHours(), m = d.getMinutes();
  var totalMin = h * 60 + m;
  return totalMin >= 1050 && totalMin <= 1380;
}

async function startOvertimeFlow(uid, client, replyToken, _prefix) {
  states.set(uid, { flow: "overtime", step: "start" });
  var _msg = [withDatePicker("🕐 加班申請\n\n請選擇「開始日期時間」", "ot_start")];
if (_prefix) _msg.unshift({ type: "text", text: _prefix });
  return client.replyMessage(replyToken, _msg);
}

async function handleFlow(text, uid, client, replyToken, emp, _prefix) {
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
        return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu("✅ 補打卡申請已送出！\n\n" + (state.punchType === "check_in" ? "🔵補上班" : "🔴補下班") + "\n日期：" + state.punchDate + " " + state.punchTime + "\n⏳ 等待簽核")] : [withMenu("✅ 補打卡申請已送出！\n\n" + (state.punchType === "check_in" ? "🔵補上班" : "🔴補下班") + "\n日期：" + state.punchDate + " " + state.punchTime + "\n⏳ 等待簽核")]);
      } catch(e) { console.error('[mp] error:', e.message || e, e.stack || ''); states.delete(uid); return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu("❌ 申請失敗")] : [withMenu("❌ 申請失敗")]); }
    }
    return;
  }
  if (state.step === 'type') {
    if (text === '取消') { states.delete(uid); return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu('已取消請假。')] : [withMenu('已取消請假。')]); }
    const type = LEAVE_TYPES[text];
    if (!type) return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu('請選擇假別，或點「取消」退出')] : [withMenu('請選擇假別，或點「取消」退出')]);
    state.type = type; state.typeLabel = text; state.step = 'start_date';
    var _balText = '';
    if (type === 'annual') {
      try { var _annBal = await db.getAnnualLeaveBalance(emp.id); if (_annBal.entitlement_hours > 0) _balText = '\n🏖 特休餘額：' + _annBal.remaining_hours + 'h / ' + _annBal.entitlement_hours + 'h，已用' + _annBal.used_hours + 'h'; } catch(_ex) {}
    } else if (type === 'marriage') {
      try { var _marBal = await db.getMarriageLeaveBalance(emp.id); if (_marBal.total_hours > 0) _balText = '\n💒 婚假(陪產假)額度：' + _marBal.remaining_hours + 'h / ' + _marBal.total_hours + 'h'; } catch(_ex) {}
    } else if (type === 'funeral') {
      try { var _funBal = await db.getFuneralLeaveBalance(emp.id); if (_funBal.total_hours > 0) _balText = '\n🕊 喪假額度：' + _funBal.remaining_hours + 'h / ' + _funBal.total_hours + 'h'; } catch(_ex) {}
    } else if (type === 'comp') {
      try { var _compBal = await db.getCompLeaveBalance(emp.id); if (_compBal.total_hours > 0) _balText = '\n⏰ 補休額度：' + _compBal.remaining_hours + 'h / ' + _compBal.total_hours + 'h'; } catch(_ex) {}
    }
    if (emp.manager_mode === 'test') _balText = '\n🔬 測試模式中' + _balText;
    return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withDatePicker('🏖 請假：' + (state.typeLabel || text) + (_balText || '') + '\n\n選擇「開始日期時間」後請點「傳送」', 'leave_start')] : [withDatePicker('🏖 請假：' + (state.typeLabel || text) + (_balText || '') + '\n\n選擇「開始日期時間」後請點「傳送」', 'leave_start')]);
  }
  if (state.flow === "overtime" && state.step === 'reason') {
    state.reason = text;
    try {
      var otId = await db.createOvertimeRequest(emp.id, state.otStart, state.otEnd, state.reason);
      states.delete(uid);
        var _otMsgs = [{ type: "text", text: "✅ 加班申請已送出！\n\n時間：" + fmtDt(state.otStart) + " ~ " + fmtDt(state.otEnd) + "\n原因：" + state.reason + "\n\n⏳ 等待簽核" }]; if (_prefix) _otMsgs.unshift({ type: 'text', text: _prefix }); await client.replyMessage(replyToken, _otMsgs);
    } catch(e) { console.error('[ot] error:', e.message || e, e.stack || ''); states.delete(uid); return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu("❌ 申請失敗")] : [withMenu("❌ 申請失敗")]); }
  }
  if (!state.flow && state.step === 'reason') {
    state.reason = text;
    try {
      // 特休/婚假/喪假 額度檢查（測試模式跳過）
      if (state.type === 'annual' || state.type === 'marriage' || state.type === 'funeral' || state.type === 'comp') {
        if (emp.manager_mode !== 'test') {
          var _balCheck = null;
          if (state.type === 'annual') _balCheck = await db.getAnnualLeaveBalance(emp.id);
          else if (state.type === 'marriage') _balCheck = await db.getMarriageLeaveBalance(emp.id);
          else if (state.type === 'funeral') _balCheck = await db.getFuneralLeaveBalance(emp.id);
          else if (state.type === 'comp') _balCheck = await db.getCompLeaveBalance(emp.id);
          var reqHours = await db.calcPeriodHours(state.startDateTime, state.endDateTime);
          // 婚假/喪假最低 8 小時
          if ((state.type === "marriage" || state.type === "funeral") && reqHours < 8) {
            states.delete(uid);
            var _minLabel = state.type === "marriage" ? "婚假(陪產假)" : "喪假";
            return client.replyMessage(replyToken, _prefix ? [{ type: "text", text: _prefix }, withMenu("❌ " + _minLabel + "最少需申請 8 小時（1 天）\n請將時間調整為至少 8 小時。")] : [withMenu("❌ " + _minLabel + "最少需申請 8 小時（1 天）\n請將時間調整為至少 8 小時。")]);
          }
          if (_balCheck && reqHours > _balCheck.remaining_hours) {
            states.delete(uid);
            var _typeLabel2 = state.type === 'annual' ? '特休' : state.type === 'marriage' ? '婚假(陪產假)' : state.type === 'funeral' ? '喪假' : '補休';
            return client.replyMessage(replyToken, _prefix ? [{ type: 'text', text: _prefix }, withMenu('❌ ' + _typeLabel2 + '餘額不足\n\n額度：' + (_balCheck.entitlement_hours || _balCheck.total_hours || 0) + 'h\n已用：' + _balCheck.used_hours + 'h\n剩餘：' + _balCheck.remaining_hours + 'h\n本次需：' + reqHours + 'h\n\n請選擇其他假別或縮短時間。')] : [withMenu('❌ ' + _typeLabel2 + '餘額不足\n\n額度：' + (_balCheck.entitlement_hours || _balCheck.total_hours || 0) + 'h\n已用：' + _balCheck.used_hours + 'h\n剩餘：' + _balCheck.remaining_hours + 'h\n本次需：' + reqHours + 'h\n\n請選擇其他假別或縮短時間。')]);
          }
        }
      }
      const leaveId = await db.createLeaveRequest(emp.id, state.type, state.startDateTime, state.endDateTime, state.reason);
      states.delete(uid);
      var _respMsgs = [
        { type: 'flex', altText: '✅ 請假已送出',
          contents: { type: 'bubble',
            body: { type: 'box', layout: 'vertical', contents: [
              { type: 'text', text: '✅ 請假申請已送出', weight: 'bold', size: 'lg', color: '#06c755' },
              { type: 'text', text: '假別：' + state.typeLabel, margin: 'md', size: 'sm' },
              { type: 'text', text: '時間：' + fmtDt(state.startDateTime) + ' ~ ' + fmtDt(state.endDateTime), margin: 'sm', size: 'sm', wrap: true },
              { type: 'text', text: '原因：' + state.reason, margin: 'sm', size: 'sm', color: '#666666', wrap: true },
              { type: 'text', text: '⏳ 等待簽核', margin: 'md', size: 'sm', color: '#f39c12' }
            ]}
          }
        }
      ];
      if (_prefix) _respMsgs.unshift({ type: 'text', text: _prefix });
      await client.replyMessage(replyToken, _respMsgs);
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
		// 請假開始日不可早於入職日
		var _emp = await db.getEmployeeByLineId(uid);
		if (_emp && _emp.hire_date) {
			var _hd = new Date(_emp.hire_date.replace(/\//g, '-'));
			if (new Date(dt) < _hd) {
				states.delete(uid);
				return client.replyMessage(replyToken, [withMenu('❌ 請假日期不可早於入職日（' + _emp.hire_date + '）')]);
			}
		}
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
    if (punchDt < threeDaysAgo) {
      if (emp && emp.manager_mode === 'test') {
        console.log('[MP] ' + emp.name + ' 測試模式，跳過補打卡時間限制');
      } else {
        states.delete(uid);
        return client.replyMessage(replyToken, [withMenu('❌ 只能補打 3 天內的卡')]);
      }
    }
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
      if (mpEmp && mpEmp.line_user_id) await db.addPendingNotification(mpEmp.id, "🎉 補打卡已核准！\n" + fmtDt(mp.punch_date) + " " + mp.punch_time);
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
        if (leaveEmp && leaveEmp.line_user_id) await db.addPendingNotification(leaveEmp.id, "📋 請假進度\n\n已通過第"+(result.level-1)+"階，等待第"+result.level+"階：" + result.approvers[0].name + "\n時間：" + fmtDt(leave.start_date) + " ~ " + fmtDt(leave.end_date));
        return client.replyMessage(replyToken, [withMenu('✅ 已核准，已送第'+result.level+'階簽核')]);
      }
      if (leaveEmp && leaveEmp.line_user_id) {
        await db.addPendingNotification(leaveEmp.id, '🎉 請假已核准！\n' + fmtDt(leave.start_date) + ' ~ ' + fmtDt(leave.end_date));
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
        if (otEmp && otEmp.line_user_id) await db.addPendingNotification(otEmp.id, "🕐 加班進度\n\n已通過第"+(otResult.level-1)+"階，等待第"+otResult.level+"階：" + otResult.approvers[0].name + "\n時間：" + fmtDt(ot.start_time) + " ~ " + fmtDt(ot.end_time));
        return client.replyMessage(replyToken, [withMenu('✅ 已核准，已送第'+otResult.level+'階簽核')]);
      }
      if (otEmp && otEmp.line_user_id) {
        await db.addPendingNotification(otEmp.id, '🎉 加班已核准！\n' + fmtDt(ot.start_time) + ' ~ ' + fmtDt(ot.end_time));
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
        await db.addPendingNotification(leaveEmp.id, '❌ 請假被駁回\n時間：' + fmtDt(leave.start_date) + ' ~ ' + fmtDt(leave.end_date) + '\n駁回原因：' + reason);
      }
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('已駁回請假申請（原因：' + reason + '）')]);
    }

    if (state.flow === 'reject_ot') {
      var ot = await db.getOvertimeById(state.id);
      var otEmp = ot ? await db.getEmployeeById(ot.employee_id) : null;
      await db.updateOvertimeStatus(state.id, 'rejected', approver.id, reason);
      if (otEmp && otEmp.line_user_id && ot) {
        await db.addPendingNotification(otEmp.id, '❌ 加班被駁回\n時間：' + fmtDt(ot.start_time) + ' ~ ' + fmtDt(ot.end_time) + '\n駁回原因：' + reason);
      }
      states.delete(uid);
      return client.replyMessage(replyToken, [withMenu('已駁回加班申請（原因：' + reason + '）')]);
    }

    if (state.flow === 'reject_missed') {
      var mp = await db.getMissedPunchById(state.id);
      var mpEmp = mp ? await db.getEmployeeById(mp.employee_id) : null;
      await db.updateMissedPunchStatus(state.id, 'rejected', approver.id, reason);
      if (mpEmp && mpEmp.line_user_id && mp) {
        await db.addPendingNotification(mpEmp.id, '❌ 補打卡被駁回\n' + fmtDt(mp.punch_date) + ' ' + mp.punch_time + '\n駁回原因：' + reason);
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
			size: { width: 2500, height: 843 }, selected: true, name: '一般員工選單', chatBarText: '📋 玉群考勤系統功能選單',
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
			size: { width: 2500, height: 843 }, selected: false, name: '主管選單', chatBarText: '📋 玉群考勤系統功能選單',
			areas: [
				{ bounds: { x: 0, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '上班' } },
				{ bounds: { x: 625, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '請假' } },
				{ bounds: { x: 1250, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '補打卡' } },
				{ bounds: { x: 1875, y: 0, width: 625, height: 421 }, action: { type: 'message', text: '下班' } },
				{ bounds: { x: 0, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '加班' } },
				{ bounds: { x: 625, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '查詢' } },
				{ bounds: { x: 1250, y: 421, width: 625, height: 422 }, action: { type: 'message', text: '待簽核' } },
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
			size: { width: 2500, height: 843 }, selected: false, name: '老闆選單', chatBarText: '📋 玉群考勤系統功能選單',
			areas: [
				{ bounds: { x: 0, y: 0, width: 1250, height: 421 }, action: { type: 'message', text: '公司今日考勤' } },
				{ bounds: { x: 1250, y: 0, width: 1250, height: 421 }, action: { type: 'message', text: '本月請假累計' } },
				{ bounds: { x: 0, y: 421, width: 1250, height: 422 }, action: { type: 'message', text: '本月考勤異常累計' } },
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

		// 重新分配所有已綁定員工的 Rich Menu
		try {
			var _allEmps = await db.listActiveEmployees();
			var _assignCount = 0;
			for (var _ei = 0; _ei < _allEmps.length; _ei++) {
				var _ae = _allEmps[_ei];
				if (_ae.line_user_id && _ae.role) {
					await assignRichMenu(_ae.line_user_id, _ae.role);
					_assignCount++;
				}
			}
			console.log('[RichMenu] 已重新分配 ' + _assignCount + ' 位員工的選單');
		} catch (e2) {
			console.error('[RichMenu] 分配員工選單失敗:', e2.message);
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

	// 純白背景
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, w, h);

	var marginX = 22, marginY = 18, gap = 16;
	var colW = Math.floor((w - marginX * 2 - gap * 2) / 3);
	var rowH = Math.floor((h - marginY * 2 - gap) / 2);

	var accent = [
		'#ff8a69', '#5596e6', '#966fd0',
		'#f2a54b', '#5fbe91', '#e66e7d'
	];
	var topColors = [
		'#ffe8e1', '#e4eefc', '#f0e8f8',
		'#fcf0e4', '#e4f5eb', '#fce6e8'
	];
	var botColors = [
		'#ffc0b0', '#b0d0f5', '#c8b0e8',
		'#fad0a0', '#a0e0c0', '#f5b0b8'
	];
	var icons = ['arrow-up', 'umbrella', 'arrow-down', 'clock', 'check', 'search'];
	var labels = ['上班', '請假', '下班', '加班', '補打卡', '查詢'];

	var fontFamily = _cnFontFamily || '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "STHeiti", "Microsoft JhengHei", sans-serif';

	function drawRoundRect(x, y, w2, h2, r) {
		ctx.beginPath();
		ctx.roundRect(x, y, w2, h2, r);
		ctx.fill();
	}

	function drawCard(cx2, cy2, cw, ch, radius, topColor, botColor) {
		// Shadow
		ctx.fillStyle = 'rgba(0,0,0,0.06)';
		drawRoundRect(cx2 + 2, cy2 + 3, cw, ch, radius);
		// Gradient
		var grad = ctx.createLinearGradient(cx2, cy2, cx2, cy2 + ch);
		grad.addColorStop(0, topColor);
		grad.addColorStop(1, botColor);
		ctx.fillStyle = grad;
		drawRoundRect(cx2, cy2, cw, ch, radius);
	}

	function drawIcon(cx, cy, r, color, type) {
		// White circle shadow
		ctx.fillStyle = 'rgba(0,0,0,0.06)';
		ctx.beginPath();
		ctx.arc(cx + 2, cy + 2, r, 0, Math.PI * 2);
		ctx.fill();
		// White circle
		ctx.fillStyle = 'rgba(255,255,255,0.95)';
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();

		ctx.strokeStyle = color;
		ctx.lineWidth = 5;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.fillStyle = color;
		ctx.beginPath();

		var s;
		if (type === 'arrow-up') {
			s = Math.round(r * 0.62);
			ctx.moveTo(cx, cy - s);
			ctx.lineTo(cx - Math.round(s * 0.7), cy + Math.round(s * 0.55));
			ctx.lineTo(cx + Math.round(s * 0.7), cy + Math.round(s * 0.55));
			ctx.closePath();
			ctx.fill();
		} else if (type === 'umbrella') {
			s = Math.round(r * 0.58);
			// Canopy arc
			ctx.beginPath();
			ctx.arc(cx, cy - Math.round(s * 0.05), Math.round(s * 0.85), Math.PI, 0);
			ctx.stroke();
			// Ribs
			ctx.lineWidth = 3;
			for (var ang = -40; ang <= 40; ang += 20) {
				var rad = (ang + 90) * Math.PI / 180;
				ctx.beginPath();
				ctx.moveTo(cx, cy - Math.round(s * 0.05));
				ctx.lineTo(cx + Math.round(Math.cos(rad) * s * 0.75), cy - Math.round(s * 0.05) + Math.round(Math.sin(rad) * s * 0.4));
				ctx.stroke();
			}
			// Pole
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(cx, cy - Math.round(s * 0.05));
			ctx.lineTo(cx, cy + Math.round(s * 0.7));
			ctx.stroke();
			// Wave
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(cx, cy + Math.round(s * 0.4), Math.round(s * 0.55), 0.26, 2.88);
			ctx.stroke();
		} else if (type === 'arrow-down') {
			s = Math.round(r * 0.62);
			ctx.moveTo(cx, cy + s);
			ctx.lineTo(cx - Math.round(s * 0.7), cy - Math.round(s * 0.55));
			ctx.lineTo(cx + Math.round(s * 0.7), cy - Math.round(s * 0.55));
			ctx.closePath();
			ctx.fill();
		} else if (type === 'clock') {
			s = Math.round(r * 0.58);
			ctx.beginPath();
			ctx.arc(cx, cy, s, 0, Math.PI * 2);
			ctx.stroke();
			ctx.lineWidth = 5;
			ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - Math.round(s * 0.65)); ctx.stroke();
			ctx.lineWidth = 4;
			ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.round(s * 0.55), cy); ctx.stroke();
			ctx.fillStyle = color;
			ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
		} else if (type === 'check') {
			s = Math.round(r * 0.55);
			ctx.beginPath();
			ctx.arc(cx, cy, s, 0, Math.PI * 2);
			ctx.stroke();
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(cx - Math.round(s * 0.55), cy + 3);
			ctx.lineTo(cx - 3, cy + Math.round(s * 0.55));
			ctx.lineTo(cx + Math.round(s * 0.6), cy - Math.round(s * 0.6));
			ctx.stroke();
		} else if (type === 'search') {
			s = Math.round(r * 0.52);
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.arc(cx + 3, cy + 2, s, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(cx + s - 2, cy + s - 2);
			ctx.lineTo(cx + Math.round(s * 1.5), cy + Math.round(s * 1.5));
			ctx.stroke();
		}
	}

	for (var i = 0; i < 6; i++) {
		var col = i % 3;
		var row = Math.floor(i / 3);
		var bx = marginX + col * (colW + gap);
		var by = marginY + row * (rowH + gap);
		var cx = bx + Math.floor(colW / 2);
		var cardW = colW - 8;
		var cardH = rowH - 8;
		var cardX = bx + 4;
		var cardY = by + 4;

		drawCard(cardX, cardY, cardW, cardH, 42, topColors[i], botColors[i]);

		var iconR = Math.round(colW * 0.15);
		var iconY = cardY + Math.round(cardH * 0.37);
		drawIcon(cx, iconY, iconR, accent[i], icons[i]);

		// Text
		ctx.fillStyle = '#32323c';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = 'bold 78px ' + fontFamily;
		ctx.fillText(labels[i], cx, cardY + Math.round(cardH * 0.84));
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

// 檢查打卡時間是否被已核准請假覆蓋（含午休延伸：請假到12:00，午休12-13點打卡也算已請假）
function isCoveredByLeave(checkInMs, leaveStartStr, leaveEndStr) {
  var lsMs = new Date(leaveStartStr).getTime();
  if (isNaN(lsMs)) return false;
  var leDate = new Date(leaveEndStr);
  if (isNaN(leDate.getTime())) return false;
  var leMs = leDate.getTime();
  // 午休延伸：若請假結束於 12:00，將覆蓋範圍延伸到 13:00（午休）
  if (leDate.getHours() === 12 && leDate.getMinutes() === 0) {
    leMs += 60 * 60 * 1000;
  }
  return checkInMs >= lsMs && checkInMs <= leMs;
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

// 角色是否為主任（可查詢採樣+分析部門）
function isDirector(emp) {
  var role = emp.role || '';
  return role === '主任';
}

// 取得主任可查詢的部門員工 ID
async function getDirectorDepartmentEmployeeIds() {
  var allEmps = await db.listAttendanceEmployees();
  var ids = {};
  for (var i = 0; i < allEmps.length; i++) {
    var e = allEmps[i];
    if (e.department === '採樣' || e.department === '分析') {
      ids[e.id] = true;
    }
  }
  return ids;
}

// 查詢被簽核人員當天考勤（考勤異常/曠職/請假/GPS超出範圍）
async function queryTodayAttendance(emp, client, replyToken) {
  var role = emp.role || '';
  if (role !== '經理' && role !== '老闆' && role !== 'boss' && role !== '簽核人員' && role !== '主任' && !emp.can_approve) {
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
  // 主任：僅限查詢採樣+分析部門
  if (isDirector(emp)) {
    designatedIds = await getDirectorDepartmentEmployeeIds();
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
            if (isCoveredByLeave(ctMs, clv.start_date, clv.end_date)) {
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
      var leaveLabel = leaveTypeLabel(al.leave_type);
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
    lines.push('\n⚠️ 考勤異常（' + lateList.length + ' 人）：');
    for (var k = 0; k < lateList.length; k++) {
      var le = lateList[k];
      var e3 = await db.getEmployeeById(le.employee_id);
      var t = le.check_time;
      var timeStr = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
      lines.push('  ' + (e3 ? e3.name + '（' + e3.employee_no + '）' : '員工#' + le.employee_id) + ' ' + timeStr + ' 考勤異常 ' + le.late_min + ' 分' + (le.covered ? '' : ' （尚未請假）'));
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

// 查詢被簽核人員當月考勤（考勤異常+請假備註/請假/加班細項與累加，1號～當天）
async function queryMonthAttendance(emp, client, replyToken) {
  var role = emp.role || '';
  if (role !== '經理' && role !== '老闆' && role !== 'boss' && role !== '簽核人員' && role !== '主任' && !emp.can_approve) {
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
	  // 主任：僅限查詢採樣+分析部門
	  if (isDirector(emp)) {
	    designatedIds = await getDirectorDepartmentEmployeeIds();
	  }

  var allCheckins = await db.queryCheckins(null, monthStart, today, 5000, 0);
  var allLeaves = await db.getLeaveRequests('approved', 2000);

  // 過濾指定員工
  if (Object.keys(designatedIds).length > 0) {
    allCheckins = allCheckins.filter(function(c) { return designatedIds[c.employee_id]; });
  }

  // 考勤異常彙整（1號～當天）
  // 先找出每位員工每天最早的非遲到打卡（含補打卡），該日不重複計入考勤異常
  var empDateCovered2 = {};
  for (var pi2 = 0; pi2 < allCheckins.length; pi2++) {
    var pc2 = allCheckins[pi2];
    if (pc2.type !== "check_in") continue;
    var pct2 = new Date(pc2.check_time);
    var pTotalMin2 = pct2.getHours() * 60 + pct2.getMinutes();
    if (pTotalMin2 <= lateThreshold) {
      var pDateStr2 = pct2.getFullYear() + "-" + String(pct2.getMonth()+1).padStart(2,"0") + "-" + String(pct2.getDate()).padStart(2,"0");
      empDateCovered2[pc2.employee_id + "|" + pDateStr2] = true;
    }
  }
  var empLateMap = {};
  for (var i = 0; i < allCheckins.length; i++) {
    var c = allCheckins[i];
    if (c.type !== "check_in") continue;
    var ct = new Date(c.check_time);
    var totalMin = ct.getHours() * 60 + ct.getMinutes();
    if (totalMin <= lateThreshold) continue;
    var fullDateStr2 = ct.getFullYear() + "-" + String(ct.getMonth()+1).padStart(2,"0") + "-" + String(ct.getDate()).padStart(2,"0");
    // 當天已有非遲到打卡（含補打卡），跳過不計考勤異常
    if (empDateCovered2[c.employee_id + "|" + fullDateStr2]) continue;
    if (await isHoliday(fullDateStr2)) continue;

    var lateMins = totalMin - lateThreshold;
    var dateStr = String(ct.getMonth()+1).padStart(2,"0") + "-" + String(ct.getDate()).padStart(2,"0");
    if (!empLateMap[c.employee_id]) {
      empLateMap[c.employee_id] = { name: c.name, no: c.employee_no, records: [], count: 0 };
    }
    var timeStr = String(ct.getHours()).padStart(2,"0") + ":" + String(ct.getMinutes()).padStart(2,"0");
    var covered3 = false;
    var ctMs3 = ct.getTime();
    for (var cl3 = 0; cl3 < allLeaves.length; cl3++) {
      var clv3 = allLeaves[cl3];
      if (clv3.employee_id !== c.employee_id || clv3.status !== "approved") continue;
      if (isCoveredByLeave(ctMs3, clv3.start_date, clv3.end_date)) { covered3 = true; break; }
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

    var leaveLabel = leaveTypeLabel(l.leave_type);
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
  var allActive = await db.listAttendanceEmployees();

  // 今日出勤概況（合併查詢當天考勤）
  var todayCheckins = allCheckins.filter(function(c) {
    var cd = new Date(c.check_time);
    var ds = cd.getFullYear() + '-' + String(cd.getMonth()+1).padStart(2,'0') + '-' + String(cd.getDate()).padStart(2,'0');
    return ds === today;
  });
  var todayEmpMap = {};
  for (var ti = 0; ti < todayCheckins.length; ti++) {
    var tc = todayCheckins[ti];
    if (!todayEmpMap[tc.employee_id]) {
      todayEmpMap[tc.employee_id] = { checkIn: null, checkOut: null, name: tc.name, no: tc.employee_no };
    }
    if (tc.type === 'check_in') todayEmpMap[tc.employee_id].checkIn = tc;
    else todayEmpMap[tc.employee_id].checkOut = tc;
  }

  var checkedInCount = 0, lateTodayCount = 0, absentCount = 0;
  var lateTodayNames = [], checkedInNames = [], absentNames = [], leaveTodayNames = [];

  var leaveTodayMap = {};
  for (var lti = 0; lti < allLeaves.length; lti++) {
    var lv = allLeaves[lti];
    var lvs = typeof lv.start_date === 'string' ? lv.start_date.substring(0, 10) : '';
    var lve = typeof lv.end_date === 'string' ? lv.end_date.substring(0, 10) : lvs;
    if (lvs <= today && lve >= today) {
      leaveTodayMap[lv.employee_id] = lv;
    }
  }

  for (var ai = 0; ai < allActive.length; ai++) {
    var ae = allActive[ai];
    if (Object.keys(designatedIds).length > 0 && !designatedIds[ae.id]) continue;
    var tm = todayEmpMap[ae.id];
    var onLeaveToday = leaveTodayMap[ae.id];
    if (onLeaveToday) {
      var _ls = typeof onLeaveToday.start_date === 'string' ? onLeaveToday.start_date : String(onLeaveToday.start_date);
      var _le = typeof onLeaveToday.end_date === 'string' ? onLeaveToday.end_date : String(onLeaveToday.end_date);
      var _tIdx1 = _ls.indexOf(' '); if (_tIdx1 === -1) _tIdx1 = _ls.indexOf('T');
      var _tIdx2 = _le.indexOf(' '); if (_tIdx2 === -1) _tIdx2 = _le.indexOf('T');
      var _st = _tIdx1 > 0 ? _ls.substring(_tIdx1 + 1, _tIdx1 + 6) : '';
      var _et = _tIdx2 > 0 ? _le.substring(_tIdx2 + 1, _tIdx2 + 6) : '';
      leaveTodayNames.push(ae.employee_no + ' ' + ae.name + '（' + leaveTypeLabel(onLeaveToday.leave_type) + ' ' + _st + '~' + _et + '）');
    }
    if (tm && tm.checkIn) {
      checkedInCount++;
      checkedInNames.push(ae.employee_no + ' ' + ae.name);
      var ciTime = new Date(tm.checkIn.check_time);
      var ciTotalMin = ciTime.getHours() * 60 + ciTime.getMinutes();
      if (ciTotalMin > lateThreshold) {
        var ciDateStr = ciTime.getFullYear() + '-' + String(ciTime.getMonth()+1).padStart(2,'0') + '-' + String(ciTime.getDate()).padStart(2,'0');
        if (!(await isHoliday(ciDateStr)) && !onLeaveToday) {
          lateTodayCount++;
          lateTodayNames.push(ae.employee_no + ' ' + ae.name + '（' + String(ciTime.getHours()).padStart(2,'0') + ':' + String(ciTime.getMinutes()).padStart(2,'0') + '）');
        }
      }
    } else if (!onLeaveToday) {
      absentCount++;
      absentNames.push(ae.employee_no + ' ' + ae.name);
    }
  }

  var lines = ['📋 當月考勤（' + monthStart.substring(5) + ' ~ ' + today.substring(5) + '）'];
  lines.push('');
  lines.push('📅 今日出勤概況：');
  lines.push('  👥 在職：' + allActive.length + ' 人');
  lines.push('  ✅ 已上班：' + checkedInCount + ' 人');
  if (leaveTodayNames.length > 0) {
    lines.push('  🏖 請假 ' + leaveTodayNames.length + ' 人：' + leaveTodayNames.join('、'));
  } else {
    lines.push('  🏖 請假：0 人');
  }
  if (absentCount > 0) {
    lines.push('  ❌ 未打卡 ' + absentCount + ' 人：' + absentNames.join('、'));
  } else {
    lines.push('  ❌ 未打卡：0 人');
  }
  if (lateTodayCount > 0) {
    lines.push('  ⚠️ 考勤異常 ' + lateTodayCount + ' 人：' + lateTodayNames.join('、'));
  }
  lines.push('');

  if (lateKeys.length > 0) {
    lateKeys.sort(function(a, b) { return (empLateMap[a].no || '').localeCompare(empLateMap[b].no || ''); });
    lines.push('\n⚠️ 考勤異常累計：');
    var totalLate = 0;
    for (var k = 0; k < lateKeys.length; k++) {
      var info = empLateMap[lateKeys[k]];
      totalLate += info.records.length;
      lines.push('  ' + info.name + '（' + info.no + '） 考勤異常 ' + info.records.length + ' 次');
      for (var r = 0; r < info.records.length; r++) {
        var rec = info.records[r];
        lines.push('      ' + rec.date + ' ' + rec.time + '（晚 ' + rec.lateMin + ' 分）' + (rec.covered ? '' : ' （尚未請假）'));
      }
    }
    if (totalLate > 0) lines.push('  📊 考勤異常合計：' + totalLate + ' 次');
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

	  // 特休使用狀況
	  var alEmpList = [];
	  for (var ai2 = 0; ai2 < allActive.length; ai2++) {
	    var ae2 = allActive[ai2];
	    if (Object.keys(designatedIds).length > 0 && !designatedIds[ae2.id]) continue;
	    if (!ae2.hire_date || ae2.hire_date === '') continue;
	    alEmpList.push(ae2);
	  }
	  var alLines = [];
	  for (var ali = 0; ali < alEmpList.length; ali++) {
	    var ale = alEmpList[ali];
	    try {
	      var alBal = await db.getAnnualLeaveBalance(ale.id);
	      alLines.push('  ' + ale.name + '（' + ale.employee_no + '） 額度' + alBal.entitlement_hours + 'h / 已用' + alBal.used_hours + 'h / 剩餘' + alBal.remaining_hours + 'h');
	    } catch(ex) {}
	  }
	  if (alLines.length > 0) {
	    lines.push('\n📊 特休使用狀況（本週期）：');
	    lines = lines.concat(alLines);

	  // 年度事假/病假累計（1/1～今天）
	  var yearStart = now.getFullYear() + '-01-01';
	  var ytdPersonalMap = {};
	  var ytdSickMap = {};
	  var ytdEmpMap = {}; // employee_id -> {name, no}
	  for (var yti = 0; yti < allLeaves.length; yti++) {
	    var ytlv = allLeaves[yti];
	    if (ytlv.start_date < yearStart) continue;
	    if (Object.keys(designatedIds).length > 0 && !designatedIds[ytlv.employee_id]) continue;
	    var yth = leaveHours(ytlv.start_date, ytlv.end_date);
	    ytdEmpMap[ytlv.employee_id] = { name: ytlv.name, no: ytlv.employee_no };
	    if (ytlv.leave_type === 'personal') {
	      ytdPersonalMap[ytlv.employee_id] = (ytdPersonalMap[ytlv.employee_id] || 0) + yth;
	    } else if (ytlv.leave_type === 'sick') {
	      ytdSickMap[ytlv.employee_id] = (ytdSickMap[ytlv.employee_id] || 0) + yth;
	    }
	  }
	  // 補上無請假記錄但被指定的員工（從 allActive 取）
	  for (var yti2 = 0; yti2 < allActive.length; yti2++) {
	    var ytae = allActive[yti2];
	    if (Object.keys(designatedIds).length > 0 && !designatedIds[ytae.id]) continue;
	    if (!ytdEmpMap[ytae.id]) ytdEmpMap[ytae.id] = { name: ytae.name, no: ytae.employee_no };
	    // 加上手動補登
	    var _pm = parseFloat(ytae.personal_ytd_manual || 0);
	    var _sm = parseFloat(ytae.sick_ytd_manual || 0);
	    if (_pm > 0) ytdPersonalMap[ytae.id] = (ytdPersonalMap[ytae.id] || 0) + _pm;
	    if (_sm > 0) ytdSickMap[ytae.id] = (ytdSickMap[ytae.id] || 0) + _sm;
	  }
	  var ytdKeys = Object.keys(ytdEmpMap).sort(function(a,b) { return (ytdEmpMap[a].no||'').localeCompare(ytdEmpMap[b].no||''); });
	  var ytdLines = [];
	  for (var ytk = 0; ytk < ytdKeys.length; ytk++) {
	    var yteid = ytdKeys[ytk];
	    var yte = ytdEmpMap[yteid];
	    var ytp = ytdPersonalMap[yteid] || 0;
	    var yts = ytdSickMap[yteid] || 0;
	    if (ytp > 0 || yts > 0) {
	      ytdLines.push('  ' + yte.name + '（' + yte.no + '） 事假' + ytp.toFixed(1) + 'h / 病假' + yts.toFixed(1) + 'h');
	    }
	  }
	  if (ytdLines.length > 0) {
	    lines.push('\n📋 年度事假/病假累計（1/1～今天）：');
	    lines = lines.concat(ytdLines);
	  }
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
    if (role === '經理' || role === '簽核人員' || role === '主任') {
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

	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, w, h);

	var marginX = 22, marginY = 18, gap = 16;
	var colW = Math.floor((w - marginX * 2 - gap * 3) / 4);
	var rowH = Math.floor((h - marginY * 2 - gap) / 2);

	var accent = [
		'#ff8a69', '#5596e6', '#5fbe91', '#966fd0',
		'#f2a54b', '#e66e7d', '#b487c0', '#649bd0'
	];
	var topColors = [
		'#ffe8e1', '#e4eefc', '#e4f5eb', '#f0e8f8',
		'#fcf0e4', '#fce6e8', '#f5ebf2', '#e8f0f8'
	];
	var botColors = [
		'#ffc0b0', '#b0d0f5', '#a0e0c0', '#c8b0e8',
		'#fad0a0', '#f5b0b8', '#d8b8e0', '#a8c8e8'
	];
	var icons = ['arrow-up', 'umbrella', 'check', 'arrow-down', 'clock', 'search', 'approve', 'calendar'];
	var labels = ['上班', '請假', '補打卡', '下班', '加班', '查詢', '簽核查詢', '當月考勤'];

	var fontFamily = _cnFontFamily || '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "STHeiti", "Microsoft JhengHei", sans-serif';

	function drawRoundRect(x, y, w2, h2, r) {
		ctx.beginPath();
		ctx.roundRect(x, y, w2, h2, r);
		ctx.fill();
	}

	function drawCard(cx2, cy2, cw, ch, radius, topColor, botColor) {
		ctx.fillStyle = 'rgba(0,0,0,0.06)';
		drawRoundRect(cx2 + 2, cy2 + 3, cw, ch, radius);
		var grad = ctx.createLinearGradient(cx2, cy2, cx2, cy2 + ch);
		grad.addColorStop(0, topColor);
		grad.addColorStop(1, botColor);
		ctx.fillStyle = grad;
		drawRoundRect(cx2, cy2, cw, ch, radius);
	}

	function drawIcon(cx, cy, r, color, type) {
		ctx.fillStyle = 'rgba(0,0,0,0.06)';
		ctx.beginPath();
		ctx.arc(cx + 2, cy + 2, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.95)';
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();

		ctx.strokeStyle = color;
		ctx.lineWidth = 5;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.fillStyle = color;
		ctx.beginPath();

		var s;
		if (type === 'arrow-up') {
			s = Math.round(r * 0.62);
			ctx.moveTo(cx, cy - s);
			ctx.lineTo(cx - Math.round(s * 0.7), cy + Math.round(s * 0.55));
			ctx.lineTo(cx + Math.round(s * 0.7), cy + Math.round(s * 0.55));
			ctx.closePath();
			ctx.fill();
		} else if (type === 'umbrella') {
			s = Math.round(r * 0.58);
			ctx.beginPath();
			ctx.arc(cx, cy - Math.round(s * 0.05), Math.round(s * 0.85), Math.PI, 0);
			ctx.stroke();
			ctx.lineWidth = 3;
			for (var ang = -40; ang <= 40; ang += 20) {
				var rad = (ang + 90) * Math.PI / 180;
				ctx.beginPath();
				ctx.moveTo(cx, cy - Math.round(s * 0.05));
				ctx.lineTo(cx + Math.round(Math.cos(rad) * s * 0.75), cy - Math.round(s * 0.05) + Math.round(Math.sin(rad) * s * 0.4));
				ctx.stroke();
			}
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(cx, cy - Math.round(s * 0.05));
			ctx.lineTo(cx, cy + Math.round(s * 0.7));
			ctx.stroke();
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.arc(cx, cy + Math.round(s * 0.4), Math.round(s * 0.55), 0.26, 2.88);
			ctx.stroke();
		} else if (type === 'arrow-down') {
			s = Math.round(r * 0.62);
			ctx.moveTo(cx, cy + s);
			ctx.lineTo(cx - Math.round(s * 0.7), cy - Math.round(s * 0.55));
			ctx.lineTo(cx + Math.round(s * 0.7), cy - Math.round(s * 0.55));
			ctx.closePath();
			ctx.fill();
		} else if (type === 'clock') {
			s = Math.round(r * 0.58);
			ctx.beginPath();
			ctx.arc(cx, cy, s, 0, Math.PI * 2);
			ctx.stroke();
			ctx.lineWidth = 5;
			ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - Math.round(s * 0.65)); ctx.stroke();
			ctx.lineWidth = 4;
			ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.round(s * 0.55), cy); ctx.stroke();
			ctx.fillStyle = color;
			ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
		} else if (type === 'check') {
			s = Math.round(r * 0.55);
			ctx.beginPath(); ctx.arc(cx, cy, s, 0, Math.PI * 2); ctx.stroke();
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(cx - Math.round(s * 0.55), cy + 3);
			ctx.lineTo(cx - 3, cy + Math.round(s * 0.55));
			ctx.lineTo(cx + Math.round(s * 0.6), cy - Math.round(s * 0.6));
			ctx.stroke();
		} else if (type === 'search') {
			s = Math.round(r * 0.52);
			ctx.lineWidth = 5;
			ctx.beginPath(); ctx.arc(cx + 3, cy + 2, s, 0, Math.PI * 2); ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(cx + s - 2, cy + s - 2);
			ctx.lineTo(cx + Math.round(s * 1.5), cy + Math.round(s * 1.5));
			ctx.stroke();
		} else if (type === 'approve') {
			s = Math.round(r * 0.52);
			ctx.lineWidth = 4;
			ctx.beginPath(); ctx.roundRect(cx - s, cy - s - 2, s * 2, s * 2, 8); ctx.stroke();
			ctx.lineWidth = 4;
			ctx.beginPath();
			ctx.moveTo(cx - Math.round(s * 0.5), cy + 2);
			ctx.lineTo(cx - 2, cy + Math.round(s * 0.5));
			ctx.lineTo(cx + Math.round(s * 0.55), cy - Math.round(s * 0.55));
			ctx.stroke();
		} else if (type === 'calendar') {
			s = Math.round(r * 0.52);
			ctx.lineWidth = 4;
			ctx.beginPath(); ctx.roundRect(cx - s, cy - s, s * 2, s * 2, 8); ctx.stroke();
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.fillRect(cx - s, cy - s, s * 2, Math.round(s * 0.45));
		}
	}

	for (var i = 0; i < 8; i++) {
		var col = i % 4;
		var row = Math.floor(i / 4);
		var bx = marginX + col * (colW + gap);
		var by = marginY + row * (rowH + gap);
		var cx = bx + Math.floor(colW / 2);
		var cardW = colW - 8;
		var cardH = rowH - 8;
		var cardX = bx + 4;
		var cardY = by + 4;

		drawCard(cardX, cardY, cardW, cardH, 42, topColors[i], botColors[i]);

		var iconR = Math.round(colW * 0.17);
		var iconY = cardY + Math.round(cardH * 0.37);
		drawIcon(cx, iconY, iconR, accent[i], icons[i]);

		ctx.fillStyle = '#32323c';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		var label = labels[i];
		ctx.font = 'bold 60px ' + fontFamily;
		ctx.fillText(label, cx, cardY + Math.round(cardH * 0.84));
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

	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, w, h);

	var marginX = 22, marginY = 18, gap = 16;
	var colW = Math.floor((w - marginX * 2 - gap) / 2);
	var rowH = Math.floor((h - marginY * 2 - gap) / 2);

	var accent = ['#55a5de', '#55be96', '#eb8c41', '#916cd0'];
	var topColors = ['#e4f0fa', '#e4f5ee', '#faf0e4', '#f2ebf8'];
	var botColors = ['#c0ddf5', '#b8e8d5', '#f5c8a0', '#d8c0e8'];
	var icons = ['dashboard', 'leave-list', 'late-list', 'ot-list'];
	var labels = ['公司今日考勤', '本月請假累計', '本月考勤異常累計', '本月加班累計'];

	var fontFamily = _cnFontFamily || '"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Heiti TC", "STHeiti", "Microsoft JhengHei", sans-serif';

	function drawRoundRect(x, y, w2, h2, r) {
		ctx.beginPath();
		ctx.roundRect(x, y, w2, h2, r);
		ctx.fill();
	}

	function drawCard(cx2, cy2, cw, ch, radius, topColor, botColor) {
		ctx.fillStyle = 'rgba(0,0,0,0.06)';
		drawRoundRect(cx2 + 2, cy2 + 3, cw, ch, radius);
		var grad = ctx.createLinearGradient(cx2, cy2, cx2, cy2 + ch);
		grad.addColorStop(0, topColor);
		grad.addColorStop(1, botColor);
		ctx.fillStyle = grad;
		drawRoundRect(cx2, cy2, cw, ch, radius);
	}

	function drawIcon(cx, cy, r, color, type) {
		ctx.fillStyle = 'rgba(0,0,0,0.05)';
		ctx.beginPath();
		ctx.arc(cx + 2, cy + 2, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.95)';
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();

		ctx.strokeStyle = color;
		ctx.lineWidth = 5;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.fillStyle = color;

		var s = Math.round(r * 0.52);
		if (type === 'dashboard') {
			// Gauge
			ctx.beginPath();
			ctx.arc(cx, cy, s, 3.84, 5.59);
			ctx.stroke();
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(cx, cy + Math.round(s * 0.2));
			ctx.lineTo(cx - Math.round(s * 0.4), cy - Math.round(s * 0.3));
			ctx.stroke();
			ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
		} else if (type === 'leave-list') {
			// Document with lines
			ctx.lineWidth = 4;
			ctx.beginPath(); ctx.roundRect(cx - s, cy - s, Math.round(s * 1.6), s * 2, 6); ctx.stroke();
			ctx.lineWidth = 4;
			for (var ly = -Math.round(s * 0.4); ly <= Math.round(s * 0.4); ly += Math.round(s * 0.4)) {
				ctx.beginPath();
				ctx.moveTo(cx - Math.round(s * 0.7), cy + ly);
				ctx.lineTo(cx + Math.round(s * 0.3), cy + ly);
				ctx.stroke();
			}
		} else if (type === 'late-list') {
			// Warning triangle
			ctx.beginPath();
			ctx.moveTo(cx, cy - s);
			ctx.lineTo(cx - s, cy + s);
			ctx.lineTo(cx + s, cy + s);
			ctx.closePath();
			ctx.stroke();
			ctx.lineWidth = 4;
			ctx.beginPath();
			ctx.moveTo(cx, cy - Math.round(s * 0.1));
			ctx.lineTo(cx, cy + Math.round(s * 0.4));
			ctx.stroke();
			ctx.beginPath(); ctx.arc(cx, cy + Math.round(s * 0.6), 3, 0, Math.PI * 2); ctx.fill();
		} else if (type === 'ot-list') {
			// Clock
			ctx.beginPath(); ctx.arc(cx, cy, s, 0, Math.PI * 2); ctx.stroke();
			ctx.lineWidth = 4;
			ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - Math.round(s * 0.55)); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.round(s * 0.45), cy); ctx.stroke();
		}
	}

	for (var i = 0; i < 4; i++) {
		var col = i % 2;
		var row = Math.floor(i / 2);
		var bx = marginX + col * (colW + gap);
		var by = marginY + row * (rowH + gap);
		var cx = bx + Math.floor(colW / 2);
		var cardW = colW - 8;
		var cardH = rowH - 8;
		var cardX = bx + 4;
		var cardY = by + 4;

		drawCard(cardX, cardY, cardW, cardH, 42, topColors[i], botColors[i]);

		var iconR = Math.round(colW * 0.10);
		var iconY = cardY + Math.round(cardH * 0.34);
		drawIcon(cx, iconY, iconR, accent[i], icons[i]);

		ctx.fillStyle = '#32323c';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = 'bold 90px ' + fontFamily;
		ctx.fillText(labels[i], cx, cardY + Math.round(cardH * 0.78));
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

// 查詢公司今日考勤狀態（考勤異常/曠職/GPS超出/請假）
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
			lines.push('\n⚠️ 考勤異常（' + lateList.length + ' 人）：');
			for (var k = 0; k < lateList.length; k++) {
				var le = lateList[k];
				var e3 = await db.getEmployeeById(le.employee_id);
				var t = le.check_time;
				var timeStr = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
				lines.push('  ' + (e3 ? e3.name + '（' + e3.employee_no + '）' : '員工#' + le.employee_id) + ' ' + timeStr + ' 考勤異常 ' + le.late_min + ' 分' + (le.covered ? '' : ' （尚未請假）'));
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
		var leaveLabel = leaveTypeLabel(leaveType);
		var hours = leaveHours(l.start_date, l.end_date);
		if (!empLeaveMap[l.employee_id]) {
			empLeaveMap[l.employee_id] = { name: l.name, no: l.employee_no, records: [], totalHours: 0 };
		}
		empLeaveMap[l.employee_id].records.push({ start: lsFull.length > 7 ? lsFull.substring(5) : lsFull, end: leFull.length > 7 ? leFull.substring(5) : leFull, hours: hours, type: leaveLabel });
		empLeaveMap[l.employee_id].totalHours += hours;
	}

	// 全體員工本年度事假/病假統計
	var yearStart = now.getFullYear() + '-01-01';
	var allEmps = await db.listAttendanceEmployees();
	var ytdMap = {}; // employee_id -> { name, no, personal, sick }
	for (var ei = 0; ei < allEmps.length; ei++) {
		var e2 = allEmps[ei];
		ytdMap[e2.id] = { name: e2.name, no: e2.employee_no, personal: 0, sick: 0 };
	}
	for (var li = 0; li < allLeaves.length; li++) {
		var lv2 = allLeaves[li];
		if (lv2.start_date < yearStart) continue;
		if (!ytdMap[lv2.employee_id]) continue;
		if (lv2.leave_type === 'personal') ytdMap[lv2.employee_id].personal += leaveHours(lv2.start_date, lv2.end_date);
		else if (lv2.leave_type === 'sick') ytdMap[lv2.employee_id].sick += leaveHours(lv2.start_date, lv2.end_date);
	}
	// 加上手動補登（後台設定）
	for (var ei2 = 0; ei2 < allEmps.length; ei2++) {
		var e3 = allEmps[ei2];
		ytdMap[e3.id].personal += parseFloat(e3.personal_ytd_manual || 0);
		ytdMap[e3.id].sick += parseFloat(e3.sick_ytd_manual || 0);
	}

	var keys = Object.keys(empLeaveMap);
	var ytdKeys = Object.keys(ytdMap);

	// 篩選出有 YTD 資料但沒有本月請假的員工
	var ytdOnlyKeys = [];
	for (var yk = 0; yk < ytdKeys.length; yk++) {
		var eid = ytdKeys[yk];
		if (!empLeaveMap[eid] && (ytdMap[eid].personal > 0 || ytdMap[eid].sick > 0)) {
			ytdOnlyKeys.push(eid);
		}
	}

	var lines = ['📋 本月請假累計（' + monthStart.substring(5) + ' ~ ' + monthEnd.substring(5) + '）'];

	if (keys.length === 0 && ytdOnlyKeys.length === 0) {
		return client.replyMessage(replyToken, [withMenu('📋 本月無請假記錄')]);
	}

	// 按員工編號排序
	keys.sort(function(a, b) { return (empLeaveMap[a].no || '').localeCompare(empLeaveMap[b].no || ''); });

	var totalAll = 0;
	for (var k = 0; k < keys.length; k++) {
		var info = empLeaveMap[keys[k]];
		totalAll += info.totalHours;
		lines.push('\n👤 ' + info.name + '（' + info.no + '） 累計 ' + info.totalHours + 'h');
		for (var r = 0; r < info.records.length; r++) {
			var rec = info.records[r];
			lines.push('    ' + rec.start + ' ~ ' + rec.end + ' ' + rec.type + '（' + rec.hours + 'h）');
		}
		// 加上年度事假/病假統計
		var ytd = ytdMap[keys[k]];
		if (ytd) {
			var ytdParts = [];
			if (ytd.personal > 0) ytdParts.push('事假 ' + Math.round(ytd.personal * 10) / 10 + 'h');
			if (ytd.sick > 0) ytdParts.push('病假 ' + Math.round(ytd.sick * 10) / 10 + 'h');
			if (ytdParts.length > 0) lines.push('    📊 年度：' + ytdParts.join('、'));
		}
	}

	// 顯示有年度事假/病假但本月無請假的人
	if (ytdOnlyKeys.length > 0) {
		ytdOnlyKeys.sort(function(a, b) { return (ytdMap[a].no || '').localeCompare(ytdMap[b].no || ''); });
		lines.push('\n📊 年度事假/病假（本月無請假）：');
		for (var yk2 = 0; yk2 < ytdOnlyKeys.length; yk2++) {
			var ytd2 = ytdMap[ytdOnlyKeys[yk2]];
			var ytdParts2 = [];
			if (ytd2.personal > 0) ytdParts2.push('事假 ' + Math.round(ytd2.personal * 10) / 10 + 'h');
			if (ytd2.sick > 0) ytdParts2.push('病假 ' + Math.round(ytd2.sick * 10) / 10 + 'h');
			lines.push('  ' + ytd2.name + '（' + ytd2.no + '） ' + ytdParts2.join('、'));
		}
	}

	if (totalAll > 0) {
		lines.push('\n📊 全公司本月請假合計：' + totalAll + ' 小時');
	}

	var titleB2 = lines[0];
	return sendTableImage(client, replyToken, titleB2, lines.join('\n'));
}

// 當月公司人員考勤異常累計
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
		// 假日/國定假日不計考勤異常
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
			if (isCoveredByLeave(ctMs, clv.start_date, clv.end_date)) { coveredByLeave = true; break; }
		}
		empLateMap[c.employee_id].records.push({ date: dateStr, time: timeStr, lateMin: lateMins, covered: coveredByLeave });
		empLateMap[c.employee_id].count++;
	}

	var keys = Object.keys(empLateMap);
	if (keys.length === 0) {
		return client.replyMessage(replyToken, [withMenu('✅ 本月無考勤異常記錄')]);
	}

	keys.sort(function(a, b) { return (empLateMap[a].no || '').localeCompare(empLateMap[b].no || ''); });

			var lines = ['📋 本月考勤異常累計（' + monthStart.substring(5) + ' ~ ' + todayStr.substring(5) + '）'];
		var totalCount = 0;
		for (var k = 0; k < keys.length; k++) {
			var info = empLateMap[keys[k]];
			totalCount += info.records.length;
			lines.push('\n👤 ' + info.name + '（' + info.no + '） 考勤異常 ' + info.records.length + ' 次');
			for (var r = 0; r < info.records.length; r++) {
				var rec = info.records[r];
				lines.push('    ' + rec.date + ' ' + rec.time + '（晚 ' + rec.lateMin + ' 分）' + (rec.covered ? '' : ' （尚未請假）'));
			}
		}
		if (totalCount > 0) lines.push('\n📊 全公司本月考勤異常合計：' + totalCount + ' 次');

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
      '💍': '1f48d', '💐': '1f490', '⏰': '23f0',
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
    '💍': 'R ',
    '💐': 'F ',
    '⏰': 'C ',
    '📋': '',
    '📅': '',
    '📦': ''
  };
  // 標記 → 原始 emoji（用於查找 emoji 圖片）
  var markerToEmoji = {
    '!': '⚠', 'X': '❌', 'V': '✅', '@': '📍',
    '~': '🏖', 'O': '🕐', '=': '📊', '*': '👤',
    '+': '🔵', '-': '🔴',
    'R': '💍', 'F': '💐', 'C': '⏰'
  };
  // 標記對應的顏色（emoji 圖片載入失敗時降級用）
  var iconColors = {
    '!': '#f59e0b', 'X': '#ef4444', 'V': '#22c55e', '@': '#3b82f6',
    '~': '#eab308', 'O': '#a855f7', '=': '#10b981', '*': '#6b7280',
    '+': '#3b82f6', '-': '#ef4444',
    'R': '#e91e63', 'F': '#9c27b0', 'C': '#ff9800'
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
      var _hasUnpaid = (line.indexOf('尚未請假') !== -1);
      ctx.fillStyle = _hasUnpaid ? '#ef4444' : '#666666';
      ctx.font = (_hasUnpaid ? 'bold ' : '') + (fontSize - 2) + 'px ' + fontFamily;
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

module.exports = { handleEvents, setupRichMenu, makePng, makePng8, makePngBoss, assignRichMenu, initFont, loadEmojiImages, getStoredImage, storeImage, textToImage, sendTableImage, leaveHours, refreshHolidays };
