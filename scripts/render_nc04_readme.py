"""Render NC-04 README images from the assembly and the current H3C projects."""

from pathlib import Path
import sys
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SCENE = bpy.context.scene
CAMERA = SCENE.camera
VIEWS = ROOT / "docs" / "images"
VIEWS.mkdir(exist_ok=True)


def aim(position, target):
    CAMERA.location = position
    CAMERA.rotation_euler = (Vector(target) - CAMERA.location).to_track_quat("-Z", "Y").to_euler()


def render(path, width, height):
    SCENE.render.resolution_x = width
    SCENE.render.resolution_y = height
    SCENE.render.resolution_percentage = 100
    SCENE.render.image_settings.file_format = "JPEG"
    SCENE.render.image_settings.quality = 94
    SCENE.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def read_transform(value):
    if not value:
        return Matrix.Identity(4)
    n = [float(v) for v in value.split()]
    return Matrix(((n[0], n[3], n[6], n[9]),
                   (n[1], n[4], n[7], n[10]),
                   (n[2], n[5], n[8], n[11]), (0, 0, 0, 1)))


def plate_meshes(project, offset, material):
    with ZipFile(project) as archive:
        document = ET.fromstring(archive.read("3D/3dmodel.model"))
        resources = {obj.attrib["id"]: obj for obj in document.findall("./{*}resources/{*}object")}
        for item in document.findall("./{*}build/{*}item"):
            for component in resources[item.attrib["objectid"]].findall("./{*}components/{*}component"):
                source = next(value for name, value in component.attrib.items() if name.endswith("}path"))
                subdocument = ET.fromstring(archive.read(source.lstrip("/")))
                mesh = next(obj.find("{*}mesh") for obj in subdocument.findall("./{*}resources/{*}object")
                            if obj.attrib["id"] == component.attrib["objectid"])
                vertices = [tuple(float(vertex.attrib[axis]) for axis in "xyz")
                            for vertex in mesh.findall("./{*}vertices/{*}vertex")]
                faces = [tuple(int(face.attrib[key]) for key in ("v1", "v2", "v3"))
                         for face in mesh.findall("./{*}triangles/{*}triangle")]
                part = bpy.data.meshes.new(project.stem)
                part.from_pydata(vertices, [], faces)
                part.materials.append(material)
                obj = bpy.data.objects.new(project.stem, part)
                SCENE.collection.objects.link(obj)
                obj.matrix_world = (Matrix.Translation((offset - 165, -160, 0))
                                    @ read_transform(item.get("transform"))
                                    @ read_transform(component.get("transform")))


def material(name, rgb):
    item = bpy.data.materials.new(name)
    item.diffuse_color = (*rgb, 1)
    return item


def slab(name, center, size, finish):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    obj.data.materials.append(finish)


def surface_grain(finish, frequency, depth, strength):
    nodes = finish.node_tree.nodes
    links = finish.node_tree.links
    coordinates = nodes.new("ShaderNodeTexCoord")
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = frequency
    grain.inputs["Detail"].default_value = 2
    links.new(coordinates.outputs["Object"], grain.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = depth
    bump.inputs["Strength"].default_value = strength
    links.new(grain.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], nodes.get("Principled BSDF").inputs["Normal"])


def render_hero():
    floor = bpy.data.materials["Studio graphite"]
    surface = floor.node_tree.nodes.get("Principled BSDF")
    surface.inputs["Base Color"].default_value = (.046, .052, .064, 1)
    surface.inputs["Roughness"].default_value = .58
    surface_grain(floor, .55, .32, .32)

    for name in ("NC-04 white PLA", "NC-04 cyan PLA deck"):
        pla = bpy.data.materials[name]
        surface = pla.node_tree.nodes.get("Principled BSDF")
        surface.inputs["Roughness"].default_value = .37
        surface_grain(pla, 2.8, .055, .24)
    bpy.data.materials["Tab5 HUD display"].node_tree.nodes.get(
        "Principled BSDF").inputs["Emission Strength"].default_value = 1.15

    lights = (
        ("Softbox left", (-255, -205, 365), 2270000, 290, (1, .93, .84)),
        ("Front", (225, -315, 145), 520000, 220, (.87, .93, 1)),
        ("Violet rim", (140, 165, 280), 1630000, 215, (.81, .89, 1)),
    )
    for name, position, energy, diameter, color in lights:
        light = bpy.data.objects[name]
        light.location = position
        light.rotation_euler = (Vector((0, 0, 45)) - light.location).to_track_quat("-Z", "Y").to_euler()
        light.data.energy = energy
        light.data.size = diameter
        light.data.color = color
    SCENE.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .55
    SCENE.cycles.samples = 96
    CAMERA.data.lens = 68
    aim((270, -735, 355), (0, 0, 67))
    render(ROOT / "preview-nc04.jpg", 1920, 1200)


