# 📦 Stock Management System (Google Apps Script)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Google Apps Script](https://img.shields.io/badge/Platform-Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://script.google.com)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-success)]()

ระบบจัดการสต็อกสินค้า **ครบวงจร** ที่รันบน Google Apps Script + Google Sheets — ไม่ต้องเช่าเซิร์ฟเวอร์, ไม่ต้องตั้ง database, **ฟรี** และ deploy เป็น Web App ได้ในไม่กี่นาที

> 💡 **ทำไมถึงทำบน GAS?** เพราะได้ Google Sheets เป็น database + UI ที่ดูข้อมูลดิบได้ตลอดเวลา + Auth/Hosting ฟรีจาก Google เหมาะกับ SME/ร้านค้า/คลังสินค้าขนาดเล็ก-กลาง

---

## ✨ Features

### 🎯 Core
- 🔐 **Login + แบ่งสิทธิ์** — `ADMIN` / `STAFF` (รหัสผ่าน Hash SHA-256)
- 📦 **จัดการสินค้า (CRUD)** — เพิ่ม/แก้/ลบ/ค้นหา + บาร์โค้ด + หมวดหมู่
- 🔄 **เคลื่อนไหวสต็อก** — รับเข้า / จ่ายออก / ปรับปรุง (Atomic + Lock กัน race condition)
- 📊 **Dashboard** — 4 การ์ดสถิติ + กราฟเข้า-ออก 30 วัน (Chart.js) + แจ้งเตือนสต็อกต่ำ
- 📜 **ประวัติย้อนหลัง** — Audit Trail ครบ (ใครทำ/เมื่อไหร่) + ตัวกรองตามประเภท/วันที่
- 👥 **จัดการผู้ใช้** — เพิ่ม/แก้/ปิดบัญชี/ลบ (Admin)
- ⚙️ **ตั้งค่าระบบ** — ชื่อบริษัท/สกุลเงิน/Session
- 📥 **ส่งออก CSV** — สต็อก + ประวัติ (ภาษาไทยไม่เพี้ยนใน Excel)

### 🛡️ Technical Highlights
- 🗄️ **Auto-Deploy Database** — รัน `setupDatabase()` ครั้งเดียว สร้างชีต+Header+Validation อัตโนมัติ
- 🔒 **LockService** — ป้องกันตัดสต็อกพร้อมกันผิด (race condition)
- 🎨 **Modern UI** — Glassmorphism, Animations, Shadows, Responsive (Mobile-ready)
- 🔍 **Barcode-ready** — รองรับเครื่องยิงบาร์โค้ด (ยิงแล้ว Enter)

---

## 🖼️ Screenshots

| Login | Dashboard |
|:---:|:---:|
| ![Login](docs/screenshots/01-login.png) | ![Dashboard](docs/screenshots/02-dashboard.png) |

| จัดการสินค้า | เคลื่อนไหวสต็อก |
|:---:|:---:|
| ![Products](docs/screenshots/03-products.png) | ![Stock Movement](docs/screenshots/04-stock.png) |

---

## ⚠️ อ่านก่อน: GAS "ไม่เหมือน" Python / Next.js

ถ้าคุณคุ้นกับการ `git clone` → `pip install` / `npm install` → `run` — **GAS ทำแบบนั้นไม่ได้** เพราะโค้ด GAS รันบน **Google Cloud ของคุณ** ไม่ใช่เครื่องคุณ

ดังนั้นขั้นตอนติดตั้งจะเป็น:
> **สร้าง Spreadsheet → เปิด Apps Script Editor (GUI) → สร้างไฟล์ + copy โค้ดจาก `src/` → รัน setup → Deploy**

ฟังดูเยอะ แต่จริงๆ **~5-10 นาที** และทำครั้งเดียวครับ 👇 (มีรูปประกอบทุกขั้น)

---

## 🚀 Quick Start (ติดตั้งครั้งแรก)

