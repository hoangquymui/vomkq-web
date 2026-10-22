/**
 * BIỂU ĐỒ CÁNH HOA ĐỘ DỐC THEO HƯỚNG
 * ==================================
 *
 * VẾT ĐỐI LẬP VỚI BẢNG SỐ:
 * Bảng "Độ dốc lớn nhất 23°, trung bình 7°" trả lời "chỗ nào dốc nhất", nhưng
 * KHÔNG trả lời "hướng nào đặt đài thì bị núi chắn". Với bài toán radar, thứ quan
 * trọng là hình học theo hướng: nếu một hướng có gai nhọn đỏ còn các hướng khác
 * xanh, thì chỉ cần tránh hướng đó — đó là thông tin mà số liệu đã bào mòn.
 *
 * DỮ LIỆU: `terrainRings` trong `SiteProfile` — 8 vòng × 24 hướng, mỗi mẫu có
 * `bearingDeg` / `elevationM` / `slopeDeg`. Không gọi lại Cesium.
 *
 * HÌNH HỌC:
 *   - 24 trục, 0° ở BẮC, tăng theo chiều kim đồng hồ (khớp `sampleTerrainHeights`).
 *   - Bán kính pixel = cao độ mẫu (độ cao tương đối so với cao độ tâm): vùng nào
 *     nhô cao thì cánh hoa nhô ra. Đây là biểu đồ ĐỘ CAO.
 *   - Màu = độ dốc (`classifySlope`) dùng CHUNG ngưỡng với `describeSlope` nên
 *     nghĩa màu luôn khớp nghĩa chữ trong bảng bên cạnh.
 *
 * TÁCH RIÊNG 1 FILE: React Fast Refresh chỉ hoạt động khi mỗi file export đúng
 * 1 component. Gộp vào SiteProfilePanel.tsx sẽ làm mất hot reload.
 */

import React from 'react';
import { classifySlope, type TerrainProfileRing } from '../../../utils/featureAwareness';

/** Đỉnh SVG 200×200, tâm (100,100), để các phép tính giữa số nguyên dễ nhớ. */
const VIEW = 200;
const CENTER = VIEW / 2;
/** Bán kính vẽ tối đa — chừa chỗ cho nhãn phương vị ở rìa. */
const R_MAX = 78;

/** Quy đổi phương vị (0° = bắc, theo chiều kim đồng hồ) sang góc toạ độ SVG. */
function polar(bearingDeg: number, radiusPx: number) {
  // SVG đo góc ngược chiều kim đồng hồ từ trục +x, còn bearing đo từ BẮC theo
  // chiều kim đồng hồ. Lệch 90° là đủ để chuyển giữa hai hệ toạ độ.
  const rad = ((bearingDeg - 90) * Math.PI) / 180;
  return { x: CENTER + radiusPx * Math.cos(rad), y: CENTER + radiusPx * Math.sin(rad) };
}

/**
 * Quy đổi một mẫu thành bán kính pixel.
 *
 * CÔNG THỨC: `r = bán kính của vòng  ×  (1 + 0.45 × độ chênh cao chuẩn hoá)`
 *
 * VÌ SAO PHẢI NHÂN VÀO CỰ LY: bản đồ tròn này là hình chiếu phẳng của vùng phủ,
 * nên bán kính VỀ mặt phải là cự ly thật — như vậy vòng trong ứng với 2 km thật,
 * vòng ngoài ứng với 15 km thật, và người dùng đối chiếu với bản đồ hiển thị bên
 * cạnh được ngay. Lần trước chỉ dùng độ chênh cao nên CẢ 8 VÒNG CHỒNG LÊN
 * NHAU thành một hình tròn đặc — mất sạch thông tin cự ly và trông như rác.
 *
 * VÌ SAO ĐỘ CHÊNH CAO CHỈ NHÂN 0.45 (không phải thay thế hoàn toàn): độ chênh cao
 * là thứ cần nhấn mạnh (cho biết hướng nào có núi chắn), nhưng nếu để nó quyết
 * định bán kính hoàn toàn thì biểu đồ lại mất thông tin cự ly — đúng lỗi lần
 * trước, chỉ đảo chiều. Hệ số 0.45 giữ được cả hai: cành cao hơn tâm nở ra tối
 * đa 45%, cao hơn thấp hơn co lại tối đa 22%, đủ thấy mà không phá hình học.
 *
 * Phía dưới tâm hệ số 0.55 thay vì 1.0: thung lũng — nơi đặt đài radar thường TỐT
 * nhất vì không bị đổ bóng — không nên vẽ rộng bằng đỉnh núi, nếu không người
 * dùng tưởng đó cũng là chướng ngại.
 */
function sampleToRadius(distanceM: number, maxDistanceM: number, riseM: number, maxRise: number): number {
  if (maxDistanceM <= 0) return 4;
  const distanceRatio = Math.min(1, distanceM / maxDistanceM);
  const riseRatio = maxRise > 0 ? Math.min(1, Math.abs(riseM) / maxRise) : 0;
  const gain = riseM >= 0 ? 0.45 : 0.45 * 0.55;
  return Math.max(4, distanceRatio * R_MAX * (1 + gain * riseRatio));
}

