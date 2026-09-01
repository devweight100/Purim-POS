'use client';

import React, { useState, useEffect } from 'react';
import { 
  Users, UserPlus, Shield, ShieldCheck, KeyRound, Lock, 
  Check, X, Edit2, AlertCircle, RefreshCw, Eye, EyeOff, Search
} from 'lucide-react';
import { api, apiFetch } from '@/lib/api';
import { toast } from 'sonner';

interface UserItem {
  id: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAREHOUSE';
  permissions: string[] | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const PERMISSION_OPTIONS = [
  { key: 'POS_SELL', label: 'ขายสินค้าหน้าร้าน (POS)', group: 'งานขาย & แคชเชียร์' },
  { key: 'POS_DISCOUNT', label: 'ให้ส่วนลดพิเศษในบิล', group: 'งานขาย & แคชเชียร์' },
  { key: 'POS_VOID', label: 'ยกเลิกบิลขาย (Void Order)', group: 'งานขาย & แคชเชียร์' },
  { key: 'VIEW_COST', label: 'ดูราคาทุนและกำไรขั้นต้น', group: 'งานขาย & แคชเชียร์' },
  { key: 'MANAGE_INVENTORY', label: 'ปรับปรุงสต็อก & รับสินค้าเข้า', group: 'คลังสินค้า' },
  { key: 'MANAGE_PURCHASES', label: 'เปิดใบสั่งซื้อ (PO) & จัดซื้อ', group: 'จัดซื้อ & เจ้าหนี้' },
  { key: 'MANAGE_PAYABLES', label: 'ชำระหนี้คู่ค้า & ออกใบสำคัญจ่าย', group: 'จัดซื้อ & เจ้าหนี้' },
  { key: 'MANAGE_DEBTS', label: 'จัดการลูกหนี้ & บันทึกรับเงินเชื่อ', group: 'ลูกค้า & หนี้' },
  { key: 'MANAGE_CLAIMS', label: 'รับเรื่องเคลม & ส่งคืนคู่ค้า', group: 'ลูกค้า & หนี้' },
  { key: 'VIEW_REPORTS', label: 'ดูรายงานสรุปยอดขาย & บัญชี', group: 'ระบบ & รายงาน' },
  { key: 'MANAGE_USERS', label: 'จัดการผู้ใช้งาน & กำหนดสิทธิ์ (Admin)', group: 'ระบบ & รายงาน' },
  { key: 'MANAGE_SETTINGS', label: 'แก้ไขตั้งค่าร้านค้า & บัญชีธนาคาร', group: 'ระบบ & รายงาน' },
];

export default function UsersManagementPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  
  // Form fields
  const [formFullName, setFormFullName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formPinCode, setFormPinCode] = useState('');
  const [formRole, setFormRole] = useState<'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAREHOUSE'>('CASHIER');
  const [formPermissions, setFormPermissions] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await api.auth.getUsers();
      if (Array.isArray(data)) {
        setUsers(data);
      }
    } catch (err: any) {
      toast.error('ไม่สามารถโหลดรายชื่อพนักงานได้: ' + (err.message || 'Server error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormFullName('');
    setFormUsername('');
    setFormPassword('');
    setFormPinCode('');
    setFormRole('CASHIER');
    setFormPermissions(['POS_SELL', 'POS_DISCOUNT']);
    setModalOpen(true);
  };

  const openEditModal = (u: UserItem) => {
    setEditingUser(u);
    setFormFullName(u.fullName);
    setFormUsername(u.username);
    setFormPassword('');
    setFormPinCode('');
    setFormRole(u.role);
    setFormPermissions(Array.isArray(u.permissions) ? u.permissions : []);
    setModalOpen(true);
  };

  const handleTogglePermission = (permKey: string) => {
    if (formPermissions.includes(permKey)) {
      setFormPermissions(formPermissions.filter(p => p !== permKey));
    } else {
      setFormPermissions([...formPermissions, permKey]);
    }
  };

  const handleSelectAllPermissions = () => {
    if (formPermissions.length === PERMISSION_OPTIONS.length) {
      setFormPermissions([]);
    } else {
      setFormPermissions(PERMISSION_OPTIONS.map(p => p.key));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFullName.trim()) {
      toast.warning('กรุณากรอกชื่อ-นามสกุลพนักงาน');
      return;
    }

    try {
      setSubmitting(true);
      if (editingUser) {
        // Update user
        const payload: any = {
          fullName: formFullName.trim(),
          role: formRole,
          permissions: formPermissions,
        };
        if (formPassword.trim()) payload.password = formPassword.trim();
        if (formPinCode.trim()) payload.pinCode = formPinCode.trim();

        await api.auth.updateUser(editingUser.id, payload);
        toast.success('อัปเดตข้อมูลพนักงานสำเร็จ');
      } else {
        // Create user
        if (!formUsername.trim() || !formPassword.trim()) {
          toast.warning('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
          setSubmitting(false);
          return;
        }

        await apiFetch('/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: formUsername.trim(),
            password: formPassword.trim(),
            fullName: formFullName.trim(),
            role: formRole,
            pinCode: formPinCode.trim() || undefined,
            permissions: formPermissions,
          }),
        });
        toast.success('เพิ่มพนักงานใหม่สำเร็จ');
      }

      setModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error('เกิดข้อผิดพลาด: ' + (err.message || 'ไม่สามารถบันทึกได้'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (u: UserItem) => {
    try {
      await api.auth.toggleUserActive(u.id);
      toast.success(`${u.isActive ? 'ระงับ' : 'เปิดใช้งาน'}บัญชี ${u.fullName} เรียบร้อย`);
      fetchUsers();
    } catch (err: any) {
      toast.error('เกิดข้อผิดพลาด: ' + err.message);
    }
  };

  const filteredUsers = users.filter(u => 
    u.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">จัดการพนักงาน & กำหนดสิทธิ์ (Admin Panel)</h1>
              <p className="text-sm text-slate-500">จัดการรายชื่อผู้ใช้งาน สิทธิ์การเข้าถึงเมนู และรหัส PIN แคชเชียร์</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={fetchUsers} 
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            title="รีเฟรช"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-sm transition-all text-sm"
          >
            <UserPlus className="w-4 h-4" />
            เพิ่มพนักงานใหม่
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">พนักงานทั้งหมด</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{users.length} คน</p>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">เปิดใช้งานอยู่</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">
              {users.filter(u => u.isActive).length} คน
            </p>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">ผู้ดูแลระบบ (Admin)</p>
            <p className="text-2xl font-bold text-indigo-600 mt-1">
              {users.filter(u => u.role === 'ADMIN').length} คน
            </p>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Shield className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Users Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ค้นหาชื่อ, username หรือตำแหน่ง..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            />
          </div>
          <span className="text-xs text-slate-500">พบทั้งหมด {filteredUsers.length} รายการ</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-6">ชื่อ-นามสกุล / ชื่อผู้ใช้</th>
                <th className="py-3.5 px-4 text-center">บทบาท (Role)</th>
                <th className="py-3.5 px-4">สิทธิ์การใช้งาน (Permissions)</th>
                <th className="py-3.5 px-4 text-center">สถานะ</th>
                <th className="py-3.5 px-4">เข้าสู่ระบบล่าสุด</th>
                <th className="py-3.5 px-6 text-right">การกระทำ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    กำลังโหลดข้อมูลพนักงาน...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    ไม่พบข้อมูลพนักงาน
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const permCount = Array.isArray(u.permissions) ? u.permissions.length : 0;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-medium text-slate-800">{u.fullName}</div>
                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <span>@{u.username}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          u.role === 'ADMIN'
                            ? 'bg-purple-100 text-purple-700 border border-purple-200'
                            : u.role === 'MANAGER'
                            ? 'bg-blue-100 text-blue-700 border border-blue-200'
                            : u.role === 'WAREHOUSE'
                            ? 'bg-amber-100 text-amber-700 border border-amber-200'
                            : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {u.role === 'ADMIN' ? (
                            <span className="text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md">
                              เข้าถึงได้ทุกส่วน (Full Access)
                            </span>
                          ) : permCount > 0 ? (
                            <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                              กำหนดไว้ {permCount} สิทธิ์
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">ยังไม่ได้กำหนดสิทธิ์</span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            u.isActive
                              ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                          }`}
                          title="คลิกเพื่อเปลี่ยนสถานะ"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${u.isActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                          {u.isActive ? 'ใช้งาน' : 'ระงับ'}
                        </button>
                      </td>
                      <td className="py-4 px-4 text-xs text-slate-500">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('th-TH') : '-'}
                      </td>
                      <td className="py-4 px-6 text-right">
                        <button
                          onClick={() => openEditModal(u)}
                          className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="แก้ไขข้อมูล & สิทธิ์"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Create User Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-indigo-50/40">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                  {editingUser ? <Edit2 className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    {editingUser ? `แก้ไขข้อมูล: ${editingUser.fullName}` : 'เพิ่มพนักงานใหม่'}
                  </h3>
                  <p className="text-xs text-slate-500">กรอกข้อมูล กำหนดรหัส PIN และสิทธิ์การใช้งานของระบบ</p>
                </div>
              </div>
              <button 
                onClick={() => setModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    ชื่อ-นามสกุลพนักงาน <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formFullName}
                    onChange={(e) => setFormFullName(e.target.value)}
                    placeholder="เช่น สมศรี ใจดี"
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    ตำแหน่ง / บทบาท (Role)
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as any)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    <option value="CASHIER">CASHIER (แคชเชียร์หน้าร้าน)</option>
                    <option value="MANAGER">MANAGER (ผู้จัดการร้าน)</option>
                    <option value="WAREHOUSE">WAREHOUSE (เจ้าหน้าที่คลังสินค้า)</option>
                    <option value="ADMIN">ADMIN (ผู้ดูแลระบบทั้งหมด)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    ชื่อผู้ใช้ (Username) {!editingUser && <span className="text-rose-500">*</span>}
                  </label>
                  <input
                    type="text"
                    required={!editingUser}
                    disabled={!!editingUser}
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="เช่น cashier1"
                    className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-xl disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {editingUser ? 'เปลี่ยนรหัสผ่าน (เว้นว่างได้)' : 'รหัสผ่าน'} {!editingUser && <span className="text-rose-500">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required={!editingUser}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder={editingUser ? 'ปล่อยว่างถ้าไม่เปลี่ยน' : 'รหัสผ่านเข้าสู่ระบบ'}
                      className="w-full pl-3.5 pr-8 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    รหัส PIN แคชเชียร์ (4-6 หลัก)
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      maxLength={6}
                      value={formPinCode}
                      onChange={(e) => setFormPinCode(e.target.value)}
                      placeholder={editingUser ? 'เว้นว่างถ้าไม่เปลี่ยน' : 'เช่น 1234'}
                      className="w-full pl-9 pr-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Granular Permissions Section */}
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">กำหนดสิทธิ์การเข้าถึงฟังก์ชัน (Granular Permissions)</h4>
                    <p className="text-xs text-slate-500">ทำเครื่องหมายถูกเพื่ออนุญาตให้พนักงานเข้าถึงแต่ละส่วน</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleSelectAllPermissions}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                  >
                    {formPermissions.length === PERMISSION_OPTIONS.length ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                  {PERMISSION_OPTIONS.map((opt) => {
                    const checked = formPermissions.includes(opt.key);
                    return (
                      <label 
                        key={opt.key}
                        className={`flex items-start gap-2.5 p-2 rounded-lg border cursor-pointer transition-colors text-xs ${
                          checked 
                            ? 'bg-white border-indigo-300 text-slate-800 shadow-xs' 
                            : 'border-transparent text-slate-500 hover:bg-white/60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleTogglePermission(opt.key)}
                          className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <div className="font-medium text-slate-800">{opt.label}</div>
                          <div className="text-[10px] text-slate-400">{opt.group}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl shadow-sm transition-colors disabled:opacity-50"
                >
                  {submitting ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
