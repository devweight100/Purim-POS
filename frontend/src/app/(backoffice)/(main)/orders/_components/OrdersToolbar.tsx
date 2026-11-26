import { formatCurrency } from "@/lib/utils";
import { DAY_PRESET_LABELS, presetOf, type DayPreset } from "@/lib/date-presets";
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
  changePreset: (p: DayPreset) => void;
  search: string;
  changeSearch: (v: string) => void;
}

/** Summary cards, status tabs, date range and search of the orders page. */
export function OrdersToolbar({
  stats, statusTab, changeStatusTab, startDate, changeStartDate, endDate, changeEndDate, changePreset, search, changeSearch,
}: Props) {
  const preset = presetOf(startDate, endDate);
  return (
    <>
      {/* ─── TOP STATS CARDS (Compact Height, Larger Header Font matching debts page) ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Card 1: Total Completed Orders (Inline) */}
        <div className="stat-tile">
          <div className="flex items-center gap-2">
            <div className="stat-tile-icon">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <span className="stat-tile-label">ออเดอร์สำเร็จทั้งหมด:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="stat-tile-value">
              {stats.totalOrders}
            </span>
            <span className="stat-tile-unit">บิล</span>
          </div>
        </div>

        {/* Card 2: Total Net Revenue (Inline) */}
        <div className="stat-tile">
          <div className="flex items-center gap-2">
            <div className="stat-tile-icon">
              <DollarSign className="w-4 h-4" />
            </div>
            <span className="stat-tile-label">ยอดขายรวมสุทธิ:</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="stat-tile-value">
              {formatCurrency(stats.totalRevenue)}
            </span>
          </div>
        </div>

        {/* Card 3: Voided Orders (Inline) */}
        <div className="stat-tile">
          <div className="flex items-center gap-2">
            <div className="stat-tile-icon">
              <Ban className="w-4 h-4" />
            </div>
            <span className="stat-tile-label">บิลที่ยกเลิก (Void):</span>
          </div>
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="stat-tile-value is-danger">
              {stats.voidedOrders}
            </span>
            <span className="stat-tile-unit">บิล</span>
          </div>
        </div>
      </div>

      {/* ─── SEARCH & FILTER BAR ─── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-3">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap gap-btn p-1 bg-slate-100 rounded-xl border border-slate-200/80">
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

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">ช่วงวันที่:</span>
            <div className="flex flex-wrap items-center gap-btn" role="group" aria-label="ช่วงวันที่ด่วน" data-testid="orders-date-presets">
              {DAY_PRESET_LABELS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={preset === key}
                  onClick={() => changePreset(key)}
                  className={`h-8 px-2.5 rounded-lg font-bold transition-all ${
                    preset === key ? "bg-indigo-600 text-white shadow-2xs" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="date"
              value={startDate}
              aria-label="ตั้งแต่วันที่"
              onChange={(e) => changeStartDate(e.target.value)}
              onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch {} }}
              className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800 outline-none shadow-2xs cursor-pointer"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={endDate}
              aria-label="ถึงวันที่"
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
            className="pl-9 bg-slate-50 border-slate-300 focus:bg-white sm:text-sm"
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
