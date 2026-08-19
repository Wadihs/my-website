const form = document.getElementById("messageForm");
const nameInput = document.getElementById("name");
const messageInput = document.getElementById("message");
const messageBoard = document.getElementById("messageBoard");
const emptyState = document.getElementById("emptyState");
const charCount = document.getElementById("charCount");
const statusText = document.getElementById("status");
const submitButton = document.getElementById("submitButton");
const refreshButton = document.getElementById("refreshBoard");
const foldersList = document.getElementById("foldersList");
const folderForm = document.getElementById("folderForm");
const folderNameInput = document.getElementById("folderName");
const folderStatus = document.getElementById("folderStatus");
const createFolderButton = document.getElementById("createFolderButton");
const refreshFoldersButton = document.getElementById("refreshFolders");
const currentFolderTitle = document.getElementById("currentFolderTitle");
const postFolderName = document.getElementById("postFolderName");
const postImageInput = document.getElementById("postImage");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imagePreview = document.getElementById("imagePreview");
const removeImageButton = document.getElementById("removeImage");

const IMAGE_BUCKET = "post-images";
const MAX_IMAGE_DIMENSION = 500;
const MAX_SOURCE_FILE_BYTES = 12 * 1024 * 1024;
const DELETE_WINDOW_MS = 3 * 60 * 1000;

const POST_TOKEN_KEY = "messageBoardPostDeleteTokens";
const FOLDER_TOKEN_KEY = "messageBoardFolderDeleteTokens";

const configured =
  SUPABASE_URL &&
  SUPABASE_PUBLIC_KEY &&
  !SUPABASE_URL.includes("YOUR-PROJECT") &&
  !SUPABASE_PUBLIC_KEY.includes("YOUR-PUBLISHABLE");

let db = null;
let folders = [];
let selectedFolderId = null;
let countdownTimer = null;

if (configured) {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
} else {
  statusText.textContent = "Supabase is not configured.";
  submitButton.disabled = true;
  createFolderButton.disabled = true;
}

function loadTokenMap(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function saveTokenMap(key, map) {
  localStorage.setItem(key, JSON.stringify(map));
}

function storeDeleteToken(key, id, token, createdAt) {
  const map = loadTokenMap(key);
  map[String(id)] = { token, createdAt };
  saveTokenMap(key, map);
}

function getDeleteToken(key, id) {
  const map = loadTokenMap(key);
  return map[String(id)] || null;
}

function removeDeleteToken(key, id) {
  const map = loadTokenMap(key);
  delete map[String(id)];
  saveTokenMap(key, map);
}

function newToken() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function canDelete(createdAt) {
  return Date.now() - new Date(createdAt).getTime() < DELETE_WINDOW_MS;
}

function secondsRemaining(createdAt) {
  const remaining = DELETE_WINDOW_MS - (Date.now() - new Date(createdAt).getTime());
  return Math.max(0, Math.ceil(remaining / 1000));
}

function formatCountdown(createdAt) {
  const total = secondsRemaining(createdAt);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function setStatus(message) { statusText.textContent = message; }
function setFolderStatus(message) { folderStatus.textContent = message; }

function formatDate(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function selectedFolder() {
  return folders.find((folder) => String(folder.id) === String(selectedFolderId));
}

function updateFolderHeading() {
  const folder = selectedFolder();
  const name = folder ? folder.name : "folder";
  currentFolderTitle.textContent = folder ? `${name} messages` : "messages";
  postFolderName.textContent = name;
  submitButton.disabled = !db || !folder;
}

function makeDeleteButton(label, createdAt, onDelete) {
  const wrap = document.createElement("span");
  const button = document.createElement("button");
  const countdown = document.createElement("span");

  button.type = "button";
  button.className = "delete-link";
  button.textContent = label;

  countdown.className = "delete-countdown";
  countdown.dataset.createdAt = createdAt;

  button.addEventListener("click", onDelete);

  wrap.append(button, document.createTextNode(" "), countdown);
  return wrap;
}

function updateCountdowns() {
  document.querySelectorAll(".delete-countdown").forEach((node) => {
    const createdAt = node.dataset.createdAt;
    const parent = node.parentElement;
    if (!canDelete(createdAt)) {
      if (parent) parent.remove();
      return;
    }
    node.textContent = `(${formatCountdown(createdAt)})`;
  });
}

function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdowns();
  countdownTimer = setInterval(updateCountdowns, 1000);
}

function renderFolders() {
  foldersList.innerHTML = "";

  if (!folders.length) {
    foldersList.textContent = "no folders yet.";
    updateFolderHeading();
    return;
  }

  folders.forEach((folder) => {
    const row = document.createElement("div");
    row.className = "folder-row";

    const link = document.createElement("a");
    link.href = `?folder=${encodeURIComponent(folder.id)}`;
    link.className = "folder-link";
    link.textContent = folder.name;

    if (String(folder.id) === String(selectedFolderId)) {
      link.classList.add("active");
    }

    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectFolder(folder.id);
    });

    row.append(link);

    const ownership = getDeleteToken(FOLDER_TOKEN_KEY, folder.id);
    if (ownership && canDelete(folder.created_at)) {
      row.append(
        makeDeleteButton("delete", folder.created_at, async () => {
          if (!confirm(`delete folder "${folder.name}"? it must be empty.`)) return;
          await deleteOwnFolder(folder);
        })
      );
    }

    foldersList.append(row);
  });

  updateFolderHeading();
  startCountdownTimer();
}

