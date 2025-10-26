document.addEventListener('DOMContentLoaded', function() {
    const translateButton = document.getElementById('translate-btn');
    const statusDiv = document.getElementById('status');

    translateButton.addEventListener('click', function() {
        statusDiv.textContent = 'Đang dịch...';
        translateButton.disabled = true;

        // Gửi một tin nhắn đến content.js đang chạy trên tab hiện tại
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            // Đảm bảo có tab đang hoạt động
            if (tabs.length === 0) {
                statusDiv.textContent = 'Lỗi: Không tìm thấy tab.';
                translateButton.disabled = false;
                return;
            }

            chrome.tabs.sendMessage(
                tabs[0].id,
                { action: "translate" },
                function(response) {
                    if (chrome.runtime.lastError) {
                        // Lỗi (ví dụ: content.js chưa được nạp hoặc trang không cho phép)
                        statusDiv.textContent = 'Lỗi: Không kết nối được với trang. Vui lòng tải lại trang.';
                        console.error(chrome.runtime.lastError.message);
                    } else if (response && response.status === "success") {
                        statusDiv.textContent = 'Đã dịch xong!';
                    } else if (response && response.status === "error") {
                        statusDiv.textContent = 'Đã có lỗi xảy ra khi dịch.';
                        console.error(response.message);
                    } else {
                        statusDiv.textContent = 'Lỗi không xác định.';
                    }

                    // Đóng popup sau 2 giây
                    setTimeout(() => window.close(), 2000);
                }
            );
        });
    });
});
