// !! QUAN TRỌNG !!
// URL API đã deploy trên Render của bạn
const API_URL = "https://apidichtienganh.onrender.com/api/translate";

/**
 * Hàm này CHỈ LẮNG NGHE tin nhắn từ popup.js
 * Nó không tự động chạy khi tải trang.
 */
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "TRANSLATE_PAGE") {
        console.log("SmartTranslator: Nhận được lệnh dịch...");
        
        // Bắt đầu hàm dịch thuật chính
        // Dùng .then() vì addListener không thích async/await trực tiếp
        translatePage().then(() => {
            sendResponse({ status: "success" });
        }).catch(error => {
            console.error("SmartTranslator Lỗi:", error);
            sendResponse({ status: "error", message: error.message });
        });
        
        // Trả về 'true' để báo hiệu rằng sendResponse sẽ được gọi bất đồng bộ
        return true; 
    }
});

/**
 * Hàm dịch thuật chính (async)
 */
async function translatePage() {
    const textNodes = [];
    
    // 1. Tìm tất cả các node văn bản trên trang
    findTextNodes(document.body, textNodes);
    if (textNodes.length === 0) {
        console.log("SmartTranslator: Không tìm thấy văn bản để dịch.");
        return;
    }

    // 2. Lấy nội dung văn bản gốc từ các node
    const originalTexts = textNodes.map(node => node.nodeValue);

    // 3. Gửi MỘT LẦN toàn bộ danh sách văn bản đến API
    console.log(`SmartTranslator: Đang gửi ${originalTexts.length} đoạn text đến API...`);
    const response = await fetch(API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ texts: originalTexts }) // Gửi dưới dạng một mảng
    });

    if (!response.ok) {
        // Nếu server trả về lỗi 4xx, 5xx
        throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json(); // Nhận về một mảng đã dịch
    const translatedTexts = data.translated_texts;

    if (!translatedTexts || translatedTexts.length !== textNodes.length) {
        throw new Error("Dữ liệu trả về từ API không khớp (data mismatch).");
    }

    // 4. Duyệt qua và thay thế văn bản
    console.log("SmartTranslator: Đang thay thế văn bản trên trang...");
    textNodes.forEach((node, index) => {
        const translatedHtml = translatedTexts[index];
        
        // Chỉ thay thế nếu nội dung khác
        if (node.nodeValue !== translatedHtml) {
            const tempWrapper = document.createElement('span'); // Dùng span
            tempWrapper.innerHTML = translatedHtml;
            
            const parent = node.parentNode;
            if (parent) {
                // Tạo một fragment để chứa tất cả các node con mới
                const fragment = document.createDocumentFragment();
                while (tempWrapper.firstChild) {
                    fragment.appendChild(tempWrapper.firstChild);
                }
                // Thay thế node text cũ bằng fragment
                parent.replaceChild(fragment, node);
            }
        }
    });
    console.log("SmartTranslator: Dịch hoàn tất!");
}

/**
 * Hàm đệ quy tìm tất cả các Text Node hợp lệ
 */
function findTextNodes(node, textNodes) {
    // Bỏ qua các thẻ không nên dịch
    const excludeTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'IFRAME', 'CANVAS'];
    if (!node || excludeTags.includes(node.nodeName)) {
        return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
        // Chỉ lấy các node có văn bản thực sự (không phải chỉ khoảng trắng)
        if (node.nodeValue.trim() !== '') {
            textNodes.push(node);
        }
    } else {
        // Tiếp tục tìm trong các node con
        for (const child of node.childNodes) {
            findTextNodes(child, textNodes);
        }
    }
}
