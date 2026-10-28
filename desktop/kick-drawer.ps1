[CmdletBinding()]
param (
    [Parameter(Mandatory=$false)]
    [AllowEmptyString()]
    [string]$PrinterName = ""
)

# 1. Discover target printer dynamically if not found or empty
$printers = Get-CimInstance Win32_Printer
$chosenPrinter = $null

if ($PrinterName -and $PrinterName.Trim() -ne "") {
    $cleanName = $PrinterName.Trim()
    $chosenPrinter = $printers | Where-Object { $_.Name -eq $cleanName } | Select-Object -First 1
    if (-not $chosenPrinter) {
        $chosenPrinter = $printers | Where-Object { $_.Name -like "*$cleanName*" } | Select-Object -First 1
    }
}

if (-not $chosenPrinter) {
    # Search for EPSON, TM-T82, Receipt, Thermal, or POS printers
    $chosenPrinter = $printers | Where-Object { 
        $_.Name -like "*EPSON*" -or 
        $_.Name -like "*TM-*" -or 
        $_.Name -like "*T82*" -or 
        $_.Name -like "*Receipt*" -or 
        $_.Name -like "*POS*" -or 
        $_.Name -like "*Thermal*" -or
        $_.Name -like "*Slip*"
    } | Select-Object -First 1
}

if (-not $chosenPrinter) {
    # Fallback to Windows default printer
    $chosenPrinter = $printers | Where-Object { $_.Default -eq $true } | Select-Object -First 1
}

if (-not $chosenPrinter -and $printers.Count -gt 0) {
    $chosenPrinter = $printers[0]
}

if (-not $chosenPrinter) {
    Write-Error "No printer found on Windows."
    exit 1
}

$targetDevice = $chosenPrinter.Name
Write-Output "Selected Printer for Cash Drawer: $targetDevice"

Add-Type -TypeDefinition @"
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
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static bool SendBytes(string szPrinterName, byte[] bytes) {
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Cash Drawer Kick";
        di.pDataType = "RAW";
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
            bool success = false;
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                    int dwWritten = 0;
                    success = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
            return success;
        }
        return false;
    }
}
"@

# Standard pure ESC/POS kick pulses for Epson TM-T82 (NO Line Feed 0x0A to prevent paper feed)
# 0x1B, 0x70, 0x00, 0x32, 0x78 = ESC p 0 50 120 : Pin 2 pulse (100ms ON, 240ms OFF)
# 0x1B, 0x70, 0x01, 0x32, 0x78 = ESC p 1 50 120 : Pin 5 pulse (100ms ON, 240ms OFF)
[byte[]]$kickCodes = @(
    0x1B, 0x70, 0x00, 0x32, 0x78,
    0x1B, 0x70, 0x01, 0x32, 0x78
)

try {
    $res = [RawPrinterHelper]::SendBytes($targetDevice, $kickCodes)
    if ($res) {
        Write-Output "SUCCESS: Drawer kick pulse sent to [$targetDevice]"
        exit 0
    } else {
        Write-Error "FAILED: Winspool SendBytes returned false for [$targetDevice]"
        exit 1
    }
} catch {
    Write-Error "ERROR: $_"
    exit 1
}
