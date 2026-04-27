const state = {
  currentChatId: null,
  models: [],
  selectedContextFiles: new Set(),
  pendingFileMessageId: null,
  pendingFileChatId: null,
  chatSearch: "",
  chats: [],
  settings: null,
};

const elements = {
  modelSelect: document.getElementById("model-select"),
  ollamaUrlInput: document.getElementById("ollama-url-input"),
  saveSettingsBtn: document.getElementById("save-settings-btn"),
  workspaceRoot: document.getElementById("workspace-root"),
  chatSearchInput: document.getElementById("chat-search-input"),
  currentChatLabel: document.getElementById("current-chat-label"),
  renameChatBtn: document.getElementById("rename-chat-btn"),
  deleteChatBtn: document.getElementById("delete-chat-btn"),
  exportMdBtn: document.getElementById("export-md-btn"),
  exportJsonBtn: document.getElementById("export-json-btn"),
  chatList: document.getElementById("chat-list"),
  fileHistory: document.getElementById("file-history"),
  messages: document.getElementById("messages"),
  promptInput: document.getElementById("prompt-input"),
  sendBtn: document.getElementById("send-btn"),
  newChatBtn: document.getElementById("new-chat-btn"),
  contextList: document.getElementById("context-list"),
  contextPreview: document.getElementById("context-preview"),
  selectedContext: document.getElementById("selected-context"),
  fileDialog: document.getElementById("file-dialog"),
  fileNameInput: document.getElementById("file-name-input"),
  fileContentPreview: document.getElementById("file-content-preview"),
  filePathHint: document.getElementById("file-path-hint"),
  fileCancelBtn: document.getElementById("file-cancel-btn"),
  fileSaveBtn: document.getElementById("file-save-btn"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Request failed");
  }

  return response.json();
}

async function downloadFile(path, fallbackFilename) {
  const response = await fetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "Download failed");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/);
  link.href = url;
  link.download = match ? match[1] : fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setStatus(text) {
  elements.selectedContext.textContent = text;
}

async function copyText(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(label);
  } catch (error) {
    setStatus("Clipboard copy failed.");
  }
}

