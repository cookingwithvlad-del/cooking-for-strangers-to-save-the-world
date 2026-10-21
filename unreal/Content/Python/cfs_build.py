"""Rebuilds Cooking for Strangers to Save the World inside Unreal Engine 5.

Run inside the editor (Python console, Tools menu, or tools/unreal_bridge.py):

    import cfs_build; cfs_build.run()

What it does, in order (each step logs and carries on if a later step fails):
  import_assets()    glTF models baked by tools/bake_glb.py (unreal/SourceAssets) and the
                     Cycles-baked textures + character faces from assets/3d
  build_materials()  tint material + instances, photo-face material per character,
                     facade materials (brick/glass/stucco/concrete), ground materials
  build_level()      a fresh level, lit with sun/sky/fog, then the whole city from
                     Content/Data/world.json (tools/export_world.js): roads, sidewalks,
                     rivers and bridges, beaches, parks, buildings with the right facade
                     style and tint per block, storefronts, street props, parked cars,
                     the five named characters with their real faces, a marker at all 68
                     tables, and a PlayerStart at the New York home kitchen.

Scale: 1 game unit = UNIT cm (10), so a block tile is 3.2 m, a sedan 3.3 m and the
characters about 1.8 m. The level is static geometry: instanced cubes for the tiles and
buildings, StaticMeshActors for cars and characters. It's a world to walk a Third
Person or First Person template character through, not the mission logic (that lives
in js/game.js and would be a Blueprint/C++ port).

Written against the UE 5.3-5.6 Python API without an editor at hand: every phase is
wrapped so a renamed property only loses that phase, and the editor log says which.
"""
import json
import math
import os
import traceback

import unreal

UNIT = 10.0                 # cm per game unit
MESH_SCALE = UNIT / 100.0   # glTF metres import as 100 cm; the models were authored in game units
CHAR_SCALE = 0.82           # the game's people are 22 units tall; this makes them ~1.8 m
TILE = 32
GAME = "/Game/CookingForStrangers"
MAP = GAME + "/Maps/FourCities"
PROJECT = os.path.normpath(unreal.Paths.project_dir())
REPO = os.path.normpath(os.path.join(PROJECT, ".."))
SRC = os.path.join(PROJECT, "SourceAssets")
DATA = os.path.join(PROJECT, "Content", "Data", "world.json")
CUBE = "/Engine/BasicShapes/Cube"

VEHICLE_KINDS = ["sedan", "sports", "van", "foodtruck", "bus", "taxi", "police", "rental", "scooter"]
VEHICLE_PAINT = {"sedan": "#8a94a6", "sports": "#c81e1e", "van": "#e5e7eb", "foodtruck": "#f59e0b", "bus": "#2563eb", "taxi": "#facc15", "police": "#f8fafc", "rental": "#9ca3af", "scooter": "#16a34a"}
FACADE_STYLES = {"brick": "facade", "glass": "facade_glass", "stucco": "facade_stucco", "concrete": "facade_concrete"}
CHARACTERS = ["vlad", "orly", "alex", "anthony", "jeanphil"]

# Mirrors HEROES in js/people.js (looks only; dialogue stays in the game).
HEROES = {
    "vlad": dict(name="Vlad", skin="#f1cfb3", hair="#c2541f", hairStyle="short", beard="#c8551b", outfit="chef", jacket="#141518", piping="#d4a017", apron="half", apronColor="#121316", pants="#141518", shoe="dress", shoeColor="#101010", toque=True),
    "orly": dict(name="Orly Israel", skin="#edc7a6", hair="#4a3220", hairStyle="messy", outfit="suit", jacket="#111318", shirt="#e9f0f7", tie="#c9a84a", pants="#111318", shoe="dress", shoeColor="#0e0e0e", glasses="#0b0b0f"),
    "alex": dict(name="Alex Kislov", skin="#d8a677", hair="#a7722f", hairStyle="curly", beard="#6b4a2b", outfit="shirt", shirt="#f3efe4", pants="#1a1a1d", shoe="sneaker", shoeColor="#f2f2f2", glasses="#e0463a", glassesTint=True, headphones=True, necklace=True),
    "anthony": dict(name="Chef Anthony", skin="#d3a079", hair="#1f1510", hairStyle="curly", mustache="#2a1c12", outfit="shirt", shirt="#f6f6f3", apron="bib", apronColor="#2b2b2e", pants="#2b2b2e", shoe="dress", shoeColor="#101010", earring=True),
    "jeanphil": dict(name="Jean Phil", skin="#f5dcc9", hair="#e9c87a", hairStyle="bowl", mustache="#d6b063", outfit="suit", jacket="#8a6a4e", shirt="#f5f0e6", tie="#7a2535", pants="#8a6a4e", shoe="dress", shoeColor="#4a2a14"),
}
PROP_COLORS = {
    "tree": {"trunk": "#6b4f2a", "leaves": "#2f6b2a"}, "palm": {"trunk": "#a0845c", "leaves": "#2f8f3a"},
    "lamp": {"post": "#7c828c", "head": "#9aa0a8"}, "bench": {"wood": "#8b5a2b", "iron": "#2d2d33"},
    "hydrant": {"body": "#b91c1c"}, "trafficlight": {"pole": "#3f3f46", "head": "#27272a", "hood": "#111111"},
    "trash": {"body": "#4b5563", "lid": "#1f2937"},
}

