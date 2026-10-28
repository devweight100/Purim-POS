using System;
using System.Runtime.InteropServices;

namespace PurimPOS {
    class Program {
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

        static int Main(string[] args) {
            string printerName = "";
            if (args.Length > 0 && !string.IsNullOrWhiteSpace(args[0])) {
                printerName = args[0].Trim();
            }

            if (string.IsNullOrEmpty(printerName)) {
                Console.Error.WriteLine("Error: Printer name is required.");
                return 1;
            }

            // Pure ESC/POS pulse only - NO LINE FEED (0x0A) so no paper feeds out!
            // 0x1B, 0x70, 0x00, 0x32, 0x78 : Pin 2 (100ms pulse)
            // 0x1B, 0x70, 0x01, 0x32, 0x78 : Pin 5 (100ms pulse)
            byte[] kickBytes = new byte[] {
                0x1B, 0x70, 0x00, 0x32, 0x78,
                0x1B, 0x70, 0x01, 0x32, 0x78
            };

            IntPtr hPrinter = IntPtr.Zero;
            DOCINFOA di = new DOCINFOA();
            di.pDocName = "Cash Drawer Pulse";
            di.pDataType = "RAW";

            try {
                if (OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
                    bool success = false;
                    if (StartDocPrinter(hPrinter, 1, di)) {
                        if (StartPagePrinter(hPrinter)) {
                            IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(kickBytes.Length);
                            Marshal.Copy(kickBytes, 0, pUnmanagedBytes, kickBytes.Length);
                            int dwWritten = 0;
                            success = WritePrinter(hPrinter, pUnmanagedBytes, kickBytes.Length, out dwWritten);
                            Marshal.FreeCoTaskMem(pUnmanagedBytes);
                            EndPagePrinter(hPrinter);
                        }
                        EndDocPrinter(hPrinter);
                    }
                    ClosePrinter(hPrinter);

                    if (success) {
                        Console.WriteLine("SUCCESS: Cash drawer kick sent to [" + printerName + "]");
                        return 0;
                    } else {
                        Console.Error.WriteLine("FAILED: WritePrinter returned false for [" + printerName + "]");
                        return 2;
                    }
                } else {
                    int err = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("FAILED: OpenPrinter error code " + err + " for [" + printerName + "]");
                    return 3;
                }
            } catch (Exception ex) {
                Console.Error.WriteLine("ERROR: " + ex.Message);
                return 4;
            }
        }
    }
}
