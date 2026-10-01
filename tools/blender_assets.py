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

def build_facade():
    """A real facade (recessed windows, sills, lintels, brick) baked onto a flat tile: 4 windows x 8 floors = 64 x 96 game units."""
    sc = reset()
    W, H = 64.0, 96.0
    wall = prim("cube", "wall", size=1, location=(0, 1.5, 0)); wall.scale = (W, 3, H); apply_all(wall)
    brick = procedural_surface("brickwall", ((0.52, 0.30, 0.22, 1), (0.66, 0.42, 0.30, 1)), 9, 0.35, 0.85, bricks=(34.0, 0.04, (0.6, 0.33, 0.24, 1), (0.5, 0.26, 0.19, 1), (0.74, 0.72, 0.66, 1)))
    wall.data.materials.append(brick)
    cutters = []; glasses = []; frames = []
    random.seed(7)
    for r in range(8):
        for c in range(4):
            x = -W / 2 + 8 + c * 16; z = -H / 2 + 7 + r * 12
            cut = prim("cube", "cut", size=1, location=(x, 0, z)); cut.scale = (10, 3, 7.5); apply_all(cut); cutters.append(cut)
            g = prim("cube", "glass", size=1, location=(x, 1.3, z)); g.scale = (10, 0.3, 7.5); apply_all(g); glasses.append(g)
            lit = random.random() < 0.38
            gm, gnt, gb = mat_nodes("glass_%d_%d" % (r, c)); gb.inputs["Base Color"].default_value = (0.08, 0.1, 0.14, 1); gb.inputs["Roughness"].default_value = 0.08
            if lit:
                gb.inputs["Emission Color"].default_value = (1.0, 0.75, 0.42, 1); gb.inputs["Emission Strength"].default_value = 1.0
            g.data.materials.append(gm)
            sill = prim("cube", "sill", size=1, location=(x, -0.6, z - 4.1)); sill.scale = (11.2, 1.8, 0.8); apply_all(sill); frames.append(sill)
            lint = prim("cube", "lintel", size=1, location=(x, -0.3, z + 4.0)); lint.scale = (11.2, 1.0, 0.7); apply_all(lint); frames.append(lint)
            for fx in (x - 5.1, x + 5.1):
                f = prim("cube", "jamb", size=1, location=(fx, 0.3, z)); f.scale = (0.5, 2.2, 7.6); apply_all(f); frames.append(f)
            mull = prim("cube", "mullion", size=1, location=(x, 1.0, z)); mull.scale = (0.45, 0.5, 7.4); apply_all(mull); frames.append(mull)
    select_only(cutters)
    with bpy.context.temp_override(active_object=cutters[0], selected_objects=cutters, selected_editable_objects=cutters): bpy.ops.object.join()
    cutter = bpy.context.view_layer.objects.active
    bo = wall.modifiers.new("win", "BOOLEAN"); bo.operation = "DIFFERENCE"; bo.object = cutter; bo.solver = "EXACT"; apply_all(wall)
    bpy.data.objects.remove(cutter, do_unlink=True)
    fm, fnt, fb = mat_nodes("frame"); fb.inputs["Base Color"].default_value = (0.82, 0.8, 0.76, 1); fb.inputs["Roughness"].default_value = 0.6
    for f in frames: f.data.materials.append(fm)
    # low-poly target with UVs covering the tile, sitting on the wall's front plane
    target = prim("plane", "facade", size=1, location=(0, -0.01, 0), rotation=(math.radians(90), 0, 0)); target.scale = (W, H, 1); apply_all(target)
    highs = [wall] + glasses + frames
    size = 1024
    img = new_image("facade_c", size); bake(highs, target, "DIFFUSE", img, filt={"COLOR"}, cage=6, s2a=True); save_image(img, os.path.join(OUT, "tex", "facade_color.jpg"), "JPEG", 88)
    img = new_image("facade_n", size, srgb=False); bake(highs, target, "NORMAL", img, cage=6, s2a=True); save_image(img, os.path.join(OUT, "tex", "facade_normal.png"))
    img = new_image("facade_e", size); bake(highs, target, "EMIT", img, cage=6, s2a=True); save_image(img, os.path.join(OUT, "tex", "facade_emissive.jpg"), "JPEG", 80)
    img = new_image("facade_r", size, srgb=False); bake(highs, target, "ROUGHNESS", img, cage=6, s2a=True); save_image(img, os.path.join(OUT, "tex", "facade_rough.jpg"), "JPEG", 80)

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
    "facade": build_facade,
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
