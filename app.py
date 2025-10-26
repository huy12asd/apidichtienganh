import flask
from flask import Flask, request, jsonify
from deep_translator import GoogleTranslator # <-- Đã quay lại thư viện ổn định
import sqlite3
import re
import os
import time
from flask_cors import CORS

app = Flask(__name__)
# CHO PHÉP TẤT CẢ CÁC TRANG WEB GỌI API NÀY
CORS(app) 

# --- Khởi tạo thư viện deep-translator ---
# source='auto' tự động phát hiện, target='vi' là tiếng Việt
translator = GoogleTranslator(source='auto', target='vi')

# --- Kết nối SQLite ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'database1.db')

def get_db_connection():
    """Tạo kết nối đến SQLite Database."""
    try:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row # Giúp truy cập cột bằng tên
        return conn
    except sqlite3.Error as e:
        print(f"[APP_ERROR] Lỗi kết nối database: {e}")
        return None

# --- Logic dịch thuật TỐI ƯU (Regex 1 lần) ---

def build_regex_and_dict():
    """
    Lấy TẤT CẢ thuật ngữ từ DB và "biên dịch" chúng thành MỘT
    mẫu Regex duy nhất và MỘT dictionary để tra cứu.
    Đây là bước tối ưu hóa quan trọng nhất.
    """
    conn = get_db_connection()
    terms_dict = {} # Dùng để tra cứu (ví dụ: "data structure" -> "Cấu trúc dữ liệu")
    term_list = []  # Dùng để xây dựng Regex (ví dụ: ["data structure", "class", ...])

    if conn is None:
        print("[APP_ERROR] Không thể kết nối DB để tải từ điển.")
        return None, {}
        
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT english, vietnamese, note FROM Terms")
        terms_data = cursor.fetchall()
        conn.close()
        
        for term in terms_data:
            term_key = term['english'].lower()
            term_list.append(re.escape(term_key)) # re.escape để xử lý ký tự đặc biệt
            
            # Tạo HTML cho tooltip
            tooltip_text = f"{term['english'].capitalize()} - {term['note']}" if term['note'] else term['english'].capitalize()
            html_replacement = (
                f"<span style='background-color: #fff8e1; color: #5d4037; border-radius: 3px; padding: 0 2px;'"
                f" data-bs-toggle='tooltip' title='{tooltip_text}'>"
                f"<b>{term['vietnamese']}</b>"
                f"</span>"
            )
            terms_dict[term_key] = html_replacement
        
        # Sắp xếp các thuật ngữ TỪ DÀI ĐẾN NGẮN.
        # Rất quan trọng: để "computer network" được khớp trước "computer"
        term_list.sort(key=len, reverse=True)
        
        # Tạo MỘT mẫu Regex "khổng lồ"
        # \b(computer network|data structure|class|...)\b
        regex_pattern = r'\b(' + '|'.join(term_list) + r')\b'
        compiled_regex = re.compile(regex_pattern, re.IGNORECASE)
        
        print(f"[APP_INFO] Đã biên dịch {len(term_list)} thuật ngữ thành 1 Regex.")
        return compiled_regex, terms_dict

    except sqlite3.Error as e:
        print(f"[APP_ERROR] Lỗi khi truy vấn Terms: {e}")
        if conn:
            conn.close()
        return None, {}

# --- BIẾN TOÀN CỤC ---
# Tải trước và biên dịch Regex MỘT LẦN DUY NHẤT khi server khởi động
print("[APP_INFO] Đang tải từ điển chuyên ngành...")
COMPILED_REGEX, TERMS_DICT = build_regex_and_dict()
print(f"[APP_INFO] Đã tải xong {len(TERMS_DICT)} thuật ngữ.")


def replace_callback(match):
    """
    Hàm này được gọi bởi re.sub cho MỖI thuật ngữ nó tìm thấy.
    Nó sẽ tra cứu trong dictionary và trả về HTML thay thế.
    """
    term_key = match.group(0).lower()
    replacement = TERMS_DICT.get(term_key)
    
    if replacement:
        # Đánh dấu là "đã dịch" để Google Dịch bỏ qua
        return f"[[{replacement}]]" 
    return match.group(0) # Không tìm thấy (dù hiếm), trả về gốc

