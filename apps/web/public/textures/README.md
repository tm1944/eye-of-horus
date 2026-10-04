# Earth textures

## Elevation heightmap (active)

`earth-topology.png` is a 2048 × 1024 8-bit grayscale equirectangular heightmap (dark = low, light = high). `continent-material.ts` samples it per vertex to shade country caps as low-poly relief facets; it is never drawn as an image.

Copied unchanged from the `three-globe` npm package (v2.45.3, `example/img/earth-topology.png`; MIT license, see `THREE-GLOBE-LICENSE.txt`). SHA-256: `839b12da2e4dd346b256cebae72e10c479a102c8980a22084c41275e4b9a0e12`. The package does not state the image's original source; it is commonly attributed to NASA elevation data but this has not been verified.

## Retained texture (inactive)

`8k_earth_daymap-Photoroom.png` is the user-provided day-map PNG with oceans already removed. Its actual resolution is **2400 × 1200**, not 8192 × 4096, despite the filename. The 2:1 texture is retained unchanged, but the active globe now uses vector country geometry. Some gaps in polar ice are present in the supplied cutout.

See `apps/web/docs/vector-globe.md` for the active land and border data. The day-map PNG is not loaded by the globe.

The original source and license of this user-supplied image were not provided. Previous texture files were removed by the user. `THREE-GLOBE-LICENSE.txt` is retained from the former example texture; it does not establish a license for this PNG.
