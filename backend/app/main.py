import io
import json
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from . import domains as domains_mod
from . import export as export_mod
from . import extraction, graph, hypotheses as hyp, ingest, rag
from . import sessions as sessions_mod
from .config import FEEDBACK_FILE, UPLOADS_DIR, settings
from .schemas import (
    ExportRequest,
    FeedbackRequest,
    GenerateRequest,
    HypothesisUpdate,
    SessionCreate,
    SessionRename,
)

app = FastAPI(title="Фабрика гипотез", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "demo_mode": settings.is_demo,
        "model": settings.llm_model if not settings.is_demo else None,
        "graph_backend": graph.store.backend,
    }


@app.get("/api/domains")
def list_domains():
    return {"domains": domains_mod.list_domains()}


@app.post("/api/documents")
async def upload_documents(
    files: list[UploadFile] = File(...),
    domain: str = Form("mineral_processing"),
):
    domain_pack = domains_mod.get(domain)
    results = []
    for f in files:
        data = await f.read()
        filename = f.filename or "unnamed"
        try:
            text = ingest.extract_text(filename, data)
        except Exception as e:
            results.append({"filename": filename, "error": f"Ошибка парсинга: {e}"})
            continue
        chunks = ingest.chunk_text(text)
        if not chunks:
            results.append({"filename": filename, "error": "Не удалось извлечь текст"})
            continue
        doc_id = uuid.uuid4().hex[:8]
        (UPLOADS_DIR / f"{doc_id}_{filename}").write_bytes(data)
        entry = rag.add_document(doc_id, filename, chunks)
        # граф знаний: сущности + связи из чанков документа
        entities, relations = extraction.extract_from_chunks(chunks, domain_pack)
        graph.store.add_entities(entities, doc_id)
        graph.store.add_relations(relations, doc_id)
        entry["entities"] = len(entities)
        results.append(entry)
    return {"documents": results}


@app.get("/api/documents")
def list_documents():
    return {"documents": rag.list_documents()}


@app.get("/api/documents/{doc_id}/file")
def get_document_file(doc_id: str):
    """Отдаёт исходный файл — цитаты в карточках гипотез ссылаются сюда."""
    matches = list(UPLOADS_DIR.glob(f"{doc_id}_*"))
    if not matches:
        raise HTTPException(404, "Файл не найден")
    path = matches[0]
    filename = path.name[len(doc_id) + 1 :]
    return FileResponse(
        path,
        filename=filename,
        content_disposition_type="inline",
    )


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    rag.delete_document(doc_id)
    graph.store.remove_document(doc_id)
    for p in UPLOADS_DIR.glob(f"{doc_id}_*"):
        p.unlink(missing_ok=True)
    return {"ok": True}


@app.get("/api/graph")
def get_graph(max_nodes: int = 120):
    return graph.store.snapshot(max_nodes=max_nodes)


@app.post("/api/generate")
def generate(req: GenerateRequest):
    if not req.goal.strip():
        raise HTTPException(400, "Укажите целевую проблему")
    # в треде уточняющие запросы наследуют контекст предыдущих ходов:
    # «без замены оборудования» само по себе не содержит доменных терминов
    prior_goals: list[str] = []
    if req.session_id:
        session = sessions_mod.get(req.session_id)
        if session:
            prior_goals = [t["request"]["goal"] for t in session["turns"][-2:]]
    query = "\n".join([*prior_goals, req.goal, req.constraints]).strip()
    retrieved = rag.search(query, k=8)
    try:
        hypotheses = hyp.generate(req, retrieved, context_query=query, prior_goals=prior_goals)
    except hyp.NoKnowledgeError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(502, f"Ошибка генерации (проверьте LLM-настройки в .env): {e}")
    session, turn = sessions_mod.add_turn(
        req.session_id,
        {
            "goal": req.goal,
            "constraints": req.constraints,
            "excluded": req.excluded,
            "domain": req.domain,
            "n_hypotheses": req.n_hypotheses,
            "weights": req.weights,
        },
        hypotheses,
    )
    return {
        "hypotheses": hypotheses,
        "retrieved_count": len(retrieved),
        "demo_mode": settings.is_demo,
        "session_id": session["id"],
        "turn_id": turn["id"],
    }


# ---------------------------------------------------------------------------
# Сессии (треды генераций)
# ---------------------------------------------------------------------------


@app.get("/api/sessions")
def list_sessions():
    return {"sessions": sessions_mod.list_sessions()}


@app.post("/api/sessions")
def create_session(req: SessionCreate):
    return sessions_mod.create(req.title)


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    session = sessions_mod.get(session_id)
    if session is None:
        raise HTTPException(404, "Сессия не найдена")
    return session


@app.patch("/api/sessions/{session_id}")
def rename_session(session_id: str, req: SessionRename):
    if not sessions_mod.rename(session_id, req.title):
        raise HTTPException(404, "Сессия не найдена")
    return {"ok": True}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    sessions_mod.delete(session_id)
    return {"ok": True}


@app.patch("/api/sessions/{session_id}/hypotheses/{hypothesis_id}")
def update_hypothesis(session_id: str, hypothesis_id: str, req: HypothesisUpdate):
    ok = sessions_mod.patch_hypothesis(
        session_id, hypothesis_id, req.model_dump(exclude_none=True)
    )
    if not ok:
        raise HTTPException(404, "Гипотеза не найдена в сессии")
    return {"ok": True}


@app.post("/api/feedback")
def feedback(req: FeedbackRequest):
    entries = []
    if FEEDBACK_FILE.exists():
        entries = json.loads(FEEDBACK_FILE.read_text(encoding="utf-8"))
    entries.append(
        {
            "hypothesis_id": req.hypothesis_id,
            "title": req.title,
            "verdict": req.verdict,
            "comment": req.comment,
            "at": datetime.now(timezone.utc).isoformat(),
        }
    )
    FEEDBACK_FILE.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True, "total": len(entries)}


_EXPORTERS = {
    "json": (export_mod.to_json, "application/json"),
    "csv": (export_mod.to_csv, "text/csv"),
    "docx": (
        export_mod.to_docx,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
}


@app.post("/api/export")
def export(req: ExportRequest):
    if req.format not in _EXPORTERS:
        raise HTTPException(400, f"Неизвестный формат: {req.format}")
    fn, media_type = _EXPORTERS[req.format]
    data = fn(req.goal, req.hypotheses)
    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="hypotheses.{req.format}"'
        },
    )
