import sys
path = "src/components/map/CesiumGlobe.tsx"
with open(path, encoding="utf-8-sig") as f:
    src = f.read()
orig_len = len(src)
print("orig len", orig_len)

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

# 1. add useShallow import after useTacticalStore import
rep_once(
    "import { useTacticalStore } from '../../store/useTacticalStore';",
    "import { useTacticalStore } from '../../store/useTacticalStore';\nimport { useShallow } from 'zustand/react/shallow';",
    "add-useShallow-import"
)

# 2. add perf refs near domeResourcesRef
rep_once(
    "const domeResourcesRef = useRef<DomeRenderResource[]>([]);",
    "const domeResourcesRef = useRef<DomeRenderResource[]>([]);\n  const lastCamHeightRef = useRef<number>(95000);\n  const lastCamTickRef = useRef<number>(0);\n  const lastDomeTickRef = useRef<number>(0);\n  const badgeTimerRef = useRef<number | null>(null);",
    "add-perf-refs"
)

with open(path, "w", encoding="utf-8-sig") as f:
    f.write(src)
print("phase A done, new len", len(src))
