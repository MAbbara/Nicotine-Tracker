"""User-related service functions.

These helpers encapsulate the creation of users and any user-specific business
logic. By separating these functions into a service layer, your route handlers
can remain slim and focus on HTTP concerns.
"""
from extensions import db

# Import the User model from the models package aggregator
from models import User

def create_user(email: str, password: str, **profile_data) -> User:
    """Create a new user with the given email and password."""
    user = User(
        email=email,
        **{k: v for k, v in profile_data.items() if v is not None}
    )
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return user
