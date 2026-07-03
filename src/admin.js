const express = require('express');
const db = require('./database');
const XLSX = require('xlsx');
const router = express.Router();

function auth(req, res, next) {
  if (req.session && req.session.admin) return next();
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
    ['/admin/records', '📋', '打卡記錄'],
    ['/admin/employees', '👥', '員工管理'],
    ['/admin/leaves', '🏖', '請假管理'],
    ['/admin/salary', '💵', '薪資發送'],
    ['/admin/overtime', '🕐', '加班管理'],
    ['/admin/missed', '📝', '補打卡'],
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
  if (req.body.username === process.env.ADMIN_USERNAME && req.body.password === process.env.ADMIN_PASSWORD) { req.session.admin = true; return res.redirect('/admin'); }
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
        var leaveLabel = l.leave_type === 'annual' ? '特休' : l.leave_type === 'personal' ? '事假' : l.leave_type === 'sick' ? '病假' : l.leave_type === 'official' ? '公假' : l.leave_type === 'outing' ? '外出' : l.leave_type;
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
  var keys = Object.keys(empMap);
  var rows = '', absentCount = 0;
  for (var k = 0; k < keys.length; k++) {
    var d2 = empMap[keys[k]], e = d2.emp;
    var hasCheckIn = !!d2.checkIn;

    // 判斷狀態
    if (hasCheckIn) {
      var ciDt = new Date(d2.checkIn.check_time);
      var ciH = ciDt.getHours(), ciM = ciDt.getMinutes();
      var startH = parseInt(await db.getSetting('work_start_hour') || '8');
      var buf = parseInt(await db.getSetting('late_buffer_minutes') || '30');
      // 假日不計遲到
      var ciDay = ciDt.getDay();
      var ciDateStr = d; // d is the current date being checked (YYYY-MM-DD)
      var isHoliday2 = ciDay === 0 || ciDay === 6;
      if (!isHoliday2) {
        try {
          var holidaysRaw = await db.getSetting('tw_holidays') || '[]';
          var holidaysArr = JSON.parse(holidaysRaw);
          if (holidaysArr.indexOf(ciDateStr) !== -1) isHoliday2 = true;
        } catch(e2) {}
      }
      d2.status = (!isHoliday2 && ciH*60+ciM > startH*60+buf) ? '⚠️遲到' : '✅出勤';
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

    var inHtml = d2.checkIn ? '<span style="color:#06c755">🔵 '+fmt(d2.checkIn.check_time)+'</span>'+(d2.checkIn.address?'<br><small style="color:#999">📍 '+h(d2.checkIn.address)+'</small>':'')+(d2.checkIn.in_range===false?' <span class="badge badge-warn">⚠️超出</span>':'') : '<span style="color:#ccc">--:--</span>';
    var outHtml = d2.checkOut ? '<span style="color:#e74c3c">🔴 '+fmt(d2.checkOut.check_time)+'</span>'+(d2.checkOut.address?'<br><small style="color:#999">📍 '+h(d2.checkOut.address)+'</small>':'')+(d2.checkOut.in_range===false?' <span class="badge badge-warn">⚠️超出</span>':'') : '<span style="color:#ccc">--:--</span>';
    var hours = '-', workH = 0;
    if (d2.checkIn && d2.checkOut) {
      var ci = new Date(d2.checkIn.check_time), co = new Date(d2.checkOut.check_time);
      var rawH = Math.round(Math.max(0,(co-ci)/3600000)*10)/10;
      var lunchDed2 = (ci.getHours() < 12 && co.getHours() >= 13) ? 1 : 0;
      workH = Math.round((rawH - lunchDed2) * 10) / 10;
      hours = workH + 'h';
      if (workH < 8) hours += ' <span class="badge badge-warn">⚠️</span>';
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
    + '<button onclick="clearCheckins()" class="btn-sm btn-red">🗑 清除所有打卡記錄</button> '
    + '<input type="date" id="expStart" value="'+d+'" style="width:auto;margin-left:8px" title="開始日期"> ~ <input type="date" id="expEnd" value="'+d+'" style="width:auto" title="結束日期"> <button onclick="exportCheckins()" class="btn-sm btn" style="margin-left:4px">📥 匯出 Excel</button> <button onclick="exportSummary()" class="btn-sm btn" style="margin-left:4px;background:#3498db">📊 匯出彙總</button>'
    + '<script>async function clearCheckins(){if(!confirm("⚠️ 確定刪除所有打卡記錄？"))return;await fetch("/admin/api/checkins/clear",{method:"DELETE"});location.reload();}async function deleteCheckin(id){if(!confirm("確定刪除此筆打卡記錄？"))return;var r=await fetch("/admin/api/checkins/"+id,{method:"DELETE"});if(r.ok)location.reload();else alert("刪除失敗");}function exportCheckins(){var s=document.getElementById("expStart").value;var e=document.getElementById("expEnd").value;if(!s||!e){alert("請選擇日期範圍");return;}location.href="/admin/export/checkins?start="+s+"&end="+e;}function exportSummary(){var s=document.getElementById("expStart").value;var e=document.getElementById("expEnd").value;if(!s||!e){alert("請選擇日期範圍");return;}location.href="/admin/export/summary?start="+s+"&end="+e;}</script>';
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
  for (var i = 0; i < emps.length; i++) {
    var e = emps[i];
    var nameEsc = esc(e.name), deptEsc = esc(e.department||''), roleEsc = esc(e.role||'員工');
    rows += '<tr>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td>'+h(e.name)+'</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'department\',\''+deptEsc+'\')">'+(e.department||'點此設定')+'</span></td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'role\',\''+roleEsc+'\')">'+(e.role||'員工')+'</span></td>'
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
        if (approvers[j].id !== e.id) {
          s += '<option value="'+approvers[j].id+'"'+(currentVal==approvers[j].id?' selected':'')+'>'+h(approvers[j].name)+'</option>';
        }
      }
      s += '</select>';
      return s;
    }
    var appSel1 = makeApproverSelect(1, e.approver_id);
    var appSel2 = makeApproverSelect(2, e.approver2_id);
    var appSel3 = makeApproverSelect(3, e.approver3_id);
    rows += '<tr>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td>'+h(e.name)+'</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'department\',\''+deptEsc+'\')">'+(e.department||'點此設定')+'</span></td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'role\',\''+roleEsc+'\')">'+(e.role||'員工')+'</span></td>'
      + '<td>'+(e.line_user_id?'<span class="badge badge-in">已綁定</span>':'<span class="badge badge-out">未綁定</span>')+'</td>'
      + '<td><button onclick="toggleApprove('+e.id+','+e.can_approve+')" class="btn-sm '+(e.can_approve?'btn':'btn-gray')+'">'+(e.can_approve?'可簽核':'設為簽核人')+'</button></td>'
      + '<td>'+appSel1+'</td>'
      + '<td>'+appSel2+'</td>'
      + '<td>'+appSel3+'</td>'
      + '<td>'
      + '<button onclick="editLine('+e.id+',\''+nameEsc+'\',\''+esc(e.line_user_id||'')+'\')" class="btn-sm btn-blue">LINE</button> '
      + '<button onclick="removeEmp('+e.id+',\''+nameEsc+'\')" class="btn-sm btn-red">移除</button>'
      + '</td></tr>';
  }

  var body = '<div class="card"><h3>➕ 新增員工</h3>'
    + '<form id="empForm" class="inline">'
    + '<div><label>員工編號</label><input id="no" required></div>'
    + '<div><label>姓名</label><input id="ename" required></div>'
    + '<div><label>部門</label><input id="dept"></div>'
    + '<div><label>角色</label><select id="role"><option value="員工">一般員工</option><option value="簽核人員">簽核人員</option><option value="經理">經理</option><option value="老闆">老闆</option></select></div>'
    + '<div style="align-items:center;flex-direction:row;gap:6px"><input type="checkbox" id="canApprove" style="width:16px;height:16px"><label for="canApprove" style="margin:0">簽核人</label></div>'
    + '<button type="submit" class="btn">新增</button></form></div>'
    + '<div class="card"><h3>👥 在職員工</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>角色</th><th>LINE</th><th>簽核</th><th>L1簽核</th><th>L2簽核</th><th>L3簽核</th><th>操作</th></tr>'+(rows||'<tr><td colspan="10">尚無員工</td></tr>')+'</table></div>'
    + inactiveList
    + modalHtml();

  body += '<script>'+jsLib()+'\ndocument.getElementById("empForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/employees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employee_no:document.getElementById("no").value,name:document.getElementById("ename").value,department:document.getElementById("dept").value,role:document.getElementById("role").value||"員工",can_approve:document.getElementById("canApprove").checked})});var j=await r.json();j.success?location.reload():alert(j.error);};</script>';
  res.send(layout('員工管理', '員工管理', body));
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
  for (var i = 0; i < leaves.length; i++) {
    var l = leaves[i];
    if (filterEid && l.employee_id !== filterEid) continue;
    var statusBadge = l.status === 'pending' ? '<span class="badge badge-warn">待審核</span>'
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
  var body = filterBar + '<div class="card" style="display:flex;gap:16px;padding:16px"><button onclick="clearLeaves()" class="btn-sm btn-red" style="margin-right:12px">🗑 清除所有請假</button><input type="date" id="leaveExpStart" value="'+thisMonth+'-01" style="width:auto" title="開始日期"> ~ <input type="date" id="leaveExpEnd" value="'+thisMonth+'-'+String(new Date(now.getFullYear(),now.getMonth()+1,0).getDate()).padStart(2,'0')+'" style="width:auto" title="結束日期"> <button onclick="exportLeaves()" class="btn-sm btn">📥 匯出 Excel</button><div><span style="font-size:24px;font-weight:700">'+companyMonth+'h</span><br><span style="color:#999;font-size:12px">全公司本月</span></div><div><span style="font-size:24px;font-weight:700">'+companyTotal+'h</span><br><span style="color:#999;font-size:12px">全公司累計</span></div></div>' + personSummary
    + '<div class="tabs">'
    + '<a href="?status=" class="'+(status===''?'active':'')+'">全部</a>'
    + '<a href="?status=pending" class="'+(status==='pending'?'active':'')+'">⏳ 待審核</a>'
    + '<a href="?status=approved" class="'+(status==='approved'?'active':'')+'">✅ 已核准</a>'
    + '<a href="?status=rejected" class="'+(status==='rejected'?'active':'')+'">❌ 已駁回</a>'
    + '</div>'
    + '<div style="margin-bottom:8px"><button onclick="batchAction(\"leave\",\"approved\")" class="btn-sm btn">✅ 批次核准</button> <button onclick="batchAction(\"leave\",\"rejected\")" class="btn-sm btn-red">❌ 批次駁回</button></div>'
    + '<div class="card"><table><tr><th><input type="checkbox" onclick="toggleAll(\"leaveCb\")" style="width:auto;height:auto"></th><th>編號</th><th>姓名</th><th>部門</th><th>假別</th><th>日期時間</th><th>時數</th><th>原因</th><th>狀態</th><th>操作</th></tr>'+(rows||'<tr><td colspan="10">無請假記錄</td></tr>')+'</table></div>'
    + '<script>async function approveLeave(id){await fetch("/admin/api/leaves/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectLeave(id){var reason=prompt("請輸入駁回原因：");if(reason===null)return;await fetch("/admin/api/leaves/"+id+"/reject",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason})});location.reload();}async function clearLeaves(){if(!confirm("⚠️ 確定刪除所有請假記錄？"))return;await fetch("/admin/api/leaves/clear",{method:"DELETE"});location.reload();}async function deleteLeave(id){if(!confirm("確定刪除此筆請假？"))return;await fetch("/admin/api/leaves/"+id,{method:"DELETE"});location.reload();}function exportLeaves(){var s=document.getElementById("leaveExpStart").value;var e=document.getElementById("leaveExpEnd").value;if(!s||!e){alert("請選擇日期範圍");return;}location.href="/admin/export/leaves?start="+s+"&end="+e;}'
    + 'function toggleAll(cls){var cbs=document.querySelectorAll("."+cls);for(var i=0;i<cbs.length;i++)cbs[i].checked=event.target.checked;}'
    + 'async function batchAction(type,action){var cbs=document.querySelectorAll(".leaveCb:checked");var ids=[];for(var i=0;i<cbs.length;i++)ids.push(parseInt(cbs[i].value));if(ids.length===0){alert("請勾選項目");return;}if(!confirm("確定"+ (action==="approved"?"核准":"駁回") +" "+ids.length+" 筆？"))return;await fetch("/admin/api/"+type+"s/batch",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids,action:action})});location.reload();}</script>';
  res.send(layout('請假管理', '請假管理', body));
});

router.put('/api/leaves/:id/approve', auth, async (req, res) => {
  var leave = await db.getLeaveById(parseInt(req.params.id));
  if (!leave) return res.status(404).json({ error: '找不到' });
  await db.updateLeaveStatus(leave.id, 'approved', null);
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
  }
  res.json({ success: true, count: ids.length });
});
router.put('/api/overtime/batch', auth, express.json(), async (req, res) => {
  var ids = req.body.ids || [];
  var action = req.body.action;
  for (var i = 0; i < ids.length; i++) {
    await db.updateOvertimeStatus(ids[i], action, null);
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
  var reportDaysArr = reportDays.split(',');
  var dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  var remindHours = await db.getSetting('approval_remind_hours') || '0';
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
    + '<div style="flex-direction:row;align-items:center;gap:6px;margin-right:16px"><input type="checkbox" id="rptNoDup" '+(reportNoDup==='true'||reportNoDup==='1'?'checked':'')+' style="width:16px;height:16px"><label for="rptNoDup" style="margin:0" title="開啟後同一天只會發送一次，避免重複推播">同日不重複發送</label></div>'
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
    + '<div class="card"><h3>⏰ 簽核提醒</h3>'
    + '<p style="color:#999;font-size:13px;margin-bottom:12px">設定 N 小時後仍未簽核的申請，系統自動提醒簽核人。</p>'
    + '<form id="remindForm" class="inline">'
    + '<div><label>未簽核提醒（小時）</label><input id="remindHours" value="' + h(remindHours) + '" placeholder="0 表示停用" style="width:80px"></div>'
    + '<button class="btn">儲存</button><span id="remindMsg" style="color:#06c755"></span></form></div>'
    + '<div class="card"><h3>🇹🇼 國定假日</h3>'
    + '<p style="color:#999;font-size:13px;margin-bottom:12px">假日上班打卡不計遲到。格式：JSON 日期陣列，例：["2026-01-01","2026-02-28"]</p>'
    + '<form id="holidayForm" class="inline">'
    + '<div><label>假日日期</label><input id="twHolidays" value="' + h(twHolidays) + '" style="width:500px"></div>'
    + '<button class="btn">儲存</button><span id="holidayMsg" style="color:#06c755"></span></form></div>'
    + '<script>'
    + 'document.getElementById("hourForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({work_start_hour:document.getElementById("workStart").value,work_end_hour:document.getElementById("workEnd").value,late_buffer_minutes:document.getElementById("lateBuf").value})});if(r.ok)document.getElementById("hourMsg").textContent="✅已儲存";};'
    + 'document.getElementById("gpsForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({office_lat:document.getElementById("lat").value,office_lng:document.getElementById("lng").value,gps_range_meters:document.getElementById("range").value})});if(r.ok)document.getElementById("gpsMsg").textContent="✅已儲存";};'
    + 'document.getElementById("reportForm").onsubmit=async function(e){e.preventDefault();var days=[];var cbs=document.querySelectorAll(".rptDay:checked");for(var i=0;i<cbs.length;i++)days.push(cbs[i].value);var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({report_group_id:document.getElementById("groupId").value,report_time:document.getElementById("rptTime").value,report_enabled:document.getElementById("rptEnabled").checked?"true":"false",report_days:days.join(","),report_no_dup:document.getElementById("rptNoDup").checked?"true":"false"})});if(r.ok)document.getElementById("rptMsg").textContent="✅已儲存 重新整理後生效";};'
    + 'document.getElementById("remindForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({approval_remind_hours:document.getElementById("remindHours").value})});if(r.ok)document.getElementById("remindMsg").textContent="✅已儲存";};'
    + 'document.getElementById("holidayForm").onsubmit=async function(e){e.preventDefault();var val=document.getElementById("twHolidays").value;try{JSON.parse(val);}catch(ex){alert("JSON 格式錯誤");return;}var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tw_holidays:val})});if(r.ok)document.getElementById("holidayMsg").textContent="✅已儲存";};'
    + '</script>';
  res.send(layout('系統設定', '系統設定', body));
});

// ===== API =====
router.post('/api/employees', auth, express.json(), async (req, res) => {
  var b = req.body;
  if (!b.employee_no || !b.name) return res.status(400).json({ error: '必填' });
  var r = await db.createEmployee(b.employee_no, b.name, b.department, b.role, b.can_approve);
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
function h(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
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
  var rows = '';
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var sb = r.status === 'pending' ? '<span class="badge badge-warn">待審核</span>' : r.status === 'approved' ? '<span class="badge badge-in">已核准</span>' : '<span class="badge badge-out">已駁回</span>';
    var ah = '';
    if (r.status === 'pending') ah = '<button onclick="approveMp('+r.id+')" class="btn-sm btn">核准</button> <button onclick="rejectMp('+r.id+')" class="btn-sm btn-red">駁回</button>';
    rows += '<tr><td>'+h(r.employee_no)+'</td><td>'+h(r.name)+'</td><td>'+(r.punch_type==='check_in'?'🔵補上班':'🔴補下班')+'</td><td>'+h(r.punch_date)+' '+h(r.punch_time)+'</td><td>'+h(r.reason||'')+'</td><td>'+sb+(r.reject_reason?'<br><small style="color:#e74c3c">駁回：'+h(r.reject_reason)+'</small>':'')+'</td><td>'+ah+'</td></tr>';
  }
  var body = '<div class="tabs"><a href="?status=" class="'+(status===''?'active':'')+'">全部</a><a href="?status=pending" class="'+(status==='pending'?'active':'')+'">⏳ 待審核</a><a href="?status=approved" class="'+(status==='approved'?'active':'')+'">✅ 已核准</a></div>';
  body += '<div class="card"><table><tr><th>編號</th><th>姓名</th><th>類型</th><th>時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>'+(rows||'<tr><td colspan="7">無補打卡記錄</td></tr>')+'</table></div>';
  body += '<script>async function approveMp(id){await fetch("/admin/api/missed/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectMp(id){var reason=prompt("請輸入駁回原因：");if(reason===null)return;await fetch("/admin/api/missed/"+id+"/reject",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason})});location.reload();}</script>';
  res.send(layout('補打卡管理', '補打卡', body));
});
router.put('/api/missed/:id/approve', auth, async function(req, res) { await db.updateMissedPunchStatus(parseInt(req.params.id), 'approved', null); res.json({ success: true }); });
router.put('/api/missed/:id/reject', auth, express.json(), async function(req, res) { await db.updateMissedPunchStatus(parseInt(req.params.id), 'rejected', null, req.body.reason || ''); res.json({ success: true }); });

// ===== 加班管理 =====
router.get('/overtime', auth, async function(_, res) {
  var status = _.query.status || '';
  var filterEid = _.query.eid ? parseInt(_.query.eid) : null;
  var filterMonth = _.query.month || '';
  var records = await db.getOvertimeRequests(status, 200);
  var emps = await db.listActiveEmployees();
  var rows = '';
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    // 員工篩選
    if (filterEid && r.employee_id !== filterEid) continue;
    // 月份篩選
    if (filterMonth) {
      var sd = typeof r.start_time === 'string' ? r.start_time : '';
      if (sd.indexOf(filterMonth) !== 0) continue;
    }
    var sb = r.status === 'pending' ? '<span class="badge badge-warn">待審核</span>' : r.status === 'approved' ? '<span class="badge badge-in">已核准</span>' : '<span class="badge badge-out">已駁回</span>';
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
    + '<div style="margin-top:12px"><button onclick="clearOt()" class="btn-sm btn-red">🗑 清除所有加班記錄</button> <input type="date" id="otExpStart" value="'+(filterMonth||(new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')))+'-01" style="width:auto" title="開始日期"> ~ <input type="date" id="otExpEnd" value="'+(filterMonth||(new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')))+'-'+String(new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate()).padStart(2,'0')+'" style="width:auto" title="結束日期"> <button onclick="exportOt()" class="btn-sm btn">📥 匯出 Excel</button></div><script>async function approveOt(id){await fetch("/admin/api/overtime/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectOt(id){var reason=prompt("請輸入駁回原因：");if(reason===null)return;await fetch("/admin/api/overtime/"+id+"/reject",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:reason})});location.reload();}async function clearOt(){if(!confirm("⚠️ 確定刪除所有加班記錄？"))return;await fetch("/admin/api/overtime/clear",{method:"DELETE"});location.reload();}async function deleteOt(id){if(!confirm("確定刪除此筆加班？"))return;await fetch("/admin/api/overtime/"+id,{method:"DELETE"});location.reload();}function exportOt(){var s=document.getElementById("otExpStart").value;var e=document.getElementById("otExpEnd").value;if(!s||!e){alert("請選擇日期範圍");return;}location.href="/admin/export/overtime?start="+s+"&end="+e;}function toggleAll(cls){var cbs=document.querySelectorAll("."+cls);for(var i=0;i<cbs.length;i++)cbs[i].checked=event.target.checked;}async function batchOt(action){var cbs=document.querySelectorAll(".otCb:checked");var ids=[];for(var i=0;i<cbs.length;i++)ids.push(parseInt(cbs[i].value));if(ids.length===0){alert("請勾選項目");return;}if(!confirm("確定"+(action==="approved"?"核准":"駁回")+" "+ids.length+" 筆？"))return;await fetch("/admin/api/overtimes/batch",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids,action:action})});location.reload();}</script>';
  res.send(layout('加班管理', '加班管理', body));
});

