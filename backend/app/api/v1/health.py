from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["System"])
def health_check():
    return {
        "status": "healthy",
        "service": "Healthcare GenAI Platform",
        "api_version": "v1"
    }

