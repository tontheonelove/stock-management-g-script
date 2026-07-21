/**
 * ============================================================
 * FILE: Code.gs
 * DESCRIPTION: ไฟล์หลักของโปรเจค (Main Entry Point)
 *   - เก็บค่า Configuration หลักของระบบ
 *   - ฟังก์ชัน setupDatabase() สร้างฐานข้อมูลอัตโนมัติ
 *   - ฟังก์ชัน doGet() สำหรับเรียก Web App
 *   - ฟังก์ชัน include() สำหรับรวมไฟล์ HTML/CSS/JS
 * ============================================================
 */

// ============================================================
// CONFIGURATION - ค่าตั้งค่าหลักของระบบ
// ============================================================

var SHEETS = {
  USERS: 'Users',
  PRODUCTS: 'Products',
  TRANSACTIONS: 'Transactions',
  SETTINGS: 'Settings'
};

var HEADERS = {
  Users: [
    'UserID',
    'Username',
    'PasswordHash',
    'DisplayName',
    'Role',
    'Status',
    'CreatedAt',
    'LastLogin'
  ],
  Products: [
    'ProductID',
    'Barcode',
    'ProductName',
    'Category',
    'Unit',
    'CostPrice',
    'SellPrice',
    'MinStock',
    'CurrentStock',
    'Status',
    'CreatedAt',
    'UpdatedAt',
    'CreatedBy'
  ],
  Transactions: [
    'TransactionID',
    'DocNumber',
    'Type',
    'ProductID',
    'ProductName',
    'Quantity',
    'UnitPrice',
    'TotalAmount',
    'Note',
    'CreatedAt',
    'CreatedBy',
    'Role'
  ],
  Settings: [
    'Key',
    'Value',
    'Description'
  ]
};

var TAB_COLORS = {
  Users: '#4285F4',
  Products: '#34A853',
  Transactions: '#FBBC05',
  Settings: '#EA4335'
};

var COLUMN_WIDTHS = {
  Users: { 0: 120, 1: 120, 2: 200, 3: 150, 4: 100, 5: 100, 6: 180, 7: 180 },
  Products: { 0: 120, 1: 150, 2: 200, 3: 120, 4: 80, 5: 100, 6: 100, 7: 100, 8: 120, 9: 100, 10: 180, 11: 180, 12: 120 },
  Transactions: { 0: 180, 1: 180, 2: 80, 3: 120, 4: 200, 5: 100, 6: 100, 7: 120, 8: 200, 9: 180, 10: 120, 11: 80 },
  Settings: { 0: 200, 1: 200, 2: 300 }
};

var VALIDATIONS = {
  Users: [
    { columnIndex: 4, options: ['ADMIN', 'STAFF'] },
    { columnIndex: 5, options: ['ACTIVE', 'INACTIVE'] }
  ],
  Products: [
    { columnIndex: 9, options: ['ACTIVE', 'INACTIVE'] }
  ],
  Transactions: [
    { columnIndex: 2, options: ['IN', 'OUT', 'ADJUST'] }
  ]
};


// ============================================================
// SETUP DATABASE - สร้างฐานข้อมูลอัตโนมัติ
// ============================================================

/**
 * setupDatabase()
 * DESCRIPTION: จุดเริ่มต้นของการสร้างฐานข้อมูล
 *   รันครั้งเดียวจาก Apps Script Editor
 *   ปลอดภัยต่อการรันซ้ำ (Idempotent)
 */
function setupDatabase() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (!ss) {
      throw new Error('ไม่พบ Spreadsheet ที่ผูกอยู่ กรุณาสร้าง Spreadsheet ก่อน');
    }

    Logger.log('เริ่มสร้างฐานข้อมูลใน: ' + ss.getName());

    var sheetNames = Object.values(SHEETS);
    for (var i = 0; i < sheetNames.length; i++) {
      var name = sheetNames[i];
      createSheetIfNotExists_(ss, name);
      setupHeaders_(ss, name);
      formatSheet_(ss, name);
      setupColumnWidths_(ss, name);
      setupDataValidation_(ss, name);
    }

    insertDefaultAdminUser_(ss);
    insertDefaultSettings_(ss);
    removeDefaultSheet_(ss);

    var msg = 'สร้างฐานข้อมูลสำเร็จ!\n\n'
      + 'ชีตที่สร้าง: Users, Products, Transactions, Settings\n\n'
      + 'บัญชีเริ่มต้น:\n'
      + '  Username: admin\n'
      + '  Password: admin123\n\n'
      + 'กรุณาเปลี่ยนรหัสผ่านหลังเข้าใช้ครั้งแรก!';

    Logger.log(msg);

    try {
      SpreadsheetApp.getUi().alert('Setup สำเร็จ!', msg, SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (uiErr) {
      Logger.log('(ไม่ได้แสดง Popup เพราะไม่ได้เปิด Spreadsheet ไว้)');
    }

  } catch (error) {
    Logger.log('เกิดข้อผิดพลาด: ' + error.toString());
    try {
      SpreadsheetApp.getUi().alert('เกิดข้อผิดพลาด', error.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (uiErr2) {
      // ignore
    }
  } finally {
    lock.releaseLock();
  }
}


// ============================================================
// HELPER FUNCTIONS - ฟังก์ชันช่วย (Private)
// ============================================================

/**
 * createSheetIfNotExists_()
 * DESCRIPTION: สร้างชีตใหม่ถ้ายังไม่มี ถ้ามีอยู่แล้วจะข้าม
 */
function createSheetIfNotExists_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.setTabColor(TAB_COLORS[sheetName] || '#999999');
    Logger.log('  สร้างชีตใหม่: ' + sheetName);
  } else {
    Logger.log('  ชีตมีอยู่แล้ว (ข้าม): ' + sheetName);
  }
}

