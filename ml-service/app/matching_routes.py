from fastapi import APIRouter

from app.matching_response import MatchResponse
from app.matching_schemas import MatchRequest
from app.matching_service import assess_match


router = APIRouter(
    prefix="/api/v1/ml",
    tags=["matching"],
)


@router.post("/match", response_model=MatchResponse)
def match_worker(request: MatchRequest) -> MatchResponse:
    return assess_match(request)