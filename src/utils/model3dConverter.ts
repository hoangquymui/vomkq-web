import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const DB_NAME = 'VomkqTacticalAssetsDB';
const DB_VERSION = 1;
const STORE_MODELS = 'custom_models';
const STORE_PHOTOS = 'custom_photos';

// In-memory URL cache for active blob URLs
const modelBlobUrlCache = new Map<string, string>();
const photoBlobUrlCache = new Map<string, string>();

/**
 * Mở kết nối IndexedDB an toàn cho việc lưu trữ file mô hình 3D và ảnh thực tế
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB không khả dụng trên môi trường này'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Chuyển đổi file mô hình 3D FBX của người dùng sang nhị phân GLB tương thích Cesium WebGL
 */
export async function convertFbxToGlb(fbxData: ArrayBuffer | Uint8Array): Promise<Blob> {
  const buffer: ArrayBuffer =
    fbxData instanceof ArrayBuffer
      ? fbxData
      : (fbxData.buffer.slice(fbxData.byteOffset, fbxData.byteOffset + fbxData.byteLength) as ArrayBuffer);
  const loader = new FBXLoader();
  const scene = loader.parse(buffer, '');

  // Tối ưu hóa materials cho Cesium WebGL
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => ensureStandardMaterial(m));
        } else {
          mesh.material = ensureStandardMaterial(mesh.material);
        }
      }
    }
  });

  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
      (gltf) => {
        const glbBlob = new Blob([gltf as ArrayBuffer], { type: 'model/gltf-binary' });
        resolve(glbBlob);
      },
      (error) => {
        console.error('[FBX to GLB] Lỗi chuyển đổi:', error);
        reject(error);
      },
      { binary: true }
    );
  });
}

function ensureStandardMaterial(mat: THREE.Material): THREE.Material {
  if (mat instanceof THREE.MeshStandardMaterial) return mat;
  const standard = new THREE.MeshStandardMaterial({
    name: mat.name,
    roughness: 0.6,
    metalness: 0.2,
  });
  if ('color' in mat && (mat as { color?: THREE.Color }).color) {
    standard.color.copy((mat as { color: THREE.Color }).color);
  }
  if ('map' in mat && (mat as { map?: THREE.Texture }).map) {
    standard.map = (mat as { map: THREE.Texture }).map;
  }
  return standard;
}

/**
 * Xử lý tải file mô hình 3D (.fbx, .glb, .gltf) do người dùng đưa vào
 */
export async function processUploaded3DModel(file: File): Promise<{
  blob: Blob;
  blobUrl: string;
  fileName: string;
}> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'fbx') {
    const arrayBuffer = await file.arrayBuffer();
    const glbBlob = await convertFbxToGlb(arrayBuffer);
    const blobUrl = URL.createObjectURL(glbBlob);
    return { blob: glbBlob, blobUrl, fileName: file.name };
  } else if (extension === 'glb' || extension === 'gltf') {
    const blobUrl = URL.createObjectURL(file);
    return { blob: file, blobUrl, fileName: file.name };
  } else {
    throw new Error(`Định dạng .${extension} không được hỗ trợ. Vui lòng chọn file .fbx, .glb hoặc .gltf.`);
  }
}

/**
 * Lưu mô hình 3D tùy chỉnh vào IndexedDB theo ID khí tài
 */
export async function saveCustomModel(
  assetId: string,
  blob: Blob,
  fileName: string
): Promise<string> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MODELS, 'readwrite');
    const store = tx.objectStore(STORE_MODELS);
    store.put({ id: assetId, blob, fileName, updatedAt: Date.now() });

    tx.oncomplete = () => {
      // Hủy URL cũ nếu có
      if (modelBlobUrlCache.has(assetId)) {
        URL.revokeObjectURL(modelBlobUrlCache.get(assetId)!);
      }
      const newUrl = URL.createObjectURL(blob);
      modelBlobUrlCache.set(assetId, newUrl);
      resolve(newUrl);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Lấy URL của mô hình 3D tùy chỉnh từ IndexedDB
 */
export async function getCustomModelUrl(assetId: string): Promise<string | null> {
  if (modelBlobUrlCache.has(assetId)) {
    return modelBlobUrlCache.get(assetId)!;
  }

  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_MODELS, 'readonly');
      const store = tx.objectStore(STORE_MODELS);
      const req = store.get(assetId);

      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          const url = URL.createObjectURL(req.result.blob);
          modelBlobUrlCache.set(assetId, url);
          resolve(url);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Xóa mô hình 3D tùy chỉnh khỏi IndexedDB
 */
export async function removeCustomModel(assetId: string): Promise<void> {
  if (modelBlobUrlCache.has(assetId)) {
    URL.revokeObjectURL(modelBlobUrlCache.get(assetId)!);
    modelBlobUrlCache.delete(assetId);
  }

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MODELS, 'readwrite');
    tx.objectStore(STORE_MODELS).delete(assetId);
  } catch {
    // ignore
  }
}

/**
 * Lưu ảnh thực tế tùy chỉnh vào IndexedDB
 */
export async function saveCustomPhoto(
  assetId: string,
  file: File | Blob,
  fileName: string
): Promise<string> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PHOTOS, 'readwrite');
    const store = tx.objectStore(STORE_PHOTOS);
    store.put({ id: assetId, blob: file, fileName, updatedAt: Date.now() });

    tx.oncomplete = () => {
      if (photoBlobUrlCache.has(assetId)) {
        URL.revokeObjectURL(photoBlobUrlCache.get(assetId)!);
      }
      const newUrl = URL.createObjectURL(file);
      photoBlobUrlCache.set(assetId, newUrl);
      resolve(newUrl);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Lấy URL ảnh thực tế tùy chỉnh từ IndexedDB
 */
export async function getCustomPhotoUrl(assetId: string): Promise<string | null> {
  if (photoBlobUrlCache.has(assetId)) {
    return photoBlobUrlCache.get(assetId)!;
  }

  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PHOTOS, 'readonly');
      const store = tx.objectStore(STORE_PHOTOS);
      const req = store.get(assetId);

      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          const url = URL.createObjectURL(req.result.blob);
          photoBlobUrlCache.set(assetId, url);
          resolve(url);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Xóa ảnh thực tế tùy chỉnh khỏi IndexedDB
 */
export async function removeCustomPhoto(assetId: string): Promise<void> {
  if (photoBlobUrlCache.has(assetId)) {
    URL.revokeObjectURL(photoBlobUrlCache.get(assetId)!);
    photoBlobUrlCache.delete(assetId);
  }

  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_PHOTOS, 'readwrite');
    tx.objectStore(STORE_PHOTOS).delete(assetId);
  } catch {
    // ignore
  }
}
