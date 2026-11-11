# Anvaya Skin Lesion AI — FastAPI starter

This package serves the **already-trained** Anvaya EfficientNet-B0 seven-class model. It does not train a model.

## Included

- `models/anvaya_skin_lesion_efficientnet_b0_v1.pth` — model artifact
- `models/anvaya_model_config_v1.json` — class order and evaluation metadata
- `app/ml/skin_lesion_model.py` — one-time model loader and inference preprocessing
- `app/api/routes/skin_lesion.py` — upload validation and prediction endpoint
- `app/main.py` — standalone local FastAPI app for smoke testing
- `reports/` — final test report and confusion matrix from the completed experiment

## Important model scope and safety

- The model has seven HAM10000 output classes: `akiec`, `bcc`, `bkl`, `df`, `mel`, `nv`, `vasc`.
- It was trained on **dermoscopic images**. Ordinary smartphone photographs, other imaging modalities, and other skin conditions are outside the evaluated domain. The API checks that a file is an image; it cannot prove that the image was acquired with a dermatoscope.
- Returned softmax values are **uncalibrated model scores**, not calibrated probabilities or medical confidence.
- This is an academic research prototype, not a diagnostic device. It must not be used to diagnose, rule out disease, recommend treatment, or make care decisions. Every result requires qualified dermatologist review.
- The final held-out test results recorded in the included report are 71.28% accuracy and 0.5970 Macro-F1 on the project's 1,490-image test split. These are internal dataset results, not clinical validation or external validation.
- This package has no authentication by itself. Run it locally for development only. Before connecting it to Anvaya users, protect the route with the existing Anvaya JWT/RBAC dependency and authorization rules. CORS is not authentication.
- Uploaded image bytes are processed in memory and are not saved by this module.

## 1. Extract and open the project

Extract `Anvaya_Skin_AI_FastAPI.zip` to a folder, for example:

```text
C:\\Anvaya\\Anvaya_Skin_AI_FastAPI
```

The model and config are already placed in the `models` folder. Do not rename the model file unless you also update `ANVAYA_SKIN_MODEL_PATH`.

## 2. Create a Python environment (Windows PowerShell)

Python 3.10–3.13 is supported by current compatible PyTorch/TorchVision releases. Use a clean environment:

```powershell
cd C:\\Anvaya\\Anvaya_Skin_AI_FastAPI
py -3.11 -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If `py -3.11` is not installed, use an installed supported version, e.g. `py -3.13 -m venv .venv`.

For NVIDIA GPU inference, install a matching CUDA-enabled PyTorch/TorchVision build using the official PyTorch installation selector. If CUDA is not available, the service automatically uses CPU.

## 3. Start the API

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Open:

- API docs: http://127.0.0.1:8001/docs
- Health: http://127.0.0.1:8001/health
- Supported classes: http://127.0.0.1:8001/api/v1/ai/skin-lesion/classes

The first `/health` request loads the 16 MB model into memory. Subsequent requests reuse it.

## 4. Test an image

In Swagger UI (`/docs`):

1. Expand `POST /api/v1/ai/skin-lesion/predict`.
2. Click **Try it out**.
3. Choose a JPEG or PNG dermoscopic image.
4. Click **Execute**.

Maximum upload size is 10 MB. Images are decoded as RGB and transformed with the same TorchVision EfficientNet-B0 evaluation transform used in the training/validation pipeline (resize to 256, center crop to 224, then ImageNet normalization).

Example response shape:

```json
{
  "model_version": "anvaya-skin-lesion-v1",
  "predicted_class_code": "nv",
  "predicted_class_name": "Melanocytic nevi",
  "model_score": 0.72,
  "class_scores": [
    {"class_code": "akiec", "class_name": "Actinic keratoses / intraepithelial carcinoma", "score": 0.01},
    {"class_code": "bcc", "class_name": "Basal cell carcinoma", "score": 0.02}
  ],
  "score_type": "uncalibrated_softmax_score",
  "requires_doctor_review": true
}
```

The numeric values above are illustrative only, not an actual prediction.

## 5. Add the router to your existing Anvaya FastAPI app

This starter runs as a separate local API for safe initial testing. In the existing Anvaya modular-monolith backend, copy these files/folders into the backend (preserving imports):

- `app/ml/skin_lesion_model.py`
- `app/api/routes/skin_lesion.py`
- `models/anvaya_skin_lesion_efficientnet_b0_v1.pth`
- `models/anvaya_model_config_v1.json`

Then in your existing FastAPI app module, include the router:

```python
from app.api.routes.skin_lesion import router as skin_lesion_router

app.include_router(skin_lesion_router)
```

Do not create a second `FastAPI()` instance in the existing app. Keep your existing app and include this router. If your project uses a different Python package name, adjust the imports accordingly.

**Before enabling this route for real patients**, add your project's existing JWT authentication and RBAC dependency to `predict_skin_lesion`. Restrict access according to your requirements (for example, authenticated patient upload and authorized doctor review). Also add consent, audit logging, retention rules, and clinical governance consistent with your SRS.

## 6. Preprocessing consistency note

The model was evaluated using `EfficientNet_B0_Weights.DEFAULT.transforms()`. The API uses that same transform. TorchVision documents this transform as resize to 256, bicubic interpolation, center crop to 224, rescale to [0,1], and normalize with mean `[0.485, 0.456, 0.406]` and std `[0.229, 0.224, 0.225]`.

## 7. Troubleshooting

- **Model file not found:** confirm the `.pth` and JSON files are in `models/`, or set the two environment variables in `.env` / PowerShell.
- **`python-multipart` missing:** activate the venv and run `pip install python-multipart`.
- **Torch/TorchVision import error:** reinstall a mutually compatible pair from the official PyTorch selector. Do not install mismatched torch and torchvision builds.
- **CUDA unavailable:** the API falls back to CPU. Check `python -c "import torch; print(torch.cuda.is_available())"`.
- **422/400/415 response:** check that the upload is a valid JPEG/PNG, at most 10 MB, and within accepted dimensions.

## References

- FastAPI file uploads: https://fastapi.tiangolo.com/tutorial/request-files/
- TorchVision EfficientNet-B0 and inference transforms: https://docs.pytorch.org/vision/main/models/generated/torchvision.models.efficientnet_b0
