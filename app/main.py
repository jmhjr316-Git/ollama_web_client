from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

from .db import get_connection, init_db
from .schemas import (
    ArtifactCreateRequest,
    ArtifactEntry,
    ChatCreateResponse,
    ChatDetail,
    ChatRequest,
    ChatResponse,
    ChatSummary,
    ChatUpdateRequest,
    ContextEntry,
    ContextFileResponse,
    FileDraftRequest,
    FileDraftResponse,
    GeneratedFileEntry,
    FileSaveRequest,
    FileSaveResponse,
    MessageOut,
    ModelInfo,
    SettingsResponse,
    SettingsUpdateRequest,
)
from .services import (
    add_message,
    create_chat,
    ensure_runtime_dirs,
    fetch_models,
    generate_reply,
    get_ollama_url,
    get_workspace_root,
    list_context_entries,
    log_generated_file,
    read_context_file,
    safe_workspace_path,
    set_ollama_url,
)


BASE_DIR = Path(__file__).resolve().parent.parent
app = FastAPI(title="Ollama Local Web UI")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


def fetch_chat_record(chat_id: int) -> tuple[dict, list[dict]]:
    with get_connection() as conn:
        chat = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found.")
        messages = conn.execute(
            "SELECT id, role, model, content, created_at FROM messages WHERE chat_id = ? ORDER BY id ASC",
            (chat_id,),
        ).fetchall()
    return dict(chat), [dict(row) for row in messages]


def chat_export_basename(title: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in title).strip("-")
    return (cleaned[:60] or "chat-export").strip("-")


def build_chat_markdown(chat: dict, messages: list[dict]) -> str:
    lines = [
        f"# {chat['title']}",
        "",
        f"- Chat ID: {chat['id']}",
        f"- Created: {chat['created_at']}",
        f"- Updated: {chat['updated_at']}",
        "",
    ]
    for message in messages:
        lines.extend(
            [
                f"## {message['role'].title()}",
                "",
                f"- Time: {message['created_at']}",
                f"- Model: {message['model'] or ''}",
                "",
                message["content"],
                "",
            ]
        )
    return "\n".join(lines).strip() + "\n"


def normalize_artifact_row(row: dict) -> ArtifactEntry:
    return ArtifactEntry(**row)


@app.on_event("startup")
def on_startup() -> None:
    ensure_runtime_dirs()
    init_db()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/models", response_model=list[ModelInfo])
async def get_models() -> list[ModelInfo]:
    models = await fetch_models()
    return [ModelInfo(name=name) for name in models]


