/** Offline vector drawing only. The full source store remains available to analysis. */
import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import {
  loadVectorFeatureStore,
  queryFeaturesInBounds,
  queryFeaturesInRadius,
  type VectorFeatureStore,
} from '../../services/vectorFeatureStore';
import type { VectorFeature, VectorFeatureKind } from '../../types/vectorFeature';
import { VECTOR_KIND_COLORS, VECTOR_LINE_WIDTHS, VECTOR_POINT_SIZES } from '../../types/vectorStyle';

const FEATURE_ID_KEY = 'vomKqVectorFeatureId';

/**
 * Conservative drawing budgets for the reported Chrome lag, not measured FPS limits.
 * The previous 25,000-entity load ran at once on the main thread. Limit both entities
 * and geometry: one complex forest can cost more than many small buildings.
 * These caps never filter or mutate the source used by analysis.
 */
const MAX_RENDERED_FEATURES = 3_000;
const MAX_RENDERED_VERTICES = 50_000;
const MAX_FEATURE_VERTICES = 8_000;
/** Each Cesium load is bounded; one feature may use up to MAX_FEATURE_VERTICES. */
const LOAD_BATCH_FEATURES = 128;
const LOAD_BATCH_VERTICES = 4_096;
/** Yield during selection every 2,048 candidates, as well as between load batches. */
const SELECTION_BATCH_FEATURES = 2_048;
/** Existing camera-height culling thresholds, in metres; rendering only. */
const FAR_CULL_M = 250_000;
const VERY_FAR_CULL_M = 120_000;
/** Existing camera debounce in milliseconds, shared by changed and moveEnd. */
const CAMERA_SETTLE_MS = 350;
const FAR_KINDS: readonly VectorFeatureKind[] = [
  'peak', 'ridge', 'place', 'water_river', 'water_stream', 'water_body', 'forest',
];
const KIND_PRIORITY: readonly VectorFeatureKind[] = [
  'peak', 'ridge', 'place', 'water_river', 'water_stream', 'water_body', 'forest', 'highway', 'land', 'building',
];

