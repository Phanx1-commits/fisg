# Tradefolio · FISG MT5

แดชบอร์ดสรุปผลเทรดจาก MetaTrader 5 ด้วย React, TypeScript, Tailwind CSS และ Supabase รองรับหลายผู้ใช้และหลายบัญชี MT5 โดยแยกข้อมูลตามผู้ใช้และเลขบัญชี มีตัวเลือกดูทีละพอร์ตหรือรวมทุกพอร์ต

## เริ่มเว็บในเครื่อง

1. ติดตั้งแพ็กเกจด้วย `npm install`
2. ใส่ Project URL และ publishable key ใน `.env.local`
3. รัน `npm run dev`

## ตั้งค่า Supabase และเปิดใช้ sync

1. เปิด Supabase SQL Editor แล้วรัน `supabase/schema.sql`
2. ติดตั้ง Supabase CLI, เข้าสู่ระบบด้วย `npx supabase login` แล้วเชื่อมโปรเจกต์ `npx supabase link --project-ref djwejvlkxnhrizeoavhr`
3. Deploy ตัวรับข้อมูลด้วย `npx supabase functions deploy mt5-sync`
4. เปิด Email Auth ใน Supabase และเพิ่ม URL เว็บในรายการ Redirect URLs
5. Deploy frontend ไปยัง static host และตั้ง environment variables ตาม `.env.example`

## เชื่อม MT5 ของผู้ใช้

1. ผู้ใช้เข้าสู่ระบบในเว็บและกด **เชื่อม MT5** เพื่อสร้างโทเคนส่วนตัว ทำซ้ำสำหรับทุกบัญชี (เช่น 3 พอร์ต จะมี 3 โทเคน)
2. ดาวน์โหลด EA จากหน้าเว็บ แล้วเปิด `mql5/TradefolioSync.mq5` ใน MetaEditor และ Compile
3. วางไฟล์ `.ex5` ใน `MQL5/Experts` ผ่าน MT5 → File → Open Data Folder
4. เปิด EA บน chart ใดก็ได้ แล้วตั้ง `SyncEndpoint` และ `SyncToken` จากหน้าเว็บ
5. ใน MT5 → Tools → Options → Expert Advisors เปิด Allow WebRequest และเพิ่มโดเมน Supabase จากหน้าเว็บ จากนั้นเปิด Algo Trading

EA อ่านประวัติอย่างเดียวและส่งรายการปิดแล้วทุก 60 วินาที MT5 ต้องเปิดและออนไลน์เพื่อ sync; หากต้องการ sync ตลอดเวลาให้รันบน VPS ผู้ใช้แต่ละคนเชื่อมบัญชีของตัวเอง โทเคนจะแสดงครั้งเดียวและฐานข้อมูลเก็บเฉพาะ hash

## ความปลอดภัยและการคำนวณ

- ใช้เฉพาะ Supabase publishable key ในเบราว์เซอร์ ห้ามใส่ `service_role` key ใน frontend
- กำไรสุทธิ = Profit + Swap + Commission + Fee
- เวลาสรุปอิงเวลาปิดที่ EA อ่านจากประวัติ MT5 หรือเวลาปิดจากรายงานที่นำเข้า
- รายการซ้ำจะอัปเดตด้วย ticket เดิม ไม่สร้างรายการซ้ำ
