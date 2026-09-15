import React, { useState } from 'react';
import {
  Radar,
  Radio,
  Crosshair,
  ShieldAlert,
  Target,
  Antenna,
  Zap,
  PlusCircle,
  Pin,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import type { EquipmentTemplate } from '../../types/equipment';

export const LeftSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'outliner'>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  const {
    instances,
    selectedInstanceId,
    pendingTemplate,
    selectEquipment,
    setPendingTemplate,
    removeEquipment,
    triggerFlyTo,
  } = useTacticalStore();

  // Mapping Icon
  const getIcon = (iconName: string, color: string) => {
    const props = { className: 'w-4 h-4', style: { color } };
    switch (iconName) {
      case 'Radar':
        return <Radar {...props} />;
      case 'Radio':
        return <Radio {...props} />;
      case 'Crosshair':
        return <Crosshair {...props} />;
      case 'ShieldAlert':
        return <ShieldAlert {...props} />;
      case 'Target':
        return <Target {...props} />;
      case 'Antenna':
        return <Antenna {...props} />;
      case 'Zap':
        return <Zap {...props} />;
      default:
        return <Radar {...props} />;
    }
  };

  // Lọc danh sách khí tài đã đặt
  const filteredInstances = instances.filter((inst) =>
    inst.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              Kho Khí Tài ({EQUIPMENT_TEMPLATES.length})
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
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              <div className="text-[11px] text-slate-400 font-mono uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Khí tài sẵn sàng</span>
                <span className="text-cyan-400">Chọn để triển khai</span>
              </div>

              {EQUIPMENT_TEMPLATES.map((tmpl: EquipmentTemplate) => {
                const isSelectedForPlacement = pendingTemplate?.id === tmpl.id;
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
                          className="w-7 h-7 rounded bg-slate-800/80 flex items-center justify-center border border-slate-700"
                          style={{ borderColor: `${tmpl.symbolColor}44` }}
                        >
                          {getIcon(tmpl.iconName, tmpl.symbolColor)}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-100 leading-tight">
                            {tmpl.name}
                          </h4>
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.2 rounded"
                            style={{
                              backgroundColor: `${tmpl.symbolColor}1a`,
                              color: tmpl.symbolColor,
                            }}
                          >
                            {tmpl.categoryNameVi}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 mt-2 line-clamp-2">
                      {tmpl.description}
                    </p>

                    {/* Thông số kỹ thuật tóm tắt */}
                    <div className="grid grid-cols-2 gap-1.5 mt-2.5 pt-2 border-t border-slate-800 text-[10px] font-mono text-slate-300">
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
                        <span className="text-slate-500">Tháp ăng-ten: </span>
                        <span>{tmpl.antennaHeightAGL}m AGL</span>
                      </div>
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
                          : 'bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-600/60'
                      }`}
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>{isSelectedForPlacement ? 'Hủy đặt khí tài' : 'Triển khai lên bản đồ'}</span>
                    </button>
                  </div>
                );
              })}
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

                    return (
                      <div
                        key={inst.instanceId}
                        onClick={() => selectEquipment(inst.instanceId)}
                        className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-cyan-950/70 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span
                              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                statusColorMap[inst.status]
                              }`}
                            />
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

                        <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-400 font-mono">
                          <span>
                            {inst.latitude.toFixed(3)}°N, {inst.longitude.toFixed(3)}°E
                          </span>
                          <span className="text-cyan-300 font-medium">
                            {inst.rangeKm} km
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