function vertexCount(feature: VectorFeature): number {
  const geometry = feature.geometry;
  if (geometry.type === 'Point') return 1;
  if (geometry.type === 'LineString') return geometry.coordinates.length;
  let count = 0;
  for (const ring of geometry.coordinates) count += ring.length;
  return count;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function toMinimalFeature(feature: VectorFeature) {
  return {
    type: 'Feature',
    id: feature.id,
    geometry: feature.geometry,
    properties: {
      [FEATURE_ID_KEY]: feature.id,
      kind: feature.kind,
      name: feature.properties.name ?? '',
    },
  };
}

function getFeatureIdOf(entity: Cesium.Entity): string | null {
  const value = entity.properties?.getValue(Cesium.JulianDate.now())?.[FEATURE_ID_KEY];
  return typeof value === 'string' ? value : null;
}

interface ViewSelection {
  key: string;
  candidates: () => VectorFeature[];
  kinds: readonly VectorFeatureKind[] | undefined;
}

function viewSelection(
  store: VectorFeatureStore,
  viewer: Cesium.Viewer,
  kinds: readonly VectorFeatureKind[] | undefined,
): ViewSelection {
  const center = viewer.camera.positionCartographic;
  const height = Cesium.defined(center) ? center.height : 0;
  const far = height > VERY_FAR_CULL_M;
  // Keep the user's filters when applying the existing far-view cull.
  const selectedKinds = far
    ? FAR_KINDS.filter((kind) => !kinds || kinds.includes(kind))
    : kinds;
  if (height > FAR_CULL_M || selectedKinds?.length === 0) {
    return { key: 'empty', candidates: () => [], kinds: selectedKinds };
  }
  const rectangle = viewer.camera.computeViewRectangle();
  if (!Cesium.defined(rectangle)) {
    if (!Cesium.defined(center)) return { key: 'empty', candidates: () => [], kinds: selectedKinds };
    const lat = Cesium.Math.toDegrees(center.latitude);
    const lon = Cesium.Math.toDegrees(center.longitude);
    return {
      key: `radius:${lat.toFixed(6)}:${lon.toFixed(6)}:${far}`,
      candidates: () => queryFeaturesInRadius(store, lat, lon, 40, selectedKinds),
      kinds: selectedKinds,
    };
  }
  const west = Cesium.Math.toDegrees(rectangle.west);
  const south = Cesium.Math.toDegrees(rectangle.south);
  const east = Cesium.Math.toDegrees(rectangle.east);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const bounds = {
    minLat: Math.min(south, north), maxLat: Math.max(south, north),
    minLon: Math.min(west, east), maxLon: Math.max(west, east),
  };
  return {
    // Six decimal places are about 0.11 m latitude, only suppressing camera noise.
    key: `${west.toFixed(6)}:${south.toFixed(6)}:${east.toFixed(6)}:${north.toFixed(6)}:${far}`,
    candidates: () => queryFeaturesInBounds(store, bounds, selectedKinds),
    kinds: selectedKinds,
  };
}

/** Stable priority buckets avoid sorting/allocating wrappers for the whole viewport. */
async function takeByPriority(
  features: VectorFeature[],
  kinds: readonly VectorFeatureKind[] | undefined,
  isCurrent: () => boolean,
): Promise<VectorFeature[]> {
  const order = kinds ?? KIND_PRIORITY;
  const buckets = new Map(order.map((kind) => [kind, [] as VectorFeature[]]));
  const seen = new Set<string>();
  for (let i = 0; i < features.length; i++) {
    const feature = features[i];
    const bucket = buckets.get(feature.kind);
    if (bucket && bucket.length < MAX_RENDERED_FEATURES && !seen.has(feature.id)) {
      const vertices = vertexCount(feature);
      if (vertices <= MAX_FEATURE_VERTICES) {
        bucket.push(feature);
        seen.add(feature.id);
      }
    }
    if ((i + 1) % SELECTION_BATCH_FEATURES === 0) {
      await yieldToBrowser();
      if (!isCurrent()) return [];
    }
  }
  const selected: VectorFeature[] = [];
  let vertices = 0;
  for (const bucket of buckets.values()) {
    for (const feature of bucket) {
      const count = vertexCount(feature);
      if (vertices + count > MAX_RENDERED_VERTICES) continue;
      selected.push(feature);
      vertices += count;
      if (selected.length === MAX_RENDERED_FEATURES) return selected;
    }
  }
  return selected;
}

export interface VectorOverlayProps {
  viewer: Cesium.Viewer | null;
  visible: boolean;
  /** Omitted = all kinds; an empty list = no kinds. */
  kinds?: readonly VectorFeatureKind[];
  onSelectFeature?: (feature: VectorFeature | null) => void;
  /** Explicit null means no data, rather than loading an unrelated archive. */
  store?: VectorFeatureStore | null;
}

export const VectorOverlay: React.FC<VectorOverlayProps> = ({
  viewer, visible, kinds, onSelectFeature, store: providedStore,
}) => {
  const loadedStoreRef = useRef<VectorFeatureStore | null>(null);
  const onSelectRef = useRef(onSelectFeature);
  // Equivalent filter arrays must not tear down a ready datasource during chat renders.
  const kindsKey = kinds?.join('|') ?? '*';
  useEffect(() => { onSelectRef.current = onSelectFeature; }, [onSelectFeature]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !visible) return;
    const filterKinds = kindsKey === '*' ? undefined : kindsKey === '' ? [] : kindsKey.split('|') as VectorFeatureKind[];
    const camera = viewer.camera;
    let cancelled = false;
    let revision = 0;
    let building = false;
    let queued = false;
    let cameraTimer: ReturnType<typeof setTimeout> | null = null;
    let datasource: Cesium.CustomDataSource | null = null;
    let pendingSource: Cesium.CustomDataSource | null = null;
    let handler: Cesium.ScreenSpaceEventHandler | null = null;
    let previousView = '';
    let previousSelection: VectorFeature[] = [];
    let visibleFeatureIndex = new Map<string, VectorFeature>();

    const removeSource = (source: Cesium.CustomDataSource | null) => {
      if (!source) return;
      if (!viewer.isDestroyed() && viewer.dataSources.contains(source)) viewer.dataSources.remove(source, true);
      source.entities.removeAll();
    };
    const clearVisibleSource = () => {
      removeSource(datasource);
      datasource = null;
      previousSelection = [];
      visibleFeatureIndex.clear();
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };

    const build = async (buildRevision: number) => {
      const isCurrent = () => !cancelled && revision === buildRevision && !viewer.isDestroyed();
      const store = providedStore !== undefined
        ? providedStore
        : loadedStoreRef.current ?? await loadVectorFeatureStore();
      if (!isCurrent()) return;
      loadedStoreRef.current = store;
      if (!store || store.featureCount === 0) return;
      const view = viewSelection(store, viewer, filterKinds);
      if (view.key === previousView) return;
      // Give pending input/paint a turn before querying and constructing entities.
      await yieldToBrowser();
      if (!isCurrent()) return;
      const selected = await takeByPriority(view.candidates(), view.kinds, isCurrent);
      if (!isCurrent()) return;
      if (selected.length === previousSelection.length && selected.every((feature, i) => feature === previousSelection[i])) {
        previousView = view.key;
        return;
      }
      if (selected.length === 0) {
        clearVisibleSource();
        previousView = view.key;
        return;
      }

      // Prepare off-scene. Keep the current source visible until the replacement is ready.
      const replacement = new Cesium.CustomDataSource('offline-vector-visible');
      pendingSource = replacement;
      const nextIndex = new Map(selected.map((feature) => [feature.id, feature]));
      let adopted = false;
      try {
        for (let offset = 0; offset < selected.length;) {
          await yieldToBrowser();
          if (!isCurrent()) return;
          const batch: VectorFeature[] = [];
          let vertices = 0;
          while (offset < selected.length && batch.length < LOAD_BATCH_FEATURES) {
            const feature = selected[offset];
            const count = vertexCount(feature);
            if (batch.length > 0 && vertices + count > LOAD_BATCH_VERTICES) break;
            batch.push(feature);
            vertices += count;
            offset++;
          }
          const loaded = await Cesium.GeoJsonDataSource.load(
            { type: 'FeatureCollection', features: batch.map(toMinimalFeature) },
            { clampToGround: true },
          );
          try {
            if (!isCurrent()) return;
            // Use source IDs, not array position, for geometry styling and picking.
            replacement.entities.suspendEvents();
            try {
              for (const entity of [...loaded.entities.values]) {
                const featureId = getFeatureIdOf(entity);
                const feature = featureId ? nextIndex.get(featureId) : undefined;
                if (!feature) continue;
                styleEntity(entity, feature);
                loaded.entities.remove(entity);
                replacement.entities.add(entity);
              }
            } finally {
              replacement.entities.resumeEvents();
            }
          } finally {
            loaded.entities.removeAll();
          }
        }
        if (!isCurrent()) return;
        await viewer.dataSources.add(replacement);
        if (!isCurrent()) return;
        const oldSource = datasource;
        datasource = replacement;
        pendingSource = null;
        adopted = true;
        visibleFeatureIndex = nextIndex;
        previousSelection = selected;
        previousView = view.key;
        removeSource(oldSource);

        if (!handler) {
          handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
          handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
            const picked = viewer.scene.pick(movement.position);
            const entity = Cesium.defined(picked) && picked.id instanceof Cesium.Entity ? picked.id : null;
            const featureId = entity ? getFeatureIdOf(entity) : null;
            // Only index the at-most-3,000 rendered features: no first-click 815k scan.
            onSelectRef.current?.(featureId ? visibleFeatureIndex.get(featureId) ?? null : null);
          }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        }
        viewer.scene.requestRender();
      } finally {
        if (!adopted) removeSource(replacement);
        if (pendingSource === replacement) pendingSource = null;
      }
    };

    const queueBuild = async () => {
      if (cancelled || viewer.isDestroyed()) return;
      if (building) { queued = true; return; }
      building = true;
      const buildRevision = revision;
      try {
        await build(buildRevision);
      } catch (error) {
        if (!cancelled && !viewer.isDestroyed()) console.warn('Không dựng được lớp đối tượng bản đồ:', error);
      } finally {
        building = false;
        if (queued && !cancelled) {
          queued = false;
          void queueBuild();
        }
      }
    };
    const onCameraSettled = () => {
      // Invalidate work immediately; do not attach a source for the previous view.
      revision++;
      if (cameraTimer !== null) clearTimeout(cameraTimer);
      cameraTimer = setTimeout(() => {
        cameraTimer = null;
        void queueBuild();
      }, CAMERA_SETTLE_MS);
    };
    // Empty views must still respond when the camera enters a downloaded region.
    camera.changed.addEventListener(onCameraSettled);
    camera.moveEnd.addEventListener(onCameraSettled);
    void queueBuild();

    return () => {
      cancelled = true;
      revision++;
      camera.changed.removeEventListener(onCameraSettled);
      camera.moveEnd.removeEventListener(onCameraSettled);
      if (cameraTimer !== null) clearTimeout(cameraTimer);
      handler?.destroy();
      removeSource(pendingSource);
      pendingSource = null;
      clearVisibleSource();
    };
  }, [viewer, visible, kindsKey, providedStore]);

  return null;
};

