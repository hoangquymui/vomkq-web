import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const outDir = path.resolve('public/models/equipments');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function exportGlb(scene, filename) {
  const exporter = new GLTFExporter();
  exporter.parse(
    scene,
    (gltf) => {
      const buffer = Buffer.from(gltf);
      const filePath = path.join(outDir, filename);
      fs.writeFileSync(filePath, buffer);
      console.log(`[OK] Generated: ${filename} (${buffer.length} bytes)`);
    },
    (err) => {
      console.error(`[ERROR] Failed to export ${filename}:`, err);
    },
    { binary: true }
  );
}

// -------------------------------------------------------------
// 1. RADAR 3D MODEL (Đài Radar Cảnh Giới 3D với anten chảo và xe kéo)
// -------------------------------------------------------------
function buildRadarScene() {
  const scene = new THREE.Scene();
  scene.name = 'Radar3D';

  const oliveMat = new THREE.MeshStandardMaterial({ color: 0x3f4f34, roughness: 0.7 });
  const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x242d20, roughness: 0.5, metalness: 0.3 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4, metalness: 0.6 });
  const cyanMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.3, metalness: 0.4, emissive: 0x083344 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });

  // Xe kéo/Thân bệ (Chassis)
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 2.6), oliveMat);
  chassis.position.y = 1.0;
  scene.add(chassis);

  // Cabin xe
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2.5), oliveMat);
  cabin.position.set(2, 1.6, 0);
  scene.add(cabin);

  // Kính chắn gió cabin
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 2.2), darkMetalMat);
  windshield.position.set(3.01, 1.7, 0);
  scene.add(windshield);

  // Bánh xe (6 bánh)
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 16);
  wheelGeo.rotateX(Math.PI / 2);
  [-1.8, 0, 1.8].forEach((x) => {
    [-1.4, 1.4].forEach((z) => {
      const wheel = new THREE.Mesh(wheelGeo, rubberMat);
      wheel.position.set(x, 0.55, z);
      scene.add(wheel);
    });
  });

  // Chân chống thuỷ lực mở rộng
  [-2.2, 2.2].forEach((x) => {
    [-1.5, 1.5].forEach((z) => {
      const outrigger = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.2, 8), metalMat);
      outrigger.position.set(x, 0.6, z);
      scene.add(outrigger);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 8), darkMetalMat);
      pad.position.set(x, 0.04, z);
      scene.add(pad);
    });
  });

  // Trục đỡ mâm xoay radar (Pedestal)
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 1.0, 16), darkMetalMat);
  pedestal.position.set(-1.0, 2.1, 0);
  scene.add(pedestal);

  // Nhóm anten có thể xoay
  const antennaGroup = new THREE.Group();
  antennaGroup.name = 'RadarAntenna';
  antennaGroup.position.set(-1.0, 2.6, 0);

  // Cổ xoay
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 16), metalMat);
  antennaGroup.add(rotor);

  // Khung giá đỡ anten
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 1.6), metalMat);
  frame.position.set(0, 0.8, 0);
  antennaGroup.add(frame);

  // Chảo phản xạ Parabol hoặc Mảng pha 3D (Reflector)
  const dishShape = new THREE.BoxGeometry(0.2, 2.8, 5.0);
  const dish = new THREE.Mesh(dishShape, cyanMat);
  dish.position.set(0, 2.2, 0);
  dish.rotation.z = -0.15; // Ngửa lên nhẹ 8.5 độ
  antennaGroup.add(dish);

  // Các thanh chấn lưu / gân cường lực mặt sau chảo
  const ribGeo = new THREE.BoxGeometry(0.5, 0.1, 4.8);
  for (let i = -1; i <= 1; i++) {
    const rib = new THREE.Mesh(ribGeo, darkMetalMat);
    rib.position.set(-0.25, 2.2 + i * 0.9, 0);
    antennaGroup.add(rib);
  }

  // Cần tiếp sóng (Feed horn boom)
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), metalMat);
  boom.rotation.z = Math.PI / 2 - 0.15;
  boom.position.set(0.8, 2.2, 0);
  antennaGroup.add(boom);

  // Đầu thu sóng (Horn)
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 8), darkMetalMat);
  horn.rotation.z = -Math.PI / 2;
  horn.position.set(1.6, 2.3, 0);
  antennaGroup.add(horn);

  scene.add(antennaGroup);
  return scene;
}

