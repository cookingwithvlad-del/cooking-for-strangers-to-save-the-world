"""Builds the game's 3D assets headlessly with Blender (bpy).

    python -m venv bpyenv && bpyenv/bin/pip install "bpy==4.2.23"
    bpyenv/bin/python tools/blender_assets.py

Outputs into assets/3d/:
  vehicles/<kind>.glb   modeled car bodies (parts: body, glass, dark, wheel, rim)
  person.glb            rounded character parts, unit-normalized (leg, arm, body, head, hair, hat)
  props.glb             street props (tree, palm, lamp, bench, hydrant, trafficlight, trash)
  tex/*.jpg|png         Cycles-baked textures: facade (color, normal, emissive, roughness),
                        asphalt, concrete, grass, sand (color + normal), water normal
  sky/*.jpg             equirectangular Nishita sky renders: morning, noon, dusk, night
"""
import math, os, random, sys, time
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "3d")
T0 = time.time()

def log(*a):
    print(f"[{time.time() - T0:6.1f}s]", *a, flush=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 16
    sc.cycles.use_denoising = False
    sc.render.image_settings.file_format = "PNG"
    return sc

def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj

def mesh_obj(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return link(bpy.data.objects.new(name, me))

def apply_all(obj):
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        for m in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)

def bevel(obj, width, segments=3, angle=None):
    m = obj.modifiers.new("bevel", "BEVEL")
    m.width = width; m.segments = segments; m.limit_method = "ANGLE"; m.angle_limit = math.radians(angle or 40)
    return m

def smooth(obj, auto=35):
    for p in obj.data.polygons: p.use_smooth = True
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
        try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(auto))
        except Exception: bpy.ops.object.shade_smooth()

def prim(kind, name, **kw):
    getattr(bpy.ops.mesh, "primitive_%s_add" % kind)(**kw)
    o = bpy.context.active_object; o.name = name
    return o

def extrude_profile(name, pts, half_w, close=True):
    """Side profile (x along length, z up) extruded across y in [-half_w, half_w]."""
    n = len(pts)
    verts = [(x, -half_w, z) for x, z in pts] + [(x, half_w, z) for x, z in pts]
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    return mesh_obj(name, verts, faces)

def select_only(objs):
    for o in bpy.context.scene.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

def export_glb(objs, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    select_only(objs)
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                                  export_materials="NONE", export_yup=True, export_normals=True, export_texcoords=True)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_materials="NONE")
    log("wrote", os.path.relpath(path, ROOT), f"{os.path.getsize(path) // 1024} KB")

# ------------------------------------------------------------------ vehicles
PROFILES = {
    # x along length (front is +x), z up; game units; ground clearance ~3
    "sedan":  (32, 16, [(16, 3.2), (16, 6.8), (15.2, 8.4), (6.5, 9.8), (1.5, 14.6), (-6, 15), (-10.5, 11.2), (-15.4, 10.4), (-16, 7), (-16, 3.2)],
               [(6.8, 9.9), (1.8, 14.3), (-5.8, 14.7), (-10, 11.2)]),
    "sports": (34, 15, [(17, 2.8), (17, 5.8), (16, 6.8), (4, 8.2), (-1, 12.2), (-8, 12.6), (-12, 9.4), (-17, 8.4), (-17, 5.8), (-17, 2.8)],
               [(4.3, 8.3), (-0.8, 11.9), (-7.8, 12.3), (-11.5, 9.4)]),
    "van":    (38, 19, [(19, 3.2), (19, 8.5), (17.5, 11.5), (13, 13.5), (10.5, 19.5), (-19, 19.5), (-19, 8), (-19, 3.2)],
               [(13.3, 13.6), (10.8, 19.2), (3, 19.2), (3, 13.6)]),
    "foodtruck": (44, 20, [(22, 3.2), (22, 9), (20, 12), (15, 14), (12.5, 20.5), (-22, 20.5), (-22, 8), (-22, 3.2)],
               [(15.3, 14.1), (12.8, 20.2), (5, 20.2), (5, 14.1)]),
    "bus":    (58, 20, [(29, 3.2), (29, 18), (27.5, 21), (-27.5, 21), (-29, 18), (-29, 3.2)],
               [(28.8, 11), (28.8, 20), (-28.8, 20), (-28.8, 11)]),
}
PROFILES["taxi"] = PROFILES["sedan"]; PROFILES["police"] = PROFILES["sedan"]; PROFILES["rental"] = PROFILES["sedan"]

