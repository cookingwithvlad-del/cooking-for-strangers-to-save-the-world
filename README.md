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

Between tables it's a GTA city: get in any car with E, pedestrians and traffic, heat that rises when you drive like an idiot, police that chase you when it does, and hungry strangers (🟠) who'll tip for a quick plate — hummus and pita, onigiri, tacos — cooked at your Home Kitchen with C.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Walk, drive (W gas, S brake/reverse, A/D steer) |
| E | Get in / out of a car |
| F | Talk, hold up the sign, shop, cook, hand over a plate |
| C | Cook quick plates at a Home Kitchen |
| B | The Book — every table so far |
| M | City map |
| Space | Stop the marker in the cooking minigame |
| Esc / P | Pause, save, controls |

## Layout

```
index.html        page + HUD
assets/           photos of Vlad (the chef) and Orly (the host) — title, cooking and afterword screens
                  (drop in assets/chef-kitchen.jpg to show Vlad on the cooking screen)
css/style.css
js/constants.js   tile sizes, tuning
js/story.js       cities, shops, ingredients, all 68 episodes, sign lines, cooking cues
js/world.js       procedural city grid (four quadrants, one per city)
js/entities.js    vehicles (player/traffic/police AI), pedestrians, strangers
js/render.js      canvas renderer, minimap, full map
js/ui.js          HUD, modals (shop, sign, cooking, journal, map)
js/game.js        game state, mission flow, heat/police, save/load
js/input.js       keyboard + touch
js/audio.js       tiny WebAudio sound effects
js/save.js        localStorage
```
