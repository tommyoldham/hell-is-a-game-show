# Hell Is a Game Show

An online pixel-art trivia show modelled on RedLetterMedia's "Jack Of All Trivia":
one friend hosts, writes the questions and rules on every answer, and everyone
else buzzes in from their own phone or computer over voice chat. The host is the
bored demon on screen; the contestants are the souls on the podiums.

(The first prototype was a Millionaire-style quiz built from the friend's survey
answers. After he pointed at the RLM video, it was rebuilt around that format.)

## Play online

**https://tommyoldham.github.io/hell-is-a-game-show/**

Open the link, click **Open a new show**, then **Copy invite link** and send it to
your friends. They tap it, type a name and join. Keep your tab open during the game:
your browser runs the room. If you refresh, use **Reopen your show**.

To update the site: edit `src/`, run `node build.js` (it writes `docs/index.html`,
which is the website), then commit and push. GitHub Pages republishes in about a
minute at the same address; anyone with it open needs to refresh.

## Playing

`dist/HellIsAGameShow.html` is the whole game in one file. Everyone opens it in a
browser: from a shared link, or as a local file sent over chat. One person opens a
show and shares the 4-letter code; everyone else joins with it.

- **Host:** the room owner picks one player to host. The host writes a board in the
  lobby (or uses the starter board), and can save or open it as a `.json` file.
  Boards autosave in the host's browser.
- **Question library:** 50 ready-made categories of 5 questions each (movies, games,
  music, science, Straya, spooky stuff and more), plus 12 round robins and 9 finals.
  The host can hit 🎲 Random board, add any library category, or write their own.
- **Fresh questions:** ⚡ Fresh board fills 6 categories (about half a minute) and ⚡ +
  Fresh category adds one, from the free Open Trivia Database (CC BY-SA 4.0). It
  prefers easy questions, drops long or multi-part answers, and never repeats one:
  a database session token plus a list of seen questions in the host's browser.
  🔄 next to any fresh question swaps it for a new one. ⚡ Fresh finals fills the
  final gamble too.
- **Avatars:** everyone builds their soul on the join screen or in the lobby:
  colour, hat, eyes and an extra (moustache, fangs, bow tie...). It's saved in their
  browser.
- **Specialties:** in the lobby, each contestant picks one library category they'll
  crush. With the setting on (the default), those categories go on the board first,
  labelled "⭐ Jay's pick", and the host's categories fill the rest (8 at most).
  Anyone can still buzz in on someone else's specialty.
- **Who goes first:** the game picks a secret number from 1 to 100, and the closest
  guess gets control of the board.
- **The board:** categories with questions worth 1 to 5 points. Whoever has control
  picks. The host reads the question out loud; contestants only see the question
  if "show questions on contestants' screens" is ticked in the lobby.
- **Buzzers:** the first buzz locks everyone else out, and later buzzes show how far
  behind they were. The host taps ✔, ½ or ✖. A wrong answer costs the points, locks
  that player out and reopens the buzzers. A correct answer gains the points and
  control of the board; a half-right one gains half the points and control.
- **Fraud statements:** a question can be marked as fraud. It's a statement with a
  lie in it, worth double, and it's revealed as fraud only once someone picks it.
- **Round robins:** "name as many X as you can". Players take turns from whoever picked
  it, and the host taps ✔ (next player) or ✖ (out). With 3+ players the winner gets 5
  and second place gets 2.
- **Final gamble:** last place picks one of up to 3 final categories. Everyone bets
  in secret (up to their score, or 5 if that's more), then types an answer. The host
  reveals the answers leader-first and rules on each one (½ wins half the bet).
- **Show polish:** name plates with live scores under each podium, "+3"/"−2" pop-ups,
  big announcement cards (FRAUD!, BUZZED IN, CORRECT!, ROUND ROBIN, FINAL GAMBLE),
  board tiles dealt in, confetti at the end, and a background music loop in the
  lobby and on the board (🎵 turns it off).
- **Host tools:** +/− on any score (to fix rulings), hand control to any player,
  reset buzzers, skip to the final, speech-bubble lines, and a soundboard.

## Dev

```
node build.js             # src/ + Kenney sounds -> dist/HellIsAGameShow.html
node tests/logic.test.js  # rules engine tests
node tools/serve.js 8777  # serve dist/ for local testing (one tab per player)
```

- `src/questions.js`: the library (50 categories, 12 round robins, 9 finals); the starter board is its first 5.
- `src/logic.js`: the pure rules engine. `viewFor()` hides answers, wagers and final
  answers per player.
- `src/trivia.js`: the Open Trivia Database client (rate-limit queue, token, seen list, spare pool).
- `src/art.js`: the procedural pixel studio, demon and souls (plus unused flag/chiptune
  helpers from the first prototype).
- `src/app.js`: UI, the board editor and networking. The room owner's browser is
  authoritative over PeerJS. The host's board lives in the host's browser and is
  sent to the room owner.
- Sounds are CC0 from the Kenney audio packs in `D:\Claude\KenneyAssets\Audio`.
