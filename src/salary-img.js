/**
 * 薪資圖模組：解析薪資 Excel + 渲染個人薪資單 PNG
 * 供後台薪資發送頁面上傳 Excel 後產生圖片用
 */
var XLSX = require('xlsx');
var canvas = require('canvas');

var TITLE = '115年7月薪資';

canvas.registerFont('/System/Library/Fonts/STHeiti Medium.ttc', { family: 'CnFont' });
canvas.registerFont('/System/Library/Fonts/STHeiti Light.ttc', { family: 'CnFontLight' });

function addr(col, row) { return col + row; }
function nextCol(letter) { return String.fromCharCode(letter.charCodeAt(0) + 1); }

// 西元 → 民國
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

// 解析薪資 Excel（Salary sample 格式）→ [{name, items}]
function parseSalaryWorkbook(buffer) {
  var wb = XLSX.read(buffer);
  var ws = wb.Sheets[wb.SheetNames[0]];
  var colLetters = ['B', 'E', 'H', 'K'];
  var titles = [];
  for (var r = 2; r <= 400; r++) {
    for (var i = 0; i < colLetters.length; i++) {
      var c = ws[addr(colLetters[i], r)];
      if (c && c.v === TITLE) titles.push({ row: r, colIdx: i });
    }
  }
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
      var n = Number(String(value).replace(/,/g, ''));
      if (isNaN(n)) continue;
      if (!label || String(label).trim() === '') label = items.length > 0 ? items[items.length - 1].label : '本    薪';
      items.push({ label: String(label).replace(/\s+/g, ' ').trim(), value: n });
    }
    employees.push({ name: String(name).replace(/褀/g, '祺'), items: items });
  }
  return employees;
}

// 分類（與 gen-salary-preview.js 一致）
var DED_LABELS = ['請假', '代扣', '自提6%', '餐費', '所得稅'];
var SKIP_LABELS = ['月薪小計', '日薪小計', '薪資合計', '扣款小計', '匯入金額', '現金', '勞退6%(入個戶)', '工作天數', '工作獎金'];
var DAILY_BASE = ['伙食津貼', '加班津貼', '專業.外勤津貼'];

function categorize(items) {
  var baseSalary = 0, bonus = 0, extras = [], ded = [], non = [];
  var days = null, dailyBreak = [], cash = 0;
  for (var i = 0; i < items.length; i++) {
    var it = items[i], lb = it.label, lbKey = lb.replace(/\s/g, '');
    if (lbKey.indexOf('本薪') === 0) { baseSalary += it.value; continue; }
    if (lb.indexOf('工作天數') !== -1) { days = it.value; continue; }
    if (lb.indexOf('日薪小計') !== -1 || lb.indexOf('日薪總計') !== -1) continue;
    if (lb.indexOf('現金') !== -1) { cash = Math.abs(it.value); continue; }
    if (lb === '勞退6%') { non.push(it); continue; }
    if (lb.indexOf('工作獎金') !== -1) { bonus += it.value; continue; }
    if (SKIP_LABELS.some(function(k) { return lb.indexOf(k) !== -1; })) continue;
    if (DAILY_BASE.indexOf(lb) !== -1) { dailyBreak.push(it); continue; }
    if (DED_LABELS.some(function(k) { return lb.indexOf(k) !== -1; })) { ded.push(Math.abs(it.value)); continue; }
    if (it.value < 0) ded.push(Math.abs(it.value));
    else extras.push(it);
  }
  var dailySub = dailyBreak.reduce(function(s, x) { return s + x.value; }, 0);
  var dailyTotal = (days != null && days > 0) ? Math.round(dailySub * days * 100) / 100 : dailySub;
  var mainEarn = [];
  if (baseSalary > 0) mainEarn.push({ label: '本薪', value: baseSalary });
  if (dailyTotal > 0) mainEarn.push({ label: '日薪總計', value: dailyTotal });
  if (bonus > 0) mainEarn.push({ label: '工作獎金', value: bonus });
  for (var x = 0; x < extras.length; x++) mainEarn.push(extras[x]);
  return { mainEarn: mainEarn, dailySub: dailySub, days: days, dailyBreak: dailyBreak, ded: ded, non: non, cash: cash };
}

