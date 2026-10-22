import React, { useState } from 'react';
import {
  Radar,
  Radio,
  Crosshair,
  Shield,
  Antenna,
  Zap,
  RadioTower,
  PlusCircle,
  Pin,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useShallow } from 'zustand/react/shallow';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import type { EquipmentCategory, EquipmentTemplate } from '../../types/equipment';
import { ASSET_TYPE_REGISTRY } from '../../utils/assetVisualization';
import { EQUIPMENT_UI_LABELS } from '../../constants/equipmentLabels';

export const LeftSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'outliner'>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogCategory, setCatalogCategory] = useState<'ALL' | EquipmentCategory>('ALL');
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const {
    instances,
    selectedInstanceId,
    pendingTemplate,
    selectEquipment,
    setPendingTemplate,
    removeEquipment,
    triggerFlyTo,
    categoryFilter,
  } = useTacticalStore(useShallow((state) => ({
    instances: state.instances,
    selectedInstanceId: state.selectedInstanceId,
    pendingTemplate: state.pendingTemplate,
    selectEquipment: state.selectEquipment,
    setPendingTemplate: state.setPendingTemplate,
    removeEquipment: state.removeEquipment,
    triggerFlyTo: state.triggerFlyTo,
    categoryFilter: state.categoryFilter,
  })));

  // Mapping Icon
  const getIcon = (iconName: string, color: string) => {
    const props = { className: 'w-4 h-4', style: { color } };
    switch (iconName) {
      case 'Radar':
        return <Radar {...props} />;
      case 'Radio':
        return <Radio {...props} />;
      case 'RadioTower':
        return <RadioTower {...props} />;
      case 'Crosshair':
        return <Crosshair {...props} />;
      case 'Shield':
        return <Shield {...props} />;
      case 'Antenna':
        return <Antenna {...props} />;
      case 'Zap':
        return <Zap {...props} />;
      default:
        return <Radar {...props} />;
    }
  };

  // Lọc danh sách khí tài đã đặt theo tìm kiếm và danh mục tác chiến
  const filteredInstances = instances.filter((inst) => {
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      query === '' ||
      inst.name.toLowerCase().includes(query) ||
      (inst.shortId && inst.shortId.toLowerCase().includes(query));
    const matchesCategory = categoryFilter === 'All' || inst.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <aside
      className={`absolute top-14 left-0 bottom-0 z-20 transition-all duration-300 flex ${
        collapsed ? 'w-10' : 'w-80'
      }`}
    >
      {/* Nút thu gọn / mở rộng */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3.5 top-5 z-30 w-7 h-7 rounded-full bg-slate-900 border border-cyan-500/50 text-cyan-400 flex items-center justify-center hover:bg-slate-800 shadow-md focus:outline-none"
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Thân Sidebar */}
      {!collapsed && (
        <div className="w-full h-full bg-slate-950/85 backdrop-blur-md border-r border-slate-800 flex flex-col select-none">
          {/* Tabs Selector */}
          <div className="flex border-b border-slate-800 bg-slate-900/50 p-1">
            <button
              onClick={() => setActiveTab('catalog')}
              className={`flex-1 py-2 text-xs font-semibold rounded transition-all ${
                activeTab === 'catalog'
                  ? 'bg-cyan-950/90 text-cyan-400 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Kho Khí Tài ({EQUIPMENT_TEMPLATES.filter((t) => !t.isIntegratedOnly).length})
            </button>
            <button
              onClick={() => setActiveTab('outliner')}
              className={`flex-1 py-2 text-xs font-semibold rounded transition-all ${
                activeTab === 'outliner'
                  ? 'bg-cyan-950/90 text-cyan-400 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Biên Chế ({instances.length})
            </button>
          </div>

          {/* TAB 1: KHO KHÍ TÀI (CATALOG) */}
          {activeTab === 'catalog' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Thanh tìm kiếm khí tài */}
              <div className="p-2.5 pb-1.5 border-b border-slate-800/80 bg-slate-900/40">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    placeholder="Tìm tên khí tài, tính năng..."
                    value={catalogSearchQuery}
                    onChange={(e) => setCatalogSearchQuery(e.target.value)}
                    className="w-full bg-slate-900 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded border border-slate-800 focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>

                {/* Thanh phân loại danh mục tác chiến */}
                {(() => {
                  const standalone = EQUIPMENT_TEMPLATES.filter((t) => !t.isIntegratedOnly);
                  const samCount = standalone.filter((t) => t.category === 'TenLuaPhongKhong').length;
                  const radarCount = standalone.filter((t) => t.category === 'RadarCanhGioi').length;
                  return (
                    <div className="flex items-center gap-1 overflow-x-auto pt-2 pb-0.5 no-scrollbar text-[11px]">
                      <button
                        onClick={() => setCatalogCategory('ALL')}
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-all ${
                          catalogCategory === 'ALL'
                            ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                            : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        Tất cả ({standalone.length})
                      </button>
                      <button
                        onClick={() => setCatalogCategory('TenLuaPhongKhong')}
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                          catalogCategory === 'TenLuaPhongKhong'
                            ? 'bg-rose-500 text-slate-950 font-bold shadow'
                            : 'bg-slate-800/80 text-rose-300 hover:bg-slate-800'
                        }`}
                      >
                        <span>🚀 Tên Lửa</span>
                        <span className="text-[10px] opacity-80">({samCount})</span>
                      </button>
                      <button
                        onClick={() => setCatalogCategory('RadarCanhGioi')}
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-all flex items-center gap-1 ${
                          catalogCategory === 'RadarCanhGioi'
                            ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                            : 'bg-slate-800/80 text-cyan-300 hover:bg-slate-800'
                        }`}
                      >
                        <span>📡 Radar</span>
                        <span className="text-[10px] opacity-80">({radarCount})</span>
                      </button>
                      <button
                        onClick={() => setCatalogCategory('SoChiHuy')}
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-all ${
                          catalogCategory === 'SoChiHuy'
                            ? 'bg-amber-500 text-slate-950 font-bold shadow'
                            : 'bg-slate-800/80 text-amber-300 hover:bg-slate-800'
                        }`}
                      >
                        🛡️ SCH (1)
                      </button>
                      <button
                        onClick={() => setCatalogCategory('PhaoPhongKhong')}
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-all ${
                          catalogCategory === 'PhaoPhongKhong'
                            ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                            : 'bg-slate-800/80 text-emerald-300 hover:bg-slate-800'
                        }`}
                      >
                        💥 Pháo PK (3)
                      </button>
                      <button
                        onClick={() => setCatalogCategory('CamBienThuDong')}
                        className={`px-2 py-0.5 rounded font-medium whitespace-nowrap transition-all ${
                          catalogCategory === 'CamBienThuDong'
                            ? 'bg-purple-500 text-slate-950 font-bold shadow'
                            : 'bg-slate-800/80 text-purple-300 hover:bg-slate-800'
                        }`}
                      >
                        🛰️ Thụ Động (1)
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Danh sách thẻ khí tài theo nhóm phân loại */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {(() => {
                  const query = catalogSearchQuery.toLowerCase().trim();
                  const standalone = EQUIPMENT_TEMPLATES.filter((t) => !t.isIntegratedOnly);
                  const matchedTemplates = standalone.filter((tmpl) => {
                    const matchesCategory = catalogCategory === 'ALL' || tmpl.category === catalogCategory;
                    const matchesSearch =
                      query === '' ||
                      tmpl.name.toLowerCase().includes(query) ||
                      tmpl.description.toLowerCase().includes(query) ||
                      (tmpl.guidanceMethodVi && tmpl.guidanceMethodVi.toLowerCase().includes(query)) ||
                      (tmpl.radarSubRoleVi && tmpl.radarSubRoleVi.toLowerCase().includes(query));
                    return matchesCategory && matchesSearch;
                  });

                  if (matchedTemplates.length === 0) {
                    return (
                      <div className="text-center py-10 text-slate-500 text-xs">
                        Không tìm thấy khí tài nào phù hợp với bộ lọc.
                      </div>
                    );
                  }

                  // Hàm render 1 thẻ khí tài chuẩn
                  const renderTemplateCard = (tmpl: EquipmentTemplate) => {
                    const isSelectedForPlacement = pendingTemplate?.id === tmpl.id;
                    const isSam = tmpl.category === 'TenLuaPhongKhong';

                    return (
                      <div
                        key={tmpl.id}
                        className={`p-3 rounded-lg border transition-all ${
                          isSelectedForPlacement
                            ? 'bg-cyan-950/80 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)] ring-1 ring-cyan-400'
                            : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-7 h-7 rounded bg-slate-800/80 flex items-center justify-center border border-slate-700 shrink-0"
                              style={{ borderColor: `${tmpl.symbolColor}44` }}
                            >
                              {getIcon(tmpl.iconName, tmpl.symbolColor)}
                            </div>
                            <div>
                              <h4 className="text-xs font-bold text-slate-100 leading-tight">
                                {tmpl.name}
                              </h4>
                              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                <span
                                  className="text-[9px] font-semibold px-1.5 py-0.2 rounded"
                                  style={{
                                    backgroundColor: `${tmpl.symbolColor}1a`,
                                    color: tmpl.symbolColor,
                                  }}
                                >
                                  {tmpl.categoryNameVi}
                                </span>

                                {/* Đã làm sạch các huy hiệu dư thừa theo yêu cầu */}
                              </div>
                            </div>
                          </div>
                        </div>

                        <p className="text-[11px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                          {tmpl.description}
                        </p>

                        {/* Cấu thành Cụm Biên chế Đồng bộ cho Tên Lửa Phòng Không */}
                        {isSam && tmpl.batteryConfig && (
                          <div className="mt-2 p-2 rounded bg-slate-950/70 border border-rose-800/40 text-[10px] space-y-1">
                            <div className="text-rose-300 font-bold flex items-center justify-between">
                              <span className="flex items-center gap-1">
                                <Shield className="w-3 h-3 text-rose-400" /> Cụm Tổ Hợp Tác Chiến
                              </span>
                              <span className="text-[9px] px-1.5 py-0.2 bg-rose-950 text-rose-300 font-mono font-bold rounded border border-rose-700/60">
                                {tmpl.batteryConfig.launcherCount || 4} BỆ PHÓNG
                              </span>
                            </div>
                            <div className="text-slate-400 flex items-center justify-between text-[9.5px]">
                              <span>Đài Tâm (FCR):</span>
                              <span className="text-slate-200 font-medium truncate max-w-[155px] text-right">
                                {tmpl.batteryConfig.fcrRadarName}
                              </span>
                            </div>
                            <div className="text-slate-400 flex items-center justify-between text-[9.5px]">
                              <span>Đài Chỉ thị (TAR):</span>
                              <span className="text-cyan-300 font-medium truncate max-w-[155px] text-right">
                                {tmpl.batteryConfig.tarRadarName}
                              </span>
                            </div>
                            <div className="text-slate-400 flex items-center justify-between text-[9.5px]">
                              <span>Bệ phóng & Cáp:</span>
                              <span className="text-amber-300 font-mono truncate max-w-[155px] text-right">
                                {tmpl.batteryConfig.launcherCount || 4} × {tmpl.batteryConfig.launcherName} (~{tmpl.batteryConfig.defaultLauncherDistanceM}m)
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Thông số kỹ thuật tóm tắt theo loại khí tài */}
                        <div className="grid grid-cols-2 gap-1.5 mt-2.5 pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-300">
                          {isSam ? (
                            <>
                              <div>
                                <span className="text-slate-500">Cự ly tiêu diệt: </span>
                                <span className="text-rose-400 font-semibold">
                                  {tmpl.minEngagementRangeKm || 1}-{tmpl.defaultRangeKm} km
                                </span>
                              </div>
                              <div>
                                <span className="text-slate-500">Trần bắn max: </span>
                                <span className="text-rose-300 font-semibold">
                                  {tmpl.maxEngagementAltitudeM ? `${(tmpl.maxEngagementAltitudeM / 1000).toFixed(0)} km` : `${tmpl.coverageHeightKm} km`}
                                </span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-slate-500">Dẫn bắn: </span>
                                <span className="text-amber-300/90">{tmpl.guidanceMethodVi || 'Radar / Quang học'}</span>
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <span className="text-slate-500">Tầm phủ: </span>
                                <span className="text-cyan-300 font-semibold">{tmpl.defaultRangeKm} km</span>
                              </div>
                              <div>
                                <span className="text-slate-500">V/tốc quét: </span>
                                <span>{tmpl.defaultScanSpeed ? `${tmpl.defaultScanSpeed}°/s` : 'Cố định'}</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Độ cao max: </span>
                                <span>{tmpl.coverageHeightKm} km</span>
                              </div>
                              <div>
                                <span className="text-slate-500">Ăng-ten AGL: </span>
                                <span>{tmpl.antennaHeightAGL}m</span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Nút triển khai */}
                        <button
                          onClick={() => {
                            if (isSelectedForPlacement) {
                              setPendingTemplate(null);
                            } else {
                              setPendingTemplate(tmpl);
                            }
                          }}
                          className={`w-full mt-2.5 py-1.5 px-3 rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                            isSelectedForPlacement
                              ? 'bg-rose-950/80 hover:bg-rose-900/80 text-rose-300 border border-rose-600'
                              : isSam
                              ? 'bg-rose-950/80 hover:bg-rose-900/80 text-rose-300 border border-rose-600/60'
                              : 'bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-600/60'
                          }`}
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          <span>
                            {isSelectedForPlacement
                              ? 'Hủy đặt khí tài'
                              : isSam
                              ? `Triển khai Cụm Tổ Hợp (${tmpl.batteryConfig?.launcherCount || 4} Bệ)`
                              : 'Triển khai lên bản đồ'}
                          </span>
                        </button>
                      </div>
                    );
                  };

                  // Nếu xem "Radar" hoặc "Tất cả", hiển thị nhóm RADAR CẢNH GIỚI ĐỘC LẬP
                  if (catalogCategory === 'RadarCanhGioi' || catalogCategory === 'ALL') {
                    const standaloneRadars = matchedTemplates.filter((t) => t.category === 'RadarCanhGioi');
                    const samMissiles = matchedTemplates.filter((t) => t.category === 'TenLuaPhongKhong');
                    const otherEquipments = matchedTemplates.filter(
                      (t) => t.category !== 'RadarCanhGioi' && t.category !== 'TenLuaPhongKhong'
                    );

                    return (
                      <div className="space-y-4">
                        {/* 1. MỤC TÊN LỬA PHÒNG KHÔNG */}
                        {samMissiles.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 pb-1 border-b border-rose-800/40 text-rose-400 font-bold text-xs uppercase tracking-wider">
                              <span>🚀 TỔ HỢP TÊN LỬA PHÒNG KHÔNG (SAM BATTERY)</span>
                              <span className="text-[10px] text-rose-400/70">({samMissiles.length})</span>
                            </div>
                            <div className="space-y-2">{samMissiles.map(renderTemplateCard)}</div>
                          </div>
                        )}

                        {/* 2. MỤC RADAR CẢNH GIỚI ĐỘC LẬP */}
                        {standaloneRadars.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 pb-1 border-b border-cyan-800/40 text-cyan-300 font-bold text-xs uppercase tracking-wider">
                              <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                              <span>👁️ RADAR CẢNH GIỚI ĐỘC LẬP ({standaloneRadars.length})</span>
                            </div>
                            <p className="text-[10px] text-slate-400 italic">
                              Các đài ra đa cảnh giới nhìn vòng phát hiện sớm cấp chiến dịch, hoạt động độc lập không thuộc biên chế cố định của một tổ hợp tên lửa cụ thể.
                            </p>
                            <div className="space-y-2">{standaloneRadars.map(renderTemplateCard)}</div>
                          </div>
                        )}

                        {/* 3. CÁC KHÍ TÀI KHÁC (SCH, Pháo, ESM) */}
                        {otherEquipments.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 pb-1 border-b border-slate-800 text-slate-300 font-bold text-xs uppercase tracking-wider">
                              <span>🛡️ SỞ CHỈ HUY, PHÁO & KHÍ TÀI KHÁC ({otherEquipments.length})</span>
                            </div>
                            <div className="space-y-2">{otherEquipments.map(renderTemplateCard)}</div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Nếu xem danh mục cụ thể khác
                  return <div className="space-y-2">{matchedTemplates.map(renderTemplateCard)}</div>;
                })()}
              </div>
            </div>
          )}

          {/* TAB 2: BIÊN CHẾ TRẬN ĐỊA (OUTLINER) */}
          {activeTab === 'outliner' && (
            <div className="flex-1 flex flex-col p-3 overflow-hidden">
              {/* Ô tìm kiếm */}
              <div className="relative mb-2.5">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Tìm kiếm khí tài đã đặt..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 text-slate-200 text-xs pl-8 pr-3 py-1.5 rounded border border-slate-800 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              {/* Danh sách khí tài trên map */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
                {filteredInstances.length === 0 ? (
                  <div className="text-center py-8 text-slate-500 text-xs">
                    {instances.length === 0
                      ? 'Chưa có khí tài nào trên bản đồ. Hãy chọn khí tài từ Tab "Kho Khí Tài" để đặt!'
                      : 'Không tìm thấy khí tài phù hợp.'}
                  </div>
                ) : (
                  filteredInstances.map((inst) => {
                    const isSelected = selectedInstanceId === inst.instanceId;
                    const statusColorMap = {
                      Active: 'bg-emerald-400',
                      Standby: 'bg-amber-400',
                      Maintenance: 'bg-orange-400',
                      Offline: 'bg-rose-400',
                    };

                    const meta = ASSET_TYPE_REGISTRY[inst.category] || ASSET_TYPE_REGISTRY.RadarCanhGioi;
                    const parentInst = inst.commandedByInstanceId ? instances.find((i) => i.instanceId === inst.commandedByInstanceId) : null;

                    let rangeLabel = `${inst.rangeKm} km`;
                    if (inst.category === 'SoChiHuy') {
                      rangeLabel = `C2: ${inst.rangeKm} km`;
                    } else if (inst.category === 'TenLuaPhongKhong') {
                      rangeLabel = `Hỏa lực: ${inst.rangeKm} km`;
                    } else if (inst.category === 'PhaoPhongKhong') {
                      rangeLabel = `Tầm bắn: ${inst.rangeKm} km`;
                    } else if (inst.category === 'TramQuanSat') {
                      rangeLabel = `Quan sát: ${inst.rangeKm} km`;
                    } else {
                      rangeLabel = `Trinh sát: ${inst.rangeKm} km`;
                    }

                    return (
                      <div
                        key={inst.instanceId}
                        onClick={() => {
                          selectEquipment(inst.instanceId);
                          triggerFlyTo({
                            id: inst.instanceId,
                            name: inst.name,
                            latitude: inst.latitude,
                            longitude: inst.longitude,
                            height: 95000,
                            pitch: -35,
                          });
                        }}
                        className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-cyan-950/70 border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.4)] ring-1 ring-cyan-400'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            <span
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                statusColorMap[inst.status]
                              }`}
                              title={`Trạng thái: ${inst.status}`}
                            />
                            {inst.shortId && (
                              <span
                                className="px-1.5 py-0.2 text-[10px] font-mono font-bold rounded flex-shrink-0 shadow-sm border"
                                style={{
                                  backgroundColor: `${meta.defaultColor}20`,
                                  borderColor: `${meta.defaultColor}80`,
                                  color: meta.defaultColor,
                                }}
                              >
                                {inst.shortId}
                              </span>
                            )}
                            <span className="text-xs font-semibold text-slate-200 truncate">
                              {inst.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            {/* Nút Ghim vị trí để kéo bản đồ lên/xuống */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                selectEquipment(inst.instanceId);
                                triggerFlyTo({
                                  id: inst.instanceId,
                                  name: inst.name,
                                  latitude: inst.latitude,
                                  longitude: inst.longitude,
                                  height: 95000,
                                  pitch: -35,
                                });
                              }}
                              className="p-1 text-slate-400 hover:text-cyan-400 hover:bg-cyan-950/40 rounded transition-colors"
                              title="Ghim vị trí để kéo bản đồ lên/xuống"
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>

                            {/* Xóa khí tài */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeEquipment(inst.instanceId);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors"
                              title="Xóa khí tài này"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Phân loại chuyên ngành & Cấp chỉ huy liên kết */}
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span
                            className="text-[9px] font-medium px-1.5 py-0.2 rounded border"
                            style={{
                              backgroundColor: `${meta.defaultColor}15`,
                              borderColor: `${meta.defaultColor}40`,
                              color: meta.defaultColor,
                            }}
                          >
                            {meta.nameVi}
                          </span>
                          {inst.category === 'RadarCanhGioi' && inst.canDesignateForSam && (
                            <span className="text-[9px] font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-500/50 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                              🎯 {EQUIPMENT_UI_LABELS.RADAR_SUBROLE_SHORT.FIRE_CONTROL}
                            </span>
                          )}
                          {inst.category === 'RadarCanhGioi' && !inst.canDesignateForSam && (
                            <span className="text-[9px] text-amber-300/80 bg-amber-950/40 border border-amber-600/30 px-1.5 py-0.2 rounded">
                              👁️ {EQUIPMENT_UI_LABELS.RADAR_SUBROLE_SHORT.EARLY_WARNING}
                            </span>
                          )}
                          {inst.category === 'TenLuaPhongKhong' && inst.compositeBattery && (
                            <span className="text-[9px] font-bold text-rose-300 bg-rose-950/80 border border-rose-500/50 px-1.5 py-0.2 rounded flex items-center gap-1">
                              🚀 Cụm {inst.compositeBattery.launchers.length} bệ
                              {inst.compositeBattery.launchers.some((l) => !l.isValid) && (
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" title="Có bệ phóng gặp lỗi cự ly/che khuất!" />
                              )}
                            </span>
                          )}
                          {inst.category === 'TenLuaPhongKhong' && inst.designatedRadarId && (
                            <span className="text-[9px] text-cyan-300 bg-cyan-950/60 border border-cyan-600/40 px-1.5 py-0.2 rounded font-mono">
                              📡 Đài dẫn: {instances.find((i) => i.instanceId === inst.designatedRadarId)?.shortId || 'Radar'}
                            </span>
                          )}
                          {parentInst && (
                            <span className="text-[9px] text-amber-300/90 bg-amber-950/50 border border-amber-700/40 px-1.5 py-0.2 rounded font-mono truncate max-w-[150px]">
                              ↳ Thuộc {parentInst.shortId || 'C2'}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-400 font-mono">
                          <span>
                            {inst.latitude.toFixed(3)}°N, {inst.longitude.toFixed(3)}°E • {inst.altitude || 0}m
                          </span>
                          <span
                            className="font-medium"
                            style={{ color: isSelected ? '#fbbf24' : meta.defaultColor }}
                          >
                            {rangeLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
