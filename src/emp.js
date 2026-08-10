/**
 * 員工端路由（主管津貼填寫頁面）
 * 掛載於 /emp，共用 server.js 的 express-session
 */
var express = require('express');
var db = require('./database');
var router = express.Router();

// ===== CSS =====
var EMP_CSS = [
	'*{margin:0;padding:0;box-sizing:border-box}',
	'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif;background:#f5f6fa;color:#333;min-height:100vh}',
	'a{text-decoration:none}',
	'.topbar{background:#06c755;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}',
	'.topbar h1{font-size:18px}',
	'.topbar .user{font-size:13px;opacity:0.9}',
	'.topbar a{color:#fff;margin-left:12px;font-size:13px}',
	'.layout{display:flex;min-height:calc(100vh - 52px)}',
	'.sidebar{width:180px;background:#fff;border-right:1px solid #eee;padding:16px 0}',
	'.sidebar a{display:block;padding:12px 20px;font-size:14px;color:#333;border-left:4px solid transparent}',
	'.sidebar a:hover{background:#f5f6fa}',
	'.sidebar a.active{background:#e6f9ee;border-left-color:#06c755;font-weight:700;color:#06c755}',
	'.container{flex:1;padding:20px;max-width:1400px}',
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
	'.day-block{border:1px solid #eee;border-radius:8px;padding:12px;margin-bottom:12px}',
	'.day-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}',
	'.day-head b{font-size:14px}',
	'.slot-row{display:flex;gap:6px;flex-wrap:wrap}',
	'.slot-cell{flex:1;min-width:120px}',
	'.slot-cell select{font-size:12px;padding:5px 6px}',
	'.amt-line{text-align:center;font-size:13px;font-weight:700;color:#06c755;padding:2px;border-bottom:2px solid #e0e0e0}',
	'.slot-cell.placeholder .amt-line{color:#ccc;border-bottom-style:dashed}',
	'.day-total{color:#06c755;font-weight:700;font-size:14px}',
	'small{color:#999;font-size:11px}',
].join('\n');

function h(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function empLayout(title, body, emp, active) {
	var menu = '<a href="/emp/allowances"' + (active==='allowances' ? ' class="active"' : '') + '>📝 津貼輸入</a>'
		+ '<a href="/emp/allowance-summary"' + (active==='summary' ? ' class="active"' : '') + '>📊 津貼匯總</a>'
		+ '<a href="/emp/allowance-items"' + (active==='items' ? ' class="active"' : '') + '>📋 津貼定義</a>';
	return '<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><style>' + EMP_CSS + '</style></head><body>'
		+ '<div class="topbar"><h1>📋 玉群環境科技考勤系統</h1><div class="user">' + (emp ? h(emp.name) + '（' + h(emp.department||'') + '・' + (emp.role||'員工') + '）<a href="/emp/logout">登出</a>' : '') + '</div></div>'
		+ '<div class="layout"><div class="sidebar">' + menu + '</div><div class="container">' + body + '</div></div></body></html>';
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
	var supervisorRoles = ['主任', '副主任', '副理', '經理', '簽核人員'];
	if (supervisorRoles.indexOf(emp.role) === -1) return res.redirect('/emp/login?err=1');
	req.session.empId = emp.id;
	res.redirect('/emp/allowances');
});

router.get('/logout', function(req, res) {
	req.session.empId = null;
	res.redirect('/emp/login');
});

router.get('/', authEmp, function(req, res) {
	res.redirect('/emp/allowances');
});