def build_vehicle(kind):
    L, W, body_pts, cab_pts = PROFILES[kind]
    hw = W / 2
    body = extrude_profile("body", body_pts, hw)
    # wheel arches
    arches = []
    for x in (-L * 0.32, L * 0.32):
        for y in (-hw, hw):
            c = prim("cylinder", "arch", radius=4.4, depth=5, vertices=24, location=(x, y, 3.6), rotation=(math.radians(90), 0, 0))
            arches.append(c)
    select_only(arches)
    with bpy.context.temp_override(active_object=arches[0], selected_objects=arches, selected_editable_objects=arches):
        bpy.ops.object.join()
    cutter = bpy.context.view_layer.objects.active if bpy.context.view_layer.objects.active.name.startswith("arch") else arches[0]
    bo = body.modifiers.new("arches", "BOOLEAN"); bo.operation = "DIFFERENCE"; bo.object = cutter; bo.solver = "EXACT"
    bevel(body, 1.1, 3, 32)
    apply_all(body); smooth(body, 40)
    bpy.data.objects.remove(cutter, do_unlink=True)
    # glass: cabin polygon pushed slightly outward so it reads through the paint
    cx = sum(p[0] for p in cab_pts) / len(cab_pts); cz = sum(p[1] for p in cab_pts) / len(cab_pts)
    cab = [(cx + (x - cx) * 1.02, cz + (z - cz) * 1.02) for x, z in cab_pts]
    glass = extrude_profile("glass", cab, hw + 0.15)
    bevel(glass, 0.5, 2, 32); apply_all(glass); smooth(glass, 40)
    if kind in ("van", "foodtruck", "bus"):
        # side window strip
        n = 5 if kind == "bus" else 2
        for i in range(n):
            x0 = (L * 0.42) - i * (L * 0.8 / n) if kind == "bus" else -L * 0.05 - i * 12
            w = prim("cube", "glass_side", size=1, location=(x0 - 4, 0, 15.5 if kind == "bus" else 13)); w.scale = (L * 0.7 / n - 1.5 if kind == "bus" else 9, W + 0.3, 2.5 if kind == "bus" else 3)
            apply_all(w)
            select_only([glass, w])
            with bpy.context.temp_override(active_object=glass, selected_objects=[glass, w], selected_editable_objects=[glass, w]):
                bpy.ops.object.join()
    # dark trim: bumpers, grille, mirrors, underbody
    dark_parts = []
    for x in (L / 2 - 0.9, -L / 2 + 0.9):
        b = prim("cube", "bumper", size=1, location=(x, 0, 4.2)); b.scale = (2.2, W - 0.8, 2.6); bevel(b, 0.6, 2); apply_all(b); dark_parts.append(b)
    g = prim("cube", "grille", size=1, location=(L / 2 - 0.2, 0, 6.3)); g.scale = (0.5, W * 0.45, 1.6); apply_all(g); dark_parts.append(g)
    u = prim("cube", "under", size=1, location=(0, 0, 2.2)); u.scale = (L * 0.78, W * 0.92, 1.4); apply_all(u); dark_parts.append(u)
    if kind not in ("bus", "van", "foodtruck"):
        # door seams and handles
        for sx in (L * 0.22, -L * 0.14):
            for y in (-hw - 0.05, hw + 0.05):
                seam = prim("cube", "seam", size=1, location=(sx, y, 6.5)); seam.scale = (0.35, 0.3, 6.5); apply_all(seam); dark_parts.append(seam)
                hdl = prim("cube", "handle", size=1, location=(sx - 2.5, y + (0.3 if y > 0 else -0.3), 8.6)); hdl.scale = (2.4, 0.5, 0.7); bevel(hdl, 0.2, 2); apply_all(hdl); dark_parts.append(hdl)
    for x in (L / 2 + 0.2, -L / 2 - 0.2):
        plate = prim("cube", "plate", size=1, location=(x, 0, 3.6)); plate.scale = (0.3, 5.5, 1.6); apply_all(plate); dark_parts.append(plate)
    if kind not in ("bus",):
        for y in (-hw - 1.2, hw + 1.2):
            m = prim("cube", "mirror", size=1, location=(L * 0.16, y, body_pts[3][1] + 1.2)); m.scale = (1.6, 1.4, 1.2); bevel(m, 0.4, 2); apply_all(m); dark_parts.append(m)
    select_only(dark_parts)
    with bpy.context.temp_override(active_object=dark_parts[0], selected_objects=dark_parts, selected_editable_objects=dark_parts):
        bpy.ops.object.join()
    dark = bpy.context.view_layer.objects.active; dark.name = "dark"
    # wheel + rim (one of each at origin, axis along y)
    wheel = prim("cylinder", "wheel", radius=3.2, depth=2.4, vertices=20, location=(0, 0, 0), rotation=(math.radians(90), 0, 0))
    bevel(wheel, 0.5, 2); apply_all(wheel); smooth(wheel, 40)
    rim = prim("cylinder", "rim", radius=2.0, depth=2.6, vertices=12, location=(0, 0, 0), rotation=(math.radians(90), 0, 0))
    bevel(rim, 0.3, 2); apply_all(rim); smooth(rim, 40)
    export_glb([body, glass, dark, wheel, rim], os.path.join(OUT, "vehicles", kind + ".glb"))

