/**
 * ============================================================
 * FILE: ProductService.gs
 * DESCRIPTION: Backend จัดการสินค้า (CRUD) + สถิติ Dashboard
 *   [แก้ BUG] เพิ่ม Logger.log ละเอียดใน saveProduct เพื่อ debug
 * ============================================================
 */

// ============================================================
// SECTION: READ
// ============================================================
/**
 * getProducts()
 * DESCRIPTION: [แก้ DEFENSIVE] ดึงรายการสินค้า (รองรับค้นหา)
 *   ⚠️ แก้ไข: ครอบ sort ด้วย try/catch เพราะ localeCompare('th')
 *      อาจ throw ในบาง V8 environment → ถ้าพังจะข้ามการเรียง (ไม่บล็อกการทำงาน)
 *   เพิ่ม Logger.log เพื่อ diagnostic
 *
 * @param {string} token - Session Token
 * @param {string} keyword - คำค้นหา
 * @returns {Object} - {success: true, products: [...]}
 */
function getProducts(token, keyword) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    var products = searchInSheet_(SHEETS.PRODUCTS, keyword);
    Logger.log('[getProducts] ดึงได้ ' + products.length + ' รายการ');

    // Defensive sort: ถ้า localeCompare พัง ให้ fallback เป็น sort ธรรมดา
    try {
      products.sort(function(a, b) {
        return String(a.ProductName || '').localeCompare(String(b.ProductName || ''), 'th');
      });
    } catch (sortErr) {
      Logger.log('[getProducts] sort แบบ th พัง, ใช้ fallback: ' + sortErr.toString());
      products.sort(function(a, b) {
        return String(a.ProductName || '').localeCompare(String(b.ProductName || ''));
      });
    }

    return { success: true, products: products };

  } catch (error) {
    Logger.log('[getProducts] ERROR: ' + error.toString());
    return { success: false, message: 'ดึงข้อมูลสินค้าไม่สำเร็จ: ' + error.toString() };
  }
}

// ============================================================
// SECTION: CREATE / UPDATE
// ============================================================
/**
 * saveProduct()
 * DESCRIPTION: [แก้ BUG] เพิ่ม/แก้ไขสินค้า
 *   เพิ่ม Logger.log ทุก step เพื่อให้เห็น error จริงใน Execution log
 */
function saveProduct(token, data) {
  Logger.log('[saveProduct] ===== เริ่ม =====');
  Logger.log('[saveProduct] token มีค่า: ' + (token ? 'YES' : 'NO'));
  Logger.log('[saveProduct] data: ' + JSON.stringify(data));

  // Step 1: ตรวจสอบสิทธิ์
  var permission;
  try {
    permission = checkPermission(token, 'STAFF');
    Logger.log('[saveProduct] permission.allowed: ' + permission.allowed);
  } catch (e) {
    Logger.log('[saveProduct] ERROR checkPermission: ' + e.toString());
    return { success: false, message: 'ตรวจสอบสิทธิ์ล้มเหลว: ' + e.toString() };
  }

  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    // Step 2: ตรวจสอบข้อมูลบังคับ
    if (!data.ProductName || data.ProductName.trim() === '') {
      return { success: false, message: 'กรุณากรอกชื่อสินค้า' };
    }
    if (!data.Unit || data.Unit.trim() === '') {
      return { success: false, message: 'กรุณากรอกหน่วยนับ' };
    }

    var now = getCurrentTimestamp_();
    var cost = parseFloat(data.CostPrice) || 0;
    var sell = parseFloat(data.SellPrice) || 0;
    var minStock = parseFloat(data.MinStock) || 0;
    var barcode = String(data.Barcode || '').trim();
    Logger.log('[saveProduct] cost=' + cost + ' sell=' + sell + ' min=' + minStock + ' barcode="' + barcode + '"');

    if (cost < 0 || sell < 0 || minStock < 0) {
      return { success: false, message: 'ราคาและสต็อกขั้นต่ำต้องไม่ติดลบ' };
    }

    if (data.ProductID && data.ProductID !== '') {
      // ===== UPDATE =====
      Logger.log('[saveProduct] โหมด UPDATE: ' + data.ProductID);
      var found = findRowById_(SHEETS.PRODUCTS, 'ProductID', data.ProductID);
      if (!found) {
        return { success: false, message: 'ไม่พบสินค้ารหัส ' + data.ProductID };
      }

      if (barcode !== '') {
        var bcFound = findRowById_(SHEETS.PRODUCTS, 'Barcode', barcode);
        if (bcFound && String(bcFound.data[0]) !== String(data.ProductID)) {
          return { success: false, message: 'บาร์โค้ด "' + barcode + '" ซ้ำกับสินค้า "' + bcFound.data[2] + '"' };
        }
      }

      var headers = found.headers;
      var colMap = {};
      for (var i = 0; i < headers.length; i++) { colMap[headers[i]] = i; }

      var row = found.data.slice();
      row[colMap.Barcode] = barcode;
      row[colMap.ProductName] = data.ProductName.trim();
      row[colMap.Category] = String(data.Category || '').trim();
      row[colMap.Unit] = data.Unit.trim();
      row[colMap.CostPrice] = cost;
      row[colMap.SellPrice] = sell;
      row[colMap.MinStock] = minStock;
      row[colMap.Status] = data.Status || 'ACTIVE';
      row[colMap.UpdatedAt] = now;

      updateRowWithLock_(SHEETS.PRODUCTS, found.rowIndex, row);
      Logger.log('[saveProduct] UPDATE สำเร็จ');
      return { success: true, message: 'แก้ไขสินค้า "' + data.ProductName + '" สำเร็จ' };

    } else {
      // ===== CREATE =====
      Logger.log('[saveProduct] โหมด CREATE');

      if (barcode !== '') {
        var bcFound2 = findRowById_(SHEETS.PRODUCTS, 'Barcode', barcode);
        if (bcFound2) {
          return { success: false, message: 'บาร์โค้ด "' + barcode + '" มีอยู่แล้ว (สินค้า: ' + bcFound2.data[2] + ')' };
        }
      }

      var newId = getNextId_(SHEETS.PRODUCTS, 'PRD');
      Logger.log('[saveProduct] newId: ' + newId);

      // กัน undefined จาก session
      var createdBy = (permission.user && permission.user.Username) ? permission.user.Username : 'system';
      Logger.log('[saveProduct] createdBy: ' + createdBy);

      var newRow = [
        newId,
        barcode,
        data.ProductName.trim(),
        String(data.Category || '').trim(),
        data.Unit.trim(),
        cost,
        sell,
        minStock,
        0,
        data.Status || 'ACTIVE',
        now,
        now,
        createdBy
      ];
      Logger.log('[saveProduct] newRow (' + newRow.length + ' cols): ' + JSON.stringify(newRow));

      appendRowWithLock_(SHEETS.PRODUCTS, newRow);
      Logger.log('[saveProduct] CREATE สำเร็จ');
      return { success: true, message: 'เพิ่มสินค้า "' + data.ProductName + '" สำเร็จ (รหัส: ' + newId + ')' };
    }

  } catch (error) {
    Logger.log('[saveProduct] !!! CATCH ERROR: ' + error.toString());
    Logger.log('[saveProduct] Stack: ' + (error.stack || 'no stack'));
    return { success: false, message: 'บันทึกสินค้าไม่สำเร็จ: ' + error.toString() };
  }
}