function truncate(text, length = 90) {
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatInlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function slugify(text) {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseCodeBlocks(messageText) {
  const blocks = [];
  const regex = /```([\w.+-]*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(messageText)) !== null) {
    blocks.push({
      language: match[1].trim().toLowerCase(),
      content: match[2].trim(),
    });
  }

  return blocks;
}

function detectExtension(language, promptText, content) {
  const languageMap = {
    bash: ".sh",
    shell: ".sh",
    sh: ".sh",
    python: ".py",
    py: ".py",
    markdown: ".md",
    md: ".md",
    text: ".txt",
    txt: ".txt",
    json: ".json",
    html: ".html",
    css: ".css",
    javascript: ".js",
    js: ".js",
  };

  if (languageMap[language]) {
    return languageMap[language];
  }

  const lowerPrompt = promptText.toLowerCase();
  const promptMatch = lowerPrompt.match(/\.(md|txt|py|sh|json|html|css|js)\b/);
  if (promptMatch) {
    return `.${promptMatch[1]}`;
  }

  if (content.startsWith("#!")) {
    return ".sh";
  }

  return ".txt";
}

function suggestFilename(messageText, promptText) {
  const blocks = parseCodeBlocks(messageText);
  const mainBlock = blocks[0];
  const content = mainBlock ? mainBlock.content : messageText.trim();
  const extension = detectExtension(mainBlock ? mainBlock.language : "", promptText, content);
  const baseName = slugify(promptText || "output") || "output";
  return `generated/${baseName}${extension}`;
}

function extractSuggestedFileContent(messageText) {
  const blocks = parseCodeBlocks(messageText);
  if (blocks.length) {
    return blocks[0].content;
  }
  return messageText.trim();
}

function formatMessageBody(messageText) {
  const html = [];
  const regex = /```([\w.+-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  function pushList(items) {
    if (!items.length) {
      return;
    }
    html.push(`<ul>${items.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</ul>`);
  }

  function pushTextChunk(textChunk) {
    const cleaned = textChunk.trim();
    if (!cleaned) {
      return;
    }
    const blocks = cleaned.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split("\n").map((line) => line.trimEnd());
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        pushList(lines.map((line) => line.replace(/^[-*]\s+/, "")));
        continue;
      }
      if (lines[0].startsWith("### ")) {
        html.push(`<h3>${formatInlineMarkdown(lines[0].slice(4))}</h3>`);
        if (lines.length > 1) {
          html.push(`<p>${formatInlineMarkdown(lines.slice(1).join("\n")).replaceAll("\n", "<br>")}</p>`);
        }
        continue;
      }
      if (lines[0].startsWith("## ")) {
        html.push(`<h2>${formatInlineMarkdown(lines[0].slice(3))}</h2>`);
        if (lines.length > 1) {
          html.push(`<p>${formatInlineMarkdown(lines.slice(1).join("\n")).replaceAll("\n", "<br>")}</p>`);
        }
        continue;
      }
      if (lines[0].startsWith("# ")) {
        html.push(`<h1>${formatInlineMarkdown(lines[0].slice(2))}</h1>`);
        if (lines.length > 1) {
          html.push(`<p>${formatInlineMarkdown(lines.slice(1).join("\n")).replaceAll("\n", "<br>")}</p>`);
        }
        continue;
      }
      html.push(`<p>${formatInlineMarkdown(block).replaceAll("\n", "<br>")}</p>`);
    }
  }

  while ((match = regex.exec(messageText)) !== null) {
    pushTextChunk(messageText.slice(lastIndex, match.index));
    const language = match[1];
    const code = match[2] || "";
    html.push(
      `<div class="code-block"><div class="code-label">${escapeHtml(language || "text")}</div><pre><code>${escapeHtml(code)}</code></pre></div>`
    );
    lastIndex = match.index + match[0].length;
  }

  pushTextChunk(messageText.slice(lastIndex));
  return html.length ? html.join("") : `<p>${escapeHtml(messageText).replaceAll("\n", "<br>")}</p>`;
}

function renderMessages(messages) {
  elements.messages.innerHTML = "";
  let lastUserPrompt = "";

  for (const message of messages) {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${message.role}`;
    wrapper.id = `message-${message.id}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.innerHTML = `<strong>${message.role}</strong><span>${message.model || ""}</span>`;

    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = formatMessageBody(message.content);

    wrapper.append(meta, body);

    if (message.role === "user") {
      lastUserPrompt = message.content;
    }

    const actions = document.createElement("div");
    actions.className = "message-actions";
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", async () => {
      await copyText(message.content, `${message.role} message copied.`);
    });
    actions.appendChild(copyButton);

    if (message.role === "assistant") {
      const quickSaveButton = document.createElement("button");
      quickSaveButton.type = "button";
      quickSaveButton.textContent = "Quick Save";
      quickSaveButton.addEventListener("click", async () => {
        await quickSaveMessage(message, lastUserPrompt);
      });
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.textContent = "Preview Save";
      saveButton.addEventListener("click", () => openFileDialog(message, lastUserPrompt));
      actions.appendChild(quickSaveButton);
      actions.appendChild(saveButton);
    }

    wrapper.appendChild(actions);

    elements.messages.appendChild(wrapper);
  }

  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderChatList(chats) {
  elements.chatList.innerHTML = "";
  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(state.chatSearch.toLowerCase())
  );

  for (const chat of filteredChats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `chat-item${chat.id === state.currentChatId ? " active" : ""}`;
    button.textContent = chat.title;
    button.addEventListener("click", () => loadChat(chat.id));
    elements.chatList.appendChild(button);
  }

  if (!filteredChats.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No chats match this filter.";
    elements.chatList.appendChild(empty);
  }
}

function renderFileHistory(entries) {
  elements.fileHistory.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No generated files saved yet.";
    elements.fileHistory.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "history-item";

    const title = document.createElement("div");
    title.className = "history-path";
    title.textContent = `workspace/${entry.relative_path}`;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = entry.overwritten ? "Overwrote existing file" : "Created new file";

    const prompt = document.createElement("div");
    prompt.className = "history-prompt";
    prompt.textContent = truncate(entry.source_prompt || "(No prompt recorded)");

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const jumpButton = document.createElement("button");
    jumpButton.type = "button";
    jumpButton.textContent = "Open Chat";
    jumpButton.addEventListener("click", async () => {
      await jumpToHistoryEntry(entry);
    });

    const copyPromptButton = document.createElement("button");
    copyPromptButton.type = "button";
    copyPromptButton.textContent = "Copy Prompt";
    copyPromptButton.addEventListener("click", async () => {
      await copyText(entry.source_prompt || "", "Source prompt copied.");
    });

    actions.append(jumpButton, copyPromptButton);
    item.append(title, meta, prompt, actions);
    elements.fileHistory.appendChild(item);
  }
}

