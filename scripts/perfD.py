import sys
path = "src/components/map/CesiumGlobe.tsx"
with open(path, encoding="utf-8-sig") as f:
    src = f.read()

def rep_once(old, new, label):
    global src
    c = src.count(old)
    print(label, "count=", c)
    if c < 1:
        print("SKIP", label)
        return False
    src = src.replace(old, new, 1)
    print("OK", label)
    return True

# D1: throttle camera.changed -> chi cap nhat khi lech >= 500m hoac qua 300ms
old_cam = "    viewer.camera.changed.addEventListener(() => {\n      if (viewerRef.current) {\n        const carto = viewerRef.current.camera.positionCartographic;\n        const h = Math.round(carto.height);\n        setCameraHeight(h);"
new_cam = "    viewer.camera.changed.addEventListener(() => {\n      if (viewerRef.current) {\n        const carto = viewerRef.current.camera.positionCartographic;\n        const h = Math.round(carto.height);\n        const now = performance.now();\n        if (\n          Math.abs(h - lastCamHeightRef.current) >= 500 ||\n          now - lastCamTickRef.current > 300\n        ) {\n          lastCamHeightRef.current = h;\n          lastCamTickRef.current = now;\n          setCameraHeight(h);\n        }"
ok = rep_once(old_cam, new_cam, "throttle-camera")
if not ok:
    print("NEED MANUAL camera block")

# D2: throttle uniform u_time -> 10fps thay vi moi frame
old_dome = "    const removeDomeTimeListener = viewer.scene.preRender.addEventListener(() => {\n      updateRadarDomeMaterials(performance.now() / 1000);\n    });"
new_dome = "    const removeDomeTimeListener = viewer.scene.preRender.addEventListener(() => {\n      const nowMs = performance.now();\n      if (nowMs - lastDomeTickRef.current > 100) {\n        lastDomeTickRef.current = nowMs;\n        updateRadarDomeMaterials(nowMs / 1000);\n      }\n    });"
rep_once(old_dome, new_dome, "throttle-dome-time")

with open(path, "w", encoding="utf-8-sig") as f:
    f.write(src)
print("phase D done, len", len(src))
