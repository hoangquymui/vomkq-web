"""Offscreen shader regression. Prepare fixture with jiti, then run this file.

Requires moderngl (pip install moderngl). A workspace-only test installation at
scratch/terrain-gl-test-deps is supported; no app dependency is added.
"""
import base64
import json
import re
import struct
import sys
from pathlib import Path

workspace = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(workspace / 'scratch/terrain-gl-test-deps'))
import moderngl

fixture = json.loads((workspace / 'scratch/radar-terrain-shader/fixture.json').read_text())
context = moderngl.create_standalone_context(require=330)
vertex_shader = '''#version 330
in vec2 screen;
in vec3 eye;
out vec3 eyePosition;
void main() { gl_Position=vec4(screen,0,1); eyePosition=eye; }
'''
fragment_shader = '''#version 330
const float czm_twoPi=6.283185307179586;
struct czm_materialInput { vec3 positionToEyeEC; vec3 normalEC; vec2 st; };
struct czm_material { vec3 diffuse; float alpha; float specular; float shininess; };
czm_material czm_getDefaultMaterial(czm_materialInput inputValue) {
 return czm_material(vec3(0),1,0,1);
}
in vec3 eyePosition;
out vec4 color;
''' + fixture['shader'] + '''
void main() {
 czm_materialInput inputValue;
 inputValue.positionToEyeEC=-eyePosition;
 inputValue.normalEC=normalize(eyePosition);
 inputValue.st=vec2(0);
 czm_material material=czm_getMaterial(inputValue);
 color=vec4(material.diffuse,material.alpha);
}
'''
program = context.program(vertex_shader=vertex_shader, fragment_shader=fragment_shader)
print('PASS: actual Cesium material shader compiles on', context.info['GL_RENDERER'])

def uniform(name):
    actual = re.search(r'\buniform\s+\w+\s+(' + re.escape(name) + r'_\d+)\s*;', fixture['shader'])
    return program[actual.group(1) if actual else name]

for name, value in {
    'u_baseColor': (0, 1, 0, .3), 'u_rimColor': (1, 1, 0, 1), 'u_rimPower': 2,
    'u_scanLineCount': 0, 'u_scanLineSpeed': 0, 'u_time': 0,
    'u_maskSize': (fixture['data']['width'], fixture['data']['height']),
    'u_maskAzimuthCount': fixture['data']['azimuthCount'],
    'u_maskRadialStepM': fixture['data']['radialStepM'],
    'u_maskHeightOffsetM': fixture['data']['heightOffsetM'],
    'u_maskHeightScaleM': fixture['data']['heightScaleM'],
    'u_radarCartographic': (fixture['radarLongitude'], fixture['radarLatitude']),
    'u_exaggerationRelativeHeight': 0,
}.items():
    uniform(name).value = value

data = fixture['data']
pixels = base64.b64decode(data['pixels'])
stride = data['width'] * 4
# Match Cesium's flipY=true upload from the opaque canvas atlas.
flipped = b''.join(pixels[row*stride:(row+1)*stride] for row in reversed(range(data['height'])))
texture = context.texture((data['width'], data['height']), 4, flipped)
texture.filter = (moderngl.NEAREST, moderngl.NEAREST)
texture.use(0)
uniform('u_terrainMask').value = 0
target = context.simple_framebuffer((128, 8), components=4)
target.use()
identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

def render(scenario, mode, camera_offset=0):
    uniform('u_verticalExaggeration').value = scenario['exaggeration']
    uniform('u_radarToWorld').write(struct.pack('16f', *scenario['radarToWorld']))
    eye_to_radar = identity.copy()
    eye_to_radar[12] = camera_offset
    uniform('u_eyeToRadar').write(struct.pack('16f', *eye_to_radar))
    uniform('u_maskMode').value = mode
    left, right = scenario['endpoints']
    vertices = []
    for screen, point in [((-1, -1), left), ((1, -1), right), ((-1, 1), left), ((1, 1), right)]:
        vertices.extend([*screen, point[0]-camera_offset, point[1], point[2]])
    buffer = context.buffer(struct.pack('20f', *vertices))
    vao = context.vertex_array(program, [(buffer, '2f 3f', 'screen', 'eye')])
    target.clear(0, 0, 0, 0)
    vao.render(moderngl.TRIANGLE_STRIP)
    image = target.read(components=4)
    alpha = [image[(4*128+column)*4+3] for column in range(128)]
    vao.release()
    buffer.release()
    return alpha

for scenario in fixture['scenarios']:
    nominal = render(scenario, 0)
    covered = render(scenario, 1)
    shadow = render(scenario, 2)
    assert all(nominal), 'Nominal unmasked face must be visible'
    assert covered[4] and covered[-5] and not covered[64], 'Visible ends must not bridge the hidden interior'
    assert shadow[64] and not shadow[4] and not shadow[-5], 'Shadow must occupy the complementary hidden air'
    assert covered == render(scenario, 1, 1000), 'Camera changes must not move the terrain mask'
    print(f"PASS: {scenario['exaggeration']}x face interior clipped; visible corners, shadow, and camera alignment retained")

# Put the same obstruction in the DEM half of the atlas. Hidden air disappears
# when it is inside the physical mountain, including the shadow material.
mountain_pixels = bytearray(pixels)
for column in range(data['width']):
    offset = ((data['azimuthCount'] + 2)*data['width'] + column)*4
    encoded = 700-data['heightOffsetM']
    mountain_pixels[offset] = encoded >> 8
    mountain_pixels[offset+1] = encoded & 255
flipped_mountain = b''.join(mountain_pixels[row*stride:(row+1)*stride] for row in reversed(range(data['height'])))
texture.write(flipped_mountain)
for scenario in fixture['scenarios']:
    assert not render(scenario, 1)[64]
    assert not render(scenario, 2)[64], 'Shadow material must not be rendered inside terrain'
print('PASS: both covered and shadow fragments inside the mountain are discarded')