function highlightMessage(messageId) {
  const target = document.getElementById(`message-${messageId}`);
  if (!target) {
    return;
  }
  target.classList.add("message-focus");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => {
    target.classList.remove("message-focus");
  }, 1800);
}

function renderContextList(entries) {
  elements.contextList.innerHTML = "";

  const files = entries.filter((entry) => entry.kind === "file");
  for (const entry of files) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `context-item${state.selectedContextFiles.has(entry.path) ? " active" : ""}`;
    button.textContent = entry.path;
    button.addEventListener("click", async () => {
      const file = await api(`/api/context/file?path=${encodeURIComponent(entry.path)}`);
      elements.contextPreview.textContent = file.content;
      if (state.selectedContextFiles.has(entry.path)) {
        state.selectedContextFiles.delete(entry.path);
      } else {
        state.selectedContextFiles.add(entry.path);
      }
      updateSelectedContextText();
      renderContextList(entries);
    });
    elements.contextList.appendChild(button);
  }
}

function updateSelectedContextText() {
  const files = [...state.selectedContextFiles];
  setStatus(files.length ? `Context attached: ${files.join(", ")}` : "No context files selected.");
}

async function loadModels() {
  const models = await api("/api/models");
  state.models = models;
  elements.modelSelect.innerHTML = "";

  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No local models found";
    elements.modelSelect.appendChild(option);
    setStatus(`No Ollama models were returned from ${state.settings?.ollama_url || "the configured Ollama host"}.`);
    return;
  }

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.name;
    option.textContent = model.name;
    elements.modelSelect.appendChild(option);
  }
}

async function loadSettings() {
  const settings = await api("/api/settings");
  state.settings = settings;
  elements.ollamaUrlInput.value = settings.ollama_url;
  elements.workspaceRoot.textContent = `Workspace root: ${settings.workspace_root}`;
}

async function saveSettings() {
  const nextUrl = elements.ollamaUrlInput.value.trim();
  if (!nextUrl) {
    return;
  }

  const settings = await api("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ ollama_url: nextUrl }),
  });
  state.settings = settings;
  elements.ollamaUrlInput.value = settings.ollama_url;
  elements.workspaceRoot.textContent = `Workspace root: ${settings.workspace_root}`;
  setStatus(`Saved Ollama host: ${settings.ollama_url}`);
  await loadModels();
}

async function refreshChats() {
  const chats = await api("/api/chats");
  state.chats = chats;
  renderChatList(chats);
  if (!state.currentChatId && chats.length) {
    await loadChat(chats[0].id);
  }
}

async function refreshFileHistory() {
  const entries = await api("/api/files/history");
  renderFileHistory(entries);
}

async function loadChat(chatId) {
  const chat = await api(`/api/chats/${chatId}`);
  state.currentChatId = chatId;
  elements.currentChatLabel.textContent = `Current: ${chat.title}`;
  renderMessages(chat.messages);
  await refreshChats();
}

async function jumpToHistoryEntry(entry) {
  await loadChat(entry.chat_id);
  highlightMessage(entry.message_id);
  setStatus(`Opened chat for workspace/${entry.relative_path}`);
}

async function createChat() {
  const chat = await api("/api/chats", { method: "POST", body: JSON.stringify({}) });
  state.currentChatId = chat.chat_id;
  elements.currentChatLabel.textContent = "Current: New chat";
  renderMessages([]);
  await refreshChats();
}

