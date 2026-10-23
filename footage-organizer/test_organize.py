"""Tests for organize.py. Run: python3 -m unittest test_organize -v

Builds fake camera cards in a temp folder (GoPro chapters, iPhone, DJI, photos with
EXIF, duplicates, junk), scans, applies, checks names and folders, then undoes.
Video fixtures need ffmpeg; those tests are skipped without it."""
import datetime as dt
import json
import os
import shutil
import struct
import subprocess
import tempfile
import unittest

import organize as org

FFMPEG = shutil.which("ffmpeg") and shutil.which("ffprobe")


def jpeg_with_exif(path, when, make="Canon", model="EOS R5", w=6000, h=4000):
    """A minimal JPEG whose APP1 holds IFD0 (Make, Model) and an Exif IFD
    (DateTimeOriginal, pixel size)."""
    e = "<"
    make_b, model_b, date_b = make.encode() + b"\0", model.encode() + b"\0", when.encode() + b"\0"
    ifd0_n, exif_n = 3, 3
    ifd0_off = 8
    exif_off = ifd0_off + 2 + ifd0_n * 12 + 4
    data_off = exif_off + 2 + exif_n * 12 + 4
    make_off, model_off = data_off, data_off + len(make_b)
    date_off = model_off + len(model_b)
    t = b"II" + struct.pack(e + "HI", 42, ifd0_off)
    t += struct.pack(e + "H", ifd0_n)
    t += struct.pack(e + "HHII", 0x010F, 2, len(make_b), make_off)
    t += struct.pack(e + "HHII", 0x0110, 2, len(model_b), model_off)
    t += struct.pack(e + "HHII", 0x8769, 4, 1, exif_off) + struct.pack(e + "I", 0)
    t += struct.pack(e + "H", exif_n)
    t += struct.pack(e + "HHII", 0x9003, 2, len(date_b), date_off)
    t += struct.pack(e + "HHII", 0xA002, 4, 1, w)
    t += struct.pack(e + "HHII", 0xA003, 4, 1, h) + struct.pack(e + "I", 0)
    t += make_b + model_b + date_b
    app1 = b"Exif\0\0" + t
    with open(path, "wb") as f:
        f.write(b"\xff\xd8\xff\xe1" + struct.pack(">H", len(app1) + 2) + app1 + b"\xff\xd9" + os.urandom(64))


def video(path, seconds, when, extra=()):
    subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-f", "lavfi", "-i",
                    "testsrc=size=320x240:rate=10:duration=%s" % seconds, "-c:v", "mpeg4",
                    "-metadata", "creation_time=" + when] + list(extra) + [path], check=True)


class Opts:
    label = None
    gap = 90
    split_by_day = True
    min_clip = 2.0
    min_photo = 640
    review_below = 30
    include_other = False
    exclude = None
    times_are_local = False
    no_dedupe = False
    no_tools = False
    workers = 4
    move = False


def put(p, data):
    with open(p, "wb" if isinstance(data, bytes) else "w") as f:
        f.write(data)


def mk(p):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


class UnitTests(unittest.TestCase):
    def test_camera_patterns(self):
        self.assertEqual(org.match_camera("GX020123"), ("GoPro", "0123", 2))
        self.assertEqual(org.match_camera("GH010045"), ("GoPro", "0045", 1))
        self.assertEqual(org.match_camera("GOPR0007"), ("GoPro", "0007", 0))
        self.assertEqual(org.match_camera("DJI_0042")[0], "DJI")
        self.assertEqual(org.match_camera("C0001")[0], "Sony")
        self.assertEqual(org.match_camera("MVI_1234")[0], "Canon")
        self.assertEqual(org.match_camera("PXL_20240512_143005123")[0], "Phone")
        self.assertEqual(org.match_camera("holiday")[0], None)

    def test_filename_dates(self):
        self.assertEqual(org.date_from_filename("PXL_20240512_143005123.mp4"),
                         (dt.datetime(2024, 5, 12, 14, 30, 5), True))
        self.assertEqual(org.date_from_filename("Screen Recording 2023-11-02 at 09.15.44.mov"),
                         (dt.datetime(2023, 11, 2, 9, 15, 44), True))
        self.assertEqual(org.date_from_filename("trip 2022-07-04.jpg"), (dt.datetime(2022, 7, 4), False))
        self.assertEqual(org.date_from_filename("C0001.MP4"), (None, False))
        self.assertEqual(org.date_from_filename("19991340.jpg"), (None, False))

    def test_meta_time_zones(self):
        self.assertEqual(org.parse_meta_time("2024:05:12 14:30:05"), (dt.datetime(2024, 5, 12, 14, 30, 5), "local"))
        self.assertEqual(org.parse_meta_time("2024-05-12T14:30:05.000000Z")[1], "utc")
        self.assertEqual(org.parse_meta_time("2024-05-12T14:30:05-0400"), (dt.datetime(2024, 5, 12, 14, 30, 5), "offset"))
        self.assertEqual(org.parse_meta_time("1904-01-01T00:00:00Z")[0], None)
        self.assertEqual(org.parse_meta_time("garbage"), (None, None))

    def test_exif_reader(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "x.jpg")
        jpeg_with_exif(p, "2021:03:04 05:06:07")
        x = org.read_exif(p)
        self.assertEqual((x["make"], x["model"], x["original"], x["width"]), ("Canon", "EOS R5", "2021:03:04 05:06:07", 6000))
        shutil.rmtree(d)

    def test_copy_names(self):
        for n in ("IMG_0001 copy.JPG", "IMG_0001 (1).JPG", "IMG_0001 2.JPG", "clip - Copy.mp4"):
            self.assertTrue(org.COPY_NAME_RE.search(n), n)
        for n in ("IMG_0001.JPG", "GX010007.MP4", "DJI_0042.MP4", "C0001.MP4"):
            self.assertFalse(org.COPY_NAME_RE.search(n), n)

    def test_label_hint(self):
        self.assertEqual(org.label_hint("/Volumes/CARD", "DCIM/100GOPRO/GX010001.MP4"), None)
        self.assertEqual(org.label_hint("/x", "2024-05-12 Miami Beach/DCIM/100GOPRO/a.mp4"), "Miami Beach")
        self.assertEqual(org.label_hint("/Volumes/Chicago Dinner", "PRIVATE/M4ROOT/CLIP/C0001.MP4"), "Chicago Dinner")


