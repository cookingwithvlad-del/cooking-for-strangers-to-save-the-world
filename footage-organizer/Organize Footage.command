#!/bin/bash
# macOS: double-click to run the guided organizer in Terminal.
cd "$(dirname "$0")"
python3 organize.py
echo
read -n 1 -s -r -p "Press any key to close."
