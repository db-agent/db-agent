"""Configuration service for the agent runtime."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional
import os


@dataclass
class ConfigService:
    """Simple in-memory configuration service with optional environment export."""

    initial_config: Optional[Dict[str, Any]] = None
    _config: Dict[str, Any] = field(default_factory=dict, init=False)

    def __post_init__(self) -> None:
        if self.initial_config:
            self._config.update(self.initial_config)

    def update(self, new_config: Dict[str, Any]) -> None:
        """Update the configuration with new values."""
        if not new_config:
            return
        self._config.update({k: v for k, v in new_config.items() if v is not None})

    def get_config(self) -> Dict[str, Any]:
        """Return a copy of the current configuration."""
        return dict(self._config)

    def get(self, key: str, default: Optional[Any] = None) -> Any:
        return self._config.get(key, default)

    def export_to_env(self) -> None:
        """Export the configuration values to environment variables."""
        for key, value in self._config.items():
            if value is None:
                continue
            os.environ[key] = str(value)
