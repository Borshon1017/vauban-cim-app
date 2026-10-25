# How the map data gets into the app (a guide for beginners)

This guide explains `tools/build-data.mjs`, the script that turns your teammate's QGIS files into the small files the website draws.
You do not need QGIS, and you do not need AI, to run it or to change it.

---

## 0. The 30-second version

```
../Vauban_Webdata/   (QGIS shapefiles, 283 MB, next to the repo)
        │   npm run data      ← runs tools/build-data.mjs
        ▼
public/data/      (8 small .geojson files, about 3.3 MB, about 0.55 MB once the server compresses them)
        │   the website downloads them
        ▼
src/layers.js     (MapLibre draws them: flat in 2D, raised in 3D)
```

The script does five jobs: **read** the binary files, **convert** the coordinates, **keep only Vauban**, **keep only the useful columns** (and fill gaps), and **write** plain-text GeoJSON.

---

## 1. Run it yourself, from zero

1. **Install Node.js** (version 20 or newer) from nodejs.org. Check it with `node -v` in a terminal.
2. **Open a terminal in the project folder:** `cd /Users/alfred/YES/vauban-cim-app`
3. **Install the two libraries the script needs** (only once): `npm install`
   The libraries are listed in `package.json`: `shapefile` (reads QGIS files) and `proj4` (converts coordinates).
4. **Check the QGIS files are in the folder `Vauban_Webdata/` next to the project folder** (the `.shp`, `.dbf` and `.prj` files together). It is kept outside the repo because it is too big for GitHub. If it is somewhere else, run `VAUBAN_DATA=/path/to/Vauban_Webdata npm run data`.
5. **Run the script:** `npm run data`
   `npm run data` is a shortcut defined in `package.json`; it runs `node tools/build-data.mjs`.
   It prints one line per layer, for example `buildings  4164 features  1116 KB`.
6. **Look at the result** in `public/data/`: eight `.geojson` files. They are plain text; you can open them in any text editor.
7. **See it on the map:** `npm run dev`, then open the address it prints.

To look at a result file on a map without any software, go to **geojson.io** and drag the file onto the page.

---

## 2. Three ideas you need first

### 2.1 What a shapefile is
A shapefile is a **bundle of files with the same name**:

| File | Contains | Readable as text? |
|---|---|---|
| `.shp` | the shapes (corner points of each building, position of each lamp) | no, binary |
| `.dbf` | the table of attributes (height, name, type), one row per shape | no, binary |
| `.shx` | an index, to jump to a shape quickly | no, binary |
| `.prj` | the coordinate system the numbers use | yes, plain text |
| `.cpg` | the text encoding (so accents read correctly) | yes, plain text |

A program has to decode the binary files. The `shapefile` library does that.

### 2.2 Coordinate systems
The same place can be written with different numbers depending on the **coordinate system**:

| System | Looks like | Used by (in your folder) |
|---|---|---|
| **Lambert-93** (French national system, in metres) | `702135, 7058428` | buildings, trees, disabled parking |
| **UTM zone 31N** (in metres) | `502059, 5607663` | roads |
| **WGS84** (latitude and longitude, what GPS and web maps use) | `3.0301, 50.6228` | lamps, benches, traffic lights, crossings |

A web map needs WGS84. The `.prj` file names the system of each shapefile. `proj4` converts between them with the standard map-projection formulas.
Note: in GeoJSON the order is **[longitude, latitude]**, so x comes first.

### 2.3 GeoJSON
GeoJSON is a plain-text format for map data. One building looks like this:

```json
{ "type": "Feature",
  "geometry": { "type": "Polygon", "coordinates": [[[3.0301, 50.6228], [3.0302, 50.6228], [3.0302, 50.6229], [3.0301, 50.6228]]] },
  "properties": { "h": 12.5, "hs": "bd", "u": "Résidentiel" } }
```

`geometry` is the shape. `properties` is the information attached to it. A `FeatureCollection` is a list of features. Every layer file is one `FeatureCollection`.

---

## 3. The script, part by part

### 3.1 Imports and folders (lines 5 to 15)
```js
import * as shapefile from 'shapefile';   // reads .shp + .dbf
import proj4 from 'proj4';                // converts coordinates
import fs from 'node:fs';                 // reads and writes files
import { inVauban } from '../src/vauban.js';   // "is this point inside the district?"
```
`SRC` is the folder with the QGIS files, `OUT` is `public/data/`. `fs.mkdirSync(OUT, { recursive: true })` creates the output folder if it does not exist.

