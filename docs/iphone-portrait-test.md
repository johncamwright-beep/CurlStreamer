# Physical iPhone portrait check

1. Hold an iPhone upright, open the camera invitation in Chrome, allow camera
   access, and tap **Connect Camera** once.
2. On the camera page, record both **Actual capture** and **Video element**.
   Each should report a height greater than its width (normally `720×1280`).
3. Open the broadcast on a second device and record the **Remote video**
   dimensions. They must also have a height greater than their width, and the
   whole camera image must remain visible without cropping or stretching.
4. If iOS cannot return portrait frames, confirm the camera page warns that the
   landscape source is being published and that the broadcast letterboxes the
   complete image rather than identifying it as portrait.
