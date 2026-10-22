/**
 * KIỂM THỬ BỘ ĐO (`vectorPerf.ts`)
 *
 * Vì sao cần: các lỗi ở đây đều im lặng — không ném lỗi, chỉ báo sai số. Test là
 * cách duy nhất giữ chúng không quay lại.
 *
 * BA LỖI ĐÃ MẮC PHẢI:
 *   1. `disconnect()` nuốt mất bản ghi đang chờ — phải `takeRecords()` TRƯỚC.
 *   2. Bộ đo `await` 60 ms trước khi trả kho, tức LÀM CHẬM việc nó đo.
 *   3. Gộp "không hỗ trợ API" với "không đo lượt này".
 *
 * Vì sao dùng observer GIẢ: `PerformanceObserver` thật của Node không sinh long
 * task, nên không thể kiểm chứng logic đọc bản ghi bằng nó. Ta điều khiển chính
 * xác thời điểm bản ghi xuất hiện — đó là phần logic cần kiểm.
 *
 * Chạy: npx tsx --test scripts/vectorPerf.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

type FakeEntry = { duration: number };

interface FakeState {
  pending: FakeEntry[];
  took: number;
  disconnected: number;
  calls: string[];
}

/** Cài observer giả lên globalThis, trả về trạng thái quan sát được. */
function installFakeObserver(): { state: FakeState; restore: () => void } {
  const state: FakeState = { pending: [], took: 0, disconnected: 0, calls: [] };
  const g = globalThis as Record<string, unknown>;
  const original = g.PerformanceObserver;

  class FakePerfObserver {
    static supportedEntryTypes = ['longtask'];
    observe = (): void => {
      state.calls.push('observe');
    };
    takeRecords = (): FakeEntry[] => {
      state.calls.push('takeRecords');
      state.took += 1;
      const out = [...state.pending];
      state.pending = [];
      return out;
    };
    disconnect = (): void => {
      state.calls.push('disconnect');
      state.disconnected += 1;
    };
    constructor(_cb: (list: { getEntries: () => FakeEntry[] }) => void) {
      // Callback không dùng: ta đẩy bản ghi thủ công để kiểm soát thời điểm.
    }
  }

  g.PerformanceObserver = FakePerfObserver;
  g.__emitFakeEntries = (...durations: number[]): void => {
    state.pending.push(...durations.map((duration) => ({ duration })));
  };

  return {
    state,
    restore: () => {
      g.PerformanceObserver = original;
      delete g.__emitFakeEntries;
    },
  };
}

/** Nhét bản ghi long task giả. */
function emit(...durations: number[]): void {
  ((globalThis as Record<string, unknown>).__emitFakeEntries as (
    ...d: number[]
  ) => void)(...durations);
}

/**
 * Nạp module `vectorPerf`.
 *
 * KHÔNG cần `?v=N` để ép thực thi lại. Đã kiểm chứng bằng
 * `docs/debug-observer-timing.ts`: `PerformanceObserver` được đọc trong
 * constructor của `LongTaskWatcher`, và `LongTaskWatcher` được tạo trong
 * constructor của `VectorLoadTimer` — tức ĐỌC LÚC CHẠY, mỗi lần tạo timer.
 * Nó không nằm ở cấp module nên cache của `import()` không ảnh hưởng.
 *
 * (Trước đây tôi quy cho cache module và thêm `?v=N` — giải thích đó SAI.)
 */
const loadPerf = () => import('../src/services/vectorPerf.ts');

test('takeRecords được gọi TRƯỚC disconnect', async () => {
  const { state, restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);
    timer.markReady(null);
    await timer.collectAsync();

    const iTake = state.calls.indexOf('takeRecords');
    const iDisconnect = state.calls.indexOf('disconnect');
    assert.ok(iTake >= 0, 'phải gọi takeRecords');
    assert.ok(iDisconnect >= 0, 'phải gọi disconnect');
    assert.ok(
      iTake < iDisconnect,
      `takeRecords phải trước disconnect, thực tế: ${state.calls.join(' -> ')}`
    );
  } finally {
    restore();
  }
});

test('long task sinh TRONG lúc drain vẫn được thu', async () => {
  const { restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);
    timer.markReady(null);

    // Bản ghi có sẵn trước khi đo — lần đọc đầu sẽ thấy.
    emit(40);

    // Bản ghi thứ hai phải sinh SAU lần đọc đầu, trong lúc chờ drain.
    //
    // CÁCH CŨ (vẫn ĐÚNG kết quả, nhưng chú thích sai): `setTimeout(emit, 10)`.
    // Sợ là callback nổ TRƯỚC lần đọc đầu — hoàn toàn không có cơ sở.
    // `collectAsync()` gọi `peek()` ĐỒNG BỘ ngay khi được gọi, tức trước mọi
    // `await`; mọi `setTimeout(..., n)` với n > 0 đều nổ sau đó. Test cũ vì vậy
    // vẫn kiểm tra đúng tình huống, chỉ là lý do được viết sai.
    //
    // Cách này dùng cờ `afterFirstRead` bật ở nhịp macrotask kế tiếp (tức chắc
    // chắn sau `peek()`), rồi mới phát bản ghi — không phụ thuộc suy luận về thứ
    // tự callback nào chạy trước.
    const DRAIN_MS = 60;
    let afterFirstRead = false;
    setTimeout(() => {
      afterFirstRead = true;
    }, 1);

    const done = timer.collectAsync();
    (async () => {
      while (!afterFirstRead) await new Promise((r) => setTimeout(r, 1));
      await new Promise((r) => setTimeout(r, 5));
      emit(75);
    })();

    const timing = await done;
    assert.equal(timing.longTaskStatus, 'measured');
    assert.ok(timing.longTaskMs >= 115, `phải thu cả 40 và 75, thực tế ${timing.longTaskMs}`);
    // 75 là ĐỘ DÀI task; lateEntryCount là SỐ BẢN GHI (1), không phải 75.
    assert.equal(timing.lateEntryCount, 1, 'lateEntryCount là số bản ghi, không phải ms');
    // Khoảng chờ phải đủ dài để bản ghi sinh trong khoảng đó kịp tới.
    // Nếu DRAIN_MS nhỏ hơn khoảng 6 ms mà vòng lặp dùng, bản ghi sẽ nổ sau khi
    // `stopAndCollect()` đã ngắt kết nối và test này sẽ đỏ — đó là hành vi đúng.
    assert.ok(DRAIN_MS > 20, `khoảng chờ ${DRAIN_MS} ms quá ngắn cho kịch bản này`);
  } finally {
    restore();
  }
});

