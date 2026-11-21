from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ML_")

    environment: Literal[
        "development", "test", "staging", "production"
    ] = "development"
    docs_enabled: bool = True
