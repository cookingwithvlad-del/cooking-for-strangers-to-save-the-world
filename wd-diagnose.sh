#!/bin/bash
# Read-only check of why a WD external drive won't mount on a Mac.
# Changes nothing on the drive. Run it in Terminal with the drive plugged in:
#   bash wd-diagnose.sh

echo "== Mounted volumes =="
ls /Volumes

echo; echo "== External disks the Mac can see =="
diskutil list external

echo; echo "== USB devices named WD / Western Digital =="
system_profiler SPUSBDataType 2>/dev/null | grep -i -A3 -E "western digital|my passport|elements|easystore|wd " | head -20

echo; echo "== Disk checks running in the background (these block mounting) =="
ps aux | grep -E "fsck_(exfat|hfs|apfs|msdos)" | grep -v grep || echo "none"

echo; echo "== Third-party NTFS / WD drivers =="
systemextensionsctl list 2>/dev/null | grep -i -E "paragon|tuxera|ntfs|wd" || echo "none in system extensions"
kextstat 2>/dev/null | grep -i -E "paragon|tuxera|ntfs|wd" || echo "none in kernel extensions"
ls /Applications 2>/dev/null | grep -i -E "wd |western|paragon|tuxera|ntfs" || echo "no WD/NTFS apps in /Applications"

echo; echo "== Verdict =="
if ps aux | grep -E "fsck_(exfat|hfs|apfs|msdos)" | grep -v grep >/dev/null; then
  echo "macOS is checking the drive before it mounts it (fsck). Wait for it to finish,"
  echo "or ask Claude for the read-only mount command for your disk."
elif diskutil list external | grep -q -i "SES\|Unlocker"; then
  echo "The drive is locked by WD hardware encryption. Install the current WD Security app"
  echo "from Western Digital's support site and unlock it with your password."
elif ! diskutil list external | grep -q "/dev/disk"; then
  echo "The Mac does not see the drive at all: try another cable and port, plug directly"
  echo "into the Mac (no hub), and check the drive's power adapter if it has one."
elif diskutil list external | grep -q "Windows_NTFS\|Microsoft Basic Data"; then
  echo "The drive is NTFS/exFAT-from-Windows and seen but not mounted. If a Paragon/Tuxera"
  echo "driver is listed above, update or uninstall it. Otherwise try: diskutil mountDisk <disk>"
else
  echo "The drive is seen but not mounted. Try: diskutil mountDisk <disk from the list above>"
  echo "and paste any error to Claude."
fi
echo
echo "Do NOT click Initialize or Erase if macOS offers it: that wipes the footage."