### 3.2 Teaching `proj4` the two French systems (lines 17 and 18)
```js
proj4.defs('L93',   '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs');
proj4.defs('UTM31', '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs');
```
These are the official definitions (also known as EPSG:2154 and EPSG:32631). They are the numbers that appear in the `.prj` files, written in the short `proj4` format. WGS84 is built in.

### 3.3 `read(name)`: open a shapefile (line 21)
```js
async function read(name) {
  const s = await shapefile.open(SRC + name + '.shp', SRC + name + '.dbf', { encoding: 'utf-8' });
  const out = [];
  for (;;) { const r = await s.read(); if (r.done) break; out.push(r.value); }
  return out;
}
```
It opens the `.shp` and `.dbf` together and reads one feature at a time until there are none left. `r.value` is a GeoJSON feature: `{ geometry, properties }`. It returns the whole list.

### 3.4 Small helpers (lines 27 to 34)
- `R6(v)` rounds to 6 decimals (about 10 cm). `R1(v)` rounds to 1 decimal.
- `mapCoords(c, fn)` applies a function to **every coordinate pair** inside a shape, however deeply nested (a polygon is a list of rings, a ring is a list of pairs).
- `toWgs('L93')` returns a function that converts one pair from Lambert-93 to latitude and longitude, using `proj4`.
- `centroid(g)` is the average of the corner points of a shape's outer ring: a quick "middle point".
- `feature(...)` and `fc(...)` build the GeoJSON wrappers.

### 3.5 `inVauban(lng, lat)`: clipping (in `src/vauban.js`)
```js
export function inVauban(lng, lat) {
  let inside = false;
  for (let i = 0, j = VAUBAN_RING.length - 1; i < VAUBAN_RING.length; j = i++) {
    const [xi, yi] = VAUBAN_RING[i], [xj, yj] = VAUBAN_RING[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
```
This is the **ray-casting test**: draw a line from the point towards the east and count how many edges of the boundary it crosses. **Odd = inside, even = outside.** `VAUBAN_RING` is the list of corner points of the official Vauban-Esquermes boundary (from OpenStreetMap).

### 3.6 `simplifyRing`: remove useless corners (lines 38 to 62)
This is the **Douglas-Peucker algorithm**. Idea: keep the first and last point of a line; find the point that is farthest from the straight line between them; if it is farther than the tolerance (35 cm for trees), keep it and repeat on both halves; if not, throw away everything in between.
Because a ring starts and ends on the same point, the code first splits it at the point farthest from the start.
`KX = cos(latitude)` corrects for the fact that a degree of longitude is shorter than a degree of latitude at Lille's latitude.

### 3.7 `write(name, data)` (line 63)
Saves the data as `public/data/<name>.geojson` with `JSON.stringify` and prints the number of features and the size.

### 3.8 Buildings (lines 73 to 84)
```js
const src = await read('Building vauban with heights');
for (const f of src) {
  const g = mapCoords(f.geometry.coordinates, toWgs('L93'));          // 1. convert coordinates
  const geom = { type: f.geometry.type, coordinates: g };
  const [cx, cy] = centroid(geom); if (!inVauban(cx, cy)) continue;    // 2. keep only Vauban
  let h = p.hauteur;                                                   // 3. height
  if (h == null || !(h > 0)) { if (p.nombre_d_e > 0) h = p.nombre_d_e * 3; else h = 6; }   //    gaps: floors x 3 m, else 6 m
  h = Math.max(2.5, R1(h));                                            //    minimum 2.5 m
  out.push(feature(simplifyPolygonGeom(geom, 0.15) || geom, { h, hs, u: p.usage_1 || null }));   // 4. keep 3 columns, simplify
}
```
Of about 30 columns, the output keeps three: `h` (height in metres), `hs` (where the height came from: `bd` = data, `floors` = estimated, `default` = guessed) and `u` (usage).

### 3.9 Trees (lines 87 to 96)
Same steps. The height column is `z_max` (the highest point of the canopy). The script also saves the middle of each crown (`cx`, `cy`); the website uses it to place the trunk.

