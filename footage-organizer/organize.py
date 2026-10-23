#!/usr/bin/env python3
"""Footage Organizer: imports, sorts, groups and renames the media on your drives.

Finds every video, photo, raw and audio file on the drives you pick, reads when each
one was really shot (embedded metadata first, then the file name, then the file
date), groups them into shooting sessions by date and time gap, keeps multi-part
camera clips (GoPro chapters, DJI, Sony, Canon, iPhone...) together and in order,
and gives everything a name that sorts correctly:

    Organized/2024/2024-05-12_Miami-Beach/Video/2024-05-12_143005_Miami-Beach_V003-pt2_GoPro.mp4

Nothing is touched until you say so. The workflow is always:

    python3 organize.py drives                          # what's connected
    python3 organize.py scan /Volumes/CARD /Volumes/T7 --dest /Volumes/Archive/Organized
        -> writes plan.json, catalog.csv and report.html into the destination (_organizer/)
    python3 organize.py apply /Volumes/Archive/Organized/_organizer/plan.json
        -> copies (default; originals stay put) or --move, verifying every file
    python3 organize.py undo  /Volumes/Archive/Organized/_organizer/log-....jsonl

Run it with no arguments for a guided, question-by-question mode.

Standard library only, Python 3.8+. If ffprobe (from FFmpeg) or exiftool is
installed it is used to read dates, durations and camera models from inside the
files; without them the tool still works from EXIF in JPEG/raw files, file names
and file dates.
"""
import argparse
import csv
import datetime as dt
import hashlib
import html
import json
import os
import re
import shutil
import string
import subprocess
import sys
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

VERSION = "1.0"
WORKDIR = "_organizer"

VIDEO = {".mp4", ".mov", ".m4v", ".mts", ".m2ts", ".mxf", ".avi", ".mkv", ".insv", ".360",
         ".mpg", ".mpeg", ".wmv", ".3gp", ".webm", ".braw", ".r3d", ".crm", ".dv", ".flv", ".vob"}
PHOTO = {".jpg", ".jpeg", ".heic", ".heif", ".png", ".tif", ".tiff", ".webp", ".gif", ".bmp", ".insp"}
RAW = {".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".srf", ".sr2", ".dng", ".orf", ".rw2",
       ".raf", ".pef", ".srw", ".x3f", ".3fr", ".iiq", ".gpr"}
AUDIO = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".aif", ".aiff", ".ogg", ".wma", ".bwf"}
PROJECT = {".prproj", ".drp", ".aep", ".veg", ".fcpxml", ".aup3", ".aup", ".ptx", ".als",
           ".logicx", ".kdenlive", ".mlt", ".otio", ".edl", ".psd", ".psb", ".lrcat"}
SIDECAR = {".lrv", ".thm", ".lrf", ".srt", ".xmp", ".aae", ".xml", ".bim", ".cpi", ".ctg",
           ".sav", ".glv", ".bdm", ".mpl", ".ind", ".dat"}
JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini", ".localized", "ehthumbs.db", "icon\r"}
SKIP_DIRS = {"$recycle.bin", "system volume information", ".spotlight-v100", ".trashes",
             ".fseventsd", ".temporaryitems", ".documentrevisions-v100", "lost+found",
             ".trash", ".cache", "node_modules", ".git", "library", "applications",
             "program files", "program files (x86)", "windows", "programdata", "appdata",
             "cacheclip", "proxy media", "render files", "media cache files", "peak files",
             "media cache", "autosave", "adobe premiere pro auto-save", ".fcpcache"}

# Folder names that say nothing about the shoot; the session label comes from the
# nearest folder that isn't one of these.
GENERIC_DIRS = {"dcim", "private", "m4root", "clip", "clips", "avchd", "bdmv", "stream", "sub",
                "thmbnl", "general", "camera", "camera roll", "videos", "video", "movies", "photos",
                "pictures", "images", "footage", "media", "import", "imports", "dji", "card", "sd",
                "sdcard", "untitled", "new folder", "misc", "raw", "raws", "mp4", "mov", "jpg",
                "audio", "sound", "export", "exports", "backup", "backups", "desktop", "downloads",
                "documents", "users", "home", "volumes", "media", "mnt", "run", "a roll", "b roll",
                "a-roll", "b-roll", "originals", "original", "content", "files", "data", "dcim1",
                "hero", "gopro", "sony", "canon", "iphone", "drone", "xdroot", "contents",
                "fx3", "a7siii", "panorama", "timelapse", "hyperlapse", "slowmotion", "untitled folder"}
GENERIC_DIR_RE = re.compile(r"^(\d{3}[A-Z0-9_]{5}|\d+|\d{3}_\d{4}|\d{3}media|[a-z]?\d{1,4}|"
                            r"card\s*\d+|sd\s*\d+|disk\s*\d+|no name|eos_digital|lumix)$", re.I)
LEADING_DATE_RE = re.compile(r"^\s*(?:19|20)\d{2}(?:[-_. ]?\d{2}){0,2}[\s_.-]*")

EXPORT_WORDS = re.compile(r"(final|export|render|master|edit(ed)?|cut|draft|teaser|trailer|"
                          r"youtube|instagram|reel|tiktok|short|v\d+|_web|_hq|_lq|_1080|_4k)", re.I)

# -------------------------------------------------------------------- camera / file names