### สิ่งที่จำเป็น
- Google Account (Gmail ฟรี)
- เบราว์เซอร์ (Chrome / Edge แนะนำ)

### ขั้นที่ 1 — สร้าง Spreadsheet + เปิด Apps Script
1. สร้าง Google Spreadsheet ใหม่ (ชื่ออะไรก็ได้)
2. เมนู **Extensions (ส่วนเสริม)** → **Apps Script**

   ![เปิด Apps Script](docs/screenshots/03-extensions-menu.png)
   *เมนู Extensions → Apps Script*

### ขั้นที่ 2 — สร้างไฟล์โค้ด (copy จาก `src/`)
ใน Apps Script Editor ให้สร้างไฟล์ **ให้ตรงชื่อนี้** (ลบ `Code.gs` เดิมที่ Google สร้างให้ แล้ววางโค้ดใหม่):

**Script files (กด `+` ข้าง Files → Script):**
| ชื่อไฟล์ใน Editor | copy จาก |
|---|---|
| `Code` | `src/Code.gs` |
| `Database` | `src/Database.gs` |
| `Auth` | `src/Auth.gs` |
| `ProductService` | `src/ProductService.gs` |
| `StockService` | `src/StockService.gs` |
| `SettingsService` | `src/SettingsService.gs` |
| `ReportService` | `src/ReportService.gs` |

**HTML files (กด `+` ข้าง Files → HTML):**
| ชื่อไฟล์ใน Editor | copy จาก |
|---|---|
| `index` | `src/index.html` |
| `style` | `src/style.html` |
| `script` | `src/script.html` |

> ⚠️ **สำคัญ:** ตอนสร้าง HTML file ใน Editor **พิมพ์แค่ `index` / `style` / `script`** (ไม่ต้องพิมพ์ `.html` — Editor เติมให้เอง) และเนื้อหาในไฟล์ `.html` ของ repo คือ **ทั้งหมด** ที่ต้องวางลง (รวมแท็ก `<style>`/`<script>` ข้างในด้วย)

### ขั้นที่ 3 — สร้างฐานข้อมูล (รันครั้งเดียว)
1. ที่แถบด้านบน เลือกฟังก์ชัน **`setupDatabase`** → กด **▶ Run**

   ![รัน setupDatabase](docs/screenshots/04-run-setup.png)
2. Google ขออนุญาตสิทธิ์ → **Review permissions** → เลือกบัญชี → ถ้าขึ้น *"This app isn't verified"* กด **Advanced** → **Go to (unsafe)** → **Allow**

   ![Authorize](docs/screenshots/05-authorize.png)
   *คำเตือนนี้ปกติ เพราะเป็นสคริปต์ที่เราเขียนเอง*
3. รอจนขึ้น popup **"Setup สำเร็จ! ✅"** → กลับไปดู Spreadsheet จะเห็น 4 ชีต: `Users`, `Products`, `Transactions`, `Settings`

### ขั้นที่ 4 — Deploy เป็น Web App
1. มุมขวาบน **Deploy** → **New deployment**
2. กด ⚙️ ข้าง *Select type* → เลือก **Web app**
3. ตั้งค่า:
   - **Execute as:** `Me` ✅ *(ต้องเป็น Me เสมอ)*
   - **Who has access:** `Anyone with Google account`
4. กด **Deploy** → **Authorize** (ถ้าถาม)

   ![Deploy settings](docs/screenshots/06-deploy-settings.png)
5. คัดลอก **Web app URL**

   ![Web app URL](docs/screenshots/07-webapp-url.png)

### ขั้นที่ 5 — เปิดใช้งาน 🎉
เปิด Web app URL → Login ด้วยบัญชีเริ่มต้น:
```
Username : admin
Password : admin123
```
> 🚨 **เปลี่ยนรหัส `admin` ทันที** หลังเข้าครั้งแรก (เมนู ผู้ใช้งาน → แก้ไข)

---

