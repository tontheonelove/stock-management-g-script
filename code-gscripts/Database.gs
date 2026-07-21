/**
 * ============================================================
 * FILE: Database.gs
 * DESCRIPTION: ฟังก์ชันกลางสำหรับจัดการฐานข้อมูล (Google Sheets)
 *   - อ่านข้อมูลทั้งหมดจากชีต (แปลงเป็น Object Array)
 *   - ค้นหาแถวตาม ID
 *   - เพิ่มแถวใหม่ (พร้อม LockService)
 *   - อัพเดทแถว (พร้อม LockService)
 *   - ลบแถว (พร้อม LockService)
 *   - สร้าง ID อัตโนมัติ
 *
 * หมายเหตุ: ฟังก์ชันที่ลงท้ายด้วย _ เป็น Private
 *   ไม่ควรเรียกจาก Frontend โดยตรง
 * ============================================================
 */


// ============================================================
// SECTION: GET SHEET - ดึงชีตจาก Spreadsheet
// ============================================================

/**
 * getSheet_()
 * DESCRIPTION: ดึง Sheet object จากชื่อชีต
 *   ถ้าไม่พบชีตจะ throw Error
 *
 * @param {string} sheetName - ชื่อชีต (เช่น 'Users', 'Products')
 * @returns {Sheet} - Google Sheet object
 * @throws {Error} - ถ้าไม่พบชีต
 */
function getSheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('ไม่พบชีต: ' + sheetName + ' กรุณารัน setupDatabase() ก่อน');
  }
  return sheet;
}


// ============================================================
// SECTION: READ DATA - อ่านข้อมูลจากชีต
// ============================================================

/**
 * sanitizeValue_()
 * DESCRIPTION: [แก้ ROOT CAUSE] แปลงค่าจากเซลล์ให้อยู่ในรูปแบบที่
 *   Google Apps Script ส่งกลับ Frontend ได้ปลอดภัย (JSON-serializable)
 *   ⚠️ ปัญหาเดิม: Google Sheets auto-detect ข้อความวันที่เป็น Date object
 *      ทำให้ getValues() คืน Date object ซึ่ง serialize ไป frontend ล้มเหลว
 *      ส่งผลให้ withSuccessHandler ได้รับ result = null
 *   วิธีแก้: แปลง Date object → string format ก่อน return
 *
 * @param {*} val - ค่าจากเซลล์ (อาจเป็น string, number, Date, null)
 * @returns {*} - ค่าที่ปลอดภัยต่อการ serialize
 */
function sanitizeValue_(val) {
  // ค่าว่าง → คืน string ว่าง (กัน undefined/null ทำ serialization พัง)
  if (val === null || val === undefined) {
    return '';
  }
  // Date object → แปลงเป็น string format (แก้ปัญหาหลัก!)
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  // ค่าอื่น (string, number, boolean) → คืนตามเดิม
  return val;
}

/**
 * getAllData_()
 * DESCRIPTION: [แก้ ROOT CAUSE] อ่านข้อมูลทั้งหมดจากชีต แปลงเป็น Array of Objects
 *   ⚠️ แก้ไข: เรียก sanitizeValue_() ทุกเซลล์ เพื่อป้องกัน Date object
 *      ทำให้การ serialize กลับ frontend ปลอดภัย 100%
 *   ใช้ Header แถวที่ 1 เป็น Key ของ Object
 *
 * @param {string} sheetName - ชื่อชีต
 * @returns {Array<Object>} - Array ของ Object (ค่าทุกตัว sanitize แล้ว)
 */
function getAllData_(sheetName) {
  var sheet = getSheet_(sheetName);
  var data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return [];
  }

  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      // ⚠️ sanitize ทุกค่า ก่อนใส่ลง object
      obj[headers[j]] = sanitizeValue_(data[i][j]);
    }
    result.push(obj);
  }

  return result;
}

/**
 * findRowById_()
 * DESCRIPTION: ค้นหาแถวตามค่า ID ในคอลัมน์ที่กำหนด
 *   คืนค่า rowIndex (1-based สำหรับใช้ใน Sheet API) และข้อมูลแถวนั้น
 *
 * @param {string} sheetName - ชื่อชีต
 * @param {string} idColumn - ชื่อคอลัมน์ที่ใช้ค้นหา (เช่น 'ProductID')
 * @param {string} idValue - ค่าที่ต้องการค้นหา (เช่น 'PRD-0001')
 * @returns {Object|null} - {rowIndex: number, data: Array, headers: Array} หรือ null ถ้าไม่พบ
 */