function clearSelectedImage() {
  postImageInput.value = "";
  imagePreview.removeAttribute("src");
  imagePreviewWrap.hidden = true;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("could not read image"));
    };

    img.src = objectUrl;
  });
}

async function resizeImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("please choose an image file.");
  }

  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error("picture is too large to process. choose an image under 12 MB.");
  }

  const img = await loadImageElement(file);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / img.naturalWidth,
    MAX_IMAGE_DIMENSION / img.naturalHeight
  );

  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.86)
  );

  if (!blob) throw new Error("could not resize picture.");
  return { blob };
}

async function uploadPostImage(file) {
  if (!file) return null;

  const { blob } = await resizeImage(file);
  const id = newToken();
  const path = `${new Date().toISOString().slice(0, 10)}/${id}.jpg`;

  const { error } = await db.storage
    .from(IMAGE_BUCKET)
    .upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false
    });

  if (error) throw error;
  return path;
}

function getPublicImageUrl(path) {
  if (!path || !db) return null;
  return db.storage.from(IMAGE_BUCKET).getPublicUrl(path).data?.publicUrl || null;
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

    header.append(author, time);

    const ownership = getDeleteToken(POST_TOKEN_KEY, post.id);
    if (ownership && canDelete(post.created_at)) {
      header.append(
        makeDeleteButton("delete", post.created_at, async () => {
          if (!confirm("delete this post?")) return;
          await deleteOwnPost(post);
        })
      );
    }

    const text = document.createElement("p");
    text.className = "message-text";
    text.textContent = post.message;

    item.append(header, text);

    if (post.image_path) {
      const publicUrl = getPublicImageUrl(post.image_path);
      if (publicUrl) {
        const image = document.createElement("img");
        image.className = "post-image";
        image.src = publicUrl;
        image.alt = "post picture";
        image.loading = "lazy";
        item.append(image);
      }
    }

    messageBoard.append(item);
  });

  startCountdownTimer();
}

async function deleteOwnPost(post) {
  const ownership = getDeleteToken(POST_TOKEN_KEY, post.id);
  if (!ownership) {
    setStatus("delete permission is not available in this browser.");
    return;
  }

  setStatus("deleting...");

  const { data, error } = await db.rpc("delete_own_message", {
    p_message_id: post.id,
    p_delete_token: ownership.token
  });

  if (error) {
    console.error(error);
    setStatus("could not delete post.");
    return;
  }

  if (!data) {
    setStatus("the 3-minute delete window has expired.");
    removeDeleteToken(POST_TOKEN_KEY, post.id);
    await loadPosts();
    return;
  }

  removeDeleteToken(POST_TOKEN_KEY, post.id);

  // Best effort: remove the image too. If Storage denies deletion, the post is
  // still removed; the image can later be cleaned up by the site owner.
  if (post.image_path) {
    try {
      await db.storage.from(IMAGE_BUCKET).remove([post.image_path]);
    } catch (_) {}
  }

  setStatus("deleted.");
  await loadPosts();
}

async function deleteOwnFolder(folder) {
  const ownership = getDeleteToken(FOLDER_TOKEN_KEY, folder.id);
  if (!ownership) {
    setFolderStatus("delete permission is not available in this browser.");
    return;
  }

  setFolderStatus("deleting...");

  const { data, error } = await db.rpc("delete_own_folder", {
    p_folder_id: folder.id,
    p_delete_token: ownership.token
  });

  if (error) {
    console.error(error);
    setFolderStatus("could not delete folder. it may contain messages.");
    return;
  }

  if (!data) {
    setFolderStatus("folder could not be deleted. the 3-minute window may have expired, or the folder is not empty.");
    removeDeleteToken(FOLDER_TOKEN_KEY, folder.id);
    await loadFolders();
    return;
  }

  removeDeleteToken(FOLDER_TOKEN_KEY, folder.id);
  setFolderStatus("deleted.");
  selectedFolderId = null;
  await loadFolders();
}

