import React, { useState, useRef } from 'react';
import {
  X,
  FolderKanban,
  FileDown,
  FileUp,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Shield,
  Layers,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { LayoutSaveData } from '../../types/layout';
import { CATEGORY_META } from '../../types/equipment';

export const LayoutModal: React.FC = () => {
  const {
    showLayoutModal,
    setShowLayoutModal,
    instances,
    exportToLayout,
    importFromLayout,
    clearAll,
  } = useTacticalStore();

  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [layoutName, setLayoutName] = useState<string>(() => {
    const today = new Date().toISOString().slice(0, 10);
    return `Bo_Cuc_PK_VomKQ_${today}`;
  });

  // State import preview
  const [importedData, setImportedData] = useState<LayoutSaveData | null>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState<boolean>(true);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!showLayoutModal) return null;

  // Thống kê khí tài hiện tại theo danh mục
  const countsByCategory: Record<string, number> = {};
  instances.forEach((inst) => {
    countsByCategory[inst.category] = (countsByCategory[inst.category] || 0) + 1;
  });

  // Xử lý Xuất JSON Bố Cục
  const handleExport = () => {
    try {
      const finalName = layoutName.trim() || 'Bo_Cuc_Phong_Khong_VomKQ';
      const layout = exportToLayout(finalName);
      const blob = new Blob([JSON.stringify(layout, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${finalName}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setNotification({
        type: 'success',
        message: `Đã xuất thành công tệp bố cục: "${finalName}.json" (${instances.length} khí tài).`,
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (err) {
      console.error(err);
      setNotification({
        type: 'error',
        message: 'Có lỗi xảy ra trong quá trình xuất tệp bố cục.',
      });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // Xử lý chọn tệp JSON để Nạp Bố Cục
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string) as LayoutSaveData;
        if (parsed && Array.isArray(parsed.equipments)) {
          setImportedData(parsed);
          setImportError(null);
        } else {
          setImportError('Tệp không đúng định dạng bố cục VomKQ (thiếu danh sách equipments).');
          setImportedData(null);
        }
      } catch (err) {
        console.error(err);
        setImportError('Không thể đọc tệp JSON. Vui lòng kiểm tra lại tính toàn vẹn của tệp.');
        setImportedData(null);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Xác nhận nạp tệp bố cục
  const handleConfirmImport = () => {
    if (!importedData) return;

    try {
      if (replaceExisting) {
        importFromLayout(importedData);
      } else {
        // Nạp thêm (merge)
        const currentLayout = exportToLayout('Merged');
        const mergedData: LayoutSaveData = {
          layoutName: importedData.layoutName || currentLayout.layoutName,
          savedAtIso8601: new Date().toISOString(),
          equipments: [...currentLayout.equipments, ...importedData.equipments],
        };
        importFromLayout(mergedData);
      }

      setNotification({
        type: 'success',
        message: `Đã nạp thành công ${importedData.equipments.length} khí tài lên bản đồ tác chiến.`,
      });
      setImportedData(null);
      setImportFileName('');
      setTimeout(() => {
        setNotification(null);
        setShowLayoutModal(false);
      }, 1200);
    } catch (err) {
      console.error(err);
      setImportError('Lỗi khi nạp bố cục lên bản đồ.');
    }
  };

  // Xóa sạch toàn bộ khí tài
  const handleClearAll = () => {
    if (window.confirm('CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ khí tài trên trận địa không?')) {
      clearAll();
      setNotification({
        type: 'success',
        message: 'Đã xóa toàn bộ khí tài trên trận địa.',
      });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowLayoutModal(false);
      }}
    >
      <div className="bg-slate-900/95 border border-cyan-500/50 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.25)] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-slate-100 select-none">
        {/* 1. Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-500/60 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2 tracking-wide font-mono">
                QUẢN LÝ BỐ CỤC TRẬN ĐỊA
              </h2>
              <p className="text-xs text-slate-400">
                Lưu trữ, sao lưu và nạp kế hoạch bố trí hỏa lực phòng không (.JSON)
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowLayoutModal(false)}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
            title="Đóng bảng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thông báo dạng Toast (nếu có) */}
        {notification && (
          <div
            className={`mx-4 mt-3 px-3.5 py-2.5 rounded-lg border text-xs flex items-center gap-2 animate-in fade-in duration-150 ${
              notification.type === 'success'
                ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                : 'bg-rose-950/80 border-rose-500/50 text-rose-300'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
        )}

        {/* 2. Thống kê biên chế hiện tại */}
        <div className="px-5 pt-4">
          <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                Lực lượng hiện có trên trận địa:
              </span>
              <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/30">
                {instances.length} Khí Tài
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {Object.entries(CATEGORY_META).map(([catKey, meta]) => {
                const count = countsByCategory[catKey] || 0;
                return (
                  <div
                    key={catKey}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded bg-slate-900/80 border border-slate-800"
                  >
                    <span className="text-slate-400 truncate pr-1">{meta.nameVi}</span>
                    <span
                      className={`font-mono font-bold ${
                        count > 0 ? 'text-amber-300' : 'text-slate-600'
                      }`}
                    >
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 3. Chuyển đổi Tab (Lưu Bố Cục / Tải Bố Cục) */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('export')}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'export'
                  ? 'bg-cyan-600 text-white shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileDown className="w-4 h-4" />
              <span>LƯU BỐ CỤC (XUẤT JSON)</span>
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                activeTab === 'import'
                  ? 'bg-cyan-600 text-white shadow-[0_0_12px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileUp className="w-4 h-4" />
              <span>TẢI BỐ CỤC (NẠP JSON)</span>
            </button>
          </div>
        </div>

        {/* 4. Nội dung từng Tab */}
        <div className="p-5 overflow-y-auto flex-1">
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Đặt tên cho tệp bố cục:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={layoutName}
                    onChange={(e) => setLayoutName(e.target.value)}
                    placeholder="Nhập tên tệp bố cục..."
                    className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none transition-colors"
                  />
                  <span className="absolute right-3 top-2 text-xs text-slate-500 font-mono">
                    .json
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Tệp tải về chứa toàn bộ thông tin: tọa độ, cao độ, thông số quét radar, hỏa lực tên lửa và quan hệ chỉ huy.
                </p>
              </div>

              <div className="p-3.5 bg-cyan-950/20 border border-cyan-500/20 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                    Thời điểm lưu:
                  </span>
                  <span className="font-mono text-cyan-300">
                    {new Date().toLocaleString('vi-VN')}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Tổng số mục xuất:
                  </span>
                  <span className="font-mono font-bold text-emerald-400">
                    {instances.length} phần tử khí tài
                  </span>
                </div>
              </div>

              <button
                onClick={handleExport}
                disabled={instances.length === 0}
                className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  instances.length > 0
                    ? 'bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                }`}
              >
                <FileDown className="w-4 h-4" />
                <span>TẢI TỆP BỐ CỤC (.JSON) VỀ MÁY TÍNH</span>
              </button>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="space-y-4">
              {/* Khu vực chọn tệp */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="hidden"
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-cyan-500/70 bg-slate-950/60 hover:bg-cyan-950/20 rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-all"
              >
                <div className="w-10 h-10 rounded-full bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-400 mb-2">
                  <FileUp className="w-5 h-5" />
                </div>
                <span className="text-xs font-semibold text-slate-200">
                  {importFileName ? (
                    <span className="text-cyan-400 font-mono font-bold">{importFileName}</span>
                  ) : (
                    'Nhấn vào đây để chọn tệp bố cục (.json) từ máy tính'
                  )}
                </span>
                <span className="text-[11px] text-slate-500 mt-1">
                  Chỉ hỗ trợ tệp định dạng JSON của hệ thống Vòm Khí Quyển
                </span>
              </div>

              {/* Lỗi nếu có */}
              {importError && (
                <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Chi tiết tệp được đọc */}
              {importedData && (
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Tên bố cục:</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {importedData.layoutName || 'Chưa đặt tên'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <span className="text-slate-400">Thời gian tạo:</span>
                    <span className="font-mono text-slate-300">
                      {importedData.savedAtIso8601
                        ? new Date(importedData.savedAtIso8601).toLocaleString('vi-VN')
                        : 'Không rõ'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Số lượng khí tài:</span>
                    <span className="font-mono font-bold text-amber-400">
                      {importedData.equipments.length} mục
                    </span>
                  </div>
                </div>
              )}

              {/* Tùy chọn nạp đè hay nạp thêm */}
              {importedData && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="replaceToggle"
                    type="checkbox"
                    checked={replaceExisting}
                    onChange={(e) => setReplaceExisting(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                  />
                  <label htmlFor="replaceToggle" className="text-xs text-slate-300 cursor-pointer">
                    Xóa các khí tài hiện có trước khi nạp (Khuyến nghị)
                  </label>
                </div>
              )}

              {/* Nút xác nhận nạp */}
              {importedData && (
                <button
                  onClick={handleConfirmImport}
                  className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>XÁC NHẬN NẠP BỐ CỤC LÊN BẢN ĐỒ</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* 5. Footer: Nút xóa sạch toàn bộ */}
        <div className="p-3 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between text-xs">
          <button
            onClick={handleClearAll}
            disabled={instances.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
              instances.length > 0
                ? 'text-rose-400 border-rose-900/60 bg-rose-950/30 hover:bg-rose-950/60'
                : 'text-slate-600 border-slate-800 bg-slate-900 cursor-not-allowed'
            }`}
            title="Xóa toàn bộ khí tài đang có trên bản đồ"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa Sạch Trận Địa</span>
          </button>

          <button
            onClick={() => setShowLayoutModal(false)}
            className="px-4 py-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
