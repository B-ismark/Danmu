# Export the local furniture detectors for in-browser use.
#
# Only needed to rebuild the models — when public/models/ is empty the app
# falls back to https://huggingface.co/DearthAI/danmu-detector, so a plain
# clone does not need any of this. Keep the toolchain in a throwaway venv;
# CPU-only torch is ~200 MB instead of ~2.5 GB, and export needs no GPU:
#
#   python -m venv .venv-export
#   .venv-export/Scripts/pip install --index-url https://download.pytorch.org/whl/cpu torch
#   .venv-export/Scripts/pip install ultralytics onnx onnxslim onnxruntime clip-anytorch ftfy
#   .venv-export/Scripts/python scripts/export-detector.py
#   rm -rf .venv-export
#
# (Windows paths above; on macOS / Linux use .venv-export/bin/ instead.)
#
# Produces:
#   public/models/yolov8n-oiv7.onnx           (~14 MB, opset 12, 640x640)
#   public/models/yolov8n-oiv7.names.json     (class-index -> name map)
#   public/models/yolov8s-worldv2-danmu.onnx  (~50 MB, opset 12, 640x640)
#
# Two models, run as an ensemble — they fail on disjoint classes. yolov8n-oiv7
# is YOLOv8 nano on Open Images V7 (601 classes) and reliably finds monitors and
# windows. yolov8s-worldv2 is open-vocabulary: set_classes() below freezes the
# furniture prompts into the graph via CLIP at export time, so the runtime needs
# no text encoder, and it finds the fridges / ceiling fans / wardrobes / lamps
# that the fixed-label model never fires on at all.
#
# Measured on a real 4-photo room: OIV7 alone 7/19 objects, world alone 10/19,
# both together 13/19. See Design.md before changing models — bigger OIV7
# variants were tested and do not help.
#
# Weights are AGPL-3.0 (Ultralytics). This project is MIT — see the licence note
# in lib/local-detect.ts. Do not redistribute them from this repo.

import json
import shutil
from pathlib import Path

from ultralytics import YOLO

OUT = Path(__file__).resolve().parent.parent / "public" / "models"
OUT.mkdir(parents=True, exist_ok=True)

# Prompt -> Danmu category, mirrored by WORLD_PROMPTS / WORLD_TO_CATEGORY in
# lib/local-detect.ts. ORDER MATTERS: it is the model's class-channel order.
# Keep the two in sync, or every label will be off by one.
#
# Natural noun phrases beat dataset labels for an open-vocabulary model, and
# several phrases share a category on purpose — real rooms have clothes rails
# and stacked fabric cubes, not a canonical "Wardrobe".
WORLD_VOCAB = {
    "sofa": "sofa", "couch": "sofa", "armchair": "sofa",
    "chair": "chair", "office chair": "chair", "stool": "chair",
    "table": "table", "coffee table": "table", "dining table": "table",
    "desk": "desk",
    "bed": "bed", "mattress": "bed",
    "nightstand": "nightstand",
    "wardrobe": "wardrobe", "closet": "wardrobe", "chest of drawers": "wardrobe",
    "storage cabinet": "wardrobe",
    "shelf": "shelf", "bookshelf": "shelf", "shoe rack": "shelf",
    "mirror": "mirror",
    "curtain": "curtain", "window curtain": "curtain", "window blind": "curtain",
    "picture frame": "painting", "wall art": "painting", "poster": "painting",
    "lamp": "lamp", "light bulb": "lamp", "ceiling light": "lamp",
    "ceiling fan": "fan", "electric fan": "fan",
    "refrigerator": "fridge",
    "potted plant": "plant",
    "door": "door", "wooden door": "door",
    "computer monitor": "monitor",
    "television": "tv",
    "window": "other", "laptop": "other",
    "washing machine": "other", "microwave oven": "other",
    "clothes rack": "wardrobe", "hanging clothes": "wardrobe",
}


def export_oiv7():
    model = YOLO("yolov8n-oiv7.pt")  # auto-downloads on first run
    # Class names BEFORE export (export returns a path, not a model).
    names = {str(k): v for k, v in model.names.items()}
    (OUT / "yolov8n-oiv7.names.json").write_text(json.dumps(names, indent=0))
    onnx_path = model.export(format="onnx", imgsz=640, opset=12)
    shutil.move(str(onnx_path), OUT / "yolov8n-oiv7.onnx")


def export_world():
    model = YOLO("yolov8s-worldv2.pt")
    model.set_classes(list(WORLD_VOCAB.keys()))  # CLIP text encode, baked in
    onnx_path = model.export(format="onnx", imgsz=640, opset=12)
    shutil.move(str(onnx_path), OUT / "yolov8s-worldv2-danmu.onnx")


if __name__ == "__main__":
    export_oiv7()
    export_world()
    print(f"Exported to {OUT}")
    print(f"world vocabulary: {len(WORLD_VOCAB)} prompts "
          f"-> {len(set(WORLD_VOCAB.values()))} categories")
