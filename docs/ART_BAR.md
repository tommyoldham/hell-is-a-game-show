# Art bar: Tommy's paintover (2026-10-28)

Target: `art/source/stage-target.webp` (the guess screen, host plus two players).
Host poses: `art/source/host-sheet-20.webp`, `host-sheet-4.webp`.
Each row is true or false, judged against a screenshot of the same screen
(guess phase, host + 2 contestants, 1448-wide desktop and 375-wide phone).

| # | Criterion | Evidence | Score |
|---|-----------|----------|-------|
| 1 | The stage is the painted set: arch of bulbs, skull, banners, torches, curtain, reflective floor. No pixel art left on the stage. | host-view/art-1-guess-screen.jpg: plate from the paintover, no pixel art on stage | PASS |
| 2 | The host is the painted demon from Tommy's sheet, sitting behind the desk at the target's size and spot. | Cut from host-sheet-20, tie at x 350, desk line y 450, scale 0.94 (target demon spans horn 235 to desk 445) | PASS |
| 3 | The host changes pose with the game: bored by default, talks with the mic, laughs at wrong answers, shocked at fraud, leans in for the final. At least 8 poses used. | 19 poses wired: idle drift (coffee, sip, card, shades, ponder, scratch, glare), talk, laugh/facepalm on wrong, present/wink on right, shock on fraud, lean for the final, point on buzz, fingerguns on the puzzle, shrug at the end | PASS |
| 4 | The host's name plate is on the desk front, cream serif name, red "HOST", with the devil badge. | Painted plate with its text painted out; HTML name + HOST over it | PASS |
| 5 | Podiums are ornate dark-gold stands with horns and a trident medallion, and a screen framed in the player's colour that glows. | podium.webp cut from the paintover; frame tinted per colour with baked glow (yellow, green, blue checked) | PASS |
| 6 | Name and score sit inside the podium screen, never spilling past its frame (long names truncate). | Name/score boxes are the screen rect; overflow ellipsis. Long names not yet tried | PARTIAL |
| 7 | Contestants are smooth glossy ghosts in their colour with a soft glow, not pixel sprites. Avatar hats and faces still show. | drawGhost(): gradient, gloss, glow; all 9 hats, 7 eyes, 7 extras render | PASS |
| 8 | Podiums sit on the stage floor with a reflection, grouped right of the desk as in the target, for 1 to 9 players. | Base at y 625 with a 20% reflection; scale shrinks past 3 players. Only 2 players shot | PARTIAL |
| 9 | Torches flicker, bulbs twinkle, embers rise: the set is alive, not a still image. | Torch pixels change 9.9 / 27.3 per pixel over 0.4s vs 0.2 on still curtain; bulb chase; embers | PASS |
| 10 | Score, music and sound sit in a gold-trimmed pill at the top right of the stage. | .hud over the painted pill: pts + music + sound in game, music + sound elsewhere | PASS |
| 11 | The panel under the stage is near-black stone with a gold border, a trident crest at the top and red banners, headed in a large cream serif. | Painted crest, banners (>=900px) and title arrows cut from the paintover; stone gradient (no crack texture) | PARTIAL |
| 12 | Buttons are red with gold trim and serif labels; inputs are dark with a gold edge. | .fire red gradient + gold border; dark inputs with gold edge | PASS |
| 13 | The whole UI uses the serif type, with no pixel fonts left on any screen. | Alegreya / Alegreya SC everywhere, lining figures forced | PASS |
| 14 | The lobby, board, question, robin, puzzle, final and results screens all use the same panel and button style. | Board, question, host desk, puzzle, results checked; final gamble and round robin not shot | PARTIAL |
| 15 | At 375px wide nothing overflows sideways and the stage still reads (host, podiums, names). | 375px: no sideways scroll; host plate text overlap fixed but not re-shot | PARTIAL |

**First scoring (2026-10-28): 10 PASS, 5 PARTIAL, 0 FAIL.** Next: shoot a 6-player stage and a 16-letter name, the final gamble and robin screens, and the phone stage again.
