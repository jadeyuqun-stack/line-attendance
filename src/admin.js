const express = require('express');
const db = require('./database');
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
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
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
  return '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' - 打卡系統</title><style>'+CSS+'</style></head><body>'
    + '<div class="sidebar"><div class="logo"><h1>📋<span>打卡系統</span></h1></div><nav>'+sidebar(active)+'</nav><div class="user">管理員 <a href="/admin/logout">登出</a></div></div>'
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

  var body = '<div class="stats">'
    + '<div class="stat"><div class="icon green">👥</div><div class="info"><div class="num">'+s.total_employees+'</div><div class="lbl">總員工人數</div></div></div>'
    + '<div class="stat"><div class="icon blue">✅</div><div class="info"><div class="num">'+s.checked_in+'</div><div class="lbl">已上班打卡</div></div></div>'
    + '<div class="stat"><div class="icon orange">📤</div><div class="info"><div class="num">'+s.checked_out+'</div><div class="lbl">已下班打卡</div></div></div>'
    + '<div class="stat"><div class="icon red">⏳</div><div class="info"><div class="num">'+s.not_checked_in+'</div><div class="lbl">尚未打卡</div></div></div>'
    + '</div>'
    + '<div class="card"><h3>今日出勤率</h3><div style="font-size:36px;font-weight:700;color:#06c755;margin:8px 0">'+pct+'%</div><div class="progress"><div style="width:'+pct+'%"></div></div><p style="color:#999;font-size:12px;margin-top:4px">'+s.checked_in+' / '+s.total_employees+' 人已打卡</p></div>'
    + '<div class="card"><h3>最近打卡</h3><table><tr><th>編號</th><th>姓名</th><th>類型</th><th>時間</th><th>GPS</th></tr>'+(recentRows||'<tr><td colspan="5">尚無記錄</td></tr>')+'</table></div>';
  res.send(layout('儀表板', '儀表板', body));
});

