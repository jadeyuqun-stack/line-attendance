const express = require('express');
const db = require('./database');
const XLSX = require('xlsx');
const router = express.Router();

function auth(req, res, next) {
  if (req.session && req.session.ahmin) return next();
  return req.method === 'GET' ? res.redirect('/admin/login') : res.status(401).json({ error: '未登入' });
}

// ===== CSS =====
const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif;background:#f5f6fa;color:#333;min-height:100vh}
a{text-decoration:none}
/* Sidebar */
.sidebar{position:fixed;left:0;top:0;width:220px;height:100vh;background:#fff;border-right:1px solid #e8e8e8;z-index:100;display:flex;flex-direction:column}
.sidebar .logo{padding:20px;border-bottom:1px solid #f0f0f0}
.sidebar .logo h1{font-size:18px;color:#06c755;display:flex;align-items:center;gap:8px}
.sidebar .logo span{font-size:11px;color:#999;font-weight:400}
.sidebar nav{flex:1;padding:12px 0}
.sidebar nav a{display:flex;align-items:center;gap:10px;padding:12px 20px;color:#666;font-size:14px;transition:all .2s;border-left:3px solid transparent}
.sidebar nav a:hover{background:#f8fcf9;color:#06c755}
.sidebar nav a.active{background:#e6f9ee;color:#06c755;border-left-color:#06c755;font-weight:600}
.sidebar .user{padding:16px 20px;border-top:1px solid #f0f0f0;font-size:12px;color:#999}
.sidebar .user a{color:#e74c3c}
/* Main */
.main{margin-left:220px;padding:32px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.header h2{font-size:22px;font-weight:700}
.header .date{color:#999;font-size:14px}
/* Cards */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:24px}
.stat{background:#fff;padding:24px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.04);display:flex;align-items:center;gap:16px}
.stat .icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px}
.stat .icon.green{background:#e6f9ee;color:#06c755}
.stat .icon.blue{background:#e8f4fd;color:#3498db}
.stat .icon.orange{background:#fef5e7;color:#f39c12}
.stat .icon.red{background:#fdecea;color:#e74c3c}
.stat .info .num{font-size:28px;font-weight:700;line-height:1.2}
.stat .info .lbl{font-size:12px;color:#999}
.card{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.04);padding:24px;margin-bottom:20px}
.card h3{font-size:16px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f0f0f0}
/* Table */
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 12px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.5px;font-weight:600;border-bottom:2px solid #f0f0f0}
td{padding:10px 12px;font-size:14px;border-bottom:1px solid #f5f5f5}
tr:hover td{background:#fafcfb}
/* Badge */
.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600}
.badge-in{background:#e6f9ee;color:#06c755}
.badge-out{background:#fdecea;color:#e74c3c}
.badge-warn{background:#fef5e7;color:#f39c12}
.badge-info{background:#e8f4fd;color:#3498db}
/* Form */
form.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:end}
form.inline>div{display:flex;flex-direction:column;gap:4px}
form.inline label{font-size:12px;color:#666;font-weight:600}
input,select{height:40px;padding:0 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;outline:none;transition:border .2s}
input:focus,select:focus{border-color:#06c755}
input{min-width:120px}select{min-width:100px}
.btn{height:40px;padding:0 20px;background:#06c755;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .2s}
.btn:hover{background:#05a649}
.btn-sm{height:30px;padding:0 12px;font-size:12px}
.btn-outline{background:#fff;color:#06c755;border:1px solid #06c755}
.btn-outline:hover{background:#f8fcf9}
.btn-red{background:#e74c3c}.btn-red:hover{background:#c0392b}
.btn-blue{background:#3498db}.btn-blue:hover{background:#2980b9}
.btn-gray{background:#ddd;color:#666}.btn-gray:hover{background:#ccc}
/* Modal */
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.4);z-index:999;justify-content:center;align-items:center}
.modal>div{background:#fff;padding:28px;border-radius:16px;width:90%;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,.12)}
.modal h3{font-size:18px;margin-bottom:16px}
.modal label{display:block;font-size:13px;color:#666;font-weight:600;margin-bottom:4px}
.modal input{width:100%;margin-bottom:12px}
.modal .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.editable{cursor:pointer;border-bottom:1px dashed #aaa;padding:2px 0}
.editable:hover{color:#06c755;border-color:#06c755}
/* Progress bar */
.progress{background:#eee;border-radius:8px;height:8px;overflow:hidden;margin:8px 0}
.progress div{height:100%;background:#06c755;border-radius:8px;transition:width .5s}
/* Login */
.login-page{display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#06c755 0%,#05a649 100%)}
.login-box{background:#fff;padding:40px;border-radius:16px;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.15);text-align:center}
.login-box h1{font-size:24px;margin-bottom:4px;color:#06c755}
.login-box p.sub{color:#999;font-size:14px;margin-bottom:24px}
.login-box input{width:100%;margin-bottom:12px}
.login-box .btn{width:100%;justify-content:center;height:48px;font-size:16px}
.login-box .err{background:#fdecea;color:#e74c3c;padding:10px;border-radius:8px;margin-bottom:16px;font-size:13px}
/* Tabs */
.tabs{display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid #f0f0f0}
.tabs a{padding:10px 20px;font-size:14px;color:#999;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s}
.tabs a:hover{color:#333}
.tabs a.active{color:#06c755;border-bottom-color:#06c755;font-weight:600}
@media(max-width:768px){
  .sidebar{width:60px}.sidebar .logo h1 span,.sidebar nav a span,.sidebar .user{display:none}
  .sidebar nav a{justify-content:center;padding:12px}
  .main{margin-left:60px;padding:16px}
  .stats{grid-template-columns:repeat(2,1fr)}
  form.inline>div{width:100%}form.inline input,form.inline select{width:100%}
}
`;

// ===== Sidebar nav =====
function sidebar(active) {
  var links = [
    ['/admin', '📊', '儀表板'],
    ['/admin/employees', '👥', '員工管理'],
    ['/admin/records', '📋', '打卡記錄'],
    ['/admin/missed', '📝', '補打卡'],
    ['/admin/leaves', '🏖', '請假管理'],
    ['/admin/overtime', '🕐', '加班管理'],
    ['/admin/leave-balances', '🎯', '假期設定'],
    ['/admin/salary', '💵', '薪資發送'],
    ['/admin/data', '📦', '資料彙整'],
    ['/admin/settings', '⚙️', '系統設定'],
  ];
  var html = '';
  for (var i = 0; i < links.length; i++) {
    var isActive = links[i][2] === active ? ' active' : '';
    html += '<a href="'+links[i][0]+'" class="'+isActive+'">'+links[i][1]+' <span>'+links[i][2]+'</span></a>';
  }
  return html;
}

function layout(title, active, body) {
  return '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' - 玉群環境科技考勤系統</title><style>'+CSS+'</style></head><body>'
    + '<div class="sidebar"><div class="logo"><h1>📋<span>玉群環境科技考勤系統</span></h1></div><nav>'+sidebar(active)+'</nav><div class="user">管理員 <a href="/admin/logout">登出</a></div></div>'
    + '<div class="main"><div class="header"><h2>'+title+'</h2><div class="date">'+new Date().toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric',weekday:'long'})+'</div></div>'
    + body + '</div></body></html>';
}

// ===== 登入 =====
router.get('/login', (req, res) => {
  res.send('<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入</title><style>'+CSS+'</style></head><body><div class="login-page"><div class="login-box"><h1>📋 打卡管理系統</h1><p class="sub">請輸入管理員帳號密碼</p>'+(req.query.err?'<div class="err">帳號或密碼錯誤</div>':'')+'<form method="POST" action="/admin/login"><input name="username" placeholder="帳號" required autofocus><input type="password" name="password" placeholder="密碼" required><button class="btn">登入</button></form></div></div></body></html>');
});
router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.username === process.env.ADMIN_USERNAME && req.body.password === process.env.ADMIN_PASSWORD) { req.session.ahmin = true; return res.redirect('/admin'); }
  res.redirect('/admin/login?err=1');
});
router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// ===== 儀表板 =====
router.get('/', auth, async (_, res) => {
  var s = await db.getTodaySummary();
  var pct = s.total_employees > 0 ? Math.round(s.checked_in / s.total_employees * 100) : 0;
  // 最近打卡記錄
  var recent = await db.queryCheckins(null, new Date().toISOString().split('T')[0], new Date().toISOString().split('T')[0], 10, 0);
  var recentRows = '';
  for (var i = 0; i < recent.length; i++) {
    var r = recent[i];
    recentRows += '<tr><td>'+h(r.employee_no)+'</td><td>'+h(r.name)+'</td><td>'+(r.type==='check_in'?'<span class="badge badge-in">上班</span>':'<span class="badge badge-out">下班</span>')+'</td><td>'+fmt(r.check_time)+'</td><td>'+(r.in_range===false?'<span class="badge badge-warn">⚠️超出</span>':'-')+'</td></tr>';
  }
  // 今日請假狀況
  var todayStr = new Date().toISOString().split('T')[0];
  var allLeaves = await db.getLeaveRequests('approved', 500);
  var todayLeaves = [];
  var leaveEmpIds = {};
  for (var li = 0; li < allLeaves.length; li++) {
    var l = allLeaves[li];
    var lStart = typeof l.start_date === 'string' ? l.start_date.substring(0, 10) : '';
    var lEnd = typeof l.end_date === 'string' ? l.end_date.substring(0, 10) : lStart;
    if (lStart <= todayStr && lEnd >= todayStr) {
      if (!leaveEmpIds[l.employee_id]) {
        leaveEmpIds[l.employee_id] = true;
        var leaveLabel = l.leave_type === 'annual' ? '特休' : l.leave_type === 'personal' ? '事假' : l.leave_type === 'sick' ? '病假' : l.leave_type === 'official' ? '公假' : l.leave_type === 'outing' ? '外出' : l.leave_type === 'marriage' ? '婚假' : l.leave_type === 'funeral' ? '喪假' : l.leave_type === 'comp' ? '補休' : l.leave_type;
        todayLeaves.push({ name: l.name, no: l.employee_no, dept: l.department, type: leaveLabel, start: lStart, end: lEnd });
      }
    }
  }
  var leaveRows = '';
  for (var lj = 0; lj < todayLeaves.length; lj++) {
    var tl = todayLeaves[lj];
    var dateRange = tl.start === tl.end ? tl.start : tl.start + ' ~ ' + tl.end;
    leaveRows += '<tr><td>'+h(tl.no)+'</td><td>'+h(tl.name)+'</td><td>'+h(tl.dept||'')+'</td><td>'+h(tl.type)+'</td><td>'+dateRange+'</td></tr>';
  }
  var leaveCount = todayLeaves.length;
  var leavePct = s.total_employees > 0 ? Math.round(leaveCount / s.total_employees * 100) : 0;

  var body = '<div class="stats">'
    + '<div class="stat"><div class="icon green">👥</div><div class="info"><div class="num">'+s.total_employees+'</div><div class="lbl">總員工人數</div></div></div>'
    + '<div class="stat"><div class="icon blue">✅</div><div class="info"><div class="num">'+s.checked_in+'</div><div class="lbl">已上班打卡</div></div></div>'
    + '<div class="stat"><div class="icon orange">📤</div><div class="info"><div class="num">'+s.checked_out+'</div><div class="lbl">已下班打卡</div></div></div>'
    + '<div class="stat"><div class="icon red">⏳</div><div class="info"><div class="num">'+s.not_checked_in+'</div><div class="lbl">尚未打卡</div></div></div>'
    + '<div class="stat"><div class="icon orange">🏖</div><div class="info"><div class="num">'+leaveCount+'</div><div class="lbl">請假中（'+leavePct+'%）</div></div></div>'
    + '</div>'
    + '<div class="card"><h3>今日出勤率</h3><div style="font-size:36px;font-weight:700;color:#06c755;margin:8px 0">'+pct+'%</div><div class="progress"><div style="width:'+pct+'%"></div></div><p style="color:#999;font-size:12px;margin-top:4px">'+s.checked_in+' / '+s.total_employees+' 人已打卡</p></div>'
    + '<div class="card"><h3>🏖 今日請假狀況</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>假別</th><th>日期</th></tr>'+(leaveRows||'<tr><td colspan="5">🎉 今日無人請假</td></tr>')+'</table></div>'
    + '<div class="card"><h3>最近打卡</h3><table><tr><th>編號</th><th>姓名</th><th>類型</th><th>時間</th><th>GPS</th></tr>'+(recentRows||'<tr><td colspan="5">尚無記錄</td></tr>')+'</table></div>';
  res.send(layout('儀表板', '儀表板', body));
});

// ===== 打卡記錄 =====
router.get('/records', auth, async (req, res) => {
  var d = req.query.date || new Date().toISOString().split('T')[0];
  var eid = req.query.eid ? parseInt(req.query.eid) : null;
  var month = req.query.month || '';
  // 月模式：查詢整月
  var startDate = d, endDate = d;
  if (month) {
    var parts = month.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1]);
    startDate = y + '-' + String(m).padStart(2,'0') + '-01';
    var lastDay = new Date(y, m, 0).getDate();
    endDate = y + '-' + String(m).padStart(2,'0') + '-' + lastDay;
  }
  var records = await db.queryCheckins(eid, startDate, endDate, 2000, 0);
  var emps = await db.listAttendanceEmployees();
  var leaves = await db.getLeaveRequests('approved', 500);
  var missedPunches = await db.getMissedPunches('approved', 500);
  var empMap = {};
  // 建立員工對照表
  for (var i = 0; i < emps.length; i++) { empMap[emps[i].id] = { emp: emps[i], checkIn: null, checkOut: null, status: '' }; }
  // 填入打卡
  for (var i = 0; i < records.length; i++) {
    var r = records[i], key = r.employee_id;
    if (!empMap[key]) empMap[key] = { emp: { employee_no: r.employee_no, name: r.name, department: r.department }, checkIn: null, checkOut: null, status: '' };
    if (r.type === 'check_in') empMap[key].checkIn = r; else empMap[key].checkOut = r;
  }
  // 判斷考勤狀態（dateOverlaps 已提取至模組層級）
  var _startH = parseInt(await db.getSetting('work_start_hour') || '8');
  var _buf = parseInt(await db.getSetting('late_buffer_minutes') || '30');
  var _holidaysArr = [];
  try { _holidaysArr = JSON.parse(await db.getSetting('tw_holidays') || '[]'); } catch(e2) {}
  var keys = Object.keys(empMap);
  var rows = '', absentCount = 0;
  for (var k = 0; k < keys.length; k++) {
    var d2 = empMap[keys[k]], e = d2.emp;
    var hasCheckIn = !!d2.checkIn;

    // 判斷狀態
    if (hasCheckIn) {
      var ciDt = new Date(d2.checkIn.check_time);
      var ciH = ciDt.getHours(), ciM = ciDt.getMinutes();
      // 假日不計遲到
      var ciDay = ciDt.getDay();
      var ciDateStr = d;
      var isHoliday2 = ciDay === 0 || ciDay === 6;
      if (!isHoliday2 && _holidaysArr.indexOf(ciDateStr) !== -1) isHoliday2 = true;
      d2.status = (!isHoliday2 && ciH*60+ciM > _startH*60+_buf) ? '⚠️遲到' : '✅出勤';
    } else {
      // 檢查當天是否有核准的請假
      var hasLeave = false;
      for (var li = 0; li < leaves.length; li++) {
        if (leaves[li].employee_id == e.id && dateOverlaps(leaves[li].start_date, leaves[li].end_date, d)) {
          hasLeave = true; break;
        }
      }
      // 檢查是否有核准的補打卡
      var hasMissed = false;
      for (var mi = 0; mi < missedPunches.length; mi++) {
        if (missedPunches[mi].employee_id == e.id && missedPunches[mi].punch_date == d) {
          hasMissed = true; break;
        }
      }
      if (hasLeave) d2.status = '🏖請假';
      else if (hasMissed) d2.status = '📝已補卡';
      else { d2.status = '❌曠職'; absentCount++; }
    }

    // 篩選員工
    if (req.query.eid && parseInt(req.query.eid) !== parseInt(e.id)) continue;

    var inHtml = d2.checkIn ? '<span style="color:#06c755">🔵 <span id="ci_'+d2.checkIn.id+'">'+fmt(d2.checkIn.check_time)+'</span></span> <button onclick="editTime('+d2.checkIn.id+',\'ci\')" class="btn-sm" style="font-size:10px;padding:1px 4px;background:#f0f0f0;border:1px solid #ddd;border-radius:3px;cursor:pointer" title="修改時間">✎</button>'+(d2.checkIn.ahdress?'<br><small style="color:#999">📍 '+h(d2.checkIn.ahdress)+'</small>':'')+(d2.checkIn.in_range===false?' <span class="badge badge-warn">⚠️超出</span>':'') : '<span style="color:#ccc">--:--</span>';
    var outHtml = d2.checkOut ? '<span style="color:#e74c3c">🔴 <span id="co_'+d2.checkOut.id+'">'+fmt(d2.checkOut.check_time)+'</span></span> <button onclick="editTime('+d2.checkOut.id+',\'co\')" class="btn-sm" style="font-size:10px;padding:1px 4px;background:#f0f0f0;border:1px solid #ddd;border-radius:3px;cursor:pointer" title="修改時間">✎</button>'+(d2.checkOut.ahdress?'<br><small style="color:#999">📍 '+h(d2.checkOut.ahdress)+'</small>':'')+(d2.checkOut.in_range===false?' <span class="badge badge-warn">⚠️超出</span>':'') : '<span style="color:#ccc">--:--</span>';
    var hours = '-', workH = 0;
    if (d2.checkIn && d2.checkOut) {
      var ci = new Date(d2.checkIn.check_time), co = new Date(d2.checkOut.check_time);
      var totalH = Math.round(Math.max(0,(co-ci)/3600000)*10)/10;
      var lunchDed2 = (ci.getHours() < 12 && co.getHours() >= 13) ? 1 : 0;
      workH = Math.round((totalH - lunchDed2) * 10) / 10;
      hours = totalH + 'h / ' + workH + 'h';
      var nEnd2 = new Date(ci); nEnd2.setHours(17, 30, 0, 0);
      var normalH2 = Math.round(Math.max(0, ((co > nEnd2 ? nEnd2 : co) - ci) / 3600000) * 10) / 10;
      if (normalH2 < 9) hours += ' <span class="badge badge-warn">⚠️</span>';
    }
    var statusBadge = d2.status === '❌曠職' ? '<span class="badge badge-out">❌曠職</span>'
      : d2.status === '⚠️遲到' ? '<span class="badge badge-warn">⚠️遲到</span>'
      : d2.status === '🏖請假' ? '<span class="badge badge-info">🏖請假</span>'
      : d2.status === '📝已補卡' ? '<span class="badge badge-in">📝已補卡</span>'
      : '<span class="badge badge-in">✅出勤</span>';
    var delBtn = '';
    if (d2.checkIn) delBtn += '<button onclick="deleteCheckin('+d2.checkIn.id+')" class="btn-sm btn-red" style="font-size:10px;padding:1px 5px">✕</button> ';
    if (d2.checkOut) delBtn += '<button onclick="deleteCheckin('+d2.checkOut.id+')" class="btn-sm btn-red" style="font-size:10px;padding:1px 5px">✕</button>';
    rows += '<tr><td>'+h(e.employee_no)+'</td><td>'+h(e.name)+'</td><td>'+h(e.department||'')+'</td><td>'+inHtml+'</td><td>'+outHtml+'</td><td>'+hours+'</td><td>'+statusBadge+'</td><td>'+delBtn+'</td></tr>';
  }
  var opts = '';
  for (var j = 0; j < emps.length; j++) opts += '<option value="'+emps[j].id+'">'+h(emps[j].employee_no)+' '+h(emps[j].name)+'</option>';
  // 本月遲到統計
  var monthStart = new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-01';
  var monthRecords = await db.queryCheckins(null, monthStart, d, 5000, 0);
  var lateMap = {};
  for (var j = 0; j < monthRecords.length; j++) {
    var mr = monthRecords[j];
    if (mr.type !== 'check_in') continue;
    var ciH = new Date(mr.check_time).getHours(), ciM = new Date(mr.check_time).getMinutes();
    var startH = parseInt(await db.getSetting('work_start_hour') || '8');
    var buf = parseInt(await db.getSetting('late_buffer_minutes') || '30');
    var lateMin = ciH*60+ciM - (startH*60+buf);
    if (lateMin > 0) {
      if (!lateMap[mr.employee_id]) lateMap[mr.employee_id] = { name: mr.name, no: mr.employee_no, count: 0, totalMin: 0 };
      lateMap[mr.employee_id].count++;
      lateMap[mr.employee_id].totalMin += lateMin;
    }
  }
  var lateKeys = Object.keys(lateMap);
  var lateSummary = '';
  if (lateKeys.length > 0) {
    lateSummary = '<div class="card"><h3>⚠️ 本月遲到統計</h3><table><tr><th>編號</th><th>姓名</th><th>遲到次數</th><th>累計分鐘</th></tr>';
    for (var k = 0; k < lateKeys.length; k++) {
      var lm = lateMap[lateKeys[k]];
      lateSummary += '<tr><td>'+h(lm.no)+'</td><td>'+h(lm.name)+'</td><td>'+lm.count+' 次</td><td>'+lm.totalMin+' 分鐘</td></tr>';
    }
    lateSummary += '</table></div>';
  }
  var monthVal = month || d.substring(0,7);
  var body = '<div class="card"><form class="inline" method="GET"><div><label>日期</label><input type="date" name="date" value="'+d+'"></div><div><label>月份</label><input type="month" name="month" value="'+h(month)+'" style="width:160px"></div><div><label>員工</label><select name="eid"><option value="">全部員工</option>'+opts+'</select></div><button class="btn">🔍 查詢</button></form></div>'
    + lateSummary
    + '<div class="card"><h3>'+(month ? startDate+' ~ '+endDate : d)+' 打卡記錄' + (absentCount > 0 ? '（曠職 '+absentCount+' 人）' : '') + '</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>上班</th><th>下班</th><th>工時</th><th>考勤</th><th>操作</th></tr>'+rows+'</table></div>'
    + '<button onclick="clearCheckins()" class="btn-sm btn-red">🗑 清除所有打卡記錄</button>'
    + '<script>async function clearCheckins(){if(!confirm("⚠️ 確定刪除所有打卡記錄？"))return;await fetch("/admin/api/checkins/clear",{method:"DELETE"});location.reload();}async function deleteCheckin(id){if(!confirm("確定刪除此筆打卡記錄？"))return;var r=await fetch("/admin/api/checkins/"+id,{method:"DELETE"});if(r.ok)location.reload();else alert("刪除失敗");}var editingId=null;var editingPrefix="";function editTime(id,prefix){if(editingId&&editingId!==id)cancelEdit();var el=document.getElementById(prefix+"_"+id);if(!el)return;var current=el.textContent.trim();var match=current.match(/(\\d{2}:\\d{2})/);var oldTime=match?match[1]:"";editingId=id;editingPrefix=prefix;el.innerHTML="<input type=\'time\' id=\'edit_time_input\' value=\'"+oldTime+"\' style=\'width:90px;font-size:12px;padding:2px 4px\'> <button onclick=\'saveTime()\' class=\'btn-sm\' style=\'font-size:10px;padding:1px 5px;background:#06c755;color:#fff;border:none;border-radius:3px;cursor:pointer\'>✓</button> <button onclick=\'cancelEdit()\' class=\'btn-sm\' style=\'font-size:10px;padding:1px 5px;background:#e74c3c;color:#fff;border:none;border-radius:3px;cursor:pointer\'>✕</button>";}function cancelEdit(){if(!editingId)return;location.reload();}async function saveTime(){if(!editingId)return;var input=document.getElementById("edit_time_input");if(!input)return;var newTime=input.value;if(!newTime){alert("請選擇時間");return;}var r=await fetch("/admin/api/checkins/"+editingId,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({time:newTime})});if(r.ok){location.reload();}else{var err=await r.json();alert("修改失敗："+err.error);}}</script>';
  res.send(layout('打卡記錄', '打卡記錄', body));
});

// ===== 員工管理 =====
router.get('/employees', auth, async (_, res) => {
  var emps = await db.listActiveEmployees();
  var approvers = await db.listApprovers();
  var inactiveList = '';
  try {
    var inactiveEmps = await db.listInactiveEmployees();
    if (inactiveEmps.length > 0) {
      inactiveList = '<div class="card"><h3>📦 離職員工</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>角色</th><th>簽核</th><th>操作</th></tr>';
      for (var k = 0; k < inactiveEmps.length; k++) {
        var ie = inactiveEmps[k];
        inactiveList += '<tr>'
          + '<td>'+h(ie.employee_no)+'</td><td>'+h(ie.name)+'</td>'
          + '<td><span class="editable" onclick="editField('+ie.id+',\'department\',\''+esc(ie.department)+'\')">'+(ie.department||'點此設定')+'</span></td>'
          + '<td><span class="editable" onclick="editField('+ie.id+',\'role\',\''+esc(ie.role||'員工')+'\')">'+(ie.role||'員工')+'</span></td>'
          + '<td><button onclick="toggleApprove('+ie.id+','+ie.can_approve+')" class="btn-sm '+(ie.can_approve?'btn':'btn-gray')+'">'+(ie.can_approve?'可簽核':'設為簽核人')+'</button></td>'
          + '<td>'
          + '<button onclick="reactivateEmp('+ie.id+',\''+h(ie.name)+'\')" class="btn-sm btn-outline">復原</button> '
          + '<button onclick="hardDeleteEmp('+ie.id+',\''+h(ie.name)+'\')" class="btn-sm btn-red">永久刪除</button>'
          + '</td></tr>';
      }
      inactiveList += '</table></div>';
    }
  } catch(e) {}

  var rows = '';
  var empMap = {};
  for (var ei = 0; ei < emps.length; ei++) empMap[emps[ei].id] = emps[ei];
  function getOtApprover(rec) {
    if (rec.status !== 'pending') return '';
    var emp = empMap[rec.employee_id];
    if (!emp) return '';
    var lv = rec.approval_level || 1;
    var col = lv === 1 ? 'approver_id' : 'approver2_id';
    var apprId = emp[col];
    var apprName = apprId && empMap[apprId] ? empMap[apprId].name : '';
    return ' <small style="color:#8e44ad">↳ L' + lv + (apprName ? ' ' + apprName : '') + '</small>';
  }
  for (var i = 0; i < emps.length; i++) {
    var e = emps[i];
    var nameEsc = esc(e.name), deptEsc = esc(e.department||''), roleEsc = esc(e.role||'員工');
    rows += '<tr>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'name\',\''+nameEsc+'\')">'+h(e.name)+'</span></td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'department\',\''+deptEsc+'\')">'+(e.department||'點此設定')+'</span></td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'role\',\''+roleEsc+'\')">'+(e.role||'員工')+'</span></td>'
	      + '<td><span class="editable" onclick="editField('+e.id+',\'hire_date\',\''+esc(e.hire_date||'')+'\')">'+(e.hire_date||'<span style="color:#999">設定</span>')+'</span></td>'
      + '<td>'+(e.line_user_id?'<span class="badge badge-in">已綁定</span>':'<span class="badge badge-out">未綁定</span>')+'</td>'
      + '<td>'
      + '<button onclick="toggleApprove('+e.id+','+e.can_approve+')" class="btn-sm '+(e.can_approve?'btn':'btn-gray')+'">'+(e.can_approve?'可簽核':'設為簽核人')+'</button> '
      + (e.can_approve?'<span class="badge badge-in">簽核人</span>':'')
      + '</td>'
      + '<td>'
      + '<button onclick="editLine('+e.id+',\''+nameEsc+'\',\''+esc(e.line_user_id||'')+'\')" class="btn-sm btn-blue">LINE</button> '
      + '<button onclick="removeEmp('+e.id+',\''+nameEsc+'\')" class="btn-sm btn-red">移除</button>'
      + '</td></tr>';
  }

  rows = '';
  for (var i = 0; i < emps.length; i++) {
    var e = emps[i];
    var nameEsc = esc(e.name), deptEsc = esc(e.department||''), roleEsc = esc(e.role||'員工');
    function makeApproverSelect(level, currentVal) {
      var s = '<select onchange="setApprover('+e.id+',this.value,'+level+')" style="width:auto;height:30px;font-size:11px"><option value="">-</option>';
      for (var j = 0; j < approvers.length; j++) {
        if (true) {
          s += '<option value="'+approvers[j].id+'"'+(currentVal==approvers[j].id?' selected':'')+'>'+h(approvers[j].name)+'</option>';
        }
      }
      s += '</select>';
      return s;
    }
    var appSel1 = makeApproverSelect(1, e.approver_id);
    var appSel2 = makeApproverSelect(2, e.approver2_id);
    
    rows += '<tr>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'name\',\''+nameEsc+'\')">'+h(e.name)+'</span></td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'department\',\''+deptEsc+'\')">'+(e.department||'點此設定')+'</span></td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'role\',\''+roleEsc+'\')">'+(e.role||'員工')+'</span></td>'
	      + '<td><span class="editable" onclick="editField('+e.id+',\'hire_date\',\''+esc(e.hire_date||'')+'\')">'+(e.hire_date||'<span style="color:#999">設定</span>')+'</span></td>'
      + '<td>'+(e.line_user_id?'<span class="badge badge-in">已綁定</span>':'<span class="badge badge-out">未綁定</span>')+'</td>'
      + '<td><button onclick="toggleApprove('+e.id+','+e.can_approve+')" class="btn-sm '+(e.can_approve?'btn':'btn-gray')+'">'+(e.can_approve?'可簽核':'設為簽核人')+'</button></td>'
      + '<td>'+appSel1+'</td>'
      + '<td>'+appSel2+'</td>'
      
      + '<td>'
      + '<button onclick="editLine('+e.id+',\''+nameEsc+'\',\''+esc(e.line_user_id||'')+'\')" class="btn-sm btn-blue">LINE</button> '
	      + (e.role==='經理'?'<button onclick="toggleManagerMode('+e.id+','+esc(e.manager_mode||'normal')+')" class="btn-sm '+(e.manager_mode==='test'?'btn':'btn-gray')+'">'+(e.manager_mode==='test'?'🔬 正常':'測試')+'</button> ':'')
      + '<button onclick="removeEmp('+e.id+',\''+nameEsc+'\')" class="btn-sm btn-red">移除</button>'
      + '</td></tr>';
  }

  var body = '<div class="card"><h3>➕ 新增員工</h3>'
    + '<form id="empForm" class="inline">'
    + '<div><label>員工編號</label><input id="no" required></div>'
    + '<div><label>姓名</label><input id="ename" required></div>'
    + '<div><label>部門</label><input id="dept"></div>'
    + '<div><label>入職日</label><input id="hireDate" type="date"></div>'
	    + '<div><label>角色</label><select id="role"><option value="員工">一般員工</option><option value="簽核人員">簽核人員</option><option value="經理">經理</option><option value="老闆">老闆</option></select></div>'
    + '<div style="align-items:center;flex-direction:row;gap:6px"><input type="checkbox" id="canApprove" style="width:16px;height:16px"><label for="canApprove" style="margin:0">簽核人</label></div>'
    + '<button type="submit" class="btn">新增</button></form></div>'
    + '<div class="card"><h3>👥 在職員工</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>角色</th><th>入職日</th><th>LINE</th><th>簽核</th><th>L1簽核</th><th>L2簽核</th><th>操作</th></tr>'+(rows||'<tr><td colspan="10">尚無員工</td></tr>')+'</table></div>'
    + inactiveList
    + modalHtml();

  body += '<script>'+jsLib()+'\ndocument.getElementById("empForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/employees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employee_no:document.getElementById("no").value,name:document.getElementById("ename").value,department:document.getElementById("dept").value,role:document.getElementById("role").value||"員工",can_approve:document.getElementById("canApprove").checked,hire_date:document.getElementById("hireDate").value})});var j=await r.json();j.success?location.reload():alert(j.error);};</script>';
  res.send(layout('員工管理', '員工管理', body));
});

// ===== 假期設定 =====
router.get('/leave-balances', auth, async (req, res) => {
  var emps = await db.listActiveEmployees();
  var rows = '';
  for (var i = 0; i < emps.length; i++) {
    var e = emps[i];
    var nameEsc = esc(e.name);
    // 查詢各項額度餘額
    var _al = { entitlement_days: 0, used_hours: 0, remaining_hours: 0 };
    var _ml = { total_hours: 0, used_hours: 0, remaining_hours: 0 };
    var _fl = { total_hours: 0, used_hours: 0, remaining_hours: 0 };
    try { _al = await db.getAnnualLeaveBalance(e.id); } catch(ex) {}
    try { _ml = await db.getMarriageLeaveBalance(e.id); } catch(ex) {}
    try { _fl = await db.getFuneralLeaveBalance(e.id); } catch(ex) {}
    var _cl = { total_hours: 0, used_hours: 0, remaining_hours: 0 };
    try { _cl = await db.getCompLeaveBalance(e.id); } catch(ex) {}
    // 年度事假/病假累計
    var _personalYTD = 0, _sickYTD = 0;
    try {
      var _leaves = await db.getEmployeeLeaveRequests(e.id, 'approved', 200);
      var _ys = new Date().getFullYear() + '-01-01';
      for (var _li = 0; _li < _leaves.length; _li++) {
        var _lv = _leaves[_li];
        if (_lv.start_date < _ys) continue;
        var _h = await db.calcPeriodHours(_lv.start_date, _lv.end_date);
        if (_lv.leave_type === 'personal') _personalYTD += _h;
        else if (_lv.leave_type === 'sick') _sickYTD += _h;
      }
    } catch(ex) {}
    rows += '<tr>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td>'+h(e.name)+'</td>'
      + '<td>'+h(e.department||'')+'</td>'
      + '<td>'+(e.hire_date||'<span style="color:#999">未設定</span>')+'</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'annual_leave_used_manual\',\''+esc(e.annual_leave_used_manual||'0')+'\')">'+(e.annual_leave_used_manual||'0')+'</span></td>'
      + '<td>' + _al.remaining_hours + 'h</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'marriage_leave_total\',\''+esc(e.marriage_leave_total||'0')+'\')">'+(e.marriage_leave_total||'0')+'</span></td>'
      + '<td>' + _ml.remaining_hours + 'h</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'funeral_leave_total\',\''+esc(e.funeral_leave_total||'0')+'\')">'+(e.funeral_leave_total||'0')+'</span></td>'
      + '<td>' + _fl.remaining_hours + 'h</td>'
	      + '<td><span class="editable" onclick="editField('+e.id+',\'comp_leave_total\',\''+esc(e.comp_leave_total||'0')+'\')">'+(e.comp_leave_total||'0')+'</span></td>'
	      + '<td>' + (_cl ? _cl.remaining_hours : 0) + 'h</td>'
      + '<td>' + _personalYTD + 'h</td>'
      + '<td>' + _sickYTD + 'h</td>'
      + '</tr>';
  }
  var body = '<div class="card"><h3>🎯 假期額度設定</h3><p style="color:#666;font-size:13px;margin-bottom:16px">可針對各員工設定特休手動補登時數、婚假總額度、喪假總額度。點擊數值直接編輯。剩餘時數由系統自動計算。</p>'
    + '<table><tr><th>編號</th><th>姓名</th><th>部門</th><th>入職日</th><th>特休已用(h)<br><small>手動補登</small></th><th>特休剩餘</th><th>婚假總額(h)</th><th>婚假剩餘</th><th>喪假總額(h)</th><th>喪假剩餘</th><th>補休總額(h)</th><th>補休剩餘</th><th>本年度<br>事假(h)</th><th>本年度<br>病假(h)</th></tr>'
    + (rows||'<tr><td colspan="14">尚無員工</td></tr>')
    + '</table></div>'
    + '<div class="card"><h3>📖 說明</h3><ul style="font-size:13px;color:#666;line-height:2">'
    + '<li>特休：依入職日與勞基法年資自動計算額度。手動補登僅用於系統上線前已使用的時數。</li>'
    + '<li>婚假/喪假：管理員設定總額度，員工於 LINE 申請時自動扣減剩餘。</li>'
    + '<li>本年度事假/病假為當年度已核准的累計時數（僅供參考，不影響額度）。</li>'
    + '</ul></div>';
	  + modalHtml();
  body += '<script>'+jsLib()+'</script>';
  res.send(layout('假期設定', '假期設定', body));
});

// ===== 請假管理 =====
router.get('/leaves', auth, async (req, res) => {
  var status = req.query.status || '';
  var filterEid = req.query.eid ? parseInt(req.query.eid) : null;
  var leaves = await db.getLeaveRequests(status, 200);
  var emps = await db.listActiveEmployees();
  var now = new Date();
  var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  var rows = '';
  var empMap = {};
  for (var ei = 0; ei < emps.length; ei++) empMap[emps[ei].id] = emps[ei];
  function getOtApprover(rec) {
    if (rec.status !== 'pending') return '';
    var emp = empMap[rec.employee_id];
    if (!emp) return '';
    var lv = rec.approval_level || 1;
    var col = lv === 1 ? 'approver_id' : 'approver2_id';
    var apprId = emp[col];
    var apprName = apprId && empMap[apprId] ? empMap[apprId].name : '';
    return ' <small style="color:#8e44ad">↳ L' + lv + (apprName ? ' ' + apprName : '') + '</small>';
  }
  var companyMonth = 0, companyTotal = 0;
  // 個人時數彙整
  var personMap = {};
  function calcLeaveHours(startStr, endStr) {
    if (!startStr) return 0;
    var s2 = new Date(startStr), e2 = new Date(endStr||startStr);
    var diff = e2 - s2;
    if (diff <= 0) return 1;
    var raw = Math.ceil(diff / 3600000);
    var days = Math.ceil(diff / 86400000);
    var lunch = 0;
    if (days <= 1 && s2.getHours() < 12 && e2.getHours() >= 13) lunch = 1;
    var workHours = raw - lunch;
    if (workHours < 1) workHours = 1;
    return Math.min(workHours, days * 8);
  }
  function sd(d) { return typeof d === 'string' ? d : (d ? d.toISOString().split('T')[0] : ''); }
  var empMap = {};  // employee_id -> { approver fields }
  for (var ei = 0; ei < emps.length; ei++) empMap[emps[ei].id] = emps[ei];
  function getCurrentApprover(leave) {
    if (leave.status !== 'pending') return '';
    var emp = empMap[leave.employee_id];
    if (!emp) return '';
    var lv = leave.approval_level || 1;
    var col = lv === 1 ? 'approver_id' : 'approver2_id';
    var apprId = emp[col];
    var apprName = apprId && empMap[apprId] ? empMap[apprId].name : '';
    return ' <small style="color:#8e44ad">↳ L' + lv + (apprName ? ' ' + apprName : '') + '</small>';
  }
  for (var i = 0; i < leaves.length; i++) {
    var l = leaves[i];
    if (filterEid && l.employee_id !== filterEid) continue;
    var statusBadge = l.status === 'pending' ? '<span class="badge badge-warn">待審核</span>' + getCurrentApprover(l)
      : l.status === 'approved' ? '<span class="badge badge-in">已核准</span>'
      : '<span class="badge badge-out">已駁回</span>';
    var actionHtml = '';
    var cb = l.status === 'pending' ? '<input type="checkbox" class="leaveCb" value="'+l.id+'" style="width:auto;height:auto">' : '';
    if (l.status === 'pending') {
      actionHtml = '<button onclick="approveLeave('+l.id+')" class="btn-sm btn">核准</button> <button onclick="rejectLeave('+l.id+')" class="btn-sm btn-red">駁回</button>';
    }
    actionHtml += ' <button onclick="deleteLeave('+l.id+')" class="btn-sm btn-red" title="刪除">🗑</button>';
    var startStr = sd(l.start_date);
    var endStr = sd(l.end_date);
    var leaveTime = startStr;
    if (endStr) leaveTime += ' ~ ' + endStr;
    var hours = calcLeaveHours(startStr, endStr);
    if (l.status === 'approved') {
      companyTotal += hours;
      if (startStr && startStr.indexOf(thisMonth) === 0) companyMonth += hours;
      // 個人累計
      if (!personMap[l.employee_no]) personMap[l.employee_no] = { name: l.name, month: 0, total: 0 };
      personMap[l.employee_no].total += hours;
      if (startStr && startStr.indexOf(thisMonth) === 0) personMap[l.employee_no].month += hours;
    }
    rows += '<tr><td>'+cb+'</td><td>'+h(l.employee_no)+'</td><td>'+h(l.name)+'</td><td>'+h(l.department||'')+'</td><td>'+h(l.leave_type)+'</td><td>'+leaveTime+'</td><td>'+hours+'h</td><td>'+h(l.reason||'')+'</td><td>'+statusBadge+(l.reject_reason?'<br><small style="color:#e74c3c">駁回：'+h(l.reject_reason)+'</small>':'')+'</td><td>'+actionHtml+'</td></tr>';
  }
  // 個人彙總表格
  var personRows = '';
  var personKeys = Object.keys(personMap);
  if (personKeys.length > 0) {
    for (var k = 0; k < personKeys.length; k++) {
      var p = personMap[personKeys[k]];
      personRows += '<tr><td>'+h(personKeys[k])+'</td><td>'+h(p.name)+'</td><td style="font-weight:600">'+p.month+'h</td><td>'+p.total+'h</td></tr>';
    }
  }
  var personSummary = '<div class="card"><h3>👤 個人時數統計（已核准）</h3><table><tr><th>編號</th><th>姓名</th><th>本月</th><th>累計</th></tr>'+(personRows||'<tr><td colspan="4">無請假記錄</td></tr>')+'</table></div>';
  // 員工篩選
  var opts = '<option value="">全部員工</option>';
  for (var j = 0; j < emps.length; j++) opts += '<option value="'+emps[j].id+'"'+(filterEid===emps[j].id?' selected':'')+'>'+h(emps[j].employee_no)+' '+h(emps[j].name)+'</option>';
  var filterBar = '<div class="card"><form class="inline" method="GET"><div><label>員工篩選</label><select name="eid">'+opts+'</select></div><div><label>狀態</label><select name="status"><option value=""'+(status===''?' selected':'')+'>全部</option><option value="pending"'+(status==='pending'?' selected':'')+'>待審核</option><option value="approved"'+(status==='approved'?' selected':'')+'>已核准</option><option value="rejected"'+(status==='rejected'?' selected':'')+'>已駁回</option></select></div><button class="btn">篩選</button></form></div>';
  var body = filterBar + '<div class="card" style="display:flex;gap:16px;padding:16px"><button onclick="clearLeaves()" class="btn-sm btn-red" style="margin-right:12px">🗑 清除所有請假</button><div><span style="font-size:24px;font-weight:700">'+companyMonth+'h</span><br><span style="color:#999;font-size:12px">全公司本月</span></div><div><span style="font-size:24px;font-weight:700">'+companyTotal+'h</span><br><span style="color:#999;font-size:12px">全公司累計</span></div></div>' + personSummary
    + '<div class="tabs">'
    + '<a href="?status=" class="'+(status===''?'active':'')+'">全部</a>'
    + '<a href="?status=pending" class="'+(status==='pending'?'active':'')+'">⏳ 待審核</a>'
    + '<a href="?status=approved" class="'+(status==='approved'?'active':'')+'">✅ 已核准</a>'
    + '<a href="?status=rejected" class="'+(status==='rejected'?'active':'')+'">❌ 已駁回</a>'
    + '</div>'
    + '<div style="margin-bottom:8px"><button onclick="batchAction(\"leave\",\"approved\")" class="btn-sm btn">✅ 批次核准</button> <button onclick="batchAction(\"leave\",\"rejected\")" class="btn-sm btn-red">❌ 批次駁回</button></div>'
    + '<div class="card"><table><tr><th><input type="checkbox" onclick="toggleAll(\"leaveCb\")" style="width:auto;height:auto"></th><th>編號</th><th>姓名</th><th>部門</th><th>假別</th><th>日期時間</th><th>時數</th><th>原因</th><th>狀態</th><th>操作</th></tr>'+(rows||'<tr><td colspan="10">無請假記錄</td></tr>')+'</table></div>'
    + '<script>async function approveLeave(id){await fetch("/admin/api/leaves/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectLeave(id){var reason=prompt("請輸入駁回原因：");if(reason===null)return;await fetch("/admin/api/leaves/"+id+"/reject",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason})});location.reload();}async function clearLeaves(){if(!confirm("⚠️ 確定刪除所有請假記錄？"))return;await fetch("/admin/api/leaves/clear",{method:"DELETE"});location.reload();}async function deleteLeave(id){if(!confirm("確定刪除此筆請假？"))return;await fetch("/admin/api/leaves/"+id,{method:"DELETE"});location.reload();}'
    + 'function toggleAll(cls){var cbs=document.querySelectorAll("."+cls);for(var i=0;i<cbs.length;i++)cbs[i].checked=event.target.checked;}'
    + 'async function batchAction(type,action){var cbs=document.querySelectorAll(".leaveCb:checked");var ids=[];for(var i=0;i<cbs.length;i++)ids.push(parseInt(cbs[i].value));if(ids.length===0){alert("請勾選項目");return;}if(!confirm("確定"+ (action==="approved"?"核准":"駁回") +" "+ids.length+" 筆？"))return;await fetch("/admin/api/"+type+"s/batch",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids,action:action})});location.reload();}</script>';
  res.send(layout('請假管理', '請假管理', body));
});

router.put('/api/leaves/:id/approve', auth, async (req, res) => {
  var leave = await db.getLeaveById(parseInt(req.params.id));
  if (!leave) return res.status(404).json({ error: '找不到' });
  await db.updateLeaveStatus(leave.id, 'approved', null);
  var le = await db.getEmployeeById(leave.employee_id);
  if (le && le.line_user_id) await db.ahdPendingNotification(le.id, '🎉 請假已核准！' + (leave.start_date ? ' ' + leave.start_date.substring(0,10) : ''));
  res.json({ success: true });
});
router.put('/api/leaves/:id/reject', auth, express.json(), async (req, res) => {
  var leave = await db.getLeaveById(parseInt(req.params.id));
  if (!leave) return res.status(404).json({ error: '找不到' });
  await db.updateLeaveStatus(leave.id, 'rejected', null, req.body.reason || '');
  res.json({ success: true });
});
router.put('/api/leaves/batch', auth, express.json(), async (req, res) => {
  var ids = req.body.ids || [];
  var action = req.body.action;
  for (var i = 0; i < ids.length; i++) {
    await db.updateLeaveStatus(ids[i], action, null);
    if (action === 'approved') {
      var l = await db.getLeaveById(ids[i]);
      var le = l ? await db.getEmployeeById(l.employee_id) : null;
      if (le && le.line_user_id) await db.ahdPendingNotification(le.id, '🎉 請假已核准！' + (l.start_date ? ' ' + l.start_date.substring(0,10) : ''));
    }
  }
  res.json({ success: true, count: ids.length });
});
router.put('/api/overtime/batch', auth, express.json(), async (req, res) => {
  var ids = req.body.ids || [];
  var action = req.body.action;
  for (var i = 0; i < ids.length; i++) {
    await db.updateOvertimeStatus(ids[i], action, null);
    if (action === 'approved') {
      var ot = await db.getOvertimeById(ids[i]);
      var oe = ot ? await db.getEmployeeById(ot.employee_id) : null;
      if (oe && oe.line_user_id) await db.ahdPendingNotification(oe.id, '🎉 加班已核准！' + (ot.start_time ? ' ' + ot.start_time.substring(0,10) : ''));
    }
  }
  res.json({ success: true, count: ids.length });
});
router.delete('/api/leaves/clear', auth, async (_, res) => {
  await db.clearAll('leave_requests'); res.json({ success: true });
});
router.delete('/api/leaves/:id', auth, async (req, res) => {
  await db.deleteLeaveRequest(parseInt(req.params.id)); res.json({ success: true });
});
router.delete('/api/overtime/clear', auth, async (_, res) => {
  await db.clearAll('overtime_requests'); res.json({ success: true });
});
router.delete('/api/overtime/:id', auth, async (req, res) => {
  await db.deleteOvertimeRequest(parseInt(req.params.id)); res.json({ success: true });
});
router.delete('/api/checkins/clear', auth, async (_, res) => {
  await db.clearAll('checkins'); res.json({ success: true });
});
router.delete('/api/checkins/:id', auth, async (req, res) => {
  try {
    await db.deleteCheckin(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// 修改打卡時間
router.put('/api/checkins/:id', auth, express.json(), async (req, res) => {
  try {
    var newTime = req.body.time; // HH:MM
    if (!newTime || !/^\d{2}:\d{2}$/.test(newTime)) {
      return res.status(400).json({ error: '時間格式錯誤，需為 HH:MM' });
    }
    await db.updateCheckinTime(parseInt(req.params.id), newTime);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 清除指定區間紀錄 =====
router.delete('/api/cleanup/:table', auth, express.json(), async function (req, res) {
  var table = req.params.table;
  var startDate = req.body.start || '';
  var endDate = req.body.end || '';
  var allowed = ['leave_requests', 'overtime_requests', 'checkins', 'missed_punch'];
  if (allowed.indexOf(table) === -1) return res.status(400).json({ error: '無效的資料表' });
  if (!startDate) return res.status(400).json({ error: '請選擇開始日期' });
  try {
    var count = await db.clearByDateRange(table, startDate, endDate || null);
    res.json({ success: true, count: count });
  } catch (e) {
    console.error('[cleanup] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});



// ===== 系統設定 =====
router.get('/settings', auth, async (_, res) => {
  var officeLat = await db.getSetting('office_lat') || '';
  var officeLng = await db.getSetting('office_lng') || '';
  var gpsRange = await db.getSetting('gps_range_meters') || '200';
  var workStart = await db.getSetting('work_start_hour') || '8';
  var workEnd = await db.getSetting('work_end_hour') || '17';
  var lateBuf = await db.getSetting('late_buffer_minutes') || '30';
  var reportGroupId = await db.getSetting('report_group_id') || '';
  var reportTime = await db.getSetting('report_time') || '17:00';
  var reportEnabled = await db.getSetting('report_enabled') || '';
  var reportDays = await db.getSetting('report_days') || '1,2,3,4,5';
  var reportNoDup = await db.getSetting('report_no_dup') || 'true';
  var reportAsImage = await db.getSetting('report_as_image') || '';
  var reportDaysArr = reportDays.split(',');
  var dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  var twHolidays = await db.getSetting('tw_holidays') || '[]';

  var body = '<div class="card"><h3>⏰ 上下班時間</h3>'
    + '<p style="color:#999;font-size:13px;margin-bottom:12px">目前：彈性上班 '+workStart+':00 ~ '+(parseInt(workStart)+Math.ceil(parseInt(lateBuf)/60))+':'+String(parseInt(lateBuf)%60).padStart(2,'0')+'，下班 '+workEnd+':00 起，需滿 8 小時</p>'
    + '<form id="hourForm" class="inline">'
    + '<div><label>上班最早時間</label><input id="workStart" value="'+workStart+'" style="width:80px"></div>'
    + '<div><label>遲到緩衝（分）</label><input id="lateBuf" value="'+lateBuf+'" style="width:80px"></div>'
    + '<div><label>下班時間</label><input id="workEnd" value="'+workEnd+'" style="width:80px"></div>'
    + '<button class="btn">儲存</button><span id="hourMsg" style="color:#06c755"></span></form></div>'
    + '<div class="card"><h3>📍 GPS 打卡設定</h3>'
    + '<p style="color:#999;font-size:13px;margin-bottom:12px">設定後打卡會計算距離，超出範圍標示警告。💡 <a href="https://maps.google.com" target="_blank">Google Maps</a> → 右鍵點公司位置 → 複製座標</p>'
    + '<form id="gpsForm" class="inline">'
    + '<div><label>緯度</label><input id="lat" value="'+h(officeLat)+'" placeholder="25.033964"></div>'
    + '<div><label>經度</label><input id="lng" value="'+h(officeLng)+'" placeholder="121.564468"></div>'
    + '<div><label>允許半徑（公尺）</label><input id="range" value="'+h(gpsRange)+'" placeholder="200" style="width:100px"></div>'
    + '<button class="btn">儲存</button><span id="gpsMsg" style="color:#06c755"></span></form></div>'
    + '<div class="card"><h3>📊 每日出勤報表</h3>'
    + '<p style="color:#999;font-size:13px;margin-bottom:12px">每天固定時間自動推播出勤彙總到 LINE 群組。</p>'
    + '<form id="reportForm" class="inline">'
    + '<div style="flex-direction:row;align-items:center;gap:6px;margin-right:16px"><input type="checkbox" id="rptEnabled" '+(reportEnabled==='true'||reportEnabled==='1'?'checked':'')+' style="width:16px;height:16px"><label for="rptEnabled" style="margin:0">啟用每日推播</label></div>'
    + '<div style="flex-direction:row;align-items:center;gap:6px;margin-right:16px"><input type="checkbox" id="rptNoDup" '+(reportNoDup==='true'||reportNoDup==='1'?'checked':'')+' style="width:16px;height:16px"><label for="rptNoDup" style="margin:0" title="開啟後同一天只會發送一次，避免重複推播">同日不重複發送</label></div><div style="flex-direction:row;align-items:center;gap:6px;margin-right:16px"><input type="checkbox" id="rptAsImage" '+(reportAsImage==='true'||reportAsImage==='1'?'checked':'')+' style="width:16px;height:16px"><label for="rptAsImage" style="margin:0">圖片版日報（取代文字）</label></div>'
    + '<div><label>LINE 群組 ID</label><input id="groupId" value="'+h(reportGroupId)+'" placeholder="加入群組後自動取得" style="width:260px;font-size:12px"></div>'
    + '<div><label>推播時間</label><input id="rptTime" value="'+h(reportTime)+'" placeholder="17:00" style="width:70px"></div>'
    + '<button class="btn">儲存</button>'
    + '<a href="/admin/trigger-report" class="btn btn-outline" style="margin-left:8px">🧪 測試推播</a>'
    + '<span id="rptMsg" style="color:#06c755"></span>'
    + '</form>'
    + '<div style="margin-top:12px;display:flex;gap:8px;align-items:center">'
    + '<span style="font-size:13px;color:#666;font-weight:600">推播日：</span>';
  for (var d = 0; d < 7; d++) {
    var checked = reportDaysArr.indexOf(String(d)) !== -1 ? ' checked' : '';
    body += '<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer"><input type="checkbox" class="rptDay" value="'+d+'"'+checked+' style="width:auto;margin:0"> 週'+dayNames[d]+'</label>';
  }
  body += '</div></div>'
    + '<div class="card"><h3>🇹🇼 國定假日</h3>'
    + '<p style="color:#999;font-size:13px;margin-bottom:12px">假日上班打卡不計遲到。選擇日期加入列表。</p>'
    + '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">'
    + '<input type="date" id="holidayDate" style="width:200px">'
    + '<button type="button" id="addHolidayBtn" class="btn">➕ 加入</button>'
    + '<button type="button" id="saveHolidayBtn" class="btn" style="background:#06c755">💾 儲存</button>'
    + '<span id="holidayMsg" style="color:#06c755;font-size:13px"></span>'
    + '</div>'
    + '<div id="holidayList" style="display:flex;flex-wrap:wrap;gap:8px"></div>'
    + '<input type="hidden" id="twHolidays" value="' + h(twHolidays) + '">'
    + '</div>'
    + '<script>'
    + 'document.getElementById("hourForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({work_start_hour:document.getElementById("workStart").value,work_end_hour:document.getElementById("workEnd").value,late_buffer_minutes:document.getElementById("lateBuf").value})});if(r.ok)document.getElementById("hourMsg").textContent="✅已儲存";};'
    + 'document.getElementById("gpsForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({office_lat:document.getElementById("lat").value,office_lng:document.getElementById("lng").value,gps_range_meters:document.getElementById("range").value})});if(r.ok)document.getElementById("gpsMsg").textContent="✅已儲存";};'
    + 'document.getElementById("reportForm").onsubmit=async function(e){e.preventDefault();var days=[];var cbs=document.querySelectorAll(".rptDay:checked");for(var i=0;i<cbs.length;i++)days.push(cbs[i].value);var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({report_group_id:document.getElementById("groupId").value,report_time:document.getElementById("rptTime").value,report_enabled:document.getElementById("rptEnabled").checked?"true":"false",report_days:days.join(","),report_no_dup:document.getElementById("rptNoDup").checked?"true":"false",report_as_image:document.getElementById("rptAsImage").checked?"true":"false"})});if(r.ok)document.getElementById("rptMsg").textContent="✅已儲存 重新整理後生效";};'
    + 'var holidayDates=[];try{holidayDates=JSON.parse(document.getElementById("twHolidays").value)||[];}catch(e){holidayDates=[];}'
    + 'function renderHolidays(){var list=document.getElementById("holidayList");list.innerHTML="";for(var i=0;i<holidayDates.length;i++){var d=holidayDates[i];var tag=document.createElement("span");tag.style.cssText="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#e6f9ee;border:1px solid #06c755;border-radius:16px;font-size:13px";tag.innerHTML=d+\' <a href="#" onclick="removeHoliday(\'+i+\');return false" style="color:#e74c3c;text-decoration:none;font-weight:bold;font-size:16px;line-height:1" title="移除">&times;</a>\';list.appendChild(tag);}}'
    + 'function removeHoliday(idx){holidayDates.splice(idx,1);document.getElementById("twHolidays").value=JSON.stringify(holidayDates);renderHolidays();document.getElementById("holidayMsg").textContent="";}'
    + 'document.getElementById("addHolidayBtn").onclick=function(){var d=document.getElementById("holidayDate").value;if(!d){alert("請選擇日期");return;}if(holidayDates.indexOf(d)!==-1){alert("日期已存在");return;}holidayDates.push(d);holidayDates.sort();document.getElementById("twHolidays").value=JSON.stringify(holidayDates);renderHolidays();document.getElementById("holidayMsg").textContent="✅ 已加入（尚未儲存）";};'
    + 'document.getElementById("saveHolidayBtn").onclick=async function(){var val=JSON.stringify(holidayDates);var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tw_holidays:val})});if(r.ok)document.getElementById("holidayMsg").textContent="✅ 已儲存";else document.getElementById("holidayMsg").textContent="❌ 儲存失敗";};'
    + 'renderHolidays();'
    + '</script>';
  res.send(layout('系統設定', '系統設定', body));
});

// ===== API =====
router.post('/api/employees', auth, express.json(), async (req, res) => {
  var b = req.body;
  if (!b.employee_no || !b.name) return res.status(400).json({ error: '必填' });
  var r = await db.createEmployee(b.employee_no, b.name, b.department, b.role, b.can_approve, b.hire_date);
  r.success ? res.json(r) : res.status(400).json(r);
});
router.put('/api/employees/:id', auth, express.json(), async (req, res) => {
  await db.updateEmployee(parseInt(req.params.id), req.body); res.json({ success: true });
});
router.put('/api/employees/:id/lineid', auth, express.json(), async (req, res) => {
  var ok = await db.updateLineUserId(parseInt(req.params.id), req.body.line_user_id || null);
  ok ? res.json({ success: true }) : res.status(400).json({ error: 'LINE ID 已被使用' });
});
router.put('/api/employees/:id/deactivate', auth, async (req, res) => {
  await db.deactivateEmployee(parseInt(req.params.id)); res.json({ success: true });
});
router.put('/api/employees/:id/reactivate', auth, async (req, res) => {
  await db.reactivateEmployee(parseInt(req.params.id)); res.json({ success: true });
});
router.delete('/api/employees/:id/hard', auth, async (req, res) => {
  await db.hardDeleteEmployee(parseInt(req.params.id)); res.json({ success: true });
});
router.put('/api/employees/:id/approver', auth, express.json(), async (req, res) => {
  await db.setApprover(parseInt(req.params.id), req.body.approver_id || null, req.body.level || 1); res.json({ success: true });
});
router.get('/trigger-report', auth, async (req, res) => {
  try {
    var report = require('./report');
    var client = req.app.locals.lineClient;
    await report.sendDailyReport(client);
    res.send('<h3>✅ 推播完成</h3><p>請到 LINE 群組查看是否收到報表。</p><a href="/admin/settings">返回設定</a>');
  } catch(e) {
    res.send('錯誤：'+e.message+'<br><a href="/admin/settings">返回設定</a>');
  }
});

router.post('/api/settings', auth, express.json(), async (req, res) => {
  for (var k in req.body) await db.setSetting(k, req.body[k]);
  res.json({ success: true });
});

// ===== 輔助 =====
function h(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function esc(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function fmt(ts) { var d = new Date(ts); return d.getFullYear()+' '+(d.getMonth()+1)+'月'+d.getDate()+'日 '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function dateOverlaps(startStr, endStr, targetDate) {
  if (!startStr) return false;
  var s = startStr.length >= 10 ? startStr.substring(0, 10) : startStr;
  var e = endStr || s;
  if (e.length >= 10) e = e.substring(0, 10);
  return s <= targetDate && e >= targetDate;
}
function modalHtml() {
  return '<div id="modal" class="modal"><div><h3>綁定 LINE ID</h3><p id="modalEmp" style="color:#999;margin-bottom:12px"></p><label>LINE User ID</label><input id="lineIdInput" placeholder="貼上員工的 LINE User ID"><p style="color:#999;font-size:12px;margin:8px 0">💡 員工在 LINE Bot 輸入「我的ID」取得</p><div class="actions"><button onclick="closeModal()" class="btn-sm btn-gray">取消</button><button onclick="saveLine()" class="btn-sm btn">儲存</button></div></div></div>';
}
function jsLib() {
  return 'var editId=null;'
    + 'function editLine(id,name,currentId){editId=id;document.getElementById("modalEmp").textContent="員工："+name;document.getElementById("lineIdInput").value=currentId||"";document.getElementById("modal").style.display="flex";}'
    + 'function closeModal(){document.getElementById("modal").style.display="none";}'
    + 'async function saveLine(){var val=document.getElementById("lineIdInput").value.trim();var r=await fetch("/admin/api/employees/"+editId+"/lineid",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({line_user_id:val})});if(r.ok)location.reload();else alert("儲存失敗");}'
    + 'async function toggleApprove(id,current){await fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({can_approve:!current})});location.reload();}'
    + 'function toggleManagerMode(id,currentMode){var newMode=currentMode==="test"?"normal":"test";fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({manager_mode:newMode})}).then(function(r){return r.json();}).then(function(j){if(j.success)location.reload();else alert("失敗");}).catch(function(){alert("失敗");});}'
    + 'async function editField(id,field,current){if(field==="role"){var roles=["員工","簽核人員","經理","老闆"];var opts=roles.map(function(r){return"<option value=\\""+r+"\\""+(r===current?" selected":"")+">"+(r==="員工"?"一般員工":r)+"</option>";}).join("");var sel=prompt("修改角色\\n\\n1. 一般員工\\n2. 簽核人員\\n3. 經理\\n4. 老闆\\n\\n請輸入 1-4 或角色名稱：",current);if(sel===null)return;var val=sel;if(sel==="1")val="員工";else if(sel==="2")val="簽核人員";else if(sel==="3")val="經理";else if(sel==="4")val="老闆";var body={};body[field]=val;await fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});location.reload();}else{var val=prompt("修改 "+field,current);if(val===null)return;var body={};body[field]=val;await fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});location.reload();}}'
    + 'async function setApprover(id,approverId,level){await fetch("/admin/api/employees/"+id+"/approver",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({approver_id:approverId||null,level:level||1})});}'
    + 'async function removeEmp(id,name){if(!confirm("確定移除 "+name+"？\\n打卡和請假記錄會保留。"))return;var r=await fetch("/admin/api/employees/"+id+"/deactivate",{method:"PUT"});if(r.ok)location.reload();else alert("操作失敗");}'
    + 'async function reactivateEmp(id,name){if(!confirm("確定復原 "+name+"？"))return;var r=await fetch("/admin/api/employees/"+id+"/reactivate",{method:"PUT"});if(r.ok)location.reload();else alert("操作失敗");}'
    + 'async function hardDeleteEmp(id,name){if(!confirm("⚠️ 永久刪除 "+name+"？\\n\\n打卡和請假記錄會保留（匿名化）。\\n此操作無法復原！"))return;var r=await fetch("/admin/api/employees/"+id+"/hard",{method:"DELETE"});if(r.ok)location.reload();else alert("操作失敗");}';
}

// ===== 補打卡管理 =====
router.get('/missed', auth, async function(_, res) {
  var status = _.query.status || '';
  var records = await db.getMissedPunches(status, 200);
  var emps = await db.listActiveEmployees();
  var rows = '';
  var empMap = {};
  for (var ei = 0; ei < emps.length; ei++) empMap[emps[ei].id] = emps[ei];
  function getMpApprover(rec) {
    if (rec.status !== 'pending') return '';
    var emp = empMap[rec.employee_id];
    if (!emp) return '';
    var names = [];
    if (emp.approver_id && empMap[emp.approver_id]) names.push('L1 ' + empMap[emp.approver_id].name);
    if (emp.approver2_id && empMap[emp.approver2_id]) names.push('L2 ' + empMap[emp.approver2_id].name);
    
    if (names.length === 0) return '';
    return ' <small style="color:#8e44ad">↳ ' + names.join(', ') + '</small>';
  }
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var sb = r.status === 'pending' ? '<span class="badge badge-warn">待審核</span>' + getMpApprover(r) : r.status === 'approved' ? '<span class="badge badge-in">已核准</span>' : '<span class="badge badge-out">已駁回</span>';
    var ah = '';
    if (r.status === 'pending') ah = '<button onclick="approveMp('+r.id+')" class="btn-sm btn">核准</button> <button onclick="rejectMp('+r.id+')" class="btn-sm btn-red">駁回</button>';
    rows += '<tr><td>'+h(r.employee_no)+'</td><td>'+h(r.name)+'</td><td>'+(r.punch_type==='check_in'?'🔵補上班':'🔴補下班')+'</td><td>'+h(r.punch_date)+' '+h(r.punch_time)+'</td><td>'+h(r.reason||'')+'</td><td>'+sb+(r.reject_reason?'<br><small style="color:#e74c3c">駁回：'+h(r.reject_reason)+'</small>':'')+'</td><td>'+ah+'</td></tr>';
  }
  var body = '<div class="tabs"><a href="?status=" class="'+(status===''?'active':'')+'">全部</a><a href="?status=pending" class="'+(status==='pending'?'active':'')+'">⏳ 待審核</a><a href="?status=approved" class="'+(status==='approved'?'active':'')+'">✅ 已核准</a></div>';
  body += '<div class="card"><table><tr><th>編號</th><th>姓名</th><th>類型</th><th>時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>'+(rows||'<tr><td colspan="7">無補打卡記錄</td></tr>')+'</table></div>';
  body += '<script>async function approveMp(id){await fetch("/admin/api/missed/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectMp(id){var reason=prompt("請輸入駁回原因：");if(reason===null)return;await fetch("/admin/api/missed/"+id+"/reject",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason})});location.reload();}</script>';
  res.send(layout('補打卡管理', '補打卡', body));
});
router.put('/api/missed/:id/approve', auth, async function(req, res) {
  await db.updateMissedPunchStatus(parseInt(req.params.id), 'approved', null);
  var mp = await db.getMissedPunchById(parseInt(req.params.id));
  var me = mp ? await db.getEmployeeById(mp.employee_id) : null;
  if (me && me.line_user_id) await db.ahdPendingNotification(me.id, '🎉 補打卡已核准！' + (mp.punch_date ? ' ' + mp.punch_date : ''));
  res.json({ success: true });
});
router.put('/api/missed/:id/reject', auth, express.json(), async function(req, res) { await db.updateMissedPunchStatus(parseInt(req.params.id), 'rejected', null, req.body.reason || ''); res.json({ success: true }); });

// ===== 加班管理 =====
router.get('/overtime', auth, async function(_, res) {
  var status = _.query.status || '';
  var filterEid = _.query.eid ? parseInt(_.query.eid) : null;
  var filterMonth = _.query.month || '';
  var records = await db.getOvertimeRequests(status, 200);
  var emps = await db.listActiveEmployees();
  var rows = '';
  var empMap = {};
  for (var ei = 0; ei < emps.length; ei++) empMap[emps[ei].id] = emps[ei];
  function getOtApprover(rec) {
    if (rec.status !== 'pending') return '';
    var emp = empMap[rec.employee_id];
    if (!emp) return '';
    var lv = rec.approval_level || 1;
    var col = lv === 1 ? 'approver_id' : 'approver2_id';
    var apprId = emp[col];
    var apprName = apprId && empMap[apprId] ? empMap[apprId].name : '';
    return ' <small style="color:#8e44ad">↳ L' + lv + (apprName ? ' ' + apprName : '') + '</small>';
  }
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    // 員工篩選
    if (filterEid && r.employee_id !== filterEid) continue;
    // 月份篩選
    if (filterMonth) {
      var sd = typeof r.start_time === 'string' ? r.start_time : '';
      if (sd.indexOf(filterMonth) !== 0) continue;
    }
    var sb = r.status === 'pending' ? '<span class="badge badge-warn">待審核</span>' + getOtApprover(r) : r.status === 'approved' ? '<span class="badge badge-in">已核准</span>' : '<span class="badge badge-out">已駁回</span>';
    var ah = '';
    var otCb = r.status === 'pending' ? '<input type="checkbox" class="otCb" value="'+r.id+'" style="width:auto;height:auto">' : '';
    if (r.status === 'pending') ah = '<button onclick="approveOt('+r.id+')" class="btn-sm btn">核准</button> <button onclick="rejectOt('+r.id+')" class="btn-sm btn-red">駁回</button>';
    ah += ' <button onclick="deleteOt('+r.id+')" class="btn-sm btn-red" title="刪除">🗑</button>';
    rows += '<tr><td>'+otCb+'</td><td>'+h(r.employee_no)+'</td><td>'+h(r.name)+'</td><td>'+h(r.department||'')+'</td><td>'+h(r.start_time)+' ~ '+h(r.end_time)+'</td><td>'+h(r.reason||'')+'</td><td>'+sb+(r.reject_reason?'<br><small style="color:#e74c3c">駁回：'+h(r.reject_reason)+'</small>':'')+'</td><td>'+ah+'</td></tr>';
  }
  var opts = '<option value="">全部員工</option>';
  for (var j = 0; j < emps.length; j++) opts += '<option value="'+emps[j].id+'"'+(filterEid===emps[j].id?' selected':'')+'>'+h(emps[j].employee_no)+' '+h(emps[j].name)+'</option>';
  var filterBar = '<div class="card"><form class="inline" method="GET"><div><label>員工</label><select name="eid">'+opts+'</select></div><div><label>狀態</label><select name="status"><option value=""'+(status===''?' selected':'')+'>全部</option><option value="pending"'+(status==='pending'?' selected':'')+'>待審核</option><option value="approved"'+(status==='approved'?' selected':'')+'>已核准</option><option value="rejected"'+(status==='rejected'?' selected':'')+'>已駁回</option></select></div><div><label>月份</label><input name="month" value="'+h(filterMonth)+'" placeholder="2026-06" style="width:120px"></div><button class="btn">🔍 篩選</button></form></div>';
  var body = filterBar
    + '<div style="margin-bottom:8px"><button onclick="batchOt(\"approved\")" class="btn-sm btn">✅ 批次核准</button> <button onclick="batchOt(\"rejected\")" class="btn-sm btn-red">❌ 批次駁回</button></div>'
    + '<div class="card"><table><tr><th><input type="checkbox" onclick="toggleAll(\"otCb\")" style="width:auto;height:auto"></th><th>編號</th><th>姓名</th><th>部門</th><th>時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>'+(rows||'<tr><td colspan="8">無加班記錄</td></tr>')+'</table></div>'
    + '<div style="margin-top:12px"><button onclick="clearOt()" class="btn-sm btn-red">🗑 清除所有加班記錄</button></div><script>async function approveOt(id){await fetch("/admin/api/overtime/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectOt(id){var reason=prompt("請輸入駁回原因：");if(reason===null)return;await fetch("/admin/api/overtime/"+id+"/reject",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason})});location.reload();}async function clearOt(){if(!confirm("⚠️ 確定刪除所有加班記錄？"))return;await fetch("/admin/api/overtime/clear",{method:"DELETE"});location.reload();}async function deleteOt(id){if(!confirm("確定刪除此筆加班？"))return;await fetch("/admin/api/overtime/"+id,{method:"DELETE"});location.reload();}function toggleAll(cls){var cbs=document.querySelectorAll("."+cls);for(var i=0;i<cbs.length;i++)cbs[i].checked=event.target.checked;}async function batchOt(action){var cbs=document.querySelectorAll(".otCb:checked");var ids=[];for(var i=0;i<cbs.length;i++)ids.push(parseInt(cbs[i].value));if(ids.length===0){alert("請勾選項目");return;}if(!confirm("確定"+(action==="approved"?"核准":"駁回")+" "+ids.length+" 筆？"))return;await fetch("/admin/api/overtimes/batch",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids,action:action})});location.reload();}</script>';
  res.send(layout('加班管理', '加班管理', body));
});

router.put('/api/overtime/:id/approve', auth, async function(req, res) {
  await db.updateOvertimeStatus(parseInt(req.params.id), 'approved', null);
  var ot = await db.getOvertimeById(parseInt(req.params.id));
  var oe = ot ? await db.getEmployeeById(ot.employee_id) : null;
  if (oe && oe.line_user_id) await db.ahdPendingNotification(oe.id, '🎉 加班已核准！' + (ot.start_time ? ' ' + ot.start_time.substring(0,10) : ''));
  res.json({ success: true });
});
router.put('/api/overtime/:id/reject', auth, express.json(), async function(req, res) {
  await db.updateOvertimeStatus(parseInt(req.params.id), 'rejected', null, req.body.reason || ''); res.json({ success: true });
});

// ===== 薪資發送 =====
var multer = require('multer');
var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
var salaryImages = {};

router.get('/salary', auth, async function(_, res) {
  var emps = await db.listActiveEmployees();
  var bound = emps.filter(function(e) { return e.line_user_id; });
  var unbound = emps.filter(function(e) { return !e.line_user_id; });
  // 載入已儲存的薪資
  var saved = await db.getSalaryRecords();
  var savedMap = {};
  var monthLabel = '';
  for (var i = 0; i < saved.length; i++) {
    var s = saved[i];
    if (!savedMap[s.employee_id]) savedMap[s.employee_id] = s;
    if (!monthLabel && s.month_label) monthLabel = s.month_label;
  }

  var rows = '';
  var empMap = {};
  for (var ei = 0; ei < emps.length; ei++) empMap[emps[ei].id] = emps[ei];
  function getOtApprover(rec) {
    if (rec.status !== 'pending') return '';
    var emp = empMap[rec.employee_id];
    if (!emp) return '';
    var lv = rec.approval_level || 1;
    var col = lv === 1 ? 'approver_id' : 'approver2_id';
    var apprId = emp[col];
    var apprName = apprId && empMap[apprId] ? empMap[apprId].name : '';
    return ' <small style="color:#8e44ad">↳ L' + lv + (apprName ? ' ' + apprName : '') + '</small>';
  }
  for (var i = 0; i < bound.length; i++) {
    var e = bound[i];
    var sv = savedMap[e.id] || {};
    var content = sv.content || '';
    var hasImg = salaryImages[e.id] ? ' ✅已上傳圖片' : '';
    var nameEsc = esc(e.name);
    rows += '<tr>'
      + '<td>'+(i+1)+'</td>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'name\',\''+nameEsc+'\')">'+h(e.name)+'</span></td>'
      + '<td>'+h(e.department||'')+'</td>'
      + '<td><span class="badge badge-in">已綁定</span></td>'
      + '<td>'
      + '<textarea name="c_'+e.id+'" rows="4" style="width:100%;font-size:13px;font-family:monospace;margin-bottom:4px" placeholder="本薪：30,300\n加班費：5,000\n實發：34,100">'+h(content)+'</textarea>'
      + '<input type="file" name="img_'+e.id+'" accept="image/*" style="width:auto;font-size:12px;padding:4px">'+hasImg
      + '</td></tr>';
  }

  var body = '<div class="card"><h3>💵 輸入薪資內容（已儲存：'+(Object.keys(savedMap).length||0)+' 人，'+h(monthLabel)+'）</h3>'
    + '<p style="color:#999;margin-bottom:16px">填寫後先儲存，再選擇排程發送或立即發送。</p>'
    + '<form id="salaryForm" method="POST" action="/admin/salary/preview" enctype="multipart/form-data">'
    + '<table><tr><th>#</th><th>編號</th><th>姓名</th><th>部門</th><th>LINE</th><th>薪資內容（可上傳圖片）</th></tr>'
    + (rows || '<tr><td colspan="6">無已綁定員工</td></tr>')
    + '</table>'
    + '<div style="margin-top:16px;display:flex;gap:8px;align-items:center">'
    + '<span style="font-size:13px;color:#666;font-weight:600">月份標籤：</span>'
    + '<input name="monthLabel" value="'+h(monthLabel)+'" placeholder="例如：115年6月" style="width:160px">'
    + '<button type="submit" class="btn" style="font-size:16px;padding:12px 32px">💾 儲存並預覽</button>'
    + '</div>'
    + '</form></div>';

  var unboundRows = '';
  for (var j = 0; j < unbound.length; j++) {
    var u = unbound[j];
    unboundRows += '<tr><td>'+h(u.employee_no)+'</td><td>'+h(u.name)+'</td><td>'+h(u.department||'')+'</td><td><span class="badge badge-out">未綁定</span></td></tr>';
  }
  if (unboundRows) {
    body += '<div class="card"><h3>⚠️ 未綁定 LINE 的員工（無法發送）</h3>'
      + '<table><tr><th>編號</th><th>姓名</th><th>部門</th><th>狀態</th></tr>'+unboundRows+'</table></div>';
  }

  res.send(layout('薪資發送', '薪資發送', body));
});

router.post('/salary/preview', auth, upload.any(), async function(req, res) {
  var emps = await db.listActiveEmployees();
  var empMap = {};
  for (var i = 0; i < emps.length; i++) { empMap[emps[i].id] = emps[i]; }

  for (var i = 0; i < (req.files || []).length; i++) {
    var file = req.files[i];
    var match = file.fieldname.match(/^img_(\d+)$/);
    if (match) salaryImages[parseInt(match[1])] = { buffer: file.buffer, mimetype: file.mimetype };
  }

  var data = [];
  for (var key in req.body) {
    if (key.indexOf('c_') === 0) {
      var id = parseInt(key.replace('c_', ''));
      var content = (req.body[key] || '').trim();
      var hasImg = !!salaryImages[id];
      if ((content || hasImg) && empMap[id] && empMap[id].line_user_id) {
                var _llh = ''; if (lateMin > 0) { for (var _li=0;_li<leaves.length;_li++) { var _lv=leaves[_li]; if (_lv.employee_id===r.employee_id && _lv.status==='approved' && dateOverlaps(_lv.start_date,_lv.end_date,r.work_date)) { _llh = _lv.leave_type==='annual'?'特休':_lv.leave_type==='personal'?'事假':_lv.leave_type==='sick'?'病假':_lv.leave_type==='official'?'公假':_lv.leave_type==='outing'?'外出':_lv.leave_type==='marriage'?'婚假':_lv.leave_type==='funeral'?'喪假':_lv.leave_type==='comp'?'補休':_lv.leave_type; break; } } }
data.push({ id: id, emp: empMap[id], content: content, hasImg: hasImg });
      }
    }
  }

  if (data.length === 0) return res.send('<h3>❌ 沒有填寫任何內容</h3><a href="/admin/salary">返回</a>');

  // 儲存到 DB
  var monthLabel = req.body.monthLabel || '';
  await db.deleteSalaryRecords();
  for (var i = 0; i < data.length; i++) {
    await db.saveSalaryRecords([data[i]], monthLabel);
  }

  req.session.salaryData = data;

  var preview = '<div class="card"><h3>📋 發送預覽（共 '+data.length+' 人）</h3>'
    + '<p style="color:#999">月份：'+h(monthLabel||'未設定')+'</p>'
    + '<table><tr><th>#</th><th>編號</th><th>姓名</th><th>文字</th><th>圖片</th></tr>';

  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    preview += '<tr><td>'+(i+1)+'</td><td>'+h(d.emp.employee_no)+'</td><td>'+h(d.emp.name)+'</td>'
      + '<td><pre style="font-size:12px;margin:0;white-space:pre-wrap">'+h(d.content||'(僅圖片)')+'</pre></td>'
      + '<td>'+(d.hasImg?'✅':'—')+'</td></tr>';
  }
  preview += '</table>'
    + '<div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;align-items:end">'
    + '<a href="/admin/salary" class="btn btn-outline">✏️ 返回修改</a>'
    + '<form action="/admin/salary/send" method="POST" style="display:inline-flex;gap:8px;align-items:end">'
    + '<div><label style="font-size:12px">排程發送時間</label><input type="datetime-local" name="scheduled" style="width:220px"></div>'
    + '<button class="btn" style="font-size:16px;padding:12px 24px">⏰ 排程發送</button>'
    + '</form>'
    + '<form action="/admin/salary/send" method="POST" onsubmit="return confirm(\'確定立即發送給 '+data.length+' 位員工？\')"><button class="btn" style="font-size:16px;padding:12px 32px;background:#e74c3c">📨 立即發送</button></form>'
    + '</div></div>';

  res.send(layout('發送預覽', '薪資發送', preview));
});

router.get('/salary/img/:id', function(req, res) {
  var img = salaryImages[parseInt(req.params.id)];
  if (!img) return res.status(404).end();
  res.set('Content-Type', img.mimetype);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(img.buffer);
});

router.post('/salary/send', auth, express.urlencoded({ extended: true }), async function(req, res) {
  var data = req.session.salaryData;
  if (!data || data.length === 0) return res.send('<h3>❌ 無資料</h3><a href="/admin/salary">返回</a>');

  var scheduled = req.body.scheduled;
  if (scheduled) {
    var target = new Date(scheduled);
    var now = new Date();
    if (target > now) {
      // 排程發送
      var delay = target - now;
      console.log('[Salary] 排程發送：' + scheduled + '（' + Math.round(delay/60000) + ' 分鐘後）');
      req.session.salaryScheduled = { time: scheduled, delay: delay };
      var result = '<div class="card"><h3>⏰ 已排程</h3>'
        + '<p>將於 <strong>'+scheduled+'</strong> 發送給 '+data.length+' 位員工。</p>'
        + '<p style="color:#999">請勿關閉此頁面。約 '+Math.round(delay/60000)+' 分鐘後自動發送。</p>'
        + '</div><a href="/admin/salary" class="btn">返回</a>';
      // 啟動排程
      setTimeout(async function() {
        await doSend(data, req.app.locals.lineClient, req.protocol + '://' + req.get('host'));
      }, delay);
      return res.send(layout('排程中', '薪資發送', result));
    }
  }

  // 立即發送
  var result = await doSend(data, req.app.locals.lineClient, req.protocol + '://' + req.get('host'));
  delete req.session.salaryData;
  res.send(layout('發送完成', '薪資發送', result));
});

async function doSend(data, client, baseUrl) {
  var sent = 0, failed = 0;
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    try {
      var messages = [];
      if (d.content) {
        messages.push({ type: 'text', text: '📄 薪資明細\n\n👤 ' + d.emp.name + '（' + d.emp.employee_no + '）\n\n' + d.content + '\n\n📌 如有疑問請洽會計' });
      }
      if (d.hasImg && salaryImages[d.id]) {
        messages.push({ type: 'image', originalContentUrl: baseUrl + '/admin/salary/img/' + d.id, previewImageUrl: baseUrl + '/admin/salary/img/' + d.id });
      }
      if (messages.length > 0) {
        await client.pushMessage(d.emp.line_user_id, messages);
      }
      sent++;
    } catch(e) {
      console.error('[Salary] 發送失敗 ' + d.emp.name + ':', e.message);
      failed++;
    }
  }
  for (var i = 0; i < data.length; i++) { delete salaryImages[data[i].id]; }
  await db.deleteSalaryRecords();
  return '<div class="card"><h3>📨 發送完成</h3>'
    + '<div class="stats"><div class="stat"><div class="icon green">✅</div><div class="info"><div class="num">'+sent+'</div><div class="lbl">發送成功</div></div></div>'
    + (failed > 0 ? '<div class="stat"><div class="icon red">❌</div><div class="info"><div class="num">'+failed+'</div><div class="lbl">發送失敗</div></div></div>' : '')
    + '</div></div><a href="/admin/salary" class="btn">返回薪資發送</a>';
}

// ===== 資料彙整 =====
router.get('/data', auth, async function(_, res) {
	var now = new Date();
	var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
	var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

	var cards = [
		{ icon: '📦', title: '全部匯出', desc: '出勤彙總 + 打卡記錄 + 請假記錄 + 加班記錄（四個 Sheet 合一）', color: '#06c755', url: '/admin/export/all' },
	];

	var cardHtml = '';
	for (var i = 0; i < cards.length; i++) {
		var c = cards[i];
		cardHtml += '<div style="background:#fff;border-radius:10px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,0.08);display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px">';
		cardHtml += '<div style="font-size:40px">' + c.icon + '</div>';
		cardHtml += '<div style="font-size:18px;font-weight:700;color:#333">' + c.title + '</div>';
		cardHtml += '<div style="font-size:13px;color:#999">' + c.desc + '</div>';
		cardHtml += '<button onclick="doExport(\'' + c.url + '\')" style="margin-top:8px;background:' + c.color + ';color:#fff;border:none;padding:10px 28px;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;width:100%">📥 匯出 Excel</button>';
		cardHtml += '</div>';
	}

	var body = '<div style="max-width:1000px">';

	// 日期選擇區
	body += '<div class="card" style="margin-bottom:20px">';
	body += '<div style="font-size:15px;font-weight:600;margin-bottom:16px;color:#333">📅 選擇匯出日期範圍</div>';
	body += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">';
	body += '<input type="date" id="expStart" value="' + thisMonth + '-01" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px">';
	body += '<span style="color:#999">~</span>';
	body += '<input type="date" id="expEnd" value="' + todayStr + '" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px">';

	// 快速選擇
	var months = [];
	for (var m = 0; m < 6; m++) {
		var d = new Date(now.getFullYear(), now.getMonth() - m, 1);
		months.push({ label: d.getFullYear() + '年' + (d.getMonth()+1) + '月', start: d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01', end: d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()).padStart(2,'0') });
	}

	body += '<select onchange="pickMonth(this.value)" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:#fff">';
	body += '<option value="">📆 快速選擇月份</option>';
	for (var k = 0; k < months.length; k++) {
		body += '<option value="' + months[k].start + '|' + months[k].end + '">' + months[k].label + '</option>';
	}
	body += '</select>';
	body += '</div></div>';

	// 匯出卡片
	body += '<div style="max-width:400px">' + cardHtml + '</div>';


	body += '<div class="card" style="margin-top:24px"><h3>🗑 清除指定區間紀錄</h3>'
		+ '<p style="color:#999;font-size:13px;margin-bottom:16px">選擇資料類型和日期範圍，該區間內的紀錄將被永久刪除。</p>'
		+ '<div style="display:flex;gap:16px;margin-bottom:16px;align-items:end;flex-wrap:wrap">'
		+ '<div><label style="display:block;margin-bottom:6px;font-weight:600">資料類型</label>'
		+ '<select id="cleanupTable" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:#fff">'
		+ '<option value="checkins">📋 打卡記錄</option>'
		+ '<option value="leave_requests">🏖 請假記錄</option>'
		+ '<option value="overtime_requests">🕐 加班記錄</option>'
		+ '<option value="missed_punch">📝 補打卡記錄</option>'
		+ '</select></div>'
		+ '<div><label style="display:block;margin-bottom:6px;font-weight:600">開始日期</label><input type="date" id="cleanupStart" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px"></div>'
		+ '<div><label style="display:block;margin-bottom:6px;font-weight:600">結束日期（選填）</label><input type="date" id="cleanupEnd" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-size:14px"></div>'
		+ '<div><button onclick="doCleanup()" class="btn" style="background:#e74c3c;font-size:14px;padding:10px 24px">🗑 刪除紀錄</button></div>'
		+ '</div>'
		+ '<div id="cleanupResult" style="display:none;padding:12px 16px;border-radius:8px;font-size:14px"></div>'
		+ '</div>';
	body += '</div>';

	body += '<script>';
	body += 'function doExport(url) {';
	body += '  var s = document.getElementById("expStart").value;';
	body += '  var e = document.getElementById("expEnd").value;';
	body += '  if (!s || !e) { alert("請選擇日期範圍"); return; }';
	body += '  location.href = url + "?start=" + s + "&end=" + e;';
	body += '}';
	body += 'function pickMonth(val) {';
	body += '  if (!val) return;';
	body += '  var parts = val.split("|");';
	body += '  document.getElementById("expStart").value = parts[0];';
	body += '  document.getElementById("expEnd").value = parts[1];';
	body += '}';

	body += 'async function doCleanup(){'
		+ 'var table=document.getElementById("cleanupTable").value;'
		+ 'var start=document.getElementById("cleanupStart").value;'
		+ 'var end=document.getElementById("cleanupEnd").value;'
		+ 'if(!start){alert("請選擇開始日期");return;}'
		+ 'var labels={"checkins":"打卡","leave_requests":"請假","overtime_requests":"加班","missed_punch":"補打卡"};'
		+ 'if(!confirm("⚠️ 確定刪除「"+labels[table]+"」記錄（"+start+(end?" ~ "+end:"")+"）？\\n此操作不可復原！"))return;'
		+ 'var r=await fetch("/admin/api/cleanup/"+table,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({start:start,end:end||null})});'
		+ 'var data=await r.json();var el=document.getElementById("cleanupResult");el.style.display="block";'
		+ 'if(data.success){el.style.background="#e6f9ee";el.style.color="#059669";el.innerHTML="✅ 已刪除 "+labels[table]+" 記錄 <b>"+data.count+"</b> 筆";}'
		+ 'else{el.style.background="#fdecea";el.style.color="#e74c3c";el.innerHTML="❌ 刪除失敗："+(data.error||"請稍後再試");}'
		+ '}';
	body += '</script>';

	res.send(layout('資料彙整', '資料彙整', body));
});

// ===== Excel 匯出 =====
// 匯出用：拆分日期時間，去除 T00:00:00+08
function edt(str) {
  if (!str) return { date: '', time: '' };
  var s = typeof str === 'string' ? str : String(str);
  var tIdx = s.indexOf('T');
  if (tIdx !== -1) {
    var date = s.substring(0, tIdx);
    var time = s.substring(tIdx + 1, tIdx + 6);
    return { date: date, time: time === '00:00' ? '' : time };
  }
  var spIdx = s.indexOf(' ');
  if (spIdx !== -1) {
    var dp = s.substring(0, spIdx);
    var tp = s.substring(spIdx + 1, spIdx + 6);
    return { date: dp, time: tp === '00:00' ? '' : tp };
  }
  return { date: s.length >= 10 ? s.substring(0, 10) : s, time: '' };
}

// 請假時數計算（跨天每日最多 8h，午休扣 1h）
async function exportLeaveHours(startStr, endStr) {
  if (!startStr) return 0;
  var s = new Date(startStr), e = new Date(endStr||startStr);
  var diff = e - s;
  if (diff <= 0) return 1;

  // 讀取國定假日
  var holidays = [];
  try {
    var raw = await db.getSetting('tw_holidays') || '[]';
    holidays = JSON.parse(raw);
  } catch(ex) { holidays = []; }

  // 逐日計算，跳過週六(6)週日(0)及國定假日
  var sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var eDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());

  var total = 0;
  var current = new Date(sDay);
  while (current <= eDay) {
    var dow = current.getDay();
    var ds = current.getFullYear() + '-' + String(current.getMonth()+1).padStart(2,'0') + '-' + String(current.getDate()).padStart(2,'0');
    if (dow !== 0 && dow !== 6 && holidays.indexOf(ds) === -1) {
      var dayStart = current.getTime() === sDay.getTime() ? s : new Date(current);
      var dayEnd;
      if (current.getTime() === eDay.getTime()) {
        dayEnd = e;
      } else {
        dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59);
      }
      var dayDiff = dayEnd - dayStart;
      if (dayDiff > 0) {
        var dayRaw = Math.ceil(dayDiff / 3600000);
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

router.get('/export/checkins', auth, async function(req, res) {
  try {
    var startDate = req.query.start || '';
    var endDate = req.query.end || '';
    if (!startDate) {
      var month = req.query.month || (new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
      var parts = month.split('-');
      var y = parseInt(parts[0]), m = parseInt(parts[1]);
      startDate = y+'-'+String(m).padStart(2,'0')+'-01';
      var lastDay = new Date(y, m, 0).getDate();
      endDate = y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
    }
    if (!endDate) endDate = startDate;

    var records = await db.queryCheckins(null, startDate, endDate, 10000, 0);
    var missed = await db.getMissedPunches('approved', 500);

    var data = [];
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var ts = r.check_time ? new Date(r.check_time) : new Date();
      data.push({
        '日期': ts.getFullYear()+'-'+String(ts.getMonth()+1).padStart(2,'0')+'-'+String(ts.getDate()).padStart(2,'0'),
        '時間': String(ts.getHours()).padStart(2,'0')+':'+String(ts.getMinutes()).padStart(2,'0'),
        '員工編號': r.employee_no || '-',
        '姓名': r.name || '-',
        '部門': r.department || '',
        '類型': r.type === 'check_in' ? '上班' : '下班',
        '位置': (r.ahdress || '').substring(0, 80),
        'GPS': r.in_range === false ? '超出範圍' : '範圍內',
        '備註': ''
      });
    }
    for (var j = 0; j < missed.length; j++) {
      var mp = missed[j];
      if (mp.punch_date < startDate || mp.punch_date > endDate) continue;
      data.push({
        '日期': mp.punch_date,
        '時間': mp.punch_time || '',
        '員工編號': mp.employee_no || '-',
        '姓名': mp.name || '-',
        '部門': mp.department || '',
        '類型': mp.punch_type === 'check_in' ? '上班(補卡)' : '下班(補卡)',
        '位置': '',
        'GPS': '補打卡',
        '備註': mp.reason || ''
      });
    }
    // 按日期排序
    data.sort(function(a, b) { return a['日期'].localeCompare(b['日期']) || a['時間'].localeCompare(b['時間']); });

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data, { header: ['日期','時間','員工編號','姓名','部門','類型','位置','GPS','備註'] });
    XLSX.utils.book_append_sheet(wb, ws, '打卡記錄');
    var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    var label = startDate === endDate ? startDate : startDate + '_' + endDate;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('打卡記錄_'+label+'.xlsx'));
    res.end(buf);
  } catch(e) {
    console.error('[Export] checkins error:', e);
    res.status(500).send('匯出失敗：' + e.message + '<br><a href="javascript:history.back()">返回</a>');
  }
});

router.get('/export/leaves', auth, async function(req, res) {
  try {
    var startDate = req.query.start || '';
    var endDate = req.query.end || '';
    if (!startDate) {
      var month = req.query.month || (new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
      startDate = month + '-01';
      var parts2 = month.split('-');
      var ly = parseInt(parts2[0]), lm = parseInt(parts2[1]);
      endDate = month + '-' + String(new Date(ly, lm, 0).getDate()).padStart(2,'0');
    }
    if (!endDate) endDate = startDate;

    var all = await db.getLeaveRequests('', 2000);
    var data = [];
    var statusLabels = { approved: '已核准', rejected: '已駁回', pending: '待審核' };
    var typeLabels = { annual: '特休', personal: '事假', sick: '病假', official: '公假', outing: '外出' };
    for (var i = 0; i < all.length; i++) {
      var l = all[i];
      var lStart = typeof l.start_date === 'string' ? (l.start_date.indexOf(' ')!==-1 ? l.start_date.split(' ')[0] : l.start_date.split('T')[0]) : '';
      var lEnd = typeof l.end_date === 'string' ? (l.end_date.indexOf(' ')!==-1 ? l.end_date.split(' ')[0] : l.end_date.split('T')[0]) : lStart;
      // 檢查日期區間是否重疊
      if (lEnd < startDate || lStart > endDate) continue;
      var hours = await exportLeaveHours(l.start_date, l.end_date);
      var lsDt = l.start_date ? edt(l.start_date) : { date: '', time: '' };
      var leDt = l.end_date ? edt(l.end_date) : { date: '', time: '' };
      data.push({
        '員工編號': l.employee_no || '-',
        '姓名': l.name || '-',
        '部門': l.department || '',
        '假別': typeLabels[l.leave_type] || l.leave_type,
        '開始日期': lsDt.date,
        '開始時間': lsDt.time,
        '結束日期': leDt.date,
        '結束時間': leDt.time,
        '時數(h)': hours,
        '原因': l.reason || '',
        '狀態': statusLabels[l.status] || l.status,
        '駁回原因': l.reject_reason || ''
      });
    }
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data, { header: ['員工編號','姓名','部門','假別','開始日期','開始時間','結束日期','結束時間','時數(h)','原因','狀態','駁回原因'] });
    XLSX.utils.book_append_sheet(wb, ws, '請假記錄');
    var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    var label2 = startDate === endDate ? startDate : startDate + '_' + endDate;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('請假記錄_'+label2+'.xlsx'));
    res.end(buf);
  } catch(e) {
    console.error('[Export] leaves error:', e);
    res.status(500).send('匯出失敗：' + e.message + '<br><a href="javascript:history.back()">返回</a>');
  }
});

router.get('/export/overtime', auth, async function(req, res) {
  try {
    var startDate = req.query.start || '';
    var endDate = req.query.end || '';
    if (!startDate) {
      var month = req.query.month || (new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
      startDate = month + '-01';
      var parts3 = month.split('-');
      var oy = parseInt(parts3[0]), om = parseInt(parts3[1]);
      endDate = month + '-' + String(new Date(oy, om, 0).getDate()).padStart(2,'0');
    }
    if (!endDate) endDate = startDate;

    var all = await db.getOvertimeRequests('', 2000);
    var data = [];
    var statusLabels2 = { approved: '已核准', rejected: '已駁回', pending: '待審核' };
    for (var i = 0; i < all.length; i++) {
      var ot = all[i];
      var otStart = typeof ot.start_time === 'string' ? (ot.start_time.indexOf(' ')!==-1 ? ot.start_time.split(' ')[0] : ot.start_time.split('T')[0]) : '';
      // 檢查日期區間是否重疊
      if (otStart < startDate || otStart > endDate) continue;
      // 計算加班時數（分 2 小時內/超過 2 小時）
      var otHours = 0, otIn2 = 0, otOver2 = 0;
      if (ot.start_time && ot.end_time) {
        var s2 = new Date(ot.start_time), e2 = new Date(ot.end_time);
        var diffMs = e2 - s2;
        if (diffMs > 0) otHours = Math.round(diffMs / 3600000 * 10) / 10;
        if (otHours <= 2) { otIn2 = otHours; otOver2 = 0; }
        else { otIn2 = 2; otOver2 = Math.round((otHours - 2) * 10) / 10; }
      }
      var osDt = ot.start_time ? edt(ot.start_time) : { date: '', time: '' };
      var oeDt = ot.end_time ? edt(ot.end_time) : { date: '', time: '' };
      data.push({
        '員工編號': ot.employee_no || '-',
        '姓名': ot.name || '-',
        '部門': ot.department || '',
        '日期': osDt.date,
        '開始時間': osDt.time,
        '結束時間': oeDt.time,
        '總時數(h)': otHours,
        '2小時內(h)': otIn2,
        '超過2小時(h)': otOver2,
        '原因': ot.reason || '',
        '狀態': statusLabels2[ot.status] || ot.status,
        '駁回原因': ot.reject_reason || ''
      });
    }
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data, { header: ['員工編號','姓名','部門','日期','開始時間','結束時間','總時數(h)','2小時內(h)','超過2小時(h)','原因','狀態','駁回原因'] });
    XLSX.utils.book_append_sheet(wb, ws, '加班記錄');
    var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    var label3 = startDate === endDate ? startDate : startDate + '_' + endDate;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('加班記錄_'+label3+'.xlsx'));
    res.end(buf);
  } catch(e) {
    console.error('[Export] overtime error:', e);
    res.status(500).send('匯出失敗：' + e.message + '<br><a href="javascript:history.back()">返回</a>');
  }
});

// ===== 出勤彙總匯出 =====
router.get('/export/summary', auth, async function(req, res) {
	try {
		// 解析日期範圍
		var startDate = req.query.start || '';
		var endDate = req.query.end || '';
		if (!startDate) {
			var month = req.query.month || (new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
			var parts = month.split('-');
			var y = parseInt(parts[0]), m = parseInt(parts[1]);
			startDate = y+'-'+String(m).padStart(2,'0')+'-01';
			var lastDay = new Date(y, m, 0).getDate();
			endDate = y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
		}
		if (!endDate) endDate = startDate;

		// 取得資料
		var summaryRows = await db.getCheckinSummary(startDate, endDate);
		var leaves = await db.getLeaveRequests('approved', 2000);
		var missedPunches = await db.getMissedPunches('approved', 500);

		// 設定
		var workStartH = parseInt(await db.getSetting('work_start_hour') || '8');
		var lateBufMin = parseInt(await db.getSetting('late_buffer_minutes') || '30');

		// 時間格式化
		function fmtTime(d) {
			return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
		}

		// 假別標籤
		var leaveTypeLabels = { annual: '特休', personal: '事假', sick: '病假', official: '公假', outing: '外出', marriage: '婚假', funeral: '喪假', comp: '補休' };
			var _holidays2 = [];
			try { _holidays2 = JSON.parse(await db.getSetting('tw_holidays') || '[]'); } catch(ex) {}

		// 建立請假查詢用 Map（employee_id → 當天有效的請假）
		var leaveByEmp = {};
		for (var li = 0; li < leaves.length; li++) {
			var l = leaves[li];
			if (!leaveByEmp[l.employee_id]) leaveByEmp[l.employee_id] = [];
			leaveByEmp[l.employee_id].push(l);
		}

		// 建立補打卡查詢用 Set（employee_id::punch_date）
		var missedSet = {};
		for (var mi = 0; mi < missedPunches.length; mi++) {
			var mp = missedPunches[mi];
			missedSet[mp.employee_id + '::' + mp.punch_date] = true;
		}

		// 逐列分析
		
	// 建立員工特休/婚假/喪假額度 Map
	var annualLeaveMap = {};
	async function _getALB(eid) {
		if (!annualLeaveMap[eid]) {
			try {
				var _a = await db.getAnnualLeaveBalance(eid);
				var _m = await db.getMarriageLeaveBalance(eid);
				var _f = await db.getFuneralLeaveBalance(eid);
				var _ytdP=0,_ytdS=0;try{var _yl=await db.getEmployeeLeaveRequests(eid,'approved',200);var _ys=new Date().getFullYear()+'-01-01';for(var _yi=0;_yi<_yl.length;_yi++){if(_yl[_yi].start_date<_ys)continue;var _yh=await db.calcPeriodHours(_yl[_yi].start_date,_yl[_yi].end_date);if(_yl[_yi].leave_type==='personal')_ytdP+=_yh;else if(_yl[_yi].leave_type==='sick')_ytdS+=_yh;}}catch(ex){}annualLeaveMap[eid]={ad:_a.entitlement_days,ah:_a.entitlement_hours,au:_a.used_hours,ar:_a.remaining_hours,mr:_m.remaining_hours,fr:_f.remaining_hours,_ytdP:_ytdP,_ytdS:_ytdS};
			} catch(ex) { annualLeaveMap[eid] = { ad:0, au:0, ar:0, mr:0, fr:0 }; }
		}
		return annualLeaveMap[eid];
	}
var data = [];
		for (var i = 0; i < summaryRows.length; i++) {
			var r = summaryRows[i];
			var ci = r.check_in_time ? new Date(r.check_in_time) : null;
			var co = r.check_out_time ? new Date(r.check_out_time) : null;
			var totalHours = null;
			var netHours = null;
			var under9h = '';
			var lateMin = 0;
			var status = '曠職';
			var leaveType = '';
			var note = '';

			if (ci && co) {
				var totalMs = co - ci;
				if (totalMs > 0) {
					totalHours = Math.round(totalMs / 3600000 * 10) / 10;

					// 午休扣除：若跨 12:00-13:00 扣 1h
					var lunchStart = new Date(ci);
					lunchStart.setHours(12, 0, 0, 0);
					var lunchEnd = new Date(ci);
					lunchEnd.setHours(13, 0, 0, 0);
					var spansLunch = ci < lunchEnd && co > lunchStart;
					netHours = totalHours;
					if (spansLunch) netHours = Math.max(0, totalHours - 1);
					netHours = Math.round(netHours * 10) / 10;

					// 正常工時 < 9h 標記（僅計算 8:00-17:30，超過屬加班不計）
					var normalEnd3 = new Date(ci);
					normalEnd3.setHours(17, 30, 0, 0);
					var normalH3 = Math.round(Math.max(0, ((co > normalEnd3 ? normalEnd3 : co) - ci) / 3600000) * 10) / 10;
					if (normalH3 < 9) under9h = '是';
				}

				// 判斷遲到
				var ciMins = ci.getHours() * 60 + ci.getMinutes();
				lateMin = ciMins - (workStartH * 60 + lateBufMin);
				if (lateMin > 0) {
					status = '遲到';
				} else {
					status = '出勤';
					lateMin = 0;
				}
			} else if (ci && !co) {
				// 只有上班沒下班
				status = '未下班';
			} else {
				// 無打卡 → 檢查請假
				var empLeaves = leaveByEmp[r.employee_id] || [];
				for (var lj = 0; lj < empLeaves.length; lj++) {
					var el = empLeaves[lj];
					if (dateOverlaps(el.start_date, el.end_date, r.work_date)) {
						status = '請假';
						leaveType = leaveTypeLabels[el.leave_type] || el.leave_type;
						break;
					}
				}
				// 檢查補打卡
				if (status === '曠職' && missedSet[r.employee_id + '::' + r.work_date]) {
					status = '已補卡';
				}
				// 檢查是否為六日或國定假日
				if (status === '曠職') {
					var _dow = new Date(r.work_date).getDay();
					if (_dow === 0 || _dow === 6 || _holidays.indexOf(r.work_date) !== -1) {
						status = '假日';
					}
				}
			}

			data.push({
				'日期': (r.work_date || '').substring(0, 10),
				'員工編號': r.employee_no || '-',
				'姓名': r.name || '-',
				'部門': r.department || '',
				'上班時間': ci ? fmtTime(ci) : '',
				'下班時間': co ? fmtTime(co) : '',
				'總工時(h)': totalHours !== null ? totalHours : '',
				'淨工時(h)': netHours !== null ? netHours : '',
				'是否<9h': under9h,
				'考勤狀態': status,
				'遲到分鐘': lateMin > 0 ? lateMin : '',
				'遲到請假時數': _llh || '',
								'請假假別': leaveType,
				'備註': note,
				'特休額度(h)': (await _getALB(r.employee_id)).ah,
				'特休已用(h)': (await _getALB(r.employee_id)).au,
				'特休剩餘(h)': (await _getALB(r.employee_id)).ar,
				'婚假剩餘(h)': (await _getALB(r.employee_id)).mr,
				'喪假剩餘(h)': (await _getALB(r.employee_id)).fr,
				'年度事假(h)': (await _getALB(r.employee_id))._ytdP || 0,
				'年度病假(h)': (await _getALB(r.employee_id))._ytdS || 0
			});
		}

		// 建立 Excel
		var wb = XLSX.utils.book_new();
		var ws = XLSX.utils.json_to_sheet(data, {
			header: ['日期','員工編號','姓名','部門','上班時間','下班時間','總工時(h)','淨工時(h)','是否<9h','考勤狀態','遲到分鐘','遲到請假時數','請假假別','備註','特休額度(h)','特休已用(h)','特休剩餘(h)','婚假剩餘(h)','喪假剩餘(h)','年度事假(h)','年度病假(h)']
		});
		XLSX.utils.book_append_sheet(wb, ws, '出勤彙總');
		var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
		var label = startDate === endDate ? startDate : startDate + '_' + endDate;
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('出勤彙總_'+label+'.xlsx'));
		res.end(buf);
	} catch(e) {
		console.error('[Export] summary error:', e);
		res.status(500).send('匯出失敗：' + e.message + '<br><a href="javascript:history.back()">返回</a>');
	}
});

// ===== 彙整匯出（四 sheet 合一） =====
router.get('/export/all', auth, async function(req, res) {
	try {
		var startDate = req.query.start || '';
		var endDate = req.query.end || '';
		if (!startDate) {
			var month = req.query.month || (new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0'));
			var parts = month.split('-');
			var y = parseInt(parts[0]), m = parseInt(parts[1]);
			startDate = y+'-'+String(m).padStart(2,'0')+'-01';
			var lastDay = new Date(y, m, 0).getDate();
			endDate = y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
		}
		if (!endDate) endDate = startDate;

		var wb = XLSX.utils.book_new();

		// ===== Sheet 1: 出勤彙總 =====
		var summaryRows = await db.getCheckinSummary(startDate, endDate);
		var leaves = await db.getLeaveRequests('approved', 2000);
		var missedPunches = await db.getMissedPunches('approved', 500);
		var workStartH = parseInt(await db.getSetting('work_start_hour') || '8');
		var lateBufMin = parseInt(await db.getSetting('late_buffer_minutes') || '30');
		var leaveTypeLabels = { annual: '特休', personal: '事假', sick: '病假', official: '公假', outing: '外出', marriage: '婚假', funeral: '喪假', comp: '補休' };
			var _holidays2 = [];
			try { _holidays2 = JSON.parse(await db.getSetting('tw_holidays') || '[]'); } catch(ex) {}

		function fmtTime2(d) {
			return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
		}

		var leaveByEmp = {};
		for (var li = 0; li < leaves.length; li++) {
			var l = leaves[li];
			if (!leaveByEmp[l.employee_id]) leaveByEmp[l.employee_id] = [];
			leaveByEmp[l.employee_id].push(l);
		}
		var missedSet = {};
		for (var mi = 0; mi < missedPunches.length; mi++) {
			var mp = missedPunches[mi];
			missedSet[mp.employee_id + '::' + mp.punch_date] = true;
		}

		
	// 建立員工特休/婚假/喪假額度 Map
	var annualLeaveMap2 = {};
	async function _getALB2(eid) {
		if (!annualLeaveMap2[eid]) {
			try {
				var _a = await db.getAnnualLeaveBalance(eid);
				var _m = await db.getMarriageLeaveBalance(eid);
				var _f = await db.getFuneralLeaveBalance(eid);
				var _ytdP2=0,_ytdS2=0;try{var _yl2=await db.getEmployeeLeaveRequests(eid,'approved',200);var _ys2=new Date().getFullYear()+'-01-01';for(var _yi2=0;_yi2<_yl2.length;_yi2++){if(_yl2[_yi2].start_date<_ys2)continue;var _yh2=await db.calcPeriodHours(_yl2[_yi2].start_date,_yl2[_yi2].end_date);if(_yl2[_yi2].leave_type==='personal')_ytdP2+=_yh2;else if(_yl2[_yi2].leave_type==='sick')_ytdS2+=_yh2;}}catch(ex){}annualLeaveMap2[eid]={ad:_a.entitlement_days,ah:_a.entitlement_hours,au:_a.used_hours,ar:_a.remaining_hours,mr:_m.remaining_hours,fr:_f.remaining_hours,_ytdP:_ytdP2,_ytdS:_ytdS2};
			} catch(ex) { annualLeaveMap2[eid] = { ad:0, au:0, ar:0, mr:0, fr:0 }; }
		}
		return annualLeaveMap2[eid];
	}
var summaryData = [];
		for (var i = 0; i < summaryRows.length; i++) {
			var r = summaryRows[i];
			var ci = r.check_in_time ? new Date(r.check_in_time) : null;
			var co = r.check_out_time ? new Date(r.check_out_time) : null;
			var totalHours = null;
			var netHours = null;
			var under9h = '';
			var lateMin = 0;
			var status = '曠職';
			var leaveType = '';
			var note = '';

			if (ci && co) {
				var totalMs = co - ci;
				if (totalMs > 0) {
					totalHours = Math.round(totalMs / 3600000 * 10) / 10;
					var lunchStart = new Date(ci); lunchStart.setHours(12, 0, 0, 0);
					var lunchEnd = new Date(ci); lunchEnd.setHours(13, 0, 0, 0);
					netHours = totalHours;
					if (ci < lunchEnd && co > lunchStart) netHours = Math.max(0, totalHours - 1);
					netHours = Math.round(netHours * 10) / 10;
					var normalEnd3 = new Date(ci); normalEnd3.setHours(17, 30, 0, 0);
					var normalH3 = Math.round(Math.max(0, ((co > normalEnd3 ? normalEnd3 : co) - ci) / 3600000) * 10) / 10;
					if (normalH3 < 9) under9h = '是';
				}
				var ciMins = ci.getHours() * 60 + ci.getMinutes();
				lateMin = ciMins - (workStartH * 60 + lateBufMin);
				if (lateMin > 0) { status = '遲到'; } else { status = '出勤'; lateMin = 0; }
			} else if (ci && !co) {
				status = '未下班';
			} else {
				var empLeaves2 = leaveByEmp[r.employee_id] || [];
				for (var lj = 0; lj < empLeaves2.length; lj++) {
					var el = empLeaves2[lj];
					if (dateOverlaps(el.start_date, el.end_date, r.work_date)) {
						status = '請假';
						leaveType = leaveTypeLabels[el.leave_type] || el.leave_type;
						break;
					}
				}
				if (status === '曠職' && missedSet[r.employee_id + '::' + r.work_date]) status = '已補卡';
				// 檢查是否為六日或國定假日
				if (status === '曠職') {
					var _d2 = new Date(r.work_date);
					var _day2 = _d2.getDay();
					if (_day2 === 0 || _day2 === 6 || _holidays2.indexOf(r.work_date) !== -1) {
						status = '假日';
					}
				}
			}

						var _llh = ''; if (lateMin > 0) { for (var _li=0;_li<leaves.length;_li++) { var _lv=leaves[_li]; if (_lv.employee_id===r.employee_id && _lv.status==='approved' && dateOverlaps(_lv.start_date,_lv.end_date,r.work_date)) { _llh = _lv.leave_type==='annual'?'特休':_lv.leave_type==='personal'?'事假':_lv.leave_type==='sick'?'病假':_lv.leave_type==='official'?'公假':_lv.leave_type==='outing'?'外出':_lv.leave_type==='marriage'?'婚假':_lv.leave_type==='funeral'?'喪假':_lv.leave_type==='comp'?'補休':_lv.leave_type; break; } } }
summaryData.push({
				'日期': (r.work_date || '').substring(0, 10),
				'員工編號': r.employee_no || '-',
				'姓名': r.name || '-',
				'部門': r.department || '',
				'上班時間': ci ? fmtTime2(ci) : '',
				'下班時間': co ? fmtTime2(co) : '',
				'總工時(h)': totalHours !== null ? totalHours : '',
				'淨工時(h)': netHours !== null ? netHours : '',
				'是否<9h': under9h,
				'考勤狀態': status,
				'遲到分鐘': lateMin > 0 ? lateMin : '',
				'遲到請假時數': _llh || '',
								'請假假別': leaveType,
				'備註': note,
			'特休額度(h)': (await _getALB2(r.employee_id)).ah,
			'特休已用(h)': (await _getALB2(r.employee_id)).au,
			'特休剩餘(h)': (await _getALB2(r.employee_id)).ar,
			'婚假剩餘(h)': (await _getALB2(r.employee_id)).mr,
			'喪假剩餘(h)': (await _getALB2(r.employee_id)).fr,
				'年度事假(h)': (await _getALB2(r.employee_id))._ytdP || 0,
				'年度病假(h)': (await _getALB2(r.employee_id))._ytdS || 0
			});
		}
		var ws1 = XLSX.utils.json_to_sheet(summaryData, {
			header: ['日期','員工編號','姓名','部門','上班時間','下班時間','總工時(h)','淨工時(h)','是否<9h','考勤狀態','遲到分鐘','遲到請假時數','請假假別','備註','特休額度(h)','特休已用(h)','特休剩餘(h)','婚假剩餘(h)','喪假剩餘(h)','年度事假(h)','年度病假(h)']
		});
		XLSX.utils.book_append_sheet(wb, ws1, '出勤彙總');

		// ===== Sheet 2: 打卡紀錄 =====
		var records = await db.queryCheckins(null, startDate, endDate, 10000, 0);
		var missedAll = await db.getMissedPunches('approved', 500);
		var checkinData = [];
		for (var ci2 = 0; ci2 < records.length; ci2++) {
			var cr = records[ci2];
			var ts = cr.check_time ? new Date(cr.check_time) : new Date();
			checkinData.push({
				'日期': ts.getFullYear()+'-'+String(ts.getMonth()+1).padStart(2,'0')+'-'+String(ts.getDate()).padStart(2,'0'),
				'時間': String(ts.getHours()).padStart(2,'0')+':'+String(ts.getMinutes()).padStart(2,'0'),
				'員工編號': cr.employee_no || '-',
				'姓名': cr.name || '-',
				'部門': cr.department || '',
				'類型': cr.type === 'check_in' ? '上班' : '下班',
				'位置': (cr.ahdress || '').substring(0, 80),
				'GPS': cr.in_range === false ? '超出範圍' : '範圍內',
				'備註': ''
			});
		}
		for (var mp2 = 0; mp2 < missedAll.length; mp2++) {
			var mpRec = missedAll[mp2];
			if (mpRec.punch_date < startDate || mpRec.punch_date > endDate) continue;
			checkinData.push({
				'日期': mpRec.punch_date,
				'時間': mpRec.punch_time || '',
				'員工編號': mpRec.employee_no || '-',
				'姓名': mpRec.name || '-',
				'部門': mpRec.department || '',
				'類型': mpRec.punch_type === 'check_in' ? '上班(補卡)' : '下班(補卡)',
				'位置': '',
				'GPS': '補打卡',
				'備註': mpRec.reason || ''
			});
		}
		checkinData.sort(function(a, b) { return a['日期'].localeCompare(b['日期']) || a['時間'].localeCompare(b['時間']); });
		var ws2 = XLSX.utils.json_to_sheet(checkinData, { header: ['日期','時間','員工編號','姓名','部門','類型','位置','GPS','備註'] });
		XLSX.utils.book_append_sheet(wb, ws2, '打卡紀錄');

		// ===== Sheet 3: 請假紀錄 =====
		var allLeaves = await db.getLeaveRequests('', 2000);
		var statusLabels = { approved: '已核准', rejected: '已駁回', pending: '待審核' };
		var typeLabels2 = { annual: '特休', personal: '事假', sick: '病假', official: '公假', outing: '外出', marriage: '婚假', funeral: '喪假', comp: '補休' };
		var leaveData = [];
		for (var lv = 0; lv < allLeaves.length; lv++) {
			var lr = allLeaves[lv];
			var lStart = typeof lr.start_date === 'string' ? (lr.start_date.indexOf(' ')!==-1 ? lr.start_date.split(' ')[0] : lr.start_date.split('T')[0]) : '';
			var lEnd = typeof lr.end_date === 'string' ? (lr.end_date.indexOf(' ')!==-1 ? lr.end_date.split(' ')[0] : lr.end_date.split('T')[0]) : lStart;
			if (lEnd < startDate || lStart > endDate) continue;
			var hours = await exportLeaveHours(lr.start_date, lr.end_date);
			var lsDt = lr.start_date ? edt(lr.start_date) : { date: '', time: '' };
			var leDt = lr.end_date ? edt(lr.end_date) : { date: '', time: '' };
			leaveData.push({
				'員工編號': lr.employee_no || '-',
				'姓名': lr.name || '-',
				'部門': lr.department || '',
				'假別': typeLabels2[lr.leave_type] || lr.leave_type,
				'開始日期': lsDt.date,
				'開始時間': lsDt.time,
				'結束日期': leDt.date,
				'結束時間': leDt.time,
				'時數(h)': hours,
				'原因': lr.reason || '',
				'狀態': statusLabels[lr.status] || lr.status,
				'駁回原因': lr.reject_reason || ''
			});
		}
		var ws3 = XLSX.utils.json_to_sheet(leaveData, { header: ['員工編號','姓名','部門','假別','開始日期','開始時間','結束日期','結束時間','時數(h)','原因','狀態','駁回原因'] });
		XLSX.utils.book_append_sheet(wb, ws3, '請假紀錄');

		// ===== Sheet 4: 加班紀錄 =====
		var allOT = await db.getOvertimeRequests('', 2000);
		var statusLabels2 = { approved: '已核准', rejected: '已駁回', pending: '待審核' };
		var otData = [];
		for (var oi = 0; oi < allOT.length; oi++) {
			var ot = allOT[oi];
			var otStart = typeof ot.start_time === 'string' ? (ot.start_time.indexOf(' ')!==-1 ? ot.start_time.split(' ')[0] : ot.start_time.split('T')[0]) : '';
			if (otStart < startDate || otStart > endDate) continue;
			var otHours = 0, otIn2 = 0, otOver2 = 0;
			if (ot.start_time && ot.end_time) {
				var diffMs = new Date(ot.end_time) - new Date(ot.start_time);
				if (diffMs > 0) otHours = Math.round(diffMs / 3600000 * 10) / 10;
				if (otHours <= 2) { otIn2 = otHours; otOver2 = 0; }
				else { otIn2 = 2; otOver2 = Math.round((otHours - 2) * 10) / 10; }
			}
			var osDt = ot.start_time ? edt(ot.start_time) : { date: '', time: '' };
			var oeDt = ot.end_time ? edt(ot.end_time) : { date: '', time: '' };
			otData.push({
				'員工編號': ot.employee_no || '-',
				'姓名': ot.name || '-',
				'部門': ot.department || '',
				'日期': osDt.date,
				'開始時間': osDt.time,
				'結束時間': oeDt.time,
				'總時數(h)': otHours,
				'2小時內(h)': otIn2,
				'超過2小時(h)': otOver2,
				'原因': ot.reason || '',
				'狀態': statusLabels2[ot.status] || ot.status,
				'駁回原因': ot.reject_reason || ''
			});
		}
		var ws4 = XLSX.utils.json_to_sheet(otData, { header: ['員工編號','姓名','部門','日期','開始時間','結束時間','總時數(h)','2小時內(h)','超過2小時(h)','原因','狀態','駁回原因'] });
		XLSX.utils.book_append_sheet(wb, ws4, '加班紀錄');

		var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
		var label = startDate === endDate ? startDate : startDate + '_' + endDate;
		res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
		res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent('考勤彙整_'+label+'.xlsx'));
		res.end(buf);
	} catch(e) {
		console.error('[Export] all error:', e);
		res.status(500).send('匯出失敗：' + e.message + '<br><a href="javascript:history.back()">返回</a>');
	}
});

module.exports = router;