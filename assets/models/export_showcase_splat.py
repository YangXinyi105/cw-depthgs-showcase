"""CPU-only, deterministic display reduction of a trained 3DGS PLY.

The source is opened read-only. Experimental metrics must use the full model.
Requires NumPy. Example: python export_showcase_splat.py model.ply output.splat
    --cameras cameras.json --camera-id 28 --max-points 800000
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--cameras', type=Path)
    parser.add_argument('--camera-id', type=int, default=28)
    parser.add_argument('--max-points', type=int, default=800000)
    args = parser.parse_args()
    if not 1 <= args.max_points <= 800000:
        raise ValueError('max-points must be 1..800000')
    if args.source.resolve() == args.output.resolve() or args.output.exists():
        raise ValueError('Output must be a new file distinct from source')
    props = []; count = None; fmt = None
    with args.source.open('rb') as handle:
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
    source = np.memmap(args.source, dtype=np.dtype([(n, '<f4') for n in props]),
                       mode='r', offset=offset, shape=(count,))
    positions = np.stack([source[k] for k in 'xyz'], axis=1)
    scales = np.exp(np.stack([source[f'scale_{i}'] for i in range(3)], axis=1))
    alpha = 1 / (1 + np.exp(-np.clip(source['opacity'], -40, 40)))
    rotations = np.stack([source[f'rot_{i}'] for i in range(4)], axis=1)
    rotation_norms = np.linalg.norm(rotations, axis=1)
    colors = .5 + .28209479177387814 * np.stack([source[f'f_dc_{i}'] for i in range(3)], axis=1)
    valid = (np.isfinite(positions).all(axis=1) & np.isfinite(scales).all(axis=1)
             & (scales > 0).all(axis=1) & np.isfinite(alpha)
             & np.isfinite(rotations).all(axis=1) & (rotation_norms > 1e-10)
             & np.isfinite(colors).all(axis=1))
    max_scale = scales.max(axis=1)
    scale_limit = float(np.quantile(max_scale[valid], .995))
    eligible = valid & (alpha >= .05) & (max_scale <= scale_limit)
    ids = np.flatnonzero(eligible)
    sorted_scales = np.sort(scales[ids], axis=1)
    # The two largest axes approximate the largest visible footprint.
    score = alpha[ids] * sorted_scales[:, 1] * sorted_scales[:, 2]
    order = np.argsort(-score, kind='stable')[:args.max_points]
    kept = ids[order]
    out = np.zeros(len(kept), dtype=[('position', '<f4', 3), ('scale', '<f4', 3),
                                    ('rgba', 'u1', 4), ('rotation', 'u1', 4)])
    out['position'] = positions[kept]
    out['scale'] = scales[kept]
    out['rgba'][:, :3] = np.clip(colors[kept] * 255, 0, 255).astype('u1')
    out['rgba'][:, 3] = np.clip(alpha[kept] * 255, 0, 255).astype('u1')
    out['rotation'] = np.clip(rotations[kept] / rotation_norms[kept, None] * 128 + 128, 0, 255).astype('u1')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.tofile(args.output)
    metadata = {
        'building': '4906981', 'format': 'splat-32-byte', 'displayOnly': True,
        'sourceModel': 'formal_building_4906981_localmv_s0/point_cloud/iteration_7000/point_cloud.ply',
        'sourceBytes': args.source.stat().st_size, 'sourceSha256': sha256(args.source),
        'sourceGaussians': count, 'retainedGaussians': len(kept),
        'outputBytes': args.output.stat().st_size, 'outputSha256': sha256(args.output),
        'algorithm': {
            'finitePositiveScaleAndRotationFilter': True, 'minimumOpacity': .05,
            'maximumScaleQuantile': .995, 'maximumScaleThreshold': scale_limit,
            'eligibleGaussians': len(ids), 'ranking': 'opacity * second_largest_scale * largest_scale',
            'selection': 'Top scores, stable sort; no new or interpolated Gaussians',
            'color': 'RGB = clip(0.5 + 0.28209479177387814 * f_dc, 0, 1), 8-bit; higher SH terms discarded',
            'rotation': 'Normalized quaternion [w,x,y,z], encoded uint8(q*128+128)',
            'opacity': 'uint8(255 * sigmoid(source_opacity))',
            'scale': 'float32(exp(source_log_scale))',
        },
        'note': '展示精简版，不代表完整模型的定量实验效果；未重新训练。'
    }
    if args.cameras:
        camera = next(c for c in json.loads(args.cameras.read_text()) if c['id'] == args.camera_id)
        rotation = np.asarray(camera['rotation']); position = np.asarray(camera['position'])
        forward = rotation[:, 2]; up = -rotation[:, 1]
        center = np.median(positions[kept], axis=0)
        distance = max(.5, float(np.dot(center-position, forward)))
        metadata['initialView'] = {
            'position': position.tolist(), 'target': (position + forward * distance).tolist(),
            'up': up.tolist(), 'fov': float(np.degrees(2 * np.arctan(camera['height'] / (2 * camera['fy'])))),
            'sourceCameraId': args.camera_id, 'sourceImage': camera['img_name'],
            'derivation': 'COLMAP camera-to-world rotation: forward=column2, up=-column1; target distance projected from retained-point median'
        }
    metadata_path = args.output.with_suffix('.json')
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
