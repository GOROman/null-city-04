"""Build the NC-04 Tab5 dock and enclosure study from the NC-03 assembly."""

import json
from math import radians
import struct
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parent
TAB5_WIDTH = 128.0
SIDE_CLEARANCE = 0.7
PIVOT = (0, 80, 61)
REFERENCES = ROOT / "docs" / "references" / "tab5"
sys.path.insert(0, str(ROOT / "scripts"))
from panel_features import prism
TILT_ANGLES = (15, 30, 45)


def material(name, color):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1)
    result.use_nodes = True
    shader = result.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*color, 1)
    return result


def box(name, size, position, finish, parent=None, bevel=0.7):
    bpy.ops.mesh.primitive_cube_add(size=1)
    part = bpy.context.object
    part.name = name
    part.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    part.parent = parent
    part.location = position
    part.data.materials.append(finish)
    if bevel:
        corners = part.modifiers.new("Edge radius", "BEVEL")
        corners.width = bevel
        corners.segments = 3
        part.modifiers.new("Weighted normals", "WEIGHTED_NORMAL")
    return part


def cylinder(name, radius, width, position, parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=width)
    part = bpy.context.object
    part.name = name
    part.parent = parent
    part.location = position
    part.rotation_euler.y = radians(90)
    return part


def boolean(part, tool, operation):
    modifier = part.modifiers.new(operation.title(), "BOOLEAN")
    modifier.operation = operation
    modifier.object = tool
    part.modifiers.move(len(part.modifiers) - 1, 0)
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(tool, do_unlink=True)


def bore(part, radius, width, position, parent=None):
    cutter = cylinder("Bore cutter", radius, width, position, parent)
    boolean(part, cutter, "DIFFERENCE")


def add_shoulders(frame, white):
    # The lower polygon overlaps the frame's rear wall, outside the deck opening.
    profile = [(86, 36), (94, 36), (94, 47), (86, 66), (79, 69),
               (73, 67), (71, 61), (75, 55), (82, 53), (90, 50)]
    to_world = Matrix(((0, 0, 1, 0), (1, 0, 0, 0),
                       (0, 1, 0, 0), (0, 0, 0, 1)))
    for x in (-74, 74):
        shoulder = prism("Integrated shoulder", profile, x - 4.5, x + 4.5, white)
        shoulder.data.transform(to_world)
        bevel = shoulder.modifiers.new("Molded edge radius", "BEVEL")
        bevel.width = 1.4
        bevel.segments = 4
        boolean(frame, shoulder, "UNION")
        bore(frame, 1.7, 11, (x, *PIVOT[1:]))
    feedthrough = box("GPIO harness feedthrough cutter", (18, 19, 8), (9.5, 89, 32), white, bevel=2)
    boolean(frame, feedthrough, "DIFFERENCE")
    frame.name = "NC04 upper frame • integral white cradle shoulders"