function findRowById_(sheetName, idColumn, idValue) {
  var sheet = getSheet_(sheetName);
  var data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return null;
  }

  var headers = data[0];
  var colIndex = -1;

  // หา Index ของคอลัมน์ ID
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === idColumn) {
      colIndex = i;
      break;
    }
  }

  // ถ้าไม่พบคอลัมน์ → คืนค่า null
  if (colIndex === -1) {
    return null;
  }

  // วนลูปค้นหาแถวที่ตรงกัน
  for (var row = 1; row < data.length; row++) {
    // แปลงเป็น String ทั้งคู่เพื่อเปรียบเทียบ (ป้องกัน Number vs String)
    if (String(data[row][colIndex]) === String(idValue)) {
      return {
        rowIndex: row + 1,  // +1 เพราะ Sheet API ใช้ 1-based row
        data: data[row],
        headers: headers
      };
    }
  }

  return null;
}

/**
 * searchInSheet_()
 * DESCRIPTION: ค้นหาข้อมูลในชีตตาม Keyword (ค้นหาทุกคอลัมน์)
 *   ใช้สำหรับฟังก์ชัน Search ในหน้าเว็บ
 *
 * @param {string} sheetName - ชื่อชีต
 * @param {string} keyword - คำค้นหา
 * @returns {Array<Object>} - Array ของ Object ที่พบ
 */
function searchInSheet_(sheetName, keyword) {
  var allData = getAllData_(sheetName);

  if (!keyword || keyword === '') {
    return allData;
  }

  var lowerKeyword = keyword.toLowerCase();
  var result = [];

  for (var i = 0; i < allData.length; i++) {
    var obj = allData[i];
    var keys = Object.keys(obj);
    var found = false;

    // เช็คทุกคอลัมน์ว่ามี Keyword หรือไม่
    for (var j = 0; j < keys.length; j++) {
      var cellValue = String(obj[keys[j]]).toLowerCase();
      if (cellValue.indexOf(lowerKeyword) !== -1) {
        found = true;
        break;
      }
    }

    if (found) {
      result.push(obj);
    }
  }

  return result;
}


// ============================================================
// SECTION: WRITE DATA - เขียนข้อมูลลงชีต (พร้อม Lock)
// ============================================================

/**
 * appendRowWithLock_()
 * DESCRIPTION: [แก้ BUG] เพิ่มแถวใหม่ต่อท้ายชีต
 *   ⚠️ เปลี่ยนจาก appendRow() เป็น getRange().setValues()
 *   เพราะ appendRow() มี known issue กับ Data Validation (setAllowInvalid=false)
 *   ทำให้ throw error ทั้งที่ค่าถูกต้อง
 *   setValues() เสถียรกว่าและควบคุมตำแหน่งแถวได้แน่นอน
 *   เพิ่ม Logger.log ทุก step เพื่อ debug
 *
 * @param {string} sheetName - ชื่อชีต
 * @param {Array} rowData - ข้อมูล 1 แถว
 * @returns {boolean} - true ถ้าสำเร็จ
 */
