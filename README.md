# Elf on the Shelf: Hollow Hill 🎃

A spooky third-person Halloween game for the Mac, with game-controller support.

The Elf crawled off his shelf on Halloween night. **He only moves when nobody is watching.**
Find the 8 cursed candy corns across the hills and upstairs in the three old houses, then bring them
to the witch's cauldron to banish him.

## Play
**▶ Play in your browser: https://drdannyx.github.io/halloween-elf-game/**

It works on Mac, Windows and Linux in Chrome, Edge, Firefox or Safari, with nothing to install. Plug in or pair a controller and press any button on it.

### Play offline
Pick the launcher for your computer. Each one starts a small local web server and opens the game in your browser.

| Platform | Launcher | Needs |
|---|---|---|
| **Mac** | Double-click **`Play Game (Mac).command`**. The first time, right-click → Open. | Nothing extra; macOS has Python |
| **Windows** | Double-click **`Play Game (Windows).bat`** | Nothing extra; it uses built-in PowerShell and opens Microsoft Edge |
| **Linux** | Run **`./Play Game (Linux).sh`**, or double-click it if your file manager allows | `python3` (preinstalled on most distros) |

Chrome or Edge gives the best experience, including controller rumble. Firefox and Safari also work.
You can't open `index.html` directly, because browsers block the way it loads its code from local files.

## Controls
| | Controller | Keyboard / mouse |
|---|---|---|
| Move | Left stick / D-pad | WASD |
| Look | Right stick | Mouse (click to lock) |
| Flashlight on/off | RT / RB | F / right-click |
| Swing flashlight | X | Click / Q |
| Sprint | LT / B / L3 | Shift |
| Start / use cauldron | A | Enter / E |
| Pause | Start | P / Esc |

Xbox, PlayStation and Switch Pro controllers all work over Bluetooth or USB. Press a button once so the browser detects it.
Rumble works in Chrome.

## Monsters
- **The Elf** lurks somewhere on the map. Wander into his area and he wakes up and hunts you, following your trail into houses and up the stairs. He freezes whenever you can see him, and can only catch you while you're not watching. Scare him off with your light and he slinks away to a new hiding place. Once you have all the candy, he never stops coming.
- **Ghosts** drift through walls toward you. Shine your flashlight on one and it shrieks and vanishes.
- **Skeletons** climb out of their graves when you walk past. Light only slows them down, but three swings of your flashlight smash them to pieces.
- **Giant spiders** hang from the ceiling upstairs in every house and drop when you walk underneath. Light drives them back.

Ghosts, skeletons and spiders drain your **courage**. Courage comes back slowly when you're left alone,
and quickly inside the cauldron's glow. If it runs out, you're scared to death.

## Tips
- Elf in your way? Hold your flashlight beam on him up close for a moment and he'll scurry off into the dark. It costs a little battery.
- Keep him in your flashlight beam or the glow of a jack-o'-lantern and he can't move.
- Listen for **sleigh bells**. That's him moving. They pan left and right with his position.
- Your flashlight flickers when he's close, and he moves during the flickers.
- The green circle around the cauldron is safe. He can't enter it, and it recharges your flashlight.
- Grab green batteries to recharge your flashlight.
- He gets faster with every candy you collect, and so do the others.
- Each house has batteries downstairs and a candy upstairs.

## Tech
Three.js (WebGL, rendered through Metal on macOS), with procedural textures and Web Audio sound. No asset files.
`vendor/three.module.js` is bundled, so the game runs offline. Everything else is in `game.js`.
