# Checkpoint: Đồng Bộ Hóa & Khắc Phục Các Chế Độ Bắn SAM Trên Mặt Cắt Đứng 2D

- **Ngày thực hiện:** 21/10/2026
- **Mục tiêu:** Khắc phục triệt để lỗi không chuyển được các chế độ bắn (Bắn đón, Bắn đuổi, Đánh chặn đạn đạo, Nhiễu EW/TC/TK, Quang học TBK/TVK, Mặt đất) trên biểu đồ Mặt Cắt Đứng 2D (`RadarCrossSectionPanel.tsx`) cho tất cả các tổ hợp Tên Lửa Phòng Không (S-300 PMU-1, C-125-2TM Pechora-2TM, C-125M Pechora, Spyder, Kub).

---

## 1. Các vấn đề đã phát hiện & Nguyên nhân gốc rễ

1. **Lệch định danh chế độ (ID mismatch) do fix cứng danh sách nút:**
   - Trong `RadarCrossSectionPanel.tsx`, danh sách nút chế độ bị fix cứng 5 giá trị: `['head_on', 'tail_chase', 'jamming_passive', 'jamming_active', 'tbk_optical']`.
   - Trong khi đó:
     - **S-300 PMU-1 (`sam_s300_pmu1`):** Sử dụng các mode `head_on`, `ballistic` (Đạn đạo), `tail_chase`, `jamming`. Hoàn toàn thiếu nút `ballistic` và `jamming`, còn các nút khác bấm vào bị `undefined`.
     - **C-125-2TM Pechora-2TM (`sam_c125_2tm`):** Sử dụng `head_on`, `tail_chase`, `tvk_optical`, `surface`. Bấm vào các nút `jamming_passive`, `jamming_active`, `tbk_optical` đều trả về `undefined`.
     - **C-125M Pechora (`sam_c125m`):** Sử dụng `passive_jamming`, `active_jamming`, `tvk_optical`, `surface` (lệch tên với `jamming_passive`, `tbk_optical`).
2. **Tổ hợp Spyder không cập nhật 2D theo chế độ bắn:**
   - Code vẽ WEZ 2D của Spyder trước đây fix cứng `spyderCfg.mr.dMaxKm` (50km) và `spyderCfg.mr.hMaxM` (16km), hoàn toàn bỏ qua `samProfile` khi chuyển giữa Bắn đón, Bắn đuổi (28km) hay Nhiễu (35km).
3. **Không tự động thích ứng khung nhìn (Viewport Zoom):**
   - Khi chuyển giữa chế độ bắn xa (150km của S-300) sang đánh chặn đạn đạo (40km), khung cự ly trục X bị giữ nguyên ở 172km, khiến quả lê bị thu nhỏ lại góc dưới đồ thị.
4. **Xung đột bộ nhớ đệm `samVolume.effectiveRanges` của chế độ cũ:**
   - Khi chuyển chế độ, 3D volume được tính lại bất đồng bộ. Trong khoảng thời gian này, `samVolume` cũ mang các tầng độ cao và cự ly của chế độ cũ, gây méo mó quả lê nếu áp trực tiếp `effectiveRanges`.

---

## 2. Các giải pháp đã triển khai

### 2.1. Chuẩn hóa State & Alias Mapping trong `useTacticalStore.ts`
- Cải tiến action `setSamEngagementMode`: bổ sung cơ chế alias-mapping 2 chiều an toàn:
  - `jamming_passive` $\leftrightarrow$ `passive_jamming`
  - `jamming_active` $\leftrightarrow$ `active_jamming`
  - `tbk_optical` $\leftrightarrow$ `tvk_optical`
  - `jamming` $\leftrightarrow$ `active_jamming` / `jamming_active`
- Đảm bảo khi người dùng kích hoạt bất kỳ chế độ nào, store luôn tìm thấy `profile` chuẩn xác và cập nhật `rangeKm`, `minEngagementRangeKm`, `maxEngagementAltitudeM`, `maxTargetSpeedMps`, `maxTargetParamKm`.

