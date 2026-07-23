/**
 * 每日出勤報表 — setTimeout 精確定時 + 事件驅動
 *
 * 策略：
 *   1. setTimeout 排定每日推播時間（精確到分鐘）
 *   2. UptimeRobot 每 5 分鐘監控 /health（取代舊版自 ping，防止 Render 休眠）
 *   3. 每次 webhook 事件也檢查 trySendReport（雙重保障）
 *   4. last_report_date 記錄避免重複發送
 *
 *   只要當天有人跟 Bot 互動過一次，伺服器就會保持清醒直到日報發出
 */
const db = require('./database');
const bot = require('./bot');

var scheduleTimeout = null;
var clientRef = null;

/**
 * 嘗試發送今日日報（多個觸發點呼叫，只會在條件符合時發送一次）
 * 條件：已啟用 + 今天是推播日 + 現在時間 ≥ 設定時間 + 今天尚未發送
 */
async function trySendReport(client) {
  try {
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
    // 更新國定假日快取（確保請假時數正確）
    await bot.refreshHolidays();

    var groupId = await db.getSetting('report_group_id');
    if (!groupId) { console.log('[Report] 未設定群組 ID，跳過'); return; }

    var todayStr = new Date().toISOString().split('T')[0];

    var s = await db.getTodaySummary();

    // 取得所有在職員工
    var allEmps = await db.listAttendanceEmployees();

    // 取得今日打卡記錄
    var records = await db.queryCheckins(null, todayStr, todayStr, 500, 0);
    var checkinMap = {}; // employee_id → { checkIn, checkOut }
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (!checkinMap[r.employee_id]) checkinMap[r.employee_id] = { checkIn: null, checkOut: null };
      if (r.type === 'check_in') checkinMap[r.employee_id].checkIn = r;
      else checkinMap[r.employee_id].checkOut = r;
    }

    // 取得今日請假（含時數，已扣除週末）
    var leaveMap = {}; // employee_id → { name, no, type, hours }
    var allLeaves = await db.getLeaveRequests('approved', 500);
    for (var li = 0; li < allLeaves.length; li++) {
      var l = allLeaves[li];
      var lStart = typeof l.start_date === 'string' ? l.start_date.substring(0, 10) : '';
      var lEnd = typeof l.end_date === 'string' ? l.end_date.substring(0, 10) : lStart;
      if (lStart <= todayStr && lEnd >= todayStr) {
        if (!leaveMap[l.employee_id]) {
          var leaveLabel = l.leave_type === 'annual' ? '特休' : l.leave_type === 'personal' ? '事假' : l.leave_type === 'sick' ? '病假' : l.leave_type === 'official' ? '公假' : l.leave_type === 'outing' ? '外出' : l.leave_type;
          var leaveHoursTotal = bot.leaveHours(l.start_date, l.end_date);
          leaveMap[l.employee_id] = { name: l.name, no: l.employee_no, type: leaveLabel, hours: leaveHoursTotal };
        }
      }
    }

    // 逐一分析每位員工
    var workStartH = parseInt(await db.getSetting('work_start_hour') || '8');
    var workBuf = parseInt(await db.getSetting('late_buffer_minutes') || '30');
    var checkedInList = [];    // 已打卡（含考勤異常標記）
    var lateList = [];         // 考勤異常
    var leaveList = [];        // 請假中（不論是否打卡都列入）
    var absentList = [];       // 未打卡（非請假）
    for (var j = 0; j < allEmps.length; j++) {
      var emp = allEmps[j];
      var ci = checkinMap[emp.id];
      var onLeave = leaveMap[emp.id];

      // 請假人員一律列入（不論有無打卡）
      if (onLeave) {
        leaveList.push(emp.employee_no + ' ' + onLeave.name + '（' + onLeave.type + '，' + onLeave.hours + 'h）');
      }

      if (ci && ci.checkIn) {
        checkedInList.push(emp.employee_no + ' ' + emp.name);
        // 判斷考勤異常
        var ciH = new Date(ci.checkIn.check_time).getHours();
        var ciM = new Date(ci.checkIn.check_time).getMinutes();
        var lateMin = ciH * 60 + ciM - (workStartH * 60 + workBuf);
        if (lateMin > 0) {
          lateList.push(emp.employee_no + ' ' + emp.name + '（' + fmtTime(new Date(ci.checkIn.check_time)) + '，晚 ' + lateMin + ' 分）');
        }
      } else if (!onLeave) {
        // 未打卡且非請假 → 曠職
        absentList.push(emp.employee_no + ' ' + emp.name);
      }
    }

    var today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

    var msg = '📊 ' + today + ' 出勤報告\n\n';
    msg += '👥 總人數：' + allEmps.length + '\n';
    msg += '✅ 已上班：' + checkedInList.length + ' 人\n';
    msg += '🏖 請假中：' + leaveList.length + ' 人\n';
    msg += '❌ 未打卡：' + absentList.length + ' 人\n\n';

    if (lateList.length > 0) {
      msg += '⚠️ 考勤異常名單（' + lateList.length + ' 人）：\n' + lateList.join('\n') + '\n\n';
    }
    if (leaveList.length > 0) {
      msg += '🏖 請假名單（' + leaveList.length + ' 人）：\n' + leaveList.join('\n') + '\n\n';
    }
    if (absentList.length > 0) {
      msg += '❌ 未打卡名單（' + absentList.length + ' 人）：\n' + absentList.join('\n') + '\n\n';
    }

    msg += '📌 系統自動推播';

    // 檢查是否啟用圖片版日報
    var asImage = await db.getSetting('report_as_image');
    if (asImage === 'true' || asImage === '1') {
      try {
        var png = bot.textToImage('', msg);
        if (png) {
          var imgId = 'report_' + todayStr.replace(/-/g, '');
          bot.storeImage(imgId, png);
          var baseUrl = process.env.APP_URL || ('https://' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost'));
          var imgUrl = baseUrl + '/img/' + imgId;
          await client.pushMessage(groupId, [{ type: 'image', originalContentUrl: imgUrl, previewImageUrl: imgUrl }]);
          console.log('[Report] 已推播圖片版日報到群組 ' + groupId);
          return;
        }
      } catch(e) { console.error('[Report] 圖片產生失敗，降級為文字:', e.message); }
    }

    await client.pushMessage(groupId, [{ type: 'text', text: msg }]);
    console.log('[Report] 已推播到群組 ' + groupId);
  } catch (e) {
    console.error('[Report] 推播失敗:', e.message);
  }
}

