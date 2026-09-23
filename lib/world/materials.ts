import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * Image-to-3D models export metallicFactor 1 on everything. Without a metalness map that
 * turns the whole object into bare metal, which renders nearly black. They're almost never
 * metal: treat them as dielectric unless a map says otherwise.
 */
export function fixGeneratedMaterial(material: THREE.Material) {
  const m = material as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial) return;
  if (!m.metalnessMap && m.metalness >= 0.99) m.metalness = 0;
  if (!m.roughnessMap && m.roughness < 0.35) m.roughness = 0.6;
  m.envMapIntensity = 0.8;
}

let environment: THREE.Texture | null = null;

/** A soft studio room for PBR reflections, generated locally (no HDR download). */
export function roomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (environment) return environment;
  const pmrem = new THREE.PMREMGenerator(renderer);
  environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return environment;
}
