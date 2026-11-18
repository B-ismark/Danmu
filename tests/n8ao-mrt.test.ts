import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, REVISION, Scene } from 'three';

// n8ao 2.0.1's MRT shim gave its half-res depth target a `texture` getter that
// returned the whole `textures` ARRAY. three >= 0.162 reads
// `renderTarget.texture.mipmaps.length` in WebGLTextures.setupRenderTarget, so
// on render quality 'high' (Room.tsx mounts <N8AO halfRes />) every frame threw
// before the AO pass drew — on any GPU; nothing in that path is capability-
// dependent. The fix is n8ao 2.0.2, held by the `n8ao@2` override in
// package.json. This reads the shape three will read, without a GL context,
// so dropping the override fails here instead of in someone's room.
//
// n8ao is not a direct dependency, so it is resolved the way the app reaches it:
// from @react-three/postprocessing — the copy that actually ships.
const fromPostprocessing = createRequire(
  createRequire(import.meta.url).resolve('@react-three/postprocessing'),
);

describe('N8AO half-res depth target', () => {
  it('exposes a single texture where three expects one', async () => {
    const { N8AOPostPass } = await import(
      /* @vite-ignore */ pathToFileURL(fromPostprocessing.resolve('n8ao')).href
    );
    expect(Number(REVISION)).toBeGreaterThanOrEqual(162);
    const pass = new N8AOPostPass(new Scene(), new PerspectiveCamera(), 64, 64);
    pass.configuration.halfRes = true;
    const target = (pass as unknown as { depthDownsampleTarget: { texture: unknown; textures: unknown[] } })
      .depthDownsampleTarget;
    expect(Array.isArray(target.texture)).toBe(false);
    expect((target.texture as { mipmaps?: unknown[] }).mipmaps).toBeInstanceOf(Array);
    expect(target.textures).toHaveLength(2);
    expect(target.texture).toBe(target.textures[0]);
  });
});
