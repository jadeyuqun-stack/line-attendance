/**
 * 統一匯出樣式 helper — 使用 exceljs 產生置中/表頭/標題/篩選/高亮的 Excel
 * 樣式對齊 summary sample2：深藍表頭 FF2F5496、細灰邊框 B7B7B7、Arial 10、大於 0 粗體異色
 */
var ExcelJS = require('exceljs');

var HEADER_FILL = 'FF2F5496';   // 深藍表頭
var BORDER_COLOR = 'FFB7B7B7';  // 細灰邊框
var HIGHLIGHT_FILL = 'FFFFE699'; // 亮黃底（>0）
var HIGHLIGHT_COLOR = 'FFC00000'; // 深紅字（>0）

function createWorkbook() {
	return new ExcelJS.Workbook();
}

// sheetName: 工作表名
// options:
//   title            第一列合併標題（例如顯示篩選範圍 '2026-08-01 ~ 2026-08-07'）
//   headers          表頭陣列
//   rows             資料列（二維陣列，每個子陣列對應一列）
//   widths           欄寬陣列（選填，不指定則依表頭長度自動計算）
//   highlightPositive 將數值 > 0 的儲存格填亮黃底+粗體+深紅字（月結彙總用）
async function addSheet(wb, sheetName, options) {
	var ws = wb.addWorksheet(sheetName);
	var headers = options.headers || [];
	var rows = options.rows || [];
	var widths = options.widths || headers.map(function(h) {
		return Math.max(8, Math.min(22, String(h).length * 2 + 4));
	});
	var rowIdx = 1;

	// 第一列：標題（合併跨所有欄，左對齊粗體）
	var titleRow = options.title;
	if (titleRow) {
		ws.mergeCells(1, 1, 1, headers.length);
		var tc = ws.getCell(1, 1);
		tc.value = titleRow;
		tc.font = { bold: true, size: 12, name: 'Calibri' };
		tc.alignment = { horizontal: 'left', vertical: 'center' };
		ws.getRow(1).height = 22;
		rowIdx = 2;
	}

	var thinBorder = { style: 'thin', color: { argb: BORDER_COLOR } };
	var cellBorder = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };

	// 表頭列（深藍底、白粗體、置中）
	var headerRow = ws.getRow(rowIdx);
	headerRow.height = 20;
	for (var c = 1; c <= headers.length; c++) {
		var hc = headerRow.getCell(c);
		hc.value = headers[c - 1];
		hc.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Noto Sans CJK SC', size: 10 };
		hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
		hc.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
		hc.border = cellBorder;
	}

	// 資料列（Arial 10 置中 + 細邊框）
	for (var i = 0; i < rows.length; i++) {
		var rowVals = rows[i];
		for (var c2 = 0; c2 < headers.length; c2++) {
			var colIdx = c2 + 1;
			var cell = ws.getRow(rowIdx + 1 + i).getCell(colIdx);
			cell.value = rowVals[c2] !== undefined ? rowVals[c2] : '';
			cell.font = { size: 10, name: 'Arial' };
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
			cell.border = cellBorder;
			if (options.highlightPositive && typeof cell.value === 'number' && cell.value > 0) {
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HIGHLIGHT_FILL } };
				cell.font = { size: 10, name: 'Arial', bold: true, color: { argb: HIGHLIGHT_COLOR } };
			}
		}
	}

	// 欄寬
	for (var c3 = 0; c3 < widths.length; c3++) {
		ws.getColumn(c3 + 1).width = widths[c3];
	}

	// 自動篩選
	if (headers.length > 0) {
		ws.autoFilter = {
			from: { row: rowIdx, column: 1 },
			to: { row: rowIdx, column: headers.length }
		};
	}

	return ws;
}

async function toBuffer(wb) {
	return wb.xlsx.writeBuffer();
}

async function send(res, wb, filename) {
	var buf = await toBuffer(wb);
	res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
	res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent(filename));
	res.end(Buffer.from(buf));
}

module.exports = { createWorkbook, addSheet, toBuffer, send };