/**
 * setupHeaders_()
 * DESCRIPTION: เขียน Header (แถวที่ 1) ลงในชีต
 *   ถ้า Header ถูกต้องอยู่แล้วจะข้าม
 */
function setupHeaders_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  var headers = HEADERS[sheetName];
  if (!headers) {
    return;
  }
  var currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var isMatch = true;
  for (var i = 0; i < headers.length; i++) {
    if (currentHeaders[i] !== headers[i]) {
      isMatch = false;
      break;
    }
  }
  if (!isMatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    Logger.log('  อัพเดท Header: ' + sheetName);
  } else {
    Logger.log('  Header ถูกต้องแล้ว (ข้าม): ' + sheetName);
  }
}

/**
 * formatSheet_()
 * DESCRIPTION: จัดรูปแบบชีต (ตัวหนา, สี, Freeze Row)
 */
function formatSheet_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  var headers = HEADERS[sheetName];
  var numColumns = headers.length;
  var headerRange = sheet.getRange(1, 1, 1, numColumns);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a1a2e');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');
  headerRange.setVerticalAlignment('middle');
  headerRange.setFontSize(10);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 35);
  Logger.log('  จัดรูปแบบชีต: ' + sheetName);
}

/**
 * setupColumnWidths_()
 * DESCRIPTION: ตั้งความกว้างคอลัมน์ตาม Configuration
 */
function setupColumnWidths_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  var widths = COLUMN_WIDTHS[sheetName];
  if (!widths) {
    return;
  }
  var keys = Object.keys(widths);
  for (var i = 0; i < keys.length; i++) {
    var colIndex = parseInt(keys[i], 10);
    sheet.setColumnWidth(colIndex + 1, widths[colIndex]);
  }
  Logger.log('  ตั้งความกว้างคอลัมน์: ' + sheetName);
}

/**
 * setupDataValidation_()
 * DESCRIPTION: ตั้งค่า Dropdown List ป้องกันกรอกข้อมูลผิด
 */
function setupDataValidation_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  var validations = VALIDATIONS[sheetName];
  if (!validations) {
    return;
  }
  for (var i = 0; i < validations.length; i++) {
    var v = validations[i];
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(v.options, true)
      .setAllowInvalid(false)
      .build();
    var range = sheet.getRange(2, v.columnIndex + 1, 9999, 1);
    range.setDataValidation(rule);
  }
  Logger.log('  ตั้ง Data Validation: ' + sheetName);
}

/**
 * insertDefaultAdminUser_()
 * DESCRIPTION: สร้างบัญชี Admin เริ่มต้น (admin / admin123)
 */
function insertDefaultAdminUser_(ss) {
  var sheet = ss.getSheetByName(SHEETS.USERS);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    Logger.log('  มีข้อมูล Users อยู่แล้ว (ข้ามการสร้าง Admin)');
    return;
  }
  var now = getCurrentTimestamp_();
  var adminData = [[
    'USR-0001',
    'admin',
    hashPassword_('admin123'),
    'ผู้ดูแลระบบ',
    'ADMIN',
    'ACTIVE',
    now,
    ''
  ]];
  sheet.getRange(2, 1, 1, adminData[0].length).setValues(adminData);
  Logger.log('  สร้าง Admin User เริ่มต้น: admin / admin123');
}

/**
 * insertDefaultSettings_()
 * DESCRIPTION: ใส่ค่า Settings เริ่มต้นของระบบ
 */
