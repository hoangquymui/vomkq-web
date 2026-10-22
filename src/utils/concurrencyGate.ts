/**
 * CỔNG GIỚI HẠN SỐ TÁC VỤ ĐỒNG THỜI
 * =================================
 *
 * Tách riêng khỏi `vectorFeatureStore.ts` để KIỂM THỬ ĐƯỢC — logic hàng đợi là
 * loại code dễ sai mà test lại là điều duy nhất giữ được nó đúng.
 */

/** Hàm trả quyền cho cổng sau khi tác vụ xong. */
export type ReleaseGate = () => void;

export interface ConcurrencyGate {
  /** Chờ tới lượt rồi trả về hàm trả quyền. */
  acquire: () => Promise<ReleaseGate>;
  /** Số tác vụ đang chạy (chỉ để test và chẩn đoán). */
  readonly activeCount: () => number;
  /** Số tác vụ đang chờ trong hàng đợi. */
  readonly queuedCount: () => number;
}

/**
 * Tạo cổng giới hạn số tác vụ đồng thời.
 *
 * Dùng:
 *   const release = await gate.acquire();
 *   try { ...việc cần giới hạn... } finally { release(); }
 *
 * LỖI ĐÃ MẮC PHẢI (đã có test chặn lại)
 *   Phiên bản đầu tiên làm `release()` gọi `active--` rồi đẩy người chờ kế tiếp
 *   vào mà KHÔNG tăng `active` lại. Sau vài vòng, `active` âm dần và cổng cho
 *   phép vô hạn tác vụ cùng lúc — đúng cái lỗi "giới hạn 2 nhưng chạy 3".
 *
 *   Nguyên nhân: `active` phải mô tả "số chỗ đang bị chiếm". Khi trao lượt, chỗ
 *   đó KHÔNG được giải phóng rồi chiếm lại — nó chuyển thẳng từ người trước sang
 *   người sau. Nên phải GIỮ NGUYÊN `active` khi trao lượt, và chỉ giảm khi
 *   không còn ai chờ.
 */
export function createConcurrencyGate(limit: number): ConcurrencyGate {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Giới hạn không hợp lệ: ${limit} (cần số nguyên >= 1)`);
  }

  // Số chỗ đang bị chiếm. Tăng khi có người vào, giảm khi người cuối ra.
  let active = 0;
  // Hàng đợi chờ. Mỗi mục là hàm trao quyền cho người đang chờ.
  const waiters: Array<() => void> = [];

  function makeRelease(): ReleaseGate {
    let released = false;
    return () => {
      // Chống gọi hai lần: nếu không, `active` bị trừ quá mức và cổng hỏng.
      if (released) return;
      released = true;

      const next = waiters.shift();
      if (next) {
        // Trao thẳng lượt cho người kế tiếp: `active` GIỮ NGUYÊN vì chỗ đang
        // chiếm không hề được giải phóng. Nếu tăng ở đây thì sẽ thành +2.
        next();
      } else {
        // Không còn ai chờ thì mới thật sự trả chỗ.
        active--;
      }
    };
  }

  return {
    acquire() {
      if (active < limit) {
        active++;
        return Promise.resolve(makeRelease());
      }
      return new Promise<ReleaseGate>((resolve) => {
        waiters.push(() => resolve(makeRelease()));
      });
    },
    activeCount: () => active,
    queuedCount: () => waiters.length,
  };
}