_state = {"meshes": {}, "textures": {}, "materials": {}, "tints": {}, "model_axis": None}


# ----------------------------------------------------------------------------- helpers
def log(msg):
    unreal.log(f"[CFS] {msg}")


def warn(msg):
    unreal.log_warning(f"[CFS] {msg}")


def phase(fn):
    """Run one build phase, logging a traceback instead of aborting the whole build."""
    def wrapped(*a, **k):
        log(f"--- {fn.__name__}")
        try:
            return fn(*a, **k)
        except Exception:
            warn(f"{fn.__name__} failed:\n{traceback.format_exc()}")
            return None
    wrapped.__name__ = fn.__name__
    wrapped.__doc__ = fn.__doc__
    return wrapped


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def color(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return unreal.LinearColor(srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


def actors():
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def levels():
    return unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def vec(x, y, z):
    """Game units (x east, y south, z up) to an Unreal world vector in cm."""
    return unreal.Vector(x * UNIT, y * UNIT, z * UNIT)


def rot(yaw_deg):
    return unreal.Rotator(roll=0.0, pitch=0.0, yaw=yaw_deg)


def spawn(cls, x, y, z, yaw=0.0, label=None, folder=None):
    a = actors().spawn_actor_from_class(cls, vec(x, y, z), rot(yaw))
    if label:
        a.set_actor_label(label)
    if folder:
        a.set_folder_path(folder)
    return a


def ensure_dir(path):
    if not unreal.EditorAssetLibrary.does_directory_exist(path):
        unreal.EditorAssetLibrary.make_directory(path)


def asset_tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def list_assets(folder, cls):
    out = {}
    for p in unreal.EditorAssetLibrary.list_assets(folder, recursive=False, include_folder=False):
        name = p.split("/")[-1].split(".")[0]
        a = unreal.EditorAssetLibrary.load_asset(p)
        if isinstance(a, cls):
            out[name] = a
    return out


def mesh_bounds(mesh):
    """(min, max) corners of a StaticMesh in its own units."""
    b = mesh.get_bounds()
    o, e = b.origin, b.box_extent
    return unreal.Vector(o.x - e.x, o.y - e.y, o.z - e.z), unreal.Vector(o.x + e.x, o.y + e.y, o.z + e.z)


# ----------------------------------------------------------------------------- import
def import_file(path, dest, name=None):
    if not os.path.exists(path):
        warn(f"missing source file {path}")
        return []
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = dest
    if name:
        task.destination_name = name
    task.automated = True
    task.save = True
    task.replace_existing = True
    asset_tools().import_asset_tasks([task])
    paths = [str(p) for p in (task.imported_object_paths or [])]
    log(f"imported {os.path.basename(path)} -> {len(paths)} asset(s)")
    return paths


@phase
def import_assets():
    """Models from unreal/SourceAssets and textures from assets/3d into /Game/CookingForStrangers."""
    for d in ["Vehicles", "Characters/Parts", "Characters/Head", "Characters/Faces", "Props", "Textures", "Materials", "Materials/Tints", "Maps"]:
        ensure_dir(f"{GAME}/{d}")
    for kind in VEHICLE_KINDS:
        import_file(os.path.join(SRC, "vehicles", f"{kind}.glb"), f"{GAME}/Vehicles", kind)
    import_file(os.path.join(SRC, "head.glb"), f"{GAME}/Characters/Head", "head")  # the sculpted photo head; hero.glb has a plain sphere "head" too
    import_file(os.path.join(SRC, "hero.glb"), f"{GAME}/Characters/Parts")
    import_file(os.path.join(SRC, "props.glb"), f"{GAME}/Props")
    for c in CHARACTERS:
        import_file(os.path.join(REPO, "assets", "3d", "faces", f"{c}.jpg"), f"{GAME}/Characters/Faces", f"T_face_{c}")
    tex_dir = os.path.join(REPO, "assets", "3d", "tex")
    if os.path.isdir(tex_dir):
        for f in sorted(os.listdir(tex_dir)):
            if f.endswith(".jpg") or f.endswith(".png"):
                import_file(os.path.join(tex_dir, f), f"{GAME}/Textures", "T_" + os.path.splitext(f)[0])
    # normal / roughness maps are data, not colour
    for name, tex in list_assets(f"{GAME}/Textures", unreal.Texture2D).items():
        if name.endswith("_normal"):
            tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
            tex.set_editor_property("srgb", False)
        elif name.endswith("_rough"):
            tex.set_editor_property("srgb", False)
        else:
            continue
        unreal.EditorAssetLibrary.save_loaded_asset(tex)
    refresh_catalog()


def refresh_catalog():
    m = _state["meshes"]
    m.update({"vehicle:" + k: v for k, v in list_assets(f"{GAME}/Vehicles", unreal.StaticMesh).items()})
    m.update({"part:" + k: v for k, v in list_assets(f"{GAME}/Characters/Parts", unreal.StaticMesh).items()})
    photo = list_assets(f"{GAME}/Characters/Head", unreal.StaticMesh)
    if "head" in photo:
        m["part:head_photo"] = photo["head"]
    m.update({"prop:" + k: v for k, v in list_assets(f"{GAME}/Props", unreal.StaticMesh).items()})
    _state["textures"] = list_assets(f"{GAME}/Textures", unreal.Texture2D)
    _state["textures"].update(list_assets(f"{GAME}/Characters/Faces", unreal.Texture2D))
    log(f"catalog: {len([k for k in m if k.startswith('vehicle:')])} vehicles, {len([k for k in m if k.startswith('part:')])} character parts, {len([k for k in m if k.startswith('prop:')])} prop parts, {len(_state['textures'])} textures")
    detect_model_axis()


def detect_model_axis():
    """Which Unreal axis the models face after import (their front is glTF +x).

    The head is asymmetric (nose forward), so its bounds centre points along the model's
    forward axis. Everything that needs "forward" uses this instead of assuming the
    importer's handedness conversion.
    """
    head = _state["meshes"].get("part:head_photo")
    if not head:
        _state["model_axis"] = ("x", 1.0)
        return
    o = head.get_bounds().origin
    if abs(o.y) > abs(o.x):
        _state["model_axis"] = ("y", 1.0 if o.y > 0 else -1.0)
    else:
        _state["model_axis"] = ("x", 1.0 if o.x > 0 else -1.0)
    log(f"models face Unreal {'+' if _state['model_axis'][1] > 0 else '-'}{_state['model_axis'][0].upper()}")


def model_yaw():
    """Yaw (degrees) that turns an imported model to face +X."""
    axis, sign = _state["model_axis"] or ("x", 1.0)
    face = {("x", 1.0): 0.0, ("y", 1.0): 90.0, ("x", -1.0): 180.0, ("y", -1.0): -90.0}[(axis, sign)]
    return -face


def model_local(fwd, side, up):
    """A point given in model space (forward, side, up) as an Unreal offset (cm, unscaled)."""
    axis, sign = _state["model_axis"] or ("x", 1.0)
    if axis == "x":
        return unreal.Vector(fwd * sign, side, up)
    return unreal.Vector(side, fwd * sign, up)


# ----------------------------------------------------------------------------- materials
def new_material(name, folder=f"{GAME}/Materials"):
    path = f"{folder}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.EditorAssetLibrary.load_asset(path), False
    return asset_tools().create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew()), True


def expr(mat, cls, x, y, **props):
    e = unreal.MaterialEditingLibrary.create_material_expression(mat, cls, x, y)
    for k, v in props.items():
        e.set_editor_property(k, v)
    return e


MEL = unreal.MaterialEditingLibrary
MP = unreal.MaterialProperty


def finish(mat):
    MEL.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)


