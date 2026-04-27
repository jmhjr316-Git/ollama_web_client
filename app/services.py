from __future__ import annotations

import sqlite3
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from .db import get_connection


BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_DIR = BASE_DIR / "workspace"
PROJECT_CONTEXT_DIR = BASE_DIR / "project_context"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
MAX_CONTEXT_FILE_SIZE = 64_000


def ensure_runtime_dirs() -> None:
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    PROJECT_CONTEXT_DIR.mkdir(parents=True, exist_ok=True)


def safe_workspace_path(filename: str) -> tuple[Path, str]:
    cleaned = filename.strip().lstrip("/").replace("\\", "/")
    if not cleaned:
        raise HTTPException(status_code=400, detail="Filename is required.")

    full_path = (WORKSPACE_DIR / cleaned).resolve()
    workspace_root = WORKSPACE_DIR.resolve()

    if workspace_root not in full_path.parents and full_path != workspace_root:
        raise HTTPException(status_code=400, detail="File path must stay inside the workspace folder.")

    return full_path, full_path.relative_to(workspace_root).as_posix()


def list_context_entries() -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    root = PROJECT_CONTEXT_DIR

    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        if not rel:
            continue
        entries.append(
            {
                "path": rel,
                "kind": "dir" if path.is_dir() else "file",
            }
        )

    return entries


def read_context_file(path_str: str) -> str:
    target = (PROJECT_CONTEXT_DIR / path_str).resolve()
    root = PROJECT_CONTEXT_DIR.resolve()

    if root not in target.parents:
        raise HTTPException(status_code=400, detail="Invalid context file path.")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Context file not found.")
    if target.stat().st_size > MAX_CONTEXT_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Context file is too large for v1.")

    try:
        return target.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Context file must be UTF-8 text.") from exc


async def fetch_models() -> list[str]:
    ollama_url = get_ollama_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{ollama_url}/api/tags")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Unable to reach Ollama at {ollama_url}.") from exc

    data = response.json()
    return [model["name"] for model in data.get("models", [])]


def build_context_block(context_files: list[str]) -> str:
    blocks: list[str] = []

    for rel_path in context_files[:10]:
        content = read_context_file(rel_path)
        blocks.append(f"FILE: {rel_path}\n{content}")

    if not blocks:
        return ""

    return (
        "Project context below is read-only. Use it for reference only and do not assume files can be executed.\n\n"
        + "\n\n".join(blocks)
    )


async def generate_reply(model: str, prompt: str, context_files: list[str]) -> str:
    context_block = build_context_block(context_files)
    final_prompt = prompt if not context_block else f"{context_block}\n\nUser request:\n{prompt}"
    ollama_url = get_ollama_url()

    payload = {
        "model": model,
        "prompt": final_prompt,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{ollama_url}/api/generate", json=payload)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama generation request failed at {ollama_url}.") from exc

    data = response.json()
    return data.get("response", "").strip()


def create_chat(conn: sqlite3.Connection, prompt: str) -> int:
    title = prompt.strip().splitlines()[0][:80] or "New chat"
    cursor = conn.execute("INSERT INTO chats (title) VALUES (?)", (title,))
    return int(cursor.lastrowid)


def add_message(conn: sqlite3.Connection, chat_id: int, role: str, content: str, model: str | None = None) -> sqlite3.Row:
    cursor = conn.execute(
        "INSERT INTO messages (chat_id, role, model, content) VALUES (?, ?, ?, ?)",
        (chat_id, role, model, content),
    )
    conn.execute("UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (chat_id,))
    message_id = int(cursor.lastrowid)
    return conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()


def log_generated_file(
    conn: sqlite3.Connection,
    chat_id: int,
    message_id: int,
    relative_path: str,
    source_prompt: str,
    content_preview: str,
    overwritten: bool,
) -> None:
    conn.execute(
        """
        INSERT INTO generated_files (chat_id, message_id, relative_path, source_prompt, content_preview, overwritten)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (chat_id, message_id, relative_path, source_prompt, content_preview[:2000], int(overwritten)),
    )


def get_workspace_root() -> str:
    return str(WORKSPACE_DIR.resolve())


def get_ollama_url() -> str:
    with get_connection() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = 'ollama_url'").fetchone()
    return row["value"] if row else DEFAULT_OLLAMA_URL


def validate_ollama_url(url: str) -> str:
    cleaned = url.strip().rstrip("/")
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Ollama URL must be a valid http:// or https:// address.")
    return cleaned


def set_ollama_url(url: str) -> str:
    cleaned = validate_ollama_url(url)
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO settings (key, value)
            VALUES ('ollama_url', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (cleaned,),
        )
        conn.commit()
    return cleaned
