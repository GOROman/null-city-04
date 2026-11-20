import bpy, os, json
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
OUT=os.path.dirname(os.path.abspath(__file__))
BUILD_NC04_BASE = globals().get('BUILD_NC04_BASE', False)
def mat(n,c,metal=0,rough=.35):
 m=bpy.data.materials.new(n);m.diffuse_color=(*c,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
ivory=mat('Pearl white PETG',(.85,.86,.92));navy=mat('Deep navy',(.012,.019,.075));green=mat('Lime green',(.018,.72,.001));clear=mat('Transparent button placeholder',(.65,.8,.95));purple=mat('Purple balltop',(.26,.015,.72),.1,.12);pink=mat('Magenta accent',(.95,.01,.43));black=mat('Black',(.018,.018,.025))
def cube(n,loc,dim,ma=None,bev=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=n;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bev: mod=o.modifiers.new('Rounded printable edges','BEVEL');mod.width=bev;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 if ma:o.data.materials.append(ma)
 return o
def cyl(n,x,y,z,r,depth,ma=None,verts=64):
 bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=r,depth=depth,location=(x,y,z));o=bpy.context.object;o.name=n
 if ma:o.data.materials.append(ma)
 return o
def boolean(obj,tool,operation):
 bpy.context.view_layer.objects.active=obj;mod=obj.modifiers.new('Machined clearance','BOOLEAN');mod.operation=operation;mod.object=tool
 bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(tool,do_unlink=True)
def cut(obj,tool):
 boolean(obj,tool,'DIFFERENCE')
def bake(obj):
 bpy.context.view_layer.objects.active=obj
 for modifier in list(obj.modifiers):
  bpy.ops.object.modifier_apply(modifier=modifier.name)
# Octagonal perimeter, with independent inset rings for the lower and upper bevels.
def shell(name, levels, material):
 vertices=[]
 for z,w,d,c in levels:
  x,y=w/2,d/2
  vertices.extend([(u,v,z) for u,v in [(-x+c,-y),(x-c,-y),(x,-y+c),(x,y-c),(x-c,y),(-x+c,y),(-x,y-c),(-x,-y+c)]])
 faces=[tuple(reversed(range(8)))]
 for k in range(len(levels)-1):
  for j in range(8):
   a=k*8+j;b=k*8+(j+1)%8
   faces.append((a,b,b+8,a+8))
 faces.append(tuple(range(len(vertices)-8,len(vertices))))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
 obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(material)
 return obj

def front_prism(name,outline,y0,y1,material,back=None):
 # outline is counterclockwise in X,Z; positive face normal is toward the front.
 # back, when given, is the outline at y1 (same vertex count) for a tapered prism.
 v=[(x,y0,z) for x,z in outline]+[(x,y1,z) for x,z in (back or outline)];n=len(outline)
 faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]
 for i in range(n):
  j=(i+1)%n;faces.append((j,i,i+n,j+n))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(v,[],faces);mesh.update()
 obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(material)
 return obj

def polish(obj):
 for face in obj.data.polygons:
  if abs(face.normal.z)<.98:face.use_smooth=True

base=shell('PRINT_01_lower_tray',[(0,290,180,7),(3,298,188,8),(5,300,190,8),(24,300,190,8)],ivory)
cut(base,cube('Lower cavity',(0,0,17),(288,178,24)))
# Rear cable notch opens at the split line so the USB plug need not pass through.
# 8 mm wide x 6 mm deep below Z=24; rear wall is Y=89..95.
if not BUILD_NC04_BASE:
 cut(base,cube('USB cable exit notch',(0,94,22),(8,16,8)))