// -------------------------------------------------------------
// 2. SAM MISSILE LAUNCHER (Xe Bệ Phóng Tên Lửa Phòng Không - TEL)
// -------------------------------------------------------------
function buildSamScene() {
  const scene = new THREE.Scene();
  scene.name = 'SamLauncher';

  const camoMat = new THREE.MeshStandardMaterial({ color: 0x2e3d23, roughness: 0.75 });
  const missileMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.4 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 }); // Chóp tên lửa đỏ
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.5 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });

  // Thân xe bệ phóng bánh xích hạng nặng
  const hull = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.3, 3.2), camoMat);
  hull.position.y = 1.0;
  scene.add(hull);

  // Dải xích bọc 2 bên
  [-1.6, 1.6].forEach((z) => {
    const track = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.8, 0.5), trackMat);
    track.position.set(0, 0.6, z);
    scene.add(track);

    // Bánh chịu nặng
    for (let x = -2.8; x <= 2.8; x += 1.1) {
      const roadWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.52, 12), metalMat);
      roadWheel.rotateX(Math.PI / 2);
      roadWheel.position.set(x, 0.48, z);
      scene.add(roadWheel);
    }
  });

  // Mâm xoay bệ phóng tên lửa
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.6, 16), camoMat);
  turret.position.set(-0.8, 1.9, 0);
  scene.add(turret);

  // Bệ nâng tên lửa nghiêng 50 độ
  const launcherGroup = new THREE.Group();
  launcherGroup.position.set(-0.8, 2.2, 0);
  launcherGroup.rotation.z = -0.85; // Nghiêng phóng 50 độ

  // Khung giàn phóng
  const rack = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.4, 2.4), metalMat);
  rack.position.set(1.5, 0.3, 0);
  launcherGroup.add(rack);

  // 4 Ống phóng / 4 Quả tên lửa
  const tubeOffsets = [
    [-0.75, 0.8],
    [0.75, 0.8],
    [-0.75, 1.5],
    [0.75, 1.5],
  ];

  const tubeGeo = new THREE.CylinderGeometry(0.32, 0.34, 5.8, 16);
  tubeGeo.rotateZ(Math.PI / 2);

  tubeOffsets.forEach(([z, y]) => {
    // Ống phóng kim loại
    const tube = new THREE.Mesh(tubeGeo, camoMat);
    tube.position.set(1.6, y, z);
    launcherGroup.add(tube);

    // Đai siết ống phóng
    [-0.6, 1.6, 3.6].forEach((xOffset) => {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.15, 16), metalMat);
      ring.rotateZ(Math.PI / 2);
      ring.position.set(xOffset, y, z);
      launcherGroup.add(ring);
    });

    // Đầu đạn tên lửa thò ra
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 16), noseMat);
    nose.rotateZ(-Math.PI / 2);
    nose.position.set(4.7, y, z);
    launcherGroup.add(nose);
  });

  // Xi-lanh thuỷ lực nâng giàn phóng
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8), metalMat);
  piston.position.set(0.2, 1.8, 0);
  piston.rotation.z = 0.4;
  scene.add(piston);

  scene.add(launcherGroup);
  return scene;
}

// -------------------------------------------------------------
// 3. COMMAND POST (Xe / Trạm Sở Chỉ Huy Tác Chiến C2)
// -------------------------------------------------------------
function buildCommandPostScene() {
  const scene = new THREE.Scene();
  scene.name = 'CommandPost';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.6 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.7 });

  // Khối thân xe container chỉ huy tác chiến
  const box = new THREE.Mesh(new THREE.BoxGeometry(6.5, 2.4, 2.8), bodyMat);
  box.position.y = 1.6;
  scene.add(box);

  // Cabin điều khiển phía trước
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 2.7), darkMat);
  cab.position.set(2.8, 1.3, 0);
  scene.add(cab);

  // Bánh xe hạng nặng
  const wheelGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.45, 16);
  wheelGeo.rotateX(Math.PI / 2);
  [-2.2, -0.7, 0.8, 2.4].forEach((x) => {
    [-1.5, 1.5].forEach((z) => {
      const wheel = new THREE.Mesh(wheelGeo, darkMat);
      wheel.position.set(x, 0.58, z);
      scene.add(wheel);
    });
  });

  // Chảo thông tin liên lạc vệ tinh (SATCOM) trên nóc
  const satDish = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metalMat);
  satDish.rotation.x = Math.PI;
  satDish.rotation.z = -0.4;
  satDish.position.set(-1.2, 3.2, 0.5);
  scene.add(satDish);

  // Tháp anten vô tuyến viễn thông C2
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 4.0, 8), metalMat);
  mast.position.set(-2.4, 4.2, -0.8);
  scene.add(mast);

  // Vòng phát sóng trên đỉnh anten
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 16), accentMat);
  ring.position.set(-2.4, 6.0, -0.8);
  scene.add(ring);

  // Máy điều hoà / Bộ cấp nguồn dã ngoại gắn sau thùng xe
  const gen = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 2.0), darkMat);
  gen.position.set(-3.5, 1.5, 0);
  scene.add(gen);

  return scene;
}