def build_scooter():
    body = extrude_profile("body", [(10, 2.8), (10, 5), (6.5, 7), (2, 8), (-6, 8), (-10, 6.5), (-10, 2.8)], 4)
    bevel(body, 0.8, 2); apply_all(body); smooth(body, 40)
    glass = prim("cube", "glass", size=1, location=(8.5, 0, 9.5)); glass.scale = (0.4, 5, 4); apply_all(glass)
    bar = prim("cylinder", "dark", radius=0.35, depth=10, vertices=8, location=(6, 0, 9), rotation=(math.radians(90), 0, 0))
    seat = prim("cube", "seat", size=1, location=(-3, 0, 8.6)); seat.scale = (7, 4.5, 1.4); bevel(seat, 0.5, 2); apply_all(seat)
    select_only([bar, seat])
    with bpy.context.temp_override(active_object=bar, selected_objects=[bar, seat], selected_editable_objects=[bar, seat]):
        bpy.ops.object.join()
    dark = bpy.context.view_layer.objects.active; dark.name = "dark"
    wheel = prim("cylinder", "wheel", radius=3, depth=1.8, vertices=16, location=(0, 0, 0), rotation=(math.radians(90), 0, 0)); bevel(wheel, 0.5, 2); apply_all(wheel); smooth(wheel, 40)
    rim = prim("cylinder", "rim", radius=1.6, depth=2.0, vertices=10, location=(0, 0, 0), rotation=(math.radians(90), 0, 0)); apply_all(rim)
    export_glb([body, glass, dark, wheel, rim], os.path.join(OUT, "vehicles", "scooter.glb"))

# ------------------------------------------------------------------ person (unit-normalized parts)
def build_person():
    parts = []
    for name in ("leg", "arm"):
        o = prim("cylinder", name, radius=0.5, depth=1, vertices=14, location=(0, 0, -0.5))
        bevel(o, 0.22, 3); apply_all(o); smooth(o, 45); parts.append(o)
    body = prim("cube", "body", size=1, location=(0, 0, 0)); body.scale = (1, 1, 1)
    bevel(body, 0.26, 3); apply_all(body); smooth(body, 45); parts.append(body)
    head = prim("uv_sphere", "head", radius=1, segments=20, ring_count=14, location=(0, 0, 0)); head.scale = (0.98, 0.95, 1.08); apply_all(head); smooth(head, 60); parts.append(head)
    hair = prim("uv_sphere", "hair", radius=1.05, segments=20, ring_count=14, location=(0, 0, 0.04))
    # keep the upper cap only
    bpy.context.view_layer.objects.active = hair
    bm = hair.data
    drop = [v.index for v in bm.vertices if v.co.z < 0.08]
    import bmesh
    b = bmesh.new(); b.from_mesh(bm); b.verts.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[b.verts[i] for i in drop], context="VERTS"); b.to_mesh(bm); b.free()
    smooth(hair, 60); parts.append(hair)
    hat = prim("cylinder", "hat", radius=1, depth=1, vertices=16, location=(0, 0, 0)); bevel(hat, 0.2, 2); apply_all(hat); smooth(hat, 45); parts.append(hat)
    export_glb(parts, os.path.join(OUT, "person.glb"))

