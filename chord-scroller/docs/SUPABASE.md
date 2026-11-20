# ตั้งค่า Supabase ให้ลิงก์สาธารณะซิงก์ทั้งวง

ลิงก์ https://moszasa09-boop.github.io/film-collection/ จะใช้ Supabase เมื่อ repo มีไฟล์ `chord-scroller/cloud.json`
ถ้าไม่มีไฟล์นี้ แอปจะเก็บข้อมูลในเครื่องเหมือนเดิม

## ที่ได้หลังตั้งค่า
- **บัญชี:** สมาชิกเข้าสู่ระบบด้วยอีเมล ได้ทั้งลิงก์และรหัส 6 หลัก ไม่ต้องตั้งรหัสผ่าน
- **วงและสิทธิ์:**
  - วงมีเจ้าของ ผู้แก้ไข และผู้ดู
  - เจ้าของสร้างลิงก์เชิญ เปลี่ยนสิทธิ์ และเอาคนออกได้
- **ซิงก์ทันทีทุกเครื่อง:**
  - ระหว่างออฟไลน์ การแก้ไขจะรอส่งในเครื่อง แล้วส่งเองเมื่อมีเน็ต
  - ถ้าสองคนบันทึกเพลงเดียวกัน ระบบจะถามก่อน ไม่ทับกันเงียบ ๆ
- **ประวัติ:** เซิร์ฟเวอร์เก็บประวัติทุกการแก้ไขและการลบ (ตาราง `doc_audit`)
- **อ่านคอร์ดจากรูป:** ใช้ Claude ผ่าน Edge Function `read-chords` เฉพาะเจ้าของและผู้แก้ไข ไม่เกิน 40 รูปต่อคนต่อชั่วโมง

## ขั้นตอน
1. **สร้างโปรเจกต์:** เข้า https://supabase.com แล้ว New project เลือก Region Singapore
2. **ใส่ค่าโปรเจกต์:** Project Settings → API คัดลอก **Project URL** และ **anon public key** ใส่ในไฟล์ `chord-scroller/cloud.json`
   ```json
   {"url": "https://xxxx.supabase.co", "anonKey": "eyJ..."}
   ```
   ทั้งสองค่าเปิดเผยได้ ความปลอดภัยของข้อมูลมาจากกฎสิทธิ์ (RLS) ในฐานข้อมูล
3. **สร้างตารางและสิทธิ์:** เปิด SQL Editor วางเนื้อหาไฟล์ `supabase/migrations/20261106000000_chord_scroller.sql` แล้วกด Run (รันซ้ำได้ไม่เสียหาย)
4. **ตั้งค่าล็อกอิน (Authentication):**
   - **URL Configuration → Site URL:** `https://moszasa09-boop.github.io/film-collection/chord-scroller/`
   - **Redirect URLs:** เพิ่ม `https://moszasa09-boop.github.io/film-collection/chord-scroller/**`
   - **Email Templates → Magic Link:** เพิ่มบรรทัด `รหัสเข้าสู่ระบบ: {{ .Token }}` เพื่อให้กรอกรหัส 6 หลักได้
5. **ตัวอ่านรูป:**
   - Edge Functions → Deploy new function ชื่อ `read-chords` วางโค้ดจาก `supabase/functions/read-chords/index.ts`
   - Edge Functions → Secrets เพิ่ม `ANTHROPIC_API_KEY` คีย์จาก https://console.anthropic.com
6. **ใช้งาน:** สร้าง `index.html` ใหม่ด้วย `python3 build.py` แล้ว push ขึ้น GitHub จากนั้นเปิดลิงก์ ล็อกอิน แล้วสร้างวง

ขั้นที่ 3–5 Claude ทำแทนได้ ถ้าให้ Personal Access Token ผ่านหน้าต่างกรอกคีย์แบบปลอดภัย ห้ามวางในแชต

## ค่าใช้จ่ายและข้อจำกัด
- **Supabase แบบฟรี:** พอสำหรับวงเดียว (ฐานข้อมูล 500 MB) แต่จะพักโปรเจกต์ถ้าไม่มีใครใช้นาน 1 สัปดาห์ เปิดใช้ใหม่ได้จากหน้า dashboard
- **อีเมลล็อกอินของ Supabase:** ระบบส่งอีเมลในตัวส่งได้น้อยต่อชั่วโมง ถ้าสมาชิกหลายคนล็อกอินพร้อมกันอาจต้องรอ ตั้ง SMTP ของตัวเองได้ที่ Authentication → SMTP Settings
- **ค่าอ่านรูป:** ใช้รุ่น `claude-opus-5-5` คิดกับบัญชี Anthropic ของเจ้าของ ประมาณไม่กี่บาทต่อเพลง ขึ้นกับจำนวนรูปและความยาวเพลง

## ทดสอบ
- **กฎสิทธิ์และฟังก์ชันในฐานข้อมูล:** `supabase/tests/run.sh` รันบน PostgreSQL ในเครื่อง ผ่าน 36 ข้อ
- **ทั้งระบบกับ Supabase จำลอง 3 บัญชี:** `node tests/cloud.js` ผ่าน 42 ข้อ
- **กับโปรเจกต์จริง:** ต้องทดสอบหลังตั้งค่าเสร็จ ยังไม่ได้ทำ
