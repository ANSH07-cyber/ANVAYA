from datetime import datetime, timezone
import re
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.notification import Notification

ALLOWED_ROLE_PREFIXES = {
    "patient": "/patient",
    "doctor": "/doctor",
    "admin": "/admin",
}

SAFE_PATH_REGEX = re.compile(r"^/[a-zA-Z0-9_\-\/]+$")


def is_safe_role_path(path: str | None, role: str) -> bool:
    """Validates that a path is a safe relative internal route belonging to the recipient's role.

    Prevents:
    - Open redirects (e.g. //evil.com, http://evil.com)
    - Cross-portal unauthorized navigation (e.g. patient navigating to /admin/*)
    - Injection of javascript: or data: URIs
    - Control characters or HTML entities
    """
    if not path:
        return True

    # Must start with single slash and contain only URL path characters
    if not SAFE_PATH_REGEX.match(path):
        return False

    if path.startswith("//") or path.startswith("/\\"):
        return False

    # Check allowed prefix for the user's role
    expected_prefix = ALLOWED_ROLE_PREFIXES.get(role.lower())
    if not expected_prefix:
        return False

    if path == expected_prefix or path.startswith(f"{expected_prefix}/"):
        return True

    return False


def create_notification(
    db: Session,
    *,
    recipient_user_id: UUID,
    notification_type: str,
    title: str,
    message: str,
    related_entity_type: str | None = None,
    related_entity_id: str | None = None,
    safe_action_path: str | None = None,
    idempotency_key: str | None = None,
    recipient_role: str | None = None,
) -> Notification | None:
    """Creates a notification within the caller's database transaction using a SAVEPOINT.

    Transaction & Deduplication Architecture:
    - Uses `db.begin_nested()` (SAVEPOINT) so that if an IntegrityError occurs due to
      a duplicate idempotency_key or unique constraint, ONLY the savepoint is rolled back.
      The calling outer transaction (e.g., booking appointment, issuing prescription)
      remains valid and clean, avoiding PostgreSQL 25P02 transaction abortion.
    - If a duplicate idempotency_key is detected, returns the existing notification without failing.
    - Ensures Zero Protected Health Information (PHI) stored in title or message.
    """
    # Role-based safe action path validation
    validated_path = safe_action_path
    if safe_action_path and recipient_role:
        if not is_safe_role_path(safe_action_path, recipient_role):
            validated_path = None

    now = datetime.now(timezone.utc)

    # If idempotency_key is provided, check if it already exists before insert
    if idempotency_key:
        existing = (
            db.query(Notification)
            .filter(Notification.idempotency_key == idempotency_key)
            .first()
        )
        if existing is not None:
            return existing

    notification = Notification(
        recipient_user_id=recipient_user_id,
        notification_type=notification_type,
        title=title,
        message=message,
        is_read=False,
        created_at=now,
        read_at=None,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        safe_action_path=validated_path,
        idempotency_key=idempotency_key,
    )

    try:
        with db.begin_nested():
            db.add(notification)
            db.flush()
        return notification
    except IntegrityError:
        # Savepoint caught duplicate key or foreign key violation
        if idempotency_key:
            existing = (
                db.query(Notification)
                .filter(Notification.idempotency_key == idempotency_key)
                .first()
            )
            if existing is not None:
                return existing
        return None


def get_unread_count(db: Session, user_id: UUID) -> int:
    """Returns the total number of unread notifications for a given user.

    Uses covered index ix_notifications_recipient_unread for sub-millisecond execution.
    """
    stmt = (
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.recipient_user_id == user_id,
            Notification.is_read.is_(False),
        )
    )
    return db.scalar(stmt) or 0


def mark_notification_as_read(
    db: Session,
    *,
    notification_id: UUID,
    user_id: UUID,
) -> Notification | None:
    """Marks a single notification as read if owned by the user.

    Uses row-level locking (with_for_update) to prevent concurrent update races.
    Returns None if the notification does not exist or belongs to another user.
    """
    notification = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.recipient_user_id == user_id,
        )
        .with_for_update()
        .first()
    )

    if notification is None:
        return None

    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notification)

    return notification


