import type { RadarCoverageVolume, RadarTerrainGrid } from '../types/radarVolume';

const HEIGHT_OFFSET_M = -1024;
const HEIGHT_SCALE_M = 1;
const MAX_RADIAL_INTERVALS = 1200;
const TARGET_RADIAL_STEP_M = 250;

/**
 * Opaque RG16 atlas: LOS rows first, physical DEM rows second. Alpha stays 255
 * so Canvas and WebGL cannot corrupt packed height bytes by premultiplication.
 * Columns cover [0, rangeM]; both endpoints are represented.
 */
export interface RadarTerrainMaskData {
  width: number;
  height: number;
  azimuthCount: number;
  rangeM: number;
  radialStepM: number;
  heightOffsetM: number;
  heightScaleM: number;
  pixels: Uint8ClampedArray;
}

export interface RadarTerrainMaskSample {
  minimumVisibleHeightM: number;
  terrainHeightM: number;
}

function isValidGrid(grid: RadarTerrainGrid): boolean {
  const azimuthCount = grid.azimuthSamples.length;
  const radialCount = grid.sampleDistances.length;
  if (azimuthCount === 0 || radialCount === 0
    || grid.terrainHeights.length !== azimuthCount * radialCount
    || grid.minimumVisibleHeights.length !== azimuthCount * radialCount) return false;

  // The shader addresses azimuth rows directly, including the 360/0 seam.
  for (let az = 0; az < azimuthCount; az++) {
    if (!Number.isFinite(grid.azimuthSamples[az])
      || Math.abs(grid.azimuthSamples[az] - az * 360 / azimuthCount) > 1e-6) return false;
  }
  let previousDistanceM = -1;
  for (const distanceM of grid.sampleDistances) {
    if (!Number.isFinite(distanceM) || distanceM < 0 || distanceM <= previousDistanceM) return false;
    previousDistanceM = distanceM;
  }
  for (let index = 0; index < grid.terrainHeights.length; index++) {
    if (!Number.isFinite(grid.terrainHeights[index])
      || !Number.isFinite(grid.minimumVisibleHeights[index])) return false;
  }
  return true;
}

function writeHeight(pixels: Uint8ClampedArray, offset: number, heightM: number): void {
  const encoded = Math.max(0, Math.min(65535, Math.ceil((heightM - HEIGHT_OFFSET_M) / HEIGHT_SCALE_M)));
  pixels[offset] = encoded >>> 8;
  pixels[offset + 1] = encoded & 255;
  pixels[offset + 2] = 0;
  pixels[offset + 3] = 255;
}

/**
 * Preserve each DEM obstruction while resampling irregular source distances.
 * Each texel bounds its forward radial cell, including the original samples
 * bracketing that cell. A narrow inserted sample therefore cannot disappear
 * between adjacent 250 m pixels. Sampling uses maxima, never byte interpolation.
 */
