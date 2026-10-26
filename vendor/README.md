# Browser renderer dependencies

This directory vendors the published npm distributions below so the viewer does not depend on a third-party CDN at runtime.

| Package | Pinned version | Included build | License |
|---|---|---|---|
| `@mkkellogg/gaussian-splats-3d` | 0.4.7 | `build/gaussian-splats-3d.module.js` | MIT, `gaussian-splats-3d-LICENSE.txt` |
| `three` | 0.170.0 | `build/three.module.min.js` | MIT, `three-LICENSE.txt` |

Upstream: <https://github.com/mkkellogg/GaussianSplats3D> and <https://github.com/mrdoob/three.js>.

Local edits to the GaussianSplats3D module: replace its two bare `three` import paths with `./three-0.170.0.module.min.js`; remove the unused source map URL. No rendering algorithm changes. Three.js is unmodified. The source package archives are available from the npm registry at their exact versions.

`viewer.js` disables worker shared memory and GPU distance sorting, allowing use on ordinary GitHub Pages without COOP/COEP response headers. The browser still requires WebGL 2, WebAssembly and Web Workers. CPU sorting on large models can be slower than the project's native CUDA renderer.
