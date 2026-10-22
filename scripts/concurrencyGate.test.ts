/**
 * KIỂM THỬ CỔNG GIỚI HẠN
 *
 * Mục đích: chặn lại lỗi đã xảy ra — giới hạn 2 nhưng vẫn cho 3 tác vụ chạy cùng
 * lúc. Nguyên nhân là `active` bị giảm khi trao lượt cho người chờ kế tiếp mà
 * không tăng lại, nên sau vài vòng `active` âm và cổng mở ra vô hạn.
 *
 * Chạy: npx tsx --test scripts/concurrencyGate.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createConcurrencyGate } from '../src/utils/concurrencyGate.ts';

/** Chờ `n` microtask để mọi promise đã resolve kịp chạy. */
const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

test('giới hạn 2 nhưng KHÔNG BAO GIỜ cho 3 tác vụ chạy cùng lúc', async () => {
  const gate = createConcurrencyGate(2);

  let running = 0;
  let peak = 0;

  const task = async () => {
    const release = await gate.acquire();
    running++;
    peak = Math.max(peak, running);
    // Giữ chỗ một lúc để tác vụ sau có cơ hội chen vào — đây là chỗ lỗi cũ lộ.
    await new Promise((r) => setTimeout(r, 5));
    running--;
    release();
  };

  await Promise.all(Array.from({ length: 30 }, task));

  assert.equal(peak, 2, `tối đa ${peak} tác vụ chạy cùng lúc, phải bằng 2`);
  assert.equal(gate.activeCount(), 0, 'sau khi xong, không còn ai giữ chỗ');
  assert.equal(gate.queuedCount(), 0, 'hàng đợi phải trống');
});

test('số chỗ đang chiếm không bao giờ âm hay vượt giới hạn', async () => {
  const gate = createConcurrencyGate(3);
  const samples: number[] = [];

  const task = async () => {
    const release = await gate.acquire();
    samples.push(gate.activeCount());
    await new Promise((r) => setTimeout(r, 2));
    release();
    samples.push(gate.activeCount());
  };

  await Promise.all(Array.from({ length: 25 }, task));

  for (const n of samples) {
    assert.ok(n >= 0, `activeCount âm: ${n}`);
    assert.ok(n <= 3, `activeCount vượt giới hạn: ${n}`);
  }
  assert.equal(gate.activeCount(), 0);
});

test('trao lượt giữ nguyên số chỗ đang chiếm (không tăng, không giảm)', async () => {
  const gate = createConcurrencyGate(2);

  const r1 = await gate.acquire();
  assert.equal(gate.activeCount(), 1);

  const p2 = gate.acquire();
  assert.equal(gate.activeCount(), 2);

  // Người thứ ba phải phải chờ vì đã đủ 2 lượt.
  let thirdGranted = false;
  const p3 = gate.acquire().then((r) => {
    thirdGranted = true;
    return r;
  });
  await flush();
  assert.equal(thirdGranted, false, 'lượt thứ ba phải chờ');
  assert.equal(gate.queuedCount(), 1);

  // Người 1 ra -> lượt nhường cho người 3. Số chỗ vẫn phải là 2, KHÔNG phải 1
  // (giảm rồi tăng) và cũng không phải 3.
  r1();
  await flush();
  assert.equal(thirdGranted, true, 'người thứ ba phải vào được');
  assert.equal(
    gate.activeCount(),
    2,
    `sau khi trao lượt, activeCount phải vẫn là 2, thực tế ${gate.activeCount()}`
  );

  const r2 = await p2;
  const r3 = await p3;
  r2();
  await flush();
  // Sau khi 2 đi mà 1 còn, số chỗ vẫn phải là 1.
  assert.equal(gate.activeCount(), 1);
  r3();
  assert.equal(gate.activeCount(), 0);
});

test('gọi release() hai lần không làm hỏng cổng', async () => {
  const gate = createConcurrencyGate(2);
  const r1 = await gate.acquire();
  r1();
  r1(); // gọi lại lần nữa
  assert.equal(gate.activeCount(), 0, 'phải giữ 0, không thành -1');

  // Cổng vẫn phải dùng được sau đó.
  const r2 = await gate.acquire();
  assert.equal(gate.activeCount(), 1);
  r2();
  assert.equal(gate.activeCount(), 0);
});

