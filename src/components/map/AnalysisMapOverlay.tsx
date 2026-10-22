import { useEffect } from 'react';
import * as Cesium from 'cesium';
import { useShallow } from 'zustand/react/shallow';
import { useAnalysisStore } from '../../store/useAnalysisStore';
import type { AnalysisGeometry, AnalysisTerrainSample } from '../../types/analysis';

/** L12 is a bounded sample of the existing offline terrain, not a claim of highest-detail coverage. */
const TERRAIN_SAMPLE_LEVEL = 12;
/** Rendering guard only; measurement geometry remains unchanged in the worker/snapshot. */
const MAX_PREVIEW_VERTICES = 5_000;

function validCoordinate(value: number[]): boolean {
  return value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

function positions(coordinates: number[][]): Cesium.Cartesian3[] {
  return coordinates.filter(validCoordinate).map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
}

function renderGeometry(source: Cesium.CustomDataSource, geometry: AnalysisGeometry, name: string, color: Cesium.Color): void {
  const point = (coordinate: number[]) => {
    if (!validCoordinate(coordinate)) return;
    source.entities.add({ name, position: Cesium.Cartesian3.fromDegrees(coordinate[0], coordinate[1]),
      point: { pixelSize: 9, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  };
  const line = (coordinates: number[][]) => {
    if (coordinates.length < 2) return;
    source.entities.add({ name, polyline: { positions: positions(coordinates), width: 3, material: color, clampToGround: true } });
  };
  const polygon = (rings: number[][][]) => {
    if (!rings[0] || rings[0].length < 4) return;
    source.entities.add({ name, polygon: {
      hierarchy: new Cesium.PolygonHierarchy(positions(rings[0]), rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(positions(ring)))),
      material: color.withAlpha(0.14), outline: false, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    } });
    for (const ring of rings) line(ring);
  };
  let vertexCount = 0;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'number') {
      const coordinate = value as number[];
      if (validCoordinate(coordinate)) {
        vertexCount++;
        west = Math.min(west, coordinate[0]); east = Math.max(east, coordinate[0]);
        south = Math.min(south, coordinate[1]); north = Math.max(north, coordinate[1]);
      }
    } else for (const item of value) walk(item);
  };
  walk(geometry.coordinates);
  if (vertexCount > MAX_PREVIEW_VERTICES) {
    // Show an explicitly named extent instead of triangulating a huge citation on the UI thread.
    source.entities.add({ name: `${name} — phạm vi hình học (bản xem trước)`, polyline: {
      positions: positions([[west, south], [east, south], [east, north], [west, north], [west, south]]),
      width: 2, material: new Cesium.PolylineDashMaterialProperty({ color }), clampToGround: true,
    } });
    return;
  }
  switch (geometry.type) {
    case 'Point': point(geometry.coordinates); break;
    case 'MultiPoint': geometry.coordinates.forEach(point); break;
    case 'LineString': line(geometry.coordinates); break;
    case 'MultiLineString': geometry.coordinates.forEach(line); break;
    case 'Polygon': polygon(geometry.coordinates); break;
    case 'MultiPolygon': geometry.coordinates.forEach(polygon); break;
  }
}

/** Independent datasource: legacy viewer.entities.removeAll() cannot erase analysis evidence. */
export function AnalysisMapOverlay({ viewer }: { viewer: Cesium.Viewer | null }) {
  const state = useAnalysisStore(useShallow((store) => ({
    enabled: store.enabled, aoi: store.aoi, drawVertices: store.drawVertices,
    highlightGeometry: store.highlightGeometry, annotations: store.appliedAnnotations,
  })));

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const sample = async (coordinates: [number, number][], signal?: AbortSignal): Promise<AnalysisTerrainSample[]> => {
      const missing = () => coordinates.map(([lon, lat]) => ({ lon, lat, height: null, sourceId: 'terrain:offline:l12' }));
      if (signal?.aborted) throw new DOMException('Đã hủy lấy mẫu địa hình', 'AbortError');
      if (viewer.isDestroyed() || viewer.scene.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) return missing();
      try {
        const sampled = await Cesium.sampleTerrain(viewer.scene.terrainProvider, TERRAIN_SAMPLE_LEVEL,
          coordinates.map(([lon, lat]) => Cesium.Cartographic.fromDegrees(lon, lat)), false);
        if (signal?.aborted) throw new DOMException('Đã hủy lấy mẫu địa hình', 'AbortError');
        return sampled.map((position, index) => ({
          lon: coordinates[index][0], lat: coordinates[index][1],
          height: Number.isFinite(position.height) ? position.height : null, sourceId: 'terrain:offline:l12',
        }));
      } catch (error) {
        if (signal?.aborted) throw error;
        return missing();
      }
    };
    useAnalysisStore.getState().setTerrainSampler(sample);
    return () => useAnalysisStore.getState().setTerrainSampler(null);
  }, [viewer]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !state.enabled) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(() => {
      if (useAnalysisStore.getState().drawMode === 'polygon') useAnalysisStore.getState().completeDraw();
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && useAnalysisStore.getState().drawMode) useAnalysisStore.getState().cancelDraw();
    };
    window.addEventListener('keydown', escape);
    return () => { handler.destroy(); window.removeEventListener('keydown', escape); };
  }, [viewer, state.enabled]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !state.enabled) return;
    const source = new Cesium.CustomDataSource('GIS analysis v2');
    source.entities.suspendEvents();
    try {
      if (state.aoi) renderGeometry(source, state.aoi.geometry, state.aoi.label, Cesium.Color.CYAN);
      if (state.highlightGeometry) renderGeometry(source, state.highlightGeometry, 'Nguồn đang xem', Cesium.Color.YELLOW);
      for (const annotation of state.annotations) renderGeometry(source, annotation.geometry, annotation.label, Cesium.Color.ORANGE);
      if (state.drawVertices.length) {
        renderGeometry(source, { type: 'MultiPoint', coordinates: state.drawVertices }, 'Đỉnh vùng đang vẽ', Cesium.Color.CYAN);
        if (state.drawVertices.length > 1) renderGeometry(source, { type: 'LineString', coordinates: state.drawVertices }, 'Ranh giới đang vẽ', Cesium.Color.CYAN);
      }
    } finally { source.entities.resumeEvents(); }
    let disposed = false;
    void viewer.dataSources.add(source).then(() => {
      if (disposed || viewer.isDestroyed()) {
        if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true);
      } else viewer.scene.requestRender();
    });
    return () => {
      disposed = true;
      if (!viewer.isDestroyed()) { viewer.dataSources.remove(source, true); viewer.scene.requestRender(); }
    };
  }, [viewer, state]);
  return null;
}
