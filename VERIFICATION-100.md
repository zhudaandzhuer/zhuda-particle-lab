# 100 效果驗收 — 2026-10-29

已完成 10 類 × 10 種，共 100 種（原有 8 種＋新增 92 種）；91 種 2D、9 種真實 3D。

- 100/100：WebGL 實際渲染、粒子數大於零且不超出池容量、座標有限、固定種子重播、動畫推進、JSON 來回一致。
- 新增 92 種：匯入後保留場景錨點與運動，粒子座標與原效果一致。
- 100/100 開啟／關閉特效截圖均有可見差異，並產生四張總覽圖及 100 張圖鑑縮圖。
- 25 組、共 100 次額外跨 2D／3D／賽車切換：節點數穩定，共用貼圖存活。
- 分類、用途搜尋、參數、開關、自然消散、鏡頭與拒絕無效匯入通過。
- 原有七種 2D、3D 賽車及 4,000 粒子負載測試通過。
- 排除 ID、種子、配色與情境道具後，100 種配方仍各自不同。

代表場景的連續播放量測（本機桌面 headless Chrome；CPU 僅模擬與提交，不含 GPU 完成）：

| 效果 | 活躍粒子 | CPU ms | 幀間隔 P95 ms |
| --- | --- | --- | --- |
| rain | 250 | 0.086 | 16.8 |
| campfire | 68 | 0.111 | 16.7 |
| healing | 75 | 0.096 | 16.8 |
| warp3d | 218 | 0.130 | 16.7 |
| fountain3d | 243 | 0.234 | 16.7 |

驗證原始資料：[100 種效果](docs/verification/catalog-report.json)、[畫面差異](docs/verification/catalog-pixel-report.json)、[2D 與負載](docs/verification/verification.json)、[3D 賽車](docs/verification/racing-verification.json)。

展示：https://zhudaandzhuer.github.io/zhuda-particle-lab/ ；圖鑑：https://zhudaandzhuer.github.io/zhuda-particle-lab/catalog.html 。圖鑑連結已透過 app 瀏覽器實際開啟並確認正確載入 3D 噴泉。

來源與場景完全位於 Zhuda-ParticleLab。通用引擎與展示內容分離，僅以 SDK 與展示連結互相引用。所有貼圖程序、100 份個別 JSON、場景 adapter、索引及驗收腳本均保留在獨立專案。
