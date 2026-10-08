const databaseName = "gym-tracker";
const databaseVersion = 1;
const storeName = "workouts";
const defaultNote = "Note will appear here";
const photoAspectRatio = 5 / 6;
const maxPhotoWidth = 1200;
const maxPhotoHeight = 1440;
const maxPhotoBytes = 350 * 1024;

const addPhotoButton = document.querySelector("#add-photo-button");
const photoPicker = document.querySelector("#photo-picker");
const entryFlow = document.querySelector("#entry-flow");
const entryPhoto = document.querySelector("#entry-photo");
const noteForm = document.querySelector("#note-form");
const noteInput = document.querySelector("#note-input");
const confirmation = document.querySelector("#confirmation");
const confirmationNote = document.querySelector("#confirmation-note");
const cancelEntryButton = document.querySelector("#cancel-entry");
const saveEntryButton = document.querySelector("#save-entry");
const flowError = document.querySelector("#flow-error");
const appError = document.querySelector("#app-error");
const photoColumns = [...document.querySelectorAll(".photo-column")];
const objectUrls = new Set();

let database;
let pendingPhoto;
let pendingPhotoUrl;
let currentEntry;
let flowMode = "add";
let savedEntries = [];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function getAllEntries() {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function saveEntry(entry) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(entry);
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
  });
}

function deleteEntry(id) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(id);
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The browser could not encode the image."));
      }
    }, type, quality);
  });
}

async function optimizePhoto(file) {
  let bitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new Error("This image could not be opened. Try choosing a different photo.", { cause: error });
  }

  try {
    const sourceRatio = bitmap.width / bitmap.height;
    let cropWidth = bitmap.width;
    let cropHeight = bitmap.height;

    if (sourceRatio > photoAspectRatio) {
      cropWidth = bitmap.height * photoAspectRatio;
    } else {
      cropHeight = bitmap.width / photoAspectRatio;
    }

    const cropX = (bitmap.width - cropWidth) / 2;
    const cropY = (bitmap.height - cropHeight) / 2;
    let outputWidth = Math.floor(Math.min(cropWidth, maxPhotoWidth, maxPhotoHeight * photoAspectRatio));
    let outputHeight = Math.round(outputWidth / photoAspectRatio);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });

    if (!context) {
      throw new Error("Image processing is not supported by this browser.");
    }

    const mimeType = "image/webp";
    let optimized;

    for (let resizeAttempt = 0; resizeAttempt < 10; resizeAttempt += 1) {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      context.drawImage(
        bitmap,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        outputWidth,
        outputHeight,
      );

      for (const quality of [0.86, 0.8, 0.74]) {
        optimized = await canvasToBlob(canvas, mimeType, quality);
        if (optimized.type !== mimeType) {
          optimized = await canvasToBlob(canvas, "image/jpeg", quality);
        }
        if (optimized.size <= maxPhotoBytes) {
          return optimized;
        }
      }

      if (outputWidth <= 480) {
        return optimized;
      }

      outputWidth = Math.max(480, Math.floor(outputWidth * 0.85));
      outputHeight = Math.round(outputWidth / photoAspectRatio);
    }

    return optimized;
  } finally {
    bitmap.close();
  }
}

function createObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function createWorkoutCard(entry, photoUrl) {
  const card = document.createElement("article");
  card.className = `photo-card ${savedEntries.length % 2 === 0 ? "photo-card--tilt-positive" : "photo-card--tilt-negative"}`;
  card.dataset.entryId = entry.id;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open workout: ${entry.note || "photo without a note"}`);

  const photo = document.createElement("div");
  photo.className = "photo photo--uploaded";
  photo.setAttribute("role", "img");
  photo.setAttribute("aria-label", entry.note || "Saved workout photo");

  const image = document.createElement("img");
  image.src = photoUrl;
  image.alt = "";
  image.draggable = false;
  photo.append(image);

  const caption = document.createElement("div");
  caption.className = "caption";
  const text = document.createElement("span");
  text.textContent = entry.note || defaultNote;
  caption.append(text);
  card.append(photo, caption);
  return card;
}

function updateWorkoutCard(entry) {
  const card = document.querySelector(`[data-entry-id="${CSS.escape(entry.id)}"]`);
  if (!card) {
    throw new Error("The saved workout card could not be found.");
  }

  card.setAttribute("aria-label", `Open workout: ${entry.note || "photo without a note"}`);
  card.querySelector(".caption > span").textContent = entry.note || defaultNote;
}

function handleCardActivation(event) {
  const card = event.currentTarget;
  const entry = savedEntries.find((savedEntry) => savedEntry.id === card.dataset.entryId);
  if (!entry) return;

  openSavedEntry(entry);
}

function appendEntry(entry, photoUrl) {
  const shortestColumn = photoColumns.reduce((shortest, column) => {
    const columnBottom = column.getBoundingClientRect().bottom;
    const shortestBottom = shortest.getBoundingClientRect().bottom;
    return columnBottom < shortestBottom ? column : shortest;
  }, photoColumns[0]);

  const card = createWorkoutCard(entry, photoUrl);
  card.addEventListener("click", handleCardActivation);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCardActivation({ currentTarget: card });
    }
  });
  shortestColumn.append(card);
  document.querySelector(".photo-grid").classList.remove("photo-grid--empty");
  savedEntries.push(entry);
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function clearError(element) {
  element.textContent = "";
  element.hidden = true;
}

function openEntryFlow(file) {
  flowMode = "add";
  currentEntry = undefined;
  pendingPhoto = file;
  pendingPhotoUrl = createObjectUrl(file);
  entryPhoto.src = pendingPhotoUrl;
  noteInput.value = "";
  noteForm.hidden = false;
  confirmation.hidden = true;
  clearError(flowError);
  entryFlow.hidden = false;
  document.body.classList.add("has-entry-flow");

  requestAnimationFrame(() => {
    noteInput.focus({ preventScroll: true });
  });
}

function openSavedEntry(entry) {
  flowMode = "view";
  currentEntry = entry;
  pendingPhoto = entry.photo;
  pendingPhotoUrl = createObjectUrl(entry.photo);
  entryPhoto.src = pendingPhotoUrl;
  confirmationNote.textContent = entry.note || defaultNote;
  noteForm.hidden = true;
  confirmation.hidden = false;
  clearError(flowError);
  entryFlow.hidden = false;
  document.body.classList.add("has-entry-flow");
}

function openNoteEditor() {
  if (!currentEntry) return;

  flowMode = "edit";
  noteInput.value = currentEntry.note;
  noteForm.hidden = false;
  confirmation.hidden = true;
  clearError(flowError);
  requestAnimationFrame(() => noteInput.focus({ preventScroll: true }));
}

function closeEntryFlow() {
  entryFlow.hidden = true;
  document.body.classList.remove("has-entry-flow");
  entryPhoto.removeAttribute("src");
  noteInput.value = "";
  pendingPhoto = undefined;
  currentEntry = undefined;
  flowMode = "add";

  if (pendingPhotoUrl) {
    URL.revokeObjectURL(pendingPhotoUrl);
    objectUrls.delete(pendingPhotoUrl);
    pendingPhotoUrl = undefined;
  }

  photoPicker.value = "";
  clearError(flowError);
  addPhotoButton.focus({ preventScroll: true });
}

addPhotoButton.addEventListener("click", () => {
  photoPicker.click();
});

photoPicker.addEventListener("change", async () => {
  const [file] = photoPicker.files ?? [];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showError(appError, "Please choose an image file.");
    photoPicker.value = "";
    return;
  }

  clearError(appError);
  addPhotoButton.disabled = true;
  addPhotoButton.setAttribute("aria-busy", "true");

  try {
    const optimizedPhoto = await optimizePhoto(file);
    openEntryFlow(optimizedPhoto);
  } catch (error) {
    console.error("Unable to process selected workout photo.", error);
    showError(appError, error instanceof Error ? error.message : "Could not process this photo.");
    photoPicker.value = "";
  } finally {
    addPhotoButton.disabled = false;
    addPhotoButton.removeAttribute("aria-busy");
  }
});

noteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const note = noteInput.value.trim();

  if (flowMode === "edit" && currentEntry) {
    const updatedEntry = { ...currentEntry, note };
    const saveButton = noteForm.querySelector(".save-note-button");
    saveButton.disabled = true;
    saveEntry(updatedEntry)
      .then(() => {
        currentEntry = updatedEntry;
        savedEntries = savedEntries.map((entry) => entry.id === updatedEntry.id ? updatedEntry : entry);
        updateWorkoutCard(updatedEntry);
        confirmationNote.textContent = note || defaultNote;
        flowMode = "view";
        noteForm.hidden = true;
        confirmation.hidden = false;
        clearError(flowError);
      })
      .catch((error) => {
        console.error("Unable to update workout note.", error);
        showError(flowError, "Could not save your note. Please try again.");
      })
      .finally(() => {
        saveButton.disabled = false;
      });
    return;
  }

  confirmationNote.textContent = note || defaultNote;
  noteForm.hidden = true;
  confirmation.hidden = false;
  clearError(flowError);
});

confirmationNote.addEventListener("click", openNoteEditor);

cancelEntryButton.addEventListener("click", async () => {
  if (flowMode !== "view" || !currentEntry) {
    closeEntryFlow();
    return;
  }

  cancelEntryButton.disabled = true;
  try {
    const card = document.querySelector(`[data-entry-id="${CSS.escape(currentEntry.id)}"]`);
    const cardImageUrl = card?.querySelector(".photo img")?.src;
    await deleteEntry(currentEntry.id);
    card?.remove();
    savedEntries = savedEntries.filter((entry) => entry.id !== currentEntry.id);
    document.querySelector(".photo-grid").classList.toggle("photo-grid--empty", savedEntries.length === 0);
    if (cardImageUrl && cardImageUrl.startsWith("blob:")) {
      URL.revokeObjectURL(cardImageUrl);
      objectUrls.delete(cardImageUrl);
    }
    closeEntryFlow();
  } catch (error) {
    console.error("Unable to delete workout.", error);
    showError(flowError, "Could not delete this workout. Please try again.");
  } finally {
    cancelEntryButton.disabled = false;
  }
});

saveEntryButton.addEventListener("click", async () => {
  if (flowMode === "view") {
    const entryId = currentEntry?.id;
    closeEntryFlow();
    if (entryId) {
      document.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
    return;
  }

  if (!pendingPhoto || !pendingPhotoUrl) {
    showError(flowError, "Choose a photo before saving.");
    return;
  }

  saveEntryButton.disabled = true;
  const entry = {
    id: crypto.randomUUID(),
    photo: pendingPhoto,
    note: noteInput.value.trim(),
    createdAt: Date.now(),
  };

  try {
    await saveEntry(entry);
    const photoUrl = pendingPhotoUrl;
    pendingPhotoUrl = undefined;
    pendingPhoto = undefined;
    closeEntryFlow();
    appendEntry(entry, photoUrl);
    const card = document.querySelector(`[data-entry-id="${CSS.escape(entry.id)}"]`);
    card.scrollIntoView({ behavior: "smooth", block: "end" });
  } catch (error) {
    console.error("Unable to save workout photo.", error);
    showError(flowError, "Could not save this workout. Check available storage and try again.");
  } finally {
    saveEntryButton.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !entryFlow.hidden) {
    closeEntryFlow();
  }
});

window.addEventListener("pagehide", () => {
  for (const url of objectUrls) {
    URL.revokeObjectURL(url);
  }
  objectUrls.clear();
});

async function initialize() {
  try {
    database = await openDatabase();

    if (navigator.storage?.persist) {
      try {
        const persistenceGranted = await navigator.storage.persist();
        if (!persistenceGranted) {
          console.info("Browser storage remains available, but may be cleared by browser storage management.");
        }
      } catch (error) {
        console.warn("Could not request persistent browser storage.", error);
      }
    }

    const entries = await getAllEntries();
    entries.sort((first, second) => first.createdAt - second.createdAt);

    for (const entry of entries) {
      const photoUrl = createObjectUrl(entry.photo);
      appendEntry(entry, photoUrl);
    }
  } catch (error) {
    console.error("Unable to load saved workouts.", error);
    showError(appError, "Saved workouts could not be loaded in this browser.");
  }
}

initialize();
