/**
 * 每日出勤報表 — setTimeout 精確定時 + Keep-Alive 防止休眠
 *
 * 策略：
 *   1. setTimeout 排定每日推播時間（精確到分鐘）
 *   2. setInterval 每 10 分鐘自 ping 一次，防止 Render 15 分鐘休眠
 *   3. 每次 webhook 事件也檢查 trySendReport（雙重保障）
 *   4. last_report_date 記錄避免重複發送
 *
 *   只要當天有人跟 Bot 互動過一次，伺服器就會保持清醒直到日報發出
 */
const db = require('./database');
const http = require('http');

var scheduleTimeout = null;
var keepAliveInterval = null;
var clientRef = null;

/**
 * 啟動 Keep-Alive：每 10 分鐘對自己發一個 HTTP 請求，防止 Render 休眠
 * 只要有人觸發過一次 webhook，伺服器就會持續清醒
 */
function startKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  var port = process.env.PORT || 3000;
  keepAliveInterval = setInterval(function() {
    http.get('http://0.0.0.0:' + port + '/health', function(res) {
      res.resume();
    }).on('error', function() {
      // 忽略自 ping 錯誤
    });
  }, 10 * 60 * 1000); // 每 10 分鐘（低於 Render 15 分鐘休眠門檻）
  console.log('[Report] Keep-Alive 已啟動（每 10 分鐘自 ping）');
}

/**
 * 嘗試發送今日日報（多個觸發點呼叫，只會在條件符合時發送一次）
 * 條件：已啟用 + 今天是推播日 + 現在時間 ≥ 設定時間 + 今天尚未發送
 */
async function trySendReport(client) {
  try {
    // 確保 keep-alive 運行中
    if (!keepAliveInterval) startKeepAlive();

    // 檢查是否啟用
    var enabled = await db.getSetting('report_enabled');
    if (enabled !== 'true' && enabled !== '1') return;

    // 檢查今天是否為推播日
    var daysStr = await db.getSetting('report_days') || '1,2,3,4,5';
    var days = daysStr.split(',').map(function(d) { return parseInt(d); });
    var now = new Date();
    var todayDow = now.getDay();
    if (days.indexOf(todayDow) === -1) return;

    // 檢查時間是否已到
    var reportTime = await db.getSetting('report_time') || '17:00';
    var parts = reportTime.split(':');
    var targetH = parseInt(parts[0]), targetM = parseInt(parts[1] || '0');
    var nowMinutes = now.getHours() * 60 + now.getMinutes();
    var targetMinutes = targetH * 60 + targetM;
    if (nowMinutes < targetMinutes) return; // 時間還沒到

    // 檢查同日不重複發送（選項控制）
    var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    var noDup = await db.getSetting('report_no_dup');
    if (noDup !== 'false' && noDup !== '0') {
      var lastDate = await db.getSetting('last_report_date') || '';
      if (lastDate === todayStr) return; // 今天已發送，跳過
    }

    // 發送！
    console.log('[Report] 觸發發送（今日尚未發送，時間已過 ' + reportTime + '）');
    await doSendReport(client);

    // 記錄已發送
    await db.setSetting('last_report_date', todayStr);
    console.log('[Report] 已記錄發送日期：' + todayStr);
  } catch (e) {
    console.error('[Report] trySendReport 錯誤:', e.message);
  }
}

/**
 * 實際發送日報內容
 */
