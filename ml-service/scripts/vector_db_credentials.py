"""Password input for local and CI synthetic vector checks."""

import os
from getpass import getpass


def read_vector_password(
    prompt: str = "Local vector client password: ",
) -> str:
    password = os.environ.get("ML_VECTOR_DB_PASSWORD")

    if password is not None:
        if not password:
            raise RuntimeError("ML_VECTOR_DB_PASSWORD must not be empty.")
        return password

    if os.environ.get("CI", "").lower() in {"true", "1"}:
        raise RuntimeError("CI requires ML_VECTOR_DB_PASSWORD.")

    return getpass(prompt)