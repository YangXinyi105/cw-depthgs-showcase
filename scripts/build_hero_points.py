"""Build the home-page point cloud (CWPT) from a .splat or a trained 3DGS .ply.

Keeps visible Gaussians, drops floaters, stands the building upright, samples points by
opacity and writes the compact file that hero.js renders. Requires NumPy.
Example: python scripts/build_hero_points.py model.splat assets/hero-points-4959323.bin
    [--points 160000] [--up auto|+x|-x|+y|-y|+z|-z] [--yaw 0] [--preview side.png]

File layout (little-endian): b'CWPT', u32 version=1, u32 count, f32 lo[3], f32 hi[3],
f32 scale, f32 yaw_degrees, u32 reserved, then int16 xyz[count*3] quantised between lo
and hi, u8 rgba[count*4], u8 size[count].
"""
from pathlib import Path
import argparse
import struct
import numpy as np

AXES = {'+x': (1, 0, 0), '-x': (-1, 0, 0), '+y': (0, 1, 0), '-y': (0, -1, 0), '+z': (0, 0, 1), '-z': (0, 0, -1)}
SH_C0 = .28209479177387814


def read_splat(path):
    """Standard 32-byte records: xyz f32, scale f32[3], rgba u8, rotation u8[4]."""
    raw = np.fromfile(path, dtype=np.uint8)
    if raw.size == 0 or raw.size % 32:
        raise ValueError('.splat must contain whole 32-byte records')
    raw = raw.reshape(-1, 32)
    positions = raw[:, :12].copy().view('<f4').astype(np.float64)
    scales = raw[:, 12:24].copy().view('<f4').astype(np.float64)
    return positions, scales, raw[:, 24:27].copy(), raw[:, 27].astype(np.float64) / 255


def read_ply(path):
    props, count, fmt = [], None, None
    with path.open('rb') as handle:
        if handle.readline().strip() != b'ply':
            raise ValueError('Not a PLY')
        while True:
            line = handle.readline().decode('ascii').strip()
            if line.startswith('format '): fmt = line.split()[1]
            if line.startswith('element vertex '): count = int(line.split()[-1])
            if line.startswith('property '):
                fields = line.split()
                if fields[1] != 'float': raise ValueError('Expected float32 Gaussian properties')
                props.append(fields[-1])
            if line == 'end_header': offset = handle.tell(); break
            if not line: raise ValueError('Incomplete header')
    if fmt != 'binary_little_endian' or not count:
        raise ValueError('Expected binary little-endian PLY with vertices')
    source = np.memmap(path, dtype=np.dtype([(n, '<f4') for n in props]), mode='r', offset=offset, shape=(count,))
    positions = np.stack([source[k] for k in 'xyz'], axis=1).astype(np.float64)
    scales = np.exp(np.stack([source[f'scale_{i}'] for i in range(3)], axis=1).astype(np.float64))
    alpha = 1 / (1 + np.exp(-np.clip(source['opacity'].astype(np.float64), -40, 40)))
    colors = .5 + SH_C0 * np.stack([source[f'f_dc_{i}'] for i in range(3)], axis=1)
    return positions, scales, np.clip(np.round(colors * 255), 0, 255).astype(np.uint8), alpha


