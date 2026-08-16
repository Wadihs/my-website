const form = document.getElementById("messageForm");
const nameInput = document.getElementById("name");
const messageInput = document.getElementById("message");
const messageBoard = document.getElementById("messageBoard");
const emptyState = document.getElementById("emptyState");
const charCount = document.getElementById("charCount");
const statusText = document.getElementById("status");
const submitButton = document.getElementById("submitButton");
const refreshButton = document.getElementById("refreshBoard");

const configured =
  SUPABASE_URL &&
  SUPABASE_PUBLIC_KEY &&
  !SUPABASE_URL.includes("YOUR-PROJECT") &&
  !SUPABASE_PUBLIC_KEY.includes("YOUR-PUBLISHABLE");

let db = null;

if (configured) {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
} else {
  statusText.textContent =
    "Supabase is not configured yet. Edit config.js with your project URL and publishable/anon key.";
  submitButton.disabled = true;
}

function setStatus(message) {
  statusText.textContent = message;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function renderPosts(posts) {
  messageBoard.innerHTML = "";
  emptyState.hidden = posts.length > 0;

  posts.forEach((post) => {
    const item = document.createElement("article");
    item.className = "message";

    const header = document.createElement("div");
    header.className = "message-header";

    const author = document.createElement("span");
    author.className = "author";
    author.textContent = post.name;

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = formatDate(post.created_at);

    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = post.message;

    header.append(author, time);
    item.append(header, text);
    messageBoard.append(item);
  });
}

async function loadPosts() {
  if (!db) return;

  setStatus("loading messages...");

  const { data, error } = await db
    .from("messages")
    .select("id,name,message,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error(error);
    setStatus("could not load messages.");
    return;
  }

  renderPosts(data || []);
  setStatus("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return;

  const name = nameInput.value.trim();
  const message = messageInput.value.trim();

  if (!name || !message) return;

  submitButton.disabled = true;
  setStatus("posting...");

  const { error } = await db
    .from("messages")
    .insert([{ name, message }]);

  submitButton.disabled = false;

  if (error) {
    console.error(error);
    setStatus("could not post message.");
    return;
  }

  messageInput.value = "";
  charCount.textContent = "0 / 500";
  setStatus("posted.");
  await loadPosts();
  messageInput.focus();
});

messageInput.addEventListener("input", () => {
  charCount.textContent = `${messageInput.value.length} / 500`;
});

refreshButton.addEventListener("click", loadPosts);

if (db) {
  loadPosts();

  db.channel("message-board-updates")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      loadPosts
    )
    .subscribe();
}