// ===== 津貼輸入頁面（選員工 + 每日 5 下拉＋2 預留空位，金額自動顯示） =====
router.get('/allowances', authEmp, async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.redirect('/emp/login');

	var month = req.query.month || (new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0'));
	var selEid = req.query.eid ? parseInt(req.query.eid) : null;
	var deptEmployees = await db.listEmployeesByDepartment(supervisor.department);
	var items = await db.listAllowanceItems();
	var activeItems = items.filter(function(it) { return it.active !== false; });

	var monthParts = month.split('-');
	var mYear = parseInt(monthParts[0]), mMonth = parseInt(monthParts[1]);
	var monthStart = month + '-01';
	var lastDay = String(new Date(mYear, mMonth, 0).getDate()).padStart(2,'0');
	var monthEnd = month + '-' + lastDay;
	var days = [];
	for (var d = 1; d <= parseInt(lastDay); d++) days.push(String(d).padStart(2,'0'));

	// 員工下拉
	var empOpts = '';
	for (var ei = 0; ei < deptEmployees.length; ei++) {
		var de = deptEmployees[ei];
		empOpts += '<option value="' + de.id + '"' + (de.id === selEid ? ' selected' : '') + '>' + h(de.employee_no) + ' ' + h(de.name) + '</option>';
	}
	// 津貼項目下拉（含 data-amount）
	var itemOpts = '<option value="" data-amount="">— 選擇項目 —</option>';
	for (var ii = 0; ii < activeItems.length; ii++) {
		var ait = activeItems[ii];
		itemOpts += '<option value="' + ait.id + '" data-amount="' + (ait.amount||0) + '">' + h(ait.name) + '（' + (ait.amount||0) + ' 元）</option>';
	}

	// 既有津貼（date → [{item_id, amount}]）
	var allowanceMap = {};
	var selEmp = null;
	if (selEid) {
		for (var si = 0; si < deptEmployees.length; si++) if (deptEmployees[si].id === selEid) { selEmp = deptEmployees[si]; break; }
		var existing = await db.getAllowancesByEmployee(selEid, monthStart, monthEnd);
		for (var ai = 0; ai < existing.length; ai++) {
			var ex = existing[ai];
			var dkey = String(ex.work_date).substring(8,10);
			if (!allowanceMap[dkey]) allowanceMap[dkey] = [];
			allowanceMap[dkey].push({ item_id: ex.item_id, amount: ex.amount });
		}
	}

	// 高溫津貼項目（名稱含「高溫」）
	var highTempId = null;
	for (var ht = 0; ht < activeItems.length; ht++) {
		if (activeItems[ht].name.indexOf('高溫') !== -1) { highTempId = activeItems[ht].id; break; }
	}
	// 未出勤日（無打卡/無請假/無補打卡的工作日）
	var absentDays = {};
	if (selEid) {
		var ciRecs = await db.queryCheckins(selEid, monthStart, monthEnd, 500, 0);
		var ciSet = {};
		for (var ci2 = 0; ci2 < ciRecs.length; ci2++) ciSet[String(ciRecs[ci2].check_time).substring(0,10)] = true;
		var lvAll = await db.getLeaveRequests('approved', 2000);
		var lvSet = {};
		for (var lv2 = 0; lv2 < lvAll.length; lv2++) {
			var lvx = lvAll[lv2];
			if (lvx.employee_id !== selEid) continue;
			var lvs = String(lvx.start_date).substring(0,10), lve = String(lvx.end_date || lvx.start_date).substring(0,10);
			var cc = new Date(lvs);
			while (cc <= new Date(lve)) {
				lvSet[cc.getFullYear()+'-'+String(cc.getMonth()+1).padStart(2,'0')+'-'+String(cc.getDate()).padStart(2,'0')] = true;
				cc.setDate(cc.getDate()+1);
			}
		}
		var mpAll = await db.getMissedPunches('approved', 500);
		var mpSet = {};
		for (var mp2 = 0; mp2 < mpAll.length; mp2++) if (mpAll[mp2].employee_id === selEid) mpSet[mpAll[mp2].punch_date] = true;
		for (var ab = 0; ab < days.length; ab++) {
			var ds = month + '-' + days[ab];
			var dow = new Date(ds).getDay();
			if (dow === 0 || dow === 6) continue;
			if (ciSet[ds] || lvSet[ds] || mpSet[ds]) continue;
			absentDays[days[ab]] = true;
		}
	}

	// ---- 津貼輸入主體 ----
	var selectBar = '<div class="card"><h3>📝 津貼輸入</h3><div class="form-inline">'
		+ '<div><label>月份</label><input type="month" id="fillMonth" value="' + month + '" onchange="changeFilter()"></div>'
		+ '<div><label>人員</label><select id="fillEmp" onchange="changeFilter()" style="min-width:200px"><option value="">選擇人員</option>' + empOpts + '</select></div>'
		+ '</div></div>';

	var formSection = '';
	if (selEmp) {
		var dayBlocks = '';
		for (var di = 0; di < days.length; di++) {
			var dkey = days[di];
			var recs = allowanceMap[dkey] || [];
			var cellCount = Math.max(7, recs.length); // 5 下拉 + 2 預留空位
			var cells = '';
			for (var r = 0; r < cellCount; r++) {
				var rec = recs[r] || null;
				var selOpts = itemOpts;
				if (rec && rec.item_id) {
					var re = new RegExp('value="' + rec.item_id + '"');
					selOpts = selOpts.replace(re, 'value="' + rec.item_id + '" selected');
				}
				var isPlaceholder = !rec && r >= 5;
				cells += '<div class="slot-cell' + (isPlaceholder ? ' placeholder' : '') + '">'
					+ '<select class="alw-item">' + selOpts + '</select>'
					+ '<div class="amt-line">' + (rec && rec.amount ? rec.amount : '') + '</div>'
					+ '</div>';
			}
			dayBlocks += '<div class="day-block" data-eid="' + selEid + '" data-date="' + dkey + '">'
				+ '<div class="day-head"><b>' + month.substring(5) + '-' + dkey + '</b>' + (absentDays[dkey] ? ' <span class="badge badge-warn">未出勤</span>' : '') + '<span>每日合計：<span class="day-total">0</span> 元</span></div>'
				+ '<div class="slot-row">' + cells + '</div>'
				+ '<div style="margin-top:8px"><button type="button" class="btn-sm btn-outline add-entry">＋ 新增下拉</button></div>'
				+ '</div>';
		}
		formSection = '<div class="card"><h3>' + h(selEmp.employee_no) + ' ' + h(selEmp.name) + '（' + h(selEmp.department||'') + '）' + month + ' 津貼</h3>'
			+ '<p>每日第一行選擇津貼項目（預留 2 個可新增下拉），第二行金額由津貼定義自動顯示。儲存後可隨時回來編輯。</p>'
			+ '<div style="margin-bottom:12px;display:flex;align-items:center;gap:12px">' + (highTempId ? '<button type="button" onclick="selectAllHighTemp(' + highTempId + ')" class="btn btn-outline" style="padding:8px 16px">🔥 高溫津貼一次全選</button>' : '') + '<span>📊 當月合計：<b id="monthtotal" style="color:#06c755;font-size:18px">0</b> 元</span></div>'
			+ '<div id="allowForm">' + dayBlocks + '</div>'
			+ '<div style="margin-top:16px"><button onclick="saveAll()" class="btn">💾 全部儲存</button> <span id="saveMsg" style="font-size:13px"></span></div>'
			+ '</div>';
	} else {
		formSection = '<div class="card"><p style="color:#999">⬆️ 請先在上方選擇人員，即可在同一頁面看到該員整個月的津貼輸入。</p></div>';
	}

	var script = '<script>'
		+ 'function changeFilter(){var m=document.getElementById("fillMonth").value;var e=document.getElementById("fillEmp").value;var q="?month="+m;if(e)q+="&eid="+e;location.href="/emp/allowances"+q;}'
		// 重算每日與當月合計（金額來自所選項目的 data-amount）
		+ 'function recalcDay(block){var s=0;block.querySelectorAll(\'.slot-cell\').forEach(function(cell){var sel=cell.querySelector(\'.alw-item\');var amt=0;if(sel&&sel.value){var opt=sel.options[sel.selectedIndex];if(opt&&opt.dataset.amount)amt=parseFloat(opt.dataset.amount)||0;}var line=cell.querySelector(\'.amt-line\');if(line)line.textContent=amt?amt:\'\';s+=amt;});var dt=block.querySelector(\'.day-total\');if(dt)dt.textContent=s;var mt=0;document.querySelectorAll(\'.day-total\').forEach(function(t){mt+=(parseFloat(t.textContent)||0);});document.getElementById(\'monthtotal\').textContent=mt;}'
		// 新增一個下拉格（配對金額行）
		+ 'function addEntry(block){var eid=block.dataset.eid;var date=block.dataset.date;var tpl=block.querySelector(\'.slot-cell\');var cell=tpl.cloneNode(true);cell.querySelector(\'.alw-item\').value=\'\';cell.querySelector(\'.amt-line\').textContent=\'\';cell.classList.remove(\'placeholder\');block.querySelector(\'.slot-row\').appendChild(cell);recalcDay(block);}'
		+ 'function selectAllHighTemp(itemId){document.querySelectorAll(\'.day-block\').forEach(function(blk){var cells=blk.querySelectorAll(\'.slot-cell\');var found=false;cells.forEach(function(c){if(c.querySelector(\'.alw-item\').value===String(itemId))found=true;});if(found)return;var target=null;for(var i=0;i<cells.length;i++){if(!cells[i].querySelector(\'.alw-item\').value){target=cells[i];break;}}if(!target){addEntry(blk);target=blk.querySelector(\'.slot-cell:last-of-type\');}target.querySelector(\'.alw-item\').value=String(itemId);updateDayOptions(blk);recalcDay(blk);});alert(\'🔥 已將高溫津貼全選（未出勤日請個別取消）\');}'
		// 同一天同一項目不可重複選
		+ 'function updateDayOptions(block){var cells=block.querySelectorAll(\'.slot-cell\');var chosen=[];cells.forEach(function(c){if(c.querySelector(\'.alw-item\').value)chosen.push(c.querySelector(\'.alw-item\').value);});cells.forEach(function(c){var sel=c.querySelector(\'.alw-item\');Array.prototype.forEach.call(sel.options,function(opt){opt.disabled=false;});Array.prototype.forEach.call(sel.options,function(opt){if(opt.value&&chosen.indexOf(opt.value)!==-1&&opt.value!==sel.value)opt.disabled=true;});});}'
		// 事件委派
		+ 'document.getElementById(\'allowForm\').addEventListener(\'click\',function(ev){var t=ev.target;if(t.classList.contains(\'add-entry\')){addEntry(t.closest(\'.day-block\'));}});'
		+ 'document.getElementById(\'allowForm\').addEventListener(\'change\',function(ev){var blk=ev.target.closest(\'.day-block\');updateDayOptions(blk);recalcDay(blk);});'
		+ 'document.querySelectorAll(\'.day-block\').forEach(function(blk){updateDayOptions(blk);recalcDay(blk);});'
		+ 'async function saveAll(){'
		+ 'var rows=[];var month=document.getElementById(\'fillMonth\').value;'
		+ 'document.querySelectorAll(\'.day-block\').forEach(function(blk){var eid=parseInt(blk.dataset.eid);var date=blk.dataset.date;'
		+ 'blk.querySelectorAll(\'.slot-cell\').forEach(function(cell){var sel=cell.querySelector(\'.alw-item\');if(sel&&sel.value){'
		+ 'var opt=sel.options[sel.selectedIndex];var amt=parseFloat(opt.dataset.amount)||0;'
		+ 'if(amt>0)rows.push({employee_id:eid,work_date:month+"-"+date,item_id:parseInt(sel.value),amount:amt});'
		+ '}});});'
		+ 'var r=await fetch("/emp/api/allowances",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rows:rows})});'
		+ 'var j=await r.json();var el=document.getElementById(\'saveMsg\');'
		+ 'j.success?el.innerHTML="<span style=\\"color:#06c755\\">✅ 已儲存 "+j.count+" 筆</span>":el.innerHTML="<span style=\\"color:#e74c3c\\">❌ 失敗："+(j.error||"")+"</span>";'
		+ 'setTimeout(function(){el.innerHTML="";},3000);'
		+ '}'
		+ '</script>';

	var body = selectBar + formSection + script;
	res.send(empLayout('津貼輸入', body, supervisor, 'allowances'));
});