export function buildRadarTerrainMaskData(volume: RadarCoverageVolume): RadarTerrainMaskData | null {
  const grid = volume.terrainGrid;
  const rangeM = volume.maxRangeKm * 1000;
  const radarGroundM = volume.radarAltM - volume.antennaHeightAGL;
  if (volume.terrainStatus !== 'loaded' || !grid || !isValidGrid(grid)
    || !Number.isFinite(rangeM) || rangeM <= 0 || !Number.isFinite(radarGroundM)
    || grid.sampleDistances.at(-1)! < rangeM - 0.5) return null;

  const intervalCount = Math.min(MAX_RADIAL_INTERVALS, Math.ceil(rangeM / TARGET_RADIAL_STEP_M));
  const width = intervalCount + 1;
  const azimuthCount = grid.azimuthSamples.length;
  const height = azimuthCount * 2;
  const radialStepM = rangeM / intervalCount;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const radialCount = grid.sampleDistances.length;

  // Source index ranges are identical for every azimuth and for both fields.
  const sourceSpans: Array<{ first: number; last: number; includesOrigin: boolean }> = [];
  let lowerIndex = 0;
  let upperIndex = 0;
  for (let column = 0; column < width; column++) {
    const distanceM = column * radialStepM;
    const cellEndM = Math.min(rangeM, distanceM + radialStepM);
    while (lowerIndex + 1 < radialCount && grid.sampleDistances[lowerIndex + 1] <= distanceM) lowerIndex++;
    upperIndex = Math.max(upperIndex, lowerIndex);
    while (upperIndex < radialCount - 1 && grid.sampleDistances[upperIndex] < cellEndM) upperIndex++;
    sourceSpans.push({
      first: lowerIndex,
      last: upperIndex,
      includesOrigin: distanceM < grid.sampleDistances[0],
    });
  }

  for (let azimuthIndex = 0; azimuthIndex < azimuthCount; azimuthIndex++) {
    const sourceOffset = azimuthIndex * radialCount;
    for (let column = 0; column < width; column++) {
      const span = sourceSpans[column];
      let terrainHeightM = span.includesOrigin ? radarGroundM : -Infinity;
      let minimumVisibleHeightM = span.includesOrigin ? radarGroundM : -Infinity;
      for (let index = span.first; index <= span.last; index++) {
        terrainHeightM = Math.max(terrainHeightM, grid.terrainHeights[sourceOffset + index]);
        minimumVisibleHeightM = Math.max(minimumVisibleHeightM, grid.minimumVisibleHeights[sourceOffset + index]);
      }
      writeHeight(pixels, (azimuthIndex * width + column) * 4, minimumVisibleHeightM);
      writeHeight(pixels, ((azimuthCount + azimuthIndex) * width + column) * 4, terrainHeightM);
    }
  }

  return { width, height, azimuthCount, rangeM, radialStepM, heightOffsetM: HEIGHT_OFFSET_M,
    heightScaleM: HEIGHT_SCALE_M, pixels };
}

/** Browser-only conversion; all RG values are preserved by the opaque atlas. */
export function createRadarTerrainMaskCanvas(data: RadarTerrainMaskData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required for the radar terrain mask');
  const image = context.createImageData(data.width, data.height);
  image.data.set(data.pixels);
  context.putImageData(image, 0, 0);
  return canvas;
}

function readHeight(data: RadarTerrainMaskData, column: number, row: number): number {
  const offset = (row * data.width + column) * 4;
  return data.heightOffsetM + (data.pixels[offset] * 256 + data.pixels[offset + 1]) * data.heightScaleM;
}

/** CPU equivalent of the fragment shader's conservative four-texel lookup. */
export function sampleRadarTerrainMaskData(
  data: RadarTerrainMaskData,
  azimuthDeg: number,
  distanceM: number
): RadarTerrainMaskSample {
  if (!Number.isFinite(azimuthDeg) || !Number.isFinite(distanceM)) {
    throw new Error('Radar mask coordinates must be finite');
  }
  const azimuthCoordinate = ((azimuthDeg % 360) + 360) % 360 / 360 * data.azimuthCount;
  const row0 = Math.min(data.azimuthCount - 1, Math.floor(azimuthCoordinate));
  const row1 = (row0 + 1) % data.azimuthCount;
  const radialCoordinate = Math.max(0, Math.min(data.rangeM, distanceM)) / data.radialStepM;
  const column0 = Math.min(data.width - 1, Math.floor(radialCoordinate));
  const column1 = Math.min(data.width - 1, column0 + 1);
  const maximumAt = (rowOffset: number) => Math.max(
    readHeight(data, column0, rowOffset + row0), readHeight(data, column1, rowOffset + row0),
    readHeight(data, column0, rowOffset + row1), readHeight(data, column1, rowOffset + row1)
  );
  return { minimumVisibleHeightM: maximumAt(0), terrainHeightM: maximumAt(data.azimuthCount) };
}