### 3.10 Point layers (lines 99 to 116)
One function, `points(...)`, serves lamps, traffic lights, benches and disabled parking: read, convert (only if the file is not already in latitude and longitude), keep if inside Vauban, keep one or two columns.
The bus file covers the whole metropole (7,814 stops) and already has `longitude` and `latitude` columns, so it is handled separately and ends up with 94 stops.

### 3.11 Crossings as clean lines (lines 119 to 152)
The data only has a **point** for each crossing. To draw a clean line across the road:
1. **Work in metres.** `toM` converts latitude and longitude into metres around a reference point (1 degree of latitude is about 110,574 m; 1 degree of longitude is about 111,320 m times cos(latitude)).
2. **Turn every road into short straight segments** `a → b`, and give each road a width by type (`WIDTH`: primary 11 m, residential 6.5 m, footway 3 m, and so on).
3. **For each crossing, find the nearest road segment** (`nearest`). This projects the point onto each segment: `t` is how far along the segment the closest spot is (clamped between 0 and 1) and `d` is the distance.
4. **Skip the crossing if the nearest road is more than 12 m away** (it is not on a street), or if it is `unmarked`.
5. **Turn the road direction by 90 degrees** to get the crossing direction: if the road direction is `(vx, vy)`, the perpendicular is `(-vy, vx)`, divided by its length so it has length 1.
6. **Draw a line** from `point - perpendicular x half-width` to `point + perpendicular x half-width`, where half-width is half the road width (between 2 m and 8 m). Convert back to latitude and longitude with `toLL`.
7. **Keep the crossing type** (`s` with traffic lights, `u` without, `m` marked). The website colours the line by it.

---

## 4. How to change things
| I want to… | Change |
|---|---|
| Keep another column (for example the building usage detail) | the `{ h, hs, u: … }` object in the buildings block |
| Be more or less aggressive with tree simplification | the `0.35` in `simplifyPolygonGeom(geom, 0.35)` |
| Change the guess for buildings without a height | the `6` and the `3` in the buildings block |
| Use another district boundary | `VAUBAN_RING` in `src/vauban.js` (and `supabase/02_study_area.sql`) |
| Add a new layer | copy one `points('…', '…', 'WGS84', …)` line, then add a layer in `src/layers.js` |
| Change crossing line lengths | the `WIDTH` table |

After any change: `npm run data`, then reload the site.

---

## 5. Where it ends up on the map
`src/layers.js` downloads each file with `fetch('/data/<name>.geojson')` and adds it to the MapLibre map as a layer.
- **2D:** buildings and trees are `fill` layers (flat coloured shapes), crossings are `line` layers, objects are `symbol` layers with a picture.
- **3D (Settings switch):** buildings and trees become `fill-extrusion` layers: every shape is pushed up by its height (`h` for buildings, `z` for trees). Lamps, traffic lights, benches and tree trunks are made in the browser: a small circle of points around each position, pushed up to the right height.
- Sizes of those small shapes are in `TUNING` at the top of `src/layers.js`.

---

## 6. If something goes wrong
| Message or problem | Likely cause |
|---|---|
| `Cannot find module 'shapefile'` | run `npm install` first |
| `ENOENT … .shp` | a shapefile is missing or renamed in `../Vauban_Webdata/` (the name in the script must match the file name) |
| Everything lands in the sea or in Africa | wrong coordinate system for that file: check its `.prj` and the `'L93'` / `'UTM31'` / `'WGS84'` word used for it in the script |
| A layer has 0 features | all objects fell outside the boundary, or a column name changed |
| Layer shows on the map but nothing happens in 3D | check the height column name for that layer |

---

## 7. Doing the same by hand, without code
QGIS (free, qgis.org) can do the equivalent manually: **Layer → Export → Save Features As… → GeoJSON**, choosing the coordinate system **EPSG:4326 (WGS84)**. It would not do the clipping to the exact boundary, the column trimming, the gap filling or the crossing lines automatically, which is why the script exists.

## 8. Credits
- Shapefiles: your teammate's QGIS work (data from IGN BD TOPO, OpenStreetMap and MEL; the origin of the tree layer should be confirmed with them).
- Libraries: `shapefile` (Mike Bostock), `proj4` (proj4js).
