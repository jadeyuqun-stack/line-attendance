const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on('error', function (err) {
  console.error('[DB] pool error (idle client):', err.message);
});

// 強制所有連線使用台北時區，確保 CURRENT_DATE 與 check_time::date 正確
pool.on('connect', async function (client) {
  try {
    await client.query("SET timezone TO 'Asia/Taipei'");
  } catch (e) {
    console.error('[DB] SET timezone failed:', e.message);
  }
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
  try { await pool.query("ALTER TABLE employees ADD COLUMN hire_date TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE employees ADD COLUMN annual_leave_used_manual NUMERIC(5,1) DEFAULT 0"); } catch(e) {}
  try { await pool.query("ALTER TABLE employees ADD COLUMN marriage_leave_total NUMERIC(5,1) DEFAULT 0"); } catch(e) {}
  try { await pool.query("ALTER TABLE employees ADD COLUMN funeral_leave_total NUMERIC(5,1) DEFAULT 0"); } catch(e) {}
  try { await pool.query("ALTER TABLE employees ADD COLUMN comp_leave_total NUMERIC(5,1) DEFAULT 0"); } catch(e) {}
  try { await pool.query("ALTER TABLE employees ADD COLUMN personal_ytd_manual NUMERIC(5,1) DEFAULT 0"); } catch(e) {}
  try { await pool.query("ALTER TABLE employees ADD COLUMN sick_ytd_manual NUMERIC(5,1) DEFAULT 0"); } catch(e) {}
  try { await pool.query("ALTER TABLE employees ADD COLUMN manager_mode TEXT DEFAULT 'normal'"); } catch(e) {}

  // 簽核層級欄位
  try { await pool.query("ALTER TABLE leave_requests ADD COLUMN approval_level INTEGER DEFAULT 1"); } catch(e) {}
  try { await pool.query("ALTER TABLE overtime_requests ADD COLUMN approval_level INTEGER DEFAULT 1"); } catch(e) {}
  // 駁回原因欄位
  try { await pool.query("ALTER TABLE leave_requests ADD COLUMN reject_reason TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE overtime_requests ADD COLUMN reject_reason TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE missed_punch ADD COLUMN reject_reason TEXT DEFAULT ''"); } catch(e) {}

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


  // 待辦通知表（簽核結果推送失敗時使用，免 LINE push 額度）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pending_notifications (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER REFERENCES employees(id),
      message TEXT NOT NULL,
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

  // 效能索引（資料成長後避免全表掃描）
  var indexes = [
    'CREATE INDEX IF NOT EXISTS idx_checkins_employee_date ON checkins(employee_id, check_time)',
    'CREATE INDEX IF NOT EXISTS idx_leaves_employee_status ON leave_requests(employee_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_leaves_type_status ON leave_requests(leave_type, status)',
    'CREATE INDEX IF NOT EXISTS idx_overtime_employee_status ON overtime_requests(employee_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_missed_employee_status ON missed_punch(employee_id, status)',
  ];
  for (var idxSql of indexes) {
    try { await pool.query(idxSql); } catch (e) { /* 索引可能已存在 */ }
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
// 考勤用：排除老闆（老闆不打卡、不列入統計）
async function listAttendanceEmployees() {
  const { rows } = await pool.query("SELECT * FROM employees WHERE status='active' AND (role IS NULL OR role NOT IN ('老闆','boss')) ORDER BY employee_no");
  return rows;
}
// 取得簽核人員負責的員工（L1/L2/L3 任一級）
async function getDesignatedEmployeeIds(approverId) {
  const { rows } = await pool.query(
    "SELECT id, name, employee_no, department FROM employees WHERE status='active' AND (approver_id=$1 OR approver2_id=$1 OR approver3_id=$1) ORDER BY employee_no",
    [approverId]
  );
  return rows;
}
async function createEmployee(no, name, dept, role, canApprove, hireDate) {
  try {
    // 先檢查是否有 inactive 的同編號員工 → 復原
    var { rows: inactive } = await pool.query(
      "SELECT id FROM employees WHERE TRIM(employee_no)=$1 AND status='inactive'",
      [no.trim()]
    );
    if (inactive.length > 0) {
      await pool.query(
        "UPDATE employees SET name=$1, department=$2, role=$3, can_approve=$4, hire_date=$5, status='active', line_user_id=NULL, updated_at=NOW() WHERE id=$6",
        [name, dept || '', role || '員工', canApprove || false, hireDate || '', inactive[0].id]
      );
      return { success: true, id: inactive[0].id, reactivated: true };
    }
    // 新增
    var { rows } = await pool.query(
      'INSERT INTO employees (employee_no, name, department, role, can_approve, hire_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [no.trim(), name, dept || '', role || '員工', canApprove || false, hireDate || '']
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
  const allowed = ['name', 'department', 'role', 'can_approve', 'hire_date', 'annual_leave_used_manual', 'marriage_leave_total', 'funeral_leave_total', 'comp_leave_total', 'manager_mode', 'personal_ytd_manual', 'sick_ytd_manual'];
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
async function deleteCheckin(id) {
  await pool.query('DELETE FROM checkins WHERE id=$1', [id]);
}
async function updateCheckinTime(id, newTime) {
  // newTime 格式：'HH:MM'，保留原有日期，只改時間
  await pool.query(
    "UPDATE checkins SET check_time = (check_time::date || ' ' || $2 || ':00')::timestamp AT TIME ZONE 'Asia/Taipei' WHERE id=$1",
    [id, newTime]
  );
}
async function getTodayCheckins(empId) {
  // 強制使用台北時區比對日期，避免 session timezone 遺失問題
  const { rows } = await pool.query(
    "SELECT * FROM checkins WHERE employee_id=$1 AND (check_time AT TIME ZONE 'Asia/Taipei')::date=(NOW() AT TIME ZONE 'Asia/Taipei')::date ORDER BY check_time",
    [empId]
  );
  return rows;
}
async function queryCheckins(empId, start, end, limit = 200, offset = 0) {
  let sql = `SELECT c.*, COALESCE(e.name, '(已刪除)') AS name, COALESCE(e.employee_no, '-') AS employee_no, COALESCE(e.department, '') AS department FROM checkins c
    LEFT JOIN employees e ON c.employee_id=e.id WHERE 1=1`;
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
async function getCheckinSummary(start, end) {
  var sql = `SELECT
      e.id AS employee_id,
      e.employee_no,
      e.name,
      e.department,
      d.work_date::text,
      MIN(CASE WHEN c.type='check_in' THEN c.check_time END) AS check_in_time,
      MAX(CASE WHEN c.type='check_out' THEN c.check_time END) AS check_out_time
    FROM employees e
    CROSS JOIN generate_series($1::date, $2::date, '1 day'::interval) AS d(work_date)
    LEFT JOIN checkins c ON c.employee_id = e.id AND c.check_time::date = d.work_date
    WHERE e.status = 'active' AND (e.role IS NULL OR e.role NOT IN ('老闆','boss'))
    GROUP BY e.id, e.employee_no, e.name, e.department, d.work_date
    ORDER BY e.employee_no, d.work_date`;
  var { rows } = await pool.query(sql, [start, end]);
  return rows;
}

async function getTodaySummary() {
  const { rows: r1 } = await pool.query("SELECT COUNT(*)::int AS total FROM employees WHERE status='active' AND (role IS NULL OR role NOT IN ('老闆','boss'))");
  const { rows: r2 } = await pool.query("SELECT COUNT(DISTINCT employee_id)::int AS ci FROM checkins WHERE (check_time AT TIME ZONE 'Asia/Taipei')::date=(NOW() AT TIME ZONE 'Asia/Taipei')::date AND type='check_in'");
  const { rows: r3 } = await pool.query("SELECT COUNT(DISTINCT employee_id)::int AS co FROM checkins WHERE (check_time AT TIME ZONE 'Asia/Taipei')::date=(NOW() AT TIME ZONE 'Asia/Taipei')::date AND type='check_out'");
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
async function updateLeaveStatus(id, status, approvedBy, rejectReason) {
  var leave = await getLeaveById(id);
  if (!leave) return;
  console.log('[DB] updateLeaveStatus id='+id+' status='+status+' currentLevel='+(leave.approval_level||1));
  if (status === 'approved') {
    // 檢查該簽核人是否有權限簽核當前層級（不可跳階）
    var empRecord = await getEmployeeById(leave.employee_id);
    var currentLevel = leave.approval_level || 1;
    var levelCol = currentLevel === 1 ? 'approver_id' : 'approver2_id';
    var designatedApprover = empRecord ? empRecord[levelCol] : null;
    var isDesignated = designatedApprover && designatedApprover === approvedBy;
    if (approvedBy !== null && designatedApprover && !isDesignated) {
      console.log('[DB] 跳過：' + approvedBy + ' 不是第 ' + currentLevel + ' 階簽核人（指定為 ' + designatedApprover + '）');
      return { advanced: false, notYourTurn: true };
    }
    var nextLevel = currentLevel + 1;
    console.log('[DB] nextLevel='+nextLevel+' looking for approvers...');
    if (nextLevel <= 2) {
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
    await pool.query("UPDATE leave_requests SET status=$1, approved_by=$2, approved_at=NOW(), reject_reason=$4 WHERE id=$3", [status, approvedBy, id, rejectReason || '']);
    return { advanced: false };
  }
}
async function getLeaveById(id) {
  const { rows } = await pool.query("SELECT * FROM leave_requests WHERE id=$1", [id]);
  return rows[0] || null;
}
async function deleteLeaveRequest(id) {
  await pool.query("DELETE FROM leave_requests WHERE id=$1", [id]);
}
async function getEmployeeById(id) {
  const { rows } = await pool.query("SELECT * FROM employees WHERE id=$1", [id]);
  return rows[0] || null;
}
async function findApprovers(forEmployeeId, level) {
  level = level || 1;
  var col = level === 1 ? 'approver_id' : 'approver2_id';
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
  var col = level === 1 ? 'approver_id' : 'approver2_id';
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
async function updateMissedPunchStatus(id, status, approvedBy, rejectReason) {
  if (approvedBy) {
    await pool.query("UPDATE missed_punch SET status=$1, approved_by=$2, approved_at=NOW(), reject_reason=$4 WHERE id=$3", [status, approvedBy, id, rejectReason || '']);
  } else {
    await pool.query("UPDATE missed_punch SET status=$1, approved_at=NOW(), reject_reason=$3 WHERE id=$2", [status, id, rejectReason || '']);
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

async function clearByDateRange(table, startDate, endDate) {
  var allowed = ['leave_requests', 'overtime_requests', 'checkins', 'missed_punch'];
  if (allowed.indexOf(table) === -1) throw new Error('Invalid table: ' + table);
  if (!startDate) throw new Error('startDate is required');
  var sql, params;
  if (table === 'checkins') {
    sql = "DELETE FROM checkins WHERE check_time::date >= $1";
    params = [startDate];
    if (endDate) { sql += " AND check_time::date <= $2"; params.push(endDate); }
  } else if (table === 'missed_punch') {
    sql = "DELETE FROM missed_punch WHERE punch_date >= $1";
    params = [startDate];
    if (endDate) { sql += " AND punch_date <= $2"; params.push(endDate); }
  } else if (table === 'leave_requests') {
    sql = "DELETE FROM leave_requests WHERE start_date >= $1";
    params = [startDate];
    if (endDate) { sql += " AND start_date <= $2"; params.push(endDate); }
  } else if (table === 'overtime_requests') {
    sql = "DELETE FROM overtime_requests WHERE start_time >= $1";
    params = [startDate];
    if (endDate) { sql += " AND start_time <= $2"; params.push(endDate); }
  }
  var result = await pool.query(sql, params);
  return result.rowCount;
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
async function deleteOvertimeRequest(id) {
  await pool.query("DELETE FROM overtime_requests WHERE id=$1", [id]);
}
async function updateOvertimeStatus(id, status, approvedBy, rejectReason) {
  var ot = await getOvertimeById(id);
  if (!ot) return;
  if (status === 'approved') {
    // 檢查該簽核人是否有權限簽核當前層級（不可跳階）
    var empRecord = await getEmployeeById(ot.employee_id);
    var currentLevel = ot.approval_level || 1;
    var levelCol = currentLevel === 1 ? 'approver_id' : 'approver2_id';
    var designatedApprover = empRecord ? empRecord[levelCol] : null;
    var isDesignated = designatedApprover && designatedApprover === approvedBy;
    if (approvedBy !== null && designatedApprover && !isDesignated) {
      console.log('[DB] 跳過加班：' + approvedBy + ' 不是第 ' + currentLevel + ' 階簽核人（指定為 ' + designatedApprover + '）');
      return { advanced: false, notYourTurn: true };
    }
    var nextLevel = currentLevel + 1;
    if (nextLevel <= 2) {
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


// =========== Annual Leave / Leave Balance ===========
// 計算請假時數（扣除週末、國定假日、午休、上限 8h/天）
// 與 bot.js 的 leaveHours 邏輯一致，但 holidays 由呼叫方傳入
async function calcPeriodHours(startStr, endStr) {
  if (!startStr) return 0;
  var s = new Date(startStr), e = new Date(endStr || startStr);
  var diff = e - s;
  if (diff <= 0) return 0.5;

  // 讀取國定假日
  var holidays = [];
  try {
    var raw = await getSetting('tw_holidays') || '[]';
    holidays = JSON.parse(raw);
  } catch (ex) { holidays = []; }

  var sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var eDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  var total = 0;
  var current = new Date(sDay);
  while (current <= eDay) {
    var dow = current.getDay();
    var ds = current.getFullYear() + '-' + String(current.getMonth() + 1).padStart(2, '0') + '-' + String(current.getDate()).padStart(2, '0');
    if (dow !== 0 && dow !== 6 && holidays.indexOf(ds) === -1) {
      var dayStart = current.getTime() === sDay.getTime() ? s : new Date(current);
      var dayEnd;
      if (current.getTime() === eDay.getTime()) {
        dayEnd = e;
      } else {
        dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 23, 59, 59);
      }
      var dayDiff = dayEnd - dayStart;
      if (dayDiff > 0) {
        var dayRaw = Math.round(dayDiff / 1800000) * 0.5;
        var lunch = (dayStart.getHours() < 12 && dayEnd.getHours() >= 13) ? 1 : 0;
        var dayHours = dayRaw - lunch;
        if (dayHours > 8) dayHours = 8;
        if (dayHours > 0) total += dayHours;
      }
    }
    current.setDate(current.getDate() + 1);
  }
  if (total < 0.5 && startStr === endStr) total = 0.5;
  return total;
}

// 依勞基法計算特休額度
// 年資 = 截至今年 1/1 的服務年數
// 規則: 半年3天、1年7天、2年10天、3年14天、5年15天、10年起+1/年 max30
async function calculateAnnualLeaveEntitlement(hireDate) {
  if (!hireDate) return { entitlement_days: 0, entitlement_hours: 0 };
  var hireStr = hireDate.replace(/\//g, '-');
  var hireParts = hireStr.split('-');
  var hire = new Date(parseInt(hireParts[0]), parseInt(hireParts[1]) - 1, parseInt(hireParts[2]));
  if (isNaN(hire.getTime())) return { entitlement_days: 0, entitlement_hours: 0 };

  var now = new Date();
  var currentYear = now.getFullYear();
  var hireAnniv = new Date(currentYear, hire.getMonth(), hire.getDate());

  // 曆年制：已過今年入職紀念日 → 年資 = 今年 - 入職年；否則減 1
  // refDate 與 hire 同月同日，直接整數相減無浮點誤差
  var yearsOfService = (now >= hireAnniv) ? (currentYear - hire.getFullYear()) : (currentYear - 1 - hire.getFullYear());
  var baseDays = 0;

  if (yearsOfService < 1) {
    // 未滿一年：以天數計算比例
    var sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (hire > sixMonthsAgo) return { entitlement_days: 0, entitlement_hours: 0 }; // 未滿半年
    var dec31 = new Date(currentYear, 11, 31);
    var daysFromHire = Math.round((dec31 - hire) / 86400000) + 1;
    if (daysFromHire < 1) return { entitlement_days: 0, entitlement_hours: 0 };
    var prorated = Math.round(3 * Math.min(daysFromHire, 365) / 365);
    return { entitlement_days: prorated, entitlement_hours: prorated * 8 };
  } else if (yearsOfService < 2) {
    baseDays = 7;
  } else if (yearsOfService < 3) {
    baseDays = 10;
  } else if (yearsOfService < 5) {
    baseDays = 14;
  } else if (yearsOfService < 10) {
    baseDays = 15;
  } else {
    baseDays = Math.min(15 + (yearsOfService - 9), 30);
  }
  return { entitlement_days: baseDays, entitlement_hours: baseDays * 8 };
}

// 查特休餘額（年度重置）
async function getAnnualLeaveBalance(employeeId) {
  var emp = await getEmployeeById(employeeId);
  if (!emp) return { entitlement_days: 0, entitlement_hours: 0, used_hours: 0, remaining_hours: 0 };

  // 若無 hire_date 則以 created_at 代替（既有員工相容）
  var _hireDate = emp.hire_date;
  if (!_hireDate && emp.created_at) {
    var _cd = new Date(emp.created_at);
    _hireDate = _cd.getFullYear() + '-' + ('0' + (_cd.getMonth() + 1)).slice(-2) + '-' + ('0' + _cd.getDate()).slice(-2);
  }
  var calc = await calculateAnnualLeaveEntitlement(_hireDate);
  var entitlementHours = calc.entitlement_hours;

  // 今年已核准特休
  var currentYear = new Date().getFullYear();
  var yearStart = currentYear + '-01-01 00:00';
  var yearEnd = currentYear + '-12-31 23:59';
  var { rows: approved } = await pool.query(
    "SELECT * FROM leave_requests WHERE employee_id=$1 AND leave_type='annual' AND status='approved' AND start_date >= $2 AND start_date <= $3",
    [employeeId, yearStart, yearEnd]
  );
  var systemUsed = 0;
  for (var i = 0; i < approved.length; i++) {
    systemUsed += await calcPeriodHours(approved[i].start_date, approved[i].end_date);
  }

  var manualUsed = parseFloat(emp.annual_leave_used_manual) || 0;
  var totalUsed = systemUsed + manualUsed;
  var remaining = Math.max(0, entitlementHours - totalUsed);

  return {
    entitlement_days: calc.entitlement_days,
    entitlement_hours: entitlementHours,
    used_hours: totalUsed,
    remaining_hours: remaining
  };
}

// 查婚假額度餘額（一次性終身額度）
async function getMarriageLeaveBalance(employeeId) {
  var emp = await getEmployeeById(employeeId);
  if (!emp) return { total_hours: 0, used_hours: 0, remaining_hours: 0 };

  var total = parseFloat(emp.marriage_leave_total) || 0;

  var { rows: approved } = await pool.query(
    "SELECT * FROM leave_requests WHERE employee_id=$1 AND leave_type='marriage' AND status='approved'",
    [employeeId]
  );
  var used = 0;
  for (var i = 0; i < approved.length; i++) {
    used += await calcPeriodHours(approved[i].start_date, approved[i].end_date);
  }
  return { total_hours: total, used_hours: used, remaining_hours: Math.max(0, total - used) };
}

// 查喪假額度餘額（一次性終身額度）

// 查補休額度餘額（一次性終身額度）
async function getCompLeaveBalance(employeeId) {
  var emp = await getEmployeeById(employeeId);
  if (!emp) return { total_hours: 0, used_hours: 0, remaining_hours: 0 };
  var total = parseFloat(emp.comp_leave_total) || 0;
  var { rows: approved } = await pool.query(
    "SELECT * FROM leave_requests WHERE employee_id=$1 AND leave_type='comp' AND status='approved'",
    [employeeId]
  );
  var used = 0;
  for (var i = 0; i < approved.length; i++) {
    used += await calcPeriodHours(approved[i].start_date, approved[i].end_date);
  }
  return { total_hours: total, used_hours: used, remaining_hours: Math.max(0, total - used) };
}

async function getFuneralLeaveBalance(employeeId) {
  var emp = await getEmployeeById(employeeId);
  if (!emp) return { total_hours: 0, used_hours: 0, remaining_hours: 0 };

  var total = parseFloat(emp.funeral_leave_total) || 0;

  var { rows: approved } = await pool.query(
    "SELECT * FROM leave_requests WHERE employee_id=$1 AND leave_type='funeral' AND status='approved'",
    [employeeId]
  );
  var used = 0;
  for (var i = 0; i < approved.length; i++) {
    used += await calcPeriodHours(approved[i].start_date, approved[i].end_date);
  }
  return { total_hours: total, used_hours: used, remaining_hours: Math.max(0, total - used) };
}

// =========== Pending Notifications ===========
async function addPendingNotification(employeeId, message) {
  if (!employeeId || !message) { console.log('[notif] skip: empId='+employeeId+' msg='+message); return; }
  await pool.query('INSERT INTO pending_notifications (employee_id, message) VALUES ($1, $2)', [employeeId, message]);
  console.log('[notif] stored for empId='+employeeId+' msg='+message.substring(0,60));
}
async function getPendingNotifications(employeeId) {
  if (!employeeId) return [];
  var { rows } = await pool.query('SELECT * FROM pending_notifications WHERE employee_id=$1 ORDER BY created_at ASC', [employeeId]);
  if (rows.length > 0) console.log('[notif] retrieved '+rows.length+' for empId='+employeeId);
  return rows;
}
async function clearPendingNotifications(employeeId) {
  if (!employeeId) return;
  await pool.query('DELETE FROM pending_notifications WHERE employee_id=$1', [employeeId]);
}
// =========== 備份 / 還原（管理員匯入匯出） ===========
async function exportAllData() {
  var result = {};
  result.settings = (await pool.query('SELECT * FROM settings ORDER BY key')).rows;
  result.employees = (await pool.query('SELECT * FROM employees ORDER BY id')).rows;
  result.checkins = (await pool.query('SELECT * FROM checkins ORDER BY id')).rows;
  result.leave_requests = (await pool.query('SELECT * FROM leave_requests ORDER BY id')).rows;
  result.overtime_requests = (await pool.query('SELECT * FROM overtime_requests ORDER BY id')).rows;
  result.missed_punch = (await pool.query('SELECT * FROM missed_punch ORDER BY id')).rows;
  result.salary_records = (await pool.query('SELECT * FROM salary_records ORDER BY id')).rows;
  result.pending_notifications = (await pool.query('SELECT * FROM pending_notifications ORDER BY id')).rows;
  result._exported_at = new Date().toISOString();
  result._version = '1.0';
  return result;
}

async function importAllData(data) {
  if (!data || !data.employees) throw new Error('無效的備份檔案：缺少 employees 資料');

  // 在交易中執行：先清空再寫入（FK 順序：無依賴 → 有依賴）
  var client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. 停用 FK 檢查（加速 + 避免順序問題）
    await client.query('SET session_replication_role = replica');

    // 2. 清空所有表（由內而外）
    await client.query('DELETE FROM pending_notifications');
    await client.query('DELETE FROM salary_records');
    await client.query('DELETE FROM missed_punch');
    await client.query('DELETE FROM overtime_requests');
    await client.query('DELETE FROM leave_requests');
    await client.query('DELETE FROM checkins');
    await client.query('DELETE FROM employees');
    await client.query('DELETE FROM settings');

    // 3. 重設序列
    await client.query("ALTER SEQUENCE employees_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE checkins_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE leave_requests_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE overtime_requests_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE missed_punch_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE salary_records_id_seq RESTART WITH 1");
    await client.query("ALTER SEQUENCE pending_notifications_id_seq RESTART WITH 1");

    // 4. 寫入（無 FK 依賴的先）
    if (data.settings && data.settings.length > 0) {
      for (var s of data.settings) {
        await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=$2', [s.key, s.value]);
      }
    }
    if (data.employees && data.employees.length > 0) {
      for (var e of data.employees) {
        await client.query(
          `INSERT INTO employees (id, employee_no, name, department, line_user_id, role, can_approve, status, created_at, updated_at, approver_id, approver2_id, approver3_id, hire_date, annual_leave_used_manual, marriage_leave_total, funeral_leave_total, comp_leave_total, personal_ytd_manual, sick_ytd_manual, manager_mode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           ON CONFLICT (id) DO UPDATE SET name=$3, department=$4, role=$6, can_approve=$7, status=$8, hire_date=$14`,
          [e.id, e.employee_no, e.name, e.department||'', e.line_user_id, e.role||'員工', e.can_approve||false, e.status||'active', e.created_at, e.updated_at,
           e.approver_id, e.approver2_id, e.approver3_id, e.hire_date||'', e.annual_leave_used_manual||0, e.marriage_leave_total||0, e.funeral_leave_total||0,
           e.comp_leave_total||0, e.personal_ytd_manual||0, e.sick_ytd_manual||0, e.manager_mode||'normal']
        );
      }
    }
    // 更新序列到最大值
    if (data.employees.length > 0) {
      var maxEmp = data.employees.reduce(function(m, e) { return e.id > m ? e.id : m; }, 0);
      await client.query("SELECT setval('employees_id_seq', $1)", [maxEmp]);
    }

    if (data.checkins && data.checkins.length > 0) {
      for (var c of data.checkins) {
        await client.query(
          `INSERT INTO checkins (id, employee_id, type, latitude, longitude, address, photo_url, in_range, distance_meters, check_time, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [c.id, c.employee_id, c.type, c.latitude, c.longitude, c.address||'', c.photo_url||'', c.in_range!==false, c.distance_meters||0, c.check_time, c.created_at]
        );
      }
      var maxCk = data.checkins.reduce(function(m, c) { return c.id > m ? c.id : m; }, 0);
      await client.query("SELECT setval('checkins_id_seq', $1)", [maxCk]);
    }

    if (data.leave_requests && data.leave_requests.length > 0) {
      for (var lr of data.leave_requests) {
        await client.query(
          `INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, reason, status, approved_by, approved_at, created_at, approval_level, reject_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date, lr.reason||'', lr.status||'pending', lr.approved_by, lr.approved_at, lr.created_at, lr.approval_level||1, lr.reject_reason||'']
        );
      }
      var maxLr = data.leave_requests.reduce(function(m, l) { return l.id > m ? l.id : m; }, 0);
      await client.query("SELECT setval('leave_requests_id_seq', $1)", [maxLr]);
    }

    if (data.overtime_requests && data.overtime_requests.length > 0) {
      for (var ot of data.overtime_requests) {
        await client.query(
          `INSERT INTO overtime_requests (id, employee_id, start_time, end_time, reason, status, approved_by, approved_at, created_at, approval_level, reject_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [ot.id, ot.employee_id, ot.start_time, ot.end_time, ot.reason||'', ot.status||'pending', ot.approved_by, ot.approved_at, ot.created_at, ot.approval_level||1, ot.reject_reason||'']
        );
      }
      var maxOt = data.overtime_requests.reduce(function(m, o) { return o.id > m ? o.id : m; }, 0);
      await client.query("SELECT setval('overtime_requests_id_seq', $1)", [maxOt]);
    }

    if (data.missed_punch && data.missed_punch.length > 0) {
      for (var mp of data.missed_punch) {
        await client.query(
          `INSERT INTO missed_punch (id, employee_id, punch_type, punch_date, punch_time, reason, status, approved_by, approved_at, created_at, reject_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [mp.id, mp.employee_id, mp.punch_type, mp.punch_date, mp.punch_time, mp.reason||'', mp.status||'pending', mp.approved_by, mp.approved_at, mp.created_at, mp.reject_reason||'']
        );
      }
      var maxMp = data.missed_punch.reduce(function(m, p) { return p.id > m ? p.id : m; }, 0);
      await client.query("SELECT setval('missed_punch_id_seq', $1)", [maxMp]);
    }

    if (data.salary_records && data.salary_records.length > 0) {
      for (var sr of data.salary_records) {
        await client.query(
          `INSERT INTO salary_records (id, employee_id, content, has_image, month_label, created_at)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [sr.id, sr.employee_id, sr.content||'', sr.has_image||false, sr.month_label||'', sr.created_at]
        );
      }
      var maxSr = data.salary_records.reduce(function(m, r) { return r.id > m ? r.id : m; }, 0);
      await client.query("SELECT setval('salary_records_id_seq', $1)", [maxSr]);
    }

    if (data.pending_notifications && data.pending_notifications.length > 0) {
      for (var pn of data.pending_notifications) {
        await client.query(
          'INSERT INTO pending_notifications (id, employee_id, message, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
          [pn.id, pn.employee_id, pn.message, pn.created_at]
        );
      }
      var maxPn = data.pending_notifications.reduce(function(m, n) { return n.id > m ? n.id : m; }, 0);
      await client.query("SELECT setval('pending_notifications_id_seq', $1)", [maxPn]);
    }

    // 5. 恢復 FK 檢查
    await client.query('SET session_replication_role = DEFAULT');

    await client.query('COMMIT');
    return { success: true, counts: {
      settings: data.settings ? data.settings.length : 0,
      employees: data.employees ? data.employees.length : 0,
      checkins: data.checkins ? data.checkins.length : 0,
      leave_requests: data.leave_requests ? data.leave_requests.length : 0,
      overtime_requests: data.overtime_requests ? data.overtime_requests.length : 0,
      missed_punch: data.missed_punch ? data.missed_punch.length : 0,
      salary_records: data.salary_records ? data.salary_records.length : 0,
      pending_notifications: data.pending_notifications ? data.pending_notifications.length : 0,
    }};
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  initDatabase,
  getEmployeeByLineId, getEmployeeByNo, bindLineUser, updateLineUserId,
  listActiveEmployees, listAttendanceEmployees, getDesignatedEmployeeIds, listInactiveEmployees, createEmployee, deactivateEmployee, reactivateEmployee, hardDeleteEmployee, updateEmployee,
  recordCheckin, deleteCheckin, updateCheckinTime, getTodayCheckins, queryCheckins, getCheckinSummary, getTodaySummary,
  getSetting, setSetting,
  createLeaveRequest, getLeaveRequests, getEmployeeLeaveRequests, updateLeaveStatus, getLeaveById, deleteLeaveRequest, getEmployeeById, findApprovers, setApprover, listApprovers,
  saveSalaryRecords, getSalaryRecords, deleteSalaryRecords, clearAll, clearByDateRange,
  createOvertimeRequest, getOvertimeRequests, getOvertimeById, deleteOvertimeRequest, updateOvertimeStatus, getEmployeeOvertimeRequests,
  createMissedPunch, getMissedPunches, getMissedPunchById, updateMissedPunchStatus,
  addPendingNotification, getPendingNotifications, clearPendingNotifications,
  calcPeriodHours, calculateAnnualLeaveEntitlement, getAnnualLeaveBalance, getMarriageLeaveBalance, getFuneralLeaveBalance, getCompLeaveBalance,
  exportAllData, importAllData,
};
