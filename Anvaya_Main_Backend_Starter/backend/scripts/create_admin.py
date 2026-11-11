
import sys
from pathlib import Path
from getpass import getpass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, func

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User


db = SessionLocal()

try:
    admin_count = db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == "admin")
    ) or 0

    if admin_count > 0:
        print("An admin account already exists. No changes made.")
        raise SystemExit(0)

    full_name = input("Admin full name: ").strip()
    email = input("Admin email: ").strip().lower()

    if len(full_name) < 2:
        raise ValueError("Name must contain at least 2 characters.")

    existing_user = db.scalar(
        select(User).where(User.email == email)
    )

    if existing_user:
        raise ValueError(
            "This email already belongs to another account. "
            "Use a separate admin email."
        )

    password = getpass("Create admin password (minimum 12 characters): ")
    confirmation = getpass("Confirm admin password: ")

    if len(password) < 12:
        raise ValueError("Password must contain at least 12 characters.")

    if password != confirmation:
        raise ValueError("Passwords do not match.")

    admin = User(
        full_name=full_name,
        email=email,
        password_hash=hash_password(password),
        role="admin",
        is_active=True,
    )

    db.add(admin)
    db.commit()
    db.refresh(admin)

    print("\nADMIN ACCOUNT CREATED SUCCESSFULLY")
    print("Admin email:", admin.email)
    print("Role:", admin.role)

except Exception:
    db.rollback()
    raise

finally:
    db.close()
