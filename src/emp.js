/**
 * 員工端路由（主管津貼填寫頁面）
 * 掛載於 /emp，共用 server.js 的 express-session
 */
var express = require('express');
var db = require('./database');
var router = express.Router();

// ===== CSS（精簡，不包 admin 側欄） =====
var EMP_CSS = [
	'*{margin:0;padding:0;box-sizing:border-box}',
	'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif;background:#f5f6fa;color:#333;min-height:100vh}',
	'a{text-decoration:none}',
	'.topbar{background:#06c755;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}',
	'.topbar h1{font-size:18px}',
	'.topbar .user{font-size:13px;opacity:0.9}',
	'.topbar a{color:#fff;margin-left:12px;font-size:13px}',
	'.container{max-width:1200px;margin:20px auto;padding:0 16px}',
	'.card{background:#fff;border-radius:10px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.08);margin-bottom:20px}',
	'.card h3{font-size:16px;margin-bottom:12px;color:#2d3436}',
	'.card p{font-size:13px;color:#999;margin-bottom:8px}',
	'table{width:100%;border-collapse:collapse}',
	'th{background:#dfe6e9;color:#2d3436;font-size:12px;padding:8px 6px;text-align:center}',
	'td{padding:8px 6px;font-size:13px;text-align:center;border-bottom:1px solid #f0f0f0}',
	'input,select{font-size:14px;padding:6px 10px;border:1px solid #ddd;border-radius:6px;width:100%}',
	'input:focus,select:focus{outline:none;border-color:#06c755}',
	'.btn{display:inline-flex;align-items:center;gap:4px;padding:10px 20px;font-size:14px;font-weight:600;color:#fff;background:#06c755;border:none;border-radius:6px;cursor:pointer;text-decoration:none}',
	'.btn:hover{opacity:0.9}',
	'.btn-sm{padding:5px 12px;font-size:12px;border-radius:4px}',
	'.btn-red{background:#e74c3c}',
	'.btn-outline{background:#fff;color:#333;border:1px solid #ddd}',
	'.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}',
	'.badge-in{background:#e6f9ee;color:#06c755}',
	'.badge-warn{background:#fff3cd;color:#856404}',
	'.form-inline{display:flex;gap:8px;flex-wrap:wrap;align-items:end}',
	'.form-inline>div{display:flex;flex-direction:column;gap:4px}',
	'.form-inline label{font-size:12px;color:#999;font-weight:600}',
	'.login-page{display:flex;justify-content:center;align-items:center;min-height:80vh}',
	'.login-box{background:#fff;padding:40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.1);width:360px;text-align:center}',
	'.login-box h1{font-size:22px;margin-bottom:8px}',
	'.login-box .sub{font-size:13px;color:#999;margin-bottom:24px}',
	'.login-box input{margin-bottom:12px;padding:10px 14px}',
	'.login-box .btn{width:100%;justify-content:center}',
	'.err{background:#fdecea;color:#e74c3c;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px}',
	'.item-row{display:flex;gap:8px;align-items:end;margin-bottom:8px}',
	'.item-row>div{flex:1}',
	'small{color:#999;font-size:11px}',
].join('\n');

