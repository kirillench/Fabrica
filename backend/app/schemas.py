from typing import Any

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    goal: str
    constraints: str = ""
    n_hypotheses: int = Field(default=5, ge=1, le=10)
    excluded: str = ""  # направления, которые эксперт исключил
    domain: str = "mineral_processing"  # id доменного пакета
    session_id: str | None = None  # тред; None — создать новую сессию
    weights: dict[str, float] = Field(
        default={"novelty": 0.25, "feasibility": 0.25, "impact": 0.3, "risk": 0.2}
    )


class SessionCreate(BaseModel):
    title: str = "Новая сессия"


class SessionRename(BaseModel):
    title: str


class HypothesisUpdate(BaseModel):
    roadmap: list[dict[str, Any]] | None = None
    verdict: str | None = None  # confirmed | rejected


class FeedbackRequest(BaseModel):
    hypothesis_id: str
    title: str
    verdict: str  # "confirmed" | "rejected"
    comment: str = ""


class ExportRequest(BaseModel):
    format: str  # "docx" | "json" | "csv"
    goal: str = ""
    hypotheses: list[dict[str, Any]] = []