// ===== 打卡記錄 =====
router.get('/records', auth, async (req, res) => {
  var d = req.query.date || new Date().toISOString().split('T')[0];
  var records = await db.queryCheckins(req.query.eid ? parseInt(req.query.eid) : null, d, d);
  var emps = await db.listActiveEmployees();
  var empMap = {};
  for (var i = 0; i < records.length; i++) {
    var r = records[i], key = r.employee_id;
    if (!empMap[key]) empMap[key] = { emp: r, checkIn: null, checkOut: null };
    if (r.type === 'check_in') empMap[key].checkIn = r; else empMap[key].checkOut = r;
  }
  var rows = '', keys = Object.keys(empMap);
  if (keys.length === 0) rows = '<tr><td colspan="7">當日無打卡記錄</td></tr>';
  else for (var k = 0; k < keys.length; k++) {
    var d2 = empMap[keys[k]], e = d2.emp;
    var inHtml = d2.checkIn ? '<span style="color:#06c755">🔵 '+fmt(d2.checkIn.check_time)+'</span>'+(d2.checkIn.address?'<br><small style="color:#999">📍 '+h(d2.checkIn.address)+'</small>':'')+(d2.checkIn.in_range===false?' <span class="badge badge-warn">⚠️超出'+(d2.checkIn.distance_meters||0)+'m</span>':'') : '<span style="color:#ccc">--:--</span>';
    var outHtml = d2.checkOut ? '<span style="color:#e74c3c">🔴 '+fmt(d2.checkOut.check_time)+'</span>'+(d2.checkOut.address?'<br><small style="color:#999">📍 '+h(d2.checkOut.address)+'</small>':'')+(d2.checkOut.in_range===false?' <span class="badge badge-warn">⚠️超出'+(d2.checkOut.distance_meters||0)+'m</span>':'') : '<span style="color:#ccc">--:--</span>';
    var hours = '-', workH = 0;
    if (d2.checkIn && d2.checkOut) {
      var ci = new Date(d2.checkIn.check_time), co = new Date(d2.checkOut.check_time);
      workH = Math.round(Math.max(0,(co-ci)/3600000)*10)/10;
      hours = workH + 'h';
      if (workH < 8) hours += ' <span class="badge badge-warn">⚠️</span>';
    }
    rows += '<tr><td>'+h(e.employee_no)+'</td><td>'+h(e.name)+'</td><td>'+h(e.department||'')+'</td><td>'+inHtml+'</td><td>'+outHtml+'</td><td>'+hours+'</td></tr>';
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
  var body = '<div class="card"><form class="inline" method="GET"><div><label>日期</label><input type="date" name="date" value="'+d+'"></div><div><label>員工</label><select name="eid"><option value="">全部員工</option>'+opts+'</select></div><button class="btn">🔍 查詢</button></form></div>'
    + lateSummary
    + '<div class="card"><h3>'+d+' 打卡記錄</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>上班</th><th>下班</th><th>工時</th></tr>'+rows+'</table></div>'
    + '<button onclick="clearCheckins()" class="btn-sm btn-red">🗑 清除所有打卡記錄</button>'
    + '<script>async function clearCheckins(){if(!confirm("⚠️ 確定刪除所有打卡記錄？"))return;await fetch("/admin/api/checkins/clear",{method:"DELETE"});location.reload();}</script>';
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
    + '<div><label>角色</label><input id="role" placeholder="例：主管"></div>'
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
    var cap = Math.min(raw, days * 8);
    if (days <= 1 && s2.getHours() < 12 && e2.getHours() >= 13) cap = Math.max(1, cap - 1);
    return cap;
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
    rows += '<tr><td>'+cb+'</td><td>'+h(l.employee_no)+'</td><td>'+h(l.name)+'</td><td>'+h(l.department||'')+'</td><td>'+h(l.leave_type)+'</td><td>'+leaveTime+'</td><td>'+hours+'h</td><td>'+h(l.reason||'')+'</td><td>'+statusBadge+'</td><td>'+actionHtml+'</td></tr>';
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
    + '<script>async function approveLeave(id){await fetch("/admin/api/leaves/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectLeave(id){await fetch("/admin/api/leaves/"+id+"/reject",{method:"PUT"});location.reload();}async function clearLeaves(){if(!confirm("⚠️ 確定刪除所有請假記錄？"))return;await fetch("/admin/api/leaves/clear",{method:"DELETE"});location.reload();}'
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
router.put('/api/leaves/:id/reject', auth, async (req, res) => {
  var leave = await db.getLeaveById(parseInt(req.params.id));
  if (!leave) return res.status(404).json({ error: '找不到' });
  await db.updateLeaveStatus(leave.id, 'rejected', null);
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
router.delete('/api/overtime/clear', auth, async (_, res) => {
  await db.clearAll('overtime_requests'); res.json({ success: true });
});
router.delete('/api/checkins/clear', auth, async (_, res) => {
  await db.clearAll('checkins'); res.json({ success: true });
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
  var reportDaysArr = reportDays.split(',');
  var dayNames = ['日', '一', '二', '三', '四', '五', '六'];

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
    + '<script>'
    + 'document.getElementById("hourForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({work_start_hour:document.getElementById("workStart").value,work_end_hour:document.getElementById("workEnd").value,late_buffer_minutes:document.getElementById("lateBuf").value})});if(r.ok)document.getElementById("hourMsg").textContent="✅已儲存";};'
    + 'document.getElementById("gpsForm").onsubmit=async function(e){e.preventDefault();var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({office_lat:document.getElementById("lat").value,office_lng:document.getElementById("lng").value,gps_range_meters:document.getElementById("range").value})});if(r.ok)document.getElementById("gpsMsg").textContent="✅已儲存";};'
    + 'document.getElementById("reportForm").onsubmit=async function(e){e.preventDefault();var days=[];var cbs=document.querySelectorAll(".rptDay:checked");for(var i=0;i<cbs.length;i++)days.push(cbs[i].value);var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({report_group_id:document.getElementById("groupId").value,report_time:document.getElementById("rptTime").value,report_enabled:document.getElementById("rptEnabled").checked?"true":"false",report_days:days.join(",")})});if(r.ok)document.getElementById("rptMsg").textContent="✅已儲存 重新整理後生效";};'
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
function fmt(ts) { var d = new Date(ts); return d.getFullYear()+' '+(d.getMonth()+1)+'月'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
function modalHtml() {
  return '<div id="modal" class="modal"><div><h3>綁定 LINE ID</h3><p id="modalEmp" style="color:#999;margin-bottom:12px"></p><label>LINE User ID</label><input id="lineIdInput" placeholder="貼上員工的 LINE User ID"><p style="color:#999;font-size:12px;margin:8px 0">💡 員工在 LINE Bot 輸入「我的ID」取得</p><div class="actions"><button onclick="closeModal()" class="btn-sm btn-gray">取消</button><button onclick="saveLine()" class="btn-sm btn">儲存</button></div></div></div>';
}
function jsLib() {
  return 'var editId=null;'
    + 'function editLine(id,name,currentId){editId=id;document.getElementById("modalEmp").textContent="員工："+name;document.getElementById("lineIdInput").value=currentId||"";document.getElementById("modal").style.display="flex";}'
    + 'function closeModal(){document.getElementById("modal").style.display="none";}'
    + 'async function saveLine(){var val=document.getElementById("lineIdInput").value.trim();var r=await fetch("/admin/api/employees/"+editId+"/lineid",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({line_user_id:val})});if(r.ok)location.reload();else alert("儲存失敗");}'
    + 'async function toggleApprove(id,current){await fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({can_approve:!current})});location.reload();}'
    + 'async function editField(id,field,current){var val=prompt("修改 "+field,current);if(val===null)return;var body={};body[field]=val;await fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});location.reload();}'
    + 'async function setApprover(id,approverId,level){await fetch("/admin/api/employees/"+id+"/approver",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({approver_id:approverId||null,level:level||1})});}'
    + 'async function removeEmp(id,name){if(!confirm("確定移除 "+name+"？\\n打卡和請假記錄會保留。"))return;var r=await fetch("/admin/api/employees/"+id+"/deactivate",{method:"PUT"});if(r.ok)location.reload();else alert("操作失敗");}'
    + 'async function reactivateEmp(id,name){if(!confirm("確定復原 "+name+"？"))return;var r=await fetch("/admin/api/employees/"+id+"/reactivate",{method:"PUT"});if(r.ok)location.reload();else alert("操作失敗");}'
    + 'async function hardDeleteEmp(id,name){if(!confirm("⚠️ 永久刪除 "+name+"？\\n\\n打卡和請假記錄會保留（匿名化）。\\n此操作無法復原！"))return;var r=await fetch("/admin/api/employees/"+id+"/hard",{method:"DELETE"});if(r.ok)location.reload();else alert("操作失敗");}';
}

// ===== 加班管理 =====
router.get('/overtime', auth, async function(_, res) {
  var status = _.query.status || '';
  var records = await db.getOvertimeRequests(status, 200);
  var rows = '';
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var sb = r.status === 'pending' ? '<span class="badge badge-warn">待審核</span>' : r.status === 'approved' ? '<span class="badge badge-in">已核准</span>' : '<span class="badge badge-out">已駁回</span>';
    var ah = '';
    var otCb = r.status === 'pending' ? '<input type="checkbox" class="otCb" value="'+r.id+'" style="width:auto;height:auto">' : '';
    if (r.status === 'pending') ah = '<button onclick="approveOt('+r.id+')" class="btn-sm btn">核准</button> <button onclick="rejectOt('+r.id+')" class="btn-sm btn-red">駁回</button>';
    rows += '<tr><td>'+otCb+'</td><td>'+h(r.employee_no)+'</td><td>'+h(r.name)+'</td><td>'+h(r.department||'')+'</td><td>'+h(r.start_time)+' ~ '+h(r.end_time)+'</td><td>'+h(r.reason||'')+'</td><td>'+sb+'</td><td>'+ah+'</td></tr>';
  }
  var body = '<div class="tabs"><a href="?status=" class="'+(status===''?'active':'')+'">全部</a><a href="?status=pending" class="'+(status==='pending'?'active':'')+'">⏳ 待審核</a><a href="?status=approved" class="'+(status==='approved'?'active':'')+'">✅ 已核准</a></div>';
  body += '<div style="margin-bottom:8px"><button onclick="batchOt(\"approved\")" class="btn-sm btn">✅ 批次核准</button> <button onclick="batchOt(\"rejected\")" class="btn-sm btn-red">❌ 批次駁回</button></div>';
  body += '<div class="card"><table><tr><th><input type="checkbox" onclick="toggleAll(\"otCb\")" style="width:auto;height:auto"></th><th>編號</th><th>姓名</th><th>部門</th><th>時間</th><th>原因</th><th>狀態</th><th>操作</th></tr>'+(rows||'<tr><td colspan="8">無加班記錄</td></tr>')+'</table></div>';
  body += '<div style="margin-top:12px"><button onclick="clearOt()" class="btn-sm btn-red">🗑 清除所有加班記錄</button></div><script>async function approveOt(id){await fetch("/admin/api/overtime/"+id+"/approve",{method:"PUT"});location.reload();}async function rejectOt(id){await fetch("/admin/api/overtime/"+id+"/reject",{method:"PUT"});location.reload();}async function clearOt(){if(!confirm("⚠️ 確定刪除所有加班記錄？"))return;await fetch("/admin/api/overtime/clear",{method:"DELETE"});location.reload();}function toggleAll(cls){var cbs=document.querySelectorAll("."+cls);for(var i=0;i<cbs.length;i++)cbs[i].checked=event.target.checked;}async function batchOt(action){var cbs=document.querySelectorAll(".otCb:checked");var ids=[];for(var i=0;i<cbs.length;i++)ids.push(parseInt(cbs[i].value));if(ids.length===0){alert("請勾選項目");return;}if(!confirm("確定"+(action==="approved"?"核准":"駁回")+" "+ids.length+" 筆？"))return;await fetch("/admin/api/overtimes/batch",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:ids,action:action})});location.reload();}</script>';
  res.send(layout('加班管理', '加班管理', body));
});

router.put('/api/overtime/:id/approve', auth, async function(req, res) {
  await db.updateOvertimeStatus(parseInt(req.params.id), 'approved', null); res.json({ success: true });
});
router.put('/api/overtime/:id/reject', auth, async function(req, res) {
  await db.updateOvertimeStatus(parseInt(req.params.id), 'rejected', null); res.json({ success: true });
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

module.exports = router;
