import os
from typing import Optional
from fastapi import Request, HTTPException, Depends
from sqlmodel import Session, select
from db import get_session
from db_models import User, GroupMember, Group

DEV_MODE = os.getenv("DEV_MODE", "false").lower() == "true"
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "")

# Firebase Admin SDK initialization if available and needed
_firebase_initialized = False
cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "")

if cred_path and os.path.exists(cred_path):
    try:
        import firebase_admin
        from firebase_admin import auth as fb_auth, credentials
        if not firebase_admin._apps:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        _firebase_initialized = True
    except Exception as e:
        print(f"Warning: Firebase Admin initialization failed: {e}")
elif not DEV_MODE and FIREBASE_PROJECT_ID:
    raise FileNotFoundError(
        f"FIREBASE_SERVICE_ACCOUNT_PATH is not set or the file "
        f"doesn't exist (got: '{cred_path}'). Download the key "
        f"from Firebase Console > Project settings > Service "
        f"accounts > Generate new private key, then point "
        f"FIREBASE_SERVICE_ACCOUNT_PATH at it in .env"
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
            username=username
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

    # 3. Verify Firebase Token
    if _firebase_initialized:
        try:
            import re
            from firebase_admin import auth as fb_auth
            from db_models import Invite

            decoded_token = fb_auth.verify_id_token(token)
            uid = decoded_token.get("uid")
            email = decoded_token.get("email", "")

            user = session.exec(select(User).where(User.firebase_uid == uid)).first()
            if not user and email:
                user = session.exec(select(User).where(User.email == email)).first()
                if user:
                    user.firebase_uid = uid
                    session.add(user)
                    session.commit()
                    session.refresh(user)

            if not user:
                # First-time user sign in via Firebase: sanitize username [a-z0-9_]{3,20}
                raw_base = email.split("@")[0] if email else f"user_{uid[:6]}"
                base_name = re.sub(r'[^a-z0-9_]', '_', raw_base.lower())[:15]
                if len(base_name) < 3:
                    base_name = f"user_{uid[:6].lower()}"

                candidate = base_name
                count = 1
                while session.exec(select(User).where(User.username == candidate)).first():
                    candidate = f"{base_name[:12]}_{count}"
                    count += 1

                user = User(
                    firebase_uid=uid,
                    email=email or f"{candidate}@example.com",
                    username=candidate
                )
                session.add(user)
                session.commit()
                session.refresh(user)

                # Claim any pending email invites
                if email:
                    pending_invites = session.exec(
                        select(Invite).where(Invite.invited_email == email, Invite.status == "pending")
                    ).all()
                    for inv in pending_invites:
                        existing_mem = session.exec(select(GroupMember).where(
                            GroupMember.group_id == inv.group_id, GroupMember.user_id == user.id
                        )).first()
                        if not existing_mem:
                            session.add(GroupMember(group_id=inv.group_id, user_id=user.id, is_admin=False))
                        inv.status = "accepted"
                    session.commit()

            return user
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Invalid Firebase authentication token: {str(e)}")

    raise HTTPException(status_code=401, detail="Authentication failed: Firebase Admin SDK not initialized.")


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
