"""Build the NC-04 Tab5 dock and enclosure study from the NC-03 assembly."""

from math import radians
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
TAB5_WIDTH = 128.0
TAB5_HEIGHT = 80.0
TAB5_DEPTH = 12.0
SIDE_CLEARANCE = 0.6
PIVOT = (0, 76, 61)
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


def bore(part, width, position, parent=None):
    cutter = cylinder("Axle bore cutter", 2.2, width, position, parent)
    opening = part.modifiers.new("Ø4.4 axle clearance", "BOOLEAN")
    opening.object = cutter
    part.modifiers.move(len(part.modifiers) - 1, 0)
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.modifier_apply(modifier=opening.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / "NULL_CITY_NC03.blend"))
    dock = material("NC-04 cradle graphite", (0.06, 0.075, 0.09))
    device = material("Tab5 housing reference", (0.22, 0.24, 0.27))
    display = material("Tab5 inactive screen reference", (0.015, 0.024, 0.04))
    pin_finish = material("Hinge hardware reference", (0.54, 0.56, 0.58))

    for side in (-1, 1):
        ear = box("Fixed hinge ear", (7, 19, 17), (side * 73, 76, 57.5), dock)
        bore(ear, 9, (side * 73, 76, 61))
    axle = cylinder("Tab5 hinge axis • nominal Ø4", 2, 153, PIVOT)
    axle.data.materials.append(pin_finish)

    pivot = bpy.data.objects.new("Tab5 removable cradle • tilt pivot", None)
    bpy.context.collection.objects.link(pivot)
    pivot.location = PIVOT

    crossmember = box("Moving crossmember", (138, 14, 9), (0, 0, 0), dock, pivot)
    bore(crossmember, 140, (0, 0, 0), pivot)
    for side in (-1, 1):
        rail_x = side * (TAB5_WIDTH / 2 + SIDE_CLEARANCE + 1.75)
        box("Lower seating ledge", (34, 16, 3), (side * 51, 0, 5), dock, pivot)
        box("Slide-in side guide", (3.5, 17, 23), (rail_x, 0, 17), dock, pivot)
        box("Front retaining lip", (5, 2.5, 11), (side * 61, -7.85, 11), dock, pivot)
        box("Rear guide pad", (11, 3, 17), (side * 58, 8.1, 14), dock, pivot)

    tab = box(
        "M5Stack Tab5 • removable reference",
        (TAB5_WIDTH, TAB5_DEPTH, TAB5_HEIGHT),
        (0, 0, 6.5 + TAB5_HEIGHT / 2),
        device,
        pivot,
        bevel=1.3,
    )
    box("Tab5 touch display reference", (111, 0.45, 62.4),
        (0, -6.15, 0), display, tab, bevel=0.2)

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


if __name__ == "__main__":
    main()
