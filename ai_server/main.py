"""
SCARNERGY v2.0 — AI Inference Server
FastAPI server for measurement validation, anomaly detection,
type classification, and energy label prediction.

Run: uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import logging

from routers import validate, energy
from models.loader import ModelRegistry

logger = logging.getLogger("scarnergy.ai")
logging.basicConfig(level=logging.INFO)

registry = ModelRegistry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading ML models...")
    registry.load_all()
    logger.info(f"Models ready: {list(registry.loaded.keys())}")
    app.state.models = registry
    yield
    logger.info("Shutting down AI server")


app = FastAPI(
    title="Scarnergy AI Inference Server",
    description="Anomaly detection, type classification, and energy prediction for building inspections",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(validate.router, prefix="/validate", tags=["Validation"])
app.include_router(energy.router,   prefix="/energy",   tags=["Energy"])


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "models": {
            name: "loaded" for name in app.state.models.loaded
        }
    }
