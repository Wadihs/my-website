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
const MAX_IMAGE_DIMENSION = 150;
const MAX_SOURCE_FILE_BYTES = 12 * 1024 * 1024;

const configured =
  SUPABASE_URL &&
  SUPABASE_PUBLIC_KEY &&
  !SUPABASE_URL.includes("YOUR-PROJECT") &&
  !SUPABASE_PUBLIC_KEY.includes("YOUR-PUBLISHABLE");

let db = null;
let folders = [];
let selectedFolderId = null;

if (configured) {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
} else {
  statusText.textContent =
    "Supabase is not configured yet. Edit config.js with your project URL and publishable/anon key.";
  submitButton.disabled = true;
  createFolderButton.disabled = true;
}

function setStatus(message) {
  statusText.textContent = message;
}

function setFolderStatus(message) {
  folderStatus.textContent = message;
}

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

function renderFolders() {
  foldersList.innerHTML = "";

  if (!folders.length) {
    foldersList.textContent = "no folders yet.";
    updateFolderHeading();
    return;
  }

  folders.forEach((folder) => {
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

    foldersList.append(link);
  });

  updateFolderHeading();
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

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.86);
  });

  if (!blob) {
    throw new Error("could not resize picture.");
  }

  return { blob, width, height };
}

async function uploadPostImage(file) {
  if (!file) return null;

  const resized = await resizeImage(file);
  const safeId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const filePath = `${new Date().toISOString().slice(0, 10)}/${safeId}.jpg`;

  const { error } = await db.storage
    .from(IMAGE_BUCKET)
    .upload(filePath, resized.blob, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: false
    });

  if (error) throw error;
  return filePath;
}

function getPublicImageUrl(path) {
  if (!path || !db) return null;
  const { data } = db.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
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
    setFolderStatus("could not load folders. did you run folder_migration.sql?");
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
  url.searchParams.set("folder", folderId);
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

  createFolderButton.disabled = true;
  setFolderStatus("creating...");

  const { data, error } = await db
    .from("folders")
    .insert([{ name }])
    .select("id,name")
    .single();

  createFolderButton.disabled = false;

  if (error) {
    console.error(error);

    if (error.code === "23505") {
      setFolderStatus("a folder with that name already exists.");
    } else {
      setFolderStatus("could not create folder.");
    }
    return;
  }

  folderNameInput.value = "";
  setFolderStatus("created.");
  await loadFolders(data.id);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db || !selectedFolderId) return;

  const name = nameInput.value.trim();
  const message = messageInput.value.trim();

  if (!name || !message) return;

  submitButton.disabled = true;
  setStatus("posting...");

  try {
    let imagePath = null;

    if (postImageInput.files && postImageInput.files[0]) {
      setStatus("resizing and uploading picture...");
      imagePath = await uploadPostImage(postImageInput.files[0]);
    }

    setStatus("posting...");

    const { error } = await db
      .from("messages")
      .insert([{
        name,
        message,
        folder_id: selectedFolderId,
        image_path: imagePath
      }]);

    if (error) throw error;

    messageInput.value = "";
    charCount.textContent = "0 / 500";
    clearSelectedImage();
    setStatus("posted.");
    await loadPosts();
    messageInput.focus();
  } catch (error) {
    console.error(error);
    setStatus(error?.message || "could not post message or picture.");
  } finally {
    submitButton.disabled = false;
  }
});

messageInput.addEventListener("input", () => {
  charCount.textContent = `${messageInput.value.length} / 500`;
});

postImageInput.addEventListener("change", async () => {
  const file = postImageInput.files && postImageInput.files[0];

  if (!file) {
    clearSelectedImage();
    return;
  }

  try {
    setStatus("preparing picture preview...");
    const { blob } = await resizeImage(file);
    const previewUrl = URL.createObjectURL(blob);

    imagePreview.onload = () => URL.revokeObjectURL(previewUrl);
    imagePreview.src = previewUrl;
    imagePreviewWrap.hidden = false;
    setStatus("");
  } catch (error) {
    console.error(error);
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

        if (
          !changedFolderId ||
          String(changedFolderId) === String(selectedFolderId)
        ) {
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