# Each entry: (camera label, regex on the stem, function(match) -> (clip_id, part)).
# clip_id ties together the parts (chapters) of one recording, part orders them.
CAMERA_PATTERNS = [
    ("GoPro", re.compile(r"^G[HXLPS](\d{2})(\d{4})$", re.I), lambda m: (m.group(2), int(m.group(1)))),
    ("GoPro", re.compile(r"^GOPR(\d{4})$", re.I), lambda m: (m.group(1), 0)),
    ("GoPro", re.compile(r"^GP(\d{2})(\d{4})$", re.I), lambda m: (m.group(2), int(m.group(1)))),
    ("DJI", re.compile(r"^DJI_\d{14}_(\d{4})", re.I), lambda m: (None, 0)),
    ("DJI", re.compile(r"^DJI_(\d{4})", re.I), lambda m: (None, 0)),
    ("Insta360", re.compile(r"^(VID|IMG|LRV)_\d{8}_\d{6}_\d{2}_(\d{3})", re.I), lambda m: (m.group(2), 0)),
    ("Sony", re.compile(r"^C(\d{4})(M01)?$", re.I), lambda m: (None, 0)),
    ("Sony", re.compile(r"^DSC\d{5}$", re.I), lambda m: (None, 0)),
    ("Canon", re.compile(r"^(MVI|_MG)_(\d{4})$", re.I), lambda m: (None, 0)),
    ("Nikon", re.compile(r"^(DSC|_DSC|DSCN)_?\d{4}$", re.I), lambda m: (None, 0)),
    ("Panasonic", re.compile(r"^P\d{7}$", re.I), lambda m: (None, 0)),
    ("Fujifilm", re.compile(r"^DSCF\d{4}$", re.I), lambda m: (None, 0)),
    ("Blackmagic", re.compile(r"^A\d{3}_\d{8}_C\d{3}", re.I), lambda m: (None, 0)),
    ("Zoom", re.compile(r"^ZOOM\d{4}", re.I), lambda m: (None, 0)),
    ("Phone", re.compile(r"^(IMG|VID|PXL|MVIMG)_\d{8}_\d{6}", re.I), lambda m: (None, 0)),
    ("Phone", re.compile(r"^IMG_E?\d{4}$", re.I), lambda m: (None, 0)),
    ("Screen", re.compile(r"^(Screen ?Recording|Screen ?Shot|Screenshot)", re.I), lambda m: (None, 0)),
]

FILENAME_DATE_RE = re.compile(
    r"(?<!\d)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])"
    r"(?:[-_ T.]?(?:at[ _])?([01]\d|2[0-3])[-_.:h]?([0-5]\d)[-_.:m]?([0-5]\d)?\d{0,3})?(?!\d)")


def match_camera(stem):
    for label, rx, fn in CAMERA_PATTERNS:
        m = rx.match(stem)
        if m:
            clip, part = fn(m)
            return label, clip, part
    return None, None, 0


def date_from_filename(name):
    for m in FILENAME_DATE_RE.finditer(name):
        y, mo, d, h, mi, s = m.groups()
        try:
            v = dt.datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0), int(s or 0))
        except ValueError:
            continue
        if plausible(v):
            return v, bool(h)
    return None, False


def plausible(v):
    return v is not None and dt.datetime(1995, 1, 1) <= v <= dt.datetime.now() + dt.timedelta(days=2)


def parse_meta_time(s):
    """Parses the date formats cameras and ffprobe/exiftool emit.

    Returns (naive datetime, zone) where zone is 'utc' (stored as UTC, convert to
    local), 'offset' (already converted to the wall clock it carried) or 'local'."""
    if not s or not isinstance(s, str):
        return None, None
    s = s.strip().replace("\x00", "")
    m = re.match(r"^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?", s)
    if not m:
        return None, None
    try:
        v = dt.datetime(*(int(x) for x in m.groups()[:6]))
    except ValueError:
        return None, None
    tz = m.group(7)
    if tz is None:
        return (v if plausible(v) else None), "local"
    if tz == "Z" or tz in ("+00:00", "+0000"):
        return (v if plausible(v) else None), "utc"
    return (v if plausible(v) else None), "offset"   # wall clock already, keep as-is


def utc_to_local(v):
    return v.replace(tzinfo=dt.timezone.utc).astimezone().replace(tzinfo=None)


# -------------------------------------------------------------------- EXIF (no deps)

def _tiff_tags(buf, base):
    """Reads Make, Model, dates and size from a TIFF block starting at buf[base]."""
    out = {}
    if buf[base:base + 2] == b"II":
        e = "<"
    elif buf[base:base + 2] == b"MM":
        e = ">"
    else:
        return out
    import struct

    def u16(o):
        return struct.unpack(e + "H", buf[base + o:base + o + 2])[0]

    def u32(o):
        return struct.unpack(e + "I", buf[base + o:base + o + 4])[0]

    def ifd(off, want):
        if off <= 0 or base + off + 2 > len(buf):
            return
        n = u16(off)
        for i in range(min(n, 512)):
            p = off + 2 + i * 12
            if base + p + 12 > len(buf):
                return
            tag, typ, cnt = u16(p), u16(p + 2), u32(p + 4)
            if tag not in want:
                continue
            if typ == 2:  # ASCII
                vo = p + 8 if cnt <= 4 else u32(p + 8)
                raw = buf[base + vo:base + vo + cnt]
                out[want[tag]] = raw.split(b"\x00")[0].decode("latin-1", "replace").strip()
            elif typ == 3:
                out[want[tag]] = u16(p + 8)
            elif typ in (4, 13):
                out[want[tag]] = u32(p + 8)

    ifd(u32(4), {0x010F: "make", 0x0110: "model", 0x0132: "datetime", 0x8769: "exif_ifd"})
    if "exif_ifd" in out:
        ifd(out.pop("exif_ifd"), {0x9003: "original", 0x9004: "digitized", 0x9011: "offset",
                                  0xA002: "width", 0xA003: "height"})
    return out


def read_exif(path):
    try:
        with open(path, "rb") as f:
            buf = f.read(256 * 1024)
    except OSError:
        return {}
    if buf[:2] == b"\xff\xd8":  # JPEG: walk segments to APP1 Exif
        i = 2
        while i + 4 < len(buf) and buf[i] == 0xFF:
            marker, seg = buf[i + 1], int.from_bytes(buf[i + 2:i + 4], "big")
            if marker == 0xE1 and buf[i + 4:i + 10] == b"Exif\x00\x00":
                return _tiff_tags(buf, i + 10)
            if marker == 0xDA:
                break
            i += 2 + seg
        return {}
    if buf[:2] in (b"II", b"MM"):  # TIFF and most raws (CR2, NEF, ARW, DNG, PEF...)
        return _tiff_tags(buf, 0)
    return {}


# -------------------------------------------------------------------- external tools

def which(name):
    return shutil.which(name)