def mark_all_notifications_as_read(
    db: Session,
    *,
    user_id: UUID,
) -> int:
    """Marks all unread notifications as read for a given user in a single atomic batch update.

    Returns the count of updated records.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        update(Notification)
        .where(
            Notification.recipient_user_id == user_id,
            Notification.is_read.is_(False),
        )
        .values(
            is_read=True,
            read_at=now,
        )
    )
    result = db.execute(stmt)
    db.commit()
    return result.rowcount


# =====================================================================
# EVENT NOTIFICATION HELPERS (TRANSACTIONAL INTEGRATION)
# =====================================================================

def _format_date(d) -> str:
    return d.strftime("%a, %d %b %Y") if hasattr(d, "strftime") else str(d)


def _format_time(t) -> str:
    return t.strftime("%I:%M %p") if hasattr(t, "strftime") else str(t)


def notify_appointment_booked(
    db: Session,
    *,
    appointment_id: UUID,
    appointment_date,
    start_time,
    patient_user_id: UUID,
    doctor_user_id: UUID,
    doctor_name: str | None = None,
) -> tuple[Notification | None, Notification | None]:
    """Generates dual notifications for appointment booking:
    1. Patient confirmation
    2. Doctor new appointment alert
    """
    date_str = _format_date(appointment_date)
    time_str = _format_time(start_time)

    doc_label = f" with Dr. {doctor_name}" if doctor_name else ""
    patient_notif = create_notification(
        db,
        recipient_user_id=patient_user_id,
        notification_type="appointment.booked",
        title="Consultation Confirmed",
        message=f"Your appointment{doc_label} has been confirmed for {date_str} at {time_str}.",
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/patient/appointments",
        idempotency_key=f"appt_booked_{appointment_id}_{patient_user_id}",
        recipient_role="patient",
    )

    doctor_notif = create_notification(
        db,
        recipient_user_id=doctor_user_id,
        notification_type="appointment.booked",
        title="New Appointment Scheduled",
        message=f"A patient has scheduled a consultation for {date_str} at {time_str}.",
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/doctor/appointments",
        idempotency_key=f"appt_booked_{appointment_id}_{doctor_user_id}",
        recipient_role="doctor",
    )

    return patient_notif, doctor_notif


def notify_appointment_cancelled(
    db: Session,
    *,
    appointment_id: UUID,
    appointment_date,
    start_time,
    patient_user_id: UUID,
    doctor_user_id: UUID,
    cancelled_by: str = "patient",
) -> tuple[Notification | None, Notification | None]:
    """Generates dual notifications for appointment cancellation.

    Supports cancellation initiated by either the patient or the doctor.
    Zero PHI is included in title or message.
    """
    date_str = _format_date(appointment_date)
    time_str = _format_time(start_time)

    if cancelled_by == "doctor":
        patient_message = (
            f"Your consultation scheduled for {date_str} at {time_str} has been cancelled by the doctor."
        )
        doctor_message = (
            f"The consultation scheduled for {date_str} at {time_str} has been cancelled."
        )
    else:
        patient_message = f"Your consultation scheduled for {date_str} has been cancelled."
        doctor_message = (
            f"The consultation scheduled for {date_str} at {time_str} has been cancelled by the patient."
        )

    patient_notif = create_notification(
        db,
        recipient_user_id=patient_user_id,
        notification_type="appointment.cancelled",
        title="Appointment Cancelled",
        message=patient_message,
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/patient/appointments",
        idempotency_key=f"appt_cancelled_{appointment_id}_{patient_user_id}",
        recipient_role="patient",
    )

    doctor_notif = create_notification(
        db,
        recipient_user_id=doctor_user_id,
        notification_type="appointment.cancelled",
        title="Appointment Cancelled",
        message=doctor_message,
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/doctor/appointments",
        idempotency_key=f"appt_cancelled_{appointment_id}_{doctor_user_id}",
        recipient_role="doctor",
    )

    return patient_notif, doctor_notif


def _resolve_reschedule_idempotency_key(
    db: Session,
    appointment_id: UUID,
    recipient_user_id: UUID,
    new_date,
    new_start_time,
    event_id: str | None = None,
    revision: int | None = None,
) -> str:
    """Computes a stable, monotonic idempotency key for an appointment rescheduling transition.

    Guarantees:
    1. Retrying the same event produces the exact same key, preventing duplicate notifications.
    2. Genuinely new transitions advance to the next revision number.
    3. Cycling transitions (A -> B -> A) produce distinct revision keys (e.g., rev1 vs rev2).
    """
    iso_date = str(new_date)
    iso_time = str(new_start_time).replace(":", "")[:4]

    if event_id:
        return f"appt_rescheduled_{appointment_id}_{event_id}_{recipient_user_id}"

    if revision is not None:
        return f"appt_rescheduled_{appointment_id}_rev{revision}_{recipient_user_id}"

    existing_notifs = (
        db.query(Notification)
        .filter(
            Notification.related_entity_type == "appointment",
            Notification.related_entity_id == str(appointment_id),
            Notification.notification_type == "appointment.rescheduled",
            Notification.recipient_user_id == recipient_user_id,
        )
        .order_by(Notification.created_at.asc())
        .all()
    )

    slot_suffix = f"_{iso_date}_{iso_time}_{recipient_user_id}"

    if existing_notifs:
        latest = existing_notifs[-1]
        if latest.idempotency_key and latest.idempotency_key.endswith(slot_suffix):
            return latest.idempotency_key

        next_rev = len(existing_notifs) + 1
        return f"appt_rescheduled_{appointment_id}_rev{next_rev}_{iso_date}_{iso_time}_{recipient_user_id}"

    return f"appt_rescheduled_{appointment_id}_rev1_{iso_date}_{iso_time}_{recipient_user_id}"


def notify_appointment_rescheduled(
    db: Session,
    *,
    appointment_id: UUID,
    new_date,
    new_start_time,
    patient_user_id: UUID,
    doctor_user_id: UUID,
    event_id: str | None = None,
    revision: int | None = None,
) -> tuple[Notification | None, Notification | None]:
    """Generates dual notifications for appointment rescheduling.

    Uses a stable, monotonic appointment transition revision so:
    - Retrying the same event produces identical idempotency keys (no duplicate notifications).
    - Genuinely new rescheduling events advance the revision.
    - Rescheduling A -> B -> A produces distinct notifications for each transition.
    """
    date_str = _format_date(new_date)
    time_str = _format_time(new_start_time)

    patient_key = _resolve_reschedule_idempotency_key(
        db,
        appointment_id=appointment_id,
        recipient_user_id=patient_user_id,
        new_date=new_date,
        new_start_time=new_start_time,
        event_id=event_id,
        revision=revision,
    )

    doctor_key = _resolve_reschedule_idempotency_key(
        db,
        appointment_id=appointment_id,
        recipient_user_id=doctor_user_id,
        new_date=new_date,
        new_start_time=new_start_time,
        event_id=event_id,
        revision=revision,
    )

    patient_notif = create_notification(
        db,
        recipient_user_id=patient_user_id,
        notification_type="appointment.rescheduled",
        title="Appointment Rescheduled",
        message=f"Your consultation has been rescheduled to {date_str} at {time_str}.",
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/patient/appointments",
        idempotency_key=patient_key,
        recipient_role="patient",
    )

    doctor_notif = create_notification(
        db,
        recipient_user_id=doctor_user_id,
        notification_type="appointment.rescheduled",
        title="Appointment Rescheduled",
        message=f"A consultation has been rescheduled to {date_str} at {time_str}.",
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/doctor/appointments",
        idempotency_key=doctor_key,
        recipient_role="doctor",
    )

    return patient_notif, doctor_notif


def notify_appointment_completed(
    db: Session,
    *,
    appointment_id: UUID,
    appointment_date,
    patient_user_id: UUID,
    doctor_name: str | None = None,
) -> Notification | None:
    """Generates a deduplicated, Zero-PHI patient notification upon consultation completion."""
    date_str = _format_date(appointment_date)
    doc_label = f" with Dr. {doctor_name}" if doctor_name else ""
    return create_notification(
        db,
        recipient_user_id=patient_user_id,
        notification_type="appointment.completed",
        title="Consultation Completed",
        message=f"Your consultation{doc_label} on {date_str} has been completed. Your visit summary is now available.",
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/patient/records",
        idempotency_key=f"appt_completed_{appointment_id}_{patient_user_id}",
        recipient_role="patient",
    )


def notify_prescription_issued(
    db: Session,
    *,
    prescription_id: UUID,
    patient_user_id: UUID,
    doctor_name: str | None = None,
) -> Notification | None:
    """Generates patient notification when a digital prescription is issued.
    Strict Zero PHI: zero medicine names, dosages, or diagnoses stored in notification.
    """
    doc_label = f"Dr. {doctor_name}" if doctor_name else "Your doctor"
    return create_notification(
        db,
        recipient_user_id=patient_user_id,
        notification_type="prescription.issued",
        title="New Prescription Available",
        message=f"{doc_label} has issued a digital prescription for your consultation.",
        related_entity_type="prescription",
        related_entity_id=str(prescription_id),
        safe_action_path="/patient/prescriptions",
        idempotency_key=f"rx_issued_{prescription_id}_{patient_user_id}",
        recipient_role="patient",
    )


def notify_doctor_onboarded(
    db: Session,
    *,
    doctor_profile_id: UUID,
    doctor_user_id: UUID,
    admin_user_id: UUID,
    doctor_name: str,
) -> tuple[Notification | None, Notification | None]:
    """Generates notifications when a new doctor is created by an admin."""
    doctor_notif = create_notification(
        db,
        recipient_user_id=doctor_user_id,
        notification_type="doctor.application.received",
        title="Doctor Profile Created",
        message="Your practitioner profile has been created and is pending administrative credential review.",
        related_entity_type="doctor_profile",
        related_entity_id=str(doctor_profile_id),
        safe_action_path="/doctor/profile",
        idempotency_key=f"doc_onboard_doc_{doctor_profile_id}_{doctor_user_id}",
        recipient_role="doctor",
    )

    admin_notif = create_notification(
        db,
        recipient_user_id=admin_user_id,
        notification_type="doctor.onboarded",
        title="Practitioner Pending Verification",
        message=f"Dr. {doctor_name} has registered and requires medical credential review.",
        related_entity_type="doctor_profile",
        related_entity_id=str(doctor_profile_id),
        safe_action_path="/admin/doctors",
        idempotency_key=f"doc_onboard_admin_{doctor_profile_id}_{admin_user_id}",
        recipient_role="admin",
    )

    return doctor_notif, admin_notif


def notify_doctor_verification_status(
    db: Session,
    *,
    doctor_profile_id: UUID,
    doctor_user_id: UUID,
    target_status: str,
    reason: str | None = None,
) -> Notification | None:
    """Generates doctor notification when their verification status is updated by an admin."""
    if target_status == "approved":
        title = "Practice Verification Approved"
        message = "Your medical license has been verified. You may now publish your availability and receive patients."
        action_path = "/doctor/availability"
    elif target_status == "rejected":
        title = "Verification Status Update"
        message = "Your practitioner verification application could not be approved at this time. Please contact administrator support or check your profile."
        action_path = "/doctor/profile"
    elif target_status == "suspended":
        title = "Practice Clearance Suspended"
        message = "Your clinical practice clearance has been temporarily suspended. Please contact administrator support for further details."
        action_path = "/doctor/profile"
    else:
        title = "Verification Status Updated"
        message = f"Your practitioner verification status has been updated to {target_status}."
        action_path = "/doctor/profile"

    now_bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    return create_notification(
        db,
        recipient_user_id=doctor_user_id,
        notification_type=f"doctor.verification.{target_status}",
        title=title,
        message=message,
        related_entity_type="doctor_profile",
        related_entity_id=str(doctor_profile_id),
        safe_action_path=action_path,
        idempotency_key=f"doc_verif_{doctor_profile_id}_{target_status}_{now_bucket}",
        recipient_role="doctor",
    )


def notify_reschedule_proposed(
    db: Session,
    *,
    appointment_id: UUID,
    proposal_id: UUID,
    proposed_date,
    proposed_start_time,
    patient_user_id: UUID,
    doctor_name: str | None = None,
) -> Notification | None:
    """Generates patient notification when a doctor proposes an alternate appointment time."""
    date_str = _format_date(proposed_date)
    time_str = _format_time(proposed_start_time)
    doc_label = f"Dr. {doctor_name}" if doctor_name else "Your doctor"

    return create_notification(
        db,
        recipient_user_id=patient_user_id,
        notification_type="appointment.reschedule_proposed",
        title="Reschedule Proposed",
        message=f"{doc_label} has proposed rescheduling your consultation to {date_str} at {time_str}. Please review and respond.",
        related_entity_type="appointment",
        related_entity_id=str(appointment_id),
        safe_action_path="/patient/appointments",
        idempotency_key=f"reschedule_proposed_{proposal_id}_{patient_user_id}",
        recipient_role="patient",
    )


def notify_reschedule_response(
    db: Session,
    *,
    appointment_id: UUID,
    proposal_id: UUID,
    action: str,
    doctor_user_id: UUID,
    patient_user_id: UUID,
    patient_name: str | None = None,
    proposed_date=None,
    proposed_start_time=None,
    original_date=None,
    original_start_time=None,
) -> tuple[Notification | None, Notification | None]:
    """Generates notifications when a patient responds (accepts or declines) to a reschedule proposal."""
    pat_label = patient_name or "A patient"

    if action == "accept":
        date_str = _format_date(proposed_date)
        time_str = _format_time(proposed_start_time)

        doctor_notif = create_notification(
            db,
            recipient_user_id=doctor_user_id,
            notification_type="appointment.rescheduled",
            title="Reschedule Accepted",
            message=f"{pat_label} has accepted the proposed reschedule for {date_str} at {time_str}.",
            related_entity_type="appointment",
            related_entity_id=str(appointment_id),
            safe_action_path="/doctor/appointments",
            idempotency_key=f"reschedule_accepted_doc_{proposal_id}_{doctor_user_id}",
            recipient_role="doctor",
        )

        patient_notif = create_notification(
            db,
            recipient_user_id=patient_user_id,
            notification_type="appointment.rescheduled",
            title="Appointment Rescheduled",
            message=f"Your consultation has been rescheduled to {date_str} at {time_str}.",
            related_entity_type="appointment",
            related_entity_id=str(appointment_id),
            safe_action_path="/patient/appointments",
            idempotency_key=f"reschedule_accepted_pat_{proposal_id}_{patient_user_id}",
            recipient_role="patient",
        )

        return doctor_notif, patient_notif

    else:
        orig_date_str = _format_date(original_date)
        orig_time_str = _format_time(original_start_time)

        doctor_notif = create_notification(
            db,
            recipient_user_id=doctor_user_id,
            notification_type="appointment.reschedule_declined",
            title="Reschedule Declined",
            message=f"{pat_label} declined the proposed reschedule. The original consultation remains on {orig_date_str} at {orig_time_str}.",
            related_entity_type="appointment",
            related_entity_id=str(appointment_id),
            safe_action_path="/doctor/appointments",
            idempotency_key=f"reschedule_declined_doc_{proposal_id}_{doctor_user_id}",
            recipient_role="doctor",
        )

        return doctor_notif, None


def format_practitioner_title(name: str | None, fallback: str = "Your practitioner") -> str:
    """Idempotently formats a doctor's display name to ensure exactly one title/honorific.

    Rules:
    - If name is None, empty, or whitespace, returns fallback (default: 'Your practitioner').
    - Trims surrounding whitespace.
    - If the name already begins with 'Dr.', 'Dr', or 'Doctor' (case-insensitive),
      the trimmed name is returned without prepending an additional title.
    - Otherwise, prepends 'Dr. ' to the trimmed name.
    """
    if not name:
        return fallback
    trimmed = name.strip()
    if not trimmed:
        return fallback

    if re.match(r"^(?:dr\.?|doctor)\s+", trimmed, flags=re.IGNORECASE):
        return trimmed
    return f"Dr. {trimmed}"


def notify_consent_requested(
    db: Session,
    *,
    request_id: UUID,
    patient_user_id: UUID,
    doctor_name: str | None = None,
) -> Notification | None:
    """Generates patient notification when an approved doctor requests EHR consent.

    Preserves privacy: title and message contain only practitioner identification and action request;
    zero protected health information (PHI) or requested clinical scope details are included.
    """
    doc_label = format_practitioner_title(doctor_name, "Your practitioner")

    return create_notification(
        db,
        recipient_user_id=patient_user_id,
        notification_type="consent.requested",
        title="EHR Consent Requested",
        message=f"{doc_label} has requested access to your health records for clinical consultation. Please review and respond.",
        related_entity_type="consent_request",
        related_entity_id=str(request_id),
        safe_action_path="/patient/consent",
        idempotency_key=f"consent_req_{request_id}_{patient_user_id}",
        recipient_role="patient",
    )


def notify_consent_response(
    db: Session,
    *,
    request_id: UUID,
    action: str,
    doctor_user_id: UUID,
    patient_name: str | None = None,
    is_partial: bool = False,
) -> Notification | None:
    """Generates doctor notification when a patient responds (approves, partially approves, or declines) to a consent request.

    Preserves privacy: zero health information or specific clinical values are transmitted.
    """
    pat_label = patient_name or "A patient"

    if action == "approve":
        title = "EHR Consent Approved" if not is_partial else "EHR Consent Partially Approved"
        message = (
            f"{pat_label} has approved your request to access their health records."
            if not is_partial
            else f"{pat_label} has partially approved your health records consent request for selected categories."
        )
        notif_type = "consent.approved"
        idemp_prefix = "consent_resp_app"
    else:
        title = "EHR Consent Declined"
        message = f"{pat_label} has declined your request to access their health records."
        notif_type = "consent.declined"
        idemp_prefix = "consent_resp_dec"

    return create_notification(
        db,
        recipient_user_id=doctor_user_id,
        notification_type=notif_type,
        title=title,
        message=message,
        related_entity_type="consent_request",
        related_entity_id=str(request_id),
        safe_action_path="/doctor/patients",
        idempotency_key=f"{idemp_prefix}_{request_id}_{doctor_user_id}",
        recipient_role="doctor",
    )