@app.get("/api/artifacts", response_model=list[ArtifactEntry])
def get_artifacts() -> list[ArtifactEntry]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, type, content, source_prompt, model, created_at, tags
            FROM artifacts
            ORDER BY created_at DESC, id DESC
            """
        ).fetchall()
    return [normalize_artifact_row(dict(row)) for row in rows]


@app.post("/api/artifacts", response_model=ArtifactEntry)
def create_artifact(request: ArtifactCreateRequest) -> ArtifactEntry:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO artifacts (name, type, content, source_prompt, model, tags)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                request.name.strip(),
                request.type,
                request.content,
                request.source_prompt,
                request.model,
                request.tags.strip() if request.tags else None,
            ),
        )
        artifact_id = int(cursor.lastrowid)
        conn.commit()
        row = conn.execute(
            """
            SELECT id, name, type, content, source_prompt, model, created_at, tags
            FROM artifacts
            WHERE id = ?
            """,
            (artifact_id,),
        ).fetchone()
    return normalize_artifact_row(dict(row))


@app.delete("/api/artifacts/{artifact_id}")
def delete_artifact(artifact_id: int) -> dict[str, bool]:
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Artifact not found.")
        conn.execute("DELETE FROM artifacts WHERE id = ?", (artifact_id,))
        conn.commit()
    return {"deleted": True}


@app.get("/api/settings", response_model=SettingsResponse)
def get_settings() -> SettingsResponse:
    return SettingsResponse(
        ollama_url=get_ollama_url(),
        workspace_root=get_workspace_root(),
    )


@app.patch("/api/settings", response_model=SettingsResponse)
def update_settings(request: SettingsUpdateRequest) -> SettingsResponse:
    ollama_url = set_ollama_url(request.ollama_url)
    return SettingsResponse(
        ollama_url=ollama_url,
        workspace_root=get_workspace_root(),
    )


@app.get("/api/chats", response_model=list[ChatSummary])
def get_chats() -> list[ChatSummary]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC"
        ).fetchall()
    return [ChatSummary(**dict(row)) for row in rows]


@app.patch("/api/chats/{chat_id}", response_model=ChatSummary)
def update_chat(chat_id: int, request: ChatUpdateRequest) -> ChatSummary:
    with get_connection() as conn:
        chat = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found.")

        conn.execute(
            "UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (request.title.strip(), chat_id),
        )
        conn.commit()
        updated = conn.execute(
            "SELECT id, title, created_at, updated_at FROM chats WHERE id = ?",
            (chat_id,),
        ).fetchone()

    return ChatSummary(**dict(updated))


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int) -> dict[str, bool]:
    with get_connection() as conn:
        chat = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found.")
        conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
        conn.commit()
    return {"deleted": True}


@app.post("/api/chats", response_model=ChatCreateResponse)
def new_chat() -> ChatCreateResponse:
    with get_connection() as conn:
        chat_id = create_chat(conn, "New chat")
        conn.commit()
    return ChatCreateResponse(chat_id=chat_id)


@app.get("/api/chats/{chat_id}", response_model=ChatDetail)
def get_chat(chat_id: int) -> ChatDetail:
    chat, messages = fetch_chat_record(chat_id)

    return ChatDetail(
        id=chat["id"],
        title=chat["title"],
        created_at=chat["created_at"],
        updated_at=chat["updated_at"],
        messages=[MessageOut(**row) for row in messages],
    )


@app.get("/api/chats/{chat_id}/export.md")
def export_chat_markdown(chat_id: int) -> Response:
    chat, messages = fetch_chat_record(chat_id)
    content = build_chat_markdown(chat, messages)
    filename = f"{chat_export_basename(chat['title'])}.md"
    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/chats/{chat_id}/export.json")
def export_chat_json(chat_id: int) -> Response:
    import json

    chat, messages = fetch_chat_record(chat_id)
    filename = f"{chat_export_basename(chat['title'])}.json"
    payload = {
        "chat": chat,
        "messages": messages,
    }
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    with get_connection() as conn:
        chat_id = request.chat_id
        if chat_id is None:
            chat_id = create_chat(conn, request.prompt)
        existing = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Chat not found.")

        user_row = add_message(conn, chat_id, "user", request.prompt, request.model)
        conn.execute(
            """
            UPDATE chats
            SET title = CASE WHEN title = 'New chat' THEN ? ELSE title END
            WHERE id = ?
            """,
            (request.prompt.strip().splitlines()[0][:80] or "New chat", chat_id),
        )
        assistant_text = await generate_reply(request.model, request.prompt, request.context_files)
        assistant_row = add_message(conn, chat_id, "assistant", assistant_text, request.model)
        conn.commit()

    return ChatResponse(
        chat_id=chat_id,
        user_message=MessageOut(**dict(user_row)),
        assistant_message=MessageOut(**dict(assistant_row)),
    )


@app.get("/api/context", response_model=list[ContextEntry])
def get_context_entries() -> list[ContextEntry]:
    return [ContextEntry(**entry) for entry in list_context_entries()]


@app.get("/api/context/file", response_model=ContextFileResponse)
def get_context_file(path: str) -> ContextFileResponse:
    return ContextFileResponse(path=path, content=read_context_file(path))


@app.get("/api/files/history", response_model=list[GeneratedFileEntry])
def get_generated_files() -> list[GeneratedFileEntry]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, chat_id, message_id, relative_path, source_prompt, content_preview, overwritten, created_at
            FROM generated_files
            ORDER BY created_at DESC, id DESC
            LIMIT 100
            """
        ).fetchall()
    return [
        GeneratedFileEntry(
            **{
                **dict(row),
                "overwritten": bool(row["overwritten"]),
            }
        )
        for row in rows
    ]


@app.post("/api/files/draft", response_model=FileDraftResponse)
def prepare_file_draft(request: FileDraftRequest) -> FileDraftResponse:
    full_path, relative_path = safe_workspace_path(request.filename)
    return FileDraftResponse(relative_path=relative_path, exists=full_path.exists(), content=request.content)


@app.post("/api/files/save", response_model=FileSaveResponse)
def save_file(request: FileSaveRequest) -> FileSaveResponse:
    full_path, relative_path = safe_workspace_path(request.filename)
    existed_before_write = full_path.exists()

    with get_connection() as conn:
        message = conn.execute(
            """
            SELECT m.id, m.chat_id, m.role, m.content, p.content AS source_prompt
            FROM messages m
            LEFT JOIN messages p ON p.chat_id = m.chat_id AND p.id < m.id AND p.role = 'user'
            WHERE m.id = ? AND m.chat_id = ?
            ORDER BY p.id DESC
            LIMIT 1
            """,
            (request.message_id, request.chat_id),
        ).fetchone()

        if not message:
            raise HTTPException(status_code=404, detail="Assistant message not found for this chat.")
        if message["role"] != "assistant":
            raise HTTPException(status_code=400, detail="Files can only be created from assistant output.")

        if existed_before_write and not request.overwrite:
            raise HTTPException(status_code=409, detail="File already exists. Confirm overwrite to continue.")

        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(request.content, encoding="utf-8")

        log_generated_file(
            conn=conn,
            chat_id=request.chat_id,
            message_id=request.message_id,
            relative_path=relative_path,
            source_prompt=message["source_prompt"] or "",
            content_preview=request.content,
            overwritten=existed_before_write and request.overwrite,
        )
        conn.commit()

    return FileSaveResponse(relative_path=relative_path, overwritten=existed_before_write and request.overwrite)