## 🛠️ สำหรับ Developer: ใช้ `clasp` (dev แบบ local + git)

ถ้าคุณอยาก dev บนเครื่องด้วย VS Code + push/pull ผ่าน git (เหมือนโปรเจคปกติ) — Google มี CLI ชื่อ **[`clasp`](https://github.com/google/clasp)** ครับ

```bash
npm install -g @google/clasp
clasp login                       # login Google (เปิดเบราว์เซอร์)
clasp clone <scriptId>            # clone project ที่มีอยู่ลงเครื่อง
# หรือ
clasp create --type standalone    # สร้าง project ใหม่
clasp push                        # push โค้ดจากเครื่อง → GAS
clasp open                        # เปิด Editor บนเว็บ
```

> 📌 repo นี้มี `.clasp.json.example` — ให้ copy เป็น `.clasp.json` แล้วใส่ `scriptId` ของคุณ (ได้จากการรัน `clasp create` หรือดูจาก URL ของ Apps Script project)
>
> ⚠️ `.clasp.json` มี `scriptId` เฉพาะคน → **อย่า commit** (มีใน `.gitignore` แล้ว)

---

## 🔄 การอัพเดทโค้ด (หลังแก้)

แก้โค้ดใน Apps Script Editor → Save → แล้ว **ต้อง Deploy เวอร์ชันใหม่**:
> **Deploy → Manage deployments → ✏️ → Version: `New version` → Deploy**

จากนั้นกด **Ctrl+Shift+R** (Hard Refresh) ที่ Web App

> ⚠️ ถ้าไม่เลือก *New version* → ผู้ใช้จะยังเห็นโค้ดเก่า (นี่คือสาเหตุ #1 ของ "แก้แล้วไม่หาย")

---

## 🗄️ Database Schema

`setupDatabase()` สร้าง 4 ชีตอัตโนมัติ:

| ชีต | หน้าที่ |
|---|---|
| `Users` | บัญชี + สิทธิ์ + Session log |
| `Products` | สินค้า + สต็อกคงเหลือ |
| `Transactions` | ประวัติเคลื่อนไหว (Audit Trail) |
| `Settings` | ค่าตั้งค่าระบบ (Key-Value) |

> 💡 รัน `setupDatabase()` ซ้ำได้ปลอดภัย (Idempotent) — ไม่ลบข้อมูลเดิม

---

## ❓ FAQ

| อาการ | วิธีแก้ |
|---|---|
| หน้าเว็บขาว / แสดง `<?!= include ?>` | เช็ค `doGet()` ว่าเป็น `createTemplateFromFile('index').evaluate()` |
| แก้โค้ดแล้วเว็บไม่เปลี่ยน | Deploy → New version → แล้ว Ctrl+Shift+R |
| `Cannot read properties of null` | (แก้แล้วในโค้ด) ถ้าเจออีก เช็ค Execution log ใน Editor |
| CSV ไทยเพี้ยน | เปิดด้วย Google Sheets / Excel แบบ UTF-8 (ระบบใส่ BOM ไว้แล้ว) |
| ลืมรหัส admin | ลบชีต `Users` → รัน `setupDatabase` ใหม่ (⚠️ ข้อมูล user หาย) |

---

## 🔐 Security Notes
- รหัสผ่านเก็บแบบ **SHA-256 Hash** (ไม่เก็บ plain text)
- Session Token (UUID) หมดอายุอัตโนมัติ (สูงสุด 6 ชม. — ข้อจำกัด CacheService)
- แยกสิทธิ์ ADMIN/STAFF ทุกจุด + Audit Trail ทุก transaction
- แนะนำ **Execute as = Me** + **Who has access = Anyone with Google account** = ปลอดภัย 2 ชั้น

---

## 📄 License
MIT — ใช้/แก้/แจก ได้เสรี (ดู [LICENSE](LICENSE))

---

## 🙏 Credits
สร้างด้วย ❤️ บน Google Apps Script (2026)