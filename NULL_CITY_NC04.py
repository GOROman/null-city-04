"""Build the NC-04 Tab5 dock and enclosure study from the NC-03 assembly."""

import json
from math import copysign, radians, sqrt, tan
import struct
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parent
TAB5_WIDTH = 128.0
SIDE_CLEARANCE = 0.7
PIVOT = (0, 80, 67)
GPIO_X = -38
GPIO_Y = 12.5
GPIO_CABLE_START = (GPIO_X, 15.7, 4.6)
GPIO_CABLE_ENTRY = (GPIO_X, 96, 32)
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


def cylinder(name, radius, width, position, parent=None, axis="X"):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=width)
    part = bpy.context.object
    part.name = name
    part.parent = parent
    part.location = position
    if axis == "X":
        part.rotation_euler.y = radians(90)
    elif axis == "Y":
        part.rotation_euler.x = radians(90)
    return part


def boolean(part, tool, operation, solver="EXACT"):
    modifier = part.modifiers.new(operation.title(), "BOOLEAN")
    modifier.operation = operation
    modifier.solver = solver
    modifier.object = tool
    part.modifiers.move(len(part.modifiers) - 1, 0)
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(tool, do_unlink=True)


def bore(part, radius, width, position, parent=None, axis="X"):
    cutter = cylinder("Bore cutter", radius, width, position, parent, axis)
    boolean(part, cutter, "DIFFERENCE")


def thin_tray_floor(tray, white):
    # Remove material from the inside. The outside stays flat on the build plate.
    floor_cut = box("Floor thinning cutter", (280, 170, 3.2), (0, 0, 3.8), white, bevel=0)
    usb_keepout = box("USB guide keep-out", (76, 67, 8), (-22, 57.5, 4), white, bevel=0)
    boolean(floor_cut, usb_keepout, "DIFFERENCE")
    for x in (-113, 113):
        for y in (-66, 66):
            foot = cylinder("Foot pad keep-out", 15, 8, (x, y, 4))
            foot.rotation_euler.y = 0
            boolean(floor_cut, foot, "DIFFERENCE")
    for x in (-135, 135):
        for y in (-80, 80):
            boss = cylinder("Corner boss keep-out", 13, 8, (x, y, 4))
            boss.rotation_euler.y = 0
            boolean(floor_cut, boss, "DIFFERENCE")
    boolean(tray, floor_cut, "DIFFERENCE")


def finish_shell_edge(part, height, half_width, half_depth, corner, width):
    limits = (
        lambda v: abs(v.x) - half_width,
        lambda v: abs(v.y) - half_depth,
        lambda v: abs(v.x) + abs(v.y) - half_width - half_depth + corner,
    )
    weights = part.data.attributes.get("bevel_weight_edge")
    if weights is None:
        weights = part.data.attributes.new("bevel_weight_edge", "FLOAT", "EDGE")
    for edge in part.data.edges:
        a, b = (part.data.vertices[index].co for index in edge.vertices)
        if abs(a.z - height) < 0.001 and abs(b.z - height) < 0.001:
            if any(abs(limit(a)) < 0.001 and abs(limit(b)) < 0.001 for limit in limits):
                weights.data[edge.index].value = 1
    bevel = part.modifiers.new("Exterior edge finish", "BEVEL")
    bevel.limit_method = "WEIGHT"
    bevel.width = width
    bevel.segments = 3
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.modifier_apply(modifier=bevel.name)


