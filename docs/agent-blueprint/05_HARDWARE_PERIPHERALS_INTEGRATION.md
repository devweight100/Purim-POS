# 05 — การเชื่อมต่ออุปกรณ์ฮาร์ดแวร์หน้าร้าน (Hardware Peripherals Integration)

> เอกสารนี้ให้รายละเอียดเชิงลึกเกี่ยวกับวิธีที่ระบบ Purim POS ควบคุมอุปกรณ์ต่อพ่วงหน้าร้าน 3 ชนิด: **เครื่องพิมพ์สลิปความร้อน (Thermal Receipt Printer)**, **ลิ้นชักเก็บเงิน (Cash Drawer)**, และ **เครื่องสแกนบาร์โค้ด (Barcode Scanner)** พร้อมโค้ดที่สามารถนำไปใช้งานได้จริง

---

## 1. เครื่องพิมพ์สลิปความร้อน (ESC/POS Thermal Receipt Printer)

ระบบรองรับเครื่องพิมพ์สลิปความร้อนทั้งขนาด **80mm** (มาตรฐานยอดนิยม เช่น EPSON TM-T82, Xprinter) และ **58mm**:

### 1.1 คำสั่งมาตรฐาน ESC/POS Byte Sequences
เครื่องพิมพ์ความร้อนสั่งการด้วยรหัสไบต์พิเศษ (ESC/POS Control Codes):

```typescript
export const ESC_POS = {
  INIT: [0x1B, 0x40],                    // ESC @ (Initialize printer)
  ALIGN_LEFT: [0x1B, 0x61, 0x00],        // ESC a 0
  ALIGN_CENTER: [0x1B, 0x61, 0x01],      // ESC a 1
  ALIGN_RIGHT: [0x1B, 0x61, 0x02],       // ESC a 2
  BOLD_ON: [0x1B, 0x45, 0x01],           // ESC E 1
  BOLD_OFF: [0x1B, 0x45, 0x00],          // ESC E 0
  TEXT_NORMAL: [0x1D, 0x21, 0x00],       // GS ! 0
  TEXT_DOUBLE_HEIGHT: [0x1D, 0x21, 0x01],// GS ! 1
  TEXT_DOUBLE_WIDTH: [0x1D, 0x21, 0x10], // GS ! 16
  TEXT_LARGE: [0x1D, 0x21, 0x11],        // GS ! 17 (Double width + height)
  CUT_FULL: [0x1D, 0x56, 0x00],          // GS V 0 (Full Cut)
  CUT_PARTIAL: [0x1D, 0x56, 0x01],       // GS V 1 (Partial Cut)
  FEED_LINES: (n: number) => [0x1B, 0x64, n], // ESC d n (Feed n lines)
};
```

---

## 2. การสั่งเตะลิ้นชักเก็บเงิน (Cash Drawer Kick Mechanism)

ลิ้นชักเก็บเงินมาตรฐานมักเชื่อมต่อผ่านสายโทรศัพท์ RJ11 เข้ากับพอร์ตด้านหลังเครื่องพิมพ์ใบเสร็จ เมื่อเครื่องพิมพ์ได้รับคำสั่ง Pulse จะจ่ายไฟ 24V หรือ 12V ไปปลดล็อกกลอนลิ้นชัก

### 2.1 รหัสคำสั่ง Pulse (Pulse Codes)
```typescript
// สั่งเตะ Pin 2 (มาตรฐาน EPSON / Citizen / Star)
const KICK_PIN_2 = [0x1B, 0x70, 0x00, 0x19, 0xFA]; // ESC p 0 25 250

// สั่งเตะ Pin 5 (สำหรับลิ้นชักบางรุ่น)
const KICK_PIN_5 = [0x1B, 0x70, 0x01, 0x19, 0xFA]; // ESC p 1 25 250
```

### 2.2 ปัญหาในทางปฏิบัติและวิธีแก้ไข (The Driver Bypass Solution)
ใน Windows เมื่อพิมพ์ผ่านไดรเวอร์ Windows spooler ปกติ อักขระดิบ (Raw ESC/POS bytes) มักจะถูกไดรเวอร์กรองทิ้ง ทำให้ลิ้นชักไม่เด้ง

**วิธีแก้ปัญหาของ Purim POS**:
ระบบใช้ฟังก์ชันเรียกตรงเข้า Windows Spooler ผ่าน `winspool.Drv` Win32 API ในภาษา C# (`KickDrawer.cs` / `kick-drawer.exe`) ซึ่งบายพาสไดรเวอร์และส่งคำสั่งดิบเข้าเครื่องพิมพ์โดยตรง:

