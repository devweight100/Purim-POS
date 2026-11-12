import { formatCurrency } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Search, DollarSign, ShoppingCart, Ban, CheckCircle2, Layers } from "lucide-react";

type StatusTab = "all" | "completed" | "voided";

interface Props {
  stats: { totalOrders: number; voidedOrders: number; totalRevenue: number; allCount: number };
  statusTab: StatusTab;
  changeStatusTab: (v: StatusTab) => void;
  startDate: string;
  changeStartDate: (v: string) => void;
  endDate: string;
  changeEndDate: (v: string) => void;
  search: string;
  changeSearch: (v: string) => void;
}

/** Summary cards, status tabs, date range and search of the orders page. */
export function OrdersToolbar({
  stats, statusTab, changeStatusTab, startDate, changeStartDate, endDate, changeEndDate, search, changeSearch,
}: Props) {
  return (
    <>
      {/* ─── TOP STATS CARDS (Compact Height, Larger Header Font matching debts page) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Card 1: Total Completed Orders (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-sky-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-sky-50 text-sky-600 rounded-md border border-sky-100 shrink-0">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-sky-950">ออเดอร์สำเร็จทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-sky-700 tracking-tight">
              {stats.totalOrders}
            </span>
            <span className="text-xs text-slate-600 font-sans font-bold">บิล</span>
          </div>
        </div>

        {/* Card 2: Total Net Revenue (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-emerald-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100 shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-emerald-950">ยอดขายรวมสุทธิ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-emerald-600 tracking-tight">
              {formatCurrency(stats.totalRevenue)}
            </span>
          </div>
        </div>

        {/* Card 3: Voided Orders (Inline) */}
        <div className="bg-white px-3.5 py-2 rounded-xl border border-rose-200/80 shadow-2xs flex items-center justify-between bg-rose-50/20">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-rose-50 text-rose-600 rounded-md border border-rose-100 shrink-0">
              <Ban className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-rose-950">บิลที่ยกเลิก (Void):</span>
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-lg sm:text-xl font-black text-rose-600 tracking-tight">
              {stats.voidedOrders}
            </span>
            <span className="text-xs text-rose-700 font-sans font-bold">บิล</span>
          </div>
        </div>
      </div>

      {/* ─── SEARCH & FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => changeStatusTab("all")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusTab === "all"
                  ? "bg-white text-slate-900 shadow-xs border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200/50"
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>ทั้งหมด ({stats.allCount})</span>
            </button>

            <button
              type="button"
              onClick={() => changeStatusTab("completed")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusTab === "completed"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>สำเร็จ ({stats.totalOrders})</span>
            </button>

            <button
              type="button"
              onClick={() => changeStatusTab("voided")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                statusTab === "voided"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "text-rose-700 hover:bg-rose-50"
              }`}
            >
              <Ban className="w-3.5 h-3.5" />
              <span>ยกเลิกแล้ว ({stats.voidedOrders})</span>
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">ช่วงวันที่:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => changeStartDate(e.target.value)}
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none shadow-2xs cursor-pointer"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => changeEndDate(e.target.value)}
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none shadow-2xs cursor-pointer"
            />
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            type="text"
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="ค้นหาตามเลขออเดอร์, ชื่อลูกค้า, หรือสินค้า..."
            className="pl-9 h-10 bg-slate-50 border-slate-300 rounded-xl focus:bg-white text-xs sm:text-sm font-medium shadow-inner"
          />
          {search && (
            <button
              type="button"
              onClick={() => changeSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              ล้าง
            </button>
          )}
        </div>
      </div>
    </>
  );
}