async function doSendReport(client) {
  try {
    var groupId = await db.getSetting('report_group_id');
    if (!groupId) { console.log('[Report] 未設定群組 ID，跳過'); return; }

    var todayStr = new Date().toISOString().split('T')[0];

    var s = await db.getTodaySummary();
    var records = await db.queryCheckins(null, todayStr, todayStr, 500, 0);

    // 查詢今日請假
    var leaveCount = 0;
    var leaveNames = [];
    var leaveEmpIds = {};
    try {
      var allLeaves = await db.getLeaveRequests('approved', 500);
      for (var li = 0; li < allLeaves.length; li++) {
        var l = allLeaves[li];
        var lStart = typeof l.start_date === 'string' ? l.start_date.split(' ')[0] : '';
        var lEnd = typeof l.end_date === 'string' ? l.end_date.split(' ')[0] : lStart;
        if (lStart <= todayStr && lEnd >= todayStr) {
          if (!leaveEmpIds[l.employee_id]) {
            leaveEmpIds[l.employee_id] = true;
            leaveCount++;
            var leaveLabel = l.leave_type === 'annual' ? '特休' : l.leave_type === 'personal' ? '事假' : l.leave_type === 'sick' ? '病假' : l.leave_type === 'official' ? '公假' : l.leave_type === 'outing' ? '外出' : l.leave_type;
            leaveNames.push(l.name + '（' + leaveLabel + '）');
          }
        }
      }
    } catch(e) { console.error('[Report] 查詢請假失敗:', e.message); }

    var empMap = {};
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var key = r.employee_id;
      if (!empMap[key]) empMap[key] = { name: r.name, no: r.employee_no, dept: r.department, checkIn: null, checkOut: null };
      if (r.type === 'check_in') empMap[key].checkIn = r;
      else empMap[key].checkOut = r;
    }

    var today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

    var msg = '📊 ' + today + ' 出勤報告\n\n';
    msg += '👥 總人數：' + s.total_employees + '\n';
    msg += '✅ 已上班：' + s.checked_in + ' 人\n';
    msg += '📤 已下班：' + s.checked_out + ' 人\n';
    msg += '🏖 請假中：' + leaveCount + ' 人\n';
    msg += '⏳ 未打卡：' + s.not_checked_in + ' 人\n\n';

    if (leaveNames.length > 0) {
      msg += '🏖 請假名單：\n' + leaveNames.join('\n') + '\n\n';
    }

    var lateList = [];
    var absentList = [];
    var empKeys = Object.keys(empMap);
    for (var j = 0; j < empKeys.length; j++) {
      var e = empMap[empKeys[j]];
      if (e.checkIn) {
        var ciH = new Date(e.checkIn.check_time).getHours();
        var ciM = new Date(e.checkIn.check_time).getMinutes();
        var startH = parseInt(await db.getSetting('work_start_hour') || '8');
        var buf = parseInt(await db.getSetting('late_buffer_minutes') || '30');
        if (ciH * 60 + ciM > startH * 60 + buf) {
          lateList.push(e.no + ' ' + e.name + '（' + fmtTime(new Date(e.checkIn.check_time)) + '）');
        }
      } else {
        if (!leaveEmpIds[empKeys[j]]) {
          absentList.push(e.no + ' ' + e.name);
        }
      }
    }

    if (lateList.length > 0) msg += '⚠️ 遲到名單：\n' + lateList.join('\n') + '\n\n';
    if (absentList.length > 0) msg += '❌ 未打卡名單（不含請假）：\n' + absentList.join('\n') + '\n\n';

    msg += '📌 系統自動推播';

    await client.pushMessage(groupId, [{ type: 'text', text: msg }]);
    console.log('[Report] 已推播到群組 ' + groupId);
  } catch (e) {
    console.error('[Report] 推播失敗:', e.message);
  }
}

function fmtTime(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function startScheduler(client) {
  clientRef = client;
  startKeepAlive();   // 防休眠
  scheduleNext();      // 精確排程
  console.log('[Report] 排程已啟動（Keep-Alive + setTimeout + 事件驅動）');
}

function scheduleNext() {
  if (scheduleTimeout) clearTimeout(scheduleTimeout);

  var now = new Date();
  db.getSetting('report_time').then(function(t) {
    var time = t || '17:00';
    var parts = time.split(':');
    var targetH = parseInt(parts[0]), targetM = parseInt(parts[1] || '0');

    var target = new Date(now);
    target.setHours(targetH, targetM, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);

    var delay = target - now;
    console.log('[Report] 下次推播：' + target.toLocaleString('zh-TW') + '（' + Math.round(delay / 60000) + ' 分鐘後）');

    scheduleTimeout = setTimeout(function() {
      trySendReport(clientRef).finally(function() {
        scheduleNext(); // 排下一輪
      });
    }, delay);
  }).catch(function(e) {
    console.error('[Report] 排程錯誤，30 分鐘後重試:', e.message);
    scheduleTimeout = setTimeout(function() {
      scheduleNext();
    }, 30 * 60 * 1000);
  });
}

// sendDailyReport 保留向後相容
var sendDailyReport = doSendReport;

module.exports = { startScheduler, trySendReport, sendDailyReport };
