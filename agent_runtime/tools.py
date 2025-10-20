"""Tool definition helpers for the agent runtime."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .config_service import ConfigService
from .tool_registry import (
    SQLExecutionTool,
    ToolDefinition,
    ToolRegistry,
    create_sqlalchemy_tool,
)

try:  # pragma: no cover - pandas is optional at runtime
    import pandas as pd  # type: ignore
except Exception:  # pragma: no cover - pandas is optional at runtime
    pd = None  # type: ignore


@dataclass
class _SchemaInspectionHandler:
    config_service: ConfigService
    sql_tool: SQLExecutionTool

    def __call__(self, _: Mapping[str, Any]) -> Dict[str, Any]:
        config = self.config_service.get_config()
        if not config:
            raise RuntimeError("Runtime configuration is empty.")
        schema = self.sql_tool.get_schema(config)
        return {"schema": schema}


@dataclass
class _RunSQLHandler:
    config_service: ConfigService
    sql_tool: SQLExecutionTool

    def __call__(self, params: Mapping[str, Any]) -> Dict[str, Any]:
        query = params.get("sql") or params.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ValueError("The 'sql' parameter must be a non-empty string.")

        config = self.config_service.get_config()
        if not config:
            raise RuntimeError("Runtime configuration is empty.")

        result = self.sql_tool.run_query(config, query)
        if isinstance(result, str):
            raise RuntimeError(result)

        rows, columns = _normalize_tabular_result(result)
        return {"rows": rows, "columns": columns}


@dataclass
class _SummarizeResultsHandler:
    def __call__(self, params: Mapping[str, Any]) -> Dict[str, Any]:
        rows = params.get("rows")
        columns = params.get("columns")

        if not isinstance(rows, Sequence):
            rows = []
        if not isinstance(columns, Sequence):
            columns = []

        rows_list: List[Any] = list(rows)
        columns_list: List[str] = [str(column) for column in columns]

        if not rows_list:
            return {"summary": "No rows returned."}

        first_row = rows_list[0]
        if isinstance(first_row, Mapping):
            if not columns_list:
                columns_list = [str(key) for key in first_row.keys()]
            sample_columns = columns_list[:5]
            sample_details = ", ".join(
                f"{column}={first_row.get(column)!r}" for column in sample_columns
            )
        else:
            sample_columns = ["value"]
            columns_list = columns_list or sample_columns
            sample_details = repr(first_row)

        row_count = len(rows_list)
        column_count = len(columns_list)

        parts = [
            f"{row_count} row{'s' if row_count != 1 else ''} returned",
            f"{column_count} column{'s' if column_count != 1 else ''} ({', '.join(columns_list[:5])})",
            f"Sample: {sample_details}",
        ]
        return {"summary": ". ".join(parts)}


def _normalize_tabular_result(result: Any) -> Tuple[List[Dict[str, Any]], List[str]]:
    if pd is not None and isinstance(result, pd.DataFrame):
        columns = [str(column) for column in result.columns]
        rows = [
            {str(key): value for key, value in row.items()}
            for row in result.to_dict(orient="records")
        ]
        return rows, columns

    if isinstance(result, Sequence) and not isinstance(result, (str, bytes, bytearray)):
        rows_sequence: Sequence[Any] = result
        if not rows_sequence:
            return [], []
        first_item = rows_sequence[0]
        if isinstance(first_item, Mapping):
            columns = sorted({str(key) for row in rows_sequence for key in row.keys()})
            normalized_rows = [
                {column: row.get(column) for column in columns}
                for row in rows_sequence
            ]
            return normalized_rows, columns
        columns = ["value"]
        normalized_rows = [{"value": item} for item in rows_sequence]
        return normalized_rows, columns

    return ([{"value": result}], ["value"])


def register_default_tools(
    *,
    config_service: ConfigService,
    registry: ToolRegistry,
    sql_tool: Optional[SQLExecutionTool] = None,
) -> None:
    """Register built-in tools for schema inspection, SQL execution and summarisation."""

    runtime_sql_tool = sql_tool or create_sqlalchemy_tool()
    registry.register("sql", runtime_sql_tool)

    registry.register_definition(
        ToolDefinition(
            name="schema_inspection",
            description="Inspect the connected database schema using the configured SQL connector.",
            input_schema={
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
            output_schema={
                "type": "object",
                "properties": {"schema": {"type": "string"}},
                "required": ["schema"],
            },
            handler=_SchemaInspectionHandler(config_service, runtime_sql_tool),
        )
    )

    registry.register_definition(
        ToolDefinition(
            name="run_sql",
            description="Execute a SQL statement against the configured database and return the rows.",
            input_schema={
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "SQL statement to execute."}
                },
                "required": ["sql"],
                "additionalProperties": False,
            },
            output_schema={
                "type": "object",
                "properties": {
                    "rows": {
                        "type": "array",
                        "items": {"type": "object"},
                    },
                    "columns": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["rows", "columns"],
            },
            handler=_RunSQLHandler(config_service, runtime_sql_tool),
        )
    )

    registry.register_definition(
        ToolDefinition(
            name="summarize_results",
            description="Provide a lightweight natural language summary for tabular query results.",
            input_schema={
                "type": "object",
                "properties": {
                    "rows": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "Tabular rows to be summarised.",
                    },
                    "columns": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional ordered list of column names.",
                    },
                },
                "required": ["rows"],
            },
            output_schema={
                "type": "object",
                "properties": {"summary": {"type": "string"}},
                "required": ["summary"],
            },
            handler=_SummarizeResultsHandler(),
        )
    )


__all__ = ["register_default_tools"]
