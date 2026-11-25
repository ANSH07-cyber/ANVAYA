# ANVAYA

ANVAYA brings appointment booking, electronic health records (EHR), and consent-based record sharing into patient, doctor, and admin portals. The FastAPI backend also serves a seven-class skin-lesion screening model.

| Component | Role |
| --- | --- |
| [React and TypeScript frontend](frontend/) | Patient, doctor, and admin portals. Vite proxies `/api` to FastAPI during local development. |
| [FastAPI backend](Anvaya_Main_Backend_Starter/backend/) | Authentication, appointments, EHR, consent checks, audit logs, and skin-lesion analysis. SQLAlchemy and Alembic manage the PostgreSQL schema. |
| [Skin model evaluation](ml/skin_model_evaluation.md) | Held-out recall reporting protocol and current evaluation status. |
| [Symptom-to-condition notebook](ml/symptom_to_disease.ipynb) | Separate research baseline using DDXPlus evidence codes. |

## How the skin model connects

1. A signed-in patient uploads a JPEG or PNG from the skin screening page.
2. React posts the image to `POST /api/v1/ai/skin-lesion/analyze`. FastAPI validates the upload and passes it to the skin-lesion service.
3. With the configured EfficientNet-B0 checkpoint loaded, the service returns scores for seven lesion classes. The API records the analysis and returns the result and disclaimer to the patient.
4. The doctor portal reads patient screenings through the access-controlled API and can submit a review. Use fictional data for local demos.

**Clinical disclaimer.** This is an AI-assisted screening analysis, NOT a definitive diagnosis. It must be reviewed by a qualified dermatologist. Do not start, stop, or alter medical treatment based on this screening.

## Local setup

From the repository root in PowerShell, set up the backend in one terminal:

```powershell
cd Anvaya_Main_Backend_Starter/backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Set `DATABASE_URL` to a local PostgreSQL development database, set a unique `JWT_SECRET_KEY`, and configure Redis and other integrations as needed using `.env.example`. Confirm the database target before applying migrations. For trained inference, install a compatible PyTorch and torchvision pair in the backend environment. Supply the trained checkpoint locally via `SKIN_LESION_MODEL_PATH`. If running a trained-model demo, verify that inference mode is `pytorch_efficientnet_b0`, since the service can otherwise use a fallback estimator.

```powershell
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal at the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open the Vite URL printed by the terminal (usually http://localhost:5173). FastAPI's API docs are at http://127.0.0.1:8000/docs.
