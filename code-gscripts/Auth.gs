/**
 * ============================================================
 * FILE: Auth.gs
 * DESCRIPTION: ระบบ Authentication & Authorization
 *   - login(): ตรวจสอบ Username/Password, สร้าง Session Token
 *   - logout(): ลบ Session Token
 *   - validateSession(): ตรวจสอบว่า Token ยังใช้งานได้หรือไม่
 *   - checkPermission(): ตรวจสอบสิทธิ์ (Admin/Staff)
 *   - getUserList(): ดึงรายชื่อผู้ใช้ (เฉพาะ Admin)
 *   - addUser(): เพิ่มผู้ใช้ใหม่ (เฉพาะ Admin)
 *   - updateUser(): แก้ไขผู้ใช้ (เฉพาะ Admin)
 *
 * Session Storage: ใช้ CacheService (หมดอายุสูงสุด 6 ชั่วโมง)
 * Token Format: UUID (สร้างด้วย Utilities.getUuid())
 * ============================================================
 */


// ============================================================
// SECTION: CONFIGURATION - ค่าตั้งค่าของ Auth
// ============================================================

/**
 * SESSION_PREFIX_
 * DESCRIPTION: คำนำหน้า Key ใน CacheService
 *   ใช้แยก Session ของแต่ละ Token ออกจากกัน
 *   ตัวอย่าง Key: 'session_a1b2c3d4-e5f6-...'
 */
var SESSION_PREFIX_ = 'session_';

/**
 * SESSION_EXPIRY_SECONDS_
 * DESCRIPTION: ระยะเวลาหมดอายุของ Session (วินาที)
 *   CacheService รองรับสูงสุด 21600 วินาที (6 ชั่วโมง)
 *   ตั้งไว้ 6 ชั่วโมงตามค่าสูงสุด
 */
var SESSION_EXPIRY_SECONDS_ = 21600;


// ============================================================
// SECTION: LOGIN / LOGOUT - เข้า/ออก ระบบ
// ============================================================

/**
 * login()
 * DESCRIPTION: ฟังก์ชัน Login (Frontend เรียกผ่าน google.script.run)
 *   1. รับ Username + Password
 *   2. Hash Password ด้วย SHA-256
 *   3. ค้นหาในชีต Users
 *   4. ถ้าผ่าน → สร้าง Session Token → คืนค่า Token + UserInfo
 *   5. ถ้าไม่ผ่าน → คืนค่า Error Message
 *
 * @param {string} username - ชื่อผู้ใช้
 * @param {string} password - รหัสผ่าน (Plain Text - จะถูก Hash ก่อนเปรียบเทียบ)
 * @returns {Object} - {success: true, token: '...', user: {...}}
 *                     หรือ {success: false, message: '...'}
 */
function login(username, password) {
  try {
    // ตรวจสอบว่ากรอกข้อมูลครบหรือไม่
    if (!username || !password) {
      return {
        success: false,
        message: 'กรุณากรอก Username และ Password'
      };
    }

    // Hash Password ที่ผู้ใช้กรอก
    var passwordHash = hashPassword_(password);

    // ค้นหา User ในชีต
    var userResult = findRowById_(SHEETS.USERS, 'Username', username);

    // กรณีไม่พบ Username
    if (!userResult) {
      return {
        success: false,
        message: 'Username หรือ Password ไม่ถูกต้อง'
      };
    }

    // แปลงข้อมูลแถวเป็น Object
    var headers = userResult.headers;
    var rowData = userResult.data;
    var userObj = {};
    for (var i = 0; i < headers.length; i++) {
      userObj[headers[i]] = rowData[i];
    }

    // ตรวจสอบ Password Hash
    if (userObj.PasswordHash !== passwordHash) {
      return {
        success: false,
        message: 'Username หรือ Password ไม่ถูกต้อง'
      };
    }

    // ตรวจสอบสถานะบัญชี (ACTIVE/INACTIVE)
    if (userObj.Status !== 'ACTIVE') {
      return {
        success: false,
        message: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
      };
    }

    // สร้าง Session Token
    var token = createSession_(userObj);

    // อัพเดท LastLogin
    updateLastLogin_(userResult.rowIndex);

    // คืนค่าผลลัพธ์ (ไม่ส่ง PasswordHash กลับไป)
    return {
      success: true,
      token: token,
      user: {
        UserID: userObj.UserID,
        Username: userObj.Username,
        DisplayName: userObj.DisplayName,
        Role: userObj.Role
      }
    };

  } catch (error) {
    return {
      success: false,
      message: 'เกิดข้อผิดพลาดในระบบ: ' + error.toString()
    };
  }
}