async function renameCurrentChat() {
  if (!state.currentChatId) {
    return;
  }

  const current = state.chats.find((chat) => chat.id === state.currentChatId);
  const nextTitle = window.prompt("Rename chat", current ? current.title : "New chat");
  if (!nextTitle || !nextTitle.trim()) {
    return;
  }

  await api(`/api/chats/${state.currentChatId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: nextTitle.trim() }),
  });
  elements.currentChatLabel.textContent = `Current: ${nextTitle.trim()}`;
  await refreshChats();
}

async function deleteCurrentChat() {
  if (!state.currentChatId) {
    return;
  }
  const confirmed = window.confirm("Delete this chat and its saved message history?");
  if (!confirmed) {
    return;
  }

  await api(`/api/chats/${state.currentChatId}`, { method: "DELETE" });
  state.currentChatId = null;
  elements.currentChatLabel.textContent = "No chat selected.";
  renderMessages([]);
  await refreshChats();
  await refreshFileHistory();
}

async function exportCurrentChat(format) {
  if (!state.currentChatId) {
    return;
  }
  const extension = format === "md" ? "md" : "json";
  await downloadFile(
    `/api/chats/${state.currentChatId}/export.${extension}`,
    `chat-export.${extension}`
  );
}

async function sendPrompt() {
  const prompt = elements.promptInput.value.trim();
  const model = elements.modelSelect.value;
  if (!prompt || !model) {
    return;
  }

  elements.sendBtn.disabled = true;
  setStatus("Sending prompt to Ollama...");

  try {
    const result = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        chat_id: state.currentChatId,
        model,
        prompt,
        context_files: [...state.selectedContextFiles],
      }),
    });

    state.currentChatId = result.chat_id;
    elements.promptInput.value = "";
    await loadChat(result.chat_id);
    updateSelectedContextText();
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.sendBtn.disabled = false;
  }
}

async function openFileDialog(message, promptText = "") {
  state.pendingFileMessageId = message.id;
  state.pendingFileChatId = state.currentChatId;
  elements.fileNameInput.value = suggestFilename(message.content, promptText);
  elements.fileContentPreview.value = extractSuggestedFileContent(message.content);

  try {
    const draft = await api("/api/files/draft", {
      method: "POST",
      body: JSON.stringify({
        filename: elements.fileNameInput.value,
        content: elements.fileContentPreview.value,
      }),
    });
    elements.filePathHint.textContent = `Will save to workspace/${draft.relative_path}`;
  } catch (error) {
    elements.filePathHint.textContent = error.message;
  }

  elements.fileDialog.showModal();
}

async function quickSaveMessage(message, promptText = "") {
  state.pendingFileMessageId = message.id;
  state.pendingFileChatId = state.currentChatId;
  elements.fileNameInput.value = suggestFilename(message.content, promptText);
  elements.fileContentPreview.value = extractSuggestedFileContent(message.content);
  await saveDraft();
}

async function updateDraftHint() {
  try {
    const draft = await api("/api/files/draft", {
      method: "POST",
      body: JSON.stringify({
        filename: elements.fileNameInput.value,
        content: elements.fileContentPreview.value,
      }),
    });
    elements.filePathHint.textContent = `Will save to workspace/${draft.relative_path}${draft.exists ? " (already exists)" : ""}`;
  } catch (error) {
    elements.filePathHint.textContent = error.message;
  }
}

async function saveDraft() {
  let overwrite = false;

  while (true) {
    try {
      const result = await api("/api/files/save", {
        method: "POST",
        body: JSON.stringify({
          chat_id: state.pendingFileChatId,
          message_id: state.pendingFileMessageId,
          filename: elements.fileNameInput.value,
          content: elements.fileContentPreview.value,
          overwrite,
        }),
      });
      setStatus(`Saved workspace/${result.relative_path}`);
      elements.fileDialog.close();
      await refreshFileHistory();
      return;
    } catch (error) {
      if (error.message.includes("already exists") && !overwrite) {
        overwrite = window.confirm("That file already exists. Overwrite it?");
        if (!overwrite) {
          return;
        }
        continue;
      }
      setStatus(error.message);
      return;
    }
  }
}

async function loadContext() {
  const entries = await api("/api/context");
  renderContextList(entries);
}

elements.sendBtn.addEventListener("click", sendPrompt);
elements.newChatBtn.addEventListener("click", createChat);
elements.saveSettingsBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
  } catch (error) {
    setStatus(error.message);
  }
});
elements.renameChatBtn.addEventListener("click", renameCurrentChat);
elements.deleteChatBtn.addEventListener("click", deleteCurrentChat);
elements.exportMdBtn.addEventListener("click", async () => {
  try {
    await exportCurrentChat("md");
  } catch (error) {
    setStatus(error.message);
  }
});
elements.exportJsonBtn.addEventListener("click", async () => {
  try {
    await exportCurrentChat("json");
  } catch (error) {
    setStatus(error.message);
  }
});
elements.chatSearchInput.addEventListener("input", (event) => {
  state.chatSearch = event.target.value;
  renderChatList(state.chats);
});
elements.fileCancelBtn.addEventListener("click", () => elements.fileDialog.close());
elements.fileSaveBtn.addEventListener("click", saveDraft);
elements.fileNameInput.addEventListener("input", updateDraftHint);
elements.fileContentPreview.addEventListener("input", updateDraftHint);

window.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadSettings();
    await loadModels();
    await refreshChats();
    await loadContext();
    await refreshFileHistory();
    updateSelectedContextText();
  } catch (error) {
    setStatus(error.message);
  }
});