```csharp
using System;
using System.IO;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytesToPrinter(string szPrinterName, byte[] bytes) {
        IntPtr hPrinter;
        DOCINFOA di = new DOCINFOA { pDocName = "PurimPOS_KickDrawer", pDataType = "RAW" };
        if (!OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) return false;
        
        bool success = false;
        if (StartDocPrinter(hPrinter, 1, di)) {
            if (StartPagePrinter(hPrinter)) {
                IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                int written = 0;
                success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out written);
                Marshal.FreeCoTaskMem(pUnmanagedBytes);
                EndPagePrinter(hPrinter);
            }
            EndDocPrinter(hPrinter);
        }
        ClosePrinter(hPrinter);
        return success;
    }
}
```

---

## 3. ตัวแปลงคีย์บอร์ดไทยเกษมณีสำหรับเครื่องสแกนบาร์โค้ด (Thai Barcode Converter)

### 3.1 ปัญหาที่เกิดขึ้นจริงในร้านค้า (The Problem)
เครื่องสแกนบาร์โค้ดส่วนใหญ่ทำงานในโหมด **USB HID (Human Interface Device)** ทำตัวเสมือนเป็นแป้นพิมพ์คีย์บอร์ดที่พิมพ์ตัวเลขอัตโนมัติด้วยความเร็วสูง
- หากแคชเชียร์สลับคีย์บอร์ดของ Windows เป็นภาษาไทย (TH) ค้างไว้
- เมื่อยิงบาร์โค้ด เช่น `8851959123456`
- สแกนเนอร์จะพิมพ์แป้นคีย์ไทยออกมาเป็น: `คคถๅตถตๅ/-ภถุ`
- ส่งผลให้ระบบหาบาร์โค้ดไม่พบ และเกิดข้อผิดพลาดในการขาย

### 3.2 ตารางแปลงค่า (Mapping Table & Algorithm)

```typescript
// frontend/src/lib/thai-barcode-converter.ts
const KEDMANEE_TO_EN_MAP: Record<string, string> = {
  // ตัวเลขแถวบน (Unshifted)
  'ๅ': '1', '/': '2', '-': '3', 'ภ': '4', 'ถ': '5',
  'ุ': '6', 'ึ': '7', 'ค': '8', 'ต': '9', 'จ': '0',
  'ข': '-', 'ช': '=',

  // ตัวอักษรแถว Q-P
  'ๆ': 'q', 'ไ': 'w', 'ำ': 'e', 'พ': 'r', 'ะ': 't',
  'ั': 'y', 'ี': 'u', 'ร': 'i', 'น': 'o', 'ย': 'p',
  'บ': '[', 'ล': ']', 'ฃ': '\\',

  // ตัวอักษรแถว A-L
  'ฟ': 'a', 'ห': 's', 'ก': 'd', 'ด': 'f', 'เ': 'g',
  '้': 'h', '่': 'j', 'า': 'k', 'ส': 'l', 'ว': ';', 'ง': "'",

  // ตัวอักษรแถว Z-M
  'ผ': 'z', 'ป': 'x', 'แ': 'c', 'อ': 'v', 'ิ': 'b',
  'ื': 'n', 'ท': 'm', 'ม': ',', 'ใ': '.', 'ฝ': '/'
};

export function convertThaiBarcodeToEnglish(input: string): string {
  if (!input) return '';
  return input
    .split('')
    .map(char => KEDMANEE_TO_EN_MAP[char] ?? char)
    .join('');
}
```

### 3.3 การดักจับเหตุการณ์สแกนเนอร์ (Scanner Keystroke Listener)
สแกนเนอร์จะพิมพ์ตัวอักษรติดต่อกันเร็วมาก (แต่ละตัวอักษรห่างกัน < 25ms) และลงท้ายด้วยปุ่ม `Enter`:

```typescript
let buffer = '';
let lastKeyTime = Date.now();

window.addEventListener('keydown', (e) => {
  const currentTime = Date.now();
  
  if (currentTime - lastKeyTime > 50) {
    buffer = ''; // หากเว้นช่วงเกิน 50ms แปลว่าเป็นมนุษย์พิมพ์ ให้ล้าง buffer
  }
  lastKeyTime = currentTime;

  if (e.key === 'Enter') {
    if (buffer.length >= 3) {
      e.preventDefault();
      const cleanBarcode = convertThaiBarcodeToEnglish(buffer);
      handleBarcodeScanned(cleanBarcode);
      buffer = '';
    }
  } else if (e.key.length === 1) {
    buffer += e.key;
  }
});
```