/**
 * logout()
 * DESCRIPTION: ออกจากระบบ (ลบ Session Token ออกจาก CacheService)
 *
 * @param {string} token - Session Token ที่ต้องการลบ
 * @returns {Object} - {success: true}
 */
function logout(token) {
  try {
    if (token) {
      var cache = CacheService.getScriptCache();
      cache.remove(SESSION_PREFIX_ + token);
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: 'Logout ไม่สำเร็จ: ' + error.toString()
    };
  }
}


// ============================================================
// SECTION: SESSION MANAGEMENT - จัดการ Session Token
// ============================================================

/**
 * createSession_()
 * DESCRIPTION: สร้าง Session Token ใหม่ เก็บใน CacheService
 *   Token = UUID (ไม่ซ้ำกัน)
 *   เก็บข้อมูล User (ไม่รวม PasswordHash) เป็น JSON
 *
 * @param {Object} userObj - ข้อมูลผู้ใช้ (จากชีต Users)
 * @returns {string} - Session Token (UUID)
 */
function createSession_(userObj) {
  var token = Utilities.getUuid();
  var cache = CacheService.getScriptCache();

  // ข้อมูลที่จะเก็บใน Session (ไม่รวม PasswordHash)
  var sessionData = {
    UserID: userObj.UserID,
    Username: userObj.Username,
    DisplayName: userObj.DisplayName,
    Role: userObj.Role,
    LoginAt: getCurrentTimestamp_()
  };

  // เก็บเป็น JSON String ใน CacheService
  cache.put(
    SESSION_PREFIX_ + token,
    JSON.stringify(sessionData),
    SESSION_EXPIRY_SECONDS_
  );

  return token;
}

/**
 * validateSession()
 * DESCRIPTION: ตรวจสอบว่า Token ยังใช้งานได้หรือไม่
 *   Frontend เรียกทุกครั้งที่โหลดหน้า หรือก่อนทำรายการสำคัญ
 *
 * @param {string} token - Session Token
 * @returns {Object} - {valid: true, user: {...}} หรือ {valid: false}
 */
function validateSession(token) {
  try {
    if (!token) {
      return { valid: false, message: 'ไม่พบ Token' };
    }

    var cache = CacheService.getScriptCache();
    var sessionJson = cache.get(SESSION_PREFIX_ + token);

    if (!sessionJson) {
      return { valid: false, message: 'Session หมดอายุ กรุณา Login ใหม่' };
    }

    var sessionData = JSON.parse(sessionJson);

    return {
      valid: true,
      user: sessionData
    };

  } catch (error) {
    return { valid: false, message: 'ตรวจสอบ Session ไม่สำเร็จ: ' + error.toString() };
  }
}

/**
 * checkPermission()
 * DESCRIPTION: ตรวจสอบว่า User มีสิทธิ์ตามที่กำหนดหรือไม่
 *   ใช้ก่อนทำรายการสำคัญ (เช่น ลบสินค้า, จัดการผู้ใช้)
 *
 * @param {string} token - Session Token
 * @param {string} requiredRole - สิทธิ์ที่ต้องการ ('ADMIN' หรือ 'STAFF')
 * @returns {Object} - {allowed: true, user: {...}} หรือ {allowed: false, message: '...'}
 */
function checkPermission(token, requiredRole) {
  // ตรวจสอบ Session ก่อน
  var session = validateSession(token);

  if (!session.valid) {
    return {
      allowed: false,
      message: session.message
    };
  }

  // ถ้า requiredRole เป็น 'STAFF' → ทั้ง ADMIN และ STAFF เข้าถึงได้
  if (requiredRole === 'STAFF') {
    return {
      allowed: true,
      user: session.user
    };
  }

  // ถ้า requiredRole เป็น 'ADMIN' → ต้องเป็น ADMIN เท่านั้น
  if (requiredRole === 'ADMIN') {
    if (session.user.Role === 'ADMIN') {
      return {
        allowed: true,
        user: session.user
      };
    } else {
      return {
        allowed: false,
        message: 'คุณไม่มีสิทธิ์ดำเนินการนี้ (ต้องเป็น Admin เท่านั้น)'
      };
    }
  }

  return {
    allowed: false,
    message: 'ไม่รู้จักสิทธิ์: ' + requiredRole
  };
}

