# Elf on the Shelf: Hollow Hill 🎃

A spooky third-person Halloween game for the Mac, with game-controller support.

The Elf crawled off his shelf on Halloween night. **He only moves when nobody is watching.**
Find the 8 cursed candy corns across the hills and upstairs in the three old houses, then bring them
to the witch's cauldron to banish him.

## Play
Double-click **`Play Game.command`**. It starts a small local server and opens the game in Chrome
(or your default browser). On first run macOS may ask you to allow it: right-click the file → Open.

Or run it by hand: `python3 -m http.server 8642` and open http://127.0.0.1:8642

## Controls
| | Controller | Keyboard / mouse |
|---|---|---|
| Move | Left stick / D-pad | WASD |
| Look | Right stick | Mouse (click to lock) |
| Flashlight | RT / RB / X | F / click |
| Sprint | LT / B / L3 | Shift |
| Start / use cauldron | A | Enter / E |
| Pause | Start | P / Esc |

Xbox, PlayStation and Switch Pro controllers all work over Bluetooth or USB. Press a button once so the browser detects it.
Rumble works in Chrome.

## Monsters
- **The Elf** freezes whenever you can see him, and he can only catch you while you're not watching. He follows your trail into houses and up the stairs.
- **Ghosts** drift through walls toward you. Shine your flashlight on one and it shrieks and vanishes.
- **Skeletons** climb out of their graves when you walk past. Light only slows them down, so outrun them.
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