### 2.2. Sinh danh sách nút chế độ bắn động (`availableModes`) trong `RadarCrossSectionPanel.tsx`
- Thay thế mảng tĩnh bằng việc đọc trực tiếp `selectedInst.samProfiles || samTmpl?.samProfiles`.
- Tự động map nhãn tiếng Việt ngắn gọn và tooltip đầy đủ thông số:
  - `head_on`: `Đón` (Mục tiêu khí động / Không nhiễu)
  - `ballistic`: `Đạn đạo` (Đánh chặn tên lửa đạn đạo)
  - `tail_chase`: `Đuổi` (Bắn đuổi khí động)
  - `jamming`: `Nhiễu EW`
  - `passive_jamming` / `jamming_passive`: `Nhiễu-TC` (Nhiễu tiêu cực)
  - `active_jamming` / `jamming_active`: `Nhiễu-TK` (Nhiễu tích cực)
  - `tvk_optical` / `tbk_optical`: `Quang` (Kênh quang điện tử)
  - `surface`: `Mặt đất` (Mục tiêu mặt đất / mặt nước)

### 2.3. Tự động thích ứng khung nhìn (Adaptive Viewport Zoom)
- Bổ sung theo dõi `prevSamMode`: ngay khi `activeSamMode` thay đổi, hệ thống tự động reset `viewDistMaxM` và `viewAltMaxM`.
- `maxRangeM` và `maxAltM` tự động tính toán lại ôm sát `samDMaxKm` và `samHMaxM` của chế độ mới (ví dụ chuyển sang Đạn đạo thì trục X co về 46km thay vì 172km, giúp vòm hỏa lực hiển thị to, rõ nét).

### 2.4. Đồng bộ vòm hỏa lực Spyder 2D & Bảo vệ `samVolume`
- Cập nhật thuật toán tính vòm Spyder 2D: sử dụng `samProfile?.dMaxKm` và `samProfile?.hMaxM` để co giãn vòm tên lửa Derby-MR và Python-5 SR tức thời theo chế độ bắn.
- Bổ sung cờ kiểm tra `isVolumeMatchingMode`: chỉ áp dụng `samVolume.effectiveRanges` khi `samVolume.mode === activeSamMode`. Trong lúc 3D volume đang tính ngầm, SVG `clipPath="url(#samLosVisibleClip)"` đảm nhận việc cắt vòm theo bóng núi theo thời gian thực.

### 2.5. Nâng cấp Tiêu đề Badge & Subtitle
- Tiêu đề badge trên header hiển thị trực quan theo tên chế độ: ví dụ `BẮN ĐÓN (KHÔNG NHIỄU)`, `MỤC TIÊU ĐẠN ĐẠO (ĐÁNH CHẶN)`, `BẮN ĐUỔI KHÍ ĐỘNG`.
- Dòng phụ đề hiển thị đầy đủ xạ giới, trần bắn và vận tốc mục tiêu tối đa $V_{\max}$ theo thời gian thực.

---

## 3. Các file thay đổi

- `src/store/useTacticalStore.ts`: Thêm alias mapping an toàn trong action `setSamEngagementMode`.
- `src/components/ui/RadarCrossSectionPanel.tsx`: Cập nhật toàn bộ thanh nút chế độ động, xử lý co giãn WEZ Spyder & Pechora/S-300, tự động khớp khung nhìn và bảo vệ cache volume.

---

## 4. Kết quả xác minh

- **Biên dịch TypeScript & Đóng gói Bundle (`npm run build`):**
  - Đã chạy `tsc -b && vite build` $\rightarrow$ **Thành công (Exit code: 0)**, không phát sinh bất kỳ lỗi cú pháp hoặc TypeScript nào.
- **Xác nhận tương tác đa khí tài:**
  - **S-300 PMU-1:** Xuất hiện đầy đủ `[Đón]` (150km), `[Đạn đạo]` (40km), `[Đuổi]` (90km), `[Nhiễu EW]` (120km). Bấm chuyển chế độ, đồ thị tự động co giãn ôm sát vòm mới.
  - **C-125-2TM Pechora-2TM:** Có đủ `[Đón]` (35.4km), `[Đuổi]` (25km), `[Quang]` (28km), `[Mặt đất]` (25km).
  - **C-125M Pechora:** Có đủ 6 chế độ tác chiến bao gồm cả Nhiễu-TC (13km) và Nhiễu-TK (11.7km).
  - **Spyder:** Các chế độ Bắn đón, Bắn đuổi, Nhiễu, TBK co giãn vòm kép chuẩn xác theo thông số tên lửa Derby-MR và Python-5 SR.
