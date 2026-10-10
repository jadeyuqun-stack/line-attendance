/**
 * 自動化備份腳本 — GitHub Actions 每日呼叫
 * 輸出格式與 database.js exportAllData() 完全一致，可直接用後台還原
 */
var { Pool } = require('pg');

var pool = new Pool({
	connectionString: process.env.DATABASE_URL,
	ssl: { rejectUnauthorized: false },
});

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

async function main() {
	try {
		var data = await exportAllData();
		var fs = require('fs');
		var path = require('path');
		var outPath = path.join(__dirname, '..', '..', 'latest-backup.json');
		fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
		console.log('Backup complete: ' + outPath);
		console.log('  employees: ' + data.employees.length);
		console.log('  checkins: ' + data.checkins.length);
		console.log('  leave_requests: ' + data.leave_requests.length);
		console.log('  overtime_requests: ' + data.overtime_requests.length);
		console.log('  missed_punch: ' + data.missed_punch.length);
		console.log('  salary_records: ' + data.salary_records.length);
		console.log('  settings: ' + data.settings.length);
		console.log('  pending_notifications: ' + data.pending_notifications.length);
		await pool.end();
	} catch (e) {
		console.error('Backup failed:', e.message);
		await pool.end();
		process.exit(1);
	}
}

main();