// ===== 津貼匯總頁面（每人當月累計津貼金額） =====
router.get('/allowance-summary', authEmp, async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.redirect('/emp/login');
	var month = req.query.month || (new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0'));

	var deptEmployees = await db.listEmployeesByDepartment(supervisor.department);
	var items = await db.listAllowanceItems();
	var activeItems = items.filter(function(it) { return it.active !== false; });

	// 匯總該月該部門津貼
	var rows = await db.getAllowancesByMonth(month, supervisor.department);
	var agg = {};
	for (var i = 0; i < deptEmployees.length; i++) {
		var de = deptEmployees[i];
		agg[de.id] = { no: de.employee_no, name: de.name, dept: de.department||'', total: 0, items: {} };
	}
	for (var j = 0; j < rows.length; j++) {
		var r = rows[j];
		if (!agg[r.employee_id]) continue;
		var amt = parseFloat(r.amount) || 0;
		agg[r.employee_id].total += amt;
		agg[r.employee_id].items[r.item_id] = (agg[r.employee_id].items[r.item_id] || 0) + amt;
	}

	var th = '<th>編號</th><th>姓名</th><th>部門</th><th>當月合計（元）</th>';
	for (var k = 0; k < activeItems.length; k++) th += '<th>' + h(activeItems[k].name) + '</th>';
	var tr = '';
	var totalAll = 0;
	for (var m = 0; m < deptEmployees.length; m++) {
		var em = deptEmployees[m];
		var a = agg[em.id];
		if (a.total <= 0) continue;
		totalAll += a.total;
		tr += '<tr><td>' + h(a.no) + '</td><td>' + h(a.name) + '</td><td>' + h(a.dept) + '</td><td style="font-weight:700;color:#06c755">' + a.total + '</td>';
		for (var n = 0; n < activeItems.length; n++) {
			tr += '<td>' + (a.items[activeItems[n].id] ? a.items[activeItems[n].id] : '') + '</td>';
		}
		tr += '</tr>';
	}

	var body = '<div class="card"><h3>📊 津貼匯總 — ' + h(supervisor.department||'') + ' 部門（' + month + '）</h3>'
		+ '<div class="form-inline" style="margin-bottom:16px"><div><label>月份</label><input type="month" id="sumMonth" value="' + month + '" onchange="changeMonth()"></div></div>'
		+ '<p style="color:#666">顯示每人當月累計津貼金額（含高溫津貼）。僅列當月津貼 > 0 的人員。</p>'
		+ '<table><tr>' + th + '</tr>' + (tr || '<tr><td colspan="' + (activeItems.length + 4) + '">本月尚無津貼紀錄</td></tr>') + '</table>'
		+ '<div style="margin-top:12px;font-size:15px">💰 部門當月合計：<b style="color:#06c755">' + totalAll + '</b> 元</div>'
		+ '<script>function changeMonth(){var m=document.getElementById("sumMonth").value;if(m)location.href="/emp/allowance-summary?month="+m;}</script>';
	res.send(empLayout('津貼匯總', body, supervisor, 'summary'));
});


