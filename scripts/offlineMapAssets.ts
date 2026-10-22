import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface OfflineMapAssets {
  terrain: boolean
  satellite: boolean
  satelliteMaxLevel: number
  terrainMap: boolean
  /**
   * Danh sách tên gói dữ liệu vectơ có sẵn trong public/offline-vector (không kể .geojson).
   * Rỗng = chưa tải gói vectơ nào, ứng dụng sẽ chạy ở chế độ chỉ có ảnh raster.
   */
  vectorRegions: string[]
}

function isNonemptyFile(path: string): boolean {
  try {
    const stat = statSync(path)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

function hasTileAtZoom(root: string, zoom: string, extension: string): boolean {
  try {
    const zoomPath = join(root, zoom)
    for (const x of readdirSync(zoomPath, { withFileTypes: true })) {
      if (!x.isDirectory() || !/^\d+$/.test(x.name)) continue
      const xPath = join(zoomPath, x.name)
      for (const tile of readdirSync(xPath, { withFileTypes: true })) {
        if (tile.isFile() && tile.name.endsWith(extension) && isNonemptyFile(join(xPath, tile.name))) {
          return true
        }
      }
    }
  } catch {
    return false
  }
  return false
}

function findHighestTileZoom(root: string, extension: string): number | null {
  try {
    if (!statSync(root).isDirectory()) return null
    // Download scripts store tiles as {z}/{x}/{y}.{extension}. Check only
    // shallow directories, starting at the highest zoom and stop at a real tile.
    const zoomLevels = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => ({ name: entry.name, value: Number(entry.name) }))
      .filter((entry) => Number.isSafeInteger(entry.value))
      .sort((a, b) => b.value - a.value)

    for (const zoom of zoomLevels) {
      if (hasTileAtZoom(root, zoom.name, extension)) return zoom.value
    }
  } catch {
    return null
  }
  return null
}

function hasTileData(root: string, extension: string): boolean {
  return findHighestTileZoom(root, extension) !== null
}

/**
 * Liệt kê các gói vectơ (file .geojson) trong public/offline-vector.
 * Chỉ đọc tên file ở cấp đầu, không mở/parse nội dung để khỏi tốn thời gian khởi động.
 */
function listVectorPacks(root: string): string[] {
  try {
    if (!statSync(root).isDirectory()) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.geojson') && isNonemptyFile(join(root, entry.name)))
      .map((entry) => entry.name.slice(0, -'.geojson'.length))
      .sort()
  } catch {
    return []
  }
}

function hasSupportedTerrain(root: string): boolean {
  try {
    const metadataPath = join(root, 'layer.json')
    if (!isNonemptyFile(metadataPath)) return false
    const metadata: unknown = JSON.parse(readFileSync(metadataPath, 'utf8'))
    if (!metadata || typeof metadata !== 'object') return false
    const layer = metadata as { format?: unknown; tiles?: unknown }
    if (layer.format !== 'quantized-mesh-1.0' || !Array.isArray(layer.tiles)) return false
    if (!layer.tiles.some((tile) => typeof tile === 'string' && tile.trim().length > 0)) return false
    return isNonemptyFile(join(root, '0', '0', '0.terrain'))
      && isNonemptyFile(join(root, '0', '1', '0.terrain'))
  } catch {
    return false
  }
}

/** Detect the app's offline map packs without recursively traversing tile archives. */
export function getOfflineMapAssets(publicDir: string): OfflineMapAssets {
  const unavailable: OfflineMapAssets = {
    terrain: false,
    satellite: false,
    satelliteMaxLevel: 0,
    terrainMap: false,
    vectorRegions: [],
  }
  if (typeof publicDir !== 'string' || publicDir.length === 0) return unavailable

  const satelliteMaxLevel = findHighestTileZoom(join(publicDir, 'offline-satellite'), '.jpg')
  return {
    terrain: hasSupportedTerrain(join(publicDir, 'offline-terrain')),
    satellite: satelliteMaxLevel !== null,
    satelliteMaxLevel: satelliteMaxLevel ?? 0,
    terrainMap: hasTileData(join(publicDir, 'offline-terrain-map'), '.png'),
    vectorRegions: listVectorPacks(join(publicDir, 'offline-vector')),
  }
}
