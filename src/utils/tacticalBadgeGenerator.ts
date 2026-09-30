import type { EquipmentCategory, OperationalStatus } from '../types/equipment';
import { STATUS_COLOR_MAP } from './assetVisualization';

export interface TacticalBadgeParams {
  instanceId: string;
  name: string;
  shortId?: string;
  category: EquipmentCategory;
  rangeKm?: number;
  antennaHeightAGL?: number;
  status?: OperationalStatus;
  isSelected?: boolean;
  realPhotoUrl?: string;
  themeColor?: string;
}

// Bộ nhớ đệm ảnh đã nạp
const imageElementCache = new Map<string, HTMLImageElement>();
// Bộ nhớ đệm Canvas đã vẽ Data URL
const badgeDataUrlCache = new Map<string, { dataUrl: string; key: string }>();
// Danh sách callback lắng nghe khi ảnh tải xong để cập nhật cờ trên bản đồ
const onImageLoadedCallbacks = new Set<() => void>();

export function registerBadgeImageListener(callback: () => void): () => void {
  onImageLoadedCallbacks.add(callback);
  return () => onImageLoadedCallbacks.delete(callback);
}

function notifyBadgeImageLoaded() {
  onImageLoadedCallbacks.forEach((cb) => {
    try {
      cb();
    } catch {
      // ignore
    }
  });
}

