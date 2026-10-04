import { DoubleSide, MeshBasicMaterial, TextureLoader, type Texture } from "three";

export type ReliefOptions = {
  strength: number; // 0 = flat; shading change per unit of slope toward/away from the light
  heightScale: number; // slope exaggeration: full heightmap range (0→1) in globe radii
  sampleDegrees: number; // heightmap finite-difference spacing; ~the land tessellation keeps facets coarse
  lightDirection: readonly [number, number, number]; // camera space, toward the light
  slopeSmoothing: number; // slope sampling distance as a multiple of sampleDegrees; larger = smoother terrain
  shadeLimit: number; // soft cap on how far relief can lighten or darken the color (0.3 = ±30%)
};

let heightmap: Texture | null = null;
function reliefTexture() {
  heightmap ??= new TextureLoader().load("/textures/earth-topology.png");
  return heightmap;
}

/**
 * Camera-facing radial shading: only land darkens near the globe's silhouette.
 * With `relief`, land is also shaded from elevation slope. Normals are interpolated across
 * triangles and slopes are sampled over `slopeSmoothing` × the facet spacing, and the
 * shading change is softly capped, so steep ranges (Andes, Himalaya) shade as smooth
 * gradients rather than noisy light/dark facets. Flat ground keeps its base color.
 */
export function continentMaterial(color: string, strength: number, relief?: ReliefOptions) {
  const material = new MeshBasicMaterial({ color, side: DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.limbShadeStrength = { value: strength };
    let reliefVertex = "", reliefFragment = "";
    if (relief) {
      Object.assign(shader.uniforms, {
        reliefMap: { value: reliefTexture() },
        reliefStrength: { value: relief.strength },
        reliefHeightScale: { value: relief.heightScale },
        reliefStep: { value: relief.sampleDegrees * relief.slopeSmoothing * Math.PI / 180 },
        reliefLight: { value: relief.lightDirection },
        reliefLimit: { value: relief.shadeLimit },
      });
      shader.vertexShader = `uniform sampler2D reliefMap;\nuniform float reliefHeightScale;\nuniform float reliefStep;\nvarying vec3 vReliefNormal;\nvarying vec3 vReliefRadial;\n${shader.vertexShader}`;
      // three-globe: x = cos(lat) sin(lng), y = sin(lat), z = cos(lat) cos(lng).
      reliefVertex = `
        vec3 reliefUp = normalize(position);
        float reliefLat = asin(clamp(reliefUp.y, -1.0, 1.0));
        float reliefLng = atan(reliefUp.x, reliefUp.z);
        float reliefLod = log2(max(1.0, reliefStep / (6.2831853 / float(textureSize(reliefMap, 0).x))));
        #define RELIEF_HEIGHT(lng, lat) textureLod(reliefMap, vec2(0.5 + (lng) / 6.2831853, 0.5 + (lat) / 3.1415927), reliefLod).r
        float reliefCos = max(cos(reliefLat), 0.05);
        float reliefEast = (RELIEF_HEIGHT(reliefLng + reliefStep / reliefCos, reliefLat) - RELIEF_HEIGHT(reliefLng - reliefStep / reliefCos, reliefLat)) / (2.0 * reliefStep);
        float reliefNorth = (RELIEF_HEIGHT(reliefLng, min(reliefLat + reliefStep, 1.5707963)) - RELIEF_HEIGHT(reliefLng, max(reliefLat - reliefStep, -1.5707963))) / (2.0 * reliefStep);
        vec3 reliefEastAxis = normalize(vec3(cos(reliefLng), 0.0, -sin(reliefLng)));
        vec3 reliefNorthAxis = cross(reliefUp, reliefEastAxis);
        vec3 reliefObjectNormal = normalize(reliefUp - reliefHeightScale * (reliefEast * reliefEastAxis + reliefNorth * reliefNorthAxis));
        vReliefNormal = normalize(normalMatrix * reliefObjectNormal);
        vReliefRadial = normalize(normalMatrix * reliefUp);`;
      shader.fragmentShader = `uniform float reliefStrength;\nuniform vec3 reliefLight;\nuniform float reliefLimit;\nvarying vec3 vReliefNormal;\nvarying vec3 vReliefRadial;\n${shader.fragmentShader}`;
      reliefFragment = `
        vec3 reliefToLight = normalize(reliefLight);
        float reliefShade = reliefStrength * (dot(normalize(vReliefNormal), reliefToLight) - dot(normalize(vReliefRadial), reliefToLight));
        reliefShade = reliefLimit * tanh(reliefShade / reliefLimit); // soft cap: gentle slopes unchanged, peaks never harsh
        gl_FragColor.rgb *= 1.0 + reliefShade;`;
    }
    shader.vertexShader = `varying vec3 vLandViewPosition;\nvarying vec3 vLandRadialNormal;\n${shader.vertexShader}`
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLandViewPosition = mvPosition.xyz;
        vLandRadialNormal = normalize(normalMatrix * normalize(position));${reliefVertex}`);
    shader.fragmentShader = `uniform float limbShadeStrength;\nvarying vec3 vLandViewPosition;\nvarying vec3 vLandRadialNormal;\n${shader.fragmentShader}`
      .replace('#include <tonemapping_fragment>', `
        float facing = clamp(dot(normalize(vLandRadialNormal), normalize(-vLandViewPosition)), 0.0, 1.0);
        float rim = 1.0 - smoothstep(0.0, 0.65, facing);
        gl_FragColor.rgb *= 1.0 - limbShadeStrength * rim;${reliefFragment}
        #include <tonemapping_fragment>`);
  };
  material.customProgramCacheKey = () => relief ? 'continent-limb-relief-v2' : 'continent-limb-v1';
  return material;
}
