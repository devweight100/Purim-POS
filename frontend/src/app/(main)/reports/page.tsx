import { BarChart3 } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-7">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-sky-500" /> รายงานและการวิเคราะห์ (Reports & Analytics)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">รายงานสรุปยอดขาย กำไรขั้นต้น และสถิติภาพรวมธุรกิจ</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500 shadow-xs w-full">
        <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="font-bold text-slate-700 text-base">ระบบรายงานและวิเคราะห์ยอดขาย</p>
        <p className="text-xs text-slate-400 mt-1">กำลังเตรียมเปิดใช้งานในลำดับถัดไป</p>
      </div>
    </div>
  );
}