/**
 * updateLastLogin_()
 * DESCRIPTION: อัพเดทเวลา Login ล่าสุดของผู้ใช้
 *
 * @param {number} rowIndex - แถวของผู้ใช้ในชีต Users (1-based)
 */
function updateLastLogin_(rowIndex) {
  try {
    var now = getCurrentTimestamp_();
    // คอลัมน์ LastLogin คือคอลัมน์ที่ 8 (H)
    updateCellWithLock_(SHEETS.USERS, rowIndex, 8, now);
  } catch (error) {
    // ไม่ throw Error เพราะ不影响การ Login
    Logger.log('อัพเดท LastLogin ไม่สำเร็จ: ' + error.toString());
  }
}


// ============================================================
// SECTION: USER MANAGEMENT - จัดการผู้ใช้ (เฉพาะ Admin)
// ============================================================

/**
 * getUserList()
 * DESCRIPTION: ดึงรายชื่อผู้ใช้ทั้งหมด (เฉพาะ Admin เรียกได้)
 *   ไม่ส่ง PasswordHash กลับไป
 *
 * @param {string} token - Session Token
 * @returns {Object} - {success: true, users: [...]} หรือ {success: false, message: '...'}
 */
function getUserList(token) {
  // ตรวจสอบสิทธิ์ Admin
  var permission = checkPermission(token, 'ADMIN');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    var allUsers = getAllData_(SHEETS.USERS);

    // ลบ PasswordHash ออกจากผลลัพธ์ (ความปลอดภัย)
    var safeUsers = [];
    for (var i = 0; i < allUsers.length; i++) {
      var user = allUsers[i];
      safeUsers.push({
        UserID: user.UserID,
        Username: user.Username,
        DisplayName: user.DisplayName,
        Role: user.Role,
        Status: user.Status,
        CreatedAt: user.CreatedAt,
        LastLogin: user.LastLogin
      });
    }

    return { success: true, users: safeUsers };

  } catch (error) {
    return {
      success: false,
      message: 'ดึงรายชื่อผู้ใช้ไม่สำเร็จ: ' + error.toString()
    };
  }
}

/**
 * addUser()
 * DESCRIPTION: เพิ่มผู้ใช้ใหม่ (เฉพาะ Admin)
 *
 * @param {string} token - Session Token
 * @param {Object} userData - {Username, Password, DisplayName, Role}
 * @returns {Object} - {success: true, message: '...'} หรือ {success: false, message: '...'}
 */
function addUser(token, userData) {
  // ตรวจสอบสิทธิ์ Admin
  var permission = checkPermission(token, 'ADMIN');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    // ตรวจสอบข้อมูลที่ต้องมี
    if (!userData.Username || !userData.Password || !userData.DisplayName) {
      return {
        success: false,
        message: 'กรุณากรอก Username, Password และ DisplayName ให้ครบ'
      };
    }

    // ตรวจสอบว่า Username ซ้ำหรือไม่
    var existingUser = findRowById_(SHEETS.USERS, 'Username', userData.Username);
    if (existingUser) {
      return {
        success: false,
        message: 'Username "' + userData.Username + '" มีอยู่แล้วในระบบ'
      };
    }

    // ตรวจสอบ Role
    var role = userData.Role || 'STAFF';
    if (role !== 'ADMIN' && role !== 'STAFF') {
      return {
        success: false,
        message: 'Role ต้องเป็น ADMIN หรือ STAFF เท่านั้น'
      };
    }

    // สร้าง UserID ใหม่
    var newUserId = getNextId_(SHEETS.USERS, 'USR');
    var now = getCurrentTimestamp_();

    // เตรียมข้อมูลแถวใหม่
    var newRow = [
      newUserId,
      userData.Username,
      hashPassword_(userData.Password),
      userData.DisplayName,
      role,
      'ACTIVE',
      now,
      ''
    ];

    // เพิ่มแถวใหม่
    appendRowWithLock_(SHEETS.USERS, newRow);

    return {
      success: true,
      message: 'เพิ่มผู้ใช้ "' + userData.DisplayName + '" สำเร็จ'
    };

  } catch (error) {
    return {
      success: false,
      message: 'เพิ่มผู้ใช้ไม่สำเร็จ: ' + error.toString()
    };
  }
}

