import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
import { PDFDocument, rgb, StandardFonts } from "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const pdfInput = document.getElementById("pdfInput");
const textBtn = document.getElementById("textBtn");
const signBtn = document.getElementById("signBtn");
const whiteoutBtn = document.getElementById("whiteoutBtn");
const deleteBtn = document.getElementById("deleteBtn");
const printBtn = document.getElementById("printBtn");
const downloadBtn = document.getElementById("downloadBtn");
const viewer = document.getElementById("viewer");

const textTools = document.getElementById("textTools");
const fontFamily = document.getElementById("fontFamily");
const fontSize = document.getElementById("fontSize");
const fontColor = document.getElementById("fontColor");
const boldBtn = document.getElementById("boldBtn");

const signatureModal = document.getElementById("signatureModal");
const signatureCanvas = document.getElementById("signatureCanvas");
const clearSignature = document.getElementById("clearSignature");
const cancelSignature = document.getElementById("cancelSignature");
const useSignature = document.getElementById("useSignature");

let originalBytes = null;
let pdfDocJs = null;
let pageData = [];
let activeTool = null;
let selectedItem = null;
let savedSignature = null;
let whiteoutDraft = null;

let currentTextStyle = {
  fontFamily: "Helvetica",
  fontSize: 18,
  color: "#000000",
  bold: false
};

const MAX_SCALE = 1.4;
const MOBILE_PAGE_GUTTER = 16;

function setEnabled(enabled) {
  textBtn.disabled = !enabled;
  signBtn.disabled = !enabled;
  whiteoutBtn.disabled = !enabled;
  printBtn.disabled = !enabled;
  downloadBtn.disabled = !enabled;
}

function updateToolButtons() {
  textBtn.classList.toggle("active", activeTool === "text");
  whiteoutBtn.classList.toggle("active", activeTool === "whiteout");
  textTools.classList.toggle(
    "hidden",
    !(activeTool === "text" || selectedItem?.item?.type === "text")
  );
}

function clearSelection() {
  if (selectedItem?.el) selectedItem.el.classList.remove("selected");
  selectedItem = null;
  deleteBtn.disabled = true;
  updateToolButtons();
}

function syncStyleControlsFromCurrent() {
  fontFamily.value = currentTextStyle.fontFamily;
  fontSize.value = currentTextStyle.fontSize;
  fontColor.value = currentTextStyle.color;
  boldBtn.classList.toggle("active", currentTextStyle.bold);
}

function syncCurrentFromStyleControls() {
  currentTextStyle = {
    fontFamily: fontFamily.value,
    fontSize: Math.max(8, Math.min(72, Number(fontSize.value) || 18)),
    color: fontColor.value,
    bold: boldBtn.classList.contains("active")
  };
}

function applyStyleToSelectedText() {
  if (!selectedItem || selectedItem.item.type !== "text") return;
  syncCurrentFromStyleControls();
  Object.assign(selectedItem.item, currentTextStyle);
  applyTextVisuals(selectedItem.el, selectedItem.item);
}

function hexToRgb01(hex) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255
  };
}

pdfInput.addEventListener("change", async () => {
  const file = pdfInput.files[0];
  if (!file) return;
  originalBytes = new Uint8Array(await file.arrayBuffer());
  await renderPDF();
});

