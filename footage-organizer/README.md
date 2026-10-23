# Footage Organizer

Imports, sorts, groups and renames the video, photo and audio on your hard drives and camera cards.

- **By date:** reads when each file was really shot. It checks the metadata inside the file first, then the file name, and only then the file's modified date.
- **By session:** footage recorded close together becomes one shoot. A gap of more than 90 minutes, or a new day, starts a new session.
- **In sequence:** clips are numbered in the order they were shot. Long recordings that the camera split into several files (GoPro chapters and similar) keep one take number, with `-pt1`, `-pt2` and so on.
- **By relevance:** camera originals go into the session folders. Accidental 1-second clips, thumbnails and screen recordings go to `_Review`. Edited exports go to `_Exports`, and duplicates are listed but never copied twice. System junk such as `.DS_Store` and `._` files is skipped.
- **Duplicates removed:** identical files are found by content, not just by name. `remove-duplicates` deletes them, but first re-checks each one byte-for-byte against the copy that stays.
- **Safely:** nothing changes until you approve the plan. Copy mode (the default) never touches the originals. Every copy is checked against its original before it counts, and if an import is interrupted, running it again resumes where it stopped. `undo` reverses an import.

```
Organized/
  2024/
    2024-05-12_Miami-Beach/
      Video/    2024-05-12_143000_Miami-Beach_V001-pt1_GoPro.mp4
                2024-05-12_144100_Miami-Beach_V001-pt2_GoPro.mp4
                2024-05-12_150000_Miami-Beach_V002_GoPro.mp4
      Photos/   2024-05-12_143500_Miami-Beach_P001_Canon.jpg
      Audio/    2024-05-12_143010_Miami-Beach_A001_Zoom.wav
      Sidecars/ 2024-05-12_143000_Miami-Beach_V001-pt1_GoPro.lrv   (proxies, thumbnails, DJI .srt)
      _Review/  2024-05-12_151000_Miami-Beach_V003_GoPro.mp4      (1-second clip)
    2024-05-13_1_Chicago-Dinner/   (two sessions on one day get _1, _2)
    2024-05-13_2_Chicago-Dinner/
  _Exports/2024/   edited videos (names like FINAL, export, v3 with no camera metadata)
  _Projects/2024/  Premiere / Resolve / After Effects files, original names kept
  _Duplicates/     only used in move mode
  _organizer/      report.html, catalog.csv, plan.json, log files
```

The session name (`Miami-Beach`) comes from the nearest meaningful folder name. Generic ones such as `DCIM`, `100GOPRO` or `PRIVATE/M4ROOT` are skipped, and a leading date is stripped from folders like `2024-05-12 Miami Beach`. If no folder name says anything about the shoot, the camera name is used. You can also set the name yourself with `--label`.

## Install

You need Python 3.8 or newer. Macs and most Linux machines already have it; on Windows, get it from python.org.

For the best dates and camera names, also install either of these. Both are optional:

- **FFmpeg** (provides `ffprobe`): `brew install ffmpeg` on a Mac, `winget install ffmpeg` on Windows.
- **ExifTool**: `brew install exiftool`, or from exiftool.org.

Without them the tool still reads EXIF from JPEG and raw photos, dates in file names, and file dates.

## Use it

**Easiest:** double-click `Organize Footage.command` (Mac) or `Organize Footage.bat` (Windows). It lists your connected drives and asks:

1. which drives to import from
2. where the organized library should go
3. what to call the shoots
4. whether to copy or move

It then shows the plan before anything is copied. Press Enter at the destination question to reorganize the drive itself: files are moved into an `Organized` folder on the same drive, which is instant and needs no extra space. After the import it offers to delete the duplicates.

**From a terminal:**

```bash
python3 organize.py drives                      # list connected drives

# 1. Plan. Changes nothing; writes the report into <dest>/_organizer/
python3 organize.py scan "/Volumes/GOPRO" "/Volumes/T7 Shield" --dest "/Volumes/Archive/Organized"
python3 organize.py scan --all-drives --dest "D:\Organized"      # every external drive

# 2. Open <dest>/_organizer/report.html (and catalog.csv in Excel) and check it

# 3. Import
python3 organize.py apply "/Volumes/Archive/Organized/_organizer/plan.json"          # copy
python3 organize.py apply "/Volumes/Archive/Organized/_organizer/plan.json" --move   # move

# Or reorganize one drive in place (moves files into <drive>/Organized)
python3 organize.py scan "/Volumes/WD Drive" --in-place
python3 organize.py apply "/Volumes/WD Drive/Organized/_organizer/plan.json"

# Delete the duplicates (asks you to type DELETE; each is re-verified first)
python3 organize.py remove-duplicates "/Volumes/WD Drive/Organized/_organizer/plan.json"

# Changed your mind? (undo restores moves and removes copies; deleted duplicates stay deleted)
python3 organize.py undo "/Volumes/Archive/Organized/_organizer/log-20241023-101500.jsonl"
```

Useful options for `scan`:

| Option | What it does |
|---|---|
| `--label "Taco Night"` | Name every session this, instead of using folder names |
| `--gap 30` | Minutes without recording that start a new session (default 90) |
| `--no-day-split` | Let a session run past midnight |
| `--min-clip 3` | Clips shorter than this many seconds go to `_Review` (default 2) |
| `--include-other` | Also copy non-media files, into `_Other/` |
| `--exclude PATH` | Leave a folder out (can be repeated) |
| `--times-are-local` | Use this when your camera clock was set to local time but the files say UTC and the times come out shifted (GoPro is already handled) |
| `--no-dedupe` | Skip duplicate checking, which is faster on huge drives |

Running `scan` on new cards later adds to the same library. A file that is already there is recognized and skipped. If a new file would land on a name that a different file already uses, it gets a `_2` suffix.

## Good to know

- **Use copy mode if any editing projects point at this footage.** Premiere, Resolve and Final Cut projects link to the media's old paths, so moving or renaming the media breaks those links. Project files themselves are copied into `_Projects/` under their original names.
- Folders that hold editor caches or app libraries are skipped, such as Final Cut libraries, Photos libraries and `CacheClip`.
- Every file appears in `catalog.csv` with its status, new name, date, where the date came from (`metadata`, `filename` or `file-date`), camera, duration, resolution and relevance score.

## Tests

```bash
python3 -m unittest test_organize -v     # the end-to-end tests need ffmpeg
```
