import * as Cesium from 'cesium';

const guarded = new WeakSet<Cesium.CesiumTerrainProvider>();
let providerPromise: Promise<Cesium.CesiumTerrainProvider> | null = null;

/** Fixed-level sampleTerrain can request tiles without consulting availability.
 * Keep absent samples missing, but avoid HTTP for tiles the local manifest lacks. */
export function guardOfflineTerrainRequests(provider: Cesium.CesiumTerrainProvider): Cesium.CesiumTerrainProvider {
  if (guarded.has(provider)) return provider;
  const requestGeometry = provider.requestTileGeometry.bind(provider);
  provider.requestTileGeometry = (x, y, level, request) => {
    if (provider.getTileDataAvailable(x, y, level) === false) {
      return Promise.reject(new Cesium.RuntimeError(`Local terrain tile unavailable: ${level}/${x}/${y}`));
    }
    return requestGeometry(x, y, level, request);
  };
  guarded.add(provider);
  return provider;
}

/** Shared by Viewer mount and mode changes, including React StrictMode remounts.
 * Failed construction is retryable on the next explicit call. No remote fallback. */
export function getOfflineTerrainProvider(): Promise<Cesium.CesiumTerrainProvider> {
  if (!providerPromise) {
    providerPromise = Cesium.CesiumTerrainProvider.fromUrl('./offline-terrain', {
      requestVertexNormals: false, requestWaterMask: false, requestMetadata: false,
    }).then((provider) => {
      provider.errorEvent.addEventListener((error) => { error.retry = false; });
      return guardOfflineTerrainRequests(provider);
    }).catch((error: unknown) => { providerPromise = null; throw error; });
  }
  return providerPromise;
}
