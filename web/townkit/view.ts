/**
 * Picks the town renderer: the 3D block town by default, the 2D pixel town with `?view=2d`
 * or where WebGL 2 is missing.
 */
import { type TownView, createTownView } from "./scene";
import { type VoxelOptions, createVoxelTownView, webglAvailable } from "./scene3d";

export type { TownView };

export async function createTown(host: HTMLElement, options: VoxelOptions = {}): Promise<TownView> {
  const flat = new URLSearchParams(location.search).get("view") === "2d";
  if (flat || !webglAvailable()) return createTownView(host);
  return createVoxelTownView(host, options);
}