import sys
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),'scripts'))
from usb_relief import add_usb_relief
rim=shell('PRINT_02_upper_frame',[(24,300,190,8),(38,300,190,8),(43,292,182,6)],ivory)
cut(rim,cube('Upper opening',(0,0,34),(274,164,28)))
# C0.5 on both upper and lower outer edges, including all four sides and clipped corners.
# The corner offset preserves the same 45-degree bevel width on the diagonal edges.
panel_chamfer=.5
corner_inset=5-(2-2**.5)*panel_chamfer
panel=shell('PRINT_03_control_panel',[(43,287,177,corner_inset),(43.5,288,178,5),(46.5,288,178,5),(47,287,177,corner_inset)],navy)

# Serviceable lighting pockets: retain 1.4 mm of the original 6 mm wall behind each strip.
# Profiles are created in their flat print plane; world matrices place them on the housing.
from mathutils import Matrix
from math import tan, radians
def profile_plate(name,outline,depth,material,top_outline=None):
 if sum(outline[i][0]*outline[(i+1)%len(outline)][1]-outline[(i+1)%len(outline)][0]*outline[i][1] for i in range(len(outline)))<0:
  outline=list(reversed(outline))
  if top_outline:top_outline=list(reversed(top_outline))
 n=len(outline);vertices=[(x,y,0) for x,y in outline]+[(x,y,depth) for x,y in (top_outline or outline)]
 faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
 for i in range(n):
  j=(i+1)%n;faces.append((i,j,n+j,n+i))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
 obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
 if material:obj.data.materials.append(material)
 return obj

def emission(name,color,strength):
 m=mat(name,color);bs=m.node_tree.nodes.get('Principled BSDF')
 bs.inputs['Emission Color'].default_value=(*color,1);bs.inputs['Emission Strength'].default_value=strength
 return m
lightbar=emission('Magenta lighting illustration',(1,.008,.36),4)
diffuser_material=emission('Backlit translucent PLA illustration',(1,.025,.45),2.5)
# The real part is milk-white / translucent PLA; emission illustrates the separate LED source.
front_frame=Matrix.Rotation(radians(90),4,'X')
with open(os.path.join(OUT,'artwork','lighting_layout.json')) as f:lighting_config=json.load(f)
front=lighting_config['front'];side_config=lighting_config['side']
# Two recess depths leave a solid perimeter shoulder behind the lens.
for name,back,top,start,depth in [
 ('inner',front['inner_back'],front['inner_seat'],0,front['seat_depth_mm']),
 ('outer',front['outer_back'],front['outer_front'],front['seat_depth_mm'],front['outer_depth_mm']-front['seat_depth_mm'])]:
 tool=profile_plate('Front LED pocket '+name,back,depth,None,top)
 tool.matrix_world=Matrix.Translation(front['frame_origin_mm'])@front_frame@Matrix.Translation((0,0,start));cut(base,tool)
front_lens=profile_plate('PRINT_light_front_diffuser',front['lens_back'],lighting_config['diffuser_thickness_mm'],diffuser_material,front['lens_front'])
front_lens.matrix_world=Matrix.Translation(front['lens_origin_mm'])@front_frame
front_prism('VISUAL_front_mask',front['mask_outline'],-95.15,-95.01,black)
front_prism('VISUAL_front_LED_strip',front['strip_outline'],*front['strip_y_mm'],lightbar)
slope=tan(radians(side_config['slope_degrees']))
for sign,side in [(-1,'left'),(1,'right')]:
 # Profile coordinates describe physical Y; reflect local U on the left for true X mirroring.
 orient=Matrix(((0,0,sign,0),(sign,0,0,0),(0,1,0,0),(0,0,0,1)))
 def side_points(key,center=None):return [(sign*y,(side_config['center_z_mm'] if center is None else center)+slope*y+dz) for y,dz in side_config[key]]
 for name,back,top,start,depth in [
  ('inner','inner_back','inner_seat',0,side_config['seat_depth_mm']),
  ('outer','outer_seat','outer_front',side_config['seat_depth_mm'],side_config['outer_depth_mm']-side_config['seat_depth_mm'])]:
  pocket=profile_plate('Side LED pocket '+side+' '+name,side_points(back),depth,None,side_points(top))
  pocket.matrix_world=Matrix.Translation((sign*side_config['pocket_origin_abs_x_mm'],0,0))@orient@Matrix.Translation((0,0,start));cut(base,pocket)
 lens=profile_plate('PRINT_light_'+side+'_diffuser',side_points('lens_back'),lighting_config['diffuser_thickness_mm'],diffuser_material,side_points('lens_front'))
 lens.matrix_world=Matrix.Translation((sign*side_config['lens_origin_abs_x_mm'],0,0))@orient
 source=profile_plate('VISUAL_side_LED_strip_'+side,side_points('strip_outline',side_config['strip_center_z_mm']),side_config['strip_depth_mm'],lightbar)
 source.matrix_world=Matrix.Translation((sign*side_config['strip_origin_abs_x_mm'],0,0))@orient
 for y in side_config['wire_y_mm']:
  tool=cyl('Side LED wire passage',sign*145,y,13.5+slope*y,1.6,12)
  tool.rotation_euler.y=radians(90);cut(base,tool)
