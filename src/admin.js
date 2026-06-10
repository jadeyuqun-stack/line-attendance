const express = require('express');
const db = require('./database');
const router = express.Router();

function auth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return req.method === 'GET' ? res.redirect('/admin/login') : res.status(401).json({ error: '未登入' });
}

router.get('/login', (_, res) => {
  res.send(`<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登入</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;display:flex;justify-content:center;align-items:center;min-height:100vh}.box{background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.1);width:100%;max-width:380px}h1{text-align:center;margin-bottom:24px;font-size:22px}label{display:block;margin-bottom:6px;font-weight:600;font-size:14px}input{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin-bottom:16px;font-size:16px}button{width:100%;padding:14px;background:#06c755;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer}</style></head><body><div class="box"><h1>📋 打卡管理系統</h1><form method="POST" action="/admin/login"><label>帳號</label><input name="username" required autofocus><label>密碼</label><input type="password" name="password" required><button type="submit">登入</button></form></div></body></html>`);
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.username === process.env.ADMIN_USERNAME && req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
  res.redirect('/admin/login?err=1');
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

router.get('/', auth, async (_, res) => {
  const s = await db.getTodaySummary();
  const pct = s.total_employees > 0 ? Math.round(s.checked_in / s.total_employees * 100) : 0;
  res.send(page(`${process.env.COMPANY_NAME||'公司'}`, `<h2>📊 ${s.date} 出勤</h2>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0">
      <div class="card"><div class="n">${s.total_employees}</div><div>總人數</div></div>
      <div class="card" style="border-left:4px solid #06c755"><div class="n">${s.checked_in}</div><div>已上班</div></div>
      <div class="card" style="border-left:4px solid #3498db"><div class="n">${s.checked_out}</div><div>已下班</div></div>
      <div class="card" style="border-left:4px solid #f39c12"><div class="n">${s.not_checked_in}</div><div>未打卡</div></div>
    </div>
    <div class="card"><div style="background:#eee;border-radius:8px;height:20px"><div style="width:${pct}%;height:100%;background:#06c755;border-radius:8px"></div></div><p style="margin-top:8px;color:#888">出勤率 ${pct}%</p></div>
    <a href="/admin/records" class="btn">📋 打卡記錄</a> <a href="/admin/employees" class="btn" style="background:#3498db">👥 員工管理</a> <a href="/admin/logout" style="color:#e74c3c">登出</a>`));
});

router.get('/records', auth, async (req, res) => {
  const d = req.query.date || new Date().toISOString().split('T')[0];
  const records = await db.queryCheckins(req.query.eid ? parseInt(req.query.eid) : null, d, d);
  const emps = await db.listActiveEmployees();
  let rows = records.length === 0 ? '<tr><td colspan="7" style="text-align:center">無記錄</td></tr>' : '';
  for (const r of records) {
    const t = new Date(r.check_time);
    rows += `<tr><td>${t.toLocaleDateString('zh-TW')}</td><td>${r.employee_no}</td><td>${r.name}</td><td>${r.department||''}</td><td>${r.type==='check_in'?'🔵上班':'🔴下班'}</td><td>${t.toLocaleTimeString('zh-TW')}</td><td>${r.address||'-'}</td></tr>`;
  }
  let opts = emps.map(e => `<option value="${e.id}">${e.employee_no} ${e.name}</option>`).join('');
  res.send(page('打卡記錄', `<div class="card"><form method="GET"><input type="date" name="date" value="${d}" style="width:auto;display:inline"> <select name="eid" style="width:auto;display:inline"><option value="">全部</option>${opts}</select> <button class="btn">查詢</button></form></div><div class="card"><table><tr><th>日期</th><th>編號</th><th>姓名</th><th>部門</th><th>類型</th><th>時間</th><th>位置</th></tr>${rows}</table></div><a href="/admin">🏠 返回</a>`));
});

router.get('/employees', auth, async (_, res) => {
  const emps = await db.listActiveEmployees();
  let rows = emps.map(e => `<tr><td>${e.employee_no}</td><td>${e.name}</td><td>${e.department||''}</td><td>${e.role}</td><td>${e.line_user_id?'已綁定':'未綁定'}</td><td><button onclick="fetch('/admin/api/employees/'+${e.id}+'/deactivate',{method:'PUT'}).then(()=>location.reload())" style="background:#e74c3c;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer">停用</button></td></tr>`).join('');
  res.send(page('員工管理', `<div class="card"><h3>新增員工</h3><form id="f" style="display:flex;gap:8px;flex-wrap:wrap"><input id="no" placeholder="員工編號" required style="width:auto"><input id="name" placeholder="姓名" required style="width:auto"><input id="dept" placeholder="部門" style="width:auto"><button type="submit" class="btn">新增</button></form></div><div class="card"><table><tr><th>編號</th><th>姓名</th><th>部門</th><th>角色</th><th>LINE</th><th>操作</th></tr>${rows||'<tr><td colspan="6">無員工</td></tr>'}</table></div><a href="/admin">🏠 返回</a><script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const r=await fetch('/admin/api/employees',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({employee_no:document.getElementById('no').value,name:document.getElementById('name').value,department:document.getElementById('dept').value})});const j=await r.json();if(j.success)location.reload();else alert(j.error)}</script>`));
});

router.post('/api/employees', auth, express.json(), async (req, res) => {
  const { employee_no, name, department, role } = req.body;
  if (!employee_no || !name) return res.status(400).json({ error: '必填' });
  const r = await db.createEmployee(employee_no, name, department, role);
  r.success ? res.json(r) : res.status(400).json(r);
});

router.put('/api/employees/:id/deactivate', auth, async (req, res) => {
  await db.deactivateEmployee(parseInt(req.params.id));
  res.json({ success: true });
});

function page(title, body) {
  return `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f0f2f5;min-height:100vh;padding:24px}body>a{color:#06c755;text-decoration:none;margin-right:12px}.card{background:#fff;padding:20px;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:16px}.card .n{font-size:32px;font-weight:700}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:14px}th{background:#fafafa}.btn{padding:10px 18px;background:#06c755;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;text-decoration:none;display:inline-block;margin:4px}input,select{padding:10px;border:1px solid #ddd;border-radius:8px;font-size:14px}h2{margin-bottom:8px}</style></head><body>${body}</body></html>`;
}

module.exports = router;
