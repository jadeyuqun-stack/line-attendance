const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
  // 員工
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      employee_no VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      department VARCHAR(100) DEFAULT '',
      line_user_id VARCHAR(100) UNIQUE,
      role VARCHAR(50) DEFAULT '員工',
      can_approve BOOLEAN DEFAULT false,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 補加舊表欄位
  try { await pool.query('ALTER TABLE employees ADD COLUMN can_approve BOOLEAN DEFAULT false'); } catch(e) {}
  try { await pool.query('ALTER TABLE employees ADD COLUMN approver_id INTEGER REFERENCES employees(id)'); } catch(e) {}
  try { await pool.query('ALTER TABLE employees ADD COLUMN approver2_id INTEGER REFERENCES employees(id)'); } catch(e) {}
  try { await pool.query('ALTER TABLE employees ADD COLUMN approver3_id INTEGER REFERENCES employees(id)'); } catch(e) {}

  // 簽核層級欄位
  try { await pool.query("ALTER TABLE leave_requests ADD COLUMN approval_level INTEGER DEFAULT 1"); } catch(e) {}
  try { await pool.query("ALTER TABLE overtime_requests ADD COLUMN approval_level INTEGER DEFAULT 1"); } catch(e) {}
  // 打卡
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checkins (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      type VARCHAR(10) NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      address VARCHAR(500) DEFAULT '',
      photo_url VARCHAR(500) DEFAULT '',
      in_range BOOLEAN DEFAULT true,
      distance_meters NUMERIC(10,1) DEFAULT 0,
      check_time TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 補加舊表缺少的欄位
  try { await pool.query('ALTER TABLE checkins ADD COLUMN in_range BOOLEAN DEFAULT true'); } catch(e) {}
  try { await pool.query('ALTER TABLE checkins ADD COLUMN distance_meters NUMERIC(10,1) DEFAULT 0'); } catch(e) {}

  // 補加 leave_requests 用 TEXT
  try { await pool.query("ALTER TABLE leave_requests ALTER COLUMN start_date TYPE TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE leave_requests ALTER COLUMN end_date TYPE TEXT"); } catch(e) {}
  try { await pool.query("ALTER TABLE leave_requests ALTER COLUMN approved_at TYPE TEXT"); } catch(e) {}

  // 請假
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      leave_type VARCHAR(20) NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT DEFAULT '',
      status VARCHAR(20) DEFAULT 'pending',
      approved_by INTEGER REFERENCES employees(id),
      approved_at TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // 設定
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  // 預設設定
  // 補打卡記錄表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS missed_punch (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      punch_type VARCHAR(10) NOT NULL,
      punch_date TEXT NOT NULL,
      punch_time TEXT NOT NULL,
      reason TEXT DEFAULT '',
      status VARCHAR(20) DEFAULT 'pending',
      approved_by INTEGER REFERENCES employees(id),
      approved_at TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 加班記錄表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS overtime_requests (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT DEFAULT '',
      status VARCHAR(20) DEFAULT 'pending',
      approved_by INTEGER REFERENCES employees(id),
      approved_at TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 薪資記錄表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salary_records (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
      content TEXT DEFAULT '',
      has_image BOOLEAN DEFAULT false,
      month_label VARCHAR(20) DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const defaults = [
    ['company_name', process.env.COMPANY_NAME || '公司'],
    ['work_start_hour', process.env.WORK_START_HOUR || '8'],
    ['work_end_hour', process.env.WORK_END_HOUR || '17'],
    ['late_buffer_minutes', process.env.LATE_BUFFER_MINUTES || '30'],
    ['office_lat', ''],
    ['office_lng', ''],
    ['gps_range_meters', '200'],
  ];
  for (const [k, v] of defaults) {
    await pool.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT DO NOTHING", [k, v]);
  }
  console.log('[DB] PostgreSQL 初始化完成');
}

// =========== Employees ===========
async function getEmployeeByLineId(uid) {
  const { rows } = await pool.query("SELECT * FROM employees WHERE line_user_id=$1 AND status='active'", [uid]);
  return rows[0] || null;
}
async function getEmployeeByNo(no) {
  const { rows } = await pool.query("SELECT * FROM employees WHERE employee_no=$1 AND status='active'", [no]);
  return rows[0] || null;
}
async function bindLineUser(no, uid, name) {
  // 先找 active 員工
  var { rowCount } = await pool.query(
    "UPDATE employees SET line_user_id=$1, name=CASE WHEN name='' THEN $2 ELSE name END, updated_at=NOW() WHERE TRIM(employee_no)=$3 AND status='active'",
    [uid, name, no.trim()]
  );
  if (rowCount > 0) return true;
  // 找不到 active → 嘗試找 inactive，自動復原
  var { rowCount: rc2 } = await pool.query(
    "UPDATE employees SET line_user_id=$1, status='active', name=CASE WHEN name='' THEN $2 ELSE name END, updated_at=NOW() WHERE TRIM(employee_no)=$3 AND status='inactive'",
    [uid, name, no.trim()]
  );
  return rc2 > 0;
}
async function updateLineUserId(employeeId, lineUserId) {
  try {
    await pool.query("UPDATE employees SET line_user_id=$1, updated_at=NOW() WHERE id=$2", [lineUserId || null, employeeId]);
    return true;
  } catch (e) {
    if (e.code === '23505') return false; // UNIQUE conflict
    throw e;
  }
}
async function listActiveEmployees() {
  const { rows } = await pool.query("SELECT * FROM employees WHERE status='active' ORDER BY employee_no");
  return rows;
}
async function createEmployee(no, name, dept, role, canApprove) {
  try {
    // 先檢查是否有 inactive 的同編號員工 → 復原
    var { rows: inactive } = await pool.query(
      "SELECT id FROM employees WHERE TRIM(employee_no)=$1 AND status='inactive'",
      [no.trim()]
    );
    if (inactive.length > 0) {
      await pool.query(
        "UPDATE employees SET name=$1, department=$2, role=$3, can_approve=$4, status='active', line_user_id=NULL, updated_at=NOW() WHERE id=$5",
        [name, dept || '', role || '員工', canApprove || false, inactive[0].id]
      );
      return { success: true, id: inactive[0].id, reactivated: true };
    }
    // 新增
    var { rows } = await pool.query(
      'INSERT INTO employees (employee_no, name, department, role, can_approve) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [no.trim(), name, dept || '', role || '員工', canApprove || false]
    );
    return { success: true, id: rows[0].id };
  } catch (e) {
    if (e.code === '23505') return { success: false, error: '員工編號已存在（在職中）' };
    throw e;
  }
}
async function deactivateEmployee(id) {
  await pool.query("UPDATE employees SET status='inactive', line_user_id=NULL, updated_at=NOW() WHERE id=$1", [id]);
}
async function hardDeleteEmployee(id) {
  // 清除所有外鍵參照後才刪除員工
  await pool.query('UPDATE employees SET approver_id=NULL WHERE approver_id=$1', [id]);
  await pool.query('UPDATE employees SET approver2_id=NULL WHERE approver2_id=$1', [id]);
  await pool.query('UPDATE employees SET approver3_id=NULL WHERE approver3_id=$1', [id]);
  await pool.query('UPDATE checkins SET employee_id=NULL WHERE employee_id=$1', [id]);
  await pool.query('UPDATE leave_requests SET employee_id=NULL WHERE employee_id=$1', [id]);
  await pool.query('UPDATE leave_requests SET approved_by=NULL WHERE approved_by=$1', [id]);
  await pool.query('UPDATE overtime_requests SET employee_id=NULL WHERE employee_id=$1', [id]);
  await pool.query('UPDATE overtime_requests SET approved_by=NULL WHERE approved_by=$1', [id]);
  await pool.query('UPDATE missed_punch SET employee_id=NULL WHERE employee_id=$1', [id]);
  await pool.query('UPDATE missed_punch SET approved_by=NULL WHERE approved_by=$1', [id]);
  await pool.query('DELETE FROM employees WHERE id=$1', [id]);
}
async function reactivateEmployee(id) {
  await pool.query("UPDATE employees SET status='active', updated_at=NOW() WHERE id=$1", [id]);
}
async function listInactiveEmployees() {
  const { rows } = await pool.query("SELECT * FROM employees WHERE status='inactive' ORDER BY employee_no");
  return rows;
}
async function updateEmployee(id, fields) {
  const allowed = ['name', 'department', 'role', 'can_approve'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(k + '=$' + i++);
      vals.push(fields[k]);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at=NOW()");
  vals.push(id);
  await pool.query('UPDATE employees SET ' + sets.join(', ') + ' WHERE id=$' + i, vals);
}

// =========== Checkins ===========
async function recordCheckin(empId, type, loc, inRange, dist) {
  const { rows } = await pool.query(
    `INSERT INTO checkins (employee_id, type, latitude, longitude, address, in_range, distance_meters)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, check_time`,
    [empId, type,
      loc ? loc.latitude : null, loc ? loc.longitude : null, loc ? loc.address : null,
      inRange !== false, dist || 0]
  );
  return { id: rows[0].id, check_time: rows[0].check_time, type };
}
async function getTodayCheckins(empId) {
  const { rows } = await pool.query(
    "SELECT * FROM checkins WHERE employee_id=$1 AND check_time::date=CURRENT_DATE ORDER BY check_time",
    [empId]
  );
  return rows;
}
async function queryCheckins(empId, start, end, limit = 200, offset = 0) {
  let sql = `SELECT c.*, e.name, e.employee_no, e.department FROM checkins c
    JOIN employees e ON c.employee_id=e.id WHERE 1=1`;
  const p = [];
  let i = 1;
  if (empId) { sql += ` AND c.employee_id=$${i++}`; p.push(empId); }
  if (start) { sql += ` AND c.check_time::date>=$${i++}`; p.push(start); }
  if (end) { sql += ` AND c.check_time::date<=$${i++}`; p.push(end); }
  sql += ` ORDER BY c.check_time DESC LIMIT $${i++} OFFSET $${i++}`;
  p.push(limit, offset);
  const { rows } = await pool.query(sql, p);
  return rows;
}
async function getTodaySummary() {
  const { rows: r1 } = await pool.query("SELECT COUNT(*)::int AS total FROM employees WHERE status='active'");
  const { rows: r2 } = await pool.query("SELECT COUNT(DISTINCT employee_id)::int AS ci FROM checkins WHERE check_time::date=CURRENT_DATE AND type='check_in'");
  const { rows: r3 } = await pool.query("SELECT COUNT(DISTINCT employee_id)::int AS co FROM checkins WHERE check_time::date=CURRENT_DATE AND type='check_out'");
  return {
    date: new Date().toLocaleDateString('zh-TW'),
    total_employees: r1[0].total,
    checked_in: r2[0].ci,
    checked_out: r3[0].co,
    not_checked_in: r1[0].total - r2[0].ci
  };
}

// =========== Settings ===========
async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows[0] ? rows[0].value : null;
}
async function setSetting(key, value) {
  await pool.query("INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2", [key, value]);
}

// =========== Leave ===========
async function createLeaveRequest(empId, leaveType, startDate, endDate, reason) {
  const { rows } = await pool.query(
    `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [empId, leaveType, startDate, endDate, reason]
  );
  return rows[0].id;
}
async function getEmployeeLeaveRequests(employeeId, status, limit = 100) {
  var sql = `SELECT lr.*, e.name, e.employee_no, e.department FROM leave_requests lr
    JOIN employees e ON lr.employee_id=e.id WHERE lr.employee_id=$1`;
  var p = [employeeId];
  var i = 2;
  if (status) { sql += ' AND lr.status=$' + i++; p.push(status); }
  sql += ' ORDER BY lr.created_at DESC LIMIT $' + i; p.push(limit);
  var { rows } = await pool.query(sql, p);
  return rows;
}

async function getLeaveRequests(status, limit = 100) {
  let sql = `SELECT lr.*, e.name, e.employee_no, e.department FROM leave_requests lr
    JOIN employees e ON lr.employee_id=e.id WHERE 1=1`;
  const p = [];
  let i = 1;
  if (status) { sql += ` AND lr.status=$${i++}`; p.push(status); }
  sql += ` ORDER BY lr.created_at DESC LIMIT $${i++}`;
  p.push(limit);
  const { rows } = await pool.query(sql, p);
  return rows;
}
async function updateLeaveStatus(id, status, approvedBy) {
  var leave = await getLeaveById(id);
  if (!leave) return;
  console.log('[DB] updateLeaveStatus id='+id+' status='+status+' currentLevel='+(leave.approval_level||1));
  if (status === 'approved') {
    var nextLevel = (leave.approval_level || 1) + 1;
    console.log('[DB] nextLevel='+nextLevel+' looking for approvers...');
    if (nextLevel <= 3) {
      var nextApprovers = await findApprovers(leave.employee_id, nextLevel);
      console.log('[DB] found '+nextApprovers.length+' approvers for level '+nextLevel);
      if (nextApprovers.length > 0) {
        await pool.query("UPDATE leave_requests SET approval_level=$1, approved_by=$2, approved_at=NOW() WHERE id=$3", [nextLevel, approvedBy, id]);
        return { advanced: true, level: nextLevel, approvers: nextApprovers };
      }
    }
    await pool.query("UPDATE leave_requests SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2", [approvedBy, id]);
    return { advanced: false };
  } else {
    await pool.query("UPDATE leave_requests SET status=$1, approved_by=$2, approved_at=NOW() WHERE id=$3", [status, approvedBy, id]);
    return { advanced: false };
  }
}
async function getLeaveById(id) {
  const { rows } = await pool.query("SELECT * FROM leave_requests WHERE id=$1", [id]);
  return rows[0] || null;
}
async function getEmployeeById(id) {
  const { rows } = await pool.query("SELECT * FROM employees WHERE id=$1", [id]);
  return rows[0] || null;
}
async function findApprovers(forEmployeeId, level) {
  level = level || 1;
  var col = level === 1 ? 'approver_id' : level === 2 ? 'approver2_id' : 'approver3_id';
  console.log('[DB] findApprovers empId='+forEmployeeId+' level='+level+' col='+col);
  if (forEmployeeId) {
    var emp = await getEmployeeById(forEmployeeId);
    console.log('[DB] emp has '+col+':', emp ? emp[col] : 'emp is null');
    if (emp && emp[col]) {
      var { rows } = await pool.query(
        "SELECT * FROM employees WHERE id=$1 AND status='active' AND line_user_id IS NOT NULL",
        [emp[col]]
      );
      console.log('[DB] found '+rows.length+' approvers with LINE bound');
      if (rows.length > 0) return rows;
    }
  }
  console.log('[DB] no approvers found for level '+level);
  return [];
}
async function setApprover(employeeId, approverId, level) {
  var col = level === 1 ? 'approver_id' : level === 2 ? 'approver2_id' : 'approver3_id';
  await pool.query('UPDATE employees SET '+col+'=$1 WHERE id=$2', [approverId || null, employeeId]);
}
async function listApprovers() {
  const { rows } = await pool.query(
    "SELECT id, name, employee_no FROM employees WHERE can_approve=true AND status='active' ORDER BY employee_no"
  );
  return rows;
}

// =========== Salary records ===========
async function saveSalaryRecords(records, monthLabel) {
  for (var r of records) {
    await pool.query(
      'INSERT INTO salary_records (employee_id, content, has_image, month_label) VALUES ($1,$2,$3,$4)',
      [r.id, r.content, r.hasImg || false, monthLabel || '']
    );
  }
}
async function getSalaryRecords() {
  var { rows } = await pool.query(
    "SELECT sr.*, e.name, e.employee_no, e.department, e.line_user_id FROM salary_records sr JOIN employees e ON sr.employee_id=e.id ORDER BY sr.created_at DESC LIMIT 500"
  );
  return rows;
}
// Missed punch
async function createMissedPunch(empId, punchType, punchDate, punchTime, reason) {
  var { rows } = await pool.query(
    'INSERT INTO missed_punch (employee_id, punch_type, punch_date, punch_time, reason) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [empId, punchType, punchDate, punchTime, reason]
  );
  return rows[0].id;
}
async function getMissedPunches(status, limit) {
  limit = limit || 200;
  var sql = 'SELECT mp.*, e.name, e.employee_no, e.department FROM missed_punch mp JOIN employees e ON mp.employee_id=e.id WHERE 1=1';
  var p = [], i = 1;
  if (status) { sql += ' AND mp.status=$' + i++; p.push(status); }
  sql += ' ORDER BY mp.created_at DESC LIMIT $' + i; p.push(limit);
  var { rows } = await pool.query(sql, p);
  return rows;
}
async function getMissedPunchById(id) {
  var { rows } = await pool.query('SELECT * FROM missed_punch WHERE id=$1', [id]);
  return rows[0] || null;
}
async function updateMissedPunchStatus(id, status, approvedBy) {
  if (approvedBy) {
    await pool.query("UPDATE missed_punch SET status=$1, approved_by=$2, approved_at=NOW() WHERE id=$3", [status, approvedBy, id]);
  } else {
    await pool.query("UPDATE missed_punch SET status=$1, approved_at=NOW() WHERE id=$2", [status, id]);
  }
  // 若核准，自動寫入打卡記錄
  if (status === 'approved') {
    var mp = await getMissedPunchById(id);
    if (mp) {
      var dt = mp.punch_date + ' ' + mp.punch_time;
      await pool.query(
        'INSERT INTO checkins (employee_id, type, check_time) VALUES ($1,$2,$3)',
        [mp.employee_id, mp.punch_type, dt]
      );
    }
  }
}

async function deleteSalaryRecords() {
  await pool.query('DELETE FROM salary_records');
}
async function clearAll(table) {
  var allowed = ['leave_requests', 'overtime_requests', 'checkins'];
  if (allowed.indexOf(table) !== -1) await pool.query('DELETE FROM ' + table);
}

// Overtime
async function createOvertimeRequest(empId, startTime, endTime, reason) {
  var { rows } = await pool.query(
    'INSERT INTO overtime_requests (employee_id, start_time, end_time, reason) VALUES ($1,$2,$3,$4) RETURNING id',
    [empId, startTime, endTime, reason]
  );
  return rows[0].id;
}
async function getOvertimeRequests(status, limit) {
  limit = limit || 200;
  var sql = 'SELECT ot.*, e.name, e.employee_no, e.department FROM overtime_requests ot JOIN employees e ON ot.employee_id=e.id WHERE 1=1';
  var p = [], i = 1;
  if (status) { sql += ' AND ot.status=$' + i++; p.push(status); }
  sql += ' ORDER BY ot.created_at DESC LIMIT $' + i; p.push(limit);
  var { rows } = await pool.query(sql, p);
  return rows;
}
async function getOvertimeById(id) {
  var { rows } = await pool.query('SELECT * FROM overtime_requests WHERE id=$1', [id]);
  return rows[0] || null;
}
async function updateOvertimeStatus(id, status, approvedBy) {
  var ot = await getOvertimeById(id);
  if (!ot) return;
  if (status === 'approved') {
    var nextLevel = (ot.approval_level || 1) + 1;
    if (nextLevel <= 3) {
      var nextApprovers = await findApprovers(ot.employee_id, nextLevel);
      if (nextApprovers.length > 0) {
        await pool.query("UPDATE overtime_requests SET approval_level=$1, approved_by=$2, approved_at=NOW() WHERE id=$3", [nextLevel, approvedBy, id]);
        return { advanced: true, level: nextLevel, approvers: nextApprovers };
      }
    }
    await pool.query("UPDATE overtime_requests SET status='approved', approved_by=$1, approved_at=NOW() WHERE id=$2", [approvedBy, id]);
    return { advanced: false };
  } else {
    await pool.query("UPDATE overtime_requests SET status=$1, approved_by=$2, approved_at=NOW() WHERE id=$3", [status, approvedBy, id]);
    return { advanced: false };
  }
}
async function getEmployeeOvertimeRequests(employeeId, status, limit) {
  limit = limit || 50;
  var sql = 'SELECT * FROM overtime_requests WHERE employee_id=$1';
  var p = [employeeId], i = 2;
  if (status) { sql += ' AND status=$' + i++; p.push(status); }
  sql += ' ORDER BY created_at DESC LIMIT $' + i; p.push(limit);
  var { rows } = await pool.query(sql, p);
  return rows;
}

module.exports = {
  initDatabase,
  getEmployeeByLineId, getEmployeeByNo, bindLineUser, updateLineUserId,
  listActiveEmployees, listInactiveEmployees, createEmployee, deactivateEmployee, reactivateEmployee, hardDeleteEmployee, updateEmployee,
  recordCheckin, getTodayCheckins, queryCheckins, getTodaySummary,
  getSetting, setSetting,
  createLeaveRequest, getLeaveRequests, getEmployeeLeaveRequests, updateLeaveStatus, getLeaveById, getEmployeeById, findApprovers, setApprover, listApprovers,
  saveSalaryRecords, getSalaryRecords, deleteSalaryRecords, clearAll,
  createOvertimeRequest, getOvertimeRequests, getOvertimeById, updateOvertimeStatus, getEmployeeOvertimeRequests,
  createMissedPunch, getMissedPunches, getMissedPunchById, updateMissedPunchStatus,
};
