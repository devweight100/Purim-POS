import { Badge } from '@/components/ui/badge';

export function poStatusBadge(status: string) {
  switch (status) {
    case 'DRAFT': return <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200">DRAFT</Badge>;
    case 'ISSUED': return <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-100">ISSUED</Badge>;
    case 'PARTIALLY_RECEIVED': return <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-100">PARTIAL</Badge>;
    case 'COMPLETED': return <Badge className="bg-green-50 text-green-700 hover:bg-green-100">COMPLETED</Badge>;
    case 'CANCELLED': return <Badge className="bg-red-50 text-red-600 hover:bg-red-100">CANCELLED</Badge>;
    default: return <Badge className="bg-slate-100 text-slate-800">{status}</Badge>;
  }
}
