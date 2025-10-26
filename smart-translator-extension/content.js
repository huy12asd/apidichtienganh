// --- CÀI ĐẶT ---
// Đổi URL của API ở đây.

// Dùng URL này khi test ở máy (chạy 'python app.py' ở local)
const API_URL = "http://127.0.0.1:5000/api/translate";

// Dùng URL này khi đã deploy lên Render
// const API_URL = "https://apidichtienganh.onrender.com/api/translate"; // Thay bằng URL Render của bạn
// --- HẾT CÀI ĐẶT ---


/**
 * Hàm này tìm và trả về tất cả các node văn bản cần dịch.
 * Nó sẽ bỏ qua các thẻ <script>, <style> và các văn bản rỗng.
 */
function findTextNodes(node, textNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
        const parentTag = node.parentNode ? node.parentNode.nodeName.toUpperCase() : '';
        // Bỏ qua các node đã được đánh dấu là thuật ngữ đã dịch
        if (node.nodeValue.trim() !== '' && parentTag !== 'SCRIPT' && parentTag !== 'STYLE' && (!node.parentNode || !node.parentNode.dataset.translatedTerm)) {
            textNodes.push(node);
        }
    } else {
        // Chỉ duyệt các node con nếu node này chưa được đánh dấu là thuật ngữ đã dịch
        if (!node.dataset || !node.dataset.translatedTerm) {
            // Thêm kiểm tra nodeName để tránh duyệt script/style
            const nodeName = node.nodeName.toUpperCase();
            if (nodeName !== 'SCRIPT' && nodeName !== 'STYLE') {
                for (const child of node.childNodes) {
                    findTextNodes(child, textNodes);
                }
            }
        }
    }
}

/**
 * --- HÀM MỚI: Kích hoạt Bootstrap Tooltips ---
 * Tìm tất cả các phần tử có data-bs-toggle="tooltip" và khởi tạo chúng.
 */
function initializeTooltips() {
    // Kiểm tra xem Bootstrap JS đã được nạp chưa (rất quan trọng)
    if (typeof bootstrap !== 'undefined' && typeof bootstrap.Tooltip === 'function') {
        try {
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.forEach(function (tooltipTriggerEl) {
                // Khởi tạo tooltip, tránh khởi tạo lại nếu đã có
                if (!bootstrap.Tooltip.getInstance(tooltipTriggerEl)) {
                    new bootstrap.Tooltip(tooltipTriggerEl);
                }
            });
            console.log("[SmartTranslator] Đã kích hoạt Tooltips.");
        } catch (e) {
            console.error("[SmartTranslator] Lỗi khi kích hoạt tooltips:", e);
        }
    } else {
        console.warn("[SmartTranslator] Bootstrap JS chưa được nạp trên trang này, không thể kích hoạt tooltips.");
        // Bạn có thể cân nhắc tiêm Bootstrap JS vào đây nếu muốn,
        // nhưng có thể gây xung đột với trang web gốc.
    }
}


/**
 * Hàm chính để dịch trang
 */
async function translatePage() {
    console.log("[SmartTranslator] Bat dau qua trinh dich trang...");
    const allTextNodes = [];
    findTextNodes(document.body, allTextNodes);
    
    if (allTextNodes.length === 0) {
        console.log("[SmartTranslator] Khong tim thay van ban de dich.");
        return;
    }

    const CHUNK_SIZE = 50; // Dịch 50 đoạn text một lần
    let totalTranslated = 0;

    for (let i = 0; i < allTextNodes.length; i += CHUNK_SIZE) {
        const chunkNodes = allTextNodes.slice(i, i + CHUNK_SIZE);
        // Lọc ra các node hợp lệ trước khi lấy nodeValue
        const validChunkNodes = chunkNodes.filter(node => node && node.nodeValue);
        const textsToTranslate = validChunkNodes.map(node => node.nodeValue);

        // Nếu lô này không có text hợp lệ, bỏ qua
        if (textsToTranslate.length === 0) {
             console.log(`[SmartTranslator] Bỏ qua lô ${i / CHUNK_SIZE + 1} vì không có text.`);
             continue;
        }

        try {
            console.log(`[SmartTranslator] Dang gui lo ${Math.floor(i / CHUNK_SIZE) + 1} / ${Math.ceil(allTextNodes.length / CHUNK_SIZE)}...`);
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ texts: textsToTranslate })
            });

            if (!response.ok) {
                throw new Error(`Loi HTTP! Status: ${response.status}`);
            }

            const data = await response.json(); 

            if (data.translations && data.translations.length === validChunkNodes.length) {
                validChunkNodes.forEach((node, index) => {
                    // Kiểm tra node và parentNode trước khi thao tác
                    if (!node || !node.parentNode) return;

                    const item = data.translations[index];
                    
                    if (item.type === "html") {
                        const newSpan = document.createElement('span');
                        newSpan.innerHTML = item.content;
                        // Đánh dấu thẻ span mới này là đã xử lý
                        // Chúng ta cần lấy phần tử con đầu tiên vì innerHTML tạo ra node con
                        if (newSpan.firstChild) {
                             newSpan.firstChild.dataset.translatedTerm = 'true';
                        }
                        
                        node.parentNode.replaceChild(newSpan.firstChild || newSpan, node); // Thay bằng phần tử con đầu tiên hoặc cả span nếu không có con

                    } else if (item.content.trim() !== node.nodeValue.trim()){ // Chỉ thay thế nếu nội dung thực sự thay đổi
                        node.nodeValue = item.content;
                    }
                     // Đã xóa logic đánh dấu parent bị lỗi
                });
                
                // --- GỌI HÀM KÍCH HOẠT TOOLTIP SAU MỖI LÔ ---
                initializeTooltips();
                // --- HẾT GỌI HÀM ---
                
                totalTranslated += validChunkNodes.length;
                console.log(`[SmartTranslator] Da dich thanh cong ${totalTranslated} / ${allTextNodes.length} doan.`);
            }

        } catch (error) {
            console.error(`[SmartTranslator] Loi khi dich lo ${Math.floor(i / CHUNK_SIZE) + 1}:`, error);
        }
         // Thêm độ trễ nhỏ giữa các lô để tránh bị chặn (nếu dùng API miễn phí)
         // await new Promise(resolve => setTimeout(resolve, 500)); // Chờ 0.5 giây
    }
    console.log("[SmartTranslator] Hoan tat dich trang!");
}

/**
 * Lắng nghe tin nhắn từ popup.js
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") { // Đảm bảo action này khớp với popup.js
        console.log("[SmartTranslator] Nhan duoc lenh dich tu popup.");
        
        translatePage().then(() => {
            sendResponse({ status: "success" });
        }).catch(error => {
            console.error("[SmartTranslator] Lỗi:", error);
            sendResponse({ status: "error", message: error.message });
        });

        return true; // Báo hiệu sendResponse sẽ được gọi bất đồng bộ
    }
});

