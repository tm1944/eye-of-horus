import { DoubleSide, MeshBasicMaterial } from "three";

/** Camera-facing radial shading: only land darkens near the globe's silhouette. */
export function continentMaterial(color: string, strength: number) {
  const material = new MeshBasicMaterial({ color, side: DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.limbShadeStrength = { value: strength };
    shader.vertexShader = `varying vec3 vLandViewPosition;\nvarying vec3 vLandRadialNormal;\n${shader.vertexShader}`
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLandViewPosition = mvPosition.xyz;
        vLandRadialNormal = normalize(normalMatrix * normalize(position));`);
    shader.fragmentShader = `uniform float limbShadeStrength;\nvarying vec3 vLandViewPosition;\nvarying vec3 vLandRadialNormal;\n${shader.fragmentShader}`
      .replace('#include <tonemapping_fragment>', `
        float facing = clamp(dot(normalize(vLandRadialNormal), normalize(-vLandViewPosition)), 0.0, 1.0);
        float rim = 1.0 - smoothstep(0.0, 0.65, facing);
        gl_FragColor.rgb *= 1.0 - limbShadeStrength * rim;
        #include <tonemapping_fragment>`);
  };
  material.customProgramCacheKey = () => 'continent-limb-v1';
  return material;
}
