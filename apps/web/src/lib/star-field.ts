import { BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial } from "three";
import catalog from "@/data/bright-stars.json";
import { bvColor, gmstDegrees, magnitudeWeight, skyDirection } from "@/lib/sky-math";

export type StarFieldOptions = {
  brightness: number; // peak opacity of the brightest star
  magnitudeCutoff: number; // dimmest visual magnitude drawn
  minSizePx: number; // CSS pixels at the cutoff…
  maxSizePx: number; // …and for the brightest stars
  saturation: number; // 0 = white stars, 1 = full B−V tint
};

// Stars are directions, not points: only the camera's rotation applies, and depth is pinned to
// the far plane so they sit behind everything without widening the globe's tight clip range.
// The ocean sphere still writes depth, so the Earth hides the stars behind it.
const VERTEX = `
  attribute vec3 starColor;
  attribute float weight;
  uniform float minSize;
  uniform float maxSize;
  uniform float pixelRatio;
  varying vec3 vColor;
  varying float vWeight;
  void main() {
    vec3 direction = mat3(viewMatrix) * mat3(modelMatrix) * position;
    gl_Position = projectionMatrix * vec4(direction, 1.0);
    gl_Position.z = gl_Position.w * 0.99999;
    gl_PointSize = mix(minSize, maxSize, weight * weight) * pixelRatio;
    vColor = starColor;
    vWeight = weight;
  }`;
const FRAGMENT = `
  uniform float brightness;
  varying vec3 vColor;
  varying float vWeight;
  void main() {
    float falloff = 1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vColor, brightness * mix(0.35, 1.0, vWeight) * falloff);
  }`;

/** The Yale Bright Star Catalogue in three-globe's frame, rotated to the real sky for `date`. */
export function createStarField(options: StarFieldOptions, pixelRatio: number) {
  const { stars } = catalog as { stars: number[] };
  const positions: number[] = [], colors: number[] = [], weights: number[] = [];
  for (let i = 0; i < stars.length; i += 4) {
    const [ra, dec, vmag, bv] = stars.slice(i, i + 4);
    if (vmag > options.magnitudeCutoff) break; // brightest first
    // At GMST 0 a star sits above longitude = RA; the object's y rotation applies −GMST.
    positions.push(...skyDirection(dec, ra));
    colors.push(...bvColor(bv, options.saturation));
    weights.push(magnitudeWeight(vmag, options.magnitudeCutoff));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("starColor", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute("weight", new BufferAttribute(new Float32Array(weights), 1));
  const material = new ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: NormalBlending,
    uniforms: { brightness: { value: options.brightness }, minSize: { value: options.minSizePx }, maxSize: { value: options.maxSizePx }, pixelRatio: { value: pixelRatio } },
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false; // positions are unit directions, not where the stars are drawn
  points.raycast = () => {}; // never intercept globe clicks or hover
  points.renderOrder = -5; // after the ocean depth sphere (−10), before transparent overlays
  return points;
}

/** Turn the sky so each star is above the place where it is overhead at `date`. */
export function alignStarField(points: Points, date: Date) {
  points.rotation.y = -gmstDegrees(date) * Math.PI / 180;
}
