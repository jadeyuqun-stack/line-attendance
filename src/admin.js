const express = require('express');
const db = require('./database');
const router = express.Router();

function auth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return req.method === 'GET' ? res.redirect('/admin/login') : res.status(401).json({ error: '未登入' });
}

// ===== 登入 =====
router.get('/login', (req, res) => {
  res.send('<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh}.box{background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.1);width:100%;max-width:380px}h1{text-align:center;margin-bottom:24px;font-size:22px}label{display:block;margin-bottom:6px;font-weight:600;font-size:14px}input{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin-bottom:16px;font-size:16px}button{width:100%;padding:14px;background:#06c755;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}.err{background:#fff0f0;color:#e74c3c;padding:10px;border-radius:8px;margin-bottom:16px;text-align:center}</style></head><body><div class="box"><h1>📋 打卡管理系統</h1>'+(req.query.err?'<div class="err">帳號或密碼錯誤</div>':'')+'<form method="POST" action="/admin/login"><label>帳號</label><input name="username" required autofocus><label>密碼</label><input type="password" name="password" required><button type="submit">登入</button></form></div></body></html>');
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.username === process.env.ADMIN_USERNAME && req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?err=1');
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// ===== 儀表板 =====
router.get('/', auth, async (_, res) => {
  const s = await db.getTodaySummary();
  const pct = s.total_employees > 0 ? Math.round(s.checked_in / s.total_employees * 100) : 0;
  res.send(page('儀表板','<h2>📊 '+s.date+' 出勤概況</h2><div class="grid"><div class="card"><div class="n">'+s.total_employees+'</div><div>總人數</div></div><div class="card" style="border-left:4px solid #06c755"><div class="n">'+s.checked_in+'</div><div>已上班</div></div><div class="card" style="border-left:4px solid #3498db"><div class="n">'+s.checked_out+'</div><div>已下班</div></div><div class="card" style="border-left:4px solid #f39c12"><div class="n">'+s.not_checked_in+'</div><div>未打卡</div></div></div><div class="card"><div class="bar"><div style="width:'+pct+'%"></div></div><p style="color:#888">出勤率 '+pct+'%</p></div><a href="/admin/records" class="btn">📋 打卡記錄</a> <a href="/admin/employees" class="btn" style="background:#3498db">👥 員工管理</a> <a href="/admin/settings" class="btn" style="background:#f39c12">⚙️ 系統設定</a> <a href="/admin/logout" style="color:#e74c3c;margin-left:8px">登出</a>'));
});

// ===== 打卡記錄 =====
router.get('/records', auth, async (req, res) => {
  const d = req.query.date || new Date().toISOString().split('T')[0];
  const records = await db.queryCheckins(req.query.eid ? parseInt(req.query.eid) : null, d, d);
  const emps = await db.listActiveEmployees();
  var rows = '';
  if (records.length === 0) rows = '<tr><td colspan="8">無記錄</td></tr>';
  else for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var t = new Date(r.check_time);
    var gps = r.in_range === false ? ' ⚠️超出範圍('+(r.distance_meters||0)+'m)' : '';
    rows += '<tr><td>'+t.toLocaleDateString('zh-TW')+'</td><td>'+h(r.employee_no)+'</td><td>'+h(r.name)+'</td><td>'+h(r.department||'')+'</td><td>'+(r.type==='check_in'?'🔵上班':'🔴下班')+'</td><td>'+t.toLocaleTimeString('zh-TW')+'</td><td>'+h(r.address||'-')+gps+'</td></tr>';
  }
  var opts = '';
  for (var j = 0; j < emps.length; j++) opts += '<option value="'+emps[j].id+'">'+h(emps[j].employee_no)+' '+h(emps[j].name)+'</option>';
  res.send(page('打卡記錄','<div class="card"><form method="GET"><input type="date" name="date" value="'+d+'" style="width:auto;display:inline"> <select name="eid" style="width:auto;display:inline"><option value="">全部</option>'+opts+'</select> <button class="btn">查詢</button></form></div><div class="card"><table><tr><th>日期</th><th>編號</th><th>姓名</th><th>部門</th><th>類型</th><th>時間</th><th>位置</th></tr>'+rows+'</table></div><a href="/admin">🏠 返回</a>'));
});

// ===== 員工管理 =====
router.get('/employees', auth, async (_, res) => {
  var emps, approvers;
  try {
    emps = await db.listActiveEmployees();
    approvers = await db.listApprovers();
  } catch(e) { return res.status(500).send('資料庫錯誤: '+e.message); }

  var rows = '';
  for (var i = 0; i < emps.length; i++) {
    var e = emps[i];
    var nameEsc = e.name.replace(/'/g,"\\'");
    var deptEsc = (e.department||'').replace(/'/g,"\\'");
    var roleEsc = (e.role||'員工').replace(/'/g,"\\'");
    var lineIdEsc = (e.line_user_id||'').replace(/'/g,"\\'");
    var lineBadge = e.line_user_id ? '<span style="color:#06c755">✅已綁定</span>' : '<span style="color:#e74c3c">❌未綁定</span>';
    var approveBtn = e.can_approve
      ? '<span style="background:#e6f9ee;color:#06c755;padding:2px 8px;border-radius:10px;font-size:12px">簽核人</span>'
      : '';
    var approverSelect = '<select onchange="setApprover('+e.id+',this.value)" style="width:auto;padding:2px;font-size:11px;border:1px solid #ddd;border-radius:4px"><option value="">未指定</option>';
    for (var j = 0; j < approvers.length; j++) {
      if (approvers[j].id !== e.id) {
        var sel = e.approver_id == approvers[j].id ? ' selected' : '';
        approverSelect += '<option value="'+approvers[j].id+'"'+sel+'>'+h(approvers[j].name)+'</option>';
      }
    }
    approverSelect += '</select>';
    rows += '<tr>'
      + '<td>'+h(e.employee_no)+'</td>'
      + '<td>'+h(e.name)+'</td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'department\',\''+deptEsc+'\')">'+(e.department||'點此設定')+'</span></td>'
      + '<td><span class="editable" onclick="editField('+e.id+',\'role\',\''+roleEsc+'\')">'+(e.role||'員工')+'</span></td>'
      + '<td>'+lineBadge+'</td>'
      + '<td><button onclick="toggleApprove('+e.id+','+e.can_approve+')" style="background:'+(e.can_approve?'#06c755':'#ddd')+';color:'+(e.can_approve?'#fff':'#666')+';border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">'+(e.can_approve?'可簽核':'設為簽核人')+'</button>'+approveBtn+'</td>'
      + '<td>'+approverSelect+'</td>'
      + '<td>'
      + '<button onclick="editLine('+e.id+',\''+nameEsc+'\',\''+lineIdEsc+'\')" style="background:#3498db;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;margin-right:2px;font-size:11px">LINE</button> '
      + '<button onclick="removeEmp('+e.id+',\''+nameEsc+'\')" style="background:#e74c3c;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px">刪除</button>'
      + '</td></tr>';
  }
  if (rows === '') rows = '<tr><td colspan="8">尚無員工，請用下方表單新增</td></tr>';

  // 離職員工
  var inactiveList = '';
  try {
    var inactiveEmps = await db.listInactiveEmployees();
    if (inactiveEmps.length > 0) {
      inactiveList = '<div class="card"><h3>📦 離職員工（點擊復原）</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>操作</th></tr>';
      for (var k = 0; k < inactiveEmps.length; k++) {
        var ie = inactiveEmps[k];
        inactiveList += '<tr><td>'+h(ie.employee_no)+'</td><td>'+h(ie.name)+'</td><td>'+h(ie.department||'')+'</td>'
          + '<td><button onclick="reactivateEmp('+ie.id+',\''+h(ie.name)+'\')" style="background:#f39c12;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px">復原</button></td></tr>';
      }
      inactiveList += '</table></div>';
    }
  } catch(e) {}

  var html = '<div class="card"><h3>新增員工</h3>'
    + '<form id="empForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">'
    + '<div><label>員工編號</label><input id="no" required style="width:120px"></div>'
    + '<div><label>姓名</label><input id="ename" required style="width:120px"></div>'
    + '<div><label>部門</label><input id="dept" style="width:100px"></div>'
    + '<div><label>角色</label><input id="role" placeholder="例如：主管" style="width:100px"></div>'
    + '<div style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="canApprove" style="width:auto;margin:0"><label style="margin:0;font-size:13px">簽核人</label></div>'
    + '<button type="submit" class="btn">新增</button>'
    + '</form></div>'
    + '<div class="card"><h3>員工列表</h3><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>角色</th><th>LINE</th><th>簽核</th><th>指定簽核人</th><th>操作</th></tr>'+rows+'</table></div>'
    + '<div id="modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:1000;justify-content:center;align-items:center">'
    + '<div style="background:#fff;padding:24px;border-radius:12px;width:90%;max-width:420px">'
    + '<h3>綁定 LINE ID</h3><p id="modalEmp" style="color:#888;margin-bottom:12px"></p>'
    + '<label>LINE User ID</label><input id="lineIdInput" placeholder="貼上員工的 LINE User ID" style="width:100%">'
    + '<p style="color:#888;font-size:12px;margin:8px 0">💡 請員工在 LINE Bot 輸入「我的ID」取得</p>'
    + '<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">'
    + '<button onclick="closeModal()" style="background:#ddd;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">取消</button>'
    + '<button onclick="saveLine()" class="btn">儲存</button>'
    + '</div></div></div>'
    + inactiveList
    + '<a href="/admin">🏠 返回</a>';

  html += '<script>'
    + 'var editId=null;'
    + 'function editLine(id,name,currentId){editId=id;document.getElementById("modalEmp").textContent="員工："+name;document.getElementById("lineIdInput").value=currentId||"";document.getElementById("modal").style.display="flex";}'
    + 'function closeModal(){document.getElementById("modal").style.display="none";}'
    + 'async function saveLine(){var val=document.getElementById("lineIdInput").value.trim();var r=await fetch("/admin/api/employees/"+editId+"/lineid",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({line_user_id:val})});if(r.ok)location.reload();else alert("儲存失敗");}'
    + 'document.getElementById("empForm").onsubmit=async function(e){e.preventDefault();try{var r=await fetch("/admin/api/employees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employee_no:document.getElementById("no").value,name:document.getElementById("ename").value,department:document.getElementById("dept").value,role:document.getElementById("role").value||"員工",can_approve:document.getElementById("canApprove").checked})});var j=await r.json();if(j.success)location.reload();else alert(j.error||"新增失敗");}catch(err){alert("網路錯誤");}};'
    + 'async function toggleApprove(id,current){await fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({can_approve:!current})});location.reload();}'
    + 'async function editField(id,field,current){var val=prompt("修改 "+field,current);if(val===null)return;var body={};body[field]=val;await fetch("/admin/api/employees/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});location.reload();}'
    + 'async function setApprover(id,approverId){await fetch("/admin/api/employees/"+id+"/approver",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({approver_id:approverId||null})});}'
    + 'async function removeEmp(id,name){if(!confirm("確定移除 "+name+"？\\n打卡和請假記錄會保留。"))return;var r=await fetch("/admin/api/employees/"+id+"/deactivate",{method:"PUT"});if(r.ok)location.reload();else alert("操作失敗");}'
    + 'async function reactivateEmp(id,name){if(!confirm("確定復原 "+name+"？"))return;var r=await fetch("/admin/api/employees/"+id+"/reactivate",{method:"PUT"});if(r.ok)location.reload();else alert("操作失敗");}'
    + '</script>';

  res.send(page('員工管理', html));
});

// ===== 系統設定 =====
router.get('/settings', auth, async (_, res) => {
  var officeLat = await db.getSetting('office_lat') || '';
  var officeLng = await db.getSetting('office_lng') || '';
  var gpsRange = await db.getSetting('gps_range_meters') || '200';
  var company = await db.getSetting('company_name') || process.env.COMPANY_NAME || '公司';
  var html = '<div class="card"><h3>📍 GPS 打卡設定</h3><p style="color:#888;margin:8px 0">設定公司座標後，打卡會自動計算距離，超出範圍標示警告但不阻擋。</p>'
    + '<form id="gpsForm"><label>辦公室緯度</label><input id="lat" value="'+h(officeLat)+'" placeholder="例如：25.033964">'
    + '<label>辦公室經度</label><input id="lng" value="'+h(officeLng)+'" placeholder="例如：121.564468">'
    + '<label>允許半徑（公尺）</label><input id="range" value="'+h(gpsRange)+'" placeholder="200">'
    + '<button type="submit" class="btn">儲存</button><span id="msg" style="color:#06c755;margin-left:8px"></span></form></div>'
    + '<p style="color:#888;margin:16px 0">💡 <a href="https://www.google.com/maps" target="_blank">Google Maps</a> → 右鍵點公司位置 → 複製座標</p>'
    + '<p style="color:#888">其他設定（公司名稱、上班時間）請修改 Render 上的 Environment Variables。</p>'
    + '<a href="/admin">🏠 返回</a>'
    + '<script>document.getElementById("gpsForm").onsubmit=async function(e){e.preventDefault();'
    + 'var r=await fetch("/admin/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({office_lat:document.getElementById("lat").value,office_lng:document.getElementById("lng").value,gps_range_meters:document.getElementById("range").value})});'
    + 'if(r.ok)document.getElementById("msg").textContent="✅已儲存";};</script>';
  res.send(page('系統設定', html));
});

// ===== API =====
router.post('/api/employees', auth, express.json(), async (req, res) => {
  var b = req.body;
  if (!b.employee_no || !b.name) return res.status(400).json({ error: '必填' });
  var r = await db.createEmployee(b.employee_no, b.name, b.department, b.role, b.can_approve);
  r.success ? res.json(r) : res.status(400).json(r);
});

router.put('/api/employees/:id', auth, express.json(), async (req, res) => {
  await db.updateEmployee(parseInt(req.params.id), req.body);
  res.json({ success: true });
});

router.put('/api/employees/:id/lineid', auth, express.json(), async (req, res) => {
  var ok = await db.updateLineUserId(parseInt(req.params.id), req.body.line_user_id || null);
  ok ? res.json({ success: true }) : res.status(400).json({ error: 'LINE ID 已被使用' });
});

router.put('/api/employees/:id/deactivate', auth, async (req, res) => {
  await db.deactivateEmployee(parseInt(req.params.id));
  res.json({ success: true });
});

router.put('/api/employees/:id/reactivate', auth, async (req, res) => {
  await db.reactivateEmployee(parseInt(req.params.id));
  res.json({ success: true });
});

router.put('/api/employees/:id/approver', auth, express.json(), async (req, res) => {
  await db.setApprover(parseInt(req.params.id), req.body.approver_id || null);
  res.json({ success: true });
});

router.post('/api/settings', auth, express.json(), async (req, res) => {
  for (var k in req.body) { await db.setSetting(k, req.body[k]); }
  res.json({ success: true });
});

// ===== 輔助 =====
function h(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function page(title, body) {
  return '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;min-height:100vh;padding:24px}body>a{color:#06c755;text-decoration:none;margin-right:12px}.card{background:#fff;padding:20px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:16px}.card .n{font-size:32px;font-weight:700}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.bar{background:#eee;border-radius:8px;height:20px;overflow:hidden}.bar div{height:100%;background:#06c755;border-radius:8px}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:14px}th{background:#fafafa}.btn{padding:10px 18px;background:#06c755;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;margin:4px}input,select{padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px;width:100%;margin-bottom:12px}h2{margin-bottom:8px}label{display:block;margin-bottom:4px;font-weight:600;font-size:13px;color:#666}.editable{cursor:pointer;border-bottom:1px dashed #aaa}.editable:hover{color:#06c755}@media(max-width:768px){.grid{grid-template-columns:repeat(2,1fr)}}</style></head><body>'+body+'</body></html>';
}

module.exports = router;