def main():
    render_hero()
    if "--hero-only" in sys.argv:
        return
    SCENE.cycles.samples = 48
    CAMERA.data.lens = 66
    aim((250, 730, 380), (0, 12, 66))
    render(ROOT / "preview-nc04-rear.jpg", 1600, 1000)

    parts = [obj for obj in SCENE.objects if obj.type in {"MESH", "CURVE", "FONT"}
             and not obj.hide_render and obj.name != "STUDIO_floor"]
    SCENE.render.engine = "BLENDER_WORKBENCH"
    CAMERA.data.type = "ORTHO"
    SCENE.view_settings.view_transform = "Standard"
    SCENE.view_settings.look = "None"
    SCENE.view_settings.exposure = 0
    shading = SCENE.display.shading
    shading.light = "STUDIO"
    shading.color_type = "MATERIAL"
    shading.show_shadows = False
    shading.show_cavity = True
    shading.background_type = "WORLD"
    SCENE.world.color = (.027, .033, .049)
    bpy.data.objects["STUDIO_floor"].hide_render = True

    front = Matrix.Rotation(-1.57079632679, 4, "X")
    right = Matrix(((0, 1, 0, 0), (0, 0, 1, 0), (1, 0, 0, 0), (0, 0, 0, 1)))
    orthographic = []
    label_material = material("Drawing labels", (.8, .86, .94))
    for label, co, transform, label_position in (
        ("TOP", (-135, 153, 0), Matrix.Identity(4), (-285, 266, 500)),
        ("FRONT", (-135, -159, 0), front, (-285, -184, 500)),
        ("RIGHT", (165, -159, 0), right, (70, -184, 500)),
    ):
        for obj in parts:
            copy = obj.copy()
            copy.parent = None
            copy.animation_data_clear()
            SCENE.collection.objects.link(copy)
            copy.matrix_world = Matrix.Translation(co) @ transform @ obj.matrix_world
            orthographic.append(copy)
        label_data = bpy.data.curves.new(label, "FONT")
        label_data.body = label
        label_data.size = 10
        label_data.materials.append(label_material)
        caption = bpy.data.objects.new(label, label_data)
        SCENE.collection.objects.link(caption)
        caption.location = label_position
        orthographic.append(caption)
    for obj in parts:
        obj.hide_render = True
    CAMERA.data.ortho_scale = 670
    aim((0, 45, 1300), (0, 45, 0))
    render(VIEWS / "nc04-three-views.jpg", 1740, 1260)

    for obj in orthographic:
        obj.hide_render = True
    bed_material = material("SuperTack bed", (.035, .045, .062))
    grid_material = material("20 mm bed grid", (.09, .12, .16))
    pla = material("White PLA", (.86, .89, .94))
    for offset, file in (
        (-182, "NC04-fixed-frame-04-supertack.3mf"),
        (182, "NC04-fixed-cradle-04-supertack.3mf"),
    ):
        slab("H3C plate", (offset, 0, -2), (330, 320, 3.8), bed_material)
        for x in range(-160, 161, 20):
            slab("Bed grid", (offset + x, 0, -.08), (.23, 320, .03), grid_material)
        for y in range(-160, 161, 20):
            slab("Bed grid", (offset, y, -.08), (330, .23, .03), grid_material)
        plate_meshes(ROOT / "print" / "h3c" / file, offset, pla)
    CAMERA.data.ortho_scale = 755
    aim((0, -380, 1250), (0, 0, 4))
    render(VIEWS / "nc04-h3c-print-preview.jpg", 1650, 810)


if __name__ == "__main__":
    main()
