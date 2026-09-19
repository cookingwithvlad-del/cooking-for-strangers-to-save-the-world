# Cooking for Strangers to Save the World — The Game

A top-down, open-world driving game built from the cookbook *Cooking for Strangers to Save the World* by Vlad Briantsev & Orly Israel. Two cooks, a knife roll, a cardboard sign and a rental car, working their way through 68 tables in four cities — Manhattan, Miami, Chicago and Los Angeles — toward ten thousand strangers fed.

No build step, no dependencies. Plain HTML5 canvas + JavaScript.

## Play

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

Works on desktop (keyboard) and phones (on-screen controls). Progress auto-saves to the browser.

## How it plays

Every table in the book is a mission, in the book's order:

1. **Find the stranger.** They're marked on the minimap. Walk up, press F, and Orly holds up the sign. Pick the line that would actually get a yes — no catch, no camera, no money. Wrong line, they walk; try again in a few seconds.
2. **Shop the menu.** The episode's shopping list is drawn from its recipes. Each city has a Produce Market, a Butcher & Fish and a Grocery. Shops that stock something on your list show a green `$`.
3. **Cook in their kitchen.** A timing minigame, one round per dish, each with a cue from the book's technique (velveting, hollandaise, "don't lift the lid"). Quality decides the tip.
4. **Table served.** Covers count toward the 10,000. Finish a city's tables and the next city opens — drive there, find the new Home Kitchen and the fresh rental.

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
| B | The Book — every table so far |
| M | City map |
| Space | Stop the marker in the cooking minigame |
| Esc / P | Pause, save, controls |

## Layout

```
index.html        page + HUD
assets/           photos of Vlad (the chef) and Orly (the host) — title, cooking and afterword screens
                  (drop in assets/chef-kitchen.jpg to show Vlad on the cooking screen)
                  title-1.mp4 and title-2.mp4 play back-to-back, muted, behind the title screen;
                  browsers that can't decode them (they're HEVC) fall back to the photo hero
css/style.css
js/constants.js   tile sizes, tuning
js/story.js       cities, shops, ingredients, all 68 episodes, sign lines, cooking cues
js/people.js      pedestrian names, jobs, looks and dialogue
js/radio.js       procedural car radio (WebAudio step sequencer, four stations)
js/world.js       procedural city grid: four quadrants, rivers and bridges, beaches, shops, garages
js/entities.js    vehicle classes (player/traffic/police AI), pedestrians and dogs, strangers
js/render.js      canvas renderer, minimap, full map
js/ui.js          HUD, modals (shop, sign, cooking, journal, map)
js/game.js        game state, mission flow, heat/police, save/load
js/input.js       keyboard + touch
js/audio.js       tiny WebAudio sound effects
js/save.js        localStorage
```
