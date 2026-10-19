from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import Settings


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.ready = True
    try:
        yield
    finally:
        application.state.ready = False


def create_app() -> FastAPI:
    settings = Settings()
    application = FastAPI(
        title="GigZLK ML Service",
        version="0.1.0",
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
        lifespan=lifespan,
    )
    application.state.ready = False

    @application.get("/health/live", tags=["health"])
    async def live():
        return {"status": "UP", "service": "ml-service"}

    @application.get("/health/ready", tags=["health"])
    async def ready(request: Request):
        if not request.app.state.ready:
            return JSONResponse(
                status_code=503,
                content={"status": "NOT_READY", "service": "ml-service"},
            )
        return {"status": "READY", "service": "ml-service"}

    return application
