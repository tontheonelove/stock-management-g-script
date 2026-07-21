/**
 * ============================================================
 * FILE: ReportService.gs
 * DESCRIPTION: Backend ส่งออกรายงานเป็น CSV
 *   - exportStockCSV(): ส่งออกสต็อกปัจจุบันทั้งหมด
 *   - exportHistoryCSV(): ส่งออกประวัติตามตัวกรอง
 *   - escapeCSV_(): escape ค่า CSV กัน comma/quote/newline พัง
 *   - buildCSV_(): สร้าง CSV string จาก header + rows
 *
 * หมายเหตุเรื่องภาษาไทย:
 *   Frontend จะใส่ BOM (\uFEFF) นำหน้าตอนสร้าง Blob
 *   เพื่อให้ Excel เปิดแล้วภาษาไทยไม่เพี้ยน
 *   ดังนั้น Backend ส่ง CSV ล้วน (ไม่มี BOM)
 * ============================================================
 */

// ============================================================
// SECTION: EXPORT STOCK - ส่งออกสต็อกปัจจุบัน
// ============================================================

/**
 * exportStockCSV()
 * DESCRIPTION: ส่งออกข้อมูลสต็อกปัจจุบันทั้งหมดเป็น CSV
 *   คอลัมน์: รหัส, บาร์โค้ด, ชื่อ, หมวดหมู่, หน่วย, ราคาทุน, ราคาขาย, คงเหลือ, ขั้นต่ำ, สถานะ
 *   สิทธิ์: STAFF ขึ้นไป
 *
 * @param {string} token - Session Token
 * @returns {Object} - {success, csv, filename}
 */
function exportStockCSV(token) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    var products = getAllData_(SHEETS.PRODUCTS);

    var header = ['รหัสสินค้า', 'บาร์โค้ด', 'ชื่อสินค้า', 'หมวดหมู่', 'หน่วย', 'ราคาทุน', 'ราคาขาย', 'คงเหลือ', 'ขั้นต่ำ', 'สถานะ'];
    var rows = [];
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      rows.push([
        p.ProductID, p.Barcode || '', p.ProductName, p.Category || '', p.Unit,
        p.CostPrice, p.SellPrice, p.CurrentStock, p.MinStock, p.Status
      ]);
    }

    var csv = buildCSV_(header, rows);
    var filename = 'Stock_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.csv';

    Logger.log('[exportStockCSV] ส่งออก ' + products.length + ' รายการ');
    return { success: true, csv: csv, filename: filename };

  } catch (error) {
    Logger.log('[exportStockCSV] ERROR: ' + error.toString());
    return { success: false, message: 'ส่งออกสต็อกไม่สำเร็จ: ' + error.toString() };
  }
}


// ============================================================
// SECTION: EXPORT HISTORY - ส่งออกประวัติ
// ============================================================

/**
 * exportHistoryCSV()
 * DESCRIPTION: ส่งออกประวัติการทำรายการเป็น CSV (รองรับตัวกรองเหมือนหน้าประวัติ)
 *   filter: { type, dateFrom, dateTo, keyword }
 *   สิทธิ์: STAFF ขึ้นไป
 *
 * @param {string} token - Session Token
 * @param {Object} filter - ตัวกรอง
 * @returns {Object} - {success, csv, filename}
 */
function exportHistoryCSV(token, filter) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    // ใช้ getTransactions เพื่อ reuse logic ตัวกรอง + เรียงลำดับ
    var result = getTransactions(token, filter);
    if (!result.success) {
      return { success: false, message: result.message };
    }

    var list = result.transactions || [];
    var header = ['เลขเอกสาร', 'ประเภท', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'ราคา/หน่วย', 'รวม', 'หมายเหตุ', 'วันเวลา', 'ผู้ทำ', 'สิทธิ์'];
    var rows = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      rows.push([
        t.DocNumber, t.Type, t.ProductID, t.ProductName, t.Quantity,
        t.UnitPrice, t.TotalAmount, t.Note || '', t.CreatedAt, t.CreatedBy, t.Role
      ]);
    }

    var csv = buildCSV_(header, rows);
    var filename = 'History_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss') + '.csv';

    Logger.log('[exportHistoryCSV] ส่งออก ' + list.length + ' รายการ');
    return { success: true, csv: csv, filename: filename };

  } catch (error) {
    Logger.log('[exportHistoryCSV] ERROR: ' + error.toString());
    return { success: false, message: 'ส่งออกประวัติไม่สำเร็จ: ' + error.toString() };
  }
}


// ============================================================
// SECTION: CSV HELPERS - ฟังก์ชันช่วยสร้าง CSV
// ============================================================

/**
 * escapeCSV_()
 * DESCRIPTION: escape ค่าเดียวสำหรับ CSV
 *   - แปลง null/undefined/Date → string ปลอดภัย
 *   - ถ้ามี comma, quote, newline → wrap ด้วย " และ escape " เป็น ""
 *
 * @param {*} val - ค่าที่ต้องการ escape
 * @returns {string} - ค่าที่ escape แล้ว
 */
function escapeCSV_(val) {
  var s;
  if (val === null || val === undefined) {
    s = '';
  } else if (val instanceof Date) {
    s = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  } else {
    s = String(val);
  }
  // ถ้ามีอักขระพิเศษ → wrap quote
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * buildCSV_()
 * DESCRIPTION: สร้าง CSV string จาก header + rows
 *   แต่ละแถว escape ทุกค่า + join ด้วย comma + ขึ้นบรรทัดใหม่
 *
 * @param {Array} header - array ของชื่อคอลัมน์
 * @param {Array<Array>} rows - array ของแถว (แต่ละแถวเป็น array ของค่า)
 * @returns {string} - CSV string (ไม่มี BOM - frontend ใส่เอง)
 */
function buildCSV_(header, rows) {
  var lines = [];
  // header
  var hEsc = [];
  for (var h = 0; h < header.length; h++) { hEsc.push(escapeCSV_(header[h])); }
  lines.push(hEsc.join(','));
  // rows
  for (var i = 0; i < rows.length; i++) {
    var rEsc = [];
    for (var j = 0; j < rows[i].length; j++) { rEsc.push(escapeCSV_(rows[i][j])); }
    lines.push(rEsc.join(','));
  }
  return lines.join('\r\n');
}