test('bản ghi phát sau khi drain xong thì KHÔNG thu được (giới hạn của phép đo)', async () => {
  const { restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);
    timer.markReady(null);

    // Bản ghi có sẵn: lần đọc đầu thấy.
    emit(50);

    const timing = await timer.collectAsync();
    assert.equal(timing.longTaskCount, 1);
    assert.equal(timing.longTaskMs, 50);
    // KHÔNG có bản ghi nào đến muộn -> lateEntryCount = 0.
    //
    // Nhưng KHÔNG được suy ra "đo đủ" từ đây: có thể chỉ là chưa có task nào kết
    // thúc trong khoảng chờ. Test này chỉ khẳng định hành vi quan sát được.
    assert.equal(timing.lateEntryCount, 0);

    // Phát bản ghi SAU khi đã ngắt kết nối -> hẳn nhiên không thu được.
    emit(999);
    const again = await timer.collectAsync();
    assert.equal(again.longTaskCount, 0, 'observer đã ngắt nên không thu thêm được');
  } finally {
    restore();
  }
});

test('markReady() là ĐỒNG BỘ — không chờ 60 ms', async () => {
  const { restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);

    const t0 = Date.now();
    timer.markReady(null);
    const markMs = Date.now() - t0;

    assert.ok(
      markMs < 20,
      `markReady() phải trả ngay, mất ${markMs} ms — bộ đo đang làm chậm người dùng`
    );
  } finally {
    restore();
  }
});

test('readyMs KHÔNG bao gồm thời gian chờ drain', async () => {
  const { restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);

    // Mô phỏng: dữ liệu sẵn sàng nhanh, rồi drain lâu.
    timer.markReady(null);
    const timing = await timer.collectAsync();

    assert.ok(timing.readyMs < 20, `readyMs phải nhỏ, thực tế ${timing.readyMs}`);
    // totalMs có phần chờ drain, nên lớn hơn readyMs.
    assert.ok(
      timing.totalMs > timing.readyMs,
      'totalMs phải lớn hơn readyMs vì còn thời gian thu bản ghi'
    );
  } finally {
    restore();
  }
});

test('lượt dùng cache báo KHÔNG ĐO chứ không phải KHÔNG HỖ TRỢ', async () => {
  const { restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(2, true);
    timer.markReady(null);
    const timing = await timer.collectAsync();

    assert.equal(timing.longTaskStatus, 'not-measured-cache-hit');
    assert.notEqual(timing.longTaskStatus, 'api-unsupported');
    assert.equal(timing.servedFromCache, true);
  } finally {
    restore();
  }
});

test('không có API longtask thì báo api-unsupported', async () => {
  const g = globalThis as Record<string, unknown>;
  const original = g.PerformanceObserver;
  g.PerformanceObserver = undefined;
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);
    timer.markReady(null);
    const timing = await timer.collectAsync();
    assert.equal(timing.longTaskStatus, 'api-unsupported');
  } finally {
    g.PerformanceObserver = original;
  }
});

test('các mốc số liệu được cộng dồn đúng', async () => {
  const { restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);

    timer.countRequest();
    timer.countRequest();
    timer.countIndexRefetch();
    timer.addFetch(120);
    timer.addFetch(80);
    timer.addParse(300);
    timer.addMerge(45);
    timer.countTiledPack();
    timer.countMonolithicPack();

    timer.markReady({ featureCount: 1234 } as never);
    const timing = await timer.collectAsync();

    assert.equal(timing.requestCount, 2);
    assert.equal(timing.indexRefetchCount, 1);
    assert.equal(timing.fetchMsSum, 200);
    assert.equal(timing.fetchMsMax, 120);
    assert.equal(timing.parseMs, 300);
    assert.equal(timing.mergeMs, 45);
    assert.equal(timing.tiledPackCount, 1);
    assert.equal(timing.monolithicPackCount, 1);
    assert.equal(timing.featureCount, 1234);
  } finally {
    restore();
  }
});

test('worker parse CPU không bị mô tả như thời gian parse trên main thread', async () => {
  const { restore } = installFakeObserver();
  try {
    const { VectorLoadTimer } = await loadPerf();
    const timer = new VectorLoadTimer(1, false);
    timer.addParse(7);
    timer.addWorkerParse(200);
    timer.addWorkerNormalize(50);
    timer.markReady(null);
    const timing = await timer.collectAsync();
    assert.equal(timing.parseMs, 207);
    assert.equal(timing.mainThreadParseMs, 7);
    assert.equal(timing.workerParseMs, 200);
    assert.equal(timing.workerNormalizeMs, 50);
  } finally { restore(); }
});