# ------------------------------------------------------------------ props
def build_props():
    objs = []
    def add(o): objs.append(o); return o
    # tree
    t = add(prim("cylinder", "tree_trunk", radius=1.3, depth=12, vertices=10, location=(0, 0, 6))); t.scale = (1, 1, 1); apply_all(t); smooth(t)
    for (x, y, z, r) in ((0, 0, 15, 7.5), (-2.5, 1.5, 18.5, 5), (2.5, -1.8, 17.5, 4.5), (0.5, 2.5, 13.5, 4)):
        s = add(prim("ico_sphere", "tree_leaves", radius=r, subdivisions=2, location=(x, y, z))); smooth(s, 60)
    # palm
    p = add(prim("cylinder", "palm_trunk", radius=1.4, depth=30, vertices=10, location=(0, 0, 15))); apply_all(p); smooth(p)
    for i in range(7):
        a = i * 2 * math.pi / 7
        leaf = add(prim("cube", "palm_leaves", size=1, location=(math.cos(a) * 8, math.sin(a) * 8, 29.5))); leaf.scale = (16, 3.5, 0.5); leaf.rotation_euler = (0, math.radians(28), a); apply_all(leaf)
    # lamp post
    add(prim("cylinder", "lamp_post", radius=0.7, depth=26, vertices=8, location=(0, 0, 13)))
    arm = add(prim("cube", "lamp_post", size=1, location=(3.5, 0, 26))); arm.scale = (7, 0.8, 0.8); apply_all(arm)
    add(prim("cube", "lamp_head", size=1, location=(6.5, 0, 25.4))).scale = (3.5, 1.6, 1.2); apply_all(objs[-1])
    # bench
    for z, sx, sz in ((5, 20, 1.4), (8, 20, 5)):
        b = add(prim("cube", "bench_wood", size=1, location=(0, -2.5 if z == 8 else 0, z))); b.scale = (sx, 1.2 if z == 8 else 5, sz); bevel(b, 0.25, 2); apply_all(b)
    for x in (-8, 8):
        l = add(prim("cube", "bench_iron", size=1, location=(x, 0, 2.5))); l.scale = (1.4, 5, 3); apply_all(l)
    # hydrant
    h = add(prim("cylinder", "hydrant_body", radius=2, depth=8, vertices=12, location=(0, 0, 5))); bevel(h, 0.5, 2); apply_all(h); smooth(h)
    add(prim("uv_sphere", "hydrant_body", radius=2.2, segments=12, ring_count=8, location=(0, 0, 9.4)))
    for a in (0, math.pi):
        n = add(prim("cylinder", "hydrant_body", radius=0.9, depth=2, vertices=8, location=(math.cos(a) * 2.4, math.sin(a) * 2.4, 6), rotation=(0, math.radians(90), a)))
    # traffic light
    add(prim("cylinder", "trafficlight_pole", radius=0.6, depth=24, vertices=8, location=(0, 0, 12)))
    head = add(prim("cube", "trafficlight_head", size=1, location=(0, 0, 22))); head.scale = (3, 3, 9); bevel(head, 0.4, 2); apply_all(head)
    for z in (25, 22, 19):
        add(prim("cylinder", "trafficlight_hood", radius=1.1, depth=1.2, vertices=10, location=(0, 1.9, z + 0.4), rotation=(math.radians(90), 0, 0)))
    # trash can
    c = add(prim("cylinder", "trash_body", radius=3, depth=10, vertices=14, location=(0, 0, 5))); bevel(c, 0.4, 2); apply_all(c); smooth(c)
    add(prim("cylinder", "trash_lid", radius=3.3, depth=1, vertices=14, location=(0, 0, 10.4)))
    export_glb(objs, os.path.join(OUT, "props.glb"))

# ------------------------------------------------------------------ texture baking
def new_image(name, size, alpha=False, srgb=True):
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    if not srgb: img.colorspace_settings.name = "Non-Color"
    return img

def save_image(img, path, fmt="PNG", quality=88):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.filepath_raw = path; img.file_format = fmt
    sc = bpy.context.scene
    old = sc.render.image_settings.file_format, sc.render.image_settings.quality
    sc.render.image_settings.file_format = fmt; sc.render.image_settings.quality = quality
    img.save_render(path)
    sc.render.image_settings.file_format, sc.render.image_settings.quality = old
    log("wrote", os.path.relpath(path, ROOT), f"{os.path.getsize(path) // 1024} KB")

