// --- CẤU HÌNH ---
// API backend (thay nếu bạn deploy URL khác)
const API_URL = "https://apidichtienganh.onrender.com/api/translate";

// --- CẤU HÌNH CHIA NHỎ ---
const CHUNK_SIZE = 30; // số đoạn mỗi batch (tối ưu nhất)
const MAX_CONCURRENT = 5; // chỉ gửi tối đa 5 batch song song

/**
 * Hàm tìm tất cả text node hợp lệ để dịch.
 */
function findTextNodes(node, textNodes) {
  if (node.nodeType === Node.TEXT_NODE) {
    const parentTag = node.parentNode ? node.parentNode.nodeName.toUpperCase() : '';
    if (
      node.nodeValue.trim() !== '' &&
      parentTag !== 'SCRIPT' &&
      parentTag !== 'STYLE' &&
      (!node.parentNode.dataset || !node.parentNode.dataset.translatedTerm)
    ) {
      textNodes.push(node);
    }
  } else {
    const nodeName = node.nodeName.toUpperCase();
    if (nodeName !== 'SCRIPT' && nodeName !== 'STYLE' && nodeName !== 'NOSCRIPT') {
      for (const child of node.childNodes) {
        findTextNodes(child, textNodes);
      }
    }
  }
}

/**
 * Kích hoạt tooltip Bootstrap sau khi cập nhật DOM.
 */
function initializeTooltips() {
  if (typeof bootstrap === 'undefined' || typeof bootstrap.Tooltip !== 'function') return;
  const oldTooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  oldTooltips.forEach(el => {
    const instance = bootstrap.Tooltip.getInstance(el);
    if (instance) instance.dispose();
  });
  const newTooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  newTooltips.forEach(el => {
    el.dataset.translatedTerm = 'true';
    new bootstrap.Tooltip(el);
  });
}

/**
 * Gửi 1 batch lên API.
 */
async function translateBatch(chunkNodes, batchIndex, totalChunks) {
  const texts = chunkNodes.map(n => n.nodeValue);

  try {
    console.log(`[SmartTranslator] 🚀 Gửi batch ${batchIndex + 1}/${totalChunks} (${texts.length} đoạn)`);
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (!data.translations || data.translations.length !== chunkNodes.length) {
      console.warn(`[SmartTranslator] ⚠ Batch ${batchIndex + 1} trả về không khớp số lượng.`);
      return;
    }

    // --- Cập nhật DOM ---
    data.translations.forEach((item, i) => {
      const node = chunkNodes[i];
      if (!node || !node.isConnected) return;

      try {
        if (item.type === 'html' && item.content.trim() !== '') {
          const temp = document.createElement('div');
          temp.innerHTML = item.content.trim();
          const newNode = temp.firstChild;
          if (newNode) node.parentNode.replaceChild(newNode, node);
        } else if (item.type === 'plain') {
          node.nodeValue = item.content;
        }
      } catch (e) {
        console.error(`[SmartTranslator] ❌ Lỗi cập nhật DOM batch ${batchIndex + 1}:`, e);
      }
    });

    initializeTooltips();
    console.log(`[SmartTranslator] ✅ Batch ${batchIndex + 1} hoàn tất.`);
  } catch (err) {
    console.error(`[SmartTranslator] ❌ Lỗi batch ${batchIndex + 1}:`, err);
  }
}

/**
 * Giới hạn số batch gửi song song (giống semaphore).
 */
async function runBatchesWithLimit(tasks, limit) {
  const running = [];
  for (const task of tasks) {
    const p = task().finally(() => {
      const idx = running.indexOf(p);
      running.splice(idx, 1);
    });
    running.push(p);
    if (running.length >= limit) await Promise.race(running);
  }
  await Promise.all(running);
}

/**
 * Hàm chính để dịch trang.
 */
async function translatePage() {
  console.log('[SmartTranslator] 🔍 Đang tìm text để dịch...');
  const textNodes = [];
  findTextNodes(document.body, textNodes);

  if (!textNodes.length) {
    console.log('[SmartTranslator] Không có văn bản cần dịch.');
    return;
  }

  const totalChunks = Math.ceil(textNodes.length / CHUNK_SIZE);
  console.log(`[SmartTranslator] Tổng cộng ${textNodes.length} đoạn, chia thành ${totalChunks} batch.`);

  const tasks = [];
  for (let i = 0; i < textNodes.length; i += CHUNK_SIZE) {
    const chunkNodes = textNodes.slice(i, i + CHUNK_SIZE);
    const batchIndex = i / CHUNK_SIZE;
    tasks.push(() => translateBatch(chunkNodes, batchIndex, totalChunks));
  }

  // Gửi batch song song (giới hạn MAX_CONCURRENT)
  await runBatchesWithLimit(tasks, MAX_CONCURRENT);
  console.log('[SmartTranslator] 🎉 Hoàn tất dịch trang!');
}

/**
 * Lắng nghe từ popup.
 */
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'translate') {
    translatePage()
      .then(() => sendResponse({ status: 'success' }))
      .catch(err => sendResponse({ status: 'error', message: err.message }));
    return true;
  }
});
