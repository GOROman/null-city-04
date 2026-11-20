"""Export the current Blender assembly as a PBR GLB with a scrub-able assembly animation.

Run: blender -b NULL_CITY_NC04.blend --python-exit-code 1 -P scripts/export_web_model.py
"""
from pathlib import Path
import bpy
import hashlib
import json
import struct
from mathutils import Vector

root=Path(__file__).resolve().parents[1]
out=root/'web/public/model';out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
scene.render.fps=24;scene.frame_set(2)
pivot=next(o for o in scene.objects if o.name.startswith("Tab5 removable cradle"))
pivot.animation_data_clear()
pivot.name="Tab5TiltPivot"
scene.frame_start=1;scene.frame_end=25
geometry=[o for o in scene.objects if o.type in ('MESH','CURVE','FONT') and o.name!='STUDIO_floor']
print_part_count=sum(o.name.startswith(('PRINT_', 'NC04 upper frame', 'White moving cradle')) for o in geometry)

def displacement(name):
    if name.startswith(('NC04 upper frame','Front flat decal','Left flat decal','Right flat decal')):return (0,0,32)
    if name=='Tab5TiltPivot':return (0,0,115)
    if name.startswith(('M3 pivot screw','M3 brass insert')):
        return (34 if bpy.data.objects[name].location.x>0 else -34,0,32 if name.startswith('M3 pivot screw') else 0)
    if name.startswith('M5Stack Tab5'):return (0,0,40)
    if name.startswith(('Top flat decal','Flush cyan pinstripe')):return (0,0,70)
    if name.startswith('PRINT_USB_bridge'):return (0,0,13)
    if name.startswith('PRINT_PLA'):return (0,0,-12)
    if name=='PRINT_light_front_diffuser' or name.startswith(('VISUAL_front_mask','VISUAL_NULL_CITY_wordmark','VISUAL_front_slash')):return (0,-22,0)
    if name=='PRINT_light_left_diffuser':return (-22,0,0)
    if name=='PRINT_light_right_diffuser':return (22,0,0)
    if 'control_panel' in name or name.startswith(('VISUAL_LED','VISUAL_switch','VISUAL_menu','VISUAL_shaft','VISUAL_dust','VISUAL_purple','VISUAL_M3','PRINT_button','PRINT_menu')):return (0,0,70)
    return (0,0,0)

indicator=bpy.data.materials.new("Indicator LED RGB")
indicator.use_nodes=True
shader=indicator.node_tree.nodes.get("Principled BSDF")
shader.inputs["Emission Color"].default_value=(0.015,0.6,1,1)
shader.inputs["Emission Strength"].default_value=2
for obj in geometry:
    if obj.name.startswith('VISUAL_LED_package_'):
        obj.name=obj.name.replace('LED_package_', 'LED_')
        obj.data.materials.clear()
        obj.data.materials.append(indicator)

bpy.ops.object.select_all(action='DESELECT')
for obj in [*geometry,pivot]:
    obj.select_set(True)
    start=obj.location.copy();delta=Vector(displacement(obj.name))
    if delta.length:
        obj.location=start;obj.keyframe_insert(data_path='location',frame=1)
        obj.location=start+delta;obj.keyframe_insert(data_path='location',frame=25)
    obj['part_name']=obj.name
scene.frame_set(1)
bpy.context.view_layer.update()
path=out/'nc04.glb'
bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,
    export_apply=True,export_yup=True,export_extras=True,export_animations=True,
    export_animation_mode='SCENE',export_frame_range=True,export_frame_step=1,
    export_bake_animation=True,export_copyright='Copyright 2026 GOROman; CC BY 4.0. See https://github.com/GOROman/null-city-04/blob/main/LICENSE')
# A stable public animation name keeps the viewer independent of Blender's scene naming.
raw=path.read_bytes();length,kind=struct.unpack_from('<II',raw,12)
assert kind==0x4E4F534A
doc=json.loads(raw[20:20+length])
assert doc.get('animations'),'Missing assembly movement'
merged={'name':'Assembly','channels':[],'samplers':[]}
for animation in doc['animations']:
    offset=len(merged['samplers']);merged['samplers'].extend(animation['samplers'])
    for channel in animation['channels']:
        target=channel['target']
        if doc['nodes'][target['node']].get('name')==pivot.name and target['path']!='translation':
            continue
        channel['sampler']+=offset;merged['channels'].append(channel)
doc['animations']=[merged]
# Blender's exporter leaves mesh and translation values in mm; one root converts both to glTF meters.
for scene_doc in doc['scenes']:
    index=len(doc['nodes']);doc['nodes'].append({'name':'NULL_CITY_meters','scale':[.001,.001,.001],'children':scene_doc['nodes']})
    scene_doc['nodes']=[index]
# Milk-white diffuser at rest; the separate RGB emissive channel represents LEDs.
for material in doc.get('materials',[]):
    if material.get('name')=='Backlit translucent PLA illustration':
        material['pbrMetallicRoughness']['baseColorFactor']=[.82,.84,.88,1]
doc['asset']['extras']={'project':'NULL CITY NC-04','units':'meters','lighting':'illustration; hardware validation pending'}
data=json.dumps(doc,separators=(',',':')).encode();data+=b' '*((-len(data))%4)
rest=raw[20+length:]
path.write_bytes(struct.pack('<III',0x46546C67,2,20+len(data)+len(rest))+struct.pack('<II',len(data),0x4E4F534A)+data+rest)
inputs=['NULL_CITY_NC04.blend','NULL_CITY_NC04.py','artwork/lighting_layout.json',
        'artwork/control_layout.json','artwork/led_layout.json','artwork/logo/wordmark.json',
        'scripts/panel_features.py','artwork/usb_relief.json','scripts/usb_relief.py',
        'docs/references/tab5/Tab5.stl','docs/references/tab5/Tab5-rear.jpg','scripts/export_web_model.py']
manifest={'name':'NULL CITY NC-04','license':'CC-BY-4.0','geometry_count':len(geometry),
          'print_part_count':print_part_count,'dimensions_mm':[300,190,55],
          'inputs':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in inputs},
          'glb_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Exported',len(geometry),'objects;',path.stat().st_size,'bytes; PBR materials and Assembly animation')
