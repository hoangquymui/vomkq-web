import * as Cesium from 'cesium';

/**
 * Sample each position at an available DEM level, preserving point order.
 * Sparse offline packs do not have the same maximum level everywhere: choosing
 * the level at the radar alone can turn mountains farther away into missing
 * samples. Missing heights must be retried on parent tiles, never read as sea.
 */
export async function sampleTerrainOptimized(
  terrainProvider: Cesium.TerrainProvider | null,
  _centerLon: number,
  _centerLat: number,
  positions: Cesium.Cartographic[],
  targetLevel: number = 10,
  batchSize: number = 1500
): Promise<number[]> {
  if (positions.length === 0) return [];
  if (!terrainProvider) return positions.map(() => 0);

  const provider = terrainProvider as Cesium.TerrainProvider & {
    availability?: {
      computeMaximumLevelAtPosition?: (position: Cesium.Cartographic) => number;
    };
    getTileDataAvailable?: (x: number, y: number, level: number) => boolean | undefined;
  };
  const requestedLevel = Number.isFinite(targetLevel) ? Math.max(0, Math.floor(targetLevel)) : 10;
  const chunkSize = Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : 1500;
  const heights = new Array<number>(positions.length);

  const nextAvailableLevel = (position: Cesium.Cartographic, startLevel: number): number => {
    for (let level = startLevel; level >= 0; level--) {
      const tile = provider.tilingScheme.positionToTileXY(position, level);
      if (!tile) continue;
      if (provider.getTileDataAvailable?.(tile.x, tile.y, level) !== false) return level;
    }
    return -1;
  };

  let pending = positions.map((position, index) => {
    const maximumLevel = provider.availability?.computeMaximumLevelAtPosition?.(position);
    const startLevel = typeof maximumLevel === 'number' && Number.isFinite(maximumLevel)
      ? Math.min(requestedLevel, Math.floor(maximumLevel))
      : requestedLevel;
    return { index, level: nextAvailableLevel(position, startLevel) };
  });

  while (pending.length > 0) {
    const groups = new Map<number, number[]>();
    const unresolved: typeof pending = [];
    for (const sample of pending) {
      if (sample.level < 0) {
        unresolved.push(sample);
        continue;
      }
      const indices = groups.get(sample.level) ?? [];
      indices.push(sample.index);
      groups.set(sample.level, indices);
    }

    for (const [level, indices] of groups) {
      for (let offset = 0; offset < indices.length; offset += chunkSize) {
        const chunkIndices = indices.slice(offset, offset + chunkSize);
        const chunk = chunkIndices.map((index) => positions[index]);
        // Clear previous/stale values so a failed request cannot look measured.
        for (const position of chunk) position.height = Number.NaN;
        try {
          // false preserves successful samples when another tile is unavailable;
          // Cesium sets missing heights to undefined without rejecting the batch.
          await Cesium.sampleTerrain(terrainProvider, level, chunk, false);
        } catch {
          // Retry only unresolved positions at a known available parent level.
        }

        for (const index of chunkIndices) {
          const height = positions[index].height;
          if (Number.isFinite(height)) {
            heights[index] = height;
          } else {
            unresolved.push({ index, level: nextAvailableLevel(positions[index], level - 1) });
          }
        }
        if (offset + chunkSize < indices.length) {
          await new Promise((resolve) => setTimeout(resolve, 4));
        }
      }
    }

    const unavailable = unresolved.filter((sample) => sample.level < 0);
    if (unavailable.length > 0) {
      throw new Error(`Terrain height unavailable for ${unavailable.length} sample(s), including index ${unavailable[0].index}`);
    }
    pending = unresolved;
  }

  return heights;
}