function appendRowWithLock_(sheetName, rowData) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var sheet = getSheet_(sheetName);
    var lastRow = sheet.getLastRow();

    // คำนวณแถวเป้าหมาย (header อยู่แถว 1 ดังนั้นข้อมูลเริ่มแถว 2)
    var targetRow = (lastRow < 1) ? 2 : (lastRow + 1);

    Logger.log('[appendRowWithLock_] ' + sheetName + ' | lastRow=' + lastRow + ' | targetRow=' + targetRow + ' | cols=' + rowData.length);

    // ใช้ setValues แทน appendRow (เสถียรกว่ากับ Data Validation)
    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);

    Logger.log('[appendRowWithLock_] เขียนสำเร็จ: ' + sheetName + ' แถว ' + targetRow);
    return true;

  } catch (error) {
    Logger.log('[appendRowWithLock_] ERROR: ' + error.toString());
    throw new Error('เพิ่มข้อมูลไม่สำเร็จ (' + sheetName + '): ' + error.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * updateRowWithLock_()
 * DESCRIPTION: อัพเดทข้อมูลในแถวที่กำหนด (ใช้ LockService)
 *
 * @param {string} sheetName - ชื่อชีต
 * @param {number} rowIndex - แถวที่ต้องการอัพเดท (1-based)
 * @param {Array} rowData - ข้อมูลใหม่ (Array ของค่าแต่ละคอลัมน์)
 * @returns {boolean} - true ถ้าสำเร็จ
 */
function updateRowWithLock_(sheetName, rowIndex, rowData) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var sheet = getSheet_(sheetName);
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);

    return true;
  } catch (error) {
    throw new Error('อัพเดทข้อมูลไม่สำเร็จ (' + sheetName + '): ' + error.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * updateCellWithLock_()
 * DESCRIPTION: อัพเดทเฉพาะ 1 เซลล์ (ใช้ LockService)
 *   เหมาะสำหรับการอัพเดทค่าเดียว เช่น CurrentStock, LastLogin
 *
 * @param {string} sheetName - ชื่อชีต
 * @param {number} rowIndex - แถว (1-based)
 * @param {number} colIndex - คอลัมน์ (1-based)
 * @param {*} value - ค่าใหม่
 * @returns {boolean} - true ถ้าสำเร็จ
 */
function updateCellWithLock_(sheetName, rowIndex, colIndex, value) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var sheet = getSheet_(sheetName);
    sheet.getRange(rowIndex, colIndex).setValue(value);

    return true;
  } catch (error) {
    throw new Error('อัพเดทเซลล์ไม่สำเร็จ (' + sheetName + '): ' + error.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * deleteRowWithLock_()
 * DESCRIPTION: ลบแถวออกจากชีต (ใช้ LockService)
 *
 * @param {string} sheetName - ชื่อชีต
 * @param {number} rowIndex - แถวที่ต้องการลบ (1-based)
 * @returns {boolean} - true ถ้าสำเร็จ
 */
function deleteRowWithLock_(sheetName, rowIndex) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var sheet = getSheet_(sheetName);
    sheet.deleteRow(rowIndex);

    return true;
  } catch (error) {
    throw new Error('ลบข้อมูลไม่สำเร็จ (' + sheetName + '): ' + error.toString());
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// SECTION: ID GENERATOR - สร้าง ID อัตโนมัติ
// ============================================================

/**
 * getNextId_()
 * DESCRIPTION: สร้าง ID ตัวถัดไปโดยนับจากจำนวนแถวปัจจุบัน
 *   รูปแบบ: PREFIX-XXXX (เช่น PRD-0001, TXN-0002)
 *   ใช้ LockService เพื่อป้องกัน ID ซ้ำเมื่อเรียกพร้อมกัน
 *
 * @param {string} sheetName - ชื่อชีต
 * @param {string} prefix - คำนำหน้า (เช่น 'PRD', 'TXN', 'USR')
 * @returns {string} - ID ใหม่ (เช่น 'PRD-0005')
 */
function getNextId_(sheetName, prefix) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var sheet = getSheet_(sheetName);
    var lastRow = sheet.getLastRow();
    // lastRow รวม Header แล้ว ดังนั้นจำนวนข้อมูล = lastRow - 1
    // ID ตัวถัดไป = จำนวนข้อมูล + 1
    var nextNumber = lastRow; // lastRow - 1 + 1 = lastRow
    var paddedNumber = ('0000' + nextNumber).slice(-4);

    return prefix + '-' + paddedNumber;
  } catch (error) {
    throw new Error('สร้าง ID ไม่สำเร็จ: ' + error.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * getNextDocNumber_()
 * DESCRIPTION: สร้างเลขที่เอกสารอัตโนมัติ
 *   รูปแบบ: TYPE-YYYYMMDD-XXX (เช่น IN-20260721-001)
 *   ใช้สำหรับเอกสารรับเข้า/จ่ายออก/ปรับปรุงสต็อก
 *
 * @param {string} sheetName - ชื่อชีต (Transactions)
 * @param {string} type - ประเภทเอกสาร (IN, OUT, ADJ)
 * @returns {string} - เลขที่เอกสาร (เช่น 'IN-20260721-001')
 */
function getNextDocNumber_(sheetName, type) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var sheet = getSheet_(sheetName);
    var data = sheet.getDataRange().getValues();
    var headers = data[0];

    // หา Index ของคอลัมน์ DocNumber
    var docColIndex = -1;
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] === 'DocNumber') {
        docColIndex = i;
        break;
      }
    }

    if (docColIndex === -1) {
      throw new Error('ไม่พบคอลัมน์ DocNumber ในชีต ' + sheetName);
    }

    // สร้าง Prefix ของวันนี้: TYPE-YYYYMMDD-
    var today = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyyMMdd'
    );
    var prefix = type + '-' + today + '-';

    // นับจำนวนเอกสารวันนี้
    var count = 0;
    for (var row = 1; row < data.length; row++) {
      var docNum = String(data[row][docColIndex]);
      if (docNum.indexOf(prefix) === 0) {
        count++;
      }
    }

    // สร้างเลขที่: prefix + XXX (3 หลัก)
    var nextNum = count + 1;
    var paddedNum = ('000' + nextNum).slice(-3);

    return prefix + paddedNum;
  } catch (error) {
    throw new Error('สร้าง DocNumber ไม่สำเร็จ: ' + error.toString());
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// [STEP 6] SECTION: DIRECT WRITE HELPERS (NO LOCK)
// DESCRIPTION: ฟังก์ชันเขียนข้อมูล "แบบไม่ lock"
//   ใช้เฉพาะ "ภายใน" ฟังก์ชันที่ lock ครอบอยู่แล้ว
//   (เช่น processStockMovement ใน StockService.gs)
//   ⚠️ เหตุผล: GAS LockService ไม่รองรับ reentrant lock
//      (lock ซ้อนจาก execution เดียวกัน) จะทำให้ค้าง/timeout
//      ดังนั้นภายใน lock เดียว ต้องใช้ helper ที่ไม่ lock ซ้ำ
//   ⚠️ ห้ามเรียกจากภายนอกโดยตรง ต้องอยู่ภายใน lock ของ caller เสมอ
// ============================================================

/**
 * appendRowDirect_()
 * DESCRIPTION: เพิ่มแถวใหม่ "แบบไม่ lock" (ใช้ภายใน lock ของ caller)
 * @param {string} sheetName - ชื่อชีต
 * @param {Array} rowData - ข้อมูล 1 แถว
 * @returns {number} - แถวที่เขียน (1-based)
 */
function appendRowDirect_(sheetName, rowData) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var targetRow = (lastRow < 1) ? 2 : (lastRow + 1);
  sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  return targetRow;
}