function h(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function empLayout(title, body, emp) {
	return '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><style>' + EMP_CSS + '</style></head><body>'
		+ '<div class="topbar"><h1>📋 玉群環境科技考勤系統</h1><div class="user">' + (emp ? h(emp.name) + '（' + h(emp.department||'') + '・' + (emp.role||'員工') + '）<a href="/emp/logout">登出</a>' : '') + '</div></div>'
		+ '<div class="container">' + body + '</div></body></html>';
}

// ===== 登入中介層 =====
function authEmp(req, res, next) {
	if (req.session && req.session.empId) return next();
	return req.method === 'GET' ? res.redirect('/emp/login') : res.status(401).json({ error: '未登入' });
}

// ===== 登入 =====
router.get('/login', function(req, res) {
	res.send(empLayout('登入', '<div class="login-page"><div class="login-box"><h1>🔐 主管登入</h1><p class="sub">請輸入員工編號與密碼（密碼請洽管理員設定）</p>' + (req.query.err ? '<div class="err">帳號或密碼錯誤，或無津貼管理權限</div>' : '') + '<form method="POST" action="/emp/login"><input name="employee_no" placeholder="員工編號" required autofocus><input type="password" name="password" placeholder="密碼" required><button class="btn">登入</button></form></div></div>'));
});

router.post('/login', express.urlencoded({ extended: true }), async function(req, res) {
	var emp = await db.verifyEmployeePassword(req.body.employee_no, req.body.password);
	if (!emp) return res.redirect('/emp/login?err=1');
	// 只有主任/經理/簽核人員可登入
	var supervisorRoles = ['主任', '經理', '簽核人員'];
	if (supervisorRoles.indexOf(emp.role) === -1) return res.redirect('/emp/login?err=1');
	req.session.empId = emp.id;
	res.redirect('/emp/allowances');
});

router.get('/logout', function(req, res) {
	req.session.empId = null;
	res.redirect('/emp/login');
});

// ===== 首頁 =====
router.get('/', authEmp, function(req, res) {
	res.redirect('/emp/allowances');
});

// ===== 津貼填寫頁面 =====
router.get('/allowances', authEmp, async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.redirect('/emp/login');

	var month = req.query.month || (new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0'));
	var deptEmployees = await db.listEmployeesByDepartment(supervisor.department);
	var items = await db.listAllowanceItems();
	var activeItems = items.filter(function(it) { return it.active !== false; });

	// 預填本月已存的津貼
	var allowanceMap = {};
	for (var ei = 0; ei < deptEmployees.length; ei++) {
		var eid = deptEmployees[ei].id;
		allowanceMap[eid] = {};
		var existing = await db.getAllowancesByEmployee(eid, month);
		for (var ai = 0; ai < existing.length; ai++) {
			allowanceMap[eid][existing[ai].item_id] = existing[ai];
		}
	}

	var now = new Date();
	var thisMonth = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');

	// ---- 津貼項目維護區 ----
	var itemRows = '';
	for (var ii = 0; ii < items.length; ii++) {
		var it = items[ii];
		var activeLabel = it.active === false ? '<span class="badge badge-warn">已停用</span>' : '<span class="badge badge-in">啟用</span>';
		itemRows += '<tr>'
			+ '<td>' + h(it.name) + '</td>'
			+ '<td>' + (it.amount || 0) + '</td>'
			+ '<td>' + activeLabel + '</td>'
			+ '<td>'
			+ '<button onclick="editItem(' + it.id + ',\'' + h(it.name) + '\',' + (it.amount||0) + ',' + (it.active !== false) + ')" class="btn-sm btn-outline">✏️</button> '
			+ '<button onclick="toggleItem(' + it.id + ')" class="btn-sm btn-outline">' + (it.active === false ? '啟用' : '停用') + '</button>'
			+ '</td></tr>';
	}

	var itemSection = '<div class="card"><h3>📋 津貼項目維護</h3><p>新增或編輯津貼項目（全公司共用）。金額為預設值，填寫時可調整。</p>'
		+ '<div class="form-inline" style="margin-bottom:12px"><div><label>項目名稱</label><input id="newItemName" placeholder="例如：伙食津貼"></div><div><label>預設金額</label><input id="newItemAmount" type="number" step="1" placeholder="例如：3000" style="width:120px"></div><div style="align-self:end"><button onclick="addItem()" class="btn btn-sm">➕ 新增</button></div></div>'
		+ '<table><tr><th>名稱</th><th>預設金額</th><th>狀態</th><th>操作</th></tr>' + (itemRows || '<tr><td colspan="4">尚無津貼項目</td></tr>') + '</table></div>';

	// ---- 填寫區 ----
	var fillRows = '';
	for (var efi = 0; efi < deptEmployees.length; efi++) {
		var emp2 = deptEmployees[efi];
		var amp = allowanceMap[emp2.id];
		var itemCells = '';
		for (var aii = 0; aii < activeItems.length; aii++) {
			var aitem = activeItems[aii];
			var existingAmt = amp && amp[aitem.id] ? amp[aitem.id].amount : '';
			var existingNote = amp && amp[aitem.id] ? (amp[aitem.id].note || '') : '';
			itemCells += '<div class="item-row">'
				+ '<div style="flex:2"><label style="font-size:11px">' + h(aitem.name) + '</label><input type="number" step="1" class="alw-amt" data-eid="' + emp2.id + '" data-item="' + aitem.id + '" value="' + existingAmt + '" placeholder="' + (aitem.amount||0) + '" style="width:100%"></div>'
				+ '<div style="flex:3"><label style="font-size:11px">備註</label><input type="text" class="alw-note" data-eid="' + emp2.id + '" data-item="' + aitem.id + '" value="' + h(existingNote) + '" placeholder="（選填）"></div>'
				+ '</div>';
		}
		fillRows += '<tr>'
			+ '<td>' + h(emp2.employee_no) + '</td>'
			+ '<td>' + h(emp2.name) + '</td>'
			+ '<td>' + h(emp2.department||'') + '</td>'
			+ '<td style="text-align:left">' + (itemCells || '<span style="color:#999">無可用項目</span>') + '</td>'
			+ '</tr>';
	}

	var fillSection = '<div class="card"><h3>📝 津貼填寫 — ' + h(supervisor.department||'') + ' 部門（' + month + '）</h3>'
		+ '<p style="color:#e74c3c;font-weight:600">每月底前填寫完成。切換月份可查看/編輯過往記錄。</p>'
		+ '<div class="form-inline" style="margin-bottom:16px"><div><label>月份</label><input type="month" id="fillMonth" value="' + month + '" onchange="changeMonth()"></div>'
		+ '<div style="align-self:end"><button onclick="saveAll()" class="btn">💾 全部儲存</button></div>'
		+ '<div style="align-self:end"><span id="saveMsg" style="font-size:13px"></span></div></div>'
		+ '<table><tr><th style="width:80px">編號</th><th style="width:80px">姓名</th><th style="width:80px">部門</th><th>津貼項目（金額 / 備註）</th></tr>'
		+ (fillRows || '<tr><td colspan="4">尚無部門員工</td></tr>')
		+ '</table></div>';

	var script = '<script>'
		+ 'function changeMonth(){var m=document.getElementById("fillMonth").value;if(m)location.href="/emp/allowances?month="+m;}'
		+ 'async function saveAll(){'
		+ 'var rows=[];var month=document.getElementById("fillMonth").value;'
		+ 'document.querySelectorAll(".alw-amt").forEach(function(el){'
		+ 'var v=parseFloat(el.value);if(!isNaN(v)&&v>=0){'
		+ 'var eid=parseInt(el.dataset.eid);var item=parseInt(el.dataset.item);'
		+ 'var noteEl=document.querySelector(".alw-note[data-eid=\'"+eid+"\'][data-item=\'"+item+"\']");'
		+ 'rows.push({employee_id:eid,item_id:item,amount:v,note:noteEl?noteEl.value:""});'
		+ '}});'
		+ 'var r=await fetch("/emp/api/allowances",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({month:month,rows:rows})});'
		+ 'var j=await r.json();var el=document.getElementById("saveMsg");'
		+ 'j.success?el.innerHTML="<span style=\'color:#06c755\'>✅ 已儲存 "+j.count+" 筆</span>":el.innerHTML="<span style=\'color:#e74c3c\'>❌ 失敗："+(j.error||"")+"</span>";'
		+ 'setTimeout(function(){el.innerHTML="";},3000);'
		+ '}'
		// 項目維護 JS
		+ 'async function addItem(){var n=document.getElementById("newItemName").value.trim();var a=parseFloat(document.getElementById("newItemAmount").value)||0;if(!n){alert("請輸入項目名稱");return;}'
		+ 'var r=await fetch("/emp/api/allowance-items",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n,amount:a})});'
		+ 'var j=await r.json();j.success?location.reload():alert(j.error);}'
		+ 'async function editItem(id,oldName,oldAmt,active){var n=prompt("項目名稱：",oldName);if(!n)return;var a=parseFloat(prompt("預設金額：",oldAmt));if(isNaN(a))a=0;'
		+ 'var r=await fetch("/emp/api/allowance-items/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n,amount:a})});'
		+ 'var j=await r.json();j.success?location.reload():alert(j.error);}'
		+ 'async function toggleItem(id){var r=await fetch("/emp/api/allowance-items/"+id+"/toggle",{method:"PUT"});var j=await r.json();j.success?location.reload():alert(j.error);}'
		+ '</script>';

	var body = itemSection + fillSection + script;
	res.send(empLayout('津貼填寫', body, supervisor));
});

// ===== API：批次儲存津貼 =====
router.post('/api/allowances', authEmp, express.json(), async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.status(401).json({ error: '未登入' });

	var month = req.body.month;
	var rows = req.body.rows || [];
	var deptEmployees = await db.listEmployeesByDepartment(supervisor.department);
	var allowedIds = {};
	for (var i = 0; i < deptEmployees.length; i++) allowedIds[deptEmployees[i].id] = true;

	var count = 0;
	for (var j = 0; j < rows.length; j++) {
		var row = rows[j];
		if (!allowedIds[row.employee_id]) continue; // 不屬本部門 → 跳過
		if (row.amount <= 0) continue;
		await db.setAllowance(row.employee_id, month, row.item_id, row.amount, row.note || '', supervisor.id);
		count++;
	}
	res.json({ success: true, count: count });
});

// ===== API：津貼項目維護（主管端） =====
router.get('/api/allowance-items', authEmp, async function(req, res) {
	var items = await db.listAllowanceItems();
	res.json(items);
});

router.post('/api/allowance-items', authEmp, express.json(), async function(req, res) {
	if (!req.body.name) return res.status(400).json({ error: '項目名稱必填' });
	var item = await db.createAllowanceItem(req.body.name, parseFloat(req.body.amount) || 0);
	res.json({ success: true, item: item });
});

router.put('/api/allowance-items/:id', authEmp, express.json(), async function(req, res) {
	await db.updateAllowanceItem(parseInt(req.params.id), req.body.name, req.body.amount, undefined);
	res.json({ success: true });
});

router.put('/api/allowance-items/:id/toggle', authEmp, async function(req, res) {
	var items = await db.listAllowanceItems();
	var current = items.find(function(it) { return it.id === parseInt(req.params.id); });
	if (!current) return res.status(404).json({ error: '找不到項目' });
	await db.updateAllowanceItem(parseInt(req.params.id), undefined, undefined, !current.active);
	res.json({ success: true });
});

module.exports = router;