function getOrLoadImage(url: string): HTMLImageElement | null {
  if (!url) return null;
  if (imageElementCache.has(url)) {
    const img = imageElementCache.get(url)!;
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  imageElementCache.set(url, img);

  img.onload = () => {
    notifyBadgeImageLoaded();
  };
  return null;
}

/**
 * TẠO CỜ HIỆU QUÂN SỰ TÁC CHIẾN GỌN GÀNG (TACTICAL BADGE BILLBOARD)
 * - Bên trái: Hình ảnh thực tế khí tài
 * - Bên phải: Số hiệu [R-01] và Tên đầy đủ khí tài sắc nét
 * - Nền: Đen mờ đặc 100% (Solid Matte Black), không hiệu ứng chói sáng, không che khuất chữ
 * - Chân cờ: Cán kim loại định vị chuẩn xác tại toạ độ tâm khí tài
 */
export function getTacticalBadgeDataUrl(params: TacticalBadgeParams): string {
  const {
    instanceId,
    name,
    shortId,
    status = 'Active',
    isSelected = false,
    realPhotoUrl = '',
    themeColor = '#06b6d4',
  } = params;

  // Tải ảnh thực tế từ cache
  const photoImg = realPhotoUrl ? getOrLoadImage(realPhotoUrl) : null;
  const isImgLoaded = photoImg !== null;

  const cacheKey = `${instanceId}_${name}_${shortId}_${isSelected}_${realPhotoUrl}_${isImgLoaded}_${themeColor}`;
  const cached = badgeDataUrlCache.get(instanceId);
  if (cached && cached.key === cacheKey) {
    return cached.dataUrl;
  }

  // Khởi tạo Canvas chuẩn Retina (scale x2) - Chiều cao tinh gọn 46px
  const logicalWidth = 240;
  const logicalHeight = 46;
  const scale = 2;

  const canvas = document.createElement('canvas');
  canvas.width = logicalWidth * scale;
  canvas.height = logicalHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);

  const mainColor = isSelected ? '#38bdf8' : themeColor;
  const statusHex = STATUS_COLOR_MAP[status]?.hex || '#10b981';

  // =========================================================================
  // 1. CÁN CỜ & MŨI ĐỊNH VỊ TÂM KHÍ TÀI (Chân cờ tại x=12, y=42)
  // =========================================================================
  const poleX = 12;
  const poleBottomY = 42;
  const poleTopY = 4;

  // Mũi cắm định vị chân cờ tại tâm
  ctx.beginPath();
  ctx.arc(poleX, poleBottomY, 3, 0, Math.PI * 2);
  ctx.fillStyle = isSelected ? '#fde047' : '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Tâm chữ thập định vị chân cờ
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(poleX - 4, poleBottomY);
  ctx.lineTo(poleX + 4, poleBottomY);
  ctx.moveTo(poleX, poleBottomY - 4);
  ctx.lineTo(poleX, poleBottomY + 4);
  ctx.stroke();

  // Thân cán cờ kim loại
  ctx.strokeStyle = isSelected ? '#fef08a' : '#94a3b8';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(poleX, poleTopY);
  ctx.lineTo(poleX, poleBottomY - 2);
  ctx.stroke();

  // Chóp tròn mạ vàng trên đỉnh cán cờ
  ctx.beginPath();
  ctx.arc(poleX, poleTopY, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#fbbf24';
  ctx.fill();
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // =========================================================================
  // 2. THÂN THẺ CỜ TÁC CHIẾN (NỀN ĐEN MỜ ĐẶC 100%, KHÔNG CHÓI SÁNG, KHÔNG ĐỔ BÓNG)
  // =========================================================================
  const cardX = 14;
  const cardY = 4;
  const cardW = logicalWidth - cardX - 4;
  const cardH = 38;
  const radius = 6;

  // Nền đen mờ quân sự 100% đặc hoàn toàn - không bị ánh sáng bản đồ hay radar xuyên thấu
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = '#030712'; // Solid 100% matte black
  ctx.fill();

  // Đường viền thẻ tác chiến sắc sảo
  ctx.strokeStyle = isSelected ? '#fde047' : '#334155';
  ctx.lineWidth = isSelected ? 1.8 : 1.2;
  ctx.stroke();

  // =========================================================================
  // 3. KHUNG HÌNH ẢNH THỰC TẾ KHÍ TÀI BÊN TRÁI
  // =========================================================================
  const photoSize = 30;
  const photoX = cardX + 4;
  const photoY = cardY + 4;
  const photoRadius = 4;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(photoX, photoY, photoSize, photoSize, photoRadius);
  ctx.clip();

  if (photoImg) {
    const nw = photoImg.naturalWidth || photoSize;
    const nh = photoImg.naturalHeight || photoSize;
    const aspect = nw / nh;
    let sW = nw;
    let sH = nh;
    let sX = 0;
    let sY = 0;
    if (aspect > 1) {
      sW = nh;
      sX = (nw - nh) / 2;
    } else {
      sH = nw;
      sY = (nh - nw) / 2;
    }
    ctx.drawImage(photoImg, sX, sY, sW, sH, photoX, photoY, photoSize, photoSize);
  } else {
    // Placeholder đen xám quân sự khi chưa nạp xong ảnh
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(photoX, photoY, photoSize, photoSize);
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(photoX + photoSize / 2, photoY + photoSize / 2, 8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Viền bao quanh khung ảnh thực tế
  ctx.beginPath();
  ctx.roundRect(photoX, photoY, photoSize, photoSize, photoRadius);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Đèn LED nhỏ chỉ báo trạng thái ở góc ảnh
  const ledX = photoX + photoSize - 3.5;
  const ledY = photoY + photoSize - 3.5;
  ctx.beginPath();
  ctx.arc(ledX, ledY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = statusHex;
  ctx.fill();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // =========================================================================
  // 4. CHỈ HIỂN THỊ SỐ HIỆU & TÊN KHÍ TÀI (THEO YÊU CẦU CỦA NGƯỜI DÙNG)
  // =========================================================================
  const textX = photoX + photoSize + 6;
  const maxAvailableW = cardX + cardW - textX - 6;

  let nameStartX = textX;
  let nameMaxW = maxAvailableW;

  // Vẽ tag số hiệu [R-01] nếu có
  if (shortId) {
    ctx.font = 'bold 9.5px "JetBrains Mono", Consolas, monospace';
    const tagTextW = ctx.measureText(shortId).width;
    const tagW = tagTextW + 6;
    const tagH = 16;
    const tagY = cardY + (cardH - tagH) / 2;

    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.roundRect(textX, tagY, tagW, tagH, 3);
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#fde047' : '#475569';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = isSelected ? '#fde047' : '#38bdf8';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortId, textX + 3, tagY + tagH / 2);

    nameStartX = textX + tagW + 5;
    nameMaxW = maxAvailableW - tagW - 5;
  }

  // Vẽ tên đầy đủ khí tài: Font trắng tinh, sắc nét, căn giữa theo chiều dọc
  ctx.font = 'bold 11.5px "Segoe UI", system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  const truncatedName = fitText(ctx, name, nameMaxW);
  ctx.fillText(truncatedName, nameStartX, cardY + cardH / 2);
  ctx.textBaseline = 'alphabetic'; // reset

  const dataUrl = canvas.toDataURL('image/png');
  badgeDataUrlCache.set(instanceId, { dataUrl, key: cacheKey });
  return dataUrl;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let len = text.length;
  while (len > 3 && ctx.measureText(`${text.substring(0, len)}...`).width > maxWidth) {
    len -= 1;
  }
  return `${text.substring(0, len)}...`;
}
