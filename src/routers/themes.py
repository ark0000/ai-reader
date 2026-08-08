from fastapi import APIRouter, Depends
from pydantic import BaseModel
from src.database import ThemeRepository
from src.dependencies import resolve_user

router = APIRouter(prefix="/api/themes", tags=["themes"])

class SaveThemeRequest(BaseModel):
    name: str
    bg_color: str
    text_color: str
    sat_factor: float
    brightness_factor: float

@router.post("")
async def api_save_theme(req: SaveThemeRequest, user_data: dict = Depends(resolve_user)):
    ThemeRepository.add_theme(
        user_data["user_id"], req.name, req.bg_color, req.text_color,
        req.sat_factor, req.brightness_factor
    )
    return {"status": "saved"}

@router.get("")
async def api_get_themes(user_data: dict = Depends(resolve_user)):
    return ThemeRepository.get_user_themes(user_data["user_id"])
