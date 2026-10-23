#!/usr/bin/env python3
"""Writes app/data/midis/index.json: the list of the .mid files in app/data/midis, which the sequencer's
MIDI FILE menu shows. Run it after adding or removing files: tools/make-midi-list.py"""
import json, os, re

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "data", "midis")

def title(f):
    name = re.sub(r"\.midi?$", "", f, flags=re.I)
    name = name.replace("_-_", " - ").replace("_", " ")
    return " ".join(w if w.isupper() else w[:1].upper() + w[1:] for w in name.split())

files = sorted(f for f in os.listdir(DIR) if re.search(r"\.midi?$", f, re.I))
with open(os.path.join(DIR, "index.json"), "w") as out:
    json.dump([{"file": f, "name": title(f)} for f in files], out, indent="\t", ensure_ascii=False)
    out.write("\n")
print(len(files), "files")