def material_tint():
    mat, fresh = new_material("M_Tint")
    if fresh:
        tint = expr(mat, unreal.MaterialExpressionVectorParameter, -400, 0, parameter_name="Tint", default_value=unreal.LinearColor(0.5, 0.5, 0.5, 1))
        rough = expr(mat, unreal.MaterialExpressionScalarParameter, -400, 200, parameter_name="Roughness", default_value=0.65)
        metal = expr(mat, unreal.MaterialExpressionScalarParameter, -400, 300, parameter_name="Metallic", default_value=0.0)
        MEL.connect_material_property(tint, "", MP.MP_BASE_COLOR)
        MEL.connect_material_property(rough, "", MP.MP_ROUGHNESS)
        MEL.connect_material_property(metal, "", MP.MP_METALLIC)
        finish(mat)
    return mat


def material_face():
    mat, fresh = new_material("M_Face")
    if fresh:
        tex = expr(mat, unreal.MaterialExpressionTextureSampleParameter2D, -400, 0, parameter_name="Face")
        rough = expr(mat, unreal.MaterialExpressionConstant, -400, 250, r=0.55)
        MEL.connect_material_property(tex, "RGB", MP.MP_BASE_COLOR)
        MEL.connect_material_property(rough, "", MP.MP_ROUGHNESS)
        finish(mat)
    return mat