async function renderPDF() {
  viewer.innerHTML = "";
  pageData = [];
  selectedItem = null;
  deleteBtn.disabled = true;
  activeTool = null;

  pdfDocJs = await pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;

  for (let pageNumber = 1; pageNumber <= pdfDocJs.numPages; pageNumber++) {
    const pdfPage = await pdfDocJs.getPage(pageNumber);
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const availableWidth = Math.max(280, window.innerWidth - MOBILE_PAGE_GUTTER);
    const responsiveScale = Math.min(MAX_SCALE, availableWidth / baseViewport.width);
    const viewport = pdfPage.getViewport({ scale: responsiveScale });

    const page = document.createElement("div");
    page.className = "page";
    page.style.width = viewport.width + "px";
    page.style.height = viewport.height + "px";

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";

    const overlay = document.createElement("div");
    overlay.className = "overlay";

    page.append(canvas, overlay);
    viewer.appendChild(page);

    await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    const state = {
      pageNumber,
      overlay,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      pdfWidth: pdfPage.view[2] - pdfPage.view[0],
      pdfHeight: pdfPage.view[3] - pdfPage.view[1],
      items: []
    };
    pageData.push(state);

    overlay.addEventListener("click", e => {
      if (e.target !== overlay || !activeTool || activeTool === "whiteout") return;
      const rect = overlay.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (activeTool === "text") {
        const text = prompt("Enter text:");
        if (text) addText(state, x, y, text);
      } else if (activeTool === "signature" && savedSignature) {
        addSignature(state, x, y, savedSignature);
        activeTool = null;
        updateToolButtons();
      }
    });

    overlay.addEventListener("pointerdown", e => {
      if (activeTool !== "whiteout" || e.target !== overlay) return;
      e.preventDefault();
      clearSelection();
      const rect = overlay.getBoundingClientRect();
      const startX = Math.max(0, Math.min(state.viewportWidth, e.clientX - rect.left));
      const startY = Math.max(0, Math.min(state.viewportHeight, e.clientY - rect.top));

      const draft = document.createElement("div");
      draft.className = "whiteout-draft";
      draft.style.left = startX + "px";
      draft.style.top = startY + "px";
      overlay.appendChild(draft);
      whiteoutDraft = draft;
      overlay.setPointerCapture(e.pointerId);

      const move = ev => {
        const x = Math.max(0, Math.min(state.viewportWidth, ev.clientX - rect.left));
        const y = Math.max(0, Math.min(state.viewportHeight, ev.clientY - rect.top));
        const left = Math.min(startX, x);
        const top = Math.min(startY, y);
        const width = Math.abs(x - startX);
        const height = Math.abs(y - startY);
        draft.style.left = left + "px";
        draft.style.top = top + "px";
        draft.style.width = width + "px";
        draft.style.height = height + "px";
      };

      const finish = ev => {
        const x = Math.max(0, Math.min(state.viewportWidth, ev.clientX - rect.left));
        const y = Math.max(0, Math.min(state.viewportHeight, ev.clientY - rect.top));
        const left = Math.min(startX, x);
        const top = Math.min(startY, y);
        const width = Math.abs(x - startX);
        const height = Math.abs(y - startY);
        draft.remove();
        whiteoutDraft = null;
        overlay.removeEventListener("pointermove", move);
        overlay.removeEventListener("pointerup", finish);
        overlay.removeEventListener("pointercancel", cancel);
        if (width >= 8 && height >= 8) addWhiteout(state, left, top, width, height);
      };

      const cancel = () => {
        draft.remove();
        whiteoutDraft = null;
        overlay.removeEventListener("pointermove", move);
        overlay.removeEventListener("pointerup", finish);
        overlay.removeEventListener("pointercancel", cancel);
      };

      overlay.addEventListener("pointermove", move);
      overlay.addEventListener("pointerup", finish);
      overlay.addEventListener("pointercancel", cancel);
    });
  }

  setEnabled(true);
  updateToolButtons();
}

textBtn.addEventListener("click", () => {
  activeTool = activeTool === "text" ? null : "text";
  updateToolButtons();
});

whiteoutBtn.addEventListener("click", () => {
  activeTool = activeTool === "whiteout" ? null : "whiteout";
  updateToolButtons();
});

fontFamily.addEventListener("change", applyStyleToSelectedText);
fontSize.addEventListener("change", applyStyleToSelectedText);
fontColor.addEventListener("input", applyStyleToSelectedText);

boldBtn.addEventListener("click", () => {
  boldBtn.classList.toggle("active");
  applyStyleToSelectedText();
  if (!selectedItem || selectedItem.item.type !== "text") syncCurrentFromStyleControls();
});

signBtn.addEventListener("click", openSignatureModal);

