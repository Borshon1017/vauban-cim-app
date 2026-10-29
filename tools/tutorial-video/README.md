# Tutorial video (45 s)

`npm run video` from the project folder records the real app and builds `out/vauban-tutorial.mp4` (1280x720, 45 s).

Scenes: the live map, tapping a circle, Safety / Crowd / Obstacles, obstacles at street level, call-outs on the real
traffic lights, crossings, lamps, benches and trees, the 3D view, the "Ask the map" chat, reporting a place, the legend.

What it does: starts a FAKE backend (no real reports are created; the circles, obstacles and the chat answer are scripted
demo data), starts the app, opens it in a "stage" page (phone in the middle, big captions on the sides, a fake mouse cursor,
camera zooms), plays a scripted tour, records the screen with Chrome's screencast and encodes it with ffmpeg.

Needs: Google Chrome, ffmpeg (`brew install ffmpeg`), internet (the background map is loaded live).

Change the TEXTS (easy): open `captions.json`, edit the words between the quotes, save, run `npm run video`. Everything you can read in the video is in that file: the 9 headlines and sentences, the labels on the map, the end card and the demo chat answer.
Change the story (the clicks): the section "THE SCRIPT" in `record.mjs`.
Change the length: `VIDEO_SPEED=1.2 npm run video` (higher = faster video; default 1.3 gives about 45 s).
The scripted chat answer and the demo circles are at the top of `record.mjs` (`CHAT`, `SAFETY`, `CROWD`, `OBSTACLES`).
The script clicks the real buttons by their ids, so if the app changes (a button is renamed or moved) a selector may need an update.
