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

  // 請假
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      leave_type VARCHAR(20) NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT DEFAULT '',
      status VARCHAR(20) DEFAULT 'pending',
      approved_by INTEGER REFERENCES employees(id),
      approved_at TIMESTAMPTZ,
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
  const defaults = [
    ['company_name', process.env.COMPANY_NAME || '公司'],
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
  const { rowCount } = await pool.query(
    "UPDATE employees SET line_user_id=$1, name=CASE WHEN name='' THEN $2 ELSE name END, updated_at=NOW() WHERE employee_no=$3 AND status='active'",
    [uid, name, no]
  );
  return rowCount > 0;
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
    const { rows } = await pool.query(
      'INSERT INTO employees (employee_no, name, department, role, can_approve) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [no, name, dept || '', role || '員工', canApprove || false]
    );
    return { success: true, id: rows[0].id };
  } catch (e) {
    if (e.code === '23505') return { success: false, error: '員工編號已存在' };
    throw e;
  }
}
async function deactivateEmployee(id) {
  // 軟刪除：保留打卡和請假記錄，只標記離職
  await pool.query("UPDATE employees SET status='inactive', line_user_id=NULL, updated_at=NOW() WHERE id=$1", [id]);
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
  await pool.query(
    "UPDATE leave_requests SET status=$1, approved_by=$2, approved_at=NOW() WHERE id=$3",
    [status, approvedBy, id]
  );
}
async function getLeaveById(id) {
  const { rows } = await pool.query("SELECT * FROM leave_requests WHERE id=$1", [id]);
  return rows[0] || null;
}
async function getEmployeeById(id) {
  const { rows } = await pool.query("SELECT * FROM employees WHERE id=$1", [id]);
  return rows[0] || null;
}
async function findApprovers(forEmployeeId) {
  // 先找該員工指定的簽核人
  if (forEmployeeId) {
    const emp = await getEmployeeById(forEmployeeId);
    if (emp && emp.approver_id) {
      const { rows } = await pool.query(
        "SELECT * FROM employees WHERE id=$1 AND status='active' AND line_user_id IS NOT NULL",
        [emp.approver_id]
      );
      if (rows.length > 0) return rows;
    }
  }
  // 沒有指定 → 找所有 can_approve 的人
  const { rows } = await pool.query(
    "SELECT * FROM employees WHERE can_approve=true AND status='active' AND line_user_id IS NOT NULL"
  );
  return rows;
}
async function setApprover(employeeId, approverId) {
  await pool.query('UPDATE employees SET approver_id=$1 WHERE id=$2',
    [approverId || null, employeeId]);
}
async function listApprovers() {
  const { rows } = await pool.query(
    "SELECT id, name, employee_no FROM employees WHERE can_approve=true AND status='active' ORDER BY employee_no"
  );
  return rows;
}

module.exports = {
  initDatabase,
  getEmployeeByLineId, getEmployeeByNo, bindLineUser, updateLineUserId,
  listActiveEmployees, listInactiveEmployees, createEmployee, deactivateEmployee, updateEmployee,
  recordCheckin, getTodayCheckins, queryCheckins, getTodaySummary,
  getSetting, setSetting,
  createLeaveRequest, getLeaveRequests, updateLeaveStatus, getLeaveById, getEmployeeById, findApprovers, setApprover, listApprovers,
};
