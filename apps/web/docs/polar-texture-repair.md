# Polar texture repair

Historical asset (no longer present or selected): `public/textures/earth-land-polar-restored.png`, generated with the built-in imagegen tool. The user has removed the earlier textures. The active asset is now `8k_earth_daymap-Photoroom.png`; the notes below record the earlier repair only.

The first extraction removed the source's Arctic ice band and introduced transparent gaps along Antarctica's bottom border. On a sphere those texture edges converge at the poles. The repaired texture extends Arctic ice to the top edge and Antarctica to the bottom edge, preserving transparent oceans for the fluid orb. These are illustrative ice regions, not current measured sea-ice boundaries. The generated image can alter coastline detail and is not suitable for geographic boundary analysis.

No backend request, coordinate storage, event location, or picking behavior changes. This is a local visual asset replacement.

Validation: the selected PNG is 1673 × 940 with RGBA transparency. Every pixel along its top and bottom rows has visible ice (alpha ranges 252–254 and 249–253 out of 255 respectively), with fully transparent ocean pixels between continents. Both poles were inspected by rotating the localhost globe: continuous ice coverage is visible without a transparent central hole. The underlying orb remains visible over oceans.

## Built-in imagegen prompts

### Restoration

Use case: compositing. Asset type: flat globe texture PNG with real transparent water. Image 1 is the original illustrated world map, authoritative reference for polar ice. Image 2 is the current transparent-water edit target. Repair ONLY the missing polar regions of image 2 using image 1: restore the full white/light-gray Arctic sea-ice band across the ENTIRE TOP EDGE, extending opaque ice to every pixel of the top border with the irregular southern edge shown in image 1. Restore Antarctica across the ENTIRE BOTTOM EDGE, extending fully opaque white/light-gray ice to every pixel of the bottom border, preserving its irregular northern coastline and peninsula from image 1. These edge-to-edge opaque bands must wrap and close over a sphere's north and south poles: no transparent margin, holes or gaps at the top or bottom border. Keep the existing continents at their exact normalized positions, same scale and flat green/tan illustrated style, Greenland and islands intact. Keep ocean water between land and ice fully alpha-transparent. Match original full rectangular framing and approximately 1.78:1 aspect ratio, no cropping or padding. Do not turn Antarctica into a floating island or remove gray/white ice as background. No labels, outlines, shadows, checkerboard pixels or background fill. Output transparent PNG.

### Arctic edge refinement (selected output)

Use case: precise-object-edit. Edit this transparent globe texture. The Antarctic bottom band is correct; keep it and every continent and ocean exactly unchanged. Fix ONLY the Arctic band: the first/top row of the image MUST be 100 percent opaque solid pale gray ice across the entire image width, continuing as solid pale gray ice down through the upper 6 percent of image height. Fill every black-looking transparent notch and hole in that top ice region. Use opaque pale bluish gray RGB (210,220,225), not transparent white. Keep its irregular bottom coastline, approximately the upper 10 percent of the image, joining Greenland as before. Do not draw disconnected ice floes; this is ONE CONTINUOUS SOLID POLAR ICE CAP touching the entire top border, with no gaps, no margin. Preserve all transparent oceans below that cap. Export PNG with actual alpha only in oceans. Preserve dimensions and exact framing, no crop or extra border.