// -------------------------------------------------------------
// 4. AAA GUN (Khẩu Đội Pháo Phòng Không Cơ Động)
// -------------------------------------------------------------
function buildAaaScene() {
  const scene = new THREE.Scene();
  scene.name = 'AaaGun';

  const camoMat = new THREE.MeshStandardMaterial({ color: 0x3f4f34, roughness: 0.7 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.8 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4, metalness: 0.5 });

  // Xe bọc thép bệ pháo
  const hull = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.1, 2.8), camoMat);
  hull.position.y = 0.9;
  scene.add(hull);

  // Tháp pháo tròn
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 1.0, 16), camoMat);
  turret.position.set(0, 1.8, 0);
  scene.add(turret);

  // Radar ngắm bắn trên nóc tháp pháo
  const radarDome = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), metalMat);
  radarDome.position.set(-0.6, 2.5, 0);
  scene.add(radarDome);

  // Giá pháo nghiêng 40 độ
  const gunGroup = new THREE.Group();
  gunGroup.position.set(0.4, 2.0, 0);
  gunGroup.rotation.z = -0.7; // Ngước nòng 40 độ

  // 4 Nòng pháo phòng không (Quad-barrel 23mm / 37mm)
  const barrelOffsets = [
    [-0.35, -0.15],
    [0.35, -0.15],
    [-0.35, 0.15],
    [0.35, 0.15],
  ];

  barrelOffsets.forEach(([z, y]) => {
    // Ống pháo dài
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.8, 12), gunMat);
    barrel.rotateZ(Math.PI / 2);
    barrel.position.set(1.9, y, z);
    gunGroup.add(barrel);

    // Loa giảm giật / chụp đầu nòng
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 0.35, 12), gunMat);
    brake.rotateZ(Math.PI / 2);
    brake.position.set(3.8, y, z);
    gunGroup.add(brake);
  });

  scene.add(gunGroup);
  return scene;
}

// -------------------------------------------------------------
// 5. ESM / PASSIVE SENSOR (Đài Trinh Sát Thụ Động / Tháp Anten)
// -------------------------------------------------------------
function buildEsmScene() {
  const scene = new THREE.Scene();
  scene.name = 'EsmStation';

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.7 });
  const radomeMat = new THREE.MeshStandardMaterial({ color: 0xc084fc, roughness: 0.3, metalness: 0.4 }); // Ánh tím ESM

  // Container trạm thu thập tín hiệu
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.0, 2.4), bodyMat);
  cabin.position.y = 1.0;
  scene.add(cabin);

  // Tháp anten dạng cột giàn không gian
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.5, 6.0, 6), mastMat);
  tower.position.set(0, 4.8, 0);
  scene.add(tower);

  // Các đĩa cầu Radome tiếp nhận sóng đa hướng
  [4.0, 5.5, 7.0].forEach((y, idx) => {
    const radome = new THREE.Mesh(new THREE.SphereGeometry(0.45 - idx * 0.08, 16, 12), radomeMat);
    radome.position.set(0, y, 0);
    scene.add(radome);

    // Vành anten chấn tử ngang
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.8 - idx * 0.3, 0.04, 0.04), mastMat);
    cross.position.set(0, y, 0);
    scene.add(cross);
    const cross2 = cross.clone();
    cross2.rotation.y = Math.PI / 2;
    scene.add(cross2);
  });

  // Chóp thu lôi trên đỉnh tháp
  const needle = new THREE.Mesh(new THREE.ConeGeometry(0.04, 1.2, 8), mastMat);
  needle.position.set(0, 8.2, 0);
  scene.add(needle);

  return scene;
}

// -------------------------------------------------------------
// CHẠY VÀ XUẤT CÁC FILE GLB
// -------------------------------------------------------------
console.log('Building tactical military 3D models...');
exportGlb(buildRadarScene(), 'radar_3d.glb');
exportGlb(buildSamScene(), 'sam_launcher.glb');
exportGlb(buildCommandPostScene(), 'command_post.glb');
exportGlb(buildAaaScene(), 'aaa_gun.glb');
exportGlb(buildEsmScene(), 'esm_station.glb');
