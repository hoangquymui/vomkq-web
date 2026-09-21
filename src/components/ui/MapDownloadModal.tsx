import React, { useState, useEffect } from 'react';
import {
  X,
  HardDriveDownload,
  CheckCircle2,
  Terminal,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

interface PackInfo {
  name?: string;
  lastUpdated?: string;
  highResRegions?: Array<{
    name: string;
    lat: number;
    lon: number;
    radiusKm: number;
    zoomLevels: string;
    downloadedAt: string;
    tileCount: number;
  }>;
  googleTerrain?: Array<{
    name: string;
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number };
    zoomLevels: string;
    downloadedAt: string;
    tileCount: number;
    localPath: string;
  }>;
}

export const MapDownloadModal: React.FC = () => {
  const {
    showMapDownloadModal,
    setShowMapDownloadModal,
    basemap,
    setBasemap,
  } = useTacticalStore();

  const [packInfo, setPackInfo] = useState<PackInfo | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>('mientrung');
  const [minZoom, setMinZoom] = useState<number>(8);
  const [maxZoom, setMaxZoom] = useState<number>(13);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  useEffect(() => {
    if (showMapDownloadModal) {
      fetch('./offline-pack-info.json')
        .then((res) => res.json())
        .then((data) => setPackInfo(data))
        .catch((err) => console.warn('Không tải được pack info:', err));
    }
  }, [showMapDownloadModal]);

  if (!showMapDownloadModal) return null;

  const cliAllCommand = `node download-tactical-all.js --region=${selectedRegion}`;
  const cliSatCommand = `node download-tactical-map.js --region=${selectedRegion} --minZoom=${minZoom} --maxZoom=${maxZoom}`;
  const cliTerrainCommand = `node download-tactical-terrain.js --region=${selectedRegion} --minZoom=8 --maxZoom=13`;
  const cliGoogleTerrainCommand = `node download-tactical-google-terrain.js --region=${selectedRegion} --minZoom=8 --maxZoom=13`;

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-cyan-500/40 rounded-xl shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950/80 border-b border-cyan-900/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-400">
              <HardDriveDownload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider text-cyan-400 font-mono">
                QUẢN LÝ DỮ LIỆU BẢN ĐỒ & ĐỊA HÌNH 3D NGOẠI TUYẾN
              </h2>
              <p className="text-[11px] text-slate-400">
                Dữ liệu địa hình 3D và ảnh vệ tinh độ nét cao đã lưu trữ cục bộ trong public/
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowMapDownloadModal(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* 1. Trạng thái hoạt động hiện tại */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-lg bg-slate-950/60 border border-slate-800">
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Lớp Ảnh Vệ Tinh (Basemap):
              </span>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-200">
                  {basemap === 'google-terrain'
                    ? 'Google Terrain VN (Địa Hình, Ranh Giới & Đường Xá)'
                    : basemap === 'google-hybrid'
                    ? 'Google Hybrid VN (Vệ Tinh Kèm Đường & Nhãn)'
                    : basemap === 'satellite'
                    ? 'Vệ Tinh Trực Tuyến HD (Zoom 0-19)'
                    : basemap === 'offline'
                    ? 'Vệ Tinh Ngoại Tuyến (Local Tiles)'
                    : basemap === 'topo'
                    ? 'Bản Đồ Địa Hình (Google Terrain)'
                    : 'Bản Đồ Tối (Dark Tactical)'}
                </span>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                Địa Hình 3D Lồi Lõm Thực Tế:
              </span>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
                <span className="text-xs font-bold text-slate-200">
                  Ngoại Tuyến Nét Cao (Quantized-Mesh 0-12)
                </span>
              </div>
            </div>
          </div>

          {/* 2. Dữ liệu ngoại tuyến đã sẵn sàng */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold font-mono text-cyan-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              CÁC VÙNG TÁC CHIẾN ĐÃ CÓ BẢN ĐỒ ĐỘ NÉT CAO OFFLINE (ZOOM 8-13):
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Thẻ Bản Đồ Google Terrain 2D Toàn Bộ Miền Trung */}
              <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-500/50 col-span-1 sm:col-span-2 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-cyan-300">
                    🗺️ Toàn Bộ Miền Trung & Tây Nguyên (Bản Đồ Google Terrain 2D VN)
                  </span>
                  <span className="text-[10px] bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/50 font-mono font-bold">
                    Đã Tải 100% (31.076 Files • 245 MB)
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Phạm vi từ Thanh Hóa đến Bình Thuận & 5 tỉnh Tây Nguyên (Level 8 - 13). Tự động kích hoạt khi ở chế độ 2D hoặc Ngoại tuyến, hiển thị đầy đủ địa giới hành chính, hệ thống cao tốc/quốc lộ, tên đèo núi sông vịnh tiếng Việt và sạch bóng quán xá.
                </p>
              </div>

              {/* Thẻ Địa Hình 3D Toàn Bộ Miền Trung */}
              <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/50 col-span-1 sm:col-span-2 shadow-[0_0_12px_rgba(16,185,129,0.15)]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-emerald-300">
                    🏔️ Toàn Bộ Miền Trung & Tây Nguyên (Địa Hình 3D Nét Cao Level 8 - 13)
                  </span>
                  <span className="text-[10px] bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/50 font-mono font-bold">
                    Đã Tải 100% (109.254 Files • 3.9 GB)
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Địa hình lồi lõm thực tế Quantized-Mesh chuẩn Cesium World Terrain, kèm bảng vector pháp tuyến đỉnh (`octvertexnormals`). Tự động hiển thị ở chế độ 3D với bóng đổ sống động, chuẩn xác 100% như online.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/40 border border-emerald-500/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-emerald-300">⛰️ Dãy Núi Tam Đảo (3D Terrain)</span>
                  <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/40 font-mono">
                    Đã Tải (Zoom 8-13)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Bán kính 35km bao trọn Vĩnh Phúc, Thái Nguyên, Tuyên Quang. Chi tiết sắc nét từng sườn đồi, đỉnh núi.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950/40 border border-emerald-500/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-emerald-300">⛰️ Bình Định - Đèo An Khê (3D Terrain)</span>
                  <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/40 font-mono">
                    Đã Tải (Zoom 8-13)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Bán kính 40km bao trọn Tây Sơn, An Khê, Quy Nhơn và vùng ven biển với địa hình 3D lồi lõm cực nét.
                </p>
              </div>
            </div>

            {packInfo?.lastUpdated && (
              <p className="text-[10px] text-slate-500 font-mono pt-1">
                Cập nhật gói gần nhất: {new Date(packInfo.lastUpdated).toLocaleString('vi-VN')}
              </p>
            )}
          </div>

          {/* 3. Công cụ tải thêm vùng mới */}
          <div className="p-3.5 rounded-lg bg-slate-950/60 border border-cyan-900/40 space-y-3">
            <h3 className="text-xs font-bold font-mono text-cyan-300 flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-cyan-400" />
              LỆNH TẢI BẢN ĐỒ VỆ TINH & ĐỊA HÌNH ĐỘ PHÂN GIẢI CAO:
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1 font-mono">Khu Vực Tác Chiến:</label>
                <select
                  value={selectedRegion}
                  onChange={(e) => setSelectedRegion(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
                >
                  <option value="mientrung">🗺️ Toàn Bộ Miền Trung & Tây Nguyên (Thanh Hóa → Bình Thuận)</option>
                  <option value="mientrung_core">🗺️ Trọng Điểm Miền Trung (Huế - Đà Nẵng - Quy Nhơn)</option>
                  <option value="tamdao">⛰️ Dãy Núi Tam Đảo (Vĩnh Phúc - Thái Nguyên)</option>
                  <option value="binhdinh">⛰️ Đèo An Khê - Tây Sơn (Bình Định - Gia Lai)</option>
                  <option value="haivan">⛰️ Đèo Hải Vân & Bán Đảo Sơn Trà (Đà Nẵng)</option>
                  <option value="danang">🏙️ Đà Nẵng & Duyên Hải Miền Trung</option>
                  <option value="hanoi">🏙️ Thủ Đô Hà Nội</option>
                  <option value="haiphong">⚓ Hải Phòng & Vịnh Bắc Bộ</option>
                  <option value="camranh">⚓ Vịnh Cam Ranh - Nha Trang</option>
                  <option value="tphcm">🏙️ TP. Hồ Chí Minh & Nam Bộ</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1 font-mono">Zoom Tối Thiểu:</label>
                <select
                  value={minZoom}
                  onChange={(e) => setMinZoom(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="8">Level 8 (Bao quát toàn cảnh)</option>
                  <option value="9">Level 9 (Tầm trung)</option>
                  <option value="10">Level 10 (Rõ huyện)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1 font-mono">Zoom Tối Đa:</label>
                <select
                  value={maxZoom}
                  onChange={(e) => setMaxZoom(parseInt(e.target.value, 10))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="12">Level 12 (Rõ sườn núi)</option>
                  <option value="13">Level 13 (Cực nét - Chuẩn quân sự)</option>
                  <option value="14">Level 14 (Chi tiết công sự)</option>
                </select>
              </div>
            </div>

            {/* ⭐ KHỐI LỆNH TẢI TRỌN GÓI (Khuyên dùng) */}
            <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-500/50 space-y-1.5 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-cyan-300 font-mono flex items-center gap-1.5">
                  ⭐ LỆNH TẢI TRỌN GÓI (CẢ ẢNH VỆ TINH + ĐỊA HÌNH 3D NÉT CAO):
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">Khuyên dùng</span>
              </div>
              <div className="flex items-center gap-2 p-2 bg-slate-950 rounded border border-cyan-800/60 font-mono text-[11px]">
                <span className="text-cyan-300 font-bold flex-1 truncate">{cliAllCommand}</span>
                <button
                  onClick={() => handleCopy(cliAllCommand, 'all')}
                  className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition-all shadow-[0_0_8px_rgba(6,182,212,0.3)] shrink-0"
                >
                  {copiedType === 'all' ? '✓ Đã Sao Chép' : 'Sao Chép Lệnh Trọn Gói'}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                Chỉ cần dán lệnh trên vào terminal, hệ thống sẽ tự động kéo cả ảnh vệ tinh Level 9-13 lẫn địa hình 3D Level 8-13 (kèm vector pháp tuyến) về máy.
              </p>
            </div>

            {/* Lệnh tải riêng biệt nếu cần */}
            <div className="space-y-2 pt-1 border-t border-slate-800/80">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block">Hoặc tải riêng từng phần:</span>
              
              {/* Bản đồ Google Terrain 2D */}
              <div className="flex items-center gap-2 p-2 bg-slate-900 rounded border border-slate-800 font-mono text-[11px]">
                <span className="text-cyan-300 flex-1 truncate">{cliGoogleTerrainCommand}</span>
                <button
                  onClick={() => handleCopy(cliGoogleTerrainCommand, 'google-terrain')}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs transition-colors shrink-0"
                >
                  {copiedType === 'google-terrain' ? '✓ Đã Sao Chép' : 'Tải Riêng Terrain VN'}
                </button>
              </div>

              {/* Ảnh vệ tinh */}
              <div className="flex items-center gap-2 p-2 bg-slate-900 rounded border border-slate-800 font-mono text-[11px]">
                <span className="text-slate-300 flex-1 truncate">{cliSatCommand}</span>
                <button
                  onClick={() => handleCopy(cliSatCommand, 'sat')}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors shrink-0"
                >
                  {copiedType === 'sat' ? '✓ Đã Sao Chép' : 'Tải Riêng Ảnh'}
                </button>
              </div>

              {/* Địa hình 3D */}
              <div className="flex items-center gap-2 p-2 bg-slate-900 rounded border border-slate-800 font-mono text-[11px]">
                <span className="text-emerald-400 flex-1 truncate">{cliTerrainCommand}</span>
                <button
                  onClick={() => handleCopy(cliTerrainCommand, 'terrain')}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs transition-colors shrink-0"
                >
                  {copiedType === 'terrain' ? '✓ Đã Sao Chép' : 'Tải Riêng 3D'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-950/90 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setBasemap('satellite')}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)] transition-all"
            >
              Dùng Vệ Tinh Trực Tuyến HD
            </button>
            <button
              onClick={() => setBasemap('offline')}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 transition-all"
            >
              Dùng Vệ Tinh Ngoại Tuyến (Offline)
            </button>
          </div>

          <button
            onClick={() => setShowMapDownloadModal(false)}
            className="px-4 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