function addText(state, x, y, text) {
  syncCurrentFromStyleControls();
  const item = {
    type: "text",
    text,
    x,
    y,
    width: Math.max(90, text.length * currentTextStyle.fontSize * 0.62),
    height: Math.max(28, currentTextStyle.fontSize * 1.4),
    ...currentTextStyle
  };
  state.items.push(item);

  const el = document.createElement("div");
  el.className = "item text-item";
  el.textContent = text;
  applyTextVisuals(el, item);
  placeItem(el, state, item);

  el.addEventListener("dblclick", e => {
    e.stopPropagation();
    const edited = prompt("Edit text:", item.text);
    if (edited !== null && edited !== "") {
      item.text = edited;
      el.childNodes[0].nodeValue = edited;
    }
  });
}

function applyTextVisuals(el, item) {
  const familyMap = {
    Helvetica: "Arial, Helvetica, sans-serif",
    TimesRoman: '"Times New Roman", Times, serif',
    Courier: '"Courier New", Courier, monospace'
  };
  el.style.fontFamily = familyMap[item.fontFamily] || familyMap.Helvetica;
  el.style.fontSize = item.fontSize + "px";
  el.style.color = item.color;
  el.style.fontWeight = item.bold ? "700" : "400";
}

function addSignature(state, x, y, dataUrl) {
  const item = { type: "signature", dataUrl, x, y, width: 160, height: 70 };
  state.items.push(item);
  const el = document.createElement("div");
  el.className = "item signature-item";
  const img = document.createElement("img");
  img.src = dataUrl;
  el.appendChild(img);
  placeItem(el, state, item);
}

function addWhiteout(state, x, y, width, height) {
  const item = { type: "whiteout", x, y, width, height };
  state.items.push(item);
  const el = document.createElement("div");
  el.className = "item whiteout-item";
  placeItem(el, state, item);
}

function placeItem(el, state, item) {
  el.style.left = item.x + "px";
  el.style.top = item.y + "px";
  el.style.width = item.width + "px";
  el.style.height = item.height + "px";

  const handle = document.createElement("div");
  handle.className = "resize-handle";
  el.appendChild(handle);
  state.overlay.appendChild(el);

  el.addEventListener("pointerdown", e => {
    if (e.target === handle) return;
    e.stopPropagation();
    selectItem(el, state, item);
    startDrag(e, el, state, item);
  });

  handle.addEventListener("pointerdown", e => {
    e.stopPropagation();
    selectItem(el, state, item);
    startResize(e, el, state, item);
  });

  selectItem(el, state, item);
}

function selectItem(el, state, item) {
  if (selectedItem?.el) selectedItem.el.classList.remove("selected");
  selectedItem = { el, state, item };
  el.classList.add("selected");
  deleteBtn.disabled = false;

  if (item.type === "text") {
    currentTextStyle = {
      fontFamily: item.fontFamily,
      fontSize: item.fontSize,
      color: item.color,
      bold: item.bold
    };
    syncStyleControlsFromCurrent();
  }
  updateToolButtons();
}

