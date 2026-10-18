import logging
import json
import os
import re
from typing import Optional
from fastapi import Request, HTTPException, Depends
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select
from db import get_session
from db_models import User, GroupMember, Group

logger = logging.getLogger("debt_settle.auth")

DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"

def initialize_firebase(
    dev_mode: bool,
    credential_path: str,
    credential_json: str
) -> bool:
    if not credential_path and not credential_json:
        if dev_mode:
            return False
        raise RuntimeError(
            "Firebase Admin could not be initialized; configure a valid "
            "FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON."
        )

    try:
        import firebase_admin
        from firebase_admin import credentials

        if firebase_admin._apps:
            return True
        if credential_json:
            credential = credentials.Certificate(json.loads(credential_json))
        elif credential_path:
            credential = credentials.Certificate(credential_path)
        else:
            raise ValueError("Firebase service account credentials are not configured")

        firebase_admin.initialize_app(credential)
        return True
    except Exception as exc:
        logger.exception("Firebase Admin initialization failed")
        if dev_mode:
            return False
        raise RuntimeError(
            "Firebase Admin could not be initialized; configure a valid "
            "FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON."
        ) from exc


_firebase_initialized = initialize_firebase(
    DEV_MODE,
    os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", ""),
    os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
)


def _get_or_create_dev_user(session: Session, dev_identifier: str) -> User:
    """Helper to auto-resolve or create test users in development mode."""
    dev_identifier = dev_identifier.strip()
    
    # Try by numeric id first if digit
    if dev_identifier.isdigit():
        user = session.get(User, int(dev_identifier))
        if user:
            return user
            
    # Try by username or email
    user = session.exec(select(User).where(
        (User.username == dev_identifier) | (User.email == dev_identifier)
    )).first()
    
    if not user:
        # Create a new dev user
        username = dev_identifier.replace(" ", "_").lower()
        email = f"{username}@example.com" if "@" not in username else username
        if "@" in username:
            username = username.split("@")[0]
            
        user = User(
            firebase_uid=f"dev_{username}",
            email=email,
            username=username,
            username_confirmed=True
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        
    return user


async def get_current_user(
    request: Request,
    session: Session = Depends(get_session)
) -> User:
    """
    Derives the authenticated User strictly server-side.
    In DEV_MODE: accepts 'X-Dev-User-Id' or 'X-Dev-Username' or Bearer dev_<name>.
    In Production / Firebase Auth: verifies Firebase JWT ID token.
    """
    # 1. Check for Dev Headers
    dev_user_id = request.headers.get("X-Dev-User-Id") or request.headers.get("X-Dev-Username")
    if DEV_MODE and dev_user_id:
        return _get_or_create_dev_user(session, dev_user_id)

    # 2. Check Authorization Header
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        # In dev mode, default fallback if none specified
        if DEV_MODE:
            return _get_or_create_dev_user(session, "dev_admin")
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header.split("Bearer ")[1].strip()

    # Dev token fallback in dev mode
    if DEV_MODE and token.startswith("dev_"):
        dev_name = token[4:]
        return _get_or_create_dev_user(session, dev_name)

    # 3. Verify the Firebase token. ONLY the verification is inside this try:
    #    database problems must never be reported as "bad token", and no
    #    exception text may ever reach the client.
    if not _firebase_initialized:
        logger.error("A real sign-in token arrived but Firebase Admin is not initialized")
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in")

    try:
        from firebase_admin import auth as fb_auth
        decoded_token = fb_auth.verify_id_token(token)
    except Exception as e:
        logger.warning("Firebase token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in")

    if not decoded_token.get("email_verified", False):
        raise HTTPException(status_code=403, detail="Email is not verified in Firebase")

    uid = decoded_token.get("uid") or decoded_token.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in")
    email = (decoded_token.get("email") or "").strip().lower()

    return _provision_user(session, uid, email)


def _find_existing_user(session: Session, uid: str, email: str) -> Optional[User]:
    """Find the user for this Firebase uid, or link a matching-email account to it."""
    user = session.exec(select(User).where(User.firebase_uid == uid)).first()
    if user:
        return user
    if email:
        user = session.exec(select(User).where(User.email == email)).first()
        if user:
            user.firebase_uid = uid
            session.add(user)
            session.commit()
            session.refresh(user)
            return user
    return None


def _claim_pending_invites(session: Session, user: User, email: str) -> None:
    """Turn pending email invites for this address into real memberships."""
    from db_models import Invite
    from membership import add_member_idempotent

    if not email:
        return
    pending = session.exec(
        select(Invite).where(Invite.invited_email == email, Invite.status == "pending")
    ).all()
    for inv in pending:
        add_member_idempotent(session, inv.group_id, user.id)
        inv.status = "accepted"
        session.add(inv)
    session.commit()


def _provision_user(session: Session, uid: str, email: str) -> User:
    """Return the user for a verified Firebase identity, creating them on first login.

    Safe when the browser fires several requests at once right after login:
    if another request creates the same user first, we use theirs.
    """
    user = _find_existing_user(session, uid, email)
    if user:
        return user

    # First-time sign-in: suggest a valid username ([a-z0-9_]{3,20}); the
    # person confirms or edits it on the "Choose your username" screen.
    raw_base = email.split("@")[0] if email else f"user_{uid[:6]}"
    base_name = re.sub(r"[^a-z0-9_]", "_", raw_base.lower())[:15]
    if len(base_name) < 3:
        base_name = f"user_{uid[:6].lower()}"

    for attempt in range(25):
        candidate = base_name if attempt == 0 else f"{base_name[:12]}_{attempt}"
        user = User(
            firebase_uid=uid,
            email=email or f"{candidate}@example.com",
            username=candidate,
            username_confirmed=False,
        )
        session.add(user)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            # A parallel request may have just created this very person.
            existing = _find_existing_user(session, uid, email)
            if existing:
                return existing
            continue  # the username was taken in the meantime: try the next one
        session.refresh(user)
        _claim_pending_invites(session, user, email)
        return user

    raise HTTPException(status_code=503, detail="Could not create your account. Please try again.")


def get_group_membership(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
) -> GroupMember:
    """Verifies that the current authenticated user is an active member of the group."""
    member = session.exec(select(GroupMember).where(
        GroupMember.group_id == group_id,
        GroupMember.user_id == current_user.id,
        GroupMember.active == True
    )).first()

    if not member:
        raise HTTPException(status_code=403, detail="You are not a member of this group")

    return member


def require_group_admin(
    group_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
) -> GroupMember:
    """Verifies that the current authenticated user is an admin of the group."""
    member = get_group_membership(group_id, current_user, session)
    if not member.is_admin:
        raise HTTPException(status_code=403, detail="Only the group admin can perform this action")
    return member