function fmtTime(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * 排程下一次日報：計算到設定時間的毫秒數，用 setTimeout 精確觸發
 */
function scheduleNext() {
  if (scheduleTimeout) clearTimeout(scheduleTimeout);
  var now = new Date();
  var targetH = 17, targetM = 0;
  // 從 DB 讀取設定時間（非同步，但先設預設值）
  db.getSetting('report_time').then(function(timeStr) {
    if (timeStr) {
      var parts = timeStr.split(':');
      targetH = parseInt(parts[0]) || 17;
      targetM = parseInt(parts[1]) || 0;
    }
    var next = new Date(now);
    next.setHours(targetH, targetM, 0, 0);
    // 若已過今日目標時間，排到明天
    if (next <= now) next.setDate(next.getDate() + 1);
    var ms = next.getTime() - now.getTime();
    scheduleTimeout = setTimeout(function() {
      if (clientRef) trySendReport(clientRef);
      scheduleNext(); // 排下一天
    }, ms);
    console.log('[Report] 下一次排程：' + next.toLocaleString('zh-TW') + '（' + Math.round(ms / 60000) + ' 分鐘後）');
  }).catch(function(e) {
    console.error('[Report] scheduleNext 讀取設定失敗:', e.message);
    // 預設 17:00
    var next = new Date(now);
    next.setHours(17, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    var ms = next.getTime() - now.getTime();
    scheduleTimeout = setTimeout(function() {
      if (clientRef) trySendReport(clientRef);
      scheduleNext();
    }, ms);
  });
}

function startScheduler(client) {
  clientRef = client;
  scheduleNext();      // 精確排程
  console.log('[Report] 排程已啟動（setTimeout + 事件驅動，UptimeRobot 監控中）');
}

var sendDailyReport = doSendReport;

module.exports = { startScheduler, trySendReport, sendDailyReport };
