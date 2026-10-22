import sys
path = "src/components/map/CesiumGlobe.tsx"
with open(path, encoding="utf-8-sig") as f:
    src = f.read()

def rep_once(old, new, label):
    global src
    c = src.count(old)
    print(label, "count=", c)
    if c != 1:
        print("SKIP", label)
        return False
    src = src.replace(old, new, 1)
    print("OK", label)
    return True

# C1: Viewer perf flags (gop render nhanh, giam tai GPU)
rep_once(
    "      scene3DOnly: false,\n      showRenderLoopErrors: false,\n    });",
    "      scene3DOnly: false,\n      showRenderLoopErrors: false,\n      requestRenderMode: false,\n      maximumRenderTimeChange: 0,\n      targetFrameRate: 30,\n      resolutionScale: Math.min(window.devicePixelRatio || 1, 1.5),\n      orderIndependentTranslucency: false,\n    });",
    "viewer-flags"
)

# C2: globe perf sau khi tao viewer (ngay sau viewerRef.current = viewer;)
rep_once(
    "    viewerRef.current = viewer;",
    "    viewerRef.current = viewer;\n\n    viewer.scene.globe.maximumScreenSpaceError = 2.5;\n    viewer.scene.globe.tileCacheSize = 200;\n    viewer.scene.fog.enabled = true;\n    viewer.scene.fog.density = 0.00008;\n    viewer.scene.globe.showGroundAtmosphere = false;\n    viewer.scene.skyAtmosphere.show = false;",
    "globe-perf"
)

with open(path, "w", encoding="utf-8-sig") as f:
    f.write(src)
print("phase C done, len", len(src))
