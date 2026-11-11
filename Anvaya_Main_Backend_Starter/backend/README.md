# Anvaya Main Backend — Starter

This is the first backend foundation. It includes:
- FastAPI application and Swagger UI
- SQLite for the first local smoke test (PostgreSQL driver is included for the next setup step)
- User table and patient-only public registration
- Password hashing with Argon2
- JWT access tokens
- `/auth/me` protected route
- A role-check dependency and an admin access-check route

It does **not** yet include appointments, EHR, prescriptions, consent workflows, audit logging, notifications, or the Skin AI router. We will add those after verifying this foundation.

## Setup in PowerShell

Open a terminal in this `backend` folder.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Before using beyond local development, replace `JWT_SECRET_KEY` in `.env` with a long random secret. The `.env.example` value is a placeholder.

## Run

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000/docs

The starter uses a local SQLite file so registration/login can be tested before configuring PostgreSQL. We will switch `DATABASE_URL` to PostgreSQL when we set up the project database.

## First API checks

1. `GET /api/v1/health`
2. `POST /api/v1/auth/register` with `full_name`, `email`, and `password` (at least 8 characters).
3. Copy `access_token` from the response.
4. Use Swagger's **Authorize** button with `Bearer <access_token>` if prompted for the value.
5. `GET /api/v1/auth/me`

Public registration always creates a `patient` account. Doctor and admin accounts must be provisioned through a controlled workflow; users cannot select their own privileged role.
