"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.getCustomers().then(data => {
      setCustomers(data);
      setLoading(false);
    });
  }, []);

  const filtered = customers.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">ลูกค้าสมาชิก</h1>
          <p className="text-slate-500 mt-2">จัดการข้อมูลลูกค้าและคะแนนสะสม</p>
        </div>
        <Button className="h-11 w-full bg-primary px-6 font-bold text-white hover:bg-primary/90 sm:w-auto">
          <UserPlus className="w-5 h-5 mr-2" />
          เพิ่มลูกค้าใหม่
        </Button>
      </div>

      <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50 p-4">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="ค้นหาชื่อ, เบอร์โทร..." 
              className="pl-9 bg-white border-slate-300 h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow className="border-slate-200 hover:bg-transparent">
              <TableHead className="text-slate-500">ชื่อ - นามสกุล</TableHead>
              <TableHead className="text-slate-500">เบอร์โทรศัพท์</TableHead>
              <TableHead className="text-slate-500 text-center">คะแนนสะสม</TableHead>
              <TableHead className="text-slate-500 text-right">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell>
              </TableRow>
            ) : filtered.map(c => (
              <TableRow key={c.id} className="border-slate-100 hover:bg-slate-50">
                <TableCell className="font-bold text-slate-900">{c.name}</TableCell>
                <TableCell className="text-slate-600 font-mono">{c.phone}</TableCell>
                <TableCell className="text-center">
                  <Badge className="bg-primary/10 text-primary border-primary/20 font-bold px-3 hover:bg-primary/20">
                    {c.points} แต้ม
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" className="text-primary hover:text-primary hover:bg-primary/10">
                    ดูประวัติ
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}
