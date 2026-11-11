
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.user import User
from app.models.patient_profile import PatientProfile
from app.schemas.patient import PatientProfileRead, PatientProfileUpdate


router = APIRouter(prefix="/patients", tags=["Patient Profile"])


@router.get("/me", response_model=PatientProfileRead)
def get_my_profile(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    profile = db.scalar(
        select(PatientProfile).where(
            PatientProfile.user_id == current_user.id
        )
    )

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Patient profile not created yet. Please create your profile."
        )

    return profile


@router.put("/me", response_model=PatientProfileRead)
def create_or_update_my_profile(
    payload: PatientProfileUpdate,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    profile = db.scalar(
        select(PatientProfile).where(
            PatientProfile.user_id == current_user.id
        )
    )

    update_data = payload.model_dump(exclude_unset=True)

    if profile is None:
        profile = PatientProfile(
            user_id=current_user.id,
            **update_data
        )
        db.add(profile)
    else:
        for field, value in update_data.items():
            setattr(profile, field, value)

    db.commit()
    db.refresh(profile)

    return profile
