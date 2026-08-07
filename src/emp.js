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

// ===== 津貼填寫頁面（選員工 + 項目下拉 + 每日 5 槽可新增） =====
router.get('/allowances', authEmp, async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.redirect('/emp/login');

	var month = req.query.month || (new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0'));
	var selEid = req.query.eid ? parseInt(req.query.eid) : null;
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

	// 員工下拉選項
	var empOpts = '';
	for (var ei = 0; ei < deptEmployees.length; ei++) {
		var de = deptEmployees[ei];
		empOpts += '<option value="' + de.id + '"' + (de.id === selEid ? ' selected' : '') + '>' + h(de.employee_no) + ' ' + h(de.name) + '</option>';
	}
	// 津貼項目下拉選項
	var itemOpts = '<option value="">— 選擇項目 —</option>';
	for (var ii = 0; ii < activeItems.length; ii++) {
		var ait = activeItems[ii];
		itemOpts += '<option value="' + ait.id + '">' + h(ait.name) + '（' + (ait.amount||0) + ' 元）</option>';
	}

	// 依選擇的員工讀取既有津貼（work_date|item_id → 記錄）
	var allowanceMap = {};
	var selEmp = null;
	if (selEid) {
		for (var si = 0; si < deptEmployees.length; si++) if (deptEmployees[si].id === selEid) { selEmp = deptEmployees[si]; break; }
		var existing = await db.getAllowancesByEmployee(selEid, monthStart, monthEnd);
		for (var ai = 0; ai < existing.length; ai++) {
			var ex = existing[ai];
			var dkey = String(ex.work_date).substring(8,10);
			if (!allowanceMap[dkey]) allowanceMap[dkey] = [];
			allowanceMap[dkey].push({ item_id: ex.item_id, amount: ex.amount, note: ex.note || '' });
		}
	}

	// ---- 津貼項目維護區 ----
	var itemRows = '';
	for (var mi = 0; mi < items.length; mi++) {
		var it = items[mi];
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

	// ---- 填寫區（選員工後顯示逐日 5 槽） ----
	var formSection = '';
	if (selEmp) {
		var dayBlocks = '';
		for (var di = 0; di < days.length; di++) {
			var dkey = days[di];
			var recs = allowanceMap[dkey] || [];
			var rowCount = Math.max(5, recs.length);
			var rowsHtml = '';
			for (var r = 0; r < rowCount; r++) {
				var rec = recs[r] || {};
				var selOpts = itemOpts;
				if (rec.item_id) {
					var re = new RegExp('value="' + rec.item_id + '"');
					selOpts = selOpts.replace(re, 'value="' + rec.item_id + '" selected');
				}
				var rowId = 'note_' + selEid + '_' + dkey + '_' + r;
				rowsHtml += '<div class="entry-row">'
					+ '<select class="alw-item" style="flex:2">' + selOpts + '</select>'
					+ '<input type="number" step="1" min="0" class="alw-amt" value="' + (rec.amount !== undefined ? rec.amount : '') + '" placeholder="金額" style="flex:1;width:90px;text-align:center">'
					+ '<input type="text" class="alw-note" id="' + rowId + '" value="' + h(rec.note || '') + '" placeholder="備註" style="flex:2">'
					+ '<button type="button" class="btn-sm btn-outline remove-entry" title="移除">✕</button>'
					+ '</div>';
			}
			dayBlocks += '<div class="day-block" data-eid="' + selEid + '" data-date="' + dkey + '">'
				+ '<div class="day-head"><b>' + month.substring(5) + '-' + dkey + '</b>　每日合計：<span class="day-total">0</span></div>'
				+ '<div class="rows">' + rowsHtml + '</div>'
				+ '<button type="button" class="btn-sm btn-outline add-entry">＋ 新增</button>'
				+ '</div>';
		}
		formSection = '<div class="card"><h3>📝 津貼填寫 — ' + h(selEmp.employee_no) + ' ' + h(selEmp.name) + '（' + h(selEmp.department||'') + '）' + month + '</h3>'
			+ '<p style="color:#e74c3c;font-weight:600">每月底前填寫完成。選擇員工與津貼項目，自動加總每日與當月金額，可事後編輯。</p>'
			+ '<div style="margin-bottom:12px">📊 當月合計：<b id="monthtotal" style="color:#06c755;font-size:18px">0</b></div>'
			+ '<div id="allowForm">' + dayBlocks + '</div>'
			+ '<div style="margin-top:16px"><button onclick="saveAll()" class="btn">💾 全部儲存</button> <span id="saveMsg" style="font-size:13px"></span></div>'
			+ '</div>';
	} else {
		formSection = '<div class="card"><p style="color:#999">⬆️ 請先選擇員工以開始填寫津貼。</p></div>';
	}

	// 選單列
	var selectBar = '<div class="card"><h3>📝 津貼填寫</h3><div class="form-inline">'
		+ '<div><label>月份</label><input type="month" id="fillMonth" value="' + month + '" onchange="changeFilter()"></div>'
		+ '<div><label>員工</label><select id="fillEmp" onchange="changeFilter()"><option value="">選擇員工</option>' + empOpts + '</select></div>'
		+ '</div></div>';

	var script = '<script>'
		+ 'function changeFilter(){var m=document.getElementById("fillMonth").value;var e=document.getElementById("fillEmp").value;var q="?month="+m;if(e)q+="&eid="+e;location.href="/emp/allowances"+q;}'
		// 加總
		+ 'function recalcDay(block){var s=0;block.querySelectorAll(\'.alw-amt\').forEach(function(inp){var v=parseFloat(inp.value);if(!isNaN(v)&&v>0)s+=v;});block.querySelector(\'.day-total\').textContent=s;var mt=0;document.querySelectorAll(\'.day-total\').forEach(function(t){mt+=(parseFloat(t.textContent)||0);});document.getElementById(\'monthtotal\').textContent=mt;}'
		// 新增一行
		+ 'function addEntry(block){var eid=block.dataset.eid;var date=block.dataset.date;var rows=block.querySelector(\'.rows\');var row=document.createElement(\'div\');var first=block.querySelector(\'.entry-row\');row.className=first.className;row.innerHTML=first.innerHTML;var n=rows.querySelectorAll(\'.entry-row\').length;row.querySelector(\'.alw-amt\').value=\'\';row.querySelector(\'.alw-note\').value=\'\';row.querySelector(\'.alw-note\').id=\'note_\'+eid+\'_\'+date+\'_\'+n;rows.appendChild(row);updateDayOptions(block);recalcDay(block);}'
		// 同一天同一項目不可重複選（disable）
		+ 'function updateDayOptions(block){var selects=block.querySelectorAll(\'.alw-item\');selects.forEach(function(sel){Array.prototype.forEach.call(sel.options,function(opt){opt.disabled=false;});});var chosen=[];selects.forEach(function(sel){if(sel.value)chosen.push(sel.value);});selects.forEach(function(sel){Array.prototype.forEach.call(sel.options,function(opt){if(opt.value&&chosen.indexOf(opt.value)!==-1&&opt.value!==sel.value)opt.disabled=true;});});}'
		// 事件委派
		+ 'document.getElementById(\'allowForm\').addEventListener(\'click\',function(ev){var t=ev.target;if(t.classList.contains(\'add-entry\')){addEntry(t.closest(\'.day-block\'));}else if(t.classList.contains(\'remove-entry\')){var blk=t.closest(\'.day-block\');if(blk.querySelectorAll(\'.entry-row\').length>1){t.closest(\'.entry-row\').remove();updateDayOptions(blk);recalcDay(blk);}}});'
		+ 'document.getElementById(\'allowForm\').addEventListener(\'input\',function(ev){recalcDay(ev.target.closest(\'.day-block\'));});'
		+ 'document.getElementById(\'allowForm\').addEventListener(\'change\',function(ev){var blk=ev.target.closest(\'.day-block\');updateDayOptions(blk);recalcDay(blk);});'
		+ 'document.querySelectorAll(\'.day-block\').forEach(function(blk){updateDayOptions(blk);recalcDay(blk);});'
		+ 'async function saveAll(){'
		+ 'var rows=[];var month=document.getElementById(\'fillMonth\').value;'
		+ 'document.querySelectorAll(\'.day-block\').forEach(function(blk){var eid=parseInt(blk.dataset.eid);var date=blk.dataset.date;'
		+ 'blk.querySelectorAll(\'.entry-row\').forEach(function(row){var sel=row.querySelector(\'.alw-item\');var amt=parseFloat(row.querySelector(\'.alw-amt\').value);if(sel.value&&!isNaN(amt)&&amt>0){'
		+ 'var note=row.querySelector(\'.alw-note\').value;rows.push({employee_id:eid,work_date:month+"-"+date,item_id:parseInt(sel.value),amount:amt,note:note});'
		+ '}});});'
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

	var body = itemSection + selectBar + formSection + '<style>.entry-row{display:flex;gap:6px;align-items:center;margin-bottom:4px}.day-block{border:1px solid #eee;border-radius:8px;padding:10px 12px;margin-bottom:10px}.day-head{margin-bottom:6px}.day-block .rows{}</style>' + script;
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
	// 允許的項目 id
	var allowedItems = {};
	var items = await db.listAllowanceItems();
	for (var k = 0; k < items.length; k++) allowedItems[items[k].id] = true;

	var count = 0;
	for (var j = 0; j < rows.length; j++) {
		var row = rows[j];
		if (!allowedIds[row.employee_id]) continue; // 不屬本部門 → 跳過
		if (!row.work_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.work_date))) continue;
		if (!allowedItems[row.item_id]) continue;    // 無效項目 → 跳過
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
