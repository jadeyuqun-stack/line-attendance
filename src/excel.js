/**
 * 統一匯出樣式 helper — 使用 exceljs 產生置中/表頭/標題/篩選/高亮的 Excel
 */
var ExcelJS = require('exceljs');

function createWorkbook() {
	return new ExcelJS.Workbook();
}

// sheetName: 工作表名
// options:
//   title            第一列合併標題（例如顯示篩選範圍 '2026-07-01 ~ 2026-07-31'）
//   headers          表頭陣列
//   rows             資料列（二維陣列，每個子陣列對應一列）
//   widths           欄寬陣列（選填，不指定則依表頭長度自動計算）
//   highlightPositive 將數值 > 0 的儲存格填黃底+粗體（月結彙總用）
async function addSheet(wb, sheetName, options) {
	var ws = wb.addWorksheet(sheetName);
	var headers = options.headers || [];
	var rows = options.rows || [];
	var widths = options.widths || headers.map(function(h) {
		return Math.max(8, Math.min(22, String(h).length * 2 + 4));
	});
	var rowIdx = 1;

	// 第一列：標題（合併跨所有欄）
	var titleRow = options.title;
	if (titleRow) {
		ws.mergeCells(1, 1, 1, headers.length);
		var tc = ws.getCell(1, 1);
		tc.value = titleRow;
		tc.font = { bold: true, size: 12 };
		tc.alignment = { horizontal: 'left', vertical: 'middle' };
		ws.getRow(1).height = 22;
		rowIdx = 2;
	}

	// 表頭列
	var headerRow = ws.getRow(rowIdx);
	headerRow.height = 20;
	var thinBorder = { style: 'thin', color: { argb: 'FFD0D0D0' } };
	var borderStyle = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
	for (var c = 1; c <= headers.length; c++) {
		var hc = headerRow.getCell(c);
		hc.value = headers[c - 1];
		hc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF06C755' } };
		hc.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
		hc.border = borderStyle;
	}

	// 資料列
	var thinBorder = { style: 'thin', color: { argb: 'FFD0D0D0' } };
	var cellBorder = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
	for (var i = 0; i < rows.length; i++) {
		var rowVals = rows[i];
		for (var c2 = 0; c2 < headers.length; c2++) {
			var colIdx = c2 + 1;
			var cell = ws.getRow(rowIdx + 1 + i).getCell(colIdx);
			cell.value = rowVals[c2] !== undefined ? rowVals[c2] : '';
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
			cell.border = cellBorder;
			if (options.highlightPositive && typeof cell.value === 'number' && cell.value > 0) {
				cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
				cell.font = { bold: true };
			}
		}
	}

	// 欄寬
	for (var c3 = 0; c3 < widths.length; c3++) {
		ws.getColumn(c3 + 1).width = widths[c3];
	}

	// 自動篩選
	ws.autoFilter = {
		from: { row: rowIdx, column: 1 },
		to: { row: rowIdx, column: headers.length }
	};

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
