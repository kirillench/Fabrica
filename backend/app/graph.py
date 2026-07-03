"""Граф знаний: сущности (материалы, процессы, параметры, свойства...)
и связи между ними, извлечённые из базы знаний.

Два хранилища за одним интерфейсом:
- Neo4jGraphStore — промышленный вариант (настройки в .env)
- LocalGraphStore — встроенный fallback (networkx + JSON), ноль инфраструктуры

Выбор происходит автоматически при старте: если Neo4j доступен — он,
иначе локальный. Ядро системы от выбора хранилища не зависит.
"""

import json
import threading

import networkx as nx

from .config import DATA_DIR, settings

GRAPH_FILE = DATA_DIR / "graph.json"


class LocalGraphStore:
    """Встроенное хранилище на networkx с персистентностью в JSON."""

    backend = "local"

    def __init__(self):
        self._lock = threading.Lock()
        self._g = nx.Graph()
        if GRAPH_FILE.exists():
            data = json.loads(GRAPH_FILE.read_text(encoding="utf-8"))
            self._g = nx.node_link_graph(data, edges="edges")

    def _save(self):
        data = nx.node_link_data(self._g, edges="edges")
        GRAPH_FILE.write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )

    def add_entities(self, entities: list[dict], doc_id: str):
        """entities: [{name, type}], помечаем каждую документом-источником."""
        with self._lock:
            for e in entities:
                if self._g.has_node(e["name"]):
                    node = self._g.nodes[e["name"]]
                    node["mentions"] = node.get("mentions", 0) + 1
                    docs = set(node.get("docs", []))
                    docs.add(doc_id)
                    node["docs"] = list(docs)
                else:
                    self._g.add_node(
                        e["name"], type=e["type"], mentions=1, docs=[doc_id]
                    )
            self._save()

    def add_relations(self, relations: list[dict], doc_id: str):
        """relations: [{source, target, label?}], вес = число подтверждений."""
        with self._lock:
            for r in relations:
                if not (self._g.has_node(r["source"]) and self._g.has_node(r["target"])):
                    continue
                if self._g.has_edge(r["source"], r["target"]):
                    edge = self._g.edges[r["source"], r["target"]]
                    edge["weight"] = edge.get("weight", 1) + 1
                    if r.get("label"):
                        edge["label"] = r["label"]
                    docs = set(edge.get("docs", []))
                    docs.add(doc_id)
                    edge["docs"] = list(docs)
                else:
                    self._g.add_edge(
                        r["source"],
                        r["target"],
                        weight=1,
                        label=r.get("label", ""),
                        docs=[doc_id],
                    )
            self._save()

    def remove_document(self, doc_id: str):
        with self._lock:
            for n in list(self._g.nodes):
                docs = [d for d in self._g.nodes[n].get("docs", []) if d != doc_id]
                if docs:
                    self._g.nodes[n]["docs"] = docs
                else:
                    self._g.remove_node(n)
            for u, v in list(self._g.edges):
                docs = [d for d in self._g.edges[u, v].get("docs", []) if d != doc_id]
                if docs:
                    self._g.edges[u, v]["docs"] = docs
                elif self._g.has_edge(u, v):
                    self._g.remove_edge(u, v)
            self._save()

    def snapshot(self, max_nodes: int = 120) -> dict:
        """Срез графа для визуализации: топ узлов по числу упоминаний."""
        with self._lock:
            nodes = sorted(
                self._g.nodes(data=True),
                key=lambda x: x[1].get("mentions", 0),
                reverse=True,
            )[:max_nodes]
            keep = {n for n, _ in nodes}
            return {
                "backend": self.backend,
                "nodes": [
                    {
                        "id": n,
                        "type": d.get("type", ""),
                        "mentions": d.get("mentions", 0),
                        "docs": d.get("docs", []),
                        "degree": self._g.degree(n),
                    }
                    for n, d in nodes
                ],
                "edges": [
                    {
                        "source": u,
                        "target": v,
                        "weight": d.get("weight", 1),
                        "label": d.get("label", ""),
                    }
                    for u, v, d in self._g.edges(data=True)
                    if u in keep and v in keep
                ],
                "total_nodes": self._g.number_of_nodes(),
                "total_edges": self._g.number_of_edges(),
            }

    def neighborhood(self, names: list[str], depth: int = 1) -> list[str]:
        """Триплеты вокруг заданных сущностей — контекст для промпта LLM."""
        with self._lock:
            frontier = {n for n in names if self._g.has_node(n)}
            seen = set(frontier)
            for _ in range(depth):
                nxt = set()
                for n in frontier:
                    nxt.update(self._g.neighbors(n))
                seen |= nxt
                frontier = nxt
            triples = []
            for u, v, d in self._g.edges(seen, data=True):
                if u in seen and v in seen:
                    label = d.get("label") or "связан с"
                    tu = self._g.nodes[u].get("type", "")
                    tv = self._g.nodes[v].get("type", "")
                    triples.append(f"{u} ({tu}) —{label}→ {v} ({tv})")
            return triples[:40]


