import { Vector3, type Camera } from "three";

/** Anchor a dropped headline in world space at the POI's camera depth. */
export function cardWorldAnchor(x: number, y: number, width: number, height: number, point: { x: number; y: number; z: number }, camera: Camera) {
  const depth = new Vector3(point.x, point.y, point.z).project(camera).z;
  return new Vector3(2 * x / width - 1, 1 - 2 * y / height, depth).unproject(camera);
}
