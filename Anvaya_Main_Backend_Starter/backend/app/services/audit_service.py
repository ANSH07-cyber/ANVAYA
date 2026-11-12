
from collections.abc import Mapping
from typing import Any, Literal
from uuid import UUID

from sqlalchemy.orm import Session, sessionmaker

from app.models.audit_log import AuditLog


AuditOutcome = Literal["success", "denied", "failure"]


def add_audit_log(
    db: Session,
    *,
    actor_user_id: UUID,
    event_type: str,
    resource_type: str,
    resource_id: UUID | str,
    outcome: AuditOutcome = "success",
    patient_profile_id: UUID | None = None,
    doctor_profile_id: UUID | None = None,
    details: Mapping[str, Any] | None = None,
) -> AuditLog:
    """
    Add an audit event to the current database transaction.

    The caller is responsible for committing or rolling back
    the transaction. This is useful for logging successful
    operations atomically with their database changes.
    """

    audit_log = AuditLog(
        actor_user_id=actor_user_id,
        patient_profile_id=patient_profile_id,
        doctor_profile_id=doctor_profile_id,
        event_type=event_type,
        resource_type=resource_type,
        resource_id=str(resource_id),
        outcome=outcome,
        details=dict(details) if details is not None else {},
    )

    db.add(audit_log)

    return audit_log


def record_audit_log(
    db: Session,
    *,
    actor_user_id: UUID,
    event_type: str,
    resource_type: str,
    resource_id: UUID | str,
    outcome: AuditOutcome = "success",
    patient_profile_id: UUID | None = None,
    doctor_profile_id: UUID | None = None,
    details: Mapping[str, Any] | None = None,
) -> UUID:
    """
    Persist an audit event in an independent database session.

    Useful for recording read-access events and denied actions
    that must survive the request session's rollback.
    
    The bind is taken from the supplied session so that database
    test overrides and isolated schemas are respected.
    """

    audit_session_factory = sessionmaker(
        bind=db.get_bind(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    audit_db = audit_session_factory()

    try:
        audit_log = add_audit_log(
            audit_db,
            actor_user_id=actor_user_id,
            event_type=event_type,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            patient_profile_id=patient_profile_id,
            doctor_profile_id=doctor_profile_id,
            details=details,
        )

        audit_db.commit()

        return audit_log.id

    except Exception:
        audit_db.rollback()
        raise

    finally:
        audit_db.close()