async function loadFolders(preferredFolderId = null) {
  if (!db) return;

  setFolderStatus("loading folders...");

  const { data, error } = await db
    .from("folders")
    .select("id,name,created_at")
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    setFolderStatus("could not load folders.");
    return;
  }

  folders = data || [];

  const requested =
    preferredFolderId ??
    new URLSearchParams(window.location.search).get("folder");

  const requestedExists = folders.some(
    (folder) => String(folder.id) === String(requested)
  );

  const currentExists = folders.some(
    (folder) => String(folder.id) === String(selectedFolderId)
  );

  if (requestedExists) {
    selectedFolderId = requested;
  } else if (!currentExists) {
    selectedFolderId = folders.length ? folders[0].id : null;
  }

  renderFolders();
  setFolderStatus("");

  if (selectedFolderId) {
    setFolderUrl(selectedFolderId);
    await loadPosts();
  } else {
    renderPosts([]);
  }
}

function setFolderUrl(folderId) {
  const url = new URL(window.location.href);
  if (folderId) url.searchParams.set("folder", folderId);
  else url.searchParams.delete("folder");
  window.history.replaceState({}, "", url);
}

async function selectFolder(folderId) {
  selectedFolderId = folderId;
  setFolderUrl(folderId);
  renderFolders();
  await loadPosts();
}

async function loadPosts() {
  if (!db || !selectedFolderId) return;

  setStatus("loading messages...");

  const { data, error } = await db
    .from("messages")
    .select("id,name,message,created_at,folder_id,image_path")
    .eq("folder_id", selectedFolderId)
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

folderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return;

  const name = folderNameInput.value.trim();
  if (!name) return;

  const deleteToken = newToken();

  createFolderButton.disabled = true;
  setFolderStatus("creating...");

  const { data, error } = await db
    .from("folders")
    .insert([{ name, delete_token: deleteToken }])
    .select("id,name,created_at")
    .single();

  createFolderButton.disabled = false;

  if (error) {
    console.error(error);
    setFolderStatus(
      error.code === "23505"
        ? "a folder with that name already exists."
        : "could not create folder."
    );
    return;
  }

  storeDeleteToken(FOLDER_TOKEN_KEY, data.id, deleteToken, data.created_at);
  folderNameInput.value = "";
  setFolderStatus("created. you can delete it for 3 minutes.");
  await loadFolders(data.id);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db || !selectedFolderId) return;

  const name = nameInput.value.trim();
  const message = messageInput.value.trim();

  if (!name || !message) return;

  const deleteToken = newToken();

  submitButton.disabled = true;

  try {
    let imagePath = null;

    if (postImageInput.files?.[0]) {
      setStatus("resizing and uploading picture...");
      imagePath = await uploadPostImage(postImageInput.files[0]);
    }

    setStatus("posting...");

    const { data, error } = await db
      .from("messages")
      .insert([{
        name,
        message,
        folder_id: selectedFolderId,
        image_path: imagePath,
        delete_token: deleteToken
      }])
      .select("id,created_at")
      .single();

    if (error) throw error;

    storeDeleteToken(POST_TOKEN_KEY, data.id, deleteToken, data.created_at);

    messageInput.value = "";
    charCount.textContent = "0 / 500";
    clearSelectedImage();

    setStatus("posted. you can delete it for 3 minutes.");
    await loadPosts();
    messageInput.focus();
  } catch (error) {
    console.error(error);
    setStatus(error?.message || "could not post.");
  } finally {
    submitButton.disabled = false;
  }
});

messageInput.addEventListener("input", () => {
  charCount.textContent = `${messageInput.value.length} / 500`;
});

postImageInput.addEventListener("change", async () => {
  const file = postImageInput.files?.[0];

  if (!file) {
    clearSelectedImage();
    return;
  }

  try {
    const { blob } = await resizeImage(file);
    const previewUrl = URL.createObjectURL(blob);

    imagePreview.onload = () => URL.revokeObjectURL(previewUrl);
    imagePreview.src = previewUrl;
    imagePreviewWrap.hidden = false;
    setStatus("");
  } catch (error) {
    clearSelectedImage();
    setStatus(error?.message || "could not use that picture.");
  }
});

removeImageButton.addEventListener("click", () => {
  clearSelectedImage();
  setStatus("");
});

refreshButton.addEventListener("click", loadPosts);
refreshFoldersButton.addEventListener("click", () => loadFolders(selectedFolderId));

if (db) {
  loadFolders();

  db.channel("message-board-updates")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      (payload) => {
        const changedFolderId = payload.new?.folder_id ?? payload.old?.folder_id;
        if (!changedFolderId || String(changedFolderId) === String(selectedFolderId)) {
          loadPosts();
        }
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "folders" },
      () => loadFolders(selectedFolderId)
    )
    .subscribe();
}