for x in (-90,90):
 tool=cyl('Front LED wire passage',x,-90,13.5,1.6,10)
 tool.rotation_euler.x=radians(90);cut(base,tool)
from math import radians
# Use the same original outline wordmark as the printed deck, with no font dependency.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'artwork','logo','wordmark.json')) as f:
 wordmark=json.load(f)
wordmark_material=emission('Cool white lettering',(.65,.82,1),2)
for i,glyph in enumerate(wordmark['polygons']):
 outline=[(lighting_config['front_wordmark_left_mm']+x*lighting_config['front_wordmark_scale'],lighting_config['front_wordmark_baseline_mm']+(100-y)*lighting_config['front_wordmark_scale']) for x,y in glyph['points']]
 area=sum(outline[j][0]*outline[(j+1)%len(outline)][1]-outline[(j+1)%len(outline)][0]*outline[j][1] for j in range(len(outline)))
 if area<0:outline.reverse()
 front_prism('VISUAL_NULL_CITY_wordmark_%02d'%i,outline,-95.3,-95.2,wordmark_material)
for x in front['slash_x_mm']:
 z=front['slash_bottom_z_mm'];w=front['slash_width_mm'];h=front['slash_height_mm'];lean=front['slash_shear_mm']
 front_prism('VISUAL_front_slash',[(x,z),(x+w,z),(x+w+lean,z+h),(x+lean,z+h)],-95.3,-95.2,lightbar)

steel=mat('Polished steel',(.64,.68,.78),.94,.19)
glass=clear;bs=glass.node_tree.nodes.get('Principled BSDF');bs.inputs['Transmission Weight'].default_value=.94;bs.inputs['IOR'].default_value=1.48;bs.inputs['Roughness'].default_value=.12
bs=purple.node_tree.nodes.get('Principled BSDF');bs.inputs['Transmission Weight'].default_value=.48;bs.inputs['Coat Weight'].default_value=.65
bs=green.node_tree.nodes.get('Principled BSDF');bs.inputs['Coat Weight'].default_value=.45
def cap(name,x,y,r,material):
 o=cyl(name,x,y,49,r,5,material)
 bevel=o.modifiers.new('Rounded cap lip','BEVEL');bevel.width=1.2;bevel.segments=4
 polish(o)
def bezel(name,x,y,r,material):
 bpy.ops.mesh.primitive_torus_add(location=(x,y,47.9),major_radius=r,minor_radius=1.45,major_segments=80,minor_segments=12)
 o=bpy.context.object;o.name=name;o.data.materials.append(material);polish(o)
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'artwork','control_layout.json')) as f:
 control_layout=json.load(f)
