from __future__ import annotations

import hmac
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import get_settings
from .engine import ContextRuleEngine, ModerationInput
from .taxonomy import load_taxonomy


SourceType = Literal["search_query", "page_content", "chat_received", "chat_authored"]
Direction = Literal["unknown", "received", "authored"]
Severity = Literal["low", "medium", "high", "critical"]
Action = Literal["allow", "review", "alert"]
RiskType = Literal["none", "self_harm", "harassment", "violence"]


class ModerationItemModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1, max_length=4000)
    sourceType: SourceType
    direction: Direction = "unknown"
    context: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("id", "text")
    @classmethod
    def reject_blank_values(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be blank")
        return value

    @field_validator("context")
    @classmethod
    def validate_context(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value) > 1000 for value in values):
            raise ValueError("context items must contain 1 to 1000 characters")
        return values


class ModerationBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ModerationItemModel] = Field(min_length=1, max_length=20)

    @field_validator("items")
    @classmethod
    def require_unique_ids(
        cls, values: list[ModerationItemModel]
    ) -> list[ModerationItemModel]:
        identifiers = [item.id for item in values]
        if len(set(identifiers)) != len(identifiers):
            raise ValueError("item IDs must be unique within a batch")
        return values


class ModerationResultModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    flagged: bool
    action: Action
    riskType: RiskType
    severity: Severity
    primaryCategory: str | None
    confidence: float = Field(ge=0, le=1)
    categoryScores: dict[str, float]
    matchedSignals: list[str]


class ModerationBatchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["local"] = "local"
    model: str
    taxonomyVersion: str
    results: list[ModerationResultModel]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    provider: Literal["local"] = "local"
    engine: Literal["context_rules"] = "context_rules"
    model: str
    taxonomyVersion: str


@lru_cache(maxsize=1)
def get_engine() -> ContextRuleEngine:
    return ContextRuleEngine(model_version=get_settings().model_version)


def require_api_key(
    key: Annotated[str | None, Header(alias="X-Local-Moderation-Key")] = None,
) -> None:
    configured_key = get_settings().api_key
    if configured_key and (key is None or not hmac.compare_digest(key, configured_key)):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid local moderation credentials",
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings().validate()
    load_taxonomy()
    get_engine()
    yield


app = FastAPI(
    title="Local Text Safety Service",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def sanitized_validation_error(
    _: Request, error: RequestValidationError
) -> JSONResponse:
    errors = [
        {
            "location": list(issue.get("loc", ())),
            "message": issue.get("msg", "Invalid value"),
            "type": issue.get("type", "validation_error"),
        }
        for issue in error.errors()
    ]
    return JSONResponse(status_code=422, content={"message": "Invalid request", "errors": errors})


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    taxonomy = load_taxonomy()
    return HealthResponse(
        model=get_settings().model_version,
        taxonomyVersion=taxonomy.version,
    )


@app.get("/model-info", response_model=HealthResponse)
def model_info(_: None = Depends(require_api_key)) -> HealthResponse:
    return health()


@app.post("/v1/moderate", response_model=ModerationBatchResponse)
def moderate(
    payload: ModerationBatchRequest,
    _: None = Depends(require_api_key),
    engine: ContextRuleEngine = Depends(get_engine),
) -> ModerationBatchResponse:
    items = [
        ModerationInput(
            item_id=item.id,
            text=item.text,
            source_type=item.sourceType,
            direction=item.direction,
            context=tuple(item.context),
        )
        for item in payload.items
    ]
    return ModerationBatchResponse(
        model=engine.model_version,
        taxonomyVersion=engine.taxonomy.version,
        results=engine.moderate_batch(items),
    )
