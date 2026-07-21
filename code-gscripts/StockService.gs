/**
 * ============================================================
 * FILE: StockService.gs
 * DESCRIPTION: Backend เคลื่อนไหวสต็อก + ประวัติ + กราฟ
 *   - processStockMovement(): รับเข้า/จ่ายออก/ปรับปรุง (Atomic + Lock เดียว)
 *   - getTransactions(): ดึงประวัติ (รองรับตัวกรอง)
 *   - getActiveProductsForSelect(): รายการสินค้า ACTIVE สำหรับ dropdown
 *   - getStockMovementChart(): ข้อมูลกราฟ IN/OUT 30 วัน
 *
 * หลักการสำคัญ:
 *   - CurrentStock แก้ได้ "ที่นี่เท่านั้น" (มีหลักฐานเอกสารทุกครั้ง)
 *   - processStockMovement lock ครอบทั้งกระบวนการ กัน race condition
 *   - OUT บล็อกถ้าจ่ายเกินสต็อก / ADJUST บล็อกถ้าค่าใหม่ติดลบ
 * ============================================================
 */

// ============================================================
// SECTION: PROCESS STOCK MOVEMENT - รับเข้า/จ่ายออก/ปรับปรุง
// ============================================================

/**
 * processStockMovement()
 * DESCRIPTION: ทำรายการเคลื่อนไหวสต็อก (หัวใจของระบบ)
 *   ⚠️ ใช้ Lock เดียวครอบทั้ง: อ่านสต็อกสด → คำนวณ → เขียน transaction → อัพเดทสต็อก
 *      เพื่อป้องกัน race condition (ตัดสต็อกพร้อมกันผิด)
 *   Logic ตาม type:
 *     IN     : newStock = old + qty        (qty ต้อง > 0)
 *     OUT    : newStock = old - qty        (qty ต้อง > 0 และ old >= qty)
 *     ADJUST : newStock = qty (ค่าใหม่)    (qty ต้อง >= 0, delta = qty - old)
 *   transaction.Quantity เก็บ "ส่วนต่าง" (มีเครื่องหมาย +/-)
 *   totalAmount = |delta| × unitPrice (IN/ADJUST=ราคาทุน, OUT=ราคาขาย)
 *
 * @param {string} token - Session Token
 * @param {Object} data - { type, productId, quantity, note }
 * @returns {Object} - {success, message, docNumber?}
 */
