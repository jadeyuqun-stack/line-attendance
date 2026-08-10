/**
 * 薪資單預覽圖生成腳本（參考標準薪資單格式）
 * 讀取 Salary sample 07.xlsx + 備份資料（入職日/假期/工號），產出薪資單 PNG
 * 用法：node scripts/gen-salary-preview.js [來源xlsx] [輸出資料夾] [員工名(選填)]
 */
var XLSX = require('xlsx');
var canvas = require('canvas');
var fs = require('fs');
var path = require('path');

var SRC = process.argv[2] || 'Salary sample 07.xlsx';
var OUT = process.argv[3] || 'salary-preview-07';
var filterName = process.argv[4] || '';
var TITLE = '115年7月薪資';

canvas.registerFont('/System/Library/Fonts/STHeiti Medium.ttc', { family: 'CnFont' });
canvas.registerFont('/System/Library/Fonts/STHeiti Light.ttc', { family: 'CnFontLight' });

var wb = XLSX.readFile(SRC);
var ws = wb.Sheets[wb.SheetNames[0]];
var colLetters = ['B', 'E', 'H', 'K'];

// 備份資料（入職日/假期/工號/部門）
var empExtra = {};
try {
  var backup = JSON.parse(fs.readFileSync('/tmp/latest-backup.json', 'utf8'));
  backup.employees.forEach(function(e) {
    var nn = String(e.name).replace(/褀/g, '祺');   // 統一異體字（葉宗祺/褀）
    empExtra[nn] = { hire_date: e.hire_date, dept: e.department, role: e.role, no: e.employee_no };
  });
} catch (e) { console.log('未載入備份資料（入職日/假期）:', e.message); }

function addr(col, row) { return col + row; }
function nextCol(letter) { return String.fromCharCode(letter.charCodeAt(0) + 1); }

// 職稱：直接取員工角色；舊角色映射到新職稱
function titleFor(extra) {
  var r = extra.role;
  if (!r) return '';
  if (r === '老闆' || r === 'boss') return '董事長';
  if (r === '員工' || r === '一般員工' || r === '簽核人員') {
    var d = extra.dept;
    if (d === '採樣') return '採樣工程師';
    if (d === '分析') return '分析工程師';
    if (d === '業務') return '業務專員';
    return '行政人員';
  }
  return r;
}

// 西元 → 民國（YYYY/MM/DD → YYY/MM/DD）
function rocDate(str) {
  if (!str) return '';
  var s = String(str).replace(/-/g, '/');
  var parts = s.split('/');
  if (parts.length >= 3) {
    var y = parseInt(parts[0]);
    if (y > 1911) y -= 1911;
    return String(y).padStart(3, '0') + '/' + parts[1] + '/' + parts[2];
  }
  return s;
}

var titles = [];
for (var r = 2; r <= 400; r++) {
  for (var i = 0; i < colLetters.length; i++) {
    var c = ws[addr(colLetters[i], r)];
    if (c && c.v === TITLE) titles.push({ row: r, colIdx: i });
  }
}

function fmtAmt(v) {
  if (v === null || v === undefined || v === '') return '';
  var n = Number(v);
  if (isNaN(n)) return String(v);
  n = Math.round(n);   // 金額進位到整數
  var s = Math.abs(n).toLocaleString('en-US');
  return (n < 0 ? '-' : '') + s;
}

function isNum(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return true;
  return !isNaN(Number(String(v).replace(/,/g, '')));
}

function sumRows(rows) { var s = 0; for (var i = 0; i < rows.length; i++) s += rows[i].value; return s; }