buttons=control_layout['buttons']
lever_x,lever_y=control_layout['lever']
for i,(x,y) in enumerate(buttons):
 cut(panel,cyl('button bore',x,y,45,control_layout['main_button_hole_diameter_mm']/2,12))
 m=green if i<3 else glass
 cap('PRINT_button_cap_%02d'%i,x,y,14.1,m);bezel('VISUAL_switch_bezel_%02d'%i,x,y,15.4,m)
# 1P moves 33 mm toward the rear; START retains its original position.
menu_buttons=control_layout['menu_buttons']
for i,(x,y) in enumerate(menu_buttons):
 cut(panel,cyl('menu bore',x,y,45,control_layout['menu_button_hole_diameter_mm']/2,12));cap('PRINT_menu_cap_%d'%i,x,y,11.2,green);bezel('VISUAL_menu_bezel_%d'%i,x,y,12,green)
# Square windows, rear serial-pixel seats and co-printed recessed logo.
with open(os.path.join(OUT,'artwork','led_layout.json')) as f:led_layout=json.load(f)
led_material=emission('Indicator LED RGB',(.02,.65,1),2)
from panel_features import add_features,finish_panel
panel_colors=add_features(panel,OUT,cube,cut,boolean,navy,mat('Co-printed logo white',(.93,.94,.98)),pink,led_material)
# Direct housing mount confirmed with the 40 x 40 x 4 mm fit coupon.
mount=control_layout['lever_mount']
assert mount['mounting_mode']=='direct_housing'
for dx in (-mount['pitch_mm'][0]/2,mount['pitch_mm'][0]/2):
 for dy in (-mount['pitch_mm'][1]/2,mount['pitch_mm'][1]/2):
  cut(panel,cyl('Original screw clearance',lever_x+dx,lever_y+dy,45,mount['clearance_diameter_mm']/2,12))
# No MS plate or spacers; keep the upper opening intact.
cut(panel,cyl('lever opening',lever_x,lever_y,45,12,12))
cyl('VISUAL_dust_washer',lever_x,lever_y,47.8,18,1.6,black)
cyl('VISUAL_shaft',lever_x,lever_y,59,4.2,24,steel)
bpy.ops.mesh.primitive_uv_sphere_add(segments=72,ring_count=40,radius=14.5,location=(lever_x,lever_y,80))
o=bpy.context.object;o.name='VISUAL_purple_balltop';o.data.materials.append(purple);polish(o)
for x in (-135,135):
 for y in (-80,80):
  for obj,z,depth in [(base,14,20),(rim,33.5,19)]:
   boolean(obj,cyl('corner boss',x,y,z,11,depth),'UNION')
  # 7.5 mm deep from the Z=24 split line: 6 mm insert plus 1.5 mm relief for displaced plastic.
  cut(base,cyl('M3 insert pilot',x,y,20.75,2.05,8.5))
  cut(rim,cyl('M3 clearance',x,y,33.5,1.7,24));cut(panel,cyl('M3 clearance',x,y,45,1.7,8))
  screw=cyl('VISUAL_M3_button_head',x,y,48,3.25,2,steel)
  cut(screw,cyl('hex socket',x,y,49,1.25,1.8,None,6))
for x in (-113,113):
 for y in (-66,66):cyl('PRINT_TPU_foot_%d_%d'%(x,y),x,y,-2,11,4,black)
if not BUILD_NC04_BASE:
 add_usb_relief(base,ivory,cube,cyl,boolean,cut,os.path.dirname(os.path.abspath(__file__)))
mono_panel_mesh=finish_panel(panel,panel_colors,OUT,boolean)
# Use planar local coordinates for the exposed deck, preserving physical holes.
texture=mat('Printed PLA blue deck',(.012,.019,.075),.03,.38)
panel.data.materials.append(texture);texture_index=len(panel.data.materials)-1;uv=panel.data.uv_layers.new(name='Deck artwork')
uv.active_render=True
for face in panel.data.polygons:
 if face.normal.z>.999 and face.center.z>46.9:face.material_index=texture_index
 # Decal remains an optional artwork asset; the print preview shows actual filament colors.
 for li in face.loop_indices:
  v=panel.data.vertices[panel.data.loops[li].vertex_index].co
  uv.data[li].uv=(v.x/288+.5,v.y/178+.5)