/** Chữ B/Đ/N/T đặt ở rìa, giúp người dùng không phải nhớ 0° là hướng nào. */
const CARDINALS = [
  { text: 'B', bearingDeg: 0 },
  { text: 'Đ', bearingDeg: 90 },
  { text: 'N', bearingDeg: 180 },
  { text: 'T', bearingDeg: 270 },
];

export const SlopeRoseChart: React.FC<{
  rings: TerrainProfileRing[];
  centerElevationM: number;
  hasTerrainData: boolean;
}> = ({ rings, centerElevationM, hasTerrainData }) => {
  if (!hasTerrainData || rings.length === 0) {
    return (
      <div className="rounded bg-slate-900/60 border border-slate-800 px-2 py-3 text-[10px] text-slate-500 text-center leading-relaxed">
        Chưa có dữ liệu cao độ cho vùng này.
        <br />
        Các chỉ số vectơ bên dưới vẫn dùng được.
      </div>
    );
  }

  // Tầng cao độ so với tâm, đưa về [0..1] để so sánh được giữa các vòng.
  const maxRise = Math.max(
    1,
    ...rings.flatMap((r) => r.samples.map((s) => Math.abs(s.elevationM - centerElevationM)))
  );
  // Vòng ngoài cùng = mốc cự ly để chuẩn hoá bán kính.
  const maxDistanceM = rings[rings.length - 1].radiusM;

  // Đường viền liền mạch: nối mẫu của từng vòng theo thứ tự phương vị. Các vòng
  // nối tiếp tạo thành dải hình quạt — đọc được "cao dần ra xa" và "thấp dần".
  const outline = rings
    .map((ring) =>
      ring.samples
        .map(
          (s) =>
            polar(s.bearingDeg, sampleToRadius(ring.radiusM, maxDistanceM, s.elevationM - centerElevationM, maxRise))
        )
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ')
    )
    .join(' ');

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="w-full h-auto max-w-[170px] mx-auto block"
        role="img"
        aria-label="Hình địa hình và độ dốc theo 24 hướng quanh vị trí khí tài"
      >
        {CARDINALS.map((c) => {
          const p = polar(c.bearingDeg, R_MAX + 12);
          return (
            <text
              key={c.text}
              x={p.x}
              y={p.y + 3}
              textAnchor="middle"
              className="fill-slate-500"
              fontSize={9}
              fontWeight={700}
            >
              {c.text}
            </text>
          );
        })}

        {/* Vòng tròn tham chiếu + 4 trục chính (vẽ 24 trục sẽ rối mắt) */}
        <circle cx={CENTER} cy={CENTER} r={R_MAX} fill="none" stroke="#1e293b" strokeWidth={1} />
        <circle cx={CENTER} cy={CENTER} r={R_MAX * 0.5} fill="none" stroke="#1e293b" strokeWidth={0.5} />
        {[0, 90, 180, 270].map((deg) => {
          const p = polar(deg, R_MAX);
          return (
            <line key={deg} x1={CENTER} y1={CENTER} x2={p.x} y2={p.y} stroke="#1e293b" strokeWidth={0.5} />
          );
        })}

        {/* Lớp 1 — hình dáng độ cao, tô mảnh để lớp màu bên dưới nổi lên */}
        <polygon
          points={outline}
          fill="#0ea5e9"
          fillOpacity={0.1}
          stroke="#38bdf8"
          strokeWidth={1}
          strokeOpacity={0.55}
        />

        {/* Lớp 2 — cành tô màu theo độ dốc của từng hướng.
            Vòng trong vẽ trước, vòng ngoài vẽ sau để vòng gần tâm không bị che. */}
        {rings.map((ring) =>
          ring.samples.map((s) => {
            const p = polar(
              s.bearingDeg,
              sampleToRadius(ring.radiusM, maxDistanceM, s.elevationM - centerElevationM, maxRise)
            );
            const level = classifySlope(s.slopeDeg);
            return (
              <line
                key={`${ring.ring}-${s.bearingDeg}`}
                x1={CENTER}
                y1={CENTER}
                x2={p.x}
                y2={p.y}
                stroke={level.color}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeOpacity={0.85}
              >
                <title>{`Hướng ${s.bearingDeg}° · ${(ring.radiusM / 1000).toFixed(1)} km · cao độ ${s.elevationM} m · dốc ${s.slopeDeg}° (${level.labelVi.toLowerCase()})`}</title>
              </line>
            );
          })
        )}

        {/* Tâm đài */}
        <circle cx={CENTER} cy={CENTER} r={2.5} fill="#22d3ee" />
      </svg>

      <figcaption className="text-[9px] text-slate-500 text-center mt-1 leading-tight">
        Nhô ra = cao hơn tâm · màu = độ dốc từng hướng
      </figcaption>
    </figure>
  );
};
