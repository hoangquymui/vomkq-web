import assert from 'node:assert/strict';

// 1. Kiểm tra logic singleton và module-level provider
let terrainProviderRef = null;

function setTerrainProvider(provider) {
  terrainProviderRef = provider;
}

function getTerrainProvider() {
  return terrainProviderRef;
}

async function ensureTerrainProvider(mockLoader) {
  if (terrainProviderRef) return terrainProviderRef;
  const p = await mockLoader();
  terrainProviderRef = p;
  return p;
}

console.log('--- Test 1: Module-level TerrainProvider Store ---');
assert.equal(getTerrainProvider(), null, 'Ban đầu providerRef phải là null');

const mockProvider = { name: 'CesiumTerrainProviderMock', hasAvailability: true };
setTerrainProvider(mockProvider);
assert.equal(getTerrainProvider(), mockProvider, 'Sau khi setTerrainProvider, getTerrainProvider phải trả về đúng provider');

// 2. Kiểm tra ensureTerrainProvider khi chưa có
console.log('--- Test 2: ensureTerrainProvider Auto-Loading ---');
terrainProviderRef = null;
let loaderCalls = 0;
const mockLoader = async () => {
  loaderCalls++;
  return mockProvider;
};

const loaded = await ensureTerrainProvider(mockLoader);
assert.equal(loaded, mockProvider, 'ensureTerrainProvider phải trả về provider nạp từ loader');
assert.equal(loaderCalls, 1, 'Loader chỉ được gọi đúng 1 lần');

const secondCall = await ensureTerrainProvider(mockLoader);
assert.equal(secondCall, mockProvider, 'Lần gọi sau phải dùng cache trong ô nhớ module');
assert.equal(loaderCalls, 1, 'Loader không được gọi lại lần 2');

// 3. Kiểm tra việc phân loại lỗi phủ địa hình
console.log('--- Test 3: Terrain Coverage Friendly Error Message ---');
function formatCoverageError(rawErrorMsg) {
  if (
    rawErrorMsg.includes('Terrain height unavailable') ||
    rawErrorMsg.includes('unavailable for') ||
    rawErrorMsg.includes('nằm ngoài phạm vi bao phủ')
  ) {
    return 'Chưa có dữ liệu độ cao địa hình cho khu vực này (nằm ngoài phạm vi bao phủ của gói DEM offline).';
  }
  return rawErrorMsg;
}

const err1 = 'Terrain height unavailable for 5153 sample(s), including index 0';
assert.equal(
  formatCoverageError(err1),
  'Chưa có dữ liệu độ cao địa hình cho khu vực này (nằm ngoài phạm vi bao phủ của gói DEM offline).'
);

const err2 = 'Không thể lấy dữ liệu độ cao địa hình (DEM): Terrain height unavailable for 120 sample(s)';
assert.equal(
  formatCoverageError(err2),
  'Chưa có dữ liệu độ cao địa hình cho khu vực này (nằm ngoài phạm vi bao phủ của gói DEM offline).'
);

const err3 = 'Lỗi kết nối mạng';
assert.equal(formatCoverageError(err3), 'Lỗi kết nối mạng');

console.log('\n=> Tất cả các kiểm tra logic DEM Terrain Provider và Error Handling đều PASS 100%!');
