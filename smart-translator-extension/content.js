// --- CÀI ĐẶT ---
// Đổi URL của API ở đây.



// Dùng URL này khi đã deploy lên Render
const API_URL = "https://apidichtienganh.onrender.com/api/translate";
// --- HẾT CÀI ĐẶT ---


/**
 * Hàm này tìm và trả về tất cả các node văn bản cần dịch.
 */
function findTextNodes(node, textNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
        const parentTag = node.parentNode ? node.parentNode.nodeName.toUpperCase() : '';
        // Bỏ qua các node đã được đánh dấu (chỉ các <span> HTML của chúng ta mới có)
        if (node.nodeValue.trim() !== '' && parentTag !== 'SCRIPT' && parentTag !== 'STYLE' && (!node.parentNode || !node.parentNode.dataset.translated)) {
            textNodes.push(node);
        }
    } else {
        // Chỉ duyệt các node con nếu node này chưa được đánh dấu (là <span> HTML của chúng ta)
        if (!node.dataset || !node.dataset.translated) {
            for (const child of node.childNodes) {
                findTextNodes(child, textNodes);
            }
        }
    }
}

/**
 * Hàm chính để dịch trang
 * Nó sẽ cắt trang ra thành nhiều "lô" (chunk) và dịch từng lô một.
 */
async function translatePage() {
    console.log("Bat dau qua trinh dich trang...");
    const allTextNodes = [];
    findTextNodes(document.body, allTextNodes);
    
    if (allTextNodes.length === 0) {
        console.log("Khong tim thay van ban de dich.");
        return;
    }

    const CHUNK_SIZE = 50; // Dịch 50 đoạn text một lần
    let totalTranslated = 0;

    for (let i = 0; i < allTextNodes.length; i += CHUNK_SIZE) {
        const chunkNodes = allTextNodes.slice(i, i + CHUNK_SIZE);
        const textsToTranslate = chunkNodes.map(node => node.nodeValue);

        try {
            console.log(`Dang gui lo ${i / CHUNK_SIZE + 1} / ${Math.ceil(allTextNodes.length / CHUNK_SIZE)}...`);
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

            if (data.translations && data.translations.length === chunkNodes.length) {
                chunkNodes.forEach((node, index) => {
                    const item = data.translations[index];
                    
                    if (item.type === "html") {
                        // Nếu là HTML, tạo một <span> mới để chứa nó
                        const newSpan = document.createElement('span');
                        newSpan.innerHTML = item.content;
                        // Đánh dấu là đã dịch để không dịch lại
                        newSpan.dataset.translated = 'true'; 
                        
                        // Thay thế text node cũ bằng <span> mới
                        if (node.parentNode) {
                            node.parentNode.replaceChild(newSpan, node);
                        }
                    } else {
                        // Nếu là "plain", chỉ cần gán giá trị
                        node.nodeValue = item.content;
                        // **ĐÃ XÓA LOGIC ĐÁNH DẤU PARENT BỊ LỖI Ở ĐÂY**
                    }
                });
                
                totalTranslated += chunkNodes.length;
                console.log(`Da dich thanh cong ${totalTranslated} / ${allTextNodes.length} doan.`);
            }

        } catch (error) {
            console.error(`Loi khi dich lo ${i / CHUNK_SIZE + 1}:`, error);
        }
    }
    console.log("Hoan tat dich trang!");
}

/**
 * Lắng nghe tin nhắn từ popup.js
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translate") { // Đảm bảo action này khớp với popup.js
        console.log("Nhan duoc lenh dich tu popup.");
        
        translatePage().then(() => {
            sendResponse({ status: "success" });
        }).catch(error => {
            console.error("SmartTranslator Lỗi:", error);
            sendResponse({ status: "error", message: error.message });
        });

        // Trả về 'true' để báo hiệu sendResponse sẽ được gọi bất đồng bộ
        return true; 
    }
});

