/**
 * 每日出勤報表 — 定時推播到 LINE 群組
 */
const db = require('./database');

var scheduleTimeout = null;
var clientRef = null;

async function sendDailyReport(client) {
  try {
    // 檢查是否啟用
    var enabled = await db.getSetting('report_enabled');
    if (enabled !== 'true' && enabled !== '1') { console.log('[Report] 未啟用，跳過'); return; }

    // 檢查今天是否為推播日（0=Sun,1=Mon,...,6=Sat）
    var daysStr = await db.getSetting('report_days') || '1,2,3,4,5';
    var days = daysStr.split(',').map(function(d) { return parseInt(d); });
    var todayDow = new Date().getDay();
    if (days.indexOf(todayDow) === -1) { console.log('[Report] 今天非推播日（' + todayDow + '），跳過'); return; }

    var groupId = await db.getSetting('report_group_id');
    if (!groupId) { console.log('[Report] 未設定群組 ID，跳過'); return; }

    var todayStr = new Date().toISOString().split('T')[0];

    var s = await db.getTodaySummary();
    var records = await db.queryCheckins(null, todayStr, todayStr, 500, 0);

    // 查詢今日請假
    var leaveCount = 0;
    var leaveNames = [];
    var leaveEmpIds = {};  // employee_id → true，用於判斷缺席時排除
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
        // 檢查是否在請假中（用員工 ID 比對）
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
  scheduleNext();
  console.log('[Report] 排程已啟動');
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
      sendDailyReport(clientRef).finally(function() {
        scheduleNext();
      });
    }, delay);
  }).catch(function(e) {
    console.error('[Report] 排程錯誤，30 分鐘後重試:', e.message);
    scheduleTimeout = setTimeout(function() {
      scheduleNext();
    }, 30 * 60 * 1000);
  });
}

module.exports = { startScheduler, sendDailyReport };
