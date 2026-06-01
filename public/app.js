const chatList = document.querySelector("#chatList");
const messagesEl = document.querySelector("#messages");
const chatTitle = document.querySelector("#chatTitle");
const statusPill = document.querySelector("#statusPill");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const newChatButton = document.querySelector("#newChatButton");
const messageTemplate = document.querySelector("#messageTemplate");
const themeButtons = document.querySelectorAll(".theme-button");
const messageMenu = document.querySelector("#messageMenu");

const starterPrompts = [
  "Help me plan a study schedule for this week.",
  "Write a professional email reply.",
  "Explain APIs like I am new to coding.",
  "Give me 10 startup ideas for a local business."
];

let chats = loadChats();
let activeChatId = chats[0]?.id || createChat().id;
let isSending = false;
let selectedMessageIndex = null;
let thinkingTimer = null;

const thinkingPhrases = [
  "Thinking...",
  "Reading your message...",
  "Collecting data...",
  "Making it clear...",
  "Almost ready...",
  "Checking the context...",
  "Connecting the ideas...",
  "Building the answer...",
  "Looking for the best wording...",
  "Sorting the details...",
  "Polishing the response...",
  "Following the thread...",
  "Reviewing the question...",
  "Finding the useful part...",
  "Shaping the reply...",
  "Putting it together...",
  "Choosing better examples...",
  "Making it practical...",
  "Thinking one step deeper...",
  "Almost got it...",
  "Reading between the lines...",
  "Making the answer cleaner...",
  "Preparing something helpful...",
  "Catching the important bits...",
  "Turning thoughts into words..."
];

const savedTheme = localStorage.getItem("buzaition-theme");
setTheme(savedTheme === "mauve" ? "buz" : savedTheme || "buz");
render();
checkHealth();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content || isSending) return;
  await sendMessage(content);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

newChatButton.addEventListener("click", () => {
  activeChatId = createChat().id;
  saveChats();
  render();
  input.focus();
});

messagesEl.addEventListener("contextmenu", (event) => {
  event.preventDefault();

  const messageEl = event.target.closest(".message.user");
  if (!messageEl) {
    hideMessageMenu();
    return;
  }

  selectedMessageIndex = Number(messageEl.dataset.index);
  showMessageMenu(event.clientX, event.clientY);
});

messagesEl.addEventListener("click", async (event) => {
  const copyButton = event.target.closest(".copy-message");
  if (!copyButton) return;

  const messageEl = copyButton.closest(".message");
  const index = Number(messageEl?.dataset.index);
  const message = getActiveChat().messages[index];
  if (!message) return;

  await copyText(message.content);
  copyButton.classList.add("copied");
  copyButton.setAttribute("title", "Copied");
  window.setTimeout(() => {
    copyButton.classList.remove("copied");
    copyButton.setAttribute("title", "Copy message");
  }, 1200);
});

messageMenu.addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.action;
  if (!action || selectedMessageIndex === null) return;

  if (action === "edit") {
    editMessage(selectedMessageIndex);
  }

  if (action === "delete") {
    deleteMessage(selectedMessageIndex);
  }

  hideMessageMenu();
});

document.addEventListener("click", hideMessageMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideMessageMenu();
});

themeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setTheme(button.dataset.theme || "light");
  });
});

async function sendMessage(content) {
  const chat = getActiveChat();
  chat.messages.push({ role: "user", content });
  chat.title = titleFrom(content);
  chat.updatedAt = Date.now();
  input.value = "";
  input.style.height = "auto";
  isSending = true;
  render();

  const placeholder = { role: "assistant", content: "", loading: true };
  chat.messages.push(placeholder);
  renderMessages(chat);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chat.messages.filter((message) => message !== placeholder) })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");

    placeholder.content = data.message;
    chat.model = data.model;
  } catch (error) {
    placeholder.content = `Error: ${error.message}`;
  } finally {
    isSending = false;
    chat.updatedAt = Date.now();
    saveChats();
    render();
  }
}

function render() {
  const chat = getActiveChat();
  chatTitle.textContent = chat.title;
  sendButton.disabled = isSending;
  renderChatList();
  renderMessages(chat);
}

