#!/usr/bin/env python3
"""Rewrites the game's .glb models for engines that import one static mesh per node.

The Blender pipeline exports every part of a model as its own node with a
translation/rotation/scale, which is what the Three.js renderer wants. Unreal's
glTF import turns each node into a StaticMesh asset in its own local space and
drops the node transform, so wheels end up at the origin. This script bakes the
node transforms into the vertex data and merges nodes:

  --merge all      one mesh per file            (vehicles, head)
  --merge name     one mesh per base node name  (hero and prop parts: "lapel.001" -> "lapel")

Pure Python, no dependencies: it reads POSITION / NORMAL / TEXCOORD_0 and indices,
applies the node's world matrix, and writes a new GLB with identity nodes.

  python3 tools/bake_glb.py assets/3d/vehicles/sedan.glb unreal/SourceAssets/vehicles/sedan.glb --merge all
  python3 tools/bake_glb.py --all      # every model the Unreal project uses
"""
import argparse
import json
import math
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise SystemExit(f"{path}: not a GLB file")
    off, doc, bin_chunk = 12, None, b""
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            doc = json.loads(chunk)
        elif ctype == 0x004E4942:
            bin_chunk = chunk
        off += 8 + clen
    return doc, bin_chunk


def read_accessor(doc, bin_chunk, index):
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    fmt, size = COMPONENT[acc["componentType"]]
    n = COUNT[acc["type"]]
    stride = view.get("byteStride") or size * n
    base = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    out = []
    for i in range(acc["count"]):
        out.append(struct.unpack_from("<" + fmt * n, bin_chunk, base + i * stride))
    return out


def quat_to_mat(q):
    x, y, z, w = q
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def node_matrix(node):
    """4x4 row-major local matrix from TRS or matrix."""
    if "matrix" in node:
        m = node["matrix"]  # column-major
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    t = node.get("translation", [0, 0, 0]); r = node.get("rotation", [0, 0, 0, 1]); s = node.get("scale", [1, 1, 1])
    rm = quat_to_mat(r)
    return [[rm[i][j] * s[j] for j in range(3)] + [t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def xform_point(m, p):
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] for i in range(3))


def xform_normal(m, n):
    v = [m[i][0] * n[0] + m[i][1] * n[1] + m[i][2] * n[2] for i in range(3)]
    ln = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / ln for c in v)


def world_matrices(doc):
    parents = {}
    for i, node in enumerate(doc.get("nodes", [])):
        for c in node.get("children", []):
            parents[c] = i
    cache = {}

    def world(i):
        if i in cache:
            return cache[i]
        local = node_matrix(doc["nodes"][i])
        m = mat_mul(world(parents[i]), local) if i in parents else local
        cache[i] = m
        return m
    return [world(i) for i in range(len(doc.get("nodes", [])))]


