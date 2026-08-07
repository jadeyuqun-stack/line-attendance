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

// ===== 津貼填寫頁面（逐日填寫 + 自動加總每日/當月） =====
router.get('/allowances', authEmp, async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.redirect('/emp/login');

	var month = req.query.month || (new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0'));
	var deptEmployees = await db.listEmployeesByDepartment(supervisor.department);
	var items = await db.listAllowanceItems();
	var activeItems = items.filter(function(it) { return it.active !== false; });

	// 月份範圍
	var monthParts = month.split('-');
	var mYear = parseInt(monthParts[0]), mMonth = parseInt(monthParts[1]);
	var monthStart = month + '-01';
	var lastDay = String(new Date(mYear, mMonth, 0).getDate()).padStart(2,'0');
	var monthEnd = month + '-' + lastDay;
	var days = [];
	for (var d = 1; d <= parseInt(lastDay); d++) days.push(String(d).padStart(2,'0'));

	// 預填已存的津貼（以 work_date|item_id 為 key）
	var allowanceMap = {};
	for (var ei = 0; ei < deptEmployees.length; ei++) {
		var eid = deptEmployees[ei].id;
		allowanceMap[eid] = {};
		var existing = await db.getAllowancesByEmployee(eid, monthStart, monthEnd);
		for (var ai = 0; ai < existing.length; ai++) {
			var ex = existing[ai];
			var dkey = String(ex.work_date).substring(8,10);
			if (!allowanceMap[eid][dkey]) allowanceMap[eid][dkey] = { amt: {}, note: '' };
			allowanceMap[eid][dkey].amt[ex.item_id] = ex.amount;
			if (ex.note) allowanceMap[eid][dkey].note = ex.note;
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

	// ---- 填寫區（逐日） ----
	var fillSections = '';
	for (var efi = 0; efi < deptEmployees.length; efi++) {
		var emp2 = deptEmployees[efi];
		var amp = allowanceMap[emp2.id] || {};
		// 表頭
		var thItems = '';
		for (var aii = 0; aii < activeItems.length; aii++) {
			thItems += '<th style="min-width:90px">' + h(activeItems[aii].name) + '<br><small style="color:#999">預設 ' + (activeItems[aii].amount||0) + '</small></th>';
		}
		// 每日列
		var dayRows = '';
		for (var di = 0; di < days.length; di++) {
			var dkey = days[di];
			var dcell = amp[dkey] || { amt: {}, note: '' };
			var tds = '';
			for (var aii2 = 0; aii2 < activeItems.length; aii2++) {
				var item2 = activeItems[aii2];
				var val = dcell.amt[item2.id] !== undefined ? dcell.amt[item2.id] : '';
				tds += '<td><input type="number" step="1" min="0" class="alw-amt" data-eid="' + emp2.id + '" data-item="' + item2.id + '" data-date="' + dkey + '" value="' + val + '" placeholder="' + (item2.amount||0) + '" style="width:80px;text-align:center"></td>';
			}
			dayRows += '<tr>'
				+ '<td style="white-space:nowrap;font-weight:600">' + month.substring(5) + '-' + dkey + '</td>'
				+ tds
				+ '<td class="day-total" data-eid="' + emp2.id + '" data-date="' + dkey + '" style="font-weight:600;color:#06c755">0</td>'
				+ '<td style="min-width:140px"><input type="text" class="alw-note" id="note_' + emp2.id + '_' + dkey + '" data-eid="' + emp2.id + '" data-date="' + dkey + '" value="' + h(dcell.note) + '" placeholder="備註" style="width:100%"></td>'
				+ '</tr>';
		}
		fillSections += '<div class="card" style="page-break-inside:avoid"><h3>' + h(emp2.employee_no) + ' ' + h(emp2.name) + '（' + h(emp2.department||'') + '）</h3>'
			+ '<table style="min-width:100%"><tr><th style="width:80px">日期</th>' + thItems + '<th style="width:90px">每日合計</th><th style="width:140px">備註</th></tr>'
			+ dayRows
			+ '<tr style="background:#e6f9ee"><td colspan="' + (activeItems.length + 1) + '" style="font-weight:700">📊 當月合計</td><td id="monthtotal_' + emp2.id + '" style="font-weight:700;color:#06c755">0</td><td></td></tr>'
			+ '</table></div>';
	}

	var fillSection = '<div class="card"><h3>📝 津貼填寫 — ' + h(supervisor.department||'') + ' 部門（' + month + '）</h3>'
		+ '<p style="color:#e74c3c;font-weight:600">每月底前填寫完成。填寫時自動加總每日與當月金額，可事後編輯。切換月份可查看/編輯過往記錄。</p>'
		+ '<div class="form-inline" style="margin-bottom:16px"><div><label>月份</label><input type="month" id="fillMonth" value="' + month + '" onchange="changeMonth()"></div>'
		+ '<div style="align-self:end"><button onclick="saveAll()" class="btn">💾 全部儲存</button></div>'
		+ '<div style="align-self:end"><span id="saveMsg" style="font-size:13px"></span></div></div>'
		+ (fillSections || '<p style="color:#999">尚無部門員工</p>')
		+ '</div>';

	var script = '<script>'
		+ 'function changeMonth(){var m=document.getElementById("fillMonth").value;if(m)location.href="/emp/allowances?month="+m;}'
		// 自動加總
		+ 'function recalcAll(){var sums={};document.querySelectorAll(\'.alw-amt\').forEach(function(inp){var k=inp.dataset.eid+"_"+inp.dataset.date;var v=parseFloat(inp.value);if(!isNaN(v)&&v>0){sums[k]=(sums[k]||0)+v;}});document.querySelectorAll(\'.day-total\').forEach(function(cell){var k=cell.dataset.eid+"_"+cell.dataset.date;cell.textContent=sums[k]||0;});var mt={};document.querySelectorAll(\'.day-total\').forEach(function(cell){var eid=cell.dataset.eid;var v=parseFloat(cell.textContent)||0;mt[eid]=(mt[eid]||0)+v;});for(var ee in mt){var el=document.getElementById(\'monthtotal_\'+ee);if(el)el.textContent=mt[ee];}}'
		+ 'document.querySelectorAll(\'.alw-amt\').forEach(function(inp){inp.addEventListener(\'input\',recalcAll);});'
		+ 'recalcAll();'
		+ 'async function saveAll(){'
		+ 'var rows=[];'
		+ 'document.querySelectorAll(\'.alw-amt\').forEach(function(el){'
		+ 'var v=parseFloat(el.value);if(!isNaN(v)&&v>0){'
		+ 'var eid=parseInt(el.dataset.eid);var item=parseInt(el.dataset.item);var date=el.dataset.date;'
		+ 'var month=document.getElementById(\'fillMonth\').value;'
		+ 'var noteEl=document.getElementById(\'note_\'+eid+\'_\'+date);'
		+ 'rows.push({employee_id:eid,work_date:month+"-"+date,item_id:item,amount:v,note:noteEl?noteEl.value:""});'
		+ '}});'
		+ 'var r=await fetch("/emp/api/allowances",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows:rows})});'
		+ 'var j=await r.json();var el=document.getElementById(\'saveMsg\');'
		+ 'j.success?el.innerHTML="<span style=\\"color:#06c755\\">✅ 已儲存 "+j.count+" 筆</span>":el.innerHTML="<span style=\\"color:#e74c3c\\">❌ 失敗："+(j.error||"")+"</span>";'
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

// ===== API：批次儲存津貼（逐日） =====
router.post('/api/allowances', authEmp, express.json(), async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.status(401).json({ error: '未登入' });

	var rows = req.body.rows || [];
	var deptEmployees = await db.listEmployeesByDepartment(supervisor.department);
	var allowedIds = {};
	for (var i = 0; i < deptEmployees.length; i++) allowedIds[deptEmployees[i].id] = true;

	var count = 0;
	for (var j = 0; j < rows.length; j++) {
		var row = rows[j];
		if (!allowedIds[row.employee_id]) continue; // 不屬本部門 → 跳過
		if (!row.work_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.work_date))) continue;
		if (row.amount <= 0) continue;
		await db.setAllowance(row.employee_id, String(row.work_date), row.item_id, row.amount, row.note || '', supervisor.id);
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