def run_json(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
        return json.loads(r.stdout.decode("utf-8", "replace") or "null")
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def ffprobe(path, exe):
    data = run_json([exe, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path])
    if not data:
        return {}
    fmt = data.get("format") or {}
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    out = {}
    try:
        out["duration"] = float(fmt.get("duration") or 0) or None
    except ValueError:
        pass
    for s in data.get("streams") or []:
        st = {k.lower(): v for k, v in (s.get("tags") or {}).items()}
        if s.get("codec_type") == "video" and not out.get("width") and s.get("width"):
            out["width"], out["height"] = s.get("width"), s.get("height")
            out["codec"] = s.get("codec_name")
            tags.setdefault("creation_time", st.get("creation_time"))
        if st.get("handler_name", "").strip().lower().startswith("gopro"):
            out["make"] = "GoPro"
    out["time"] = (tags.get("com.apple.quicktime.creationdate") or tags.get("date")
                   or tags.get("creation_time"))
    out["make"] = out.get("make") or tags.get("com.apple.quicktime.make") or tags.get("make")
    out["model"] = tags.get("com.apple.quicktime.model") or tags.get("model")
    enc = (tags.get("encoder") or "") + " " + (tags.get("firmware") or "")
    if "gopro" in enc.lower():
        out["make"] = "GoPro"
    elif "dji" in enc.lower():
        out["make"] = "DJI"
    return out


def exiftool_batch(paths, exe):
    """One exiftool process per 400 files; returns {path: tags}."""
    out = {}
    fields = ["-DateTimeOriginal", "-CreateDate", "-MediaCreateDate", "-CreationDate",
              "-OffsetTimeOriginal", "-Make", "-Model", "-Duration", "-ImageWidth", "-ImageHeight"]
    for i in range(0, len(paths), 400):
        chunk = paths[i:i + 400]
        data = run_json([exe, "-j", "-n", "-q", "-q", "-fast2", "-charset", "filename=utf8"] + fields + chunk,
                        timeout=600)
        for d in data or []:
            out[os.path.normpath(d.get("SourceFile", ""))] = d
    return out


# -------------------------------------------------------------------- drives

def list_drives():
    drives = []
    if os.name == "nt":
        import ctypes
        for letter in string.ascii_uppercase:
            root = letter + ":\\"
            if not os.path.exists(root):
                continue
            name = ctypes.create_unicode_buffer(261)
            try:
                ctypes.windll.kernel32.GetVolumeInformationW(root, name, 261, None, None, None, None, 0)
            except Exception:
                pass
            drives.append((root, name.value or "Local Disk"))
    elif sys.platform == "darwin":
        for n in sorted(os.listdir("/Volumes")):
            p = os.path.join("/Volumes", n)
            if os.path.ismount(p) and os.path.realpath(p) != "/":
                drives.append((p, n))
        drives.insert(0, (os.path.expanduser("~"), "Home folder"))
    else:
        seen = set()
        try:
            with open("/proc/mounts") as f:
                for line in f:
                    parts = line.split()
                    mp = parts[1].replace("\\040", " ")
                    if mp.startswith(("/media/", "/run/media/", "/mnt/")) and mp not in seen:
                        seen.add(mp)
                        drives.append((mp, os.path.basename(mp)))
        except OSError:
            pass
        drives.insert(0, (os.path.expanduser("~"), "Home folder"))
    result = []
    for p, name in drives:
        try:
            u = shutil.disk_usage(p)
            if u.total >= 64 << 20 or p.endswith(":\\"):   # hide tiny system mounts
                result.append({"path": p, "name": name, "total": u.total, "free": u.free})
        except OSError:
            pass
    return result


def human(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return ("%.0f %s" if unit in ("B", "KB") else "%.1f %s") % (n, unit)
        n /= 1024


# -------------------------------------------------------------------- scanning

class Item:
    __slots__ = ("src", "root", "rel", "size", "mtime", "ext", "kind", "camera", "clip", "part",
                 "time", "time_src", "duration", "width", "height", "model", "label_hint",
                 "hash", "status", "reason", "session", "dst", "score", "parent")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


def classify(name, ext):
    low = name.lower()
    if low in JUNK_NAMES or low.startswith("._") or low.startswith("~$"):
        return "junk"
    if ext in VIDEO:
        return "video"
    if ext in RAW:
        return "raw"
    if ext in PHOTO:
        return "photo"
    if ext in AUDIO:
        return "audio"
    if ext in PROJECT:
        return "project"
    if ext in SIDECAR:
        return "sidecar"
    return "other"


def walk(roots, exclude, progress):
    items = []
    exclude = [os.path.normcase(os.path.abspath(e)) for e in exclude]
    for root in roots:
        root = os.path.abspath(root)
        for dirpath, dirnames, filenames in os.walk(root):
            nd = os.path.normcase(dirpath)
            if any(nd == e or nd.startswith(e + os.sep) for e in exclude):
                dirnames[:] = []
                continue
            dirnames[:] = sorted(d for d in dirnames
                                 if d.lower() not in SKIP_DIRS and not d.startswith(".")
                                 and not d.lower().endswith((".fcpbundle", ".photoslibrary", ".app",
                                                             ".imovielibrary", ".fcpcache")))
            for fn in sorted(filenames):
                p = os.path.join(dirpath, fn)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                ext = os.path.splitext(fn)[1].lower()
                kind = classify(fn, ext)
                mtime = st.st_mtime
                birth = getattr(st, "st_birthtime", None)
                if birth and 0 < birth < mtime:
                    mtime = birth
                items.append(Item(src=p, root=root, rel=os.path.relpath(p, root), size=st.st_size,
                                  mtime=mtime, ext=ext, kind=kind))
                if len(items) % 2000 == 0:
                    progress("  found %d files..." % len(items))
    return items


def label_hint(root, rel):
    """Nearest folder name that says something about the shoot ("2024-05-12 Miami Beach"
    gives "Miami Beach"); the scanned folder itself counts too."""
    parts = [os.path.basename(root.rstrip("\\/"))] + rel.replace("\\", "/").split("/")[:-1]
    for d in reversed(parts):
        d = LEADING_DATE_RE.sub("", d).strip()
        if not d or d.lower() in GENERIC_DIRS or GENERIC_DIR_RE.match(d):
            continue
        return d
    return None


def read_metadata(items, opts, progress):
    media = [it for it in items if it.kind in ("video", "photo", "raw", "audio")]
    ff, et = (None, None) if opts.no_tools else (which("ffprobe"), which("exiftool"))
    progress("Reading dates and camera info from %d media files (%s)..." % (
        len(media), ", ".join(t for t in (ff and "ffprobe", et and "exiftool") if t) or "built-in reader only"))
    et_data = exiftool_batch([it.src for it in media], et) if et else {}

    def one(it):
        stem = os.path.splitext(os.path.basename(it.src))[0]
        it.camera, it.clip, it.part = match_camera(stem)
        it.label_hint = label_hint(it.root, it.rel)
        meta_t, zone, make, model = None, None, None, None
        e = et_data.get(os.path.normpath(it.src))
        if e:
            for k in ("DateTimeOriginal", "CreationDate", "CreateDate", "MediaCreateDate"):
                t, z = parse_meta_time(str(e.get(k) or "") + (str(e.get("OffsetTimeOriginal") or "")
                                                             if k == "DateTimeOriginal" else ""))
                if t:
                    meta_t, zone = t, z
                    if k in ("CreateDate", "MediaCreateDate") and it.kind == "video" and z == "local":
                        zone = "utc"   # QuickTime CreateDate is UTC by spec
                    break
            make, model = e.get("Make"), e.get("Model")
            try:
                it.duration = float(e.get("Duration")) if e.get("Duration") not in (None, "") else None
            except (TypeError, ValueError):
                pass
            it.width, it.height = e.get("ImageWidth"), e.get("ImageHeight")
        if it.kind in ("video", "audio") and ff and (meta_t is None or it.duration is None):
            f = ffprobe(it.src, ff)
            if meta_t is None:
                meta_t, zone = parse_meta_time(f.get("time"))
            it.duration = it.duration or f.get("duration")
            it.width, it.height = it.width or f.get("width"), it.height or f.get("height")
            make, model = make or f.get("make"), model or f.get("model")
        if it.kind in ("photo", "raw") and meta_t is None:
            x = read_exif(it.src)
            meta_t, zone = parse_meta_time(x.get("original") or x.get("digitized") or x.get("datetime"))
            if meta_t and x.get("offset") and zone == "local":
                zone = "offset"
            make, model = make or x.get("make"), model or x.get("model")
            it.width, it.height = it.width or x.get("width"), it.height or x.get("height")
        if make:  # what the file says beats what its name suggests (IMG_1234: Canon or iPhone?)
            it.camera = camera_from_make(str(make)) or it.camera
        it.model = str(model).strip() if model else None
        if meta_t:
            # GoPros (and anything with --times-are-local) write local time labelled as UTC.
            if zone == "utc" and not opts.times_are_local and it.camera != "GoPro":
                meta_t = utc_to_local(meta_t)
            it.time, it.time_src = meta_t, "metadata"
        else:
            t, has_clock = date_from_filename(os.path.basename(it.src))
            if t:
                it.time, it.time_src = t, "filename" if has_clock else "filename-date"
            else:
                it.time, it.time_src = dt.datetime.fromtimestamp(it.mtime), "file-date"
        return it

    done = 0
    with ThreadPoolExecutor(max_workers=opts.workers) as pool:
        for _ in pool.map(one, media):
            done += 1
            if done % 250 == 0:
                progress("  %d / %d" % (done, len(media)))
    for it in items:
        if it.time is None:
            it.time, it.time_src = dt.datetime.fromtimestamp(it.mtime), "file-date"


def camera_from_make(make):
    m = make.lower()
    for key, label in (("gopro", "GoPro"), ("dji", "DJI"), ("hasselblad", "DJI"), ("apple", "iPhone"),
                       ("samsung", "Samsung"), ("google", "Pixel"), ("sony", "Sony"), ("canon", "Canon"),
                       ("nikon", "Nikon"), ("panasonic", "Panasonic"), ("fuji", "Fujifilm"),
                       ("blackmagic", "Blackmagic"), ("insta360", "Insta360"), ("arashi", "Insta360"),
                       ("olympus", "Olympus"), ("om digital", "OMSystem"), ("leica", "Leica"),
                       ("zoom", "Zoom"), ("rode", "Rode")):
        if key in m:
            return label
    return re.sub(r"[^A-Za-z0-9]", "", make.title())[:16] or None


# -------------------------------------------------------------------- duplicates

def file_hash(path, quick=False):
    h = hashlib.blake2b(digest_size=20)
    with open(path, "rb") as f:
        if quick:
            size = os.fstat(f.fileno()).st_size
            h.update(f.read(1 << 20))
            if size > 2 << 20:
                f.seek(-(1 << 20), 2)
                h.update(f.read(1 << 20))
            h.update(str(size).encode())
        else:
            for chunk in iter(lambda: f.read(8 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


COPY_NAME_RE = re.compile(r"(\bcopy\b|kopie|copie|\(\d+\)|-\d+$|_\d+\.\w+$)", re.I)


def find_duplicates(items, progress):
    """Same size -> same first/last MB -> same full hash. Keeps the copy with the
    best date source and shortest path; the rest are marked duplicate."""
    by_size = defaultdict(list)
    for it in items:
        if it.kind not in ("junk", "other") and it.size > 0:
            by_size[it.size].append(it)
    cands = [g for g in by_size.values() if len(g) > 1]
    if not cands:
        return 0
    progress("Checking %d possible duplicate groups..." % len(cands))
    rank = {"metadata": 0, "filename": 1, "filename-date": 2, "file-date": 3}
    dups = 0
    for group in cands:
        quick = defaultdict(list)
        for it in group:
            try:
                quick[file_hash(it.src, quick=True)].append(it)
            except OSError:
                pass
        for g in quick.values():
            if len(g) < 2:
                continue
            full = defaultdict(list)
            for it in g:
                try:
                    it.hash = file_hash(it.src)
                    full[it.hash].append(it)
                except OSError:
                    pass
            for same in full.values():
                same.sort(key=lambda i: (rank.get(i.time_src, 9), bool(COPY_NAME_RE.search(os.path.basename(i.src))),
                                         len(i.src), i.src))
                for d in same[1:]:
                    d.status, d.reason, d.parent = "duplicate", "same content as " + same[0].src, same[0]
                    dups += 1
    return dups


# -------------------------------------------------------------------- planning

def safe(s, n=40):
    s = re.sub(r"[^A-Za-z0-9]+", "-", s or "").strip("-")
    return s[:n].strip("-")


def relevance(it, opts):
    """0-100: how likely this is real, keep-worthy footage. Drives the review tier."""
    score = 50
    if it.time_src == "metadata":
        score += 15
    elif it.time_src == "file-date":
        score -= 10
    if it.camera and it.camera != "Screen":
        score += 10
    if it.kind == "video":
        d = it.duration
        if d is not None:
            if d < opts.min_clip:
                score -= 70   # accidental press: always review
            else:
                score += min(20, int(d // 30))
        if (it.width or 0) >= 3840:
            score += 5
    if it.kind in ("photo",):
        long_edge = max(it.width or 0, it.height or 0)
        if long_edge and long_edge < opts.min_photo:
            score -= 70
    if it.kind == "raw":
        score += 10
    if it.camera == "Screen":
        score -= 15
    return max(0, min(100, score))


def is_export(it):
    stem = os.path.splitext(os.path.basename(it.src))[0]
    return (it.kind == "video" and not it.camera and it.time_src != "metadata"
            and bool(EXPORT_WORDS.search(stem)))


def take_key(it):
    return (os.path.dirname(it.src), it.camera, it.clip) if it.clip and it.camera else None


def build_sessions(main, opts):
    """Sorts by capture time and cuts a new session wherever the gap between one
    recording ending and the next starting is longer than --gap minutes."""
    def start(it):
        return it.time

    def end(it):
        return it.time + dt.timedelta(seconds=it.duration or 0)

    # Chapters of one recording sort by the recording's start, then by part number,
    # so a long GoPro take never gets split up or interleaved with another camera.
    take_start = {}
    for it in main:
        k = take_key(it)
        if k:
            take_start[k] = min(take_start.get(k, it.time), it.time)
    main.sort(key=lambda i: (take_start.get(take_key(i), i.time), i.part or 0, i.time, i.src))
    sessions, cur, last_end = [], [], None
    gap = dt.timedelta(minutes=opts.gap)
    for it in main:
        if cur and (start(it) - last_end > gap or (opts.split_by_day and start(it).date() != cur[0].time.date())):
            sessions.append(cur)
            cur = []
            last_end = None
        cur.append(it)
        last_end = max(last_end, end(it)) if last_end else end(it)
    if cur:
        sessions.append(cur)
    return sessions


def session_label(items, opts):
    if opts.label:
        return safe(opts.label)
    hints = Counter(safe(i.label_hint) for i in items if i.label_hint and safe(i.label_hint))
    if hints:
        return hints.most_common(1)[0][0]
    cams = Counter(i.camera for i in items if i.camera and i.camera != "Screen")
    return "Shoot" if not cams else cams.most_common(1)[0][0] + "-Shoot"


def plan(items, dest, opts, progress):
    for it in items:
        it.status = it.status or "organize"
        if it.kind == "junk":
            it.status, it.reason = "skip", "system/junk file"
        elif it.kind == "other":
            it.status, it.reason = ("other", "not media") if opts.include_other else ("skip", "not media")

    media = [i for i in items if i.status == "organize" and i.kind in ("video", "photo", "raw", "audio")]
    for it in media:
        it.score = relevance(it, opts)
    exports = [i for i in media if is_export(i)]
    for it in exports:
        it.status = "export"
    main = [i for i in media if i.status == "organize"]

    sessions = build_sessions(main, opts)
    progress("Grouped %d recordings into %d sessions." % (len(main), len(sessions)))
    per_day = Counter(s[0].time.date() for s in sessions)
    day_idx = Counter()
    session_info = []
    sub = {"video": "Video", "photo": "Photos", "raw": "Photos", "audio": "Audio"}
    code = {"video": "V", "photo": "P", "raw": "P", "audio": "A"}
    for s in sessions:
        d = s[0].time.date()
        day_idx[d] += 1
        label = session_label(s, opts)
        name = "%s_%s" % (d.isoformat(), label) if per_day[d] == 1 else "%s_%d_%s" % (d.isoformat(), day_idx[d], label)
        sdir = os.path.join(dest, str(d.year), name)
        counters, takes = Counter(), {}
        parts = Counter(take_key(i) for i in s if take_key(i))
        for it in s:
            it.session = name
            letter = code[it.kind]
            tk = take_key(it) if parts[take_key(it)] > 1 else None
            if tk and tk in takes:
                num = takes[tk]
            else:
                counters[letter] += 1
                num = counters[letter]
                if tk:
                    takes[tk] = num
            seq = "%s%03d" % (letter, num)
            if tk:
                seq += "-pt%d" % max(1, it.part)
            cam = safe(it.camera or "", 16)
            new = "%s_%s_%s%s%s" % (it.time.strftime("%Y-%m-%d_%H%M%S"), label, seq,
                                    "_" + cam if cam else "", it.ext)
            folder = os.path.join(sdir, sub[it.kind])
            if it.score is not None and it.score < opts.review_below:
                folder = os.path.join(sdir, "_Review")
                it.status, it.reason = "review", review_reason(it, opts)
            it.dst = os.path.join(folder, new)
        session_info.append({
            "name": name, "folder": sdir, "start": s[0].time.isoformat(sep=" "),
            "end": max(i.time + dt.timedelta(seconds=i.duration or 0) for i in s).isoformat(sep=" ", timespec="seconds"),
            "videos": sum(1 for i in s if i.kind == "video"),
            "photos": sum(1 for i in s if i.kind in ("photo", "raw")),
            "audio": sum(1 for i in s if i.kind == "audio"),
            "minutes": round(sum(i.duration or 0 for i in s if i.kind == "video") / 60, 1),
            "size": sum(i.size for i in s),
            "cameras": sorted({i.camera for i in s if i.camera}),
        })

    for it in exports:
        it.dst = os.path.join(dest, "_Exports", str(it.time.year),
                              "%s_%s" % (it.time.strftime("%Y-%m-%d"), os.path.basename(it.src)))
        it.reason = "edited/exported video (no camera metadata)"

    # Sidecars (proxies, thumbnails, telemetry) follow the file they belong to.
    owners = {}
    for it in media:
        if it.dst:
            owners[os.path.splitext(it.src)[0].lower()] = it
    for it in items:
        if it.status == "duplicate":
            continue
        if it.kind == "sidecar":
            stem = os.path.splitext(it.src)[0].lower()
            owner = owners.get(stem) or owners.get(re.sub(r"m01$", "", stem))   # Sony C0001M01.XML
            base, fn = os.path.split(stem)
            if not owner and fn.startswith("gl"):   # GoPro proxy GL010123.LRV -> GX010123.MP4
                owner = owners.get(os.path.join(base, "gx" + fn[2:])) or owners.get(os.path.join(base, "gh" + fn[2:]))
            if not owner and fn.startswith("lrv_"):  # Insta360 proxy LRV_... -> VID_...
                owner = owners.get(os.path.join(base, "vid_" + fn[4:]))
            if owner:
                it.status = "sidecar"
                it.time = owner.time
                it.dst = os.path.join(os.path.dirname(os.path.dirname(owner.dst)), "Sidecars",
                                      os.path.splitext(os.path.basename(owner.dst))[0] + it.ext)
                it.reason = "belongs to " + os.path.basename(owner.dst)
            else:
                it.status, it.reason = "skip", "sidecar without its media file"
        elif it.kind == "project" and it.status == "organize":
            it.status, it.reason = "project", "kept with original name (moving media breaks project links)"
            it.dst = os.path.join(dest, "_Projects", str(it.time.year), it.rel)
        elif it.status == "other":
            it.dst = os.path.join(dest, "_Other", safe(os.path.basename(it.root), 30) or "drive", it.rel)

    for it in items:
        if it.status == "duplicate":
            it.dst = os.path.join(dest, "_Duplicates", safe(os.path.basename(it.root), 30) or "drive", it.rel)

    # Never let two files land on the same name, including files from earlier imports
    # (an identical file already there is fine: apply skips it).
    taken = set()
    for it in sorted((i for i in items if i.dst), key=lambda i: i.src):
        base, ext = os.path.splitext(it.dst)
        n, cand = 1, it.dst
        while cand.lower() in taken or (os.path.exists(cand) and os.path.getsize(cand) != it.size):
            n += 1
            cand = "%s_%d%s" % (base, n, ext)
        it.dst = cand
        taken.add(cand.lower())
    return session_info


def review_reason(it, opts):
    if it.kind == "video" and it.duration is not None and it.duration < opts.min_clip:
        return "very short clip (%.1fs) - probably accidental" % it.duration
    if it.kind == "photo" and max(it.width or 0, it.height or 0) < opts.min_photo:
        return "tiny image - thumbnail or screenshot"
    if it.camera == "Screen":
        return "screen recording / screenshot"
    return "low relevance score"


# -------------------------------------------------------------------- reports

STATUS_ORDER = ["organize", "review", "sidecar", "export", "project", "other", "duplicate", "skip"]


def write_outputs(items, sessions, dest, opts, sources):
    wd = os.path.join(dest, WORKDIR)
    os.makedirs(wd, exist_ok=True)
    ops = []
    for it in items:
        if not it.dst:
            continue
        if it.status == "duplicate" and not opts.move:
            continue  # copying duplicates just wastes space; they're listed in the catalog
        ops.append({"src": it.src, "dst": it.dst, "size": it.size, "status": it.status, "hash": it.hash})
    planfile = os.path.join(wd, "plan.json")
    with open(planfile, "w", encoding="utf-8") as f:
        json.dump({"version": VERSION, "created": dt.datetime.now().isoformat(timespec="seconds"),
                   "sources": sources, "dest": dest, "mode": "move" if opts.move else "copy",
                   "sessions": sessions, "operations": ops}, f, indent=1)
    with open(os.path.join(wd, "catalog.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["status", "session", "new_name", "destination", "source", "kind", "captured",
                    "date_from", "camera", "model", "duration_s", "resolution", "size_bytes", "relevance", "note"])
        for it in sorted(items, key=lambda i: (STATUS_ORDER.index(i.status) if i.status in STATUS_ORDER else 99,
                                               i.time or dt.datetime.min, i.src)):
            w.writerow([it.status, it.session or "", os.path.basename(it.dst) if it.dst else "", it.dst or "",
                        it.src, it.kind, it.time.isoformat(sep=" ") if it.time else "", it.time_src or "",
                        it.camera or "", it.model or "", round(it.duration, 2) if it.duration else "",
                        "%sx%s" % (it.width, it.height) if it.width else "", it.size,
                        it.score if it.score is not None else "", it.reason or ""])
    write_html(items, sessions, os.path.join(wd, "report.html"), dest, opts, sources)
    return planfile


def write_html(items, sessions, path, dest, opts, sources):
    c = Counter(i.status for i in items)
    sz = defaultdict(int)
    for i in items:
        sz[i.status] += i.size
    e = html.escape
    rows = "".join(
        "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>".format(
            e(s["name"]), e(s["start"][:16]), e(s["end"][11:16]), s["videos"], s["minutes"], s["photos"],
            s["audio"], e(", ".join(s["cameras"]) or "-") + " &middot; " + human(s["size"]))
        for s in sessions)
    review = [i for i in items if i.status == "review"]
    rrows = "".join("<tr><td>{}</td><td>{}</td><td>{}</td></tr>".format(
        e(os.path.basename(i.src)), e(i.reason or ""), e(i.dst or "")) for i in review[:500])
    dups = [i for i in items if i.status == "duplicate"]
    drows = "".join("<tr><td>{}</td><td>{}</td><td>{}</td></tr>".format(
        e(i.src), e(i.parent.src if i.parent else ""), human(i.size)) for i in dups[:500])
    labels = {"organize": "Organized into sessions", "review": "Set aside for review", "sidecar": "Proxies & sidecars",
              "export": "Edited exports", "project": "Project files", "other": "Other files",
              "duplicate": "Duplicates", "skip": "Skipped"}
    tiles = "".join('<div class="tile"><b>{}</b><span>{}</span><small>{}</small></div>'.format(
        c[k], labels[k], human(sz[k])) for k in STATUS_ORDER if c[k])
    doc = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Footage Organizer Report</title><style>
:root{{--bg:#fafaf8;--fg:#1c1c1a;--mut:#6b6a66;--line:#e3e2dd;--card:#fff;--acc:#c2410c}}
@media (prefers-color-scheme:dark){{:root{{--bg:#161615;--fg:#ecebe6;--mut:#9b9a94;--line:#2e2d2a;--card:#1f1f1d;--acc:#fb923c}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}}
main{{max-width:1100px;margin:auto;padding:24px 16px}} h1{{margin:0 0 4px}} p{{color:var(--mut);margin:0 0 20px}}
.tiles{{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:28px}}
.tile{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}}
.tile b{{display:block;font-size:24px;color:var(--acc)}} .tile span{{display:block}} .tile small{{color:var(--mut)}}
.wrap{{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:28px}}
table{{border-collapse:collapse;width:100%;font-size:13px}} th,td{{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}}
th{{color:var(--mut);font-weight:600}} code{{font-size:13px}}</style></head><body><main>
<h1>Footage Organizer</h1><p>{when} &middot; sources: {src} &middot; destination: <code>{dest}</code> &middot; mode: {mode}</p>
<div class="tiles">{tiles}</div>
<h2>Sessions ({ns})</h2><div class="wrap"><table><tr><th>Folder</th><th>Start</th><th>End</th><th>Videos</th><th>Video min</th><th>Photos</th><th>Audio</th><th>Cameras &middot; size</th></tr>{rows}</table></div>
<h2>Set aside for review ({nr})</h2><div class="wrap"><table><tr><th>File</th><th>Why</th><th>Goes to</th></tr>{rrows}</table></div>
<h2>Duplicates ({nd})</h2><div class="wrap"><table><tr><th>Duplicate</th><th>Kept copy</th><th>Size</th></tr>{drows}</table></div>
<p>Full list of every file: catalog.csv (opens in Excel / Numbers / Sheets).</p></main></body></html>"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(doc.format(when=dt.datetime.now().strftime("%Y-%m-%d %H:%M"), src=e(", ".join(sources)),
                           dest=e(dest), mode="move" if opts.move else "copy", tiles=tiles, ns=len(sessions),
                           rows=rows, nr=len(review), rrows=rrows, nd=len(dups), drows=drows))


# -------------------------------------------------------------------- apply / undo

def copy_verified(src, dst):
    """Streams src -> dst.part while hashing, checks the written file, then renames."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".part"
    h = hashlib.blake2b(digest_size=20)
    with open(src, "rb") as fi, open(tmp, "wb") as fo:
        for chunk in iter(lambda: fi.read(8 << 20), b""):
            h.update(chunk)
            fo.write(chunk)
        fo.flush()
        os.fsync(fo.fileno())
    digest = h.hexdigest()
    if file_hash(tmp) != digest:
        os.remove(tmp)
        raise IOError("verification failed (copy differs from original)")
    shutil.copystat(src, tmp)
    os.replace(tmp, dst)
    return digest


def apply_plan(planfile, move=None, progress=print):
    with open(planfile, encoding="utf-8") as f:
        p = json.load(f)
    move = p["mode"] == "move" if move is None else move
    ops = p["operations"]
    need = sum(o["size"] for o in ops if not os.path.exists(o["dst"]))
    free = shutil.disk_usage(p["dest"]).free
    if not move and need > free:
        raise SystemExit("Not enough space on the destination: need %s, %s free." % (human(need), human(free)))
    logfile = os.path.join(os.path.dirname(planfile), "log-%s.jsonl" % dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    done = skipped = failed = 0
    total, moved_bytes, t0 = len(ops), 0, time.time()
    with open(logfile, "a", encoding="utf-8") as log:
        for n, o in enumerate(ops, 1):
            src, dst = o["src"], o["dst"]
            try:
                if not os.path.exists(src):
                    raise IOError("source missing")
                if os.path.exists(dst):
                    if os.path.getsize(dst) == os.path.getsize(src) and file_hash(dst) == file_hash(src):
                        skipped += 1  # already there from an earlier run
                        continue
                    raise IOError("a different file already exists at the destination")
                if move:
                    try:
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        os.rename(src, dst)    # same drive: instant
                        digest = None
                    except OSError:
                        digest = copy_verified(src, dst)
                        os.remove(src)
                    action = "move"
                else:
                    digest = copy_verified(src, dst)
                    action = "copy"
                log.write(json.dumps({"action": action, "src": src, "dst": dst, "hash": digest}) + "\n")
                log.flush()
                done += 1
                moved_bytes += o["size"]
            except (OSError, IOError) as ex:
                failed += 1
                log.write(json.dumps({"action": "error", "src": src, "dst": dst, "error": str(ex)}) + "\n")
                progress("  ! %s: %s" % (src, ex))
            if n % 25 == 0 or n == total:
                rate = moved_bytes / max(0.001, time.time() - t0)
                progress("  %d / %d files  (%s, %s/s)" % (n, total, human(moved_bytes), human(rate)))
    progress("Done: %d %s, %d already in place, %d failed. Log: %s" % (
        done, "moved" if move else "copied", skipped, failed, logfile))
    return logfile, failed


def undo(logfile, progress=print):
    with open(logfile, encoding="utf-8") as f:
        entries = [json.loads(l) for l in f if l.strip()]
    n = 0
    for e in reversed(entries):
        try:
            if e["action"] == "move" and os.path.exists(e["dst"]) and not os.path.exists(e["src"]):
                os.makedirs(os.path.dirname(e["src"]), exist_ok=True)
                try:
                    os.rename(e["dst"], e["src"])
                except OSError:
                    copy_verified(e["dst"], e["src"])
                    os.remove(e["dst"])
                n += 1
            elif e["action"] == "copy" and os.path.exists(e["dst"]) and os.path.exists(e["src"]):
                if e.get("hash") is None or file_hash(e["dst"]) == e["hash"]:
                    os.remove(e["dst"])   # the original is untouched, only our copy goes
                    n += 1
            else:
                continue
            d = os.path.dirname(e["dst"])
            while d and os.path.isdir(d) and not os.listdir(d):
                os.rmdir(d)
                d = os.path.dirname(d)
        except OSError as ex:
            progress("  ! %s: %s" % (e["dst"], ex))
    progress("Undid %d operations." % n)


# -------------------------------------------------------------------- commands

def do_scan(sources, dest, opts, progress=print):
    sources = [os.path.abspath(s) for s in sources]
    dest = os.path.abspath(dest)
    for s in sources:
        if not os.path.isdir(s):
            raise SystemExit("Not a folder: " + s)
    progress("Scanning %s ..." % ", ".join(sources))
    items = walk(sources, [dest] + (opts.exclude or []), progress)
    kinds = Counter(i.kind for i in items)
    progress("Found %d files: %s" % (len(items), ", ".join("%d %s" % (v, k) for k, v in kinds.most_common())))
    read_metadata(items, opts, progress)
    if not opts.no_dedupe:
        progress("Duplicates: %d" % find_duplicates(items, progress))
    sessions = plan(items, dest, opts, progress)
    planfile = write_outputs(items, sessions, dest, opts, sources)
    c = Counter(i.status for i in items)
    progress("")
    progress("Plan: %d into %d sessions, %d for review, %d sidecars, %d exports, %d projects, %d duplicates, %d skipped" % (
        c["organize"], len(sessions), c["review"], c["sidecar"], c["export"], c["project"], c["duplicate"], c["skip"]))
    for s in sessions[:15]:
        progress("  %-45s %3d videos %6.1f min  %3d photos  %s" % (s["name"], s["videos"], s["minutes"], s["photos"],
                                                                   ", ".join(s["cameras"])))
    if len(sessions) > 15:
        progress("  ... and %d more (see report.html)" % (len(sessions) - 15))
    progress("")
    progress("Report:  " + os.path.join(dest, WORKDIR, "report.html"))
    progress("Catalog: " + os.path.join(dest, WORKDIR, "catalog.csv"))
    progress("Plan:    " + planfile)
    return planfile


def ask(q, default=None):
    a = input("%s%s: " % (q, " [%s]" % default if default else "")).strip()
    return a or default


def guided(opts):
    print("Footage Organizer %s - guided mode (nothing is changed until the last step)\n" % VERSION)
    drives = list_drives()
    for n, d in enumerate(drives, 1):
        print("  %d) %-30s %-40s %s free of %s" % (n, d["name"][:30], d["path"][:40], human(d["free"]), human(d["total"])))
    print()
    pick = ask("Which drives/folders hold the footage? Numbers separated by commas, or type a folder path")
    sources = []
    for tok in (pick or "").split(","):
        tok = tok.strip().strip('"').strip("'")
        if tok.isdigit() and 1 <= int(tok) <= len(drives):
            sources.append(drives[int(tok) - 1]["path"])
        elif tok:
            sources.append(os.path.expanduser(tok))
    if not sources:
        raise SystemExit("Nothing selected.")
    dest = ask("Where should the organized library go? (a folder path, ideally on a drive with room)")
    if not dest:
        raise SystemExit("No destination given.")
    dest = os.path.expanduser(dest.strip('"').strip("'"))
    opts.label = ask("Name for these shoots (Enter = name each session from its folder names)", None)
    opts.move = (ask("Copy (keep originals) or move? c/m", "c") or "c").lower().startswith("m")
    planfile = do_scan(sources, dest, opts)
    print("\nOpen the report to check it: " + os.path.join(dest, WORKDIR, "report.html"))
    if (ask("Go ahead and %s the files now? y/n" % ("move" if opts.move else "copy"), "n") or "n").lower().startswith("y"):
        apply_plan(planfile, opts.move)
    else:
        print("Nothing changed. Run later with:  python3 organize.py apply \"%s\"" % planfile)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Import, sort, group and rename footage on your drives.")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("drives", help="list connected drives")
    sc = sub.add_parser("scan", help="scan sources and write a plan (changes nothing)")
    sc.add_argument("sources", nargs="*", help="drives or folders to scan")
    sc.add_argument("--all-drives", action="store_true", help="scan every connected external drive")
    sc.add_argument("--dest", required=True, help="where the organized library goes")
    sc.add_argument("--move", action="store_true", help="plan a move instead of a copy")
    ap_ = sub.add_parser("apply", help="carry out a plan")
    ap_.add_argument("plan")
    g = ap_.add_mutually_exclusive_group()
    g.add_argument("--move", dest="move", action="store_true", default=None)
    g.add_argument("--copy", dest="move", action="store_false")
    un = sub.add_parser("undo", help="reverse an apply using its log file")
    un.add_argument("log")
    for p in (sc, ap):
        p.add_argument("--label", help="name for the shoots instead of deriving it from folder names")
        p.add_argument("--gap", type=float, default=90, help="minutes without recording that start a new session (90)")
        p.add_argument("--split-by-day", action="store_true", default=True, help=argparse.SUPPRESS)
        p.add_argument("--no-day-split", dest="split_by_day", action="store_false",
                       help="let a session run past midnight")
        p.add_argument("--min-clip", type=float, default=2.0, help="clips shorter than this (s) go to _Review (2)")
        p.add_argument("--min-photo", type=int, default=640, help="images smaller than this (px) go to _Review (640)")
        p.add_argument("--review-below", type=int, default=30, help="relevance score under which files go to _Review")
        p.add_argument("--include-other", action="store_true", help="also copy non-media files into _Other")
        p.add_argument("--exclude", action="append", help="folder to leave out (repeatable)")
        p.add_argument("--times-are-local", action="store_true",
                       help="camera clocks were set to local time but files say UTC")
        p.add_argument("--no-dedupe", action="store_true", help="skip duplicate detection (faster)")
        p.add_argument("--no-tools", action="store_true", help="don't use ffprobe/exiftool even if installed")
        p.add_argument("--workers", type=int, default=8)
    ap.set_defaults(move=False)
    opts = ap.parse_args(argv)

    if opts.cmd is None:
        return guided(opts)
    if opts.cmd == "drives":
        for d in list_drives():
            print("%-30s %-45s %10s free of %s" % (d["name"][:30], d["path"], human(d["free"]), human(d["total"])))
        return
    if opts.cmd == "scan":
        sources = list(opts.sources)
        if opts.all_drives:
            sources += [d["path"] for d in list_drives() if d["name"] != "Home folder"
                        and not os.path.abspath(opts.dest).startswith(os.path.abspath(d["path"]))]
        if not sources:
            raise SystemExit("Give at least one drive or folder to scan (or --all-drives).")
        do_scan(sources, opts.dest, opts)
    elif opts.cmd == "apply":
        _, failed = apply_plan(opts.plan, opts.move)
        sys.exit(1 if failed else 0)
    elif opts.cmd == "undo":
        undo(opts.log)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped. Anything already copied is logged; run apply again to resume.")
        sys.exit(130)