var employees = [];
for (var t = 0; t < titles.length; t++) {
  var title = titles[t];
  var valueCol = nextCol(colLetters[title.colIdx]);
  var nameCell = ws[addr(valueCol, title.row + 1)];
  var name = nameCell ? nameCell.v : null;
  if (!name) continue;

  var endRow = 400;
  for (var t2 = t + 1; t2 < titles.length; t2++) {
    if (titles[t2].colIdx === title.colIdx && titles[t2].row > title.row) { endRow = titles[t2].row; break; }
  }

  var items = [];
  for (var rr = title.row + 2; rr < endRow; rr++) {
    var lc = ws[addr(colLetters[title.colIdx], rr)];
    var vc = ws[addr(valueCol, rr)];
    var label = lc ? lc.v : null;
    var value = vc ? vc.v : null;
    if (value === null || value === undefined || value === '') continue;
    if (!isNum(value)) continue;
    if (!label || String(label).trim() === '') label = items.length > 0 ? items[items.length - 1].label : '本    薪';
    items.push({ label: String(label).replace(/\s+/g, ' ').trim(), value: Number(String(value).replace(/,/g, '')) });
  }
  employees.push({ name: String(name), items: items });
}

// ===== 分類 =====
var DED_LABELS = ['請假', '代扣', '自提6%', '餐費', '所得稅'];
var SKIP_LABELS = ['月薪小計', '日薪小計', '薪資合計', '扣款小計', '匯入金額', '現金', '勞退6%(入個戶)', '工作天數', '工作獎金'];
var DAILY_BASE = ['伙食津貼', '加班津貼', '專業.外勤津貼'];

function categorize(items) {
  var baseSalary = 0, bonus = 0, extras = [], ded = [], non = [];
  var days = null, dailyBreak = [], cash = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    var lb = it.label;
    var lbKey = lb.replace(/\s/g, '');   // 去空格（本 薪(30) → 本薪(30)）
    if (lbKey.indexOf('本薪') === 0) { baseSalary += it.value; continue; }   // 多筆本薪合併
    if (lb.indexOf('工作天數') !== -1) { days = it.value; continue; }
    if (lb.indexOf('日薪小計') !== -1 || lb.indexOf('日薪總計') !== -1) continue;
    if (lb.indexOf('現金') !== -1) { cash = Math.abs(it.value); continue; }   // 現金(日薪減扣款)
    if (lb === '勞退6%') { non.push(it); continue; }
    if (lb.indexOf('工作獎金') !== -1) { bonus += it.value; continue; }
    if (SKIP_LABELS.some(function(k) { return lb.indexOf(k) !== -1; })) continue;
    if (DAILY_BASE.indexOf(lb) !== -1) { dailyBreak.push(it); continue; }
    if (DED_LABELS.some(function(k) { return lb.indexOf(k) !== -1; })) { ded.push({ label: lb, value: Math.abs(it.value) }); continue; }
    if (it.value < 0) ded.push({ label: lb, value: Math.abs(it.value) });
    else extras.push(it);   // 加班津貼XXhr、外勤差旅、獎金等
  }
  // 日薪總計 = 日薪小計(伙食+加班+外勤) × 工作天數
  var dailySub = sumRows(dailyBreak);
  var dailyTotal = (days != null && days > 0) ? Math.round(dailySub * days * 100) / 100 : dailySub;
  // 應付排列：本薪 → 日薪總計 → 工作獎金 → 其他加項
  var mainEarn = [];
  if (baseSalary > 0) mainEarn.push({ label: '本薪', value: baseSalary });
  if (dailyTotal > 0) mainEarn.push({ label: '日薪總計', value: dailyTotal });
  if (bonus > 0) mainEarn.push({ label: '工作獎金', value: bonus });
  for (var x = 0; x < extras.length; x++) mainEarn.push(extras[x]);
  return { mainEarn: mainEarn, dailySub: dailySub, days: days, dailyTotal: dailyTotal, dailyBreak: dailyBreak, ded: ded, non: non, cash: cash };
}