def finish_deck_edges(panel, white):
    old_corner = 5 - (2 - sqrt(2)) * 0.5
    new_corner = 5 - (2 - sqrt(2)) * 0.9
    for vertex in panel.data.vertices:
        x, y, z = vertex.co
        if abs(z - 47) < 0.001:
            if abs(abs(x) - 143.5) < 0.001 and abs(abs(y) - (88.5 - old_corner)) < 0.001:
                vertex.co.x = copysign(143.1, x)
                vertex.co.y = copysign(88.1 - new_corner, y)
            elif abs(abs(y) - 88.5) < 0.001 and abs(abs(x) - (143.5 - old_corner)) < 0.001:
                vertex.co.x = copysign(143.1 - new_corner, x)
                vertex.co.y = copysign(88.1, y)
        elif abs(z - 46.5) < 0.001:
            if ((abs(abs(x) - 144) < 0.001 and abs(abs(y) - 84) < 0.001)
                or (abs(abs(y) - 89) < 0.001 and abs(abs(x) - 139) < 0.001)):
                vertex.co.z = 46.1

    layout = json.loads((ROOT / "artwork" / "led_layout.json").read_text())
    for led in layout["leds"]:
        x, y = led["x"], led["y"]
        corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
        vertices = [(x + dx * half, y + dy * half, z)
                    for z, half in ((46.6, 2), (47.12, 2.52)) for dx, dy in corners]
        faces = [(3, 2, 1, 0), (4, 5, 6, 7)]
        faces += [(i, (i + 1) % 4, (i + 1) % 4 + 4, i + 4) for i in range(4)]
        mesh = bpy.data.meshes.new("LED chamfer cutter")
        mesh.from_pydata(vertices, [], faces)
        cutter = bpy.data.objects.new("LED chamfer cutter", mesh)
        bpy.context.collection.objects.link(cutter)
        cutter.matrix_world = panel.matrix_world.copy()
        mesh.materials.append(white)
        boolean(panel, cutter, "DIFFERENCE")


def export_print_part(part, filename):
    mesh = bmesh.new()
    mesh.from_mesh(part.data)
    bmesh.ops.triangulate(mesh, faces=list(mesh.faces))
    bottom = min(vertex.co.z for vertex in mesh.verts)
    for vertex in mesh.verts:
        vertex.co.z -= bottom
    staging_mesh = bpy.data.meshes.new(filename)
    mesh.to_mesh(staging_mesh)
    mesh.free()
    staging = bpy.data.objects.new(filename, staging_mesh)
    bpy.context.collection.objects.link(staging)
    bpy.ops.object.select_all(action="DESELECT")
    staging.select_set(True)
    bpy.context.view_layer.objects.active = staging
    bpy.ops.wm.stl_export(filepath=str(ROOT / "STL" / filename), export_selected_objects=True)
    bpy.data.objects.remove(staging, do_unlink=True)
    bpy.data.meshes.remove(staging_mesh)


def add_shoulders(frame, white):
    # The lower polygon overlaps the frame's rear wall, outside the deck opening.
    profile = [(86, 36), (94, 36), (94, 47), (86, 72), (79, 75),
               (73, 73), (71, 70), (76, 64), (82, 58), (87, 53), (90, 50)]
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
    feedthrough = box("GPIO harness feedthrough cutter", (18, 19, 8), (GPIO_X, 89, 32), white, bevel=2)
    boolean(frame, feedthrough, "DIFFERENCE")
    frame.name = "NC04 upper frame • integral white cradle shoulders"


def add_tab5(pivot, case, glass, brass):
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
    add_display(tab)
    for x in (-59.8, 59.8):
        center = (x, 5.68, 10.75)
        factory_insert = cylinder("Tab5 factory M3 insert", 1.42, 0.6, center, tab, axis="Y")
        bore(factory_insert, 1.22, 1.2, center, tab, axis="Y")
        factory_insert.data.materials.append(brass)