@unittest.skipUnless(FFMPEG, "needs ffmpeg/ffprobe")
class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.card = os.path.join(self.tmp, "Miami Beach")
        self.card2 = os.path.join(self.tmp, "NO NAME")
        self.dest = os.path.join(self.tmp, "Organized")
        c = self.card
        # GoPro: one long take split into chapters GX01/GX02 0007, then a separate take 0008.
        # GoPro stores local time labelled UTC.
        video(mk(c + "/DCIM/100GOPRO/GX010007.MP4"), 3, "2024-05-12T14:30:00Z", ["-metadata", "encoder=GoPro AVC encoder"])
        video(mk(c + "/DCIM/100GOPRO/GX020007.MP4"), 3, "2024-05-12T14:41:00Z", ["-metadata", "encoder=GoPro AVC encoder"])
        video(mk(c + "/DCIM/100GOPRO/GX010008.MP4"), 3, "2024-05-12T15:00:00Z", ["-metadata", "encoder=GoPro AVC encoder"])
        put(c + "/DCIM/100GOPRO/GL010007.LRV", b"proxy")
        put(c + "/DCIM/100GOPRO/GX010007.THM", b"thumb")
        # Accidental 1-second clip -> review
        video(mk(c + "/DCIM/100GOPRO/GX010009.MP4"), 1, "2024-05-12T15:10:00Z", ["-metadata", "encoder=GoPro AVC encoder"])
        # Photos with EXIF, same shoot
        jpeg_with_exif(mk(c + "/DCIM/100CANON/IMG_0001.JPG"), "2024:05:12 14:35:00")
        jpeg_with_exif(c + "/DCIM/100CANON/IMG_0002.JPG", "2024:05:12 14:36:00")
        # Junk
        put(c + "/.DS_Store", b"x")
        put(c + "/DCIM/._GX010007.MP4", b"x")
        # Second card: iPhone clip with an offset timestamp the next day, an exact duplicate, an edit export.
        video(mk(self.card2 + "/IMG_4001.MOV"), 3, "2024-05-13T09:00:00Z",
              ["-metadata", "com.apple.quicktime.creationdate=2024-05-13T10:15:00-0400",
               "-metadata", "com.apple.quicktime.make=Apple", "-movflags", "use_metadata_tags"])
        shutil.copy(c + "/DCIM/100CANON/IMG_0001.JPG", mk(self.card2 + "/backup/IMG_0001 copy.JPG"))
        video(mk(self.card2 + "/Miami_FINAL_v3.mp4"), 2, "2000-01-01T00:00:00Z")
        subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-i", self.card2 + "/Miami_FINAL_v3.mp4",
                        "-map_metadata", "-1", "-c", "copy", self.card2 + "/Miami_FINAL_v4.mp4"], check=True)
        os.remove(self.card2 + "/Miami_FINAL_v3.mp4")
        put(self.card2 + "/notes.txt", "hello")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def files(self, root):
        out = []
        for dp, _, fns in os.walk(root):
            for f in fns:
                out.append(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, "/"))
        return sorted(f for f in out if not f.startswith(org.WORKDIR))

    def test_scan_apply_undo(self):
        quiet = lambda *a: None
        planfile = org.do_scan([self.card, self.card2], self.dest, Opts(), progress=quiet)
        with open(planfile) as f:
            plan = json.load(f)
        names = [s["name"] for s in plan["sessions"]]
        self.assertEqual(names, ["2024-05-12_Miami-Beach", "2024-05-13_iPhone-Shoot"])

        org.apply_plan(planfile, progress=quiet)
        got = self.files(self.dest)
        s1 = "2024/2024-05-12_Miami-Beach/"
        expect = [
            s1 + "Video/2024-05-12_143000_Miami-Beach_V001-pt1_GoPro.mp4",
            s1 + "Video/2024-05-12_144100_Miami-Beach_V001-pt2_GoPro.mp4",
            s1 + "Video/2024-05-12_150000_Miami-Beach_V002_GoPro.mp4",
            s1 + "Photos/2024-05-12_143500_Miami-Beach_P001_Canon.jpg",
            s1 + "Photos/2024-05-12_143600_Miami-Beach_P002_Canon.jpg",
            s1 + "Sidecars/2024-05-12_143000_Miami-Beach_V001-pt1_GoPro.lrv",
            s1 + "Sidecars/2024-05-12_143000_Miami-Beach_V001-pt1_GoPro.thm",
            s1 + "_Review/2024-05-12_151000_Miami-Beach_V003_GoPro.mp4",
            "2024/2024-05-13_iPhone-Shoot/Video/2024-05-13_101500_iPhone-Shoot_V001_iPhone.mov",
        ]
        for e in expect:
            self.assertIn(e, got)
        self.assertTrue(any(f.startswith("_Exports/") and f.endswith("Miami_FINAL_v4.mp4") for f in got), got)
        self.assertFalse(any("DS_Store" in f or "/._" in f or "copy" in f or "notes" in f for f in got), got)
        # originals untouched in copy mode
        self.assertTrue(os.path.exists(self.card + "/DCIM/100GOPRO/GX010007.MP4"))

        # Running apply again is a no-op (resume-safe).
        log2, failed = org.apply_plan(planfile, progress=quiet)
        self.assertEqual(failed, 0)

        logs = sorted(f for f in os.listdir(os.path.join(self.dest, org.WORKDIR)) if f.startswith("log-"))
        org.undo(os.path.join(self.dest, org.WORKDIR, logs[0]), progress=quiet)
        self.assertEqual(self.files(self.dest), [])

    def test_move_mode_and_label(self):
        o = Opts()
        o.move, o.label = True, "Cookbook Shoot"
        quiet = lambda *a: None
        planfile = org.do_scan([self.card], self.dest, o, progress=quiet)
        log, failed = org.apply_plan(planfile, progress=quiet)
        self.assertEqual(failed, 0)
        self.assertFalse(os.path.exists(self.card + "/DCIM/100GOPRO/GX010007.MP4"))
        self.assertIn("2024/2024-05-12_Cookbook-Shoot/Video/2024-05-12_143000_Cookbook-Shoot_V001-pt1_GoPro.mp4",
                      self.files(self.dest))
        org.undo(log, progress=quiet)
        self.assertTrue(os.path.exists(self.card + "/DCIM/100GOPRO/GX010007.MP4"))

    def test_in_place_and_remove_duplicates(self):
        quiet = lambda *a: None
        both = os.path.join(self.tmp, "WD Drive")
        shutil.move(self.card, os.path.join(both, "Miami Beach"))
        shutil.move(self.card2, os.path.join(both, "NO NAME"))
        org.main(["scan", both, "--in-place"])
        planfile = os.path.join(both, "Organized", org.WORKDIR, "plan.json")
        org.apply_plan(planfile, progress=quiet)
        lib = self.files(os.path.join(both, "Organized"))
        self.assertIn("2024/2024-05-12_Miami-Beach/Video/2024-05-12_143000_Miami-Beach_V001-pt1_GoPro.mp4", lib)
        dup = [f for f in lib if f.startswith("_Duplicates/")]
        self.assertEqual(len(dup), 1, lib)
        # moved-out folders are gone; non-media files stay where they were
        self.assertFalse(os.path.exists(os.path.join(both, "Miami Beach", "DCIM", "100GOPRO", "GX010007.MP4")))
        self.assertTrue(os.path.exists(os.path.join(both, "NO NAME", "notes.txt")))
        self.assertEqual(org.remove_duplicates(planfile, yes=True, progress=quiet), 1)
        lib = self.files(os.path.join(both, "Organized"))
        self.assertFalse(any(f.startswith("_Duplicates/") and not f.endswith("/") for f in lib), lib)
        self.assertIn("2024/2024-05-12_Miami-Beach/Photos/2024-05-12_143500_Miami-Beach_P001_Canon.jpg", lib)
        self.assertEqual(org.remove_duplicates(planfile, yes=True, progress=quiet), 0)

    def test_remove_duplicates_from_source_after_copy(self):
        quiet = lambda *a: None
        planfile = org.do_scan([self.card, self.card2], self.dest, Opts(), progress=quiet)
        org.apply_plan(planfile, progress=quiet)
        copy_path = self.card2 + "/backup/IMG_0001 copy.JPG"
        self.assertTrue(os.path.exists(copy_path))
        self.assertEqual(org.remove_duplicates(planfile, yes=True, progress=quiet), 1)
        self.assertFalse(os.path.exists(copy_path))
        self.assertTrue(os.path.exists(self.card + "/DCIM/100CANON/IMG_0001.JPG"))


if __name__ == "__main__":
    unittest.main()