class Neo4jGraphStore:
    """Хранилище на Neo4j. Требует запущенный сервер (см. docker-compose.yml)."""

    backend = "neo4j"

    def __init__(self):
        from neo4j import GraphDatabase

        self._driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        self._driver.verify_connectivity()

    def add_entities(self, entities: list[dict], doc_id: str):
        # один UNWIND-запрос вместо запроса на каждую сущность
        with self._driver.session() as s:
            s.run(
                """
                UNWIND $rows AS row
                MERGE (n:Entity {name: row.name})
                ON CREATE SET n.type = row.type, n.mentions = 1, n.docs = [$doc]
                ON MATCH SET n.mentions = n.mentions + 1,
                    n.docs = CASE WHEN $doc IN n.docs THEN n.docs
                             ELSE n.docs + $doc END
                """,
                rows=entities, doc=doc_id,
            )

    def add_relations(self, relations: list[dict], doc_id: str):
        with self._driver.session() as s:
            s.run(
                """
                UNWIND $rows AS row
                MATCH (a:Entity {name: row.source}), (b:Entity {name: row.target})
                MERGE (a)-[rel:RELATED]-(b)
                ON CREATE SET rel.weight = 1,
                    rel.label = coalesce(row.label, ''), rel.docs = [$doc]
                ON MATCH SET rel.weight = rel.weight + 1,
                    rel.docs = CASE WHEN $doc IN rel.docs THEN rel.docs
                               ELSE rel.docs + $doc END
                """,
                rows=relations, doc=doc_id,
            )

    def remove_document(self, doc_id: str):
        with self._driver.session() as s:
            s.run(
                """
                MATCH (n:Entity) WHERE $doc IN n.docs
                SET n.docs = [d IN n.docs WHERE d <> $doc]
                WITH n WHERE size(n.docs) = 0 DETACH DELETE n
                """,
                doc=doc_id,
            )

    def snapshot(self, max_nodes: int = 120) -> dict:
        with self._driver.session() as s:
            nodes = s.run(
                """
                MATCH (n:Entity)
                RETURN n.name AS id, n.type AS type, n.mentions AS mentions,
                       n.docs AS docs, COUNT { (n)--() } AS degree
                ORDER BY n.mentions DESC LIMIT $lim
                """,
                lim=max_nodes,
            ).data()
            keep = [n["id"] for n in nodes]
            edges = s.run(
                """
                MATCH (a:Entity)-[r:RELATED]-(b:Entity)
                WHERE a.name IN $keep AND b.name IN $keep AND a.name < b.name
                RETURN a.name AS source, b.name AS target,
                       r.weight AS weight, r.label AS label
                """,
                keep=keep,
            ).data()
            totals = s.run(
                "MATCH (n:Entity) OPTIONAL MATCH (n)-[r:RELATED]-() "
                "RETURN count(DISTINCT n) AS n, count(DISTINCT r) AS e"
            ).single()
            return {
                "backend": self.backend,
                "nodes": nodes,
                "edges": edges,
                "total_nodes": totals["n"],
                "total_edges": totals["e"],
            }

    def neighborhood(self, names: list[str], depth: int = 1) -> list[str]:
        with self._driver.session() as s:
            rows = s.run(
                """
                MATCH (a:Entity)-[r:RELATED]-(b:Entity)
                WHERE a.name IN $names
                RETURN a.name AS u, a.type AS tu,
                       coalesce(r.label, 'связан с') AS label,
                       b.name AS v, b.type AS tv
                LIMIT 40
                """,
                names=names,
            ).data()
            return [f"{x['u']} ({x['tu']}) —{x['label']}→ {x['v']} ({x['tv']})" for x in rows]


def _init_store():
    if settings.neo4j_uri:
        try:
            store = Neo4jGraphStore()
            print(f"[graph] Neo4j подключён: {settings.neo4j_uri}")
            return store
        except Exception as e:
            print(f"[graph] Neo4j недоступен ({e}) — переключаюсь на встроенный граф")
    return LocalGraphStore()


store = _init_store()