def bake(src, dst, merge="all"):
    doc, bin_chunk = read_glb(src)
    mats = world_matrices(doc)
    groups = {}  # name -> {"pos": [], "nrm": [], "uv": [], "idx": []}
    for i, node in enumerate(doc.get("nodes", [])):
        if "mesh" not in node:
            continue
        name = node.get("name", f"node{i}")
        key = "mesh" if merge == "all" else name.split(".")[0]
        g = groups.setdefault(key, {"pos": [], "nrm": [], "uv": [], "idx": [], "has_uv": True})
        m = mats[i]
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            attrs = prim["attributes"]
            pos = read_accessor(doc, bin_chunk, attrs["POSITION"])
            nrm = read_accessor(doc, bin_chunk, attrs["NORMAL"]) if "NORMAL" in attrs else None
            uv = read_accessor(doc, bin_chunk, attrs["TEXCOORD_0"]) if "TEXCOORD_0" in attrs else None
            idx = [t[0] for t in read_accessor(doc, bin_chunk, prim["indices"])] if "indices" in prim else list(range(len(pos)))
            base = len(g["pos"])
            g["pos"].extend(xform_point(m, p) for p in pos)
            if nrm is None:
                nrm = [(0.0, 1.0, 0.0)] * len(pos)
            g["nrm"].extend(xform_normal(m, n) for n in nrm)
            if uv is None:
                g["has_uv"] = False
                g["uv"].extend([(0.0, 0.0)] * len(pos))
            else:
                g["uv"].extend(uv)
            det = (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
            tris = [idx[k:k + 3] for k in range(0, len(idx) - 2, 3)]
            for tri in tris:
                a, b, c = tri
                if det < 0:  # mirrored node: flip winding to keep faces outward
                    b, c = c, b
                g["idx"].extend((base + a, base + b, base + c))

    # write
    blob = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def add_view(data, target):
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob.extend(data)
        return len(views) - 1

    for name, g in groups.items():
        pos_bytes = b"".join(struct.pack("<3f", *p) for p in g["pos"])
        nrm_bytes = b"".join(struct.pack("<3f", *n) for n in g["nrm"])
        idx_bytes = b"".join(struct.pack("<I", i) for i in g["idx"])
        mins = [min(p[k] for p in g["pos"]) for k in range(3)]
        maxs = [max(p[k] for p in g["pos"]) for k in range(3)]
        attrs = {}
        accessors.append({"bufferView": add_view(pos_bytes, 34962), "componentType": 5126, "count": len(g["pos"]), "type": "VEC3", "min": mins, "max": maxs}); attrs["POSITION"] = len(accessors) - 1
        accessors.append({"bufferView": add_view(nrm_bytes, 34962), "componentType": 5126, "count": len(g["nrm"]), "type": "VEC3"}); attrs["NORMAL"] = len(accessors) - 1
        if g["has_uv"]:
            uv_bytes = b"".join(struct.pack("<2f", *t[:2]) for t in g["uv"])
            accessors.append({"bufferView": add_view(uv_bytes, 34962), "componentType": 5126, "count": len(g["uv"]), "type": "VEC2"}); attrs["TEXCOORD_0"] = len(accessors) - 1
        accessors.append({"bufferView": add_view(idx_bytes, 34963), "componentType": 5125, "count": len(g["idx"]), "type": "SCALAR"})
        mesh_name = os.path.splitext(os.path.basename(dst))[0] if name == "mesh" else name
        meshes.append({"name": mesh_name, "primitives": [{"attributes": attrs, "indices": len(accessors) - 1, "mode": 4}]})
        nodes.append({"name": mesh_name, "mesh": len(meshes) - 1})

    out = {
        "asset": {"version": "2.0", "generator": "cooking-for-strangers bake_glb.py"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes, "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(out, separators=(",", ":")).encode()
    while len(js) % 4:
        js += b" "
    while len(blob) % 4:
        blob.append(0)
    total = 12 + 8 + len(js) + 8 + len(blob)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    with open(dst, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)
    return [(n["name"], len(groups[k]["pos"])) for k, n in zip(groups, nodes)]


ALL = [("assets/3d/vehicles/%s.glb", "unreal/SourceAssets/vehicles/%s.glb", "all", ["sedan", "sports", "van", "foodtruck", "bus", "taxi", "police", "rental", "scooter"]),
       ("assets/3d/%s.glb", "unreal/SourceAssets/%s.glb", "all", ["head"]),
       ("assets/3d/%s.glb", "unreal/SourceAssets/%s.glb", "name", ["hero", "props", "person"])]

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", nargs="?"); ap.add_argument("dst", nargs="?")
    ap.add_argument("--merge", choices=["all", "name"], default="all")
    ap.add_argument("--all", action="store_true", help="bake every model the Unreal project imports")
    a = ap.parse_args()
    if a.all:
        for src_t, dst_t, merge, names in ALL:
            for n in names:
                parts = bake(os.path.join(ROOT, src_t % n), os.path.join(ROOT, dst_t % n), merge)
                print(f"{dst_t % n}: {len(parts)} mesh(es), {sum(v for _, v in parts)} verts")
    elif a.src and a.dst:
        for name, verts in bake(a.src, a.dst, a.merge):
            print(f"  {name}: {verts} verts")
    else:
        ap.print_help(); sys.exit(1)