function insertDefaultSettings_(ss) {
  var sheet = ss.getSheetByName(SHEETS.SETTINGS);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    Logger.log('  มีข้อมูล Settings อยู่แล้ว (ข้าม)');
    return;
  }
  var defaultSettings = [
    ['COMPANY_NAME', 'บริษัท ของฉัน จำกัด', 'ชื่อบริษัทสำหรับแสดงบน Web App'],
    ['CURRENCY', 'THB', 'สกุลเงินที่ใช้ในระบบ'],
    ['LOW_STOCK_ALERT', 'true', 'เปิด/ปิดแจ้งเตือนสต็อกต่ำ'],
    ['SESSION_TIMEOUT_HOURS', '8', 'ระยะเวลา Session หมดอายุ (ชั่วโมง)']
  ];
  sheet.getRange(2, 1, defaultSettings.length, 3).setValues(defaultSettings);
  Logger.log('  ใส่ค่า Settings เริ่มต้น: ' + defaultSettings.length + ' รายการ');
}

/**
 * removeDefaultSheet_()
 * DESCRIPTION: ลบชีต Sheet1 ที่ Google สร้างให้อัตโนมัติ
 */
function removeDefaultSheet_(ss) {
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
    Logger.log('  ลบชีต Sheet1 (ค่าเริ่มต้น)');
  }
}


// ============================================================
// UTILITY FUNCTIONS - ฟังก์ชันอรรถประโยชน์
// ============================================================

/**
 * hashPassword_()
 * DESCRIPTION: แปลงรหัสผ่านเป็น SHA-256 Hash
 * @param {string} password - รหัสผ่านที่ต้องการ Hash
 * @returns {string} - SHA-256 Hash (Hex String)
 */
function hashPassword_(password) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password
  );
  var hexString = '';
  for (var i = 0; i < digest.length; i++) {
    var hex = ('0' + (digest[i] & 0xFF).toString(16)).slice(-2);
    hexString += hex;
  }
  return hexString;
}

/**
 * generateId_()
 * DESCRIPTION: สร้าง ID อัตโนมัติ (เช่น USR-0002, PRD-0001)
 * @param {string} prefix - คำนำหน้า ID
 * @param {Sheet} sheet - ชีตที่ต้องการนับจำนวนแถว
 * @returns {string} - ID ที่สร้างใหม่
 */
function generateId_(prefix, sheet) {
  var lastRow = sheet.getLastRow();
  var nextNumber = lastRow;
  var paddedNumber = ('0000' + nextNumber).slice(-4);
  return prefix + '-' + paddedNumber;
}

/**
 * getCurrentTimestamp_()
 * DESCRIPTION: ดึงวันเวลาปัจจุบันในรูปแบบ yyyy-MM-dd HH:mm:ss
 * @returns {string} - วันเวลาปัจจุบัน
 */
function getCurrentTimestamp_() {
  return Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
}


// ============================================================
// WEB APP ENTRY POINT
// ============================================================

/**
 * doGet()
 * DESCRIPTION: ฟังก์ชันที่ Google เรียกเมื่อมีผู้เข้าถึง Web App
 *   ⚠️ แก้ไข BUG: ต้องใช้ createTemplateFromFile().evaluate()
 *   เพื่อให้ระบบประมวลผล Scriptlet <?!= include('...'); ?>
 *   (ถ้าใช้ createHtmlOutputFromFile() จะไม่ประมวลผล Scriptlet)
 *
 * @param {Object} e - Event object จาก Google
 * @returns {HtmlOutput} - หน้า HTML หลักที่ Compile แล้ว
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Stock Management System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * include()
 * DESCRIPTION: ฟังก์ชันช่วยสำหรับรวมไฟล์ HTML/CSS/JS
 *   ใช้ใน HTML: <?!= include('style'); ?>
 * @param {string} filename - ชื่อไฟล์ (ไม่ต้องมี .html)
 * @returns {string} - เนื้อหาของไฟล์
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


/**
 * saveUserUnified()
 * DESCRIPTION: [STEP 7] ฟังก์ชันรวมสำหรับเพิ่ม/แก้ไขผู้ใช้จาก Frontend
 *   Frontend เรียกจุดเดียว → ตัดสินใจจาก data.UserID
 *     - UserID ว่าง → เรียก addUser (สร้างใหม่)
 *     - UserID มีค่า → เรียก updateUser (แก้ไข)
 *   ทำให้ Frontend ง่าย + ไม่ต้องรู้ logic แยก
 *
 * @param {string} token - Session Token
 * @param {Object} data - {UserID, Username, Password, DisplayName, Role, Status}
 * @returns {Object} - {success, message}
 */
function saveUserUnified(token, data) {
  if (data && data.UserID && data.UserID !== '') {
    return updateUser(token, data);
  } else {
    return addUser(token, data);
  }
}