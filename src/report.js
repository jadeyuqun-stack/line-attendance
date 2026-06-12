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

    var s = await db.getTodaySummary();
    var records = await db.queryCheckins(null,
      new Date().toISOString().split('T')[0],
      new Date().toISOString().split('T')[0], 500, 0);

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
    msg += '⏳ 未打卡：' + s.not_checked_in + ' 人\n\n';

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
        absentList.push(e.no + ' ' + e.name);
      }
    }

    if (lateList.length > 0) msg += '⚠️ 遲到名單：\n' + lateList.join('\n') + '\n\n';
    if (absentList.length > 0) msg += '❌ 未打卡名單：\n' + absentList.join('\n') + '\n\n';

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
      sendDailyReport(clientRef).then(function() {
        scheduleNext();
      });
    }, delay);
  });
}

module.exports = { startScheduler, sendDailyReport };