// 入職日週期：入職日 ~ 隔年入職日前天
function leavePeriod(hire) {
  if (!hire) return '';
  var hh = String(hire).split('/');
  var hireD = new Date(Number(hh[0]), Number(hh[1]) - 1, Number(hh[2]));
  var now = new Date(2026, 7, 9);
  var annivThis = new Date(2026, hireD.getMonth(), hireD.getDate());
  var start, end;
  if (now >= annivThis) { start = annivThis; end = new Date(2027, hireD.getMonth(), hireD.getDate()); }
  else { start = new Date(2025, hireD.getMonth(), hireD.getDate()); end = annivThis; }
  end.setDate(end.getDate() - 1);
  function f(d) { return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0'); }
  return rocDate(f(start)) + ' ~ ' + rocDate(f(end));
}

// ===== 精確特休（與 database.js getAnnualLeaveBalance 一致） =====
// 工時計算（不含國定假日，週末跳過，扣午休，每日上限 8h，0.5 進位）
function calcPeriodHours(startStr, endStr) {
  if (!startStr) return 0;
  var s = new Date(startStr), e = new Date(endStr || startStr);
  var diff = e - s;
  if (diff <= 0) return 0.5;
  var sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var eDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  var total = 0;
  var current = new Date(sDay);
  while (current <= eDay) {
    var dow = current.getDay();
    if (dow !== 0 && dow !== 6) {
      var dayStart = (current.getTime() === sDay.getTime()) ? s : new Date(current);
      if (current.getTime() !== sDay.getTime()) {
        var _ws = new Date(current); _ws.setHours(8, 0, 0, 0);
        if (dayStart < _ws) dayStart = _ws;
      }
      var dayEnd;
      if (current.getTime() === eDay.getTime()) {
        dayEnd = e;
      } else {
        var _we17 = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 17, 0, 0);
        var _eT = new Date(current.getFullYear(), current.getMonth(), current.getDate(), e.getHours(), e.getMinutes(), 0);
        dayEnd = _eT > _we17 ? _eT : _we17;
      }
      var dayDiff = dayEnd - dayStart;
      if (dayDiff > 0) {
        var dayRaw = Math.round(dayDiff / 1800000) * 0.5;
        var _ls7 = new Date(dayStart); _ls7.setHours(12, 0, 0, 0);
        var _le7 = new Date(dayStart); _le7.setHours(13, 0, 0, 0);
        var _os7 = dayStart > _ls7 ? dayStart : _ls7;
        var _oe7 = dayEnd < _le7 ? dayEnd : _le7;
        var lunch = _os7 < _oe7 ? Math.round((_oe7 - _os7) / 1800000) * 0.5 : 0;
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

// 特休額度（曆年制，與 calculateAnnualLeaveEntitlement 一致）
function calcEntitlement(hireDate) {
  if (!hireDate) return { d: 0, h: 0 };
  var hp = String(hireDate).replace(/\//g, '-').split('-');
  var hire = new Date(parseInt(hp[0]), parseInt(hp[1]) - 1, parseInt(hp[2]));
  if (isNaN(hire.getTime())) return { d: 0, h: 0 };
  var now = new Date(2026, 7, 9);
  var currentYear = now.getFullYear();
  var hireAnniv = new Date(currentYear, hire.getMonth(), hire.getDate());
  var yearsOfService = (now >= hireAnniv) ? (currentYear - hire.getFullYear()) : (currentYear - 1 - hire.getFullYear());
  if (yearsOfService < 1) {
    var sixMonthMark = new Date(hire.getFullYear(), hire.getMonth() + 6, hire.getDate());
    if (now < sixMonthMark) return { d: 0, h: 0 };
    var dec31 = new Date(currentYear, 11, 31);
    var daysFromHire = Math.round((dec31 - hire) / 86400000) + 1;
    var prorated = Math.round(3 * Math.min(daysFromHire, 365) / 365);
    return { d: prorated, h: prorated * 8 };
  } else if (yearsOfService < 2) return { d: 7, h: 56 };
  else if (yearsOfService < 3) return { d: 10, h: 80 };
  else if (yearsOfService < 5) return { d: 14, h: 112 };
  else if (yearsOfService < 10) return { d: 15, h: 120 };
  else { var days = Math.min(15 + (yearsOfService - 9), 30); return { d: days, h: days * 8 }; }
}

// 計算假期資訊（特休：額度 - 已核准已用）
function computeLeave(name) {
  var usedAnnual = 0;
  var hire = null;
  try {
    var backup = JSON.parse(fs.readFileSync('/tmp/latest-backup.json', 'utf8'));
    var emp = backup.employees.find(function(e) { return String(e.name).replace(/褀/g, '祺') === name; });
    if (emp) hire = emp.hire_date;
    var yearStart = '2026-01-01';
    backup.leave_requests.forEach(function(l) {
      if (l.employee_id !== emp.id || l.status !== 'approved') return;
      var s = String(l.start_date).substring(0, 10);
      if (s < yearStart) return;
      if (l.leave_type !== 'annual') return;
      usedAnnual += calcPeriodHours(l.start_date, l.end_date || l.start_date);
    });
    // 手動補登時數（後台 annual_leave_used_manual）
    if (emp && emp.annual_leave_used_manual) usedAnnual += parseFloat(emp.annual_leave_used_manual) || 0;
  } catch (e) {}
  var ent = calcEntitlement(hire);
  var remaining = Math.max(0, Math.round((ent.h - usedAnnual) * 10) / 10);
  return {
    name: '特休', used: Math.round(usedAnnual * 10) / 10, remaining: remaining,
    pending: 0, prevBal: 0, thisGrant: ent.h, settled: remaining,
    afterPending: remaining, period: leavePeriod(hire)
  };
}
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function render(emp) {
  var cat = categorize(emp.items);
  var earn = cat.mainEarn, ded = cat.ded, non = cat.non;
  var A = sumRows(earn), B = sumRows(ded), nonSum = sumRows(non);
  var net = Math.round((A - B) * 100) / 100;   // 最終金額進位到小數2位
  var extra = empExtra[emp.name] || {};

  var W = 1500, M = 50, COL_W = (W - M * 2) / 3;
  var INFO_H = 40, TH_H = 46, ROW_H = 40;
  var titleH = 120, infoH = 3 * INFO_H + 10;
  var maxRows = Math.max(earn.length, ded.length, non.length) + 2; // +2 明細行
  var tableH = TH_H + maxRows * ROW_H + 2 * ROW_H;
  var holidayH = 250, noteH = 110;
  var H = titleH + infoH + tableH + holidayH + noteH + 60;

  var cv = canvas.createCanvas(W, H);
  var ctx = cv.getContext('2d');
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  var y = 0;

  // ===== 公司標題 =====
  ctx.fillStyle = '#2f5496';
  ctx.fillRect(0, y, W, titleH);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px CnFont';
  ctx.textAlign = 'center';
  ctx.fillText('玉群環境科技', W / 2, y + 48);
  ctx.font = 'bold 28px CnFont';
  ctx.fillText(TITLE, W / 2, y + 96);
  y += titleH;

  // ===== 員工資訊 =====
  ctx.font = '22px CnFont';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#333';
  var titleName = titleFor(extra);
  var infoRows = [
    '工號：' + (extra.no || emp.name) + '　　姓名：' + emp.name + '　　部門：' + (extra.dept || '') + '　　到職日期：' + rocDate(extra.hire_date),
    '發放日期：' + rocDate('2026-08-10') + '　　結算區間：' + rocDate('2026-07-01') + ' ~ ' + rocDate('2026-07-31') + '　　職稱：' + titleName,
  ];
  for (var i = 0; i < infoRows.length; i++) { ctx.fillText(infoRows[i], M, y + INFO_H / 2); y += INFO_H; }
  ctx.strokeStyle = '#2f5496'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  y += 14;

  // ===== 三欄表格（無時數欄） =====
  var tableTop = y;
  var x1 = M, x2 = M + COL_W, x3 = M + COL_W * 2;

  function colHeader(cx, title) {
    ctx.fillStyle = '#2f5496';
    ctx.fillRect(cx, y, COL_W, TH_H);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px CnFont';
    ctx.textAlign = 'center';
    ctx.fillText(title, cx + COL_W / 2, y + TH_H / 2);
  }
  colHeader(x1, '應付項目'); colHeader(x2, '應扣項目'); colHeader(x3, '不計入項目');
  y += TH_H;

  ctx.font = 'bold 18px CnFont';
  ctx.fillStyle = '#444';
  for (var c = 0; c < 3; c++) {
    var cx = M + c * COL_W;
    ctx.textAlign = 'left'; ctx.fillText('項目', cx + 16, y + ROW_H / 2);
    ctx.textAlign = 'right'; ctx.fillText('金額', cx + COL_W - 16, y + ROW_H / 2);
  }
  y += ROW_H;

  function drawRowAt(cx, ry, label, value, opts) {
    opts = opts || {};
    ctx.font = (opts.bold ? 'bold ' : '') + (opts.small ? '17px' : '20px') + ' CnFont';
    ctx.fillStyle = opts.small ? '#8a97a8' : '#333';
    ctx.textAlign = 'left';
    ctx.fillText(label, cx + 16, ry + ROW_H / 2);
    ctx.textAlign = 'right';
    ctx.fillText(value, cx + COL_W - 16, ry + ROW_H / 2);
  }

  var rowTop = y;              // 三欄資料列共用頂部
  var ryEarn = rowTop, ryDed = rowTop, ryNon = rowTop;

  // 應付
  for (var e = 0; e < earn.length; e++) { drawRowAt(x1, ryEarn, earn[e].label, fmtAmt(earn[e].value)); ryEarn += ROW_H; }
  // 明細（僅有日薪津貼時）
  if (cat.dailyBreak.length > 0) {
    ctx.fillStyle = '#f5f7fa';
    ctx.fillRect(x1, ryEarn, COL_W, 2 * ROW_H);
    drawRowAt(x1, ryEarn, '日薪小計：' + cat.dailyBreak.map(function(d) { return d.label.replace(/津貼$/, '') + d.value; }).join('＋'), fmtAmt(cat.dailySub), { small: true });
    drawRowAt(x1, ryEarn + ROW_H, '工作天數', (cat.days != null ? cat.days : 0) + ' 天', { small: true });
    ryEarn += 2 * ROW_H;
  }

  // 應扣
  for (var d = 0; d < ded.length; d++) { drawRowAt(x2, ryDed, ded[d].label, fmtAmt(ded[d].value)); ryDed += ROW_H; }
  // 不計入
  for (var n = 0; n < non.length; n++) { drawRowAt(x3, ryNon, non[n].label, fmtAmt(non[n].value)); ryNon += ROW_H; }

  // 合計列（各欄自己的底部）
  function sumRowAt(cx, ry, label, val) {
    ctx.fillStyle = '#dbe5f1';
    ctx.fillRect(cx, ry, COL_W, ROW_H);
    ctx.font = 'bold 20px CnFont';
    ctx.fillStyle = '#2f5496';
    ctx.textAlign = 'left'; ctx.fillText(label, cx + 16, ry + ROW_H / 2);
    ctx.textAlign = 'right'; ctx.fillText(fmtAmt(val), cx + COL_W - 16, ry + ROW_H / 2);
  }
  var sumY = Math.max(ryEarn, ryDed, ryNon);   // 合計列同一行
  sumRowAt(x1, sumY, '匯付合計(A)', A);
  sumRowAt(x2, sumY, '應扣合計(B)', B);
  sumRowAt(x3, sumY, '不計入合計', nonSum);
  y = sumY + ROW_H;

  // 匯付所得 + 現金
  ctx.fillStyle = '#2f5496';
  ctx.fillRect(M, y, W - M * 2, ROW_H + 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px CnFont';
  ctx.textAlign = 'left'; ctx.fillText('匯付所得（A-B）', M + 16, y + (ROW_H + 8) / 2);
  ctx.textAlign = 'right'; ctx.fillText(fmtAmt(net), W - M - 16, y + (ROW_H + 8) / 2);
  y += ROW_H + 8;
  // 現金(日薪減扣款) 行
  ctx.fillStyle = '#fdf6ec';
  ctx.fillRect(M, y, W - M * 2, ROW_H);
  ctx.strokeStyle = '#f0c36d'; ctx.lineWidth = 1;
  ctx.strokeRect(M, y, W - M * 2, ROW_H);
  ctx.fillStyle = '#b45309';
  ctx.font = 'bold 20px CnFont';
  ctx.textAlign = 'left'; ctx.fillText('現金(日薪減扣款)', M + 16, y + ROW_H / 2);
  ctx.textAlign = 'right'; ctx.fillText(fmtAmt(cat.cash), W - M - 16, y + ROW_H / 2);
  y += ROW_H + 14;

  // 表格框線
  ctx.strokeStyle = '#9db2d1'; ctx.lineWidth = 1;
  for (var c2 = 0; c2 < 3; c2++) {
    ctx.strokeRect(M + c2 * COL_W, tableTop, COL_W, y - tableTop - 14 - (ROW_H + 8));
  }
  ctx.strokeRect(M, y - (ROW_H + 8) - 14, W - M * 2, (ROW_H + 8));

  // ===== 假期資訊 =====
  y += 8;
  ctx.fillStyle = '#333'; ctx.font = 'bold 24px CnFont'; ctx.textAlign = 'left';
  ctx.fillText('假期資訊', M, y + 20);
  y += 44;

  var hol = computeLeave(emp.name);
  var holHeaders = ['假別名稱', '已休時數', '剩餘時數', '待簽時數', '上期結餘', '本期可休', '已結算時數', '待簽通過後剩餘時數', '可請休期間'];
  var holTotal = W - M * 2;
  var holBase = holTotal / (holHeaders.length + 0.8);
  var holWidths = holHeaders.map(function(h, i) { return i === holHeaders.length - 1 ? holBase * 1.8 : holBase; });

  ctx.fillStyle = '#2f5496';
  ctx.fillRect(M, y, holTotal, TH_H);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 15px CnFont'; ctx.textAlign = 'center';
  var holCX = M;
  for (var h = 0; h < holHeaders.length; h++) { ctx.fillText(holHeaders[h], holCX + holWidths[h] / 2, y + TH_H / 2); holCX += holWidths[h]; }
  y += TH_H;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(M, y, holTotal, ROW_H);
  ctx.font = '16px CnFont'; ctx.fillStyle = '#333'; ctx.textAlign = 'center';
  var holVals = [hol.name, hol.used, hol.remaining, hol.pending, hol.prevBal, hol.thisGrant, hol.settled, hol.afterPending, hol.period];
  var holVX = M;
  for (var hv = 0; hv < holVals.length; hv++) { ctx.fillText(String(holVals[hv]), holVX + holWidths[hv] / 2, y + ROW_H / 2); holVX += holWidths[hv]; }
  y += ROW_H;

  ctx.strokeStyle = '#9db2d1'; ctx.lineWidth = 1;
  ctx.strokeRect(M, y - ROW_H - TH_H, holTotal, ROW_H + TH_H);
  var hvX = M;
  for (var hv2 = 0; hv2 < holHeaders.length - 1; hv2++) { hvX += holWidths[hv2]; ctx.beginPath(); ctx.moveTo(hvX, y - ROW_H - TH_H); ctx.lineTo(hvX, y); ctx.stroke(); }

  // ===== 個人備註（橘色標題 + 淡黃說明框，與上方區別） =====
  y += 24;
  ctx.fillStyle = '#e67e22'; ctx.font = 'bold 20px CnFont'; ctx.textAlign = 'left';
  ctx.fillText('個人備註', M, y + 12);
  y += 30;
  ctx.fillStyle = '#fdf6ec';
  ctx.fillRect(M, y, W - M * 2, 44);
  ctx.strokeStyle = '#f0c36d'; ctx.lineWidth = 1;
  ctx.strokeRect(M, y, W - M * 2, 44);
  ctx.fillStyle = '#b45309'; ctx.font = '16px CnFontLight'; ctx.textAlign = 'left';
  ctx.fillText('薪資條說明：以上薪資明細如有疑問，請於發放日後 5 個工作日內向人資確認。', M + 16, y + 22);

  return cv.toBuffer();
}

// 輸出
var written = 0;
for (var i = 0; i < employees.length; i++) {
  var emp = employees[i];
  if (filterName && emp.name !== filterName) continue;
  fs.writeFileSync(path.join(OUT, emp.name + '.png'), render(emp));
  written++;
}
console.log('已產生 ' + written + ' 張薪資單 → ' + OUT + '/');
