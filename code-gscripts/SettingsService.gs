/**
 * ============================================================
 * FILE: SettingsService.gs
 * DESCRIPTION: Backend จัดการการตั้งค่าระบบ (ชีต Settings)
 *   - getSettings(): อ่านค่าตั้งค่าทั้งหมด (คืนเป็น object {key: value})
 *   - saveSettings(): บันทึกค่าตั้งค่า (ADMIN เท่านั้น, lock ครอบ atomic)
 *
 * โครงสร้างชีต Settings: Key | Value | Description
 * ============================================================
 */

// ============================================================
// SECTION: READ - อ่านการตั้งค่า
// ============================================================

/**
 * getSettings()
 * DESCRIPTION: อ่านค่าตั้งค่าทั้งหมดจากชีต Settings
 *   คืนเป็น object ง่ายต่อการใช้: { COMPANY_NAME: '...', CURRENCY: 'THB', ... }
 *   สิทธิ์: STAFF ขึ้นไป (อ่านได้อย่างเดียว)
 *
 * @param {string} token - Session Token
 * @returns {Object} - {success, settings: {...}}
 */
function getSettings(token) {
  var permission = checkPermission(token, 'STAFF');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  try {
    var all = getAllData_(SHEETS.SETTINGS);
    var settings = {};
    for (var i = 0; i < all.length; i++) {
      if (all[i].Key) {
        settings[all[i].Key] = all[i].Value;
      }
    }
    Logger.log('[getSettings] อ่านได้ ' + Object.keys(settings).length + ' ค่า');
    return { success: true, settings: settings };
  } catch (error) {
    Logger.log('[getSettings] ERROR: ' + error.toString());
    return { success: false, message: 'อ่านการตั้งค่าไม่สำเร็จ: ' + error.toString() };
  }
}


// ============================================================
// SECTION: WRITE - บันทึกการตั้งค่า
// ============================================================

/**
 * saveSettings()
 * DESCRIPTION: บันทึกค่าตั้งค่า (รับเป็น object {key: value})
 *   ⚠️ ADMIN เท่านั้น
 *   ⚠️ ใช้ Lock เดียวครอบ loop update ทุก key (atomic กันทับกัน)
 *      ใช้ findRowById_ (อ่าน ไม่ lock) + updateCellDirect_ (เขียน ไม่ lock)
 *      ภายใน lock ของตัวเอง → ไม่มี reentrant lock
 *   ⚠️ อัพเดทเฉพาะ key ที่มีอยู่ในชีต (กันสร้าง key แปลกๆ)
 *
 * @param {string} token - Session Token
 * @param {Object} settingsObj - { COMPANY_NAME: '...', CURRENCY: 'THB', ... }
 * @returns {Object} - {success, message}
 */
function saveSettings(token, settingsObj) {
  var permission = checkPermission(token, 'ADMIN');
  if (!permission.allowed) {
    return { success: false, message: permission.message };
  }

  if (!settingsObj || typeof settingsObj !== 'object') {
    return { success: false, message: 'ข้อมูลการตั้งค่าไม่ถูกต้อง' };
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    var updated = 0;
    var keys = Object.keys(settingsObj);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var newValue = String(settingsObj[key] == null ? '' : settingsObj[key]);

      // หาแถวของ key นี้ (อ่าน ไม่ lock)
      var found = findRowById_(SHEETS.SETTINGS, 'Key', key);
      if (found) {
        // สร้าง colMap หาตำแหน่ง Value
        var headers = found.headers;
        var valueCol = -1;
        for (var c = 0; c < headers.length; c++) {
          if (headers[c] === 'Value') { valueCol = c; break; }
        }
        if (valueCol !== -1) {
          // เขียนค่าใหม่ (direct ไม่ lock ซ้ำ) - +1 เพราะ API 1-based
          updateCellDirect_(SHEETS.SETTINGS, found.rowIndex, valueCol + 1, newValue);
          updated++;
        }
      } else {
        Logger.log('[saveSettings] ข้าม key ที่ไม่มีในชีต: ' + key);
      }
    }

    Logger.log('[saveSettings] อัพเดท ' + updated + ' ค่า');
    return { success: true, message: 'บันทึกการตั้งค่าสำเร็จ (' + updated + ' รายการ)' };

  } catch (error) {
    Logger.log('[saveSettings] ERROR: ' + error.toString());
    return { success: false, message: 'บันทึกการตั้งค่าไม่สำเร็จ: ' + error.toString() };
  } finally {
    lock.releaseLock();
  }
}