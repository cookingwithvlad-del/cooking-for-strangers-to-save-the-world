# Cooking for Strangers to Save the World — The Game

A top-down, open-world driving game built from the cookbook *Cooking for Strangers to Save the World* by Vlad Briantsev & Orly Israel. Two cooks, a knife roll, a cardboard sign and a rental car, working their way through 68 tables in four cities — Manhattan, Miami, Chicago and Los Angeles — toward ten thousand strangers fed.

No build step. Plain JavaScript, rendered in 3D with Three.js (vendored in `js/vendor/`, MIT) — a GTA-style chase camera behind Vlad or the car. Press V to cycle chase / high / overhead cameras. A 2D top-down renderer is the automatic fallback if WebGL isn't available, and you can switch to it from the pause menu (or open the game with `?2d=1`) on a slow phone.

### How it stays fast on a phone

Draw calls are what kill frame rate on mobile GPUs, so the renderer is built around avoiding them: the whole static city is merged into about ten meshes (roads, sidewalks, parks, buildings, glass, props, signs), and every car, pedestrian, dog, traffic light and contact shadow is drawn through `InstancedMesh` — one draw call per body part for the entire crowd. A typical frame is under 40 draw calls. Phones additionally get pixel ratio 1, fewer lights, no shadow maps (contact shadows instead), a shorter draw distance and fewer clouds and raindrops.

### Built in Blender

The cars, the character, the street props and all the surface textures come out of Blender, run headlessly as the `bpy` Python module by `tools/blender_assets.py`:

```
python3.11 -m venv bpyenv && bpyenv/bin/pip install "bpy==4.2.23"
bpyenv/bin/python tools/blender_assets.py            # everything, ~8 minutes on 4 CPU cores
bpyenv/bin/python tools/blender_assets.py vehicles   # or one stage: vehicles person props hero faces facade surfaces sky shrink
```

- **Vehicles** (`assets/3d/vehicles/*.glb`): bodies extruded from side profiles with bevelled edges and boolean wheel arches, separate glass, trim, wheels and rims, one model per class (sedan, taxi, police, rental, sports, van, food truck, bus, scooter). The game instances each part, so paint colour is per car and the whole traffic costs a few draw calls.
- **Character** (`person.glb`): rounded limbs, torso, head, hair cap and hat as unit-sized parts the game scales and animates.
- **Named characters** (`hero.glb`, 36 parts): built from the character reference sheets — torso with shoulders, suit jacket with lapels, collar and tie, double-breasted chef jacket with studs and piping, half and bib aprons, toque, four hair styles (short, messy, bowl, curly), beard, mustache, sunglasses, headphones, earring, necklace, dress shoes and sneakers. `js/people.js` describes each person (Vlad, Orly, Alex Kislov, Chef Anthony, Jean Phil) and the renderer assembles them with a painted face: Vlad is the player, Orly follows with the sign, Anthony works every Home Kitchen, Jean Phil shadowboxes in a New York park, Alex DJs in Chicago and stands in for the Kislov episodes. Press F to talk to any of them.
- **Faces** (`head.glb`, `faces/*.jpg`): the five named characters wear their real faces. A base head is sculpted from a sphere in Blender (eye sockets, brow, nose, cheekbones, mouth, chin, jaw taper), the front and profile shots from each character reference sheet (`assets/ref/`) are projected onto it as two UV layers, blended by the surface normal, and Cycles bakes the result into one 512px skin texture per person. The game loads that head mesh and texture instead of the painted sphere, keeping the modeled hair, glasses, headphones, toque and ears on top. Landmarks (eye line, chin, ear, nose tip) per sheet live in `FACES` in the pipeline script.
- **Props** (`props.glb`): tree, palm, lamp post, bench, hydrant, traffic light, trash can, merged into the static city.
- **Textures** (`tex/`): baked with Cycles. Four facades, each a real wall modeled in 3D — brick with recessed windows, sills and lintels; a glass curtain wall with spandrel bands and mullions; Miami stucco with balconies, railings and shutters; a concrete office with ribbon windows — baked high-to-low onto a tile as colour (with ambient occlusion multiplied in), tangent-space normal, roughness and an emissive map of lit windows. The game picks a style per block from the city's mix (New York leans brick, Florida and LA stucco, Chicago brick and concrete; tall centre blocks go glass) and tints each one. Asphalt, concrete, grass, sand and water are procedural materials baked to colour and normal maps.
- **Rendering extras on desktop**: clear-coat car paint, rain puddles that reflect the sky environment, a bloom pass for neon, headlights and lit windows at night, and faces, necks, hands and shoes on every pedestrian.
- **Skies** (`sky/`): Nishita sky renders at morning, noon, dusk and night, used as reflection environments for car paint, glass and wet roads.

### The look

A sun that moves across a shaded sky dome through sunrise, noon, dusk and night; ACES filmic tone mapping; humid haze that's thicker in Florida and LA and in the rain; procedural textures for asphalt, concrete, grass, sand, water and building facades whose windows glow at night; storefront glass, awnings and neon signs at street level; traffic lights that cycle; palms in the southern cities; wet roads that pick up headlight and streetlight reflections when it rains; real shadows on desktop.