def add_display(tab):
    finish = material("Tab5 HUD display", (0.018, 0.055, 0.085))
    nodes = finish.node_tree.nodes
    shader = nodes["Principled BSDF"]
    image = bpy.data.images.load(str(ROOT / "artwork" / "tab5-display.png"))
    image.pack()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    finish.node_tree.links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    finish.node_tree.links.new(texture.outputs["Color"], shader.inputs["Emission Color"])
    shader.inputs["Emission Strength"].default_value = 0.85
    mesh = bpy.data.meshes.new("Tab5 16:9 display")
    mesh.from_pydata([(-55.5,-6.188,15.28),(55.5,-6.188,15.28),
                      (55.5,-6.188,77.72),(-55.5,-6.188,77.72)], [], [(0,1,2,3)])
    for index, uv in enumerate(((0,0),(1,0),(1,1),(0,1))):
        if index == 0:
            uvs = mesh.uv_layers.new(name="Display UV")
        uvs.data[index].uv = uv
    screen = bpy.data.objects.new("Tab5DisplaySurface", mesh)
    bpy.context.collection.objects.link(screen)
    screen.parent = tab
    mesh.materials.append(finish)


def add_deck_hardware(tray, upper, panel, hardware, brass):
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith("VISUAL_M3_button_head"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for x in (-135, 135):
        for y in (-80, 80):
            top = (panel.matrix_world @ Vector((x, y, 47))).z
            # The long screw clears the shank below the existing insert pilot.
            bore(tray, 1.75, 13.9, (x, y, 9.65), axis="Z")
            bore(upper, 1.75, 30, (x, y, 35), axis="Z")
            deck_tool = cylinder("Vertical deck clearance", 1.75, 10, (x, y, top - 2), axis="Z")
            boolean(panel, deck_tool, "DIFFERENCE")
            insert = cylinder("Deck M3 insert", 2.05, 6, (x, y, 21), axis="Z")
            bore(insert, 1.25, 7, (x, y, 21), axis="Z")
            insert.data.materials.append(brass)
            screw = cylinder("Deck M3x40 screw shank", 1.5, 40, (x, y, top - 19.9), axis="Z")
            screw.data.materials.append(hardware)
            head = cylinder("Deck M3x40 screw head", 3.25, 2, (x, y, top + 1.1), axis="Z")
            bore(head, 1.25, 1.2, (x, y, top + 2), axis="Z")
            head.data.materials.append(hardware)


def add_tab5_retention(cradle, pivot, hardware):
    # These centers are in the two lower factory holes of the official Tab5 body STL.
    for x in (-59.8, 59.8):
        z = 10.75
        bore(cradle, 1.7, 5, (x, 8.4, z), pivot, axis="Y")
        washer = cylinder("Tab5 M3 flat washer", 3.5, 0.55, (x, 10.28, z), pivot, axis="Y")
        bore(washer, 1.6, 1, (x, 10.28, z), pivot, axis="Y")
        washer.data.materials.append(hardware)
        screw = cylinder("Tab5 rear M3 screw shank", 1.2, 8, (x, 6.55, z), pivot, axis="Y")
        screw.data.materials.append(hardware)
        head = cylinder("Tab5 rear M3 screw head", 2.75, 2, (x, 11.55, z), pivot, axis="Y")
        head.data.materials.append(hardware)


def anchor(name, position, parent=None):
    empty = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(empty)
    empty.parent = parent
    empty.location = position
    return empty


def cable_curve(name, positions, finish, parent=None):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 1.25
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(positions) - 1)
    for knot, point in zip(spline.points, positions):
        knot.co = (*point, 1)
    cable = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(cable)
    cable.parent = parent
    curve.materials.append(finish)
    return cable


def add_service_loop(start, entry, finish):
    bpy.context.view_layer.update()
    p0, p3 = start.matrix_world.translation, entry.matrix_world.translation
    p1 = p0 + Vector((0, 24, -4))
    p2 = p3 + Vector((0, 22, 0))
    points = []
    for i in range(41):
        t = i / 40
        q = 1 - t
        points.append(q**3 * p0 + 3*q*q*t * p1 + 3*q*t*t * p2 + t**3 * p3)
    cable_curve("GPIO service loop • 30 degree reference", points, finish)