/** Preserve the geometry produced by Cesium while assigning shared kind styles. */
function styleEntity(entity: Cesium.Entity, source: VectorFeature): void {
  const kind = source.kind;
  const color = Cesium.Color.fromCssColorString(VECTOR_KIND_COLORS[kind]);
  const name = source.properties.name;
  if (source.geometry.type === 'Point') {
    // GeoJSON installs a default pin; the point is the intended symbol, not both.
    entity.billboard = undefined;
    entity.point = new Cesium.PointGraphics({
      pixelSize: VECTOR_POINT_SIZES[kind] ?? 5, color,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.8), outlineWidth: 1,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    if (name) entity.label = new Cesium.LabelGraphics({
      text: name, font: '11px sans-serif', fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK, outlineWidth: 2, showBackground: true,
      backgroundColor: Cesium.Color.BLACK.withAlpha(0.6), backgroundPadding: new Cesium.Cartesian2(4, 2),
      pixelOffset: new Cesium.Cartesian2(0, -16), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.0, 2.0e5, 0.55),
      translucencyByDistance: new Cesium.NearFarScalar(5.0e4, 1.0, 8.0e5, 0.0),
    });
    return;
  }
  if (source.geometry.type === 'Polygon' && entity.polygon) {
    entity.polygon.material = new Cesium.ColorMaterialProperty(color.withAlpha(kind === 'building' ? 0.55 : 0.3));
    entity.polygon.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.CLAMP_TO_GROUND);
    entity.polygon.outline = new Cesium.ConstantProperty(kind === 'building');
    entity.polygon.outlineColor = new Cesium.ConstantProperty(color.withAlpha(0.9));
    entity.polygon.outlineWidth = new Cesium.ConstantProperty(1);
    return;
  }
  if (entity.polyline) {
    entity.polyline.material = new Cesium.ColorMaterialProperty(color.withAlpha(kind === 'ridge' ? 0.85 : 1));
    entity.polyline.width = new Cesium.ConstantProperty(VECTOR_LINE_WIDTHS[kind] ?? 2);
    entity.polyline.clampToGround = new Cesium.ConstantProperty(true);
  }
}
