import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getOfflineMapAssets } from './offlineMapAssets.ts'

async function withPublicDir(run: (publicDir: string) => Promise<void>): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'offline-map-assets-'))
  try {
    const publicDir = join(tempRoot, 'public')
    await mkdir(publicDir)
    await run(publicDir)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

async function writeTile(publicDir: string, pack: string, z: string, x: string, y: string, ext: string): Promise<void> {
  const tilePath = join(publicDir, pack, z, x, `${y}.${ext}`)
  await mkdir(join(publicDir, pack, z, x), { recursive: true })
  await writeFile(tilePath, 'tile')
}

test('all assets are false when public packs are missing', async () => {
  await withPublicDir(async (publicDir) => {
    assert.deepEqual(getOfflineMapAssets(publicDir), {
      terrain: false,
      satellite: false,
      satelliteMaxLevel: 0,
      terrainMap: false,
      vectorRegions: [],
    })
  })
})

test('terrain requires supported metadata and both nonempty root tiles', async () => {
  await withPublicDir(async (publicDir) => {
    const terrainDir = join(publicDir, 'offline-terrain')
    await mkdir(join(terrainDir, '0', '0'), { recursive: true })
    await mkdir(join(terrainDir, '0', '1'), { recursive: true })
    await writeFile(join(terrainDir, 'layer.json'), JSON.stringify({
      format: 'quantized-mesh-1.0',
      tiles: ['{z}/{x}/{y}.terrain'],
    }))
    await writeFile(join(terrainDir, '0', '0', '0.terrain'), 'root tile')
    assert.equal(getOfflineMapAssets(publicDir).terrain, false)

    await writeFile(join(terrainDir, '0', '1', '0.terrain'), 'root tile')
    assert.equal(getOfflineMapAssets(publicDir).terrain, true)

    await writeFile(join(terrainDir, 'layer.json'), '{invalid json')
    assert.equal(getOfflineMapAssets(publicDir).terrain, false)
  })
})

test('terrain rejects unsupported metadata and empty root tile files', async () => {
  await withPublicDir(async (publicDir) => {
    const terrainDir = join(publicDir, 'offline-terrain')
    await mkdir(join(terrainDir, '0', '0'), { recursive: true })
    await mkdir(join(terrainDir, '0', '1'), { recursive: true })
    await writeFile(join(terrainDir, 'layer.json'), JSON.stringify({ format: 'heightmap-1.0', tiles: ['{z}/{x}/{y}.terrain'] }))
    await writeFile(join(terrainDir, '0', '0', '0.terrain'), 'root tile')
    await writeFile(join(terrainDir, '0', '1', '0.terrain'), 'root tile')
    assert.equal(getOfflineMapAssets(publicDir).terrain, false)

    await writeFile(join(terrainDir, 'layer.json'), JSON.stringify({ format: 'quantized-mesh-1.0', tiles: ['{z}/{x}/{y}.terrain'] }))
    await writeFile(join(terrainDir, '0', '1', '0.terrain'), '')
    assert.equal(getOfflineMapAssets(publicDir).terrain, false)
  })
})

test('satellite and terrain imagery detect expected nested tile layouts', async () => {
  await withPublicDir(async (publicDir) => {
    await writeTile(publicDir, 'offline-satellite', '8', '72', '93', 'jpg')
    await writeTile(publicDir, 'offline-terrain-map', '8', '72', '93', 'png')
    assert.deepEqual(getOfflineMapAssets(publicDir), {
      terrain: false,
      satellite: true,
      satelliteMaxLevel: 8,
      terrainMap: true,
      vectorRegions: [],
    })
  })
})

test('empty tiles do not count, and wrong extensions are ignored', async () => {
  await withPublicDir(async (publicDir) => {
    const satelliteTile = join(publicDir, 'offline-satellite', '8', '72', '93.jpg')
    await mkdir(join(publicDir, 'offline-satellite', '8', '72'), { recursive: true })
    await mkdir(join(publicDir, 'offline-terrain-map', '8', '72'), { recursive: true })
    await writeFile(satelliteTile, '')
    await writeFile(join(publicDir, 'offline-terrain-map', '8', '72', '93.jpg'), 'wrong extension')
    assert.deepEqual(getOfflineMapAssets(publicDir), {
      terrain: false,
      satellite: false,
      satelliteMaxLevel: 0,
      terrainMap: false,
      vectorRegions: [],
    })
  })
})

test('invalid public directory inputs return false for every asset', () => {
  assert.deepEqual(getOfflineMapAssets(''), {
    terrain: false,
    satellite: false,
    satelliteMaxLevel: 0,
    terrainMap: false,
    vectorRegions: [],
  })
})

test('satellite maximum level ignores empty and wrong-extension higher zooms', async () => {
  await withPublicDir(async (publicDir) => {
    await writeTile(publicDir, 'offline-satellite', '3', '2', '1', 'jpg')
    await writeTile(publicDir, 'offline-satellite', '8', '72', '93', 'jpg')

    const emptyTile = join(publicDir, 'offline-satellite', '12', '2048', '1024.jpg')
    const wrongExtension = join(publicDir, 'offline-satellite', '13', '4096', '2048.png')
    await mkdir(join(publicDir, 'offline-satellite', '12', '2048'), { recursive: true })
    await mkdir(join(publicDir, 'offline-satellite', '13', '4096'), { recursive: true })
    await writeFile(emptyTile, '')
    await writeFile(wrongExtension, 'not a jpg tile')

    const assets = getOfflineMapAssets(publicDir)
    assert.equal(assets.satellite, true)
    assert.equal(assets.satelliteMaxLevel, 8)
  })
})