function sumRows(rows) { var s = 0; for (var i = 0; i < rows.length; i++) s += rows[i].value; return s; }

function fmtAmt(v) {
  if (v === null || v === undefined || v === '') return '';
  var n = Number(v);
  if (isNaN(n)) return String(v);
  n = Math.round(n);
  var s = Math.abs(n).toLocaleString('en-US');
  return (n < 0 ? '-' : '') + s;
}

// 渲染個人薪資單 → PNG buffer
// emp: { name, no, dept, title, hireDate, leave:{used,remaining,thisGrant,period}, items }
function renderSalaryImage(emp) {
  var cat = categorize(emp.items || []);
  var earn = cat.mainEarn, ded = cat.ded, non = cat.non;
  var A = sumRows(earn), B = ded.reduce(function(s, x) { return s + x; }, 0), nonSum = sumRows(non);
  var net = Math.round((A - B - cat.cash) * 100) / 100;
  var extra = { no: emp.no, dept: emp.dept, role: emp.title, hire_date: emp.hireDate };
  var hol = emp.leave || { name: '特休', used: 0, remaining: 0, thisGrant: 0, period: '' };
  var TITLE_USE = emp.title ? emp.title : '';

  var W = 1500, M = 50, COL_W = (W - M * 2) / 3;
  var INFO_H = 40, TH_H = 46, ROW_H = 40;
  var titleH = 120, infoH = 3 * INFO_H + 10;
  var maxRows = Math.max(earn.length, ded.length, non.length) + 2;
  var tableH = TH_H + maxRows * ROW_H + 2 * ROW_H;
  var holidayH = 250, noteH = 110;
  var H = titleH + infoH + tableH + holidayH + noteH + 60;

  var cv = canvas.createCanvas(W, H);
  var ctx = cv.getContext('2d');
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  var y = 0;

  // 公司標題
  ctx.fillStyle = '#2f5496';
  ctx.fillRect(0, y, W, titleH);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px CnFont';
  ctx.textAlign = 'center';
  ctx.fillText('玉群環境科技', W / 2, y + 48);
  ctx.font = 'bold 28px CnFont';
  ctx.fillText(TITLE, W / 2, y + 96);
  y += titleH;

  // 員工資訊
  ctx.font = '22px CnFont';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#333';
  var infoRows = [
    '工號：' + (emp.no || emp.name) + '　　姓名：' + emp.name + '　　部門：' + (emp.dept || '') + '　　到職日期：' + rocDate(extra.hire_date),
    '發放日期：115/08/10　　結算區間：115/07/01 ~ 115/07/31　　職稱：' + TITLE_USE,
  ];
  for (var i = 0; i < infoRows.length; i++) { ctx.fillText(infoRows[i], M, y + INFO_H / 2); y += INFO_H; }
  ctx.strokeStyle = '#2f5496'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
  y += 14;

  // 三欄表格
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
  colHeader(x1, '應付項目'); colHeader(x2, '應扣項目'); colHeader(x3, '不計入項目(匯入勞退專用帳戶)');
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
    ctx.textAlign = 'left'; ctx.fillText(label, cx + 16, ry + ROW_H / 2);
    ctx.textAlign = 'right'; ctx.fillText(value, cx + COL_W - 16, ry + ROW_H / 2);
  }
  var rowTop = y;
  var ryEarn = rowTop, ryDed = rowTop, ryNon = rowTop;
  for (var e = 0; e < earn.length; e++) { drawRowAt(x1, ryEarn, earn[e].label, fmtAmt(earn[e].value)); ryEarn += ROW_H; }
  if (cat.dailyBreak.length > 0) {
    ctx.fillStyle = '#f5f7fa';
    ctx.fillRect(x1, ryEarn, COL_W, 2 * ROW_H);
    drawRowAt(x1, ryEarn, '日薪小計：' + cat.dailyBreak.map(function(d) { return d.label.replace(/津貼$/, '') + d.value; }).join('＋'), fmtAmt(cat.dailySub), { small: true });
    drawRowAt(x1, ryEarn + ROW_H, '工作天數', (cat.days != null ? cat.days : 0) + ' 天', { small: true });
    ryEarn += 2 * ROW_H;
  }
  for (var d = 0; d < ded.length; d++) { drawRowAt(x2, ryDed, '扣款', fmtAmt(ded[d])); ryDed += ROW_H; }
  for (var n = 0; n < non.length; n++) { drawRowAt(x3, ryNon, non[n].label, fmtAmt(non[n].value)); ryNon += ROW_H; }

  var sumY = Math.max(ryEarn, ryDed, ryNon);
  function sumRowAt(cx, ry, label, val) {
    ctx.fillStyle = '#dbe5f1';
    ctx.fillRect(cx, ry, COL_W, ROW_H);
    ctx.font = 'bold 20px CnFont';
    ctx.fillStyle = '#2f5496';
    ctx.textAlign = 'left'; ctx.fillText(label, cx + 16, ry + ROW_H / 2);
    ctx.textAlign = 'right'; ctx.fillText(fmtAmt(val), cx + COL_W - 16, ry + ROW_H / 2);
  }
  sumRowAt(x1, sumY, '匯付合計(A)', A);
  sumRowAt(x2, sumY, '應扣合計(B)', B);
  sumRowAt(x3, sumY, '不計入合計', nonSum);
  y = sumY + ROW_H;

  // 匯付所得 + 現金
  ctx.fillStyle = '#2f5496';
  ctx.fillRect(M, y, W - M * 2, ROW_H + 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px CnFont';
  ctx.textAlign = 'left'; ctx.fillText('匯付所得（A-B-日薪減扣款）', M + 16, y + (ROW_H + 8) / 2);
  ctx.textAlign = 'right'; ctx.fillText(fmtAmt(net), W - M - 16, y + (ROW_H + 8) / 2);
  y += ROW_H + 8;
  ctx.fillStyle = '#2f5496';
  ctx.fillRect(M, y, W - M * 2, ROW_H);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px CnFont';
  ctx.textAlign = 'left'; ctx.fillText('現金(日薪減扣款)', M + 16, y + ROW_H / 2);
  ctx.textAlign = 'right'; ctx.fillText(fmtAmt(cat.cash), W - M - 16, y + ROW_H / 2);
  y += ROW_H + 14;

  // 表格框線
  ctx.strokeStyle = '#9db2d1'; ctx.lineWidth = 1;
  for (var c2 = 0; c2 < 3; c2++) {
    ctx.strokeRect(M + c2 * COL_W, tableTop, COL_W, y - tableTop - 14 - (ROW_H + 8));
  }
  ctx.strokeRect(M, y - (ROW_H + 8) - 14, W - M * 2, (ROW_H + 8));

  // 假期資訊
  y += 8;
  ctx.fillStyle = '#333'; ctx.font = 'bold 24px CnFont'; ctx.textAlign = 'left';
  ctx.fillText('假期資訊', M, y + 20);
  y += 44;
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
  var holVals = [hol.name, hol.used, hol.remaining, 0, 0, hol.thisGrant, hol.remaining, hol.remaining, hol.period];
  var holVX = M;
  for (var hv = 0; hv < holVals.length; hv++) { ctx.fillText(String(holVals[hv]), holVX + holWidths[hv] / 2, y + ROW_H / 2); holVX += holWidths[hv]; }
  y += ROW_H;
  ctx.strokeStyle = '#9db2d1'; ctx.lineWidth = 1;
  ctx.strokeRect(M, y - ROW_H - TH_H, holTotal, ROW_H + TH_H);
  var hvX = M;
  for (var hv2 = 0; hv2 < holHeaders.length - 1; hv2++) { hvX += holWidths[hv2]; ctx.beginPath(); ctx.moveTo(hvX, y - ROW_H - TH_H); ctx.lineTo(hvX, y); ctx.stroke(); }

  // 備註
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

module.exports = { parseSalaryWorkbook, renderSalaryImage };
