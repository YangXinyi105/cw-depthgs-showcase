# Building 4906981 browser models

Both assets derive from the real trained CW-DepthGS result `formal_building_4906981_localmv_s0`, iteration 7000. Source imagery is from TUM2TWIN. The source PLY is unchanged. No GPU or retraining was used for conversion.

## Default: all source Gaussians

`building-4906981-full-sh0.ksplat` retains all 3,383,214 source Gaussians in 81,375,332 bytes. GaussianSplats3D 0.4.7 parses the source PLY and compresses 250,000-point chunks into 14 KSplat 0.1 sections, with compression level 2, bucket size 256, block size 5 and no opacity removal. Geometry uses bucket-relative uint16 centers and float16 scales/quaternions; color and opacity use RGBA8. SH3 colors are reduced to SH0/DC.

Every decoded center, scale and quaternion was checked for finite values. Float16 quantization underflows 170 of 10,149,642 scale components to zero; no Gaussian has all three scales zero. This preserves point count, not lossless geometry or full view-dependent appearance.

`building-4906981-full-sh0.json` records hashes, counts, conversion settings and the initial camera. Fixed-camera browser comparisons show fewer streaks and more continuous roof, arcade and road features than the 800,000-point export. Close-up views remain blurry. Formal PSNR/SSIM/LPIPS results refer to the original trained model; browser conversions have not been re-evaluated with those metrics.

## Low-memory preview

`building-4906981-display.splat` retains 800,000 points in 25,600,000 bytes. It removes invalid records, opacity below 0.05 and the largest 0.5% of maximum scales, then selects the highest `opacity × second_largest_scale × largest_scale` scores. This reduction favors large splats and can lose small details. It remains available for devices that cannot load the larger model.

Positions and exponential scales are float32; normalized rotations and opacity are quantized to 8-bit. Colors use SH0/DC only. `building-4906981-display.json` records the selection thresholds and hashes. `export_showcase_splat.py` reproduces this reduced export; it does not generate the full KSplat asset.

## Viewing

Both versions use the same initial camera derived from camera 28 in the archived `cameras.json`, using the COLMAP camera-to-world forward/up axes. Models download only after the corresponding button is clicked. Rendering runs in the browser and does not require the training server to remain online.