function startDrag(e, el, state, item) {
  const startX = e.clientX;
  const startY = e.clientY;
  const startLeft = item.x;
  const startTop = item.y;
  el.setPointerCapture(e.pointerId);

  const move = ev => {
    item.x = Math.max(0, Math.min(state.viewportWidth - item.width, startLeft + ev.clientX - startX));
    item.y = Math.max(0, Math.min(state.viewportHeight - item.height, startTop + ev.clientY - startY));
    el.style.left = item.x + "px";
    el.style.top = item.y + "px";
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

function startResize(e, el, state, item) {
  const startX = e.clientX;
  const startY = e.clientY;
  const startWidth = item.width;
  const startHeight = item.height;
  el.setPointerCapture(e.pointerId);

  const move = ev => {
    item.width = Math.max(8, Math.min(state.viewportWidth - item.x, startWidth + ev.clientX - startX));
    item.height = Math.max(8, Math.min(state.viewportHeight - item.y, startHeight + ev.clientY - startY));
    el.style.width = item.width + "px";
    el.style.height = item.height + "px";
    if (item.type === "text") {
      item.fontSize = Math.max(8, Math.min(72, item.height * 0.58));
      el.style.fontSize = item.fontSize + "px";
      fontSize.value = Math.round(item.fontSize);
    }
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
}

function deleteSelected() {
  if (!selectedItem) return;
  const { el, state, item } = selectedItem;
  state.items = state.items.filter(x => x !== item);
  el.remove();
  clearSelection();
}

deleteBtn.addEventListener("click", deleteSelected);

document.addEventListener("keydown", e => {
  const tag = document.activeElement?.tagName;
  if ((e.key === "Delete" || e.key === "Backspace") && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
    if (selectedItem) {
      e.preventDefault();
      deleteSelected();
    }
  }
  if (e.key === "Escape") {
    activeTool = null;
    updateToolButtons();
  }
});

document.addEventListener("pointerdown", e => {
  if (!e.target.closest(".item") && !e.target.closest(".toolbar") && !e.target.closest(".modal-box")) {
    clearSelection();
  }
});

function openSignatureModal() {
  signatureModal.classList.remove("hidden");
  const rect = signatureCanvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  signatureCanvas.width = rect.width * ratio;
  signatureCanvas.height = rect.height * ratio;

  const ctx = signatureCanvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#111";

  let drawing = false;
  function point(e) {
    const r = signatureCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  signatureCanvas.onpointerdown = e => {
    drawing = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  signatureCanvas.onpointermove = e => {
    if (!drawing) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  signatureCanvas.onpointerup = () => drawing = false;
  signatureCanvas.onpointerleave = () => drawing = false;
}

clearSignature.addEventListener("click", () => {
  const ctx = signatureCanvas.getContext("2d");
  ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
});
cancelSignature.addEventListener("click", () => signatureModal.classList.add("hidden"));
useSignature.addEventListener("click", () => {
  savedSignature = signatureCanvas.toDataURL("image/png");
  signatureModal.classList.add("hidden");
  activeTool = "signature";
  updateToolButtons();
});

downloadBtn.addEventListener("click", async () => {
  const bytes = await buildFinalPDF();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "edited-document.pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

printBtn.addEventListener("click", async () => {
  const bytes = await buildFinalPDF();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    alert("Please allow popups to print the PDF.");
    return;
  }
  setTimeout(() => {
    win.focus();
    win.print();
  }, 1200);
});

async function buildFinalPDF() {
  const pdf = await PDFDocument.load(originalBytes);
  const fonts = {
    Helvetica: {
      regular: await pdf.embedFont(StandardFonts.Helvetica),
      bold: await pdf.embedFont(StandardFonts.HelveticaBold)
    },
    TimesRoman: {
      regular: await pdf.embedFont(StandardFonts.TimesRoman),
      bold: await pdf.embedFont(StandardFonts.TimesRomanBold)
    },
    Courier: {
      regular: await pdf.embedFont(StandardFonts.Courier),
      bold: await pdf.embedFont(StandardFonts.CourierBold)
    }
  };

  for (const state of pageData) {
    const page = pdf.getPage(state.pageNumber - 1);
    const scaleX = state.pdfWidth / state.viewportWidth;
    const scaleY = state.pdfHeight / state.viewportHeight;

    for (const item of state.items) {
      const x = item.x * scaleX;
      const yTop = item.y * scaleY;
      const width = item.width * scaleX;
      const height = item.height * scaleY;

      if (item.type === "whiteout") {
        const y = state.pdfHeight - yTop - height;
        page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1) });
      }

      if (item.type === "text") {
        const size = item.fontSize * scaleY;
        const y = state.pdfHeight - yTop - size;
        const color = hexToRgb01(item.color);
        const fontSet = fonts[item.fontFamily] || fonts.Helvetica;
        const font = item.bold ? fontSet.bold : fontSet.regular;
        page.drawText(item.text, {
          x,
          y,
          size,
          font,
          color: rgb(color.r, color.g, color.b),
          maxWidth: width
        });
      }

      if (item.type === "signature") {
        const png = await pdf.embedPng(item.dataUrl);
        const y = state.pdfHeight - yTop - height;
        page.drawImage(png, { x, y, width, height });
      }
    }
  }

  return await pdf.save();
}

syncStyleControlsFromCurrent();