img=bpy.data.images.load(os.path.join(os.path.dirname(os.path.abspath(__file__)),'artwork','panel.png'));img.pack()
tex=texture.node_tree.nodes.new('ShaderNodeTexImage');tex.image=img
# The optional decal image is packed for editing, but the rendered print uses actual PLA regions.
# Rotate the deck and its controls together; slope only the upper portion of the frame.
from mathutils import Matrix
tilt=Matrix.Translation((0,0,43)) @ Matrix.Rotation(radians(2.55),4,'X') @ Matrix.Translation((0,0,-43))
for obj in list(bpy.context.scene.objects):
 if obj==rim:
  for v in obj.data.vertices:
   if v.co.z>24.001:
    mix=(v.co.z-24)/19
    v.co=v.co.lerp(tilt @ v.co,min(1,mix))
 elif obj==panel or obj in panel_colors or obj.name.startswith('VISUAL_LED_') or obj.location.z>=43:
  obj.matrix_world=tilt @ obj.matrix_world
bpy.context.view_layer.update()
def aim(obj,point):obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene
scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=.001;scene.unit_settings.length_unit='MILLIMETERS'
bpy.ops.object.camera_add(location=(130,-760,520))
camera=bpy.context.object;aim(camera,(0,0,31));camera.data.type='PERSP';camera.data.lens=70;camera.data.sensor_width=36;camera.data.sensor_fit='HORIZONTAL';camera.data.clip_end=2000;scene.camera=camera
for name,pos,power,size,color in [('Softbox left',(-190,-140,250),1500000,170,(.88,.91,1)),('Front',(130,-200,140),820000,130,(1,.86,.94)),('Violet rim',(100,140,180),1450000,150,(.56,.34,1))]:
 bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=color;aim(o,(0,0,25))
floor=cube('STUDIO_floor',(0,0,-6),(2500,2500,4),mat('Studio graphite',(.022,.023,.036),.25,.32))
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.32,.34,.42,1)
scene.render.engine='CYCLES';scene.cycles.samples=96;scene.cycles.use_denoising=False
scene.render.resolution_x=1152;scene.render.resolution_y=730;scene.render.resolution_percentage=100
from render_camera import fit_perspective
fit_perspective(scene,(130,-760,520),(0,0,31))
if not BUILD_NC04_BASE:
 # Export each component in its local printing orientation, resting at Z=0.
 deps=bpy.context.evaluated_depsgraph_get()
 exportdir=os.path.join(OUT,'STL');os.makedirs(exportdir,exist_ok=True)
 for obj in list(scene.objects):
  if not obj.name.startswith('PRINT_'):continue
  mesh=mono_panel_mesh.copy() if obj==panel else bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
  mesh.transform(Matrix.Translation((0,0,-min(v.co.z for v in mesh.vertices))))
  temp=bpy.data.objects.new('Temporary export',mesh);scene.collection.objects.link(temp)
  bpy.ops.object.select_all(action='DESELECT');temp.select_set(True);bpy.context.view_layer.objects.active=temp
  bpy.ops.wm.stl_export(filepath=os.path.join(exportdir,obj.name+'.stl'),export_selected_objects=True)
  bpy.data.objects.remove(temp,do_unlink=True);bpy.data.meshes.remove(mesh)
bpy.ops.object.select_all(action='DESELECT');scene.render.image_settings.file_format='JPEG';scene.render.filepath='//preview.jpg'
for area in bpy.context.screen.areas:
 if area.type=='VIEW_3D':
  area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.clip_end=2500
bpy.context.preferences.filepaths.save_version=0
if not BUILD_NC04_BASE:
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'NULL_CITY_NC03.blend'),compress=True)
