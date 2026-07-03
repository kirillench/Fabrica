import json
import threading
from datetime import datetime, timezone

import chromadb

from .config import CHROMA_DIR, DOCUMENTS_FILE

_lock = threading.Lock()
_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
_collection = _client.get_or_create_collection(
    "knowledge", metadata={"hnsw:space": "cosine"}
)


def _load_registry() -> list[dict]:
    if DOCUMENTS_FILE.exists():
        return json.loads(DOCUMENTS_FILE.read_text(encoding="utf-8"))
    return []


def _save_registry(docs: list[dict]) -> None:
    DOCUMENTS_FILE.write_text(
        json.dumps(docs, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def add_document(doc_id: str, filename: str, chunks: list[str]) -> dict:
    with _lock:
        _collection.add(
            ids=[f"{doc_id}:{i}" for i in range(len(chunks))],
            documents=chunks,
            metadatas=[
                {"doc_id": doc_id, "filename": filename, "chunk": i}
                for i in range(len(chunks))
            ],
        )
        entry = {
            "id": doc_id,
            "filename": filename,
            "chunks": len(chunks),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        docs = _load_registry()
        docs.append(entry)
        _save_registry(docs)
    return entry


def delete_document(doc_id: str) -> None:
    with _lock:
        _collection.delete(where={"doc_id": doc_id})
        _save_registry([d for d in _load_registry() if d["id"] != doc_id])


def list_documents() -> list[dict]:
    return _load_registry()


def search(query: str, k: int = 8) -> list[dict]:
    """Семантический поиск по базе знаний. Возвращает чанки с метаданными."""
    if _collection.count() == 0:
        return []
    res = _collection.query(
        query_texts=[query], n_results=min(k, _collection.count())
    )
    out: list[dict] = []
    for text, meta, dist in zip(
        res["documents"][0], res["metadatas"][0], res["distances"][0]
    ):
        out.append(
            {
                "text": text,
                "filename": meta["filename"],
                "doc_id": meta["doc_id"],
                "chunk": meta["chunk"],
                "relevance": round(1 - dist, 3),
            }
        )
    return out