def upright_basis(positions, up_flag, yaw_degrees):
    """Rows: right, up, forward. Up is the flattest principal axis, pointing away from the
    wider (ground) slab; the building's long side is then turned to face the x axis."""
    centre = np.median(positions, axis=0)
    _, vectors = np.linalg.eigh(np.cov((positions - centre).T))
    if up_flag == 'auto':
        up = vectors[:, 0]
        height = (positions - centre) @ up

        def footprint(mask):
            flat = (positions[mask] - centre) @ vectors[:, 1:]
            return np.prod(np.ptp(np.percentile(flat, [5, 95], axis=0), axis=0))
        if footprint(height > np.percentile(height, 85)) > footprint(height < np.percentile(height, 15)):
            up = -up
    else:
        up = np.array(AXES[up_flag], dtype=np.float64)
    seed = vectors[:, 2] - (vectors[:, 2] @ up) * up
    if np.linalg.norm(seed) < 1e-6:
        seed = np.cross(up, [1, 0, 0] if abs(up[0]) < .9 else [0, 1, 0])
    right = seed / np.linalg.norm(seed)
    # Eigenvector signs are arbitrary; pin one so a model always faces the same way.
    if right[np.argmax(np.abs(right))] < 0:
        right = -right
    angle = np.radians(yaw_degrees)
    forward = np.cross(right, up)
    right = np.cos(angle) * right + np.sin(angle) * forward
    return np.stack([right, up, np.cross(right, up)]), centre


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('source', type=Path, help='.splat or 3DGS .ply')
    parser.add_argument('output', type=Path)
    parser.add_argument('--points', type=int, default=160000, help='sampled points (home page uses 160000)')
    parser.add_argument('--min-alpha', type=float, default=.08, help='drop Gaussians below this opacity')
    parser.add_argument('--up', choices=['auto', *AXES], default='auto', help='source axis that points up')
    parser.add_argument('--yaw', type=float, default=0, help='extra turn around the vertical axis, degrees')
    parser.add_argument('--extent', type=float, default=9, help='horizontal size after scaling, scene units')
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--preview', type=Path, help='write a side and top view PNG to check orientation (needs Pillow)')
    args = parser.parse_args()
    if not 1000 <= args.points <= 400000:
        raise ValueError('--points must be 1000..400000')
    if args.source.resolve() == args.output.resolve():
        raise ValueError('Output must differ from source')
    suffix = args.source.suffix.lower()
    if suffix not in ('.splat', '.ply'):
        raise ValueError('Source must be .splat or .ply')
    positions, scales, rgb, alpha = (read_splat if suffix == '.splat' else read_ply)(args.source)

    keep = (np.isfinite(positions).all(1) & np.isfinite(scales).all(1) & (scales > 0).all(1)
            & np.isfinite(alpha) & (alpha >= args.min_alpha))
    size = np.cbrt(np.prod(np.where(keep[:, None], scales, 1), axis=1))
    keep &= size <= np.percentile(size[keep], 99.5)
    # Floaters sit far outside the scene; trim each axis to its 1st-99th percentile band.
    lo, hi = np.percentile(positions[keep], [1, 99], axis=0)
    margin = (hi - lo) * .03
    keep &= ((positions >= lo - margin) & (positions <= hi + margin)).all(1)
    positions, rgb, alpha, size = positions[keep], rgb[keep], alpha[keep], size[keep]
    if len(positions) < 1000:
        raise ValueError(f'Only {len(positions)} visible Gaussians remain; lower --min-alpha')

    basis, centre = upright_basis(positions, args.up, args.yaw)
    local = (positions - centre) @ basis.T
    horizontal = max(np.ptp(np.percentile(local[:, 0], [1, 99])), np.ptp(np.percentile(local[:, 2], [1, 99])))
    scale = args.extent / horizontal
    local *= scale
    local[:, 1] -= np.percentile(local[:, 1], 1)  # ground near y = 0
    local[:, [0, 2]] -= np.median(local[:, [0, 2]], axis=0)

    rng = np.random.default_rng(args.seed)
    count = min(args.points, len(local))
    pick = rng.choice(len(local), count, replace=False, p=alpha / alpha.sum())
    local, rgb, alpha, size = local[pick], rgb[pick], alpha[pick], size[pick]
    rank = np.argsort(np.argsort(size))
    size_byte = np.round(rank / max(count - 1, 1) * 255).astype(np.uint8)
    alpha_byte = np.clip(np.round(alpha * 255), 1, 255).astype(np.uint8)

    lo, hi = local.min(0).astype(np.float32), local.max(0).astype(np.float32)
    span = np.where(hi > lo, hi - lo, 1).astype(np.float64)
    quantised = np.clip(np.round((local - lo) / span * 65535 - 32768), -32768, 32767).astype('<i2')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('wb') as out:
        out.write(b'CWPT' + struct.pack('<II', 1, count) + lo.astype('<f4').tobytes() + hi.astype('<f4').tobytes()
                  + struct.pack('<ffI', scale, args.yaw, 0))
        out.write(quantised.tobytes())
        out.write(np.column_stack([rgb, alpha_byte]).astype(np.uint8).tobytes())
        out.write(size_byte.tobytes())
    up_source = basis[1] if args.up == 'auto' else AXES[args.up]
    print(f'{args.output}: {count} points, {args.output.stat().st_size / 1e6:.2f} MB, '
          f'up = source axis ({", ".join(f"{v:+.3f}" for v in up_source)}), scale {scale:.4f}')
    if args.preview:
        write_preview(args.preview, local, rgb)


def write_preview(path, points, rgb):
    from PIL import Image, ImageDraw
    panel, pad = 420, 20
    image = Image.new('RGB', (panel * 2, panel + 30), (248, 245, 234))
    draw = ImageDraw.Draw(image)
    for column, (a, b, label) in enumerate([(0, 1, 'side (x, up)'), (0, 2, 'top (x, z)')]):
        u, v = points[:, a], points[:, b]
        span = max(np.ptp(u), np.ptp(v)) or 1
        x = pad + (u - u.min()) / span * (panel - 2 * pad) + column * panel
        y = panel - pad - (v - v.min()) / span * (panel - 2 * pad) if b == 1 else pad + (v - v.min()) / span * (panel - 2 * pad)
        order = np.argsort(points[:, 2] if b == 1 else -points[:, 1])
        for i in order[::max(1, len(order) // 60000)]:
            draw.point((x[i], y[i]), fill=tuple(int(c) for c in rgb[i]))
        draw.text((column * panel + pad, panel + 8), label, fill=(60, 60, 50))
    image.save(path)
    print(f'preview: {path}')


if __name__ == '__main__':
    main()