function renderChatList() {
  chatList.innerHTML = "";
  for (const chat of chats) {
    const item = document.createElement("div");
    item.className = `chat-item${chat.id === activeChatId ? " active" : ""}`;
    item.innerHTML = `
      <button class="chat-open" type="button">
        <span class="chat-item-title"></span>
        <span class="chat-item-meta">${chat.messages.length} messages</span>
      </button>
      <button class="chat-delete" type="button" aria-label="Delete ${chat.title}">
        <span aria-hidden="true">×</span>
      </button>
    `;

    item.querySelector(".chat-delete").innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M3 6h18"></path>
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
        <path d="M10 11v6"></path>
        <path d="M14 11v6"></path>
      </svg>
    `;
    item.querySelector(".chat-item-title").textContent = chat.title;
    item.querySelector(".chat-open").addEventListener("click", () => {
      activeChatId = chat.id;
      render();
    });

    item.querySelector(".chat-delete").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChat(chat.id);
    });

    chatList.append(item);
  }
}

function renderMessages(chat) {
  stopThinkingAnimation();
  messagesEl.innerHTML = "";

  if (!chat.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h3>What can I help with?</h3>
      <p>Ask questions, draft content, brainstorm ideas, or get help understanding code.</p>
      <div class="prompt-grid"></div>
    `;
    const grid = empty.querySelector(".prompt-grid");
    for (const prompt of starterPrompts) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "prompt-chip";
      button.textContent = prompt;
      button.addEventListener("click", () => {
        input.value = prompt;
        form.requestSubmit();
      });
      grid.append(button);
    }
    messagesEl.append(empty);
    return;
  }

  chat.messages.forEach((message, index) => {
    const node = messageTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(message.role);
    if (message.loading) node.classList.add("loading");
    node.dataset.index = String(index);
    node.querySelector(".avatar").textContent = message.role === "user" ? "You" : "AI";
    const bubble = node.querySelector(".bubble");
    if (message.loading) {
      bubble.innerHTML = `
        <span class="thinking-loader" aria-label="Thinking">
          <span class="thinking-text"></span>
          <span class="thinking-caret"></span>
        </span>
      `;
      node.querySelector(".copy-message").hidden = true;
    } else {
      bubble.textContent = message.content;
    }
    messagesEl.append(node);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
  startThinkingAnimation();
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    statusPill.textContent = data.ok ? data.model : "Needs API key";
    statusPill.className = `status-pill ${data.ok ? "ready" : "error"}`;
  } catch {
    statusPill.textContent = "Offline";
    statusPill.className = "status-pill error";
  }
}

function createChat() {
  const chat = {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: [],
    updatedAt: Date.now()
  };
  chats.unshift(chat);
  return chat;
}

function getActiveChat() {
  return chats.find((chat) => chat.id === activeChatId) || chats[0];
}

function saveChats() {
  localStorage.setItem("ai-chatbot-chats", JSON.stringify(chats.slice(0, 20)));
}

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem("ai-chatbot-chats") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function titleFrom(content) {
  return content.length > 36 ? `${content.slice(0, 36)}...` : content;
}

function deleteChat(chatId) {
  chats = chats.filter((chat) => chat.id !== chatId);

  if (!chats.length) {
    activeChatId = createChat().id;
  } else if (activeChatId === chatId) {
    activeChatId = chats[0].id;
  }

  saveChats();
  render();
}

function setTheme(theme) {
  const selectedTheme = ["light", "dark", "buz"].includes(theme) ? theme : "buz";
  document.body.dataset.theme = selectedTheme;
  localStorage.setItem("buzaition-theme", selectedTheme);

  themeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === selectedTheme));
  });
}

function showMessageMenu(x, y) {
  messageMenu.hidden = false;

  const { innerWidth, innerHeight } = window;
  const menuRect = messageMenu.getBoundingClientRect();
  const left = Math.min(x, innerWidth - menuRect.width - 10);
  const top = Math.min(y, innerHeight - menuRect.height - 10);

  messageMenu.style.left = `${Math.max(10, left)}px`;
  messageMenu.style.top = `${Math.max(10, top)}px`;
}

function hideMessageMenu() {
  messageMenu.hidden = true;
  selectedMessageIndex = null;
}

function editMessage(index) {
  const chat = getActiveChat();
  const message = chat.messages[index];
  if (!message || message.role !== "user") return;

  input.value = message.content;
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
  input.focus();

  removeMessageTurn(chat, index);
  saveChats();
  render();
}

function deleteMessage(index) {
  const chat = getActiveChat();
  const message = chat.messages[index];
  if (!message || message.role !== "user") return;

  removeMessageTurn(chat, index);
  saveChats();
  render();
}

function removeMessageTurn(chat, index) {
  const deleteCount = chat.messages[index + 1]?.role === "assistant" ? 2 : 1;
  chat.messages.splice(index, deleteCount);
  chat.updatedAt = Date.now();
  chat.title = chat.messages.find((message) => message.role === "user")?.content
    ? titleFrom(chat.messages.find((message) => message.role === "user").content)
    : "New chat";
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function startThinkingAnimation() {
  const target = messagesEl.querySelector(".thinking-text");
  if (!target) return;

  let phraseIndex = randomPhraseIndex();
  let letterIndex = 0;
  let deleting = false;
  let pause = 0;

  const tick = () => {
    const phrase = thinkingPhrases[phraseIndex];
    target.textContent = phrase.slice(0, letterIndex);

    if (pause > 0) {
      pause -= 1;
      return;
    }

    if (!deleting && letterIndex < phrase.length) {
      letterIndex += 1;
      return;
    }

    if (!deleting && letterIndex === phrase.length) {
      deleting = true;
      pause = 7;
      return;
    }

    if (deleting && letterIndex > 0) {
      letterIndex -= 1;
      return;
    }

    deleting = false;
    phraseIndex = randomPhraseIndex(phraseIndex);
    pause = 2;
  };

  tick();
  thinkingTimer = window.setInterval(tick, 55);
}

function stopThinkingAnimation() {
  if (!thinkingTimer) return;
  window.clearInterval(thinkingTimer);
  thinkingTimer = null;
}

function randomPhraseIndex(currentIndex = -1) {
  if (thinkingPhrases.length < 2) return 0;

  let nextIndex = currentIndex;
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * thinkingPhrases.length);
  }

  return nextIndex;
}