router.put('/api/overtime/:id/approve', auth, async function(req, res) {
  await db.updateOvertimeStatus(parseInt(req.params.id), 'approved', null); res.json({ success: true });
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
  for (var i = 0; i < bound.length; i++) {
    var e = bound[i];
    var sv = savedMap[e.id] || {};
    var content = sv.content || '';
    var hasImg = salaryImages[e.id] ? ' ✅已上傳圖片' : '';
    rows += '<tr>'
      + '<td>'+(i+1)+'</td>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td>'+h(e.name)+'</td>'
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

// ===== Excel 匯出 =====
// 請假時數計算（跨天每日最多 8h，午休扣 1h）
function exportLeaveHours(startStr, endStr) {
  if (!startStr) return 0;
  var s = new Date(startStr), e = new Date(endStr||startStr);
  var diff = e - s;
  if (diff <= 0) return 1;
  var raw = Math.ceil(diff / 3600000);
  var days = Math.ceil(diff / 86400000);
  var lunch = 0;
  if (days <= 1 && s.getHours() < 12 && e.getHours() >= 13) lunch = 1;
  var workHours = raw - lunch;
  if (workHours < 1) workHours = 1;
  return Math.min(workHours, days * 8);
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
        '時間': fmt(r.check_time),
        '員工編號': r.employee_no || '-',
        '姓名': r.name || '-',
        '部門': r.department || '',
        '類型': r.type === 'check_in' ? '上班' : '下班',
        '位置': (r.address || '').substring(0, 80),
        'GPS': r.in_range === false ? '超出範圍' : '範圍內',
        '備註': ''
      });
    }
    for (var j = 0; j < missed.length; j++) {
      var mp = missed[j];
      if (mp.punch_date < startDate || mp.punch_date > endDate) continue;
      data.push({
        '日期': mp.punch_date,
        '時間': mp.punch_date + ' ' + mp.punch_time,
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
      var hours = exportLeaveHours(l.start_date, l.end_date);
      data.push({
        '員工編號': l.employee_no || '-',
        '姓名': l.name || '-',
        '部門': l.department || '',
        '假別': typeLabels[l.leave_type] || l.leave_type,
        '開始時間': l.start_date || '',
        '結束時間': l.end_date || '',
        '時數(h)': hours,
        '原因': l.reason || '',
        '狀態': statusLabels[l.status] || l.status
      });
    }
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data, { header: ['員工編號','姓名','部門','假別','開始時間','結束時間','時數(h)','原因','狀態'] });
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
      // 計算加班時數
      var otHours = 0;
      if (ot.start_time && ot.end_time) {
        var s2 = new Date(ot.start_time), e2 = new Date(ot.end_time);
        var diffMs = e2 - s2;
        if (diffMs > 0) otHours = Math.round(diffMs / 3600000 * 10) / 10;
      }
      data.push({
        '員工編號': ot.employee_no || '-',
        '姓名': ot.name || '-',
        '部門': ot.department || '',
        '開始時間': ot.start_time || '',
        '結束時間': ot.end_time || '',
        '時數(h)': otHours,
        '原因': ot.reason || '',
        '狀態': statusLabels2[ot.status] || ot.status
      });
    }
    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.json_to_sheet(data, { header: ['員工編號','姓名','部門','開始時間','結束時間','時數(h)','原因','狀態'] });
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
		var leaveTypeLabels = { annual: '特休', personal: '事假', sick: '病假', official: '公假', outing: '外出' };

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

					// 總工時 < 9h 標記（含午休 1h = 8h 工作 + 1h 午休）
					if (totalHours < 9) under9h = '是';
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
			}

			data.push({
				'日期': r.work_date,
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
				'請假假別': leaveType,
				'備註': note
			});
		}

		// 建立 Excel
		var wb = XLSX.utils.book_new();
		var ws = XLSX.utils.json_to_sheet(data, {
			header: ['日期','員工編號','姓名','部門','上班時間','下班時間','總工時(h)','淨工時(h)','是否<9h','考勤狀態','遲到分鐘','請假假別','備註']
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

module.exports = router;