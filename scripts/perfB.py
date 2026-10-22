import sys
path = "src/components/map/CesiumGlobe.tsx"
with open(path, encoding="utf-8-sig") as f:
    lines = f.read().splitlines()
s = next(i for i,l in enumerate(lines) if l.strip() == "const {")
e = next(i for i,l in enumerate(lines) if "} = useTacticalStore();" in l)
names = [l.strip().rstrip(",") for l in lines[s+1:e]]
names = [n for n in names if n]
print("fields:", len(names))
inner = ",\n".join("    " + n for n in names)
sel_lines = []
sel_lines.append("  const {")
sel_lines.append(inner + ",")
sel_lines.append("  } = useTacticalStore(")
sel_lines.append("    useShallow((state) => ({")
for n in names:
    sel_lines.append("      " + n + ": state." + n + ",")
sel_lines.append("    }))")
sel_lines.append("  );")
new_block = "\n".join(sel_lines)
lines[s:e+1] = new_block.splitlines()
with open(path, "w", encoding="utf-8-sig") as f:
    f.write("\n".join(lines))
print("phase B done, s=", s+1, "e=", e+1)