/**
 * updateUser()
 * DESCRIPTION: แก้ไขข้อมูลผู้ใช้ (เฉพาะ Admin)
 *   แก้ไขได้: DisplayName, Role, Status, Password (ถ้ากรอก)
 *
 * @param {string} token - Session Token
 * @param {Object} userData - {UserID, DisplayName, Role, Status, Password (optional)}
 * @returns {Object} - {success: true} หรือ {success: false, message: '...'}
 */
function updateUser(token, userData) {
  // ตรวจสอบสิทธิ์ Admin
  var permission = checkPermission(token, 'ADMIN');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    if (!userData.UserID) {
      return { success: false, message: 'ไม่พบ UserID' };
    }

    // ค้นหาผู้ใช้ที่ต้องการแก้ไข
    var userResult = findRowById_(SHEETS.USERS, 'UserID', userData.UserID);
    if (!userResult) {
      return { success: false, message: 'ไม่พบผู้ใช้: ' + userData.UserID };
    }

    // แปลงข้อมูลเดิมเป็น Object
    var headers = userResult.headers;
    var rowData = userResult.data.slice(); // slice() เพื่อ copy array (ไม่แก้ต้นฉบับ)

    // หา Index ของแต่ละคอลัมน์
    var colMap = {};
    for (var i = 0; i < headers.length; i++) {
      colMap[headers[i]] = i;
    }

    // อัพเดทค่าที่ส่งมา
    if (userData.DisplayName) {
      rowData[colMap.DisplayName] = userData.DisplayName;
    }
    if (userData.Role && (userData.Role === 'ADMIN' || userData.Role === 'STAFF')) {
      rowData[colMap.Role] = userData.Role;
    }
    if (userData.Status && (userData.Status === 'ACTIVE' || userData.Status === 'INACTIVE')) {
      rowData[colMap.Status] = userData.Status;
    }
    // ถ้ากรอก Password ใหม่ → Hash แล้วอัพเดท
    if (userData.Password && userData.Password !== '') {
      rowData[colMap.PasswordHash] = hashPassword_(userData.Password);
    }

    // บันทึก
    updateRowWithLock_(SHEETS.USERS, userResult.rowIndex, rowData);

    return {
      success: true,
      message: 'อัพเดทผู้ใช้ "' + userData.UserID + '" สำเร็จ'
    };

  } catch (error) {
    return {
      success: false,
      message: 'อัพเดทผู้ใช้ไม่สำเร็จ: ' + error.toString()
    };
  }
}

/**
 * deleteUser()
 * DESCRIPTION: ลบผู้ใช้ (เฉพาะ Admin)
 *   ป้องกัน: ไม่สามารถลบตัวเองได้
 *
 * @param {string} token - Session Token
 * @param {string} targetUserId - UserID ที่ต้องการลบ
 * @returns {Object} - {success: true} หรือ {success: false, message: '...'}
 */
function deleteUser(token, targetUserId) {
  // ตรวจสอบสิทธิ์ Admin
  var permission = checkPermission(token, 'ADMIN');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    // ป้องกัน: ห้ามลบตัวเอง
    if (permission.user.UserID === targetUserId) {
      return {
        success: false,
        message: 'ไม่สามารถลบบัญชีของตัวเองได้'
      };
    }

    // ค้นหาผู้ใช้ที่ต้องการลบ
    var userResult = findRowById_(SHEETS.USERS, 'UserID', targetUserId);
    if (!userResult) {
      return { success: false, message: 'ไม่พบผู้ใช้: ' + targetUserId };
    }

    // ลบแถว
    deleteRowWithLock_(SHEETS.USERS, userResult.rowIndex);

    return {
      success: true,
      message: 'ลบผู้ใช้ "' + targetUserId + '" สำเร็จ'
    };

  } catch (error) {
    return {
      success: false,
      message: 'ลบผู้ใช้ไม่สำเร็จ: ' + error.toString()
    };
  }
}