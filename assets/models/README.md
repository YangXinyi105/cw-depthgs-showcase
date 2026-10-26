# Building 4906981 display model

`building-4906981-display.splat` is derived from the real trained CW-DepthGS result `formal_building_4906981_localmv_s0`, iteration 7000. Source building imagery is from TUM2TWIN. The full PLY remains unchanged on the training storage.

The browser model keeps 800,000 of 3,383,214 Gaussians (25,600,000 bytes). It removes invalid records, opacity below 0.05 and the largest 0.5% of maximum scale values, then takes the highest `opacity × second_largest_scale × largest_scale` scores with a stable sort. This prioritizes opacity and approximate visible footprint. It is a display reduction, not a new trained/evaluated method.

Positions and exponential scales are float32. Colors use the SH0/DC term only; higher spherical harmonics are discarded. Normalized rotations and opacity are quantized to 8-bit. The loss of points and view-dependent color can alter appearance. Formal PSNR/SSIM/LPIPS results refer to the full trained model, not this browser asset.

`building-4906981-display.json` contains the full source/output SHA-256, sizes, filtering thresholds, counts and initial camera provenance. The initial camera is derived from camera 28 in the archived `cameras.json`, using the COLMAP camera-to-world forward/up axes.

The self-contained NumPy CPU conversion script is `export_showcase_splat.py`. It requires a new output path and opens the source read-only. No GPU or retraining is used.

The model is only downloaded after clicking the demo button in `viewer.html`. Once published, browsing is served entirely from the static site and does not require the training server to remain online.