def add_tab5(pivot, case, glass):
    rear = material("Tab5 rear • M5Stack reference photograph", (0.5, 0.5, 0.5))
    image = bpy.data.images.load(str(REFERENCES / "Tab5-rear.jpg"))
    image.pack()
    nodes = rear.node_tree.nodes
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    rear.node_tree.links.new(texture.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])

    stl = (REFERENCES / "Tab5.stl").read_bytes()
    vertices = {}
    faces = []
    for triangle in struct.iter_unpack("<12fH", memoryview(stl)[84:]):
        points = [triangle[i:i + 3] for i in (3, 6, 9)]
        if not all(y > 0 for _, y, _ in points):
            continue
        face = []
        for x, y, z in points:
            point = (round(64 - x, 5), round(-z - 6, 5), round(80.89014 - y + 6.5, 5))
            face.append(vertices.setdefault(point, len(vertices)))
        if len(set(face)) == 3:
            faces.append(face)
    mesh = bpy.data.meshes.new("M5Stack C145 assembled STL")
    mesh.from_pydata(list(vertices), [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name="Rear photograph projection")
    for finish in (case, glass, rear):
        mesh.materials.append(finish)
    for face in mesh.polygons:
        if face.normal.y > 0.55 and face.center.y > -1:
            face.material_index = 2
        elif face.normal.y < -0.55 and face.center.y < -5.2:
            face.material_index = 1
        for index in face.loop_indices:
            x, _, z = mesh.vertices[mesh.loops[index].vertex_index].co
            uv.data[index].uv = (0.5 - x / 128, (z - 6.5) / 80)
    tab = bpy.data.objects.new("M5Stack Tab5 • official assembled CAD", mesh)
    bpy.context.collection.objects.link(tab)
    tab.parent = pivot
    # The manufacturer STL models the structure. The thin glass cap closes its open front.
    box("Tab5 front glass cover", (127, 0.32, 79), (0, -6, 46.5), glass, tab, bevel=0.13)
    # Envelope located from the manufacturer's rear photograph, for connector access checks.
    connector = material("M5-Bus plug envelope", (0.045, 0.20, 0.24))
    box("M5-Bus GPIO plug envelope", (9, 10, 38), (9.5, 11.1, 46.5), connector, tab)


def set_color(material_name, color, emission=False):
    finish = bpy.data.materials[material_name]
    finish.diffuse_color = (*color, 1)
    shader = finish.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*color, 1)
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)


def decal(name, text, transform, width, finish, font):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = text
    curve.align_x = "CENTER"
    curve.font = font
    mark = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(mark)
    curve.materials.append(finish)
    mark.matrix_world = transform
    bpy.context.view_layer.update()
    curve.size *= width / (max(v[0] for v in mark.bound_box) - min(v[0] for v in mark.bound_box))


def add_flat_graphics(ink, accent):
    panel = bpy.data.objects["PRINT_03_control_panel"]
    # Bring the existing wordmark pockets flush with the deck, then weld their walls.
    bm = bmesh.new()
    bm.from_mesh(panel.data)
    for vertex in bm.verts:
        if abs(vertex.co.z - 45.8) < 1e-4:
            vertex.co.z = 47
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0001)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0001, edges=list(bm.edges))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(panel.data)
    bm.free()
    panel.data.update()
    panel.data.materials.clear()
    panel.data.materials.append(bpy.data.materials["Pearl white PETG"])
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith(("COLOR_control_panel_", "VISUAL_NULL_CITY_wordmark_", "VISUAL_front_slash")):
            bpy.data.objects.remove(obj, do_unlink=True)

    font = bpy.data.fonts.load(str(ROOT / "fonts" / "null-font" / "NULLFont-Italic.ttf"))
    font.pack()
    top = panel.matrix_world @ Matrix.Translation((0, -67, 47.035))
    decal("Top flat decal", "NULL CITY IV", top, 143, ink, font)
    for x in (-106, 106):
        stripe = box("Flush cyan pinstripe", (42, 1.7, 0.025), (0, 0, 0), accent, bevel=0)
        stripe.matrix_world = panel.matrix_world @ Matrix.Translation((x, -75, 47.028))
    # Map the text's X axis along each flat exterior face and Y axis vertically.
    for name, origin, horizontal, outward in (
        ("Front", (0, -95.04, 27), (1, 0, 0), (0, -1, 0)),
        ("Left", (-150.04, 0, 27), (0, -1, 0), (-1, 0, 0)),
        ("Right", (150.04, 0, 27), (0, 1, 0), (1, 0, 0)),
    ):
        surface = Matrix((horizontal, (0, 0, 1), outward)).transposed().to_4x4()
        surface.translation = origin
        decal(name + " flat decal", "NULL CITY IV", surface, 65, ink, font)