/**
 * updateCellDirect_()
 * DESCRIPTION: อัพเดท 1 เซลล์ "แบบไม่ lock" (ใช้ภายใน lock ของ caller)
 * @param {string} sheetName - ชื่อชีต
 * @param {number} rowIndex - แถว (1-based)
 * @param {number} colIndex - คอลัมน์ (1-based)
 * @param {*} value - ค่าใหม่
 */
function updateCellDirect_(sheetName, rowIndex, colIndex, value) {
  var sheet = getSheet_(sheetName);
  sheet.getRange(rowIndex, colIndex).setValue(value);
}

/**
 * getNextIdDirect_()
 * DESCRIPTION: สร้าง ID ใหม่ "แบบไม่ lock" (ใช้ภายใน lock ของ caller)
 * @param {string} sheetName - ชื่อชีต
 * @param {string} prefix - คำนำหน้า (เช่น 'TXN')
 * @returns {string} - ID ใหม่
 */
function getNextIdDirect_(sheetName, prefix) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var padded = ('0000' + lastRow).slice(-4);
  return prefix + '-' + padded;
}

/**
 * getNextDocNumberDirect_()
 * DESCRIPTION: สร้างเลขที่เอกสาร "แบบไม่ lock" (ใช้ภายใน lock ของ caller)
 *   รูปแบบ: TYPE-YYYYMMDD-XXX
 * @param {string} sheetName - ชื่อชีต (Transactions)
 * @param {string} type - ประเภท (IN, OUT, ADJ)
 * @returns {string} - เลขที่เอกสาร
 */
function getNextDocNumberDirect_(sheetName, type) {
  var sheet = getSheet_(sheetName);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var docCol = -1;
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === 'DocNumber') { docCol = i; break; }
  }
  if (docCol === -1) { throw new Error('ไม่พบคอลัมน์ DocNumber ใน ' + sheetName); }

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd');
  var prefix = type + '-' + today + '-';
  var count = 0;
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][docCol]).indexOf(prefix) === 0) { count++; }
  }
  return prefix + ('000' + (count + 1)).slice(-3);
}