def mat_nodes(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return m, nt, bsdf

def bake_target(obj, img):
    """Give obj a material whose active node is an image texture pointing at img."""
    if not obj.data.materials:
        m, nt, _ = mat_nodes(obj.name + "_bake"); obj.data.materials.append(m)
    for m in obj.data.materials:
        nt = m.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; nt.nodes.active = tex

def bake(objs, target, btype, img, filt=None, cage=0.0, s2a=False, samples=8):
    sc = bpy.context.scene; sc.cycles.samples = samples
    bake_target(target, img)
    select_only(objs + [target]); bpy.context.view_layer.objects.active = target
    kw = dict(type=btype, margin=8, use_clear=True, use_selected_to_active=s2a)
    if s2a: kw.update(cage_extrusion=cage, max_ray_distance=cage * 3 if cage else 0)
    if filt: kw["pass_filter"] = filt
    with bpy.context.temp_override(active_object=target, selected_objects=objs + [target], selected_editable_objects=objs + [target]):
        bpy.ops.object.bake(**kw)
    # strip bake nodes so later bakes don't target this image
    for m in target.data.materials:
        for n in [n for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image == img]: m.node_tree.nodes.remove(n)

def procedural_surface(name, base, bump_scale, bump_strength, rough, detail=6.0, voronoi=None, bricks=None):
    m, nt, bsdf = mat_nodes(name)
    bsdf.inputs["Roughness"].default_value = rough
    coord = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = bump_scale; noise.inputs["Detail"].default_value = detail; noise.inputs["Roughness"].default_value = 0.65
    nt.links.new(coord.outputs["UV"], noise.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.color_ramp.elements[0].color = base[0]; ramp.color_ramp.elements[1].color = base[1]
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    color_out = ramp.outputs["Color"]
    height = noise.outputs["Fac"]
    if voronoi:
        vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.feature = "DISTANCE_TO_EDGE"; vor.inputs["Scale"].default_value = voronoi
        nt.links.new(coord.outputs["UV"], vor.inputs["Vector"])
        crack = nt.nodes.new("ShaderNodeMath"); crack.operation = "SMOOTH_MIN"; crack.inputs[1].default_value = 0.035; crack.inputs[2].default_value = 0.01
        nt.links.new(vor.outputs["Distance"], crack.inputs[0])
        mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 25
        nt.links.new(crack.inputs[0].links[0].from_socket if False else vor.outputs["Distance"], mul.inputs[0])
        clamp = nt.nodes.new("ShaderNodeClamp"); nt.links.new(mul.outputs[0], clamp.inputs[0])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.inputs[0].default_value = 0.0
        nt.links.new(clamp.outputs[0], mix.inputs["Factor"]); mix.inputs[6].default_value = (0.09, 0.09, 0.1, 1); nt.links.new(color_out, mix.inputs[7])
        color_out = mix.outputs[2]
        hmul = nt.nodes.new("ShaderNodeMath"); hmul.operation = "MULTIPLY"; nt.links.new(clamp.outputs[0], hmul.inputs[0]); nt.links.new(height, hmul.inputs[1])
        hadd = nt.nodes.new("ShaderNodeMath"); hadd.operation = "ADD"; nt.links.new(height, hadd.inputs[0]); nt.links.new(hmul.outputs[0], hadd.inputs[1])
        height = hadd.outputs[0]
    if bricks:
        br = nt.nodes.new("ShaderNodeTexBrick"); br.inputs["Scale"].default_value = bricks[0]; br.inputs["Mortar Size"].default_value = bricks[1]; br.inputs["Color1"].default_value = bricks[2]; br.inputs["Color2"].default_value = bricks[3]; br.inputs["Mortar"].default_value = bricks[4]
        br.inputs["Bias"].default_value = 0.0; br.offset = bricks[5] if len(bricks) > 5 else 0.5
        nt.links.new(coord.outputs["UV"], br.inputs["Vector"])
        mix2 = nt.nodes.new("ShaderNodeMix"); mix2.data_type = "RGBA"; mix2.blend_type = "MULTIPLY"; mix2.inputs[0].default_value = 1.0
        nt.links.new(br.outputs["Color"], mix2.inputs[6]); nt.links.new(color_out, mix2.inputs[7]); color_out = mix2.outputs[2]
        hb = nt.nodes.new("ShaderNodeMath"); hb.operation = "SUBTRACT"; hb.inputs[0].default_value = 1.0; nt.links.new(br.outputs["Fac"], hb.inputs[1])
        hb2 = nt.nodes.new("ShaderNodeMath"); hb2.operation = "MULTIPLY_ADD"; nt.links.new(hb.outputs[0], hb2.inputs[0]); hb2.inputs[1].default_value = 3.0; nt.links.new(height, hb2.inputs[2])
        height = hb2.outputs[0]
    nt.links.new(color_out, bsdf.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = bump_strength; bump.inputs["Distance"].default_value = 0.6
    nt.links.new(height, bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def bake_surface(name, make_mat, size=512, maps=("color", "normal"), jpg_quality=86):
    reset()
    plane = prim("plane", name, size=1); plane.data.materials.append(make_mat())
    if "color" in maps:
        img = new_image(name + "_c", size); bake([], plane, "DIFFUSE", img, filt={"COLOR"}); save_image(img, os.path.join(OUT, "tex", name + "_color.jpg"), "JPEG", jpg_quality)
    if "normal" in maps:
        img = new_image(name + "_n", size, srgb=False); bake([], plane, "NORMAL", img); save_image(img, os.path.join(OUT, "tex", name + "_normal.png"))
    if "rough" in maps:
        img = new_image(name + "_r", size, srgb=False); bake([], plane, "ROUGHNESS", img); save_image(img, os.path.join(OUT, "tex", name + "_rough.jpg"), "JPEG", jpg_quality)

FACADE_STYLES = ("brick", "glass", "stucco", "concrete")

def facade_wall_material(style):
    if style == "brick":
        return procedural_surface("brickwall", ((0.52, 0.30, 0.22, 1), (0.66, 0.42, 0.30, 1)), 9, 0.35, 0.85, bricks=(34.0, 0.04, (0.6, 0.33, 0.24, 1), (0.5, 0.26, 0.19, 1), (0.74, 0.72, 0.66, 1)))
    if style == "stucco":
        return procedural_surface("stucco", ((0.86, 0.80, 0.70, 1), (0.93, 0.89, 0.80, 1)), 18, 0.18, 0.9, detail=7)
    if style == "concrete":
        return procedural_surface("concretewall", ((0.56, 0.56, 0.55, 1), (0.68, 0.67, 0.65, 1)), 14, 0.25, 0.85, detail=6, bricks=(3.0, 0.015, (0.64, 0.63, 0.61, 1), (0.6, 0.6, 0.58, 1), (0.42, 0.42, 0.42, 1), 0.0))
    m, nt, b = mat_nodes("spandrel"); b.inputs["Base Color"].default_value = (0.12, 0.14, 0.17, 1); b.inputs["Roughness"].default_value = 0.35; b.inputs["Metallic"].default_value = 0.6
    return m

def build_facade(style="brick"):
    """A real facade baked onto a flat tile: 4 windows x 8 floors = 64 x 96 game units. Styles: brick, glass tower, stucco, concrete office."""
    sc = reset()
    W, H = 64.0, 96.0
    wall = prim("cube", "wall", size=1, location=(0, 1.5, 0)); wall.scale = (W, 3, H); apply_all(wall)
    wall.data.materials.append(facade_wall_material(style))
    cutters = []; glasses = []; frames = []
    random.seed({"brick": 7, "glass": 11, "stucco": 13, "concrete": 17}[style])
    lit_p = {"brick": 0.38, "glass": 0.55, "stucco": 0.3, "concrete": 0.4}[style]
    frame_col = {"brick": (0.82, 0.8, 0.76, 1), "glass": (0.2, 0.22, 0.26, 1), "stucco": (0.96, 0.96, 0.94, 1), "concrete": (0.3, 0.32, 0.35, 1)}[style]
    def glass_mat(lit, tint):
        gm, gnt, gb = mat_nodes("glass_%d" % random.randint(0, 1 << 30)); gb.inputs["Base Color"].default_value = tint; gb.inputs["Roughness"].default_value = 0.06
        if lit: gb.inputs["Emission Color"].default_value = (1.0, 0.78, 0.45, 1); gb.inputs["Emission Strength"].default_value = 1.0
        return gm
    def box(name, loc, scale, lst, bev=0):
        o = prim("cube", name, size=1, location=loc); o.scale = scale
        if bev: bevel(o, bev, 2)
        apply_all(o); lst.append(o); return o
    for r in range(8):
        z = -H / 2 + 7 + r * 12
        if style == "glass":
            # curtain wall: full-width glass per floor, spandrel band, slim mullions every 8 units
            box("cut", (0, 0, z + 1.5), (W + 2, 3, 9.6), cutters)
            lit = random.random() < lit_p
            g = box("glass", (0, 1.2, z + 1.5), (W + 2, 0.3, 9.6), glasses); g.data.materials.append(glass_mat(lit, (0.1, 0.14, 0.2, 1)))
            for c in range(9):
                box("mullion", (-W / 2 + c * 8, 0.4, z + 1.5), (0.5, 1.6, 9.8), frames)
            box("transom", (0, 0.4, z + 6.3), (W + 2, 1.6, 0.6), frames)
            box("sillband", (0, -0.4, z - 3.5), (W + 2, 1.2, 1.4), frames)
            continue
        if style == "concrete":
            # ribbon window per floor split into 7 panes, deep concrete band above
            box("cut", (0, 0, z + 0.5), (W - 6, 3, 6.4), cutters)
            lit = random.random() < lit_p
            g = box("glass", (0, 1.4, z + 0.5), (W - 6, 0.3, 6.4), glasses); g.data.materials.append(glass_mat(lit, (0.08, 0.1, 0.13, 1)))
            for c in range(8):
                box("mullion", (-W / 2 + 3 + c * (W - 6) / 7, 0.6, z + 0.5), (0.6, 1.2, 6.6), frames)
            box("band", (0, -0.9, z + 4.6), (W + 0.2, 2.2, 1.6), frames)
            box("sill", (0, -0.5, z - 3.1), (W - 5, 1.4, 0.8), frames)
            continue
        for c in range(4):
            x = -W / 2 + 8 + c * 16
            if style == "stucco":
                box("cut", (x, 0, z), (9, 3, 8), cutters)
                lit = random.random() < lit_p
                g = box("glass", (x, 1.5, z), (9, 0.3, 8), glasses); g.data.materials.append(glass_mat(lit, (0.1, 0.13, 0.17, 1)))
                for fx in (x - 4.7, x + 4.7): box("jamb", (fx, 0.2, z), (0.6, 2.4, 8.2), frames)
                box("lintel", (x, 0.2, z + 4.2), (10.2, 2.4, 0.6), frames)
                box("mullion", (x, 1.2, z), (0.45, 0.5, 7.8), frames)
                # balcony: ledge and railing
                box("ledge", (x, -1.9, z - 4.6), (12, 4.2, 1.2), frames, bev=0.3)
                box("rail", (x, -3.8, z - 2.2), (12, 0.35, 0.35), frames)
                for bx in (x - 5.8, x - 2.9, x, x + 2.9, x + 5.8): box("baluster", (bx, -3.8, z - 3.5), (0.3, 0.3, 2.4), frames)
                if c in (1, 2) and r % 2 == 0: box("shutter", (x + 6.2, -0.2, z), (1.6, 0.4, 8), frames)
                continue
            # brick (original)
            box("cut", (x, 0, z), (10, 3, 7.5), cutters)
            lit = random.random() < lit_p
            g = box("glass", (x, 1.3, z), (10, 0.3, 7.5), glasses); g.data.materials.append(glass_mat(lit, (0.08, 0.1, 0.14, 1)))
            box("sill", (x, -0.6, z - 4.1), (11.2, 1.8, 0.8), frames)
            box("lintel", (x, -0.3, z + 4.0), (11.2, 1.0, 0.7), frames)
            for fx in (x - 5.1, x + 5.1): box("jamb", (fx, 0.3, z), (0.5, 2.2, 7.6), frames)
            box("mullion", (x, 1.0, z), (0.45, 0.5, 7.4), frames)
    select_only(cutters)
    with bpy.context.temp_override(active_object=cutters[0], selected_objects=cutters, selected_editable_objects=cutters): bpy.ops.object.join()
    cutter = bpy.context.view_layer.objects.active
    bo = wall.modifiers.new("win", "BOOLEAN"); bo.operation = "DIFFERENCE"; bo.object = cutter; bo.solver = "EXACT"; apply_all(wall)
    bpy.data.objects.remove(cutter, do_unlink=True)
    fm, fnt, fb = mat_nodes("frame"); fb.inputs["Base Color"].default_value = frame_col; fb.inputs["Roughness"].default_value = 0.55
    if style == "glass": fb.inputs["Metallic"].default_value = 0.7
    for f in frames: f.data.materials.append(fm)
    target = prim("plane", "facade", size=1, location=(0, -0.01, 0), rotation=(math.radians(90), 0, 0)); target.scale = (W, H, 1); apply_all(target)
    highs = [wall] + glasses + frames
    size = 1024; cage = 7
    prefix = "facade" if style == "brick" else "facade_" + style
    col = new_image(prefix + "_c", size); bake(highs, target, "DIFFUSE", col, filt={"COLOR"}, cage=cage, s2a=True, samples=1)
    ao = new_image(prefix + "_ao", size, srgb=False); bake(highs, target, "AO", ao, cage=cage, s2a=True, samples=24)
    multiply_ao(col, ao, 0.3)
    save_image(col, os.path.join(OUT, "tex", prefix + "_color.jpg"), "JPEG", 88)
    img = new_image(prefix + "_n", size, srgb=False); bake(highs, target, "NORMAL", img, cage=cage, s2a=True, samples=1); save_image(img, os.path.join(OUT, "tex", prefix + "_normal.png"))
    img = new_image(prefix + "_e", size); bake(highs, target, "EMIT", img, cage=cage, s2a=True, samples=1); save_image(img, os.path.join(OUT, "tex", prefix + "_emissive.jpg"), "JPEG", 80)
    img = new_image(prefix + "_r", size, srgb=False); bake(highs, target, "ROUGHNESS", img, cage=cage, s2a=True, samples=1); save_image(img, os.path.join(OUT, "tex", prefix + "_rough.jpg"), "JPEG", 80)

def multiply_ao(col, ao, floor):
    """Darken the colour bake by its ambient occlusion: col *= floor + (1 - floor) * ao."""
    import numpy as np
    n = col.size[0] * col.size[1] * 4
    c = np.empty(n, dtype=np.float32); a = np.empty(n, dtype=np.float32)
    col.pixels.foreach_get(c); ao.pixels.foreach_get(a)
    c = c.reshape(-1, 4); a = a.reshape(-1, 4)
    occ = floor + (1 - floor) * a[:, :1]
    c[:, :3] *= occ
    col.pixels.foreach_set(c.ravel())

def build_facades():
    for st in FACADE_STYLES: build_facade(st)

def build_surfaces():
    bake_surface("asphalt", lambda: procedural_surface("asphalt", ((0.17, 0.175, 0.19, 1), (0.25, 0.255, 0.27, 1)), 60, 0.35, 0.78, detail=9, voronoi=18.0), 512, ("color", "normal", "rough"))
    bake_surface("concrete", lambda: procedural_surface("concrete", ((0.62, 0.62, 0.6, 1), (0.74, 0.73, 0.7, 1)), 30, 0.3, 0.8, bricks=(2.0, 0.02, (0.72, 0.71, 0.68, 1), (0.66, 0.65, 0.62, 1), (0.4, 0.4, 0.4, 1), 0.0)), 512)
    bake_surface("grass", lambda: procedural_surface("grass", ((0.18, 0.4, 0.12, 1), (0.36, 0.56, 0.2, 1)), 60, 0.6, 0.95, detail=10), 512)
    bake_surface("sand", lambda: procedural_surface("sand", ((0.78, 0.68, 0.5, 1), (0.9, 0.82, 0.62, 1)), 25, 0.45, 0.9, detail=6), 512)
    bake_surface("water", lambda: procedural_surface("water", ((0.1, 0.3, 0.5, 1), (0.15, 0.4, 0.6, 1)), 12, 1.0, 0.05, detail=4), 512, ("normal",))

# ------------------------------------------------------------------ sky
def render_skies():
    for name, elev, intensity, dust in (("morning", 9, 0.9, 1.4), ("noon", 62, 1.0, 0.8), ("dusk", 2.5, 0.8, 2.6), ("night", -14, 0.2, 1.0)):
        sc = reset()
        sc.cycles.samples = 24
        world = bpy.data.worlds.new("sky"); sc.world = world; world.use_nodes = True
        nt = world.node_tree; nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputWorld"); bg = nt.nodes.new("ShaderNodeBackground"); sky = nt.nodes.new("ShaderNodeTexSky")
        sky.sky_type = "NISHITA"; sky.sun_elevation = math.radians(elev); sky.sun_rotation = math.radians(200); sky.sun_intensity = intensity
        sky.altitude = 5; sky.air_density = 1.2; sky.dust_density = dust; sky.ozone_density = 1.5; sky.sun_size = math.radians(1.2)
        nt.links.new(sky.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], out.inputs[0])
        bg.inputs[1].default_value = 0.08 if name == "night" else 1.0
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); link(cam); sc.camera = cam
        cam.data.type = "PANO"
        try: cam.data.panorama_type = "EQUIRECTANGULAR"
        except Exception: cam.data.cycles.panorama_type = "EQUIRECTANGULAR"
        cam.location = (0, 0, 2); cam.rotation_euler = (math.radians(90), 0, 0)
        sc.render.resolution_x = 1024; sc.render.resolution_y = 512; sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 85
        sc.view_settings.view_transform = "Filmic" if "Filmic" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
        sc.view_settings.look = "None"; sc.view_settings.exposure = 0.0
        path = os.path.join(OUT, "sky", name + ".jpg"); os.makedirs(os.path.dirname(path), exist_ok=True)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        log("wrote", os.path.relpath(path, ROOT), f"{os.path.getsize(path) // 1024} KB")

# ------------------------------------------------------------------ shrink: normal maps as JPEG for the web bundle
def shrink():
    reset()
    tex = os.path.join(OUT, "tex")
    for f in sorted(os.listdir(tex)):
        if not f.endswith("_normal.png"): continue
        src = os.path.join(tex, f); dst = src[:-4] + ".jpg"
        loaded = bpy.data.images.load(src)
        # copy into a generated image so save_render re-encodes it with the scene's JPEG settings
        img = bpy.data.images.new(f + "_jpg", loaded.size[0], loaded.size[1], alpha=False)
        img.colorspace_settings.name = "Non-Color"; img.pixels = loaded.pixels[:]
        save_image(img, dst, "JPEG", 92)
        os.remove(src)

# ------------------------------------------------------------------ main
STAGES = {
    "shrink": shrink,
    "vehicles": lambda: [(reset(), build_vehicle(k)) for k in ("sedan", "sports", "van", "foodtruck", "bus", "taxi", "police", "rental")] and (reset(), build_scooter()),
    "person": lambda: (reset(), build_person()),
    "props": lambda: (reset(), build_props()),
    "facade": build_facades,
    "surfaces": build_surfaces,
    "sky": render_skies,
}

if __name__ == "__main__":
    try: bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
    except Exception as e: log("gltf addon:", e)
    want = sys.argv[1:] or list(STAGES)
    for name in want:
        log("==", name)
        try: STAGES[name]()
        except Exception as e:
            import traceback; traceback.print_exc(); log("FAILED", name, e)
    log("done")