def expose_led_openings():
    # The NC-03 deck already has through cuts and rear module seats. Remove the
    # near-surface luminous placeholders so the NC-04 openings render uncovered.
    layout = json.loads((ROOT / "artwork" / "led_layout.json").read_text())
    for led in layout["leds"]:
        placeholder = bpy.data.objects["VISUAL_LED_" + led["name"]]
        bpy.data.objects.remove(placeholder, do_unlink=True)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / "NULL_CITY_NC03.blend"))
    white = bpy.data.materials["Pearl white PETG"]
    device = material("Tab5 housing reference", (0.74, 0.75, 0.77))
    display = material("Tab5 front glass", (0.012, 0.019, 0.026))
    hardware = material("M3 dark screw heads", (0.085, 0.10, 0.12))
    brass = material("M3 brass insert reference", (0.46, 0.25, 0.055))
    ink = material("Decal • graphite ink", (0.018, 0.034, 0.05))
    accent = material("Decal • cyan ink", (0.008, 0.48, 0.72))
    set_color("Purple balltop", (0.025, 0.061, 0.095))
    set_color("Lime green", (0.009, 0.38, 0.60))
    set_color("Magenta lighting illustration", (0.018, 0.38, 0.65), emission=True)
    set_color("Backlit translucent PLA illustration", (0.026, 0.53, 0.79), emission=True)
    bpy.data.objects["Violet rim"].data.color = (0.83, 0.91, 1.0)
    add_flat_graphics(ink, accent)
    expose_led_openings()
    add_shoulders(bpy.data.objects["PRINT_02_upper_frame"], white)
    white.name = "NC-04 white PLA"
    for part in bpy.context.scene.objects:
        if part.name.startswith("PRINT_TPU"):
            part.name = part.name.replace("PRINT_TPU", "PRINT_PLA", 1)

    pivot = bpy.data.objects.new("Tab5 removable cradle • tilt pivot", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = PIVOT
    cradle = box("White moving cradle", (138, 15, 10), (0, 0, 0), white, pivot, bevel=1.3)
    for side in (-1, 1):
        rail_x = side * (TAB5_WIDTH / 2 + SIDE_CLEARANCE + 1.6)
        rails = (
            box("Lower seat", (27, 16, 3), (side * 55, 0, 5), white, pivot),
            box("Short slide-in guide", (3.2, 17.6, 15), (rail_x, 0, 11), white, pivot),
            box("Front retaining lip", (4.5, 2.4, 10), (side * 63, -8.0, 10), white, pivot),
            box("Rear retaining lip", (7, 2.4, 10), (side * 62.5, 8.0, 10), white, pivot),
        )
        for rail in rails:
            boolean(cradle, rail, "UNION")
        # The M3 × 40 screw threads through the end insert and enters this blind relief.
        bore(cradle, 1.7, 33, (side * 53.5, 0, 0), pivot)
        bore(cradle, 2.0, 6, (side * 66.5, 0, 0), pivot)
        insert = cylinder("M3 brass insert • reference", 2.25, 4.5, (side * 66.5, 0, 0), pivot)
        bore(insert, 1.25, 6, (side * 66.5, 0, 0), pivot)
        insert.data.materials.append(brass)
        screw = cylinder("M3 pivot screw shank", 1.5, 40, (side * 58.5, *PIVOT[1:]))
        screw.data.materials.append(hardware)
        head = cylinder("M3 pivot screw head", 2.75, 2.5, (side * 79.75, *PIVOT[1:]))
        head.data.materials.append(hardware)

    add_tab5(pivot, device, display)

    for frame, angle in enumerate(TILT_ANGLES, start=1):
        pivot.rotation_euler.x = radians(-angle)
        pivot.keyframe_insert(data_path="rotation_euler", index=0, frame=frame)

    scene = bpy.context.scene
    scene.frame_end = len(TILT_ANGLES)
    scene.frame_set(2)
    camera = scene.camera
    camera.location = (225, -730, 460)
    camera.rotation_euler = (
        Vector((0, 0, 62)) - camera.location
    ).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 60
    scene.render.filepath = "//preview-nc04.jpg"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "NULL_CITY_NC04.blend"), compress=True)
    bpy.ops.render.render(write_still=True)

    camera.location = (250, 670, 420)
    camera.rotation_euler = (
        Vector((0, 15, 65)) - camera.location
    ).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = "//preview-nc04-rear.jpg"
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
