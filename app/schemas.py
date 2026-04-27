from typing import Literal

from pydantic import BaseModel, Field


class ChatCreateResponse(BaseModel):
    chat_id: int


class ChatSummary(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str


class ChatUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=80)


class MessageOut(BaseModel):
    id: int
    role: str
    model: str | None
    content: str
    created_at: str


class ChatDetail(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str
    messages: list[MessageOut]


class ChatRequest(BaseModel):
    chat_id: int | None = None
    model: str
    prompt: str = Field(min_length=1)
    context_files: list[str] = Field(default_factory=list)


class ChatResponse(BaseModel):
    chat_id: int
    user_message: MessageOut
    assistant_message: MessageOut


class ModelInfo(BaseModel):
    name: str


class SettingsResponse(BaseModel):
    ollama_url: str
    workspace_root: str


class SettingsUpdateRequest(BaseModel):
    ollama_url: str = Field(min_length=1, max_length=200)


class ContextEntry(BaseModel):
    path: str
    kind: Literal["file", "dir"]


class ContextFileResponse(BaseModel):
    path: str
    content: str


class FileDraftRequest(BaseModel):
    filename: str = Field(min_length=1)
    content: str


class FileDraftResponse(BaseModel):
    relative_path: str
    exists: bool
    content: str


class FileSaveRequest(BaseModel):
    chat_id: int
    message_id: int
    filename: str = Field(min_length=1)
    content: str
    overwrite: bool = False


class FileSaveResponse(BaseModel):
    relative_path: str
    overwritten: bool


class GeneratedFileEntry(BaseModel):
    id: int
    chat_id: int
    message_id: int
    relative_path: str
    source_prompt: str
    content_preview: str
    overwritten: bool
    created_at: str