test('release trong finally khi tác vụ ném lỗi vẫn trả lượt', async () => {
  const gate = createConcurrencyGate(1);
  const results: string[] = [];

  const task = async (fail: boolean) => {
    const release = await gate.acquire();
    try {
      await new Promise((r) => setTimeout(r, 1));
      if (fail) throw new Error('hỏng');
      results.push('ok');
    } catch {
      results.push('loi');
    } finally {
      release();
    }
  };

  await Promise.all([task(true), task(false), task(false), task(false)]);

  assert.equal(results.length, 4);
  assert.equal(gate.activeCount(), 0, 'tác vụ lỗi cũng phải trả lượt');
});

test('từ chối giới hạn không hợp lệ', () => {
  assert.throws(() => createConcurrencyGate(0));
  assert.throws(() => createConcurrencyGate(-1));
  assert.throws(() => createConcurrencyGate(1.5));
});

test('giới hạn bằng 1 thì tuyệt đối tuần tự', async () => {
  const gate = createConcurrencyGate(1);
  const order: number[] = [];

  for (let i = 0; i < 6; i++) {
    const release = await gate.acquire();
    order.push(i);
    await new Promise((r) => setTimeout(r, 1));
    release();
  }

  assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
});

/**
 * TEST BẮT ĐƯỢC LỖI GỐC — nhóm tác vụ đến theo lô, xen kẽ với việc trả lượt.
 *
 * ĐÂY LÀ MẤT CHỐT. Phiên bản cũ KHÔNG sai khi 30 tác vụ xếp hàng ngay từ đầu
 * (tất cả gọi `acquire()` trước khi có tác vụ nào trả lượt). Lỗi chỉ lộ ra khi
 * có tác vụ MỚI đến SAU khi `active` đã âm — tức xen kẽ "tạo tác vụ" và "trả
 * lượt". Test cũ của tôi vô dòng chính vì lý do này.
 *
 * Bản cũ cho tối đa 8 tác vụ chạy cùng lúc (giới hạn 2) và kết thúc với
 * `active = -6`. Xem `docs/demo-old-gate-bug.ts`.
 */
test('nhóm tác vụ đến xen kẽ với trả lượt vẫn giữ đúng giới hạn', async () => {
  const gate = createConcurrencyGate(2);

  let running = 0;
  let peak = 0;

  const runOne = async () => {
    const release = await gate.acquire();
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 3));
    running--;
    release();
  };

  // 20 lô x 6 tác vụ: lô sau chỉ tạo tác vụ sau khi lô trước đã trả lượt hết.
  for (let batch = 0; batch < 20; batch++) {
    await Promise.all(Array.from({ length: 6 }, runOne));
    // Sau mỗi lô, số chỗ bị chiếm phải trở về 0 — không lưu lại chỗ nào cả.
    assert.equal(
      gate.activeCount(),
      0,
      `sau lô ${batch}, activeCount phải là 0, thực tế ${gate.activeCount()}`
    );
  }

  assert.equal(
    peak,
    2,
    `tối đa ${peak} tác vụ chạy cùng lúc, phải bằng 2 (bản cũ cho 8)`
  );
});

/**
 * Bản cũ kết thúc với `active` âm. Đây là hậu quả trực tiếp của việc giảm số
 * đếm mỗi lần trao lượt, và là lý do cổng vỡ dần theo thời gian chạy.
 */
test('số chỗ không bao giờ âm sau nhiều vòng trao lượt', async () => {
  const gate = createConcurrencyGate(2);

  for (let round = 0; round < 30; round++) {
    const releases = await Promise.all([gate.acquire(), gate.acquire()]);
    assert.ok(gate.activeCount() >= 0, `vòng ${round}: active âm (${gate.activeCount()})`);
    for (const release of releases) release();
    assert.equal(gate.activeCount(), 0, `vòng ${round}: phải về 0`);
  }
});