## Unreal Engine

The browser game is the game; `unreal/` is the same world handed to Unreal Engine 5 so it can be walked, lit and built on with Nanite, Lumen and a real character controller. Nothing in this repo needs the engine to be installed to run the browser version.

**Connect Claude Code to a running editor.** The project turns on Unreal's built-in Python remote execution (`unreal/Config/DefaultEngine.ini`), so an editor with this project open can be driven from outside without compiling a plugin:

```
python3 tools/unreal_bridge.py ping          # which editors are listening
python3 tools/unreal_bridge.py build         # import the models and build the Four Cities level
python3 tools/unreal_bridge.py exec "unreal.log('hello from the terminal')"
```

`.mcp.json` registers the open-source [UEMCP](https://pypi.org/project/uemcp/) server (speaks the same protocol, installs with `uvx`), so Claude Code opened in this folder on the machine running the editor gets Unreal tools automatically. Epic's own [Unreal Engine skills for Claude Code](https://github.com/EpicGames/unreal-engine-skills-for-claude-code-plugin) plugin is the heavier alternative: it needs the ModelContextProtocol and AllToolsets engine plugins (listed as optional in the `.uproject`) and exposes hundreds of editor tools.

**Build the world.** Open `unreal/CookingForStrangers.uproject` (UE 5.3 or newer) and pick Tools > Cooking for Strangers > Build Four Cities, or run `import cfs_build; cfs_build.run()` in the Python console, or use the bridge above. `Content/Python/cfs_build.py` then:

1. imports the models from `unreal/SourceAssets` (the game's glb files with node transforms baked in by `tools/bake_glb.py`, so each becomes a clean StaticMesh), the Cycles-baked textures and the five photo faces;
2. builds materials: world-aligned facades per style with lit windows, ground materials, a tint material with one instance per colour, and a face material per character;
3. creates `Maps/FourCities`, lights it (sun, sky atmosphere, sky light, haze), and lays out the city from `Content/Data/world.json` (written by `node tools/export_world.js`): roads, sidewalks, rivers and bridges, beaches, parks, every building with its block's facade style, height and tint, storefronts, 1,400 street props, 64 parked cars, Vlad, Orly, Alex, Anthony and Jean Phil assembled from their parts with their real faces, a text marker at all 68 tables, target points at the shops and home kitchens, and a PlayerStart at the New York kitchen.

Scale is 10 cm per game unit: a block tile is 3.2 m, a sedan 3.3 m, the characters about 1.8 m. Drop in the Third Person template and you can walk the four cities. The mission logic, traffic, police and cooking live in `js/game.js` and would be a Blueprint port; `world.json` carries everything they'd need (episode spots, shops, homes, parking).

The build script was written against the UE 5.3 to 5.6 Python API without an editor at hand: every phase is wrapped so a renamed property costs one phase, not the build, and the Output Log says which. It has been exercised end to end against a stand-in `unreal` module and the bridge against a fake editor; the first real run may need a property name or two adjusted.

## Play

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

Works on desktop (keyboard) and phones (on-screen controls). Progress auto-saves to the browser.

## Checks

`deno lint` and `deno test` run on every push (`.github/workflows/deno.yml`). Lint skips the vendored libraries in `js/vendor/` (see `deno.json`); the tests in `tests/` check that the story data and the generated city hold together. Run them locally with:

```
deno lint && deno test -A
```

## How it plays

Every table in the book is a mission, in the book's order:

1. **Find the stranger.** They're marked on the minimap. Walk up, press F, and Orly holds up the sign. Pick the line that would actually get a yes — no catch, no camera, no money. Wrong line, they walk; try again in a few seconds.
2. **Shop the menu.** The episode's shopping list is drawn from its recipes. Each city has a Produce Market, a Butcher & Fish and a Grocery. Shops that stock something on your list show a green `$`.
3. **Cook in their kitchen.** A timing minigame, one round per dish, each with a cue from the book's technique (velveting, hollandaise, "don't lift the lid"). Quality decides the tip.
4. **Table served.** Covers count toward the 10,000. Finish a city's tables and the next city opens — drive there, find the new Home Kitchen and the fresh rental.
5. **Stars.** Each cooked table earns one to three stars from how the cooking went, and the Book (B) keeps your best. Press **↻ Again** on any table you've served to cook its menu again for a better score. No shopping and no pay on a replay, but a new best earns trust.

Between tables it's an open city, and you can do what you like in it:

- **People.** Every pedestrian has a name, a job and something to say — press F to talk. Some are hungry (🍴); hand them a plate. Dog walkers, couples chatting on corners, umbrellas when it rains. Hit someone with a car and they'll tell you what they think of you.
- **Cars.** Sedans, taxis, vans, buses, sports cars, scooters. Press E to take any of them — the driver gets thrown out and comes after you. Headlights and streetlights at night, brake lights, skid marks, honking when you block traffic.
- **Jobs.** Get in a taxi and pick up anyone waving (🖐) for a fare. Buy a Food Truck from the phone (T) and cook plates anywhere. Feed the 🟠 regulars for tips.
- **Heat.** Bad driving raises it, police chase you at one star and up. Drive into an Auto Body (🔧) and press F to lose the heat and fix the car.
- **The city.** Two rivers cut the map into four cities, with bridges every fifth block — drive in and Orly fishes you out. Miami Beach on Florida's east edge, the Venice boardwalk at the bottom of LA. Day, night, rain.
- **The phone (T).** Jobs, a dealership (scooter, taxi, food truck, sports car), a four-station procedural car radio, and your stats.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk, drive (W gas, S brake/reverse, A/D steer) |
| E | Get in / out of a car |
| F | Talk, hold up the sign, shop, cook, hand over a plate |
| C | Cook quick plates at a Home Kitchen or in a Food Truck |
| T | Phone — jobs, dealership, radio, stats |
| R / H | Change radio station / horn |
| V | Camera: chase, high, overhead |
| B | The Book — every table so far |
| M | City map |
| Space | Stop the marker in the cooking minigame |
| Esc / P | Pause, save, controls |

## Layout

```
index.html        page + HUD
css/style.css

js/constants.js   tile sizes, tuning
js/story.js       cities, shops, ingredients, all 68 episodes, sign lines, cooking cues
js/people.js      pedestrian names, jobs, looks and dialogue
js/world.js       procedural city grid: four quadrants, rivers and bridges, beaches, shops, garages;
                  the shared tile hash, facade styles and block heights
js/entities.js    vehicle classes (player/traffic/police AI), pedestrians and dogs, strangers
js/game.js        game state, mission flow, heat/police, save/load
js/ui.js          HUD, modals (shop, sign, cooking, journal, map)
js/input.js       keyboard + touch
js/audio.js       tiny WebAudio sound effects
js/radio.js       procedural car radio (WebAudio step sequencer, four stations)
js/save.js        localStorage
js/render3d.js    Three.js renderer: merged city geometry, instanced cars and people, lighting, rain, camera, HTML labels
js/assets3d.js    loads the Blender-built models and textures (optional; primitives stay as fallback)
js/render.js      2D canvas fallback renderer, minimap, full map
js/main.js        boot: picks the renderer, title video, main loop
js/vendor/        three.min.js r128 + GLTFLoader + post-processing (MIT)

assets/           photos of Vlad (the chef) and Orly (the host) for the title, cooking and afterword screens
                  (drop in assets/chef-kitchen.jpg to show Vlad on the cooking screen);
                  title-1.mp4 and title-2.mp4 play back-to-back, muted, behind the title screen;
                  browsers that can't decode them (they're HEVC) fall back to the photo hero
assets/ref/       character reference sheets the faces and outfits are built from
assets/3d/        models (glb), baked textures, sky environments, faces

tools/blender_assets.py   headless Blender pipeline that builds assets/3d
tools/export_world.js     writes the procedural world as JSON for other engines (unreal/Content/Data/world.json)
tools/bake_glb.py         bakes node transforms into the glb models for per-mesh importers
tools/unreal_bridge.py    runs Python inside a live Unreal Editor over remote execution
unreal/                   Unreal Engine 5 project: Content/Python/cfs_build.py rebuilds the world from the data above
.mcp.json                 Claude Code MCP config: the UEMCP server that connects to the editor

tests/            deno test: story data and world generation
footage-organizer/  sorts, dates and renames video and photos on a drive (see below)
wd-diagnose.sh    read-only Mac check for a WD drive that won't mount
```

## Footage Organizer on a Mac with the WD drive

`footage-organizer/` imports the videos and photos from cameras and drives and files them on the WD drive by year and shoot, with names like `2024-05-12_143000_Miami-Beach_V001_GoPro.mp4`. Full details are in [footage-organizer/README.md](footage-organizer/README.md).

1. Plug in the WD drive and check it shows up in Finder. If it doesn't, run `bash wd-diagnose.sh` in Terminal. It only reads, never changes the drive, and ends with what to try next. Never click Initialize or Erase if macOS offers it.
2. Optional but better dates and camera names: `brew install ffmpeg exiftool`.
3. Double-click `footage-organizer/Organize Footage.command`. The first time, macOS may block it: right-click it, choose Open, then Open again.
4. Pick the drives or cards to import from, and give the WD drive as the destination, for example `/Volumes/WD Drive/Organized` (the name is whatever the drive is called under `/Volumes`). Press Enter instead to tidy the WD drive in place.
5. Open the report it shows, check the plan, and say yes to import. Copy mode leaves the originals untouched, and `undo` reverses an import.

From Terminal the same thing is:

```
cd footage-organizer
python3 organize.py scan ~/Movies "/Volumes/GOPRO" --dest "/Volumes/WD Drive/Organized"
open "/Volumes/WD Drive/Organized/_organizer/report.html"
python3 organize.py apply "/Volumes/WD Drive/Organized/_organizer/plan.json"
```

Run the organizer's tests with `cd footage-organizer && python3 -m unittest test_organize -v` (the end-to-end ones need ffmpeg).