// ============================================================
// SECTION: DELETE
// ============================================================
function deleteProduct(token, productId) {
  var permission = checkPermission(token, 'ADMIN');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }
  try {
    var found = findRowById_(SHEETS.PRODUCTS, 'ProductID', productId);
    if (!found) {
      return { success: false, message: 'ไม่พบสินค้ารหัส ' + productId };
    }
    var headers = found.headers;
    var colMap = {};
    for (var i = 0; i < headers.length; i++) { colMap[headers[i]] = i; }

    var currentStock = parseFloat(found.data[colMap.CurrentStock]) || 0;
    var productName = found.data[colMap.ProductName];

    if (currentStock !== 0) {
      return {
        success: false,
        message: 'ลบไม่ได้! "' + productName + '" ยังมีสต็อกคงเหลือ ' + currentStock + ' กรุณาปรับปรุงสต็อกให้เป็น 0 ก่อนลบ'
      };
    }

    deleteRowWithLock_(SHEETS.PRODUCTS, found.rowIndex);
    return { success: true, message: 'ลบสินค้า "' + productName + '" สำเร็จ' };
  } catch (error) {
    Logger.log('[deleteProduct] ERROR: ' + error.toString());
    return { success: false, message: 'ลบสินค้าไม่สำเร็จ: ' + error.toString() };
  }
}

// ============================================================
// SECTION: DASHBOARD STATS
// ============================================================
function getDashboardStats(token) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }
  try {
    var products = getAllData_(SHEETS.PRODUCTS);
    var transactions = getAllData_(SHEETS.TRANSACTIONS);

    var totalProducts = 0;
    var stockValue = 0;
    var lowStockCount = 0;
    var lowStockList = [];

    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      if (p.Status === 'ACTIVE') {
        totalProducts++;
        var stock = parseFloat(p.CurrentStock) || 0;
        var cost = parseFloat(p.CostPrice) || 0;
        var min = parseFloat(p.MinStock) || 0;
        stockValue += (stock * cost);
        if (stock <= min) {
          lowStockCount++;
          lowStockList.push({
            ProductID: p.ProductID,
            ProductName: p.ProductName,
            CurrentStock: stock,
            MinStock: min,
            Unit: p.Unit
          });
        }
      }
    }

    var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var todayTxn = 0;
    for (var j = 0; j < transactions.length; j++) {
      if (String(transactions[j].CreatedAt).indexOf(todayStr) === 0) { todayTxn++; }
    }

    return {
      success: true,
      stats: {
        totalProducts: totalProducts,
        stockValue: stockValue,
        lowStockCount: lowStockCount,
        todayTxn: todayTxn,
        lowStockList: lowStockList
      }
    };
  } catch (error) {
    Logger.log('[getDashboardStats] ERROR: ' + error.toString());
    return { success: false, message: 'ดึงข้อมูลสถิติไม่สำเร็จ: ' + error.toString() };
  }
}