def add_gpio_port(cradle, pivot, white, brass):
    # Put the extension socket behind the tilt axis so its plug clears the M3 bore.
    shroud = box("GPIO lower socket boss", (24, 10.1, 16), (GPIO_X, 11.4, 8), white, pivot)
    boolean(cradle, shroud, "UNION")
    pocket = box("GPIO plug access cutter", (18, 8, 16), (GPIO_X, GPIO_Y, 4), white, pivot)
    boolean(cradle, pocket, "DIFFERENCE")
    tunnel = box("Ext.Port1 harness tunnel cutter", (14, 10, 3.4), (GPIO_X, 7.8, 4.9), white, pivot)
    boolean(cradle, tunnel, "DIFFERENCE")

    plastic = material("GPIO connector insulator", (0.036, 0.065, 0.075))
    box("GPIO 2x5 header insulator", (13.6, 5.9, 2.5), (GPIO_X, GPIO_Y, 10.75), plastic, pivot)
    for row in (-1, 1):
        for column in range(-2, 3):
            position = (GPIO_X + column * 2.54, GPIO_Y + row * 1.27, 7.85)
            box("GPIO header pin", (0.64, 0.64, 3.4), position, brass, pivot, bevel=0.05)


def set_color(material_name, color, emission=False):
    finish = bpy.data.materials[material_name]
    finish.diffuse_color = (*color, 1)
    shader = finish.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (*color, 1)
    if emission:
        shader.inputs["Emission Color"].default_value = (*color, 1)


def engrave(part, name, transform, width, glyphs):
    outlines = []
    cursor = 0
    for letter in "NULL CITY IV":
        glyph = glyphs[letter]
        for contour in glyph["contours"]:
            outlines.append([(cursor + x + tan(radians(12)) * (100 - y), 100 - y)
                             for x, y in contour["points"]])
        cursor += glyph["width"] + 12
    left = min(x for outline in outlines for x, _ in outline)
    right = max(x for outline in outlines for x, _ in outline)
    center = (left + right) / 2
    scale = width / (right - left)
    for outline in outlines:
        points = [((x - center) * scale, y * scale) for x, y in outline]
        mark = prism(name, points, -0.45, 0.25)
        mark.matrix_world = transform
        boolean(part, mark, "DIFFERENCE", solver="MANIFOLD")
        if not part.data.vertices:
            raise ValueError(f"Engraving boolean removed {part.name}")