def material_water():
    mat, fresh = new_material("M_Water")
    if fresh:
        mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
        base = expr(mat, unreal.MaterialExpressionConstant3Vector, -400, 0, constant=color("#1f4e79"))
        opacity = expr(mat, unreal.MaterialExpressionConstant, -400, 200, r=0.75)
        rough = expr(mat, unreal.MaterialExpressionConstant, -400, 300, r=0.05)
        MEL.connect_material_property(base, "", MP.MP_BASE_COLOR)
        MEL.connect_material_property(opacity, "", MP.MP_OPACITY)
        MEL.connect_material_property(rough, "", MP.MP_ROUGHNESS)
        nrm = _state["textures"].get("T_water_normal")
        if nrm:
            n = expr(mat, unreal.MaterialExpressionTextureSample, -400, 450, texture=nrm, sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
            MEL.connect_material_property(n, "RGB", MP.MP_NORMAL)
        finish(mat)
    return mat


def material_textured(name, color_tex, normal_tex=None, rough_tex=None, emissive_tex=None, tiling=1.0, tint=None, world_aligned=False):
    """Colour (+normal/roughness/emissive) material; world-aligned keeps facades from stretching with height."""
    mat, fresh = new_material(name)
    if not fresh:
        return mat
    T = _state["textures"]
    col = T.get(color_tex)
    if not col:
        warn(f"{name}: texture {color_tex} missing, using flat colour")
        c = expr(mat, unreal.MaterialExpressionConstant3Vector, -400, 0, constant=color(tint or "#999999"))
        MEL.connect_material_property(c, "", MP.MP_BASE_COLOR)
        finish(mat)
        return mat

    def sample(tex, y, is_normal=False):
        if world_aligned:
            try:
                fn_path = "/Engine/Functions/Engine_MaterialFunctions01/Texturing/" + ("WorldAlignedNormal" if is_normal else "WorldAlignedTexture")
                fn = unreal.load_asset(fn_path)
                call = expr(mat, unreal.MaterialExpressionMaterialFunctionCall, -300, y, material_function=fn)
                obj = expr(mat, unreal.MaterialExpressionTextureObject, -700, y, texture=tex)
                size = expr(mat, unreal.MaterialExpressionConstant, -700, y + 120, r=TILE * UNIT * 1.5)
                MEL.connect_material_expressions(obj, "", call, "TextureObject")
                MEL.connect_material_expressions(size, "", call, "TextureSize")
                return call, ""
            except Exception as exc:
                warn(f"{name}: world aligned sampling unavailable ({exc}); tiling instead")
        uv = expr(mat, unreal.MaterialExpressionTextureCoordinate, -700, y, u_tiling=tiling, v_tiling=tiling)
        s = expr(mat, unreal.MaterialExpressionTextureSample, -450, y, texture=tex)
        if is_normal:
            s.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
        MEL.connect_material_expressions(uv, "", s, "UVs")
        return s, "RGB"

    c, out = sample(col, 0)
    if tint:
        t = expr(mat, unreal.MaterialExpressionVectorParameter, -300, -200, parameter_name="Tint", default_value=color(tint))
        mul = expr(mat, unreal.MaterialExpressionMultiply, -100, 0)
        MEL.connect_material_expressions(c, out, mul, "A")
        MEL.connect_material_expressions(t, "", mul, "B")
        MEL.connect_material_property(mul, "", MP.MP_BASE_COLOR)
    else:
        MEL.connect_material_property(c, out, MP.MP_BASE_COLOR)
    if normal_tex and T.get(normal_tex):
        n, out = sample(T[normal_tex], 400, is_normal=True)
        MEL.connect_material_property(n, out, MP.MP_NORMAL)
    if rough_tex and T.get(rough_tex):
        r, out = sample(T[rough_tex], 800)
        MEL.connect_material_property(r, out, MP.MP_ROUGHNESS)
    else:
        r = expr(mat, unreal.MaterialExpressionConstant, -100, 800, r=0.8)
        MEL.connect_material_property(r, "", MP.MP_ROUGHNESS)
    if emissive_tex and T.get(emissive_tex):
        e, out = sample(T[emissive_tex], 1200)
        k = expr(mat, unreal.MaterialExpressionConstant, -100, 1300, r=3.0)
        mul = expr(mat, unreal.MaterialExpressionMultiply, 0, 1200)
        MEL.connect_material_expressions(e, out, mul, "A")
        MEL.connect_material_expressions(k, "", mul, "B")
        MEL.connect_material_property(mul, "", MP.MP_EMISSIVE_COLOR)
    finish(mat)
    return mat


def instance(parent, name, folder=f"{GAME}/Materials/Tints", vectors=None, scalars=None, textures=None):
    path = f"{folder}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.EditorAssetLibrary.load_asset(path)
    factory = unreal.MaterialInstanceConstantFactoryNew()
    factory.set_editor_property("initial_parent", parent)
    mi = asset_tools().create_asset(name, folder, unreal.MaterialInstanceConstant, factory)
    for k, v in (vectors or {}).items():
        MEL.set_material_instance_vector_parameter_value(mi, k, v)
    for k, v in (scalars or {}).items():
        MEL.set_material_instance_scalar_parameter_value(mi, k, v)
    for k, v in (textures or {}).items():
        MEL.set_material_instance_texture_parameter_value(mi, k, v)
    MEL.update_material_instance(mi)
    unreal.EditorAssetLibrary.save_loaded_asset(mi)
    return mi


def tint(hex_str, roughness=0.65, metallic=0.0):
    key = (hex_str.lower(), roughness, metallic)
    if key not in _state["tints"]:
        name = f"MI_{hex_str.lstrip('#').lower()}" + (f"_r{int(roughness * 100)}" if roughness != 0.65 else "") + (f"_m{int(metallic * 100)}" if metallic else "")
        _state["tints"][key] = instance(_state["materials"]["tint"], name, vectors={"Tint": color(hex_str)}, scalars={"Roughness": roughness, "Metallic": metallic})
    return _state["tints"][key]


@phase
def build_materials():
    if not _state["textures"]:
        refresh_catalog()
    M = _state["materials"]
    M["tint"] = material_tint()
    M["face"] = material_face()
    M["water"] = material_water()
    for c in CHARACTERS:
        t = _state["textures"].get(f"T_face_{c}")
        if t:
            M["face:" + c] = instance(M["face"], f"MI_face_{c}", folder=f"{GAME}/Materials", textures={"Face": t})
    for style, base in FACADE_STYLES.items():
        M["facade:" + style] = material_textured(f"M_Facade_{style}", f"T_{base}_color", f"T_{base}_normal", f"T_{base}_rough", f"T_{base}_emissive", tint="#ffffff", world_aligned=True)
    M["asphalt"] = material_textured("M_Asphalt", "T_asphalt_color", "T_asphalt_normal", "T_asphalt_rough", tiling=1.0, tint="#c8ccd4")
    M["concrete"] = material_textured("M_Concrete", "T_concrete_color", "T_concrete_normal", tiling=1.0, tint="#ffffff")
    M["grass"] = material_textured("M_Grass", "T_grass_color", "T_grass_normal", tiling=1.0, tint="#ffffff")
    M["sand"] = material_textured("M_Sand", "T_sand_color", "T_sand_normal", tiling=1.0, tint="#ffffff")
    log(f"{len(M)} materials ready")


def facade_instance(style, tint_hex):
    key = f"facade:{style}:{tint_hex}"
    if key not in _state["materials"]:
        _state["materials"][key] = instance(_state["materials"]["facade:" + style], f"MI_{style}_{tint_hex.lstrip('#')}", folder=f"{GAME}/Materials/Tints", vectors={"Tint": color(tint_hex)})
    return _state["materials"][key]


# ----------------------------------------------------------------------------- level
class Instancer:
    """One HierarchicalInstancedStaticMesh per (mesh, material): the whole city in a few draw calls."""

    def __init__(self):
        self.groups = {}
        self.host = None

    def add(self, mesh, material, location, yaw=0.0, scale=(1, 1, 1), key=None):
        key = key or (mesh.get_name(), material.get_name() if material else "")
        self.groups.setdefault(key, {"mesh": mesh, "material": material, "transforms": []})["transforms"].append(
            unreal.Transform(location, rot(yaw), unreal.Vector(*scale)))

    def box(self, material, cx, cy, cz, sx, sy, sz, key=None):
        """A unit cube scaled to a box, all in game units (cz is the centre height)."""
        cube = unreal.load_asset(CUBE)
        self.add(cube, material, vec(cx, cy, cz), 0.0, (sx * UNIT / 100.0, sy * UNIT / 100.0, sz * UNIT / 100.0), key=key)

    def flush(self, folder="CFS/City"):
        total = 0
        for key, g in self.groups.items():
            host = spawn(unreal.StaticMeshActor, 0, 0, 0, 0, label=f"HISM {key[0]} {key[1]}"[:60], folder=folder)
            comp = host.add_component_by_class(unreal.HierarchicalInstancedStaticMeshComponent, False, unreal.Transform(), False)
            comp.set_static_mesh(g["mesh"])
            if g["material"]:
                comp.set_material(0, g["material"])
            try:
                comp.set_mobility(unreal.ComponentMobility.STATIC)
            except Exception:
                pass
            try:
                comp.add_instances(g["transforms"], False)
            except Exception:
                for t in g["transforms"]:
                    comp.add_instance(t)
            total += len(g["transforms"])
        log(f"{total} instances in {len(self.groups)} batches")
        self.groups = {}


def load_world():
    with open(DATA, encoding="utf-8") as f:
        return json.load(f)


def fresh_level():
    les = levels()
    if unreal.EditorAssetLibrary.does_asset_exist(MAP):
        les.new_level(GAME + "/Maps/_Scratch")
        unreal.EditorAssetLibrary.delete_asset(MAP)
    if not les.new_level(MAP):
        raise RuntimeError(f"could not create level {MAP}")
    sun = spawn(unreal.DirectionalLight, 0, 0, 300, 0, "Sun", "CFS/Sky")
    sun.set_actor_rotation(unreal.Rotator(roll=0.0, pitch=-38.0, yaw=35.0), False)
    comp = sun.get_component_by_class(unreal.DirectionalLightComponent)
    if comp:
        comp.set_editor_property("atmosphere_sun_light", True)
        comp.set_intensity(6.0)
        comp.set_editor_property("light_source_angle", 1.2)
    spawn(unreal.SkyAtmosphere, 0, 0, 0, 0, "Atmosphere", "CFS/Sky")
    sky = spawn(unreal.SkyLight, 0, 0, 300, 0, "SkyLight", "CFS/Sky")
    sc = sky.get_component_by_class(unreal.SkyLightComponent)
    if sc:
        sc.set_editor_property("real_time_capture", True)
    fog = spawn(unreal.ExponentialHeightFog, 0, 0, 0, 0, "Haze", "CFS/Sky")
    fc = fog.get_component_by_class(unreal.ExponentialHeightFogComponent)
    if fc:
        fc.set_editor_property("fog_density", 0.012)
        fc.set_editor_property("fog_height_falloff", 0.35)
        fc.set_editor_property("fog_inscattering_luminance", unreal.LinearColor(0.62, 0.7, 0.82, 1))
    try:
        spawn(unreal.VolumetricCloud, 0, 0, 0, 0, "Clouds", "CFS/Sky")
    except Exception:
        pass


def tile_type(world, tx, ty):
    if tx < 0 or ty < 0 or tx >= world["meta"]["size"] or ty >= world["meta"]["size"]:
        return -1
    return world["tiles"][ty][tx]


def build_tiles(world, inst):
    T = {v: int(k) for k, v in world["meta"]["tileTypes"].items()}
    M = _state["materials"]
    size = world["meta"]["size"]
    warm_cities = {"fl", "la"}
    quadrant = {tuple(c["quadrant"]): k for k, c in world["cities"].items()}
    city_of = lambda tx, ty: quadrant[(1 if tx >= size / 2 else 0, 1 if ty >= size / 2 else 0)]
    # one slab under everything so there are no holes at the edges
    inst.box(M.get("asphalt") or tint("#242833"), size * TILE / 2, size * TILE / 2, -6, size * TILE + 600, size * TILE + 600, 8, key="ground")
    for ty in range(size):
        for tx in range(size):
            t = world["tiles"][ty][tx]
            cx, cy = tx * TILE + 16, ty * TILE + 16
            warm = city_of(tx, ty) in warm_cities
            if t == T["road"]:
                inst.box(M.get("asphalt") or tint("#3a3f4a"), cx, cy, 0.5, TILE, TILE, 1, key="road")
                if tx % 5 == 0 and ty % 5 != 0:
                    inst.box(tint("#d8c25a"), cx, cy - 8, 1.15, 1.6, 10, 0.3, key="paint"); inst.box(tint("#d8c25a"), cx, cy + 8, 1.15, 1.6, 10, 0.3, key="paint")
                elif ty % 5 == 0 and tx % 5 != 0:
                    inst.box(tint("#d8c25a"), cx - 8, cy, 1.15, 10, 1.6, 0.3, key="paint"); inst.box(tint("#d8c25a"), cx + 8, cy, 1.15, 10, 1.6, 0.3, key="paint")
            elif t == T["bridge"]:
                inst.box(M.get("asphalt") or tint("#3a3f4a"), cx, cy, 3, TILE, TILE, 6, key="bridge")
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if tile_type(world, tx + dx, ty + dy) == T["water"]:
                        inst.box(tint("#6b7280"), cx + dx * 15, cy + dy * 15, 8, 2 if dx else TILE, 2 if dy else TILE, 4, key="rail")
            elif t == T["water"]:
                inst.box(M.get("water") or tint("#1f4e79"), cx, cy, -1.5, TILE, TILE, 1, key="water")
            elif t == T["sand"]:
                inst.box(M.get("sand") or tint("#e9d8a6"), cx, cy, 1, TILE, TILE, 2, key="sand")
            elif t == T["park"]:
                inst.box(M.get("grass") or tint("#4f8a3a"), cx, cy, 1, TILE, TILE, 2, key="grass")
            elif t in (T["sidewalk"], T["garage"], T["shop"], T["home"]):
                mat = tint("#9ca3af") if t == T["garage"] else (tint("#e8e0d0") if warm and t == T["sidewalk"] else (M.get("concrete") or tint("#d4d4d8")))
                inst.box(mat, cx, cy, 1, TILE, TILE, 2, key=("walk", mat.get_name()))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if tile_type(world, tx + dx, ty + dy) == T["road"]:
                        inst.box(tint("#d4d7dd"), cx + dx * 15.5, cy + dy * 15.5, 1.6, 1 if dx else TILE, 1 if dy else TILE, 1.2, key="kerb")
            elif t == T["building"]:
                pass  # buildings carry their own entries with style and height
    for b in world["buildings"]:
        mat = facade_instance(b["style"], b["tint"]) if ("facade:" + b["style"]) in M else tint(b["tint"])
        inst.box(mat, b["x"], b["y"], b["h"] / 2, TILE, TILE, b["h"], key=("bld", b["style"], b["tint"]))
        inst.box(tint(b["roof"]), b["x"], b["y"], b["h"] + 0.5, TILE + 0.5, TILE + 0.5, 1, key=("roof", b["roof"]))
        if b["style"] in ("glass", "concrete"):
            inst.box(tint("#4b5563"), b["x"], b["y"], b["h"] + 2.2, TILE - 2, TILE - 2, 1, key="roofbox")
    for s in world["storefronts"]:
        inst.box(tint(s["color"]), s["x"], s["y"], s["h"] / 2, s["w"], s["w"], s["h"], key=("store", s["color"]))
        inst.box(tint(s["trim"]), s["x"], s["y"], s["h"] + 1, s["w"] + 4, s["w"] + 4, 2, key=("trim", s["trim"]))
        inst.box(tint(s["trim"]), s["x"], s["y"] + s["w"] / 2 + 1.5, 22, s["w"] + 4, 3, 4, key=("trim", s["trim"]))
        inst.box(tint("#9fd3ea", roughness=0.1), s["x"], s["y"] + s["w"] / 2 + 1.2, 6, 22, 0.8, 12, key="glass")
        for dx in (-20, 20):
            inst.box(tint("#9fd3ea", roughness=0.1), s["x"] + dx, s["y"] + s["w"] / 2 + 1.2, 8, 12, 0.8, 14, key="glass")


def build_props(world, inst):
    P = _state["meshes"]
    missing = set()
    for p in world["props"]:
        kind, x, y, s, yaw = p["kind"], p["x"], p["y"], p.get("s", 1), math.degrees(p.get("rot", 0))
        parts = {k.split(":", 1)[1][len(kind) + 1:]: m for k, m in P.items() if k.startswith(f"prop:{kind}_")}
        if parts:
            colors = dict(PROP_COLORS.get(kind, {}))
            if "leaves" in p:
                colors["leaves"] = p["leaves"]
            for part, mesh in parts.items():
                inst.add(mesh, tint(colors.get(part, "#888888")), vec(x, y, 0), yaw + model_yaw(), (MESH_SCALE * s,) * 3, key=("prop", kind, part, colors.get(part, "#888888")))
            continue
        # props the Blender pipeline doesn't model: the same boxes the browser game draws
        if kind == "mailbox":
            inst.box(tint("#1d4ed8"), x, y, 7, 8, 8, 12, key="mailbox"); inst.box(tint("#1e3a8a"), x, y, 13.5, 8.5, 8.5, 1.5, key="mailbox2")
        elif kind == "firebox":
            inst.box(tint("#ef4444"), x, y, 6, 6, 6, 12, key="firebox"); inst.box(tint("#991b1b"), x, y, 12.5, 6.5, 6.5, 1, key="firebox2")
        elif kind == "fountain":
            inst.box(tint("#a3b18a"), x, y, 1.5, 18, 18, 3, key="fountain"); inst.box(tint("#cbd5e1"), x, y, 6, 2.4, 2.4, 8, key="fountain2")
        elif kind == "plaza":
            inst.box(tint("#a8a29e"), x, y, 3, 18, 18, 2, key="plaza")
        elif kind == "umbrella":
            inst.box(tint("#e5e7eb"), x, y, 8, 1.2, 1.2, 16, key="pole"); inst.box(tint(p.get("color", "#ef4444")), x, y, 17, 18, 18, 1.5, key=("shade", p.get("color", "#ef4444")))
        elif kind == "towel":
            inst.box(tint("#3b82f6"), x, y, 2.5, 18, 9, 1, key="towel")
        elif kind in ("tree", "palm"):
            inst.box(tint("#6b4f2a"), x, y, 6 * s, 2.4, 2.4, 12 * s, key="trunk"); inst.box(tint("#2f6b2a"), x, y, 16 * s, 14 * s, 14 * s, 12 * s, key="leaves")
        else:
            missing.add(kind)
    if missing:
        warn(f"no mesh or fallback for props: {sorted(missing)}")


def rest_on_ground(mesh, scale):
    lo, _hi = mesh_bounds(mesh)
    return -lo.z * scale / UNIT  # game units to lift so the lowest vertex sits on z = 0


def place_vehicles(world):
    P = _state["meshes"]
    n = 0
    for v in world["vehicles"]:
        mesh = P.get("vehicle:" + v["kind"])
        if not mesh:
            continue
        a = spawn(unreal.StaticMeshActor, v["x"], v["y"], rest_on_ground(mesh, MESH_SCALE), math.degrees(v["angle"]) + model_yaw(),
                  f"{v['kind']} ({v['city']})" + (" - player's rental" if v.get("player") else ""), "CFS/Vehicles")
        a.static_mesh_component.set_static_mesh(mesh)
        a.static_mesh_component.set_material(0, tint(VEHICLE_PAINT.get(v["kind"], "#8a94a6"), roughness=0.25, metallic=0.4))
        a.set_actor_scale3d(unreal.Vector(MESH_SCALE, MESH_SCALE, MESH_SCALE))
        n += 1
    log(f"{n} vehicles placed")


def hero_parts(H):
    """Same assembly as Renderer3D.buildHero: (mesh name, colour, forward, up, side)."""
    top = H["jacket"] if H.get("outfit") == "chef" else H.get("shirt", "#ffffff")
    parts = [("torso", top, 0, 11, 0)]
    if H.get("outfit") == "suit":
        parts += [("jacket", H["jacket"], 0, 11, 0), ("lapel", H["jacket"], 0, 11, 0), ("collar", H["shirt"], 0, 11, 0), ("tie", H["tie"], 0, 11, 0), ("knot", H["tie"], 0, 11, 0)]
    if H.get("outfit") == "chef":
        parts += [("chefjacket", H["jacket"], 0, 11, 0), ("stud", H["piping"], 0, 11, 0), ("piping", H["piping"], 0, 11, 0)]
    if H.get("apron") == "half":
        parts += [("apron_half", H["apronColor"], 0, 11, 0), ("apron_band", H["apronColor"], 0, 11, 0)]
    if H.get("apron") == "bib":
        parts += [("apron_bib", H["apronColor"], 0, 11, 0), ("strap", H["apronColor"], 0, 11, 0), ("apron_band", H["apronColor"], 0, 11, 0)]
    parts += [("neck", H["skin"], 0, 18.6, 0), ("ear", H["skin"], 0, 18.6, 0)]
    if H.get("necklace"):
        parts.append(("necklace", "#d4d4d8", 0, 18.6, 0))
    if not H.get("toque") or H.get("hairStyle") != "short":
        lift = 1.0 if H.get("hairStyle") == "curly" else 0.45
        parts.append(("hair_" + H["hairStyle"], H["hair"], -0.2 if H.get("hairStyle") == "curly" else 0.15, 18.6 + lift, 0))
    if H.get("toque"):
        parts.append(("toque", "#141518", 0, 18.6, 0))
    if H.get("headphones"):
        parts.append(("headphones", "#111111", 0, 18.6, 0))
    if H.get("earring"):
        parts.append(("earring", "#c0c0c0", 0, 18.6, 0))
    if H.get("glasses"):
        parts += [("glasses_frame", "#b8862a" if H.get("glassesTint") else "#222222", 0, 18.6, 0), ("glasses_lens", H["glasses"], 0, 18.6, 0)]
    for side in (-1.7, 1.7):
        parts += [("leg", H["pants"], 0, 7, side), ("shoe_sneaker" if H.get("shoe") == "sneaker" else "shoe_dress", H.get("shoeColor", "#111111"), 0, 7, side)]
        if H.get("shoe") == "sneaker":
            parts.append(("shoe_sole", "#d9d9d9", 0, 7, side))
    sleeve = H["jacket"] if H.get("outfit") in ("chef", "suit") else H.get("shirt", "#ffffff")
    arm = H["jacket"] if H.get("outfit") in ("chef", "suit") else H["skin"]
    for side in (-4.8, 4.8):
        parts += [("arm", arm, 0, 14.5, side), ("sleeve", sleeve, 0, 14.5, side), ("hand", H["skin"], 0, 14.5, side)]
    return parts


def place_character(cid, x, y, heading_deg, folder):
    H = HEROES[cid]
    P = _state["meshes"]
    yaw = heading_deg + model_yaw()
    s = MESH_SCALE * CHAR_SCALE
    origin = vec(x, y, 0)
    cos, sin = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))

    def at(fwd, up, side):
        local = model_local(fwd * UNIT * CHAR_SCALE, side * UNIT * CHAR_SCALE, up * UNIT * CHAR_SCALE)
        return unreal.Vector(origin.x + local.x * cos - local.y * sin, origin.y + local.x * sin + local.y * cos, origin.z + local.z)

    def put(mesh_key, material, fwd, up, side, label):
        mesh = P.get(mesh_key)
        if not mesh:
            return None
        a = actors().spawn_actor_from_class(unreal.StaticMeshActor, at(fwd, up, side), rot(yaw))
        a.set_actor_label(label)
        a.set_folder_path(folder)
        a.static_mesh_component.set_static_mesh(mesh)
        if material:
            a.static_mesh_component.set_material(0, material)
        a.set_actor_scale3d(unreal.Vector(s, s, s))
        return a

    face = _state["materials"].get("face:" + cid)
    if face and P.get("part:head_photo"):
        put("part:head_photo", face, 0, 18.6, 0, f"{H['name']} head")
    else:
        put("part:head", tint(H["skin"]), 0, 18.6, 0, f"{H['name']} head")
        if H.get("beard"):
            put("part:beard", tint(H["beard"]), 0, 18.6, 0, f"{H['name']} beard")
        if H.get("mustache"):
            put("part:mustache", tint(H["mustache"]), 0, 18.6, 0, f"{H['name']} mustache")
        put("part:nose", tint(H["skin"]), 0, 18.6, 0, f"{H['name']} nose")
    for name, col, fwd, up, side in hero_parts(H):
        rough = 0.15 if name == "glasses_lens" else 0.65
        put("part:" + name, tint(col, roughness=rough), fwd, up, side, f"{H['name']} {name}")


