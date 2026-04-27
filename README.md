# Ollama Local Web UI

Local web UI for Ollama on Fedora using FastAPI, SQLite, and a plain HTML/JS frontend.

## What This Project Is

This app is a local-first chat UI for Ollama that:

- connects to a local Ollama server
- stores chats in SQLite
- lets you preview and save model output as files
- restricts file creation to a local app workspace folder
- keeps a read-only project context area for prompt attachments
- avoids command execution entirely in v1

The project is intentionally simple:

- backend: FastAPI
- persistence: SQLite
- frontend: plain HTML, CSS, and JavaScript
- runtime target: Fedora / local Linux development

## Current Feature Set

### Chat

- Model dropdown populated from the configured Ollama host
- Multi-chat history saved to SQLite
- Rename and delete chat actions
- Export the current chat as Markdown or JSON
- Copy any message content
- Save assistant output as artifacts

### File Generation

- Save assistant output into `workspace/`
- Preview before save
- Quick save from assistant responses
- Auto-suggested filenames from prompt and code block language
- Overwrite protection with explicit confirmation
- Generated file history panel
- Jump from file history back to the source chat/message
- Logging of generated file path, source prompt, and overwrite status

### Artifacts

- Artifact storage in SQLite
- Artifact sidebar panel with preview
- Save artifacts from assistant responses
- Artifact copy and delete actions
- Simple artifact search/filter
- Artifact fields include name, type, content, source prompt, model, timestamp, and optional tags

### Prompt Context

- Read-only file browser for `project_context/`
- Context files can be attached to prompts
- Context is included as reference only

### Settings

- Configurable Ollama host from the UI
- Workspace root displayed in the UI

### UI Quality-of-Life

- Lightweight Markdown-style rendering for assistant messages
- Code block rendering
- Chat search/filter
- Source prompt copy actions

## Project Structure

```text
app/
  db.py          SQLite setup and schema initialization
  main.py        FastAPI app and API routes
  schemas.py     Pydantic request/response models
  services.py    Ollama access, workspace safety, and shared helpers
static/
  app.js         Frontend behavior
  styles.css     Layout and visual styling
templates/
  index.html     Main page
project_context/
  README.md      Notes for read-only prompt context files
requirements.txt Python dependencies
README.md        Project documentation
```

Generated local runtime folders:

- `data/` for SQLite
- `workspace/` for saved model output

These are ignored by git.

## Requirements

- Python 3.11+ recommended
- Local Ollama installed and running
- Fedora or similar Linux environment

## Setup

### 1. Create a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Start the app

```bash
uvicorn app.main:app --reload
```

Then open:

```text
http://127.0.0.1:8000
```

## Running Ollama

By default the app expects:

```text
http://localhost:11434
```

You can change that in the UI settings panel without changing code.

## How To Use It

### Basic Chat

1. Start Ollama.
2. Start the FastAPI app.
3. Open the browser UI.
4. Pick a model.
5. Start a new chat and send prompts.

### Attach Read-Only Project Context

1. Put UTF-8 text files in `project_context/`.
2. Click a context file in the sidebar.
3. Selected files are attached to the next prompt as read-only reference.

### Save Model Output As Files

1. Ask the model for output, for example:
   `write this as a .md file`
2. Use `Preview Save` or `Quick Save`.
3. Confirm overwrite if the file already exists.

All saved output stays inside:

```text
workspace/
```

### Save Assistant Output As Artifacts

1. Generate a response from the assistant.
2. Click `Save as Artifact` on the assistant message.
3. Choose an artifact name, type, and optional tags.
4. Save it to the artifact library.

Artifacts are stored in SQLite and can be searched, previewed, copied, and deleted from the sidebar.

## API Overview

Main routes:

- `GET /` main UI
- `GET /api/settings` current settings
- `PATCH /api/settings` update Ollama host
- `GET /api/models` list models from Ollama
- `GET /api/chats` list chats
- `POST /api/chats` create a chat
- `GET /api/chats/{chat_id}` fetch chat detail
- `PATCH /api/chats/{chat_id}` rename a chat
- `DELETE /api/chats/{chat_id}` delete a chat
- `GET /api/chats/{chat_id}/export.md` export chat as Markdown
- `GET /api/chats/{chat_id}/export.json` export chat as JSON
- `POST /api/chat` send prompt and store reply
- `GET /api/artifacts` list artifacts
- `POST /api/artifacts` create an artifact
- `DELETE /api/artifacts/{artifact_id}` delete an artifact
- `GET /api/context` list read-only context files
- `GET /api/context/file` fetch a context file
- `GET /api/files/history` list generated file history
- `POST /api/files/draft` validate preview save path
- `POST /api/files/save` save generated content into workspace

## Safety Rules In This MVP

- File writes are restricted to the app `workspace/` directory
- Existing files are never overwritten without confirmation
- Project context files are read-only
- No automatic command execution
- No shell/tool execution from model output

## Development Notes

### When You Need To Restart

If you run:

```bash
uvicorn app.main:app --reload
```

Then:

- Python backend changes should auto-reload
- HTML/CSS/JS changes usually only need a browser refresh
- a hard refresh can help if CSS seems cached

If you do **not** run with `--reload`, restart the server for Python changes.

### Useful Checks

```bash
python3 -m compileall app
node --check static/app.js
```

### Suggested PR Workflow

You do not need to memorize this. It can be the default rhythm for future changes.

1. Create a branch for the change.
2. Make the code and documentation updates.
3. Run a quick local verification pass.
4. Commit the work with a focused commit message.
5. Push the branch to GitHub.
6. Open a Draft PR while the work is still in progress.
7. Keep updating that PR until the change is ready to merge.

Example branch flow:

```bash
git checkout -b feature/some-change
git add .
git commit -m "Describe the change"
git push -u origin feature/some-change
```

Why use a Draft PR:

- it gives each change a clear reviewable checkpoint
- it keeps notes, screenshots, and follow-up items in one place
- it makes it easier to revisit unfinished work later

For very small personal tweaks, you can still commit directly to `main` if you want. The draft PR flow is just a cleaner habit when changes start to pile up.

## What Has Been Built So Far

- FastAPI app scaffold
- SQLite persistence for chats and generated file logs
- Local Ollama model listing and prompt generation
- Multi-chat management
- File preview/save workflow
- Workspace path safety
- Generated file history
- Read-only project context browser
- Settings panel for Ollama host
- Chat export to Markdown and JSON
- Message copy actions and file-history jump-back navigation
- Artifact storage, listing, preview, copy, and delete flows

## Not In Scope For v1

- Automatic command execution
- Arbitrary file system writes outside `workspace/`
- Rich authentication or multi-user support
- Full Markdown parser dependency

## Known Limitations

- Artifact preview is text-first and intentionally simple
- Assistant Markdown rendering is lightweight, not a full Markdown implementation
- Manual UI verification still depends on running the app locally in a browser
- SQLite is used for simplicity and local-first persistence, not multi-user scale

## v1.1 Backlog

This is a lightweight place for future ideas, polish items, bugs, and experiments. You can keep adding to it whenever you notice something worth tracking.

- Add visible timestamps in the chat UI
- Add a "reuse prompt" or "send back to composer" action from chat history
- Add a generated-file preview modal from the history panel
- Add simple message search inside the current chat
- Add per-chat tags or favorites
- Add better mobile spacing and layout polish
- Add optional streaming responses from Ollama
- Add a small test suite for key API routes and workspace safety rules
- Consider moving backlog items into GitHub Issues if the list grows

## License

No license has been added yet.
