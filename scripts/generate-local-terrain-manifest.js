import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readLocalTiles(terrainDirectory) {
  const tilesByLevel = new Map();

  for (const levelDirectory of fs.readdirSync(terrainDirectory, { withFileTypes: true })) {
    if (!levelDirectory.isDirectory()) continue;
    if (!/^\d+$/.test(levelDirectory.name)) {
      throw new Error(`Invalid terrain level directory: ${levelDirectory.name}`);
    }

    const level = Number(levelDirectory.name);
    const xCount = 2 ** (level + 1);
    const yCount = 2 ** level;
    if (!Number.isSafeInteger(xCount) || levelDirectory.name !== String(level)) {
      throw new Error(`Invalid terrain level: ${levelDirectory.name}`);
    }

    const tiles = new Set();
    const levelPath = path.join(terrainDirectory, levelDirectory.name);
    for (const xDirectory of fs.readdirSync(levelPath, { withFileTypes: true })) {
      if (!xDirectory.isDirectory()) continue;
      const x = Number(xDirectory.name);
      if (!/^\d+$/.test(xDirectory.name) || xDirectory.name !== String(x) || x >= xCount) {
        throw new Error(`Invalid terrain X directory: ${levelDirectory.name}/${xDirectory.name}`);
      }

      const xPath = path.join(levelPath, xDirectory.name);
      for (const tile of fs.readdirSync(xPath, { withFileTypes: true })) {
        if (!tile.isFile() || !tile.name.endsWith('.terrain')) continue;
        const match = /^(\d+)\.terrain$/.exec(tile.name);
        const y = match ? Number(match[1]) : NaN;
        if (!match || match[1] !== String(y) || y >= yCount) {
          throw new Error(`Invalid terrain tile: ${levelDirectory.name}/${xDirectory.name}/${tile.name}`);
        }
        if (fs.statSync(path.join(xPath, tile.name)).size === 0) {
          throw new Error(`Empty terrain tile: ${levelDirectory.name}/${xDirectory.name}/${tile.name}`);
        }
        tiles.add(`${x}/${y}`);
      }
    }
    if (tiles.size > 0) tilesByLevel.set(level, tiles);
  }

  if (tilesByLevel.size === 0) {
    throw new Error(`No terrain tiles found in ${terrainDirectory}`);
  }
  return tilesByLevel;
}

function buildAvailableRanges(tiles) {
  const rows = new Map();
  for (const tile of tiles) {
    const [x, y] = tile.split('/').map(Number);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
  }

  const ranges = [];
  let previousRow = -2;
  let activeRanges = new Map();
  for (const [y, xs] of [...rows].sort(([a], [b]) => a - b)) {
    xs.sort((a, b) => a - b);
    const runs = [];
    for (const x of xs) {
      const last = runs.at(-1);
      if (last && x === last[1] + 1) last[1] = x;
      else runs.push([x, x]);
    }

    const nextRanges = new Map();
    for (const [startX, endX] of runs) {
      const key = `${startX}/${endX}`;
      let range = activeRanges.get(key);
      if (!range || y !== previousRow + 1) {
        range = { startX, startY: y, endX, endY: y };
        ranges.push(range);
      } else {
        range.endY = y;
      }
      nextRanges.set(key, range);
    }
    previousRow = y;
    activeRanges = nextRanges;
  }
  return ranges;
}

/** Rebuild static TMS availability from local files without changing terrain meshes. */
export function generateLocalTerrainManifest(
  terrainDirectory = path.join(projectDirectory, 'public', 'offline-terrain')
) {
  const layerPath = path.join(terrainDirectory, 'layer.json');
  const layer = JSON.parse(fs.readFileSync(layerPath, 'utf8'));
  if (layer.scheme && layer.scheme !== 'tms') {
    throw new Error(`Local terrain manifest requires TMS tiles, received ${layer.scheme}`);
  }
  if (layer.projection && layer.projection !== 'EPSG:4326') {
    throw new Error(`Local terrain manifest requires EPSG:4326, received ${layer.projection}`);
  }

  const tilesByLevel = readLocalTiles(terrainDirectory);
  const levels = [...tilesByLevel.keys()].sort((a, b) => a - b);
  let excludedTileCount = 0;
  // Cesium assumes every available child has available parents. Keep partially
  // downloaded children on disk, but expose them only when their parent exists.
  for (const level of levels) {
    if (level === 0) continue;
    const parents = tilesByLevel.get(level - 1);
    for (const tile of tilesByLevel.get(level)) {
      const [x, y] = tile.split('/').map(Number);
      if (!parents?.has(`${Math.floor(x / 2)}/${Math.floor(y / 2)}`)) {
        tilesByLevel.get(level).delete(tile);
        excludedTileCount++;
      }
    }
  }

  const availableLevels = levels.filter((level) => tilesByLevel.get(level).size > 0);
  if (availableLevels.length === 0) {
    throw new Error('No terrain tiles have a complete parent chain to level 0');
  }
  const maxZoom = availableLevels.at(-1);
  layer.available = Array.from({ length: maxZoom + 1 }, (_, level) =>
    buildAvailableRanges(tilesByLevel.get(level) ?? new Set())
  );
  layer.maxzoom = maxZoom;
  // Cesium ignores available[] when metadataAvailability exists. Metadata in
  // downloaded meshes describes the global server, so disable it for this pack.
  delete layer.metadataAvailability;
  if (Array.isArray(layer.extensions)) {
    layer.extensions = layer.extensions.filter((extension) => extension !== 'metadata');
  } else if (typeof layer.extensions === 'string') {
    layer.extensions = layer.extensions.split(/[\s,;-]+/).filter(
      (extension) => extension && extension !== 'metadata'
    );
  }

  const temporaryPath = `${layerPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(layer, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, layerPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }

  const tileCount = availableLevels.reduce((count, level) => count + tilesByLevel.get(level).size, 0);
  const rangeCount = layer.available.reduce((count, ranges) => count + ranges.length, 0);
  if (excludedTileCount > 0) {
    console.warn(`Terrain manifest omitted ${excludedTileCount} tiles with missing parents; files remain on disk.`);
  }
  return { tileCount, rangeCount, maxZoom, excludedTileCount };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = generateLocalTerrainManifest(
      process.argv[2] ? path.resolve(process.argv[2]) : undefined
    );
    console.log(`Local terrain manifest: ${result.tileCount} tiles, ${result.rangeCount} ranges, max zoom ${result.maxZoom}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