function processStockMovement(token, data) {
  Logger.log('[processStockMovement] ===== เริ่ม =====');
  Logger.log('[processStockMovement] data: ' + JSON.stringify(data));

  // Step 1: ตรวจสอบสิทธิ์
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  // Step 2: Validate ข้อมูลเบื้องต้น (ก่อน lock)
  var type = String(data.type || '').toUpperCase();
  if (type !== 'IN' && type !== 'OUT' && type !== 'ADJUST') {
    return { success: false, message: 'ประเภทไม่ถูกต้อง (IN/OUT/ADJUST)' };
  }
  if (!data.productId) {
    return { success: false, message: 'กรุณาเลือกสินค้า' };
  }
  var qtyInput = parseFloat(data.quantity);
  if (type === 'ADJUST') {
    if (isNaN(qtyInput) || qtyInput < 0) {
      return { success: false, message: 'สต็อกใหม่ต้องเป็นตัวเลขที่ไม่ติดลบ' };
    }
  } else {
    if (isNaN(qtyInput) || qtyInput <= 0) {
      return { success: false, message: 'จำนวนต้องมากกว่า 0' };
    }
  }

  // Step 3: Lock ครอบทั้งกระบวนการ
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    // 3a. อ่านสินค้า "สดๆ" ภายใน lock
    var found = findRowById_(SHEETS.PRODUCTS, 'ProductID', data.productId);
    if (!found) {
      return { success: false, message: 'ไม่พบสินค้ารหัส ' + data.productId };
    }

    // สร้าง colMap (0-based) จาก header
    var headers = found.headers;
    var colMap = {};
    for (var i = 0; i < headers.length; i++) { colMap[headers[i]] = i; }

    var oldStock = parseFloat(found.data[colMap.CurrentStock]) || 0;
    var cost = parseFloat(found.data[colMap.CostPrice]) || 0;
    var sell = parseFloat(found.data[colMap.SellPrice]) || 0;
    var productName = found.data[colMap.ProductName];
    var status = found.data[colMap.Status];

    // บล็อกสินค้า INACTIVE
    if (status !== 'ACTIVE') {
      return { success: false, message: 'สินค้า "' + productName + '" ถูกระงับ (INACTIVE) ทำรายการไม่ได้' };
    }

    // 3b. คำนวณ delta + newStock ตาม type
    var delta, newStock;
    if (type === 'IN') {
      delta = qtyInput;
      newStock = oldStock + qtyInput;
    } else if (type === 'OUT') {
      if (oldStock < qtyInput) {
        return {
          success: false,
          message: 'สต็อกไม่พอ! "' + productName + '" มีคงเหลือ ' + oldStock + ' แต่ต้องการจ่าย ' + qtyInput
        };
      }
      delta = -qtyInput;
      newStock = oldStock - qtyInput;
    } else { // ADJUST
      delta = qtyInput - oldStock;
      newStock = qtyInput;
    }

    // 3c. ราคาต่อหน่วย + ยอดรวม
    var unitPrice = (type === 'OUT') ? sell : cost;
    var totalAmount = Math.abs(delta) * unitPrice;

    // 3d. สร้างเลขเอกสาร + รหัส transaction (ภายใน lock กันซ้ำ)
    var docPrefix = (type === 'ADJUST') ? 'ADJ' : type;
    var docNumber = getNextDocNumberDirect_(SHEETS.TRANSACTIONS, docPrefix);
    var txnId = getNextIdDirect_(SHEETS.TRANSACTIONS, 'TXN');

    var now = getCurrentTimestamp_();
    var createdBy = (permission.user && permission.user.Username) ? permission.user.Username : 'system';
    var role = (permission.user && permission.user.Role) ? permission.user.Role : 'STAFF';
    var note = String(data.note || '').trim();

    // 3e. เตรียมแถว transaction (เรียงตาม HEADERS.Transactions)
    var txnRow = [
      txnId,         // TransactionID
      docNumber,     // DocNumber
      type,          // Type
      data.productId,// ProductID
      productName,   // ProductName (denormalize)
      delta,         // Quantity (ส่วนต่าง มีเครื่องหมาย)
      unitPrice,     // UnitPrice
      totalAmount,   // TotalAmount
      note,          // Note
      now,           // CreatedAt
      createdBy,     // CreatedBy
      role           // Role
    ];

    // 3f. เขียน transaction (direct - ไม่ lock ซ้ำ)
    appendRowDirect_(SHEETS.TRANSACTIONS, txnRow);

    // 3g. อัพเดท CurrentStock + UpdatedAt ของสินค้า (direct)
    updateCellDirect_(SHEETS.PRODUCTS, found.rowIndex, colMap.CurrentStock + 1, newStock);
    updateCellDirect_(SHEETS.PRODUCTS, found.rowIndex, colMap.UpdatedAt + 1, now);

    Logger.log('[processStockMovement] สำเร็จ: ' + docNumber + ' | ' + type + ' | delta=' + delta + ' | newStock=' + newStock);

    var typeText = (type === 'IN') ? 'รับเข้า' : (type === 'OUT') ? 'จ่ายออก' : 'ปรับปรุง';
    return {
      success: true,
      message: typeText + ' "' + productName + '" สำเร็จ (' + (delta > 0 ? '+' : '') + delta + ' ' + found.data[colMap.Unit] + ') คงเหลือ ' + newStock,
      docNumber: docNumber,
      newStock: newStock
    };

  } catch (error) {
    Logger.log('[processStockMovement] ERROR: ' + error.toString());
    return { success: false, message: 'ทำรายการไม่สำเร็จ: ' + error.toString() };
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// SECTION: TRANSACTION HISTORY - ประวัติการทำรายการ
// ============================================================

/**
 * getTransactions()
 * DESCRIPTION: ดึงประวัติการทำรายการ (รองรับตัวกรอง)
 *   filter: { type: 'ALL'|'IN'|'OUT'|'ADJUST', dateFrom, dateTo, keyword }
 *   เรียงลำดับล่าสุดก่อน (desc ตาม CreatedAt)
 *   สิทธิ์: STAFF ขึ้นไป
 *
 * @param {string} token - Session Token
 * @param {Object} filter - ตัวกรอง
 * @returns {Object} - {success, transactions: [...]}
 */
function getTransactions(token, filter) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    filter = filter || {};
    var all = getAllData_(SHEETS.TRANSACTIONS);
    var keyword = String(filter.keyword || '').toLowerCase();
    var dateFrom = String(filter.dateFrom || '');
    var dateTo = String(filter.dateTo || '');
    if (dateTo !== '') { dateTo = dateTo + ' 23:59:59'; }

    var result = [];
    for (var i = 0; i < all.length; i++) {
      var t = all[i];

      // กรองประเภท
      if (filter.type && filter.type !== 'ALL' && t.Type !== filter.type) { continue; }
      // กรองช่วงวันที่ (string compare ใช้ได้เพราะ format fixed-width)
      var ts = String(t.CreatedAt || '');
      if (dateFrom !== '' && ts < dateFrom) { continue; }
      if (dateTo !== '' && ts > dateTo) { continue; }
      // กรองคำค้น
      if (keyword !== '') {
        var hay = (String(t.DocNumber) + ' ' + String(t.ProductName) + ' ' + String(t.Note) + ' ' + String(t.ProductID)).toLowerCase();
        if (hay.indexOf(keyword) === -1) { continue; }
      }
      result.push(t);
    }

    // เรียงล่าสุดก่อน
    result.sort(function(a, b) {
      return String(b.CreatedAt || '').localeCompare(String(a.CreatedAt || ''));
    });

    Logger.log('[getTransactions] คืน ' + result.length + ' รายการ');
    return { success: true, transactions: result };

  } catch (error) {
    Logger.log('[getTransactions] ERROR: ' + error.toString());
    return { success: false, message: 'ดึงประวัติไม่สำเร็จ: ' + error.toString() };
  }
}