// ===== 津貼定義頁面（項目管理，主管與管理員皆可維護） =====
router.get('/allowance-items', authEmp, async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.redirect('/emp/login');
	var items = await db.listAllowanceItems();
	var itemRows = '';
	for (var mi = 0; mi < items.length; mi++) {
		var it = items[mi];
		var activeLabel = it.active === false ? '<span class="badge badge-warn">已停用</span>' : '<span class="badge badge-in">啟用</span>';
		itemRows += '<tr>'
			+ '<td>' + h(it.name) + '</td>'
			+ '<td>' + (it.amount || 0) + '</td>'
			+ '<td>' + activeLabel + '</td>'
			+ '<td>'
			+ '<button onclick="editItem(' + it.id + ',\'' + h(it.name) + '\',' + (it.amount||0) + ')" class="btn-sm btn-outline">✏️ 編輯</button> '
			+ '<button onclick="toggleItem(' + it.id + ')" class="btn-sm btn-outline">' + (it.active === false ? '啟用' : '停用') + '</button>'
			+ '</td></tr>';
	}
	var body = '<div class="card"><h3>📋 津貼項目定義</h3><p>定義津貼項目與金額（全公司共用，主管與管理員皆可維護）。津貼輸入時以這些金額自動帶出。</p>'
		+ '<div class="form-inline" style="margin-bottom:12px"><div><label>項目名稱</label><input id="newItemName" placeholder="例如：伙食津貼"></div><div><label>金額（元）</label><input id="newItemAmount" type="number" step="1" placeholder="例如：3000" style="width:140px"></div><div style="align-self:end"><button onclick="addItem()" class="btn btn-sm">➕ 新增</button></div></div>'
		+ '<table><tr><th>名稱</th><th>金額（元）</th><th>狀態</th><th>操作</th></tr>' + (itemRows || '<tr><td colspan="4">尚無津貼項目</td></tr>') + '</table></div>'
		+ '<script>'
		+ 'async function addItem(){var n=document.getElementById("newItemName").value.trim();var a=parseFloat(document.getElementById("newItemAmount").value)||0;if(!n){alert("請輸入項目名稱");return;}'
		+ 'var r=await fetch("/emp/api/allowance-items",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n,amount:a})});'
		+ 'var j=await r.json();j.success?location.reload():alert(j.error);}'
		+ 'async function editItem(id,oldName,oldAmt){var n=prompt("項目名稱：",oldName);if(!n)return;var a=parseFloat(prompt("金額（元）：",oldAmt));if(isNaN(a))a=0;'
		+ 'var r=await fetch("/emp/api/allowance-items/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n,amount:a})});'
		+ 'var j=await r.json();j.success?location.reload():alert(j.error);}'
		+ 'async function toggleItem(id){var r=await fetch("/emp/api/allowance-items/"+id+"/toggle",{method:"PUT"});var j=await r.json();j.success?location.reload():alert(j.error);}'
		+ '</script>';
	res.send(empLayout('津貼定義', body, supervisor, 'items'));
});

// ===== API：批次儲存津貼（逐日，金額以津貼定義為準） =====
router.post('/api/allowances', authEmp, express.json(), async function(req, res) {
	var supervisor = await db.getEmployeeById(req.session.empId);
	if (!supervisor) return res.status(401).json({ error: '未登入' });

	var rows = req.body.rows || [];
	var deptEmployees = await db.listEmployeesByDepartment(supervisor.department);
	var allowedIds = {};
	for (var i = 0; i < deptEmployees.length; i++) allowedIds[deptEmployees[i].id] = true;

	// 允許的項目與金額（金額以定義為準）
	var itemAmount = {};
	var items = await db.listAllowanceItems();
	for (var k = 0; k < items.length; k++) itemAmount[items[k].id] = parseFloat(items[k].amount) || 0;

	var count = 0;
	for (var j = 0; j < rows.length; j++) {
		var row = rows[j];
		if (!allowedIds[row.employee_id]) continue; // 不屬本部門 → 跳過
		if (!row.work_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.work_date))) continue;
		var amt = itemAmount[row.item_id];
		if (!amt) continue; // 無效項目或金額 0
		await db.setAllowance(row.employee_id, String(row.work_date), row.item_id, amt, '', supervisor.id);
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
