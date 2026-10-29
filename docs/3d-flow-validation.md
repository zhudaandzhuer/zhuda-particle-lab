# 3D airflow acceptance

The main effect starts at the vehicle nose, wraps the roof and both flanks, then leaves a curved wake. Eight authored paths, their surface width directions, car/track geometry, motion and textures belong to this demo. Generic XYZ simulation, depth-tested billboards, history ribbons, authored ribbon paths and reveal windows belong to the engine.

Verified in real Laya 3.4.2 WebGL using isolated desktop Chrome. Screenshots cover startup at 0.8 / 1.05 / 1.5 seconds, full boost at 3.5, release at 5.7, drain at 7.8 and chase/side/front cameras. Replay is deterministic; changing camera leaves simulation and centerlines unchanged. Twelve alternating 2D/3D rebuilds preserve 21 effect nodes and all shared textures. Invalid JSON leaves the current descriptor intact.

Two rendering failures were fixed during acceptance: unused ribbon indices could connect to zeroed origin vertices, and Laya material destruction cascaded into shared texture destruction. The 3D renderer detaches the shared texture before destroying its owned material. Browser regression checks texture survival explicitly. Surface width directions also remove camera-alignment twists in authored flow bands.

Desktop performance for this run: peak 53 live particles, peak 96 scene WebGL draw calls, maximum smoothed CPU update/submit 0.877 ms, frame-interval P95 16.8 ms. CPU measurements exclude GPU completion. These are desktop measurements; mobile devices were not tested.

Evidence is generated under `evidence/` (ignored): `racing-verification.json`, `racing3d-chase.png`, `racing3d-side.png`, `racing3d-front.png`, `racing3d-after-rebuilds.png` and `racing3d-cycle.mp4`. Run `RECORD=1 npm run verify:3d` after building to reproduce.
