# Export the local furniture detector for in-browser use.
#
# Only needed to rebuild the model — when public/models/ is empty the app falls
# back to https://huggingface.co/DearthAI/danmu-detector, so a plain clone does
# not need any of this. Keep the toolchain in a throwaway venv; CPU-only torch
# is ~200 MB instead of ~2.5 GB, and export needs no GPU:
#
#   python -m venv .venv-export
#   .venv-export/Scripts/pip install --index-url https://download.pytorch.org/whl/cpu torch
#   .venv-export/Scripts/pip install ultralytics onnx onnxslim
#   .venv-export/Scripts/python scripts/export-detector.py
#   rm -rf .venv-export
#
# (Windows paths above; on macOS / Linux use .venv-export/bin/ instead.)
#
# Produces:
#   public/models/yolov8n-oiv7.onnx        (~13 MB, opset 12, 640x640)
#   public/models/yolov8n-oiv7.names.json  (class-index -> name map)
#
# yolov8n-oiv7 is YOLOv8 nano trained on Open Images V7 (600 classes,
# including wardrobe / mirror / nightstand / curtain / ceiling fan and most
# other home furniture). Weights are AGPL-3.0 (this project is open source).

import json
from pathlib import Path

from ultralytics import YOLO

OUT = Path(__file__).resolve().parent.parent / "public" / "models"
OUT.mkdir(parents=True, exist_ok=True)

model = YOLO("yolov8n-oiv7.pt")  # auto-downloads on first run

# Class names BEFORE export (export returns a path, not a model).
names = {str(k): v for k, v in model.names.items()}
(OUT / "yolov8n-oiv7.names.json").write_text(json.dumps(names, indent=0))

onnx_path = model.export(format="onnx", imgsz=640, opset=12)
Path(onnx_path).replace(OUT / "yolov8n-oiv7.onnx")

print(f"Exported to {OUT}")