// ============================================================
// SECTION: PRODUCT SELECT - รายการสินค้าสำหรับ dropdown
// ============================================================

/**
 * getActiveProductsForSelect()
 * DESCRIPTION: ดึงสินค้า ACTIVE แบบย่อ สำหรับ populate dropdown ฟอร์มเคลื่อนไหวสต็อก
 *   คืน: ProductID, ProductName, Barcode, CurrentStock, Unit, CostPrice, SellPrice
 *   เรียงตามชื่อ
 *
 * @param {string} token - Session Token
 * @returns {Object} - {success, products: [...]}
 */
function getActiveProductsForSelect(token) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    var all = getAllData_(SHEETS.PRODUCTS);
    var list = [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.Status === 'ACTIVE') {
        list.push({
          ProductID: p.ProductID,
          ProductName: p.ProductName,
          Barcode: p.Barcode || '',
          CurrentStock: parseFloat(p.CurrentStock) || 0,
          Unit: p.Unit,
          CostPrice: parseFloat(p.CostPrice) || 0,
          SellPrice: parseFloat(p.SellPrice) || 0
        });
      }
    }
    list.sort(function(a, b) {
      return String(a.ProductName).localeCompare(String(b.ProductName), 'th');
    });
    return { success: true, products: list };
  } catch (error) {
    Logger.log('[getActiveProductsForSelect] ERROR: ' + error.toString());
    return { success: false, message: 'ดึงรายการสินค้าไม่สำเร็จ: ' + error.toString() };
  }
}


// ============================================================
// SECTION: CHART DATA - ข้อมูลกราฟเคลื่อนไหว 30 วัน
// ============================================================

/**
 * getStockMovementChart()
 * DESCRIPTION: สรุปปริมาณ รับเข้า/จ่ายออก รายวัน 30 วันย้อนหลัง
 *   สำหรับวาดกราฟเส้นที่ Dashboard (Chart.js)
 *   นับจาก |Quantity| ของ transaction ประเภท IN/OUT (ADJUST ไม่นับในกราฟ)
 *
 * @param {string} token - Session Token
 * @returns {Object} - {success, labels:[], inData:[], outData:[]}
 */
function getStockMovementChart(token) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    var tz = Session.getScriptTimeZone();
    var now = new Date();

    // สร้าง 30 วันย้อนหลัง (เก่าสุด -> ล่าสุด)
    var labels = [];
    var keys = [];
    var inMap = {};
    var outMap = {};
    for (var d = 29; d >= 0; d--) {
      var dt = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      var key = Utilities.formatDate(dt, tz, 'yyyy-MM-dd');
      var label = Utilities.formatDate(dt, tz, 'dd/MM');
      keys.push(key);
      labels.push(label);
      inMap[key] = 0;
      outMap[key] = 0;
    }

    // สะสมจาก transactions
    var all = getAllData_(SHEETS.TRANSACTIONS);
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      var tKey = String(t.CreatedAt || '').substring(0, 10);
      var qty = Math.abs(parseFloat(t.Quantity) || 0);
      if (t.Type === 'IN' && inMap.hasOwnProperty(tKey)) {
        inMap[tKey] += qty;
      } else if (t.Type === 'OUT' && outMap.hasOwnProperty(tKey)) {
        outMap[tKey] += qty;
      }
    }

    var inData = [];
    var outData = [];
    for (var k = 0; k < keys.length; k++) {
      inData.push(inMap[keys[k]]);
      outData.push(outMap[keys[k]]);
    }

    return { success: true, labels: labels, inData: inData, outData: outData };

  } catch (error) {
    Logger.log('[getStockMovementChart] ERROR: ' + error.toString());
    return { success: false, message: 'ดึงข้อมูลกราฟไม่สำเร็จ: ' + error.toString() };
  }
}