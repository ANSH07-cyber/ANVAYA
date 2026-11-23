
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401 - registers SQLAlchemy models
from app.api.router import api_router
from app.core.config import settings
from app.core.rate_limit import reset_rate_limits


@asynccontextmanager
async def lifespan(app: FastAPI):
    reset_rate_limits()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Starter backend for the Anvaya healthcare application.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/", tags=["Root"])
def root() -> dict[str, str]:
    return {"message": "Anvaya API is running", "docs": "/docs"}
