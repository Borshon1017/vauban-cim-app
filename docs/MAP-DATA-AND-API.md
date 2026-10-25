# Vauban map: data pipeline and backend API (for the whole team)

## 1. Where the map data comes from
The QGIS shapefiles live in `Vauban_Webdata/`, a folder next to the repo, not inside it (283 MB, too big for GitHub). Use `VAUBAN_DATA=/path/to/Vauban_Webdata` if yours is elsewhere.
`npm run data` reads them and writes small web files to `public/data/` (about 0.6 MB compressed in total).
Run it again whenever someone changes a shapefile, then rebuild the site.

| Output file | Source shapefile | What the pipeline does |
|---|---|---|
| `buildings.geojson` | `Building vauban with heights` (BD TOPO) | `h` = `hauteur`; if missing: floors x 3 m (5 buildings) or 6 m (59 buildings); minimum 2.5 m |
| `trees.geojson` | `Tress in Vauban` | `z` = `z_max` (highest point of the canopy); crowns simplified to 35 cm |
| `lamps.geojson` | `Streetlamps_Vauban` | `h` = `Hauteurs` |
| `signals.geojson` | `Traffic signals_Vauban` | `h` = `Hauteurs_m` |
| `benches.geojson` | `Vauban_Benches` | `h` = `Hauteur_m` |
| `crossings.geojson` | `crossings in vauban` + `Roads Vauban___` | one line per crossing, perpendicular to the nearest road, length from road class; `unmarked` crossings skipped |
| `parking.geojson` | `Disabled Parking_Vauban` | places + address |
| `bus.geojson` | `crossroad_bus` | whole metropole filtered to the Vauban boundary |

Everything is converted to WGS84 and clipped to the Vauban-Esquermes boundary (`src/vauban.js`).
Not used: `Vauban Terrain_MNT.tif` (228 MB, Lille is nearly flat), `Crossings in lille` (city-wide copy), `Disabled Parking` (copy without a coordinate system), `Vauban Buildings.shp` (no .dbf), the OSM building file (BD TOPO has heights). There is no `Green areas` shapefile in the folder (only an empty .cpg), so parks and water come from the OpenFreeMap background.

## 2. Design rules (src/layers.js)
- Flat 2D by default. The 3D view is a switch in Settings, and every layer has its own switch there.
- Buildings: extruded by `h`. Trees: crown from 40 % to 100 % of `z` on a thin trunk.
- Street lamps: slender pole (24 cm) with a round head on top, height `h`. Traffic lights: pole plus a dark box. Benches: small boxes.
- Crossings: one clean line, only visible from zoom 17 (street level).
- Sizes are in `TUNING` at the top of `src/layers.js`.
- Colours follow the light or dark map automatically.

## 3. Backend (Supabase), used by the map and by the phone app
Base URL and public key are in `.env` (never the secret key). Both calls need the public key as `apikey` header.

| What | Call | Notes |
|---|---|---|
| Live circles on the map | `POST /rest/v1/rpc/get_hotspots` body `{"p_topic":"safety"}` (or `"crowd"`) | GeoJSON, 50 m squares, only squares with 3 different people. The app refreshes every 30 s and when the tab comes back. |
| Send a report | `POST /rest/v1/rpc/submit_feedback` with an anonymous user token | Validated and scored on the server (see `supabase/01_schema.sql`) |
| Read raw reports | Supabase dashboard, schema `private`, table `feedback` | Not reachable with the public key |

To link a data object (a lamp, a crossing) with complaints later, the reports table needs a `feature_ref` column holding the object id (OSM id for lamps, crossings, signals and benches). That is a small change once the team decides what "compliance tracking" should record.
