const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id SERIAL PRIMARY KEY,
      employee_no VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      department VARCHAR(100) DEFAULT '',
      line_user_id VARCHAR(100) UNIQUE,
      role VARCHAR(20) DEFAULT 'employee',
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checkins (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      type VARCHAR(10) NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      address VARCHAR(500) DEFAULT '',
      photo_url VARCHAR(500) DEFAULT '',
      check_time TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('company_name', $1) ON CONFLICT DO NOTHING",
    [process.env.COMPANY_NAME || '公司']
  );
  console.log('[DB] PostgreSQL 初始化完成');
}

// Employees
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
async function listActiveEmployees() {
  const { rows } = await pool.query("SELECT * FROM employees WHERE status='active' ORDER BY employee_no");
  return rows;
}
async function createEmployee(no, name, dept, role) {
  try {
    const { rows } = await pool.query(
      'INSERT INTO employees (employee_no, name, department, role) VALUES ($1,$2,$3,$4) RETURNING id',
      [no, name, dept || '', role || 'employee']
    );
    return { success: true, id: rows[0].id };
  } catch (e) {
    if (e.code === '23505') return { success: false, error: '員工編號已存在' };
    throw e;
  }
}
async function deactivateEmployee(id) {
  await pool.query("UPDATE employees SET status='inactive', updated_at=NOW() WHERE id=$1", [id]);
}

// Checkins
async function recordCheckin(empId, type, loc) {
  const { rows } = await pool.query(
    `INSERT INTO checkins (employee_id, type, latitude, longitude, address)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, check_time`,
    [empId, type, loc ? loc.latitude : null, loc ? loc.longitude : null, loc ? loc.address : null]
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
async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows[0] ? rows[0].value : null;
}

module.exports = { initDatabase, getEmployeeByLineId, getEmployeeByNo, bindLineUser, listActiveEmployees, createEmployee, deactivateEmployee, recordCheckin, getTodayCheckins, queryCheckins, getTodaySummary, getSetting };
