import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chạy một script con qua node
function runChildScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(__dirname, scriptName);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script ${scriptName} kết thúc với mã lỗi: ${code}`));
    });

    child.on('error', reject);
  });
}

async function main() {
  const userArgs = process.argv.slice(2);

  console.log('========================================================================');
  console.log('🚀 BỘ TẢI TRỌN GÓI BẢN ĐỒ CHIẾN THUẬT: ẢNH VỆ TINH + ĐỊA HÌNH 3D NÉT CAO');
  console.log('========================================================================\n');

  console.log('📦 GIAI ĐOẠN 1: TẢI ẢNH VỆ TINH ĐỘ NÉT CAO (ESRI SATELLITE ZOOM 9-13)...');
  console.log('------------------------------------------------------------------------');
  await runChildScript('download-tactical-map.js', userArgs);

  console.log('\n------------------------------------------------------------------------');
  console.log('🏔️ GIAI ĐOẠN 2: TẢI ĐỊA HÌNH 3D LỒI LÕM CHUẨN ONLINE (LEVEL 8-13 NORMALS)...');
  console.log('------------------------------------------------------------------------');
  await runChildScript('download-tactical-terrain.js', userArgs);

  console.log('\n========================================================================');
  console.log('🎉 HOÀN TẤT 100%! CẢ ẢNH VỆ TINH VÀ ĐỊA HÌNH 3D ĐÃ SẴN SÀNG NGOẠI TUYẾN!');
  console.log('========================================================================');
}

main().catch((err) => {
  console.error('\n❌ Lỗi tiến trình tải:', err.message);
  process.exit(1);
});