def add_debossed_graphics(panel, upper, accent):
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

    glyphs = json.loads((ROOT / "fonts" / "null-font" / "glyphs.json").read_text())["glyphs"]
    top = panel.matrix_world @ Matrix.Translation((0, -67, 47))
    engrave(panel, "Top engraving cutter", top, 143, glyphs)
    for x in (-106, 106):
        stripe = box("Flush cyan pinstripe", (42, 1.7, 0.025), (0, 0, 0), accent, bevel=0)
        stripe.matrix_world = panel.matrix_world @ Matrix.Translation((x, -75, 47.028))
    # Measure each housing face at the baseline so the engraving follows its plane.
    for name, probe, horizontal, outward in (
        ("Front", (0, -97, 27), (1, 0, 0), (0, -1, 0)),
        ("Left", (-152, 0, 27), (0, -1, 0), (-1, 0, 0)),
        ("Right", (152, 0, 27), (0, 1, 0), (1, 0, 0)),
    ):
        hit, origin, normal, _ = upper.ray_cast(Vector(probe), -Vector(outward), distance=8)
        if not hit:
            raise ValueError(f"Missing {name} engraving surface")
        horizontal = Vector(horizontal)
        surface = Matrix((horizontal, normal.cross(horizontal), normal)).transposed().to_4x4()
        surface.translation = origin
        engrave(upper, name + " engraving cutter", surface, 65, glyphs)


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
    accent = material("Decal • cyan ink", (0.008, 0.48, 0.72))
    set_color("Purple balltop", (0.012, 0.19, 0.53))
    balltop = bpy.data.materials["Purple balltop"]
    balltop.name = "NC-04 translucent blue balltop"
    ball_shader = balltop.node_tree.nodes["Principled BSDF"]
    ball_shader.inputs["Transmission Weight"].default_value = 0.65
    ball_shader.inputs["Roughness"].default_value = 0.17
    set_color("Lime green", (0.009, 0.38, 0.60))
    set_color("Magenta lighting illustration", (0.018, 0.38, 0.65), emission=True)
    set_color("Backlit translucent PLA illustration", (0.026, 0.53, 0.79), emission=True)
    bpy.data.objects["Violet rim"].data.color = (0.83, 0.91, 1.0)
    panel = bpy.data.objects["PRINT_03_control_panel"]
    upper = bpy.data.objects["PRINT_02_upper_frame"]
    add_debossed_graphics(panel, upper, accent)
    expose_led_openings()
    finish_deck_edges(panel, white)
    add_shoulders(upper, white)
    finish_shell_edge(upper, 24, 150, 95, 8, 0.55)
    tray = bpy.data.objects["PRINT_01_lower_tray"]
    thin_tray_floor(tray, white)
    finish_shell_edge(tray, 24, 150, 95, 8, 0.7)
    finish_shell_edge(tray, 3, 149, 94, 8, 0.85)
    add_deck_hardware(tray, upper, bpy.data.objects["PRINT_03_control_panel"], hardware, brass)
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
            box("Rear retaining lip", (11, 3.2, 10), (side * 61, 8.4, 10), white, pivot),
        )
        for rail in rails:
            boolean(cradle, rail, "UNION")
        bore(cradle, 2.0, 6, (side * 66.5, 0, 0), pivot)
        insert = cylinder("M3 brass insert • reference", 2.25, 4.5, (side * 66.5, 0, 0), pivot)
        bore(insert, 1.25, 6, (side * 66.5, 0, 0), pivot)
        insert.data.materials.append(brass)
        screw = cylinder("M3 pivot screw shank", 1.5, 14, (side * 71.5, *PIVOT[1:]))
        screw.data.materials.append(hardware)
        head = cylinder("M3 pivot screw head", 2.75, 2.5, (side * 79.75, *PIVOT[1:]))
        head.data.materials.append(hardware)

    add_gpio_port(cradle, pivot, white, brass)
    harness = material("GPIO cable jacket", (0.023, 0.065, 0.082))
    cable_curve("Ext.Port1 to 2x5 pigtail",
                [(GPIO_X, 4, 6.1), (GPIO_X, 4, 4.8), (GPIO_X, 7, 4.5),
                 (GPIO_X, 10.8, 4.5), (GPIO_X, 12.5, 4.9)],
                harness, pivot)
    gpio_start = anchor("GpioCableStart", GPIO_CABLE_START, pivot)
    gpio_entry = anchor("GpioCableEntry", GPIO_CABLE_ENTRY)
    add_tab5_retention(cradle, pivot, hardware)
    add_tab5(pivot, device, display, brass)
    for part, filename in (
        (tray, "NC04_01_lower_tray.stl"),
        (upper, "NC04_02_upper_frame.stl"),
        (bpy.data.objects["PRINT_03_control_panel"], "NC04_03_control_panel.stl"),
        (cradle, "NC04_04_tab5_cradle.stl"),
    ):
        export_print_part(part, filename)

    for frame, angle in enumerate(TILT_ANGLES, start=1):
        pivot.rotation_euler.x = radians(-angle)
        pivot.keyframe_insert(data_path="rotation_euler", index=0, frame=frame)

    scene = bpy.context.scene
    scene.frame_end = len(TILT_ANGLES)
    scene.frame_set(2)
    add_service_loop(gpio_start, gpio_entry, harness)
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