def place_characters(world):
    n = 0
    for h in world["heroes"]:
        if h["id"] not in HEROES:
            continue
        label = HEROES[h["id"]]["name"] + (" (player)" if h.get("player") else f" ({h['city']})")
        place_character(h["id"], h["x"], h["y"], math.degrees(h["angle"]), f"CFS/Characters/{label}")
        n += 1
    log(f"{n} characters assembled")


def place_markers(world):
    ps = world["playerStart"]
    spawn(unreal.PlayerStart, ps["x"], ps["y"], 10, math.degrees(ps["angle"]), "PlayerStart - NY home kitchen", "CFS")
    for ep in world["episodes"]:
        try:
            a = spawn(unreal.TextRenderActor, ep["x"], ep["y"], 28, 180.0, f"Table {ep['n']} - {ep['name']}", f"CFS/Tables/{ep['city']}")
            tr = a.text_render
            tr.set_text(f"{ep['n']} · {ep['name']}\n{ep['who']}")
            tr.set_world_size(14.0)
            tr.set_horizontal_alignment(unreal.HorizTextAligment.EHTA_CENTER)
            tr.set_text_render_color(unreal.Color(255, 214, 102, 255))
        except Exception as exc:
            warn(f"marker for {ep['id']}: {exc}")
            break
    for shop in world["shops"]:
        spawn(unreal.TargetPoint, shop["x"], shop["y"], 2, 0, f"{shop['name']} ({shop['city']})", "CFS/Shops")
    for city, home in world["homes"].items():
        spawn(unreal.TargetPoint, home["door"]["x"], home["door"]["y"], 2, 0, f"Home Kitchen door ({city})", "CFS/Homes")


@phase
def build_level():
    if not _state["meshes"]:
        refresh_catalog()
    if not _state["materials"]:
        build_materials()
    world = load_world()
    log(f"world.json: {len(world['buildings'])} buildings, {len(world['props'])} props, {len(world['episodes'])} tables")
    fresh_level()
    inst = Instancer()
    build_tiles(world, inst)
    build_props(world, inst)
    inst.flush()
    place_vehicles(world)
    place_characters(world)
    place_markers(world)
    levels().save_current_level()
    log(f"saved {MAP}")


def run():
    """Everything: import, materials, level. Returns a short summary string."""
    import_assets()
    build_materials()
    build_level()
    summary = f"{len(_state['meshes'])} meshes, {len(_state['materials']) + len(_state['tints'])} materials, level {MAP}"
    log("done: " + summary)
    return summary


if __name__ == "__main__":
    run()