# --- API Endpoint ---

@app.route("/")
def index():
    """Route cơ bản để kiểm tra server có "thức" không."""
    return "API Dịch thuật chuyên ngành (Bản Siêu ổn định) đang hoạt động!"

@app.route("/api/translate", methods=["POST"])
def api_translate():
    """Endpoint chính nhận "lô" text và trả về "lô" đã dịch."""
    start_time_total = time.time()
    data = request.json
    texts_to_translate = data.get("texts", []) 

    if not texts_to_translate:
        return jsonify({"translations": []})

    print(f"\n[API] Nhận được lô {len(texts_to_translate)} đoạn text.")
    
    # --- 1. Tiền xử lý (Regex 1 lần) ---
    start_time_pre = time.time()
    placeholders_map = {}
    preprocessed_texts = [] # Danh sách text sau khi thay thế thuật ngữ
    
    for text in texts_to_translate:
        if not text.strip():
            preprocessed_texts.append("")
            continue
            
        # Chạy Regex 1 lần duy nhất để thay thế TẤT CẢ thuật ngữ trong text
        pre_text = COMPILED_REGEX.sub(replace_callback, text)
        preprocessed_texts.append(pre_text)
        
    print(f"[API] Tiền xử lý Regex xong trong {time.time() - start_time_pre:.4f}s")

    # --- 2. CHUẨN BỊ GỌI GOOGLE ---
    texts_to_google = []
    indices_to_translate = [] # Lưu vị trí của các text cần dịch
    
    for i, text in enumerate(preprocessed_texts):
        # Kiểm tra xem text có nội dung thực sự (chữ cái) hay chỉ là placeholder/rỗng
        if re.search(r'[a-zA-Z]', text): 
            texts_to_google.append(text)
            indices_to_translate.append(i)
        
    # --- 3. GỌI DỊCH (dùng deep-translator) ---
    google_translated_results = []
    if texts_to_google:
        print(f"[API] *** ĐANG GỌI GOOGLE DỊCH cho {len(texts_to_google)} đoạn... ***")
        start_time_google = time.time()
        try:
            # Dùng hàm .translate_batch() đã sửa lỗi
            google_translated_results = translator.translate_batch(texts_to_google)
            print(f"[API] *** GOOGLE DỊCH HOÀN TẤT sau {time.time() - start_time_google:.4f}s ***")
        except Exception as e:
            print(f"[API] LỖI GOOGLE TRANSLATE (deep-translator): {e} - Trả về text gốc.")
            google_translated_results = texts_to_google # Trả về text cũ nếu lỗi
    
    # --- 4. GỘP KẾT QUẢ ---
    start_time_post = time.time()
    google_map = dict(zip(indices_to_translate, google_translated_results))
    final_translations = [] # Đây là danh sách cuối cùng trả về cho "cánh tay"
    
    for i, text in enumerate(preprocessed_texts):
        if i in google_map:
            # Dùng text đã dịch của Google
            translated_text = google_map[i]
            # Hậu xử lý: Thay thế các placeholder [[...]] bằng HTML
            # (Trường hợp 1 câu có cả từ chuyên ngành và từ thường)
            final_content = re.sub(r'\[\[(.*?)\]\]', r'\1', translated_text)
            final_translations.append({"type": "plain", "content": final_content})
            
        else:
            # Text này không cần Google dịch (chỉ chứa placeholder/rỗng)
            # Hậu xử lý: Chỉ cần gỡ bỏ các dấu [[...]]
            if text.strip(): # Chỉ xử lý nếu không rỗng
                final_content = re.sub(r'\[\[(.*?)\]\]', r'\1', text)
                final_translations.append({"type": "html", "content": final_content})
            else:
                final_translations.append({"type": "plain", "content": ""}) # Trả về rỗng

    print(f"[API] Hậu xử lý & Đóng gói xong trong {time.time() - start_time_post:.4f}s")
    print(f"[API] Hoàn tất toàn bộ lô trong {time.time() - start_time_total:.2f}s")
    
    return jsonify({"translations": final_translations})

# --- Chạy server ---
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # Tắt "debug=True" khi chạy, nó giúp ổn định hơn
    app.run(host="0.0.0.0", port=port, debug=False)




