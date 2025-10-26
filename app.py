import flask
from flask import Flask, request, jsonify
from googletrans import Translator
import sqlite3
import re
import os
from flask_cors import CORS

app = Flask(__name__)
# CHO PHÉP TẤT CẢ CÁC TRANG WEB GỌI API NÀY
CORS(app) 
translator = Translator()

# --- Kết nối SQLite ---
# Lấy đường dẫn thư mục hiện tại của file app.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'database1.db')

def get_db_connection():
    try:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error as e:
        print(f"Lỗi kết nối database: {e}")
        return None

# --- Logic dịch thuật ---

def get_all_terms():
    """Lấy TẤT CẢ các thuật ngữ từ DB một lần duy nhất."""
    conn = get_db_connection()
    if conn is None:
        return []
        
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT english, vietnamese, note FROM Terms")
        terms_data = cursor.fetchall()
        conn.close()
        
        terms_dict = {}
        for term in terms_data:
            terms_dict[term['english'].lower()] = {
                'vietnamese': term['vietnamese'],
                'note': term['note']
            }
        
        sorted_terms = sorted(terms_dict.items(), key=lambda item: len(item[0]), reverse=True)
        return sorted_terms
    except sqlite3.Error as e:
        print(f"Lỗi khi truy vấn Terms: {e}")
        if conn:
            conn.close()
        return []

# Tải trước các thuật ngữ khi server khởi động
print("Loading specialized terms from database...")
SPECIALIZED_TERMS = get_all_terms()
print(f"Loaded {len(SPECIALIZED_TERMS)} terms.")

def complex_preprocess(text, placeholders_map):
    """
    Tìm và thay thế các thuật ngữ chuyên ngành bằng placeholder.
    Dùng regex \b (word boundary) để chỉ thay thế các từ độc lập.
    """
    # Nếu văn bản chỉ là khoảng trắng, bỏ qua
    if not text.strip():
        return text, placeholders_map

    lower_text = text.lower()
    
    for term, data in SPECIALIZED_TERMS:
        # Dùng regex để tìm từ/cụm từ
        pattern = re.compile(r'\b' + re.escape(term) + r'\b', re.IGNORECASE)
        
        if pattern.search(lower_text):
            placeholder_key = f"[[{term.lower()}]]"
            
            # Thay thế trên văn bản gốc (giữ nguyên hoa/thường)
            text = pattern.sub(placeholder_key, text)
            lower_text = pattern.sub(placeholder_key, lower_text) # Cập nhật để tìm kiếm tiếp
            
            # Chỉ thêm vào map nếu chưa có
            if placeholder_key not in placeholders_map:
                tooltip_text = f"{term.capitalize()} - {data['note']}" if data['note'] else term.capitalize()
                placeholders_map[placeholder_key] = f"<span data-bs-toggle='tooltip' title='{tooltip_text}'><b>{data['vietnamese']}</b></span>"

    return text, placeholders_map

def postprocess_terms(text, placeholders_map):
    """Thay thế các placeholder bằng HTML đã dịch."""
    # Sắp xếp các key từ dài đến ngắn để thay thế "computer network" trước "computer"
    sorted_keys = sorted(placeholders_map.keys(), key=len, reverse=True)
    
    for key in sorted_keys:
        if key in text:
            pattern = re.compile(re.escape(key), re.IGNORECASE)
            text = pattern.sub(placeholders_map[key], text)
    return text

# --- API Endpoint ---

@app.route("/")
def index():
    return "API Dịch thuật chuyên ngành đang hoạt động!"

@app.route("/api/translate", methods=["POST"])
def api_translate():
    data = request.json
    texts_to_translate = data.get("texts", []) 

    if not texts_to_translate:
        return jsonify({"translated_texts": []})

    placeholders_map = {}
    preprocessed_texts = [] # Danh sách text sau khi thay thế thuật ngữ

    # 1. Tiền xử lý (thay thuật ngữ bằng placeholder)
    for text in texts_to_translate:
        pre_text, placeholders_map = complex_preprocess(text, placeholders_map)
        preprocessed_texts.append(pre_text)

    # 2. CHUẨN BỊ GỌI GOOGLE:
    # Chỉ gửi những text CẦN DỊCH (không rỗng, không phải chỉ là placeholder)
    texts_to_google = []
    indices_to_translate = [] # Lưu vị trí của các text cần dịch
    
    for i, text in enumerate(preprocessed_texts):
        # Kiểm tra xem text có nội dung thực sự hay chỉ là placeholder/khoảng trắng
        # Regex này kiểm tra xem có chữ cái (a-z) nào không
        if re.search(r'[a-zA-Z]', text): 
            texts_to_google.append(text)
            indices_to_translate.append(i)

    # 3. GỌI GOOGLE DỊCH (chỉ khi có gì đó để dịch)
    google_translated_results = []
    if texts_to_google:
        try:
            translated_objects = translator.translate(texts_to_google, src="en", dest="vi")
            google_translated_results = [item.text for item in translated_objects]
        except Exception as e:
            print(f"Lỗi Google Translate: {e} - Trả về text gốc.")
            google_translated_results = texts_to_google # Trả về text cũ nếu lỗi
    
    # 4. GỘP KẾT QUẢ:
    # Gán các kết quả đã dịch trở lại đúng vị trí
    google_map = dict(zip(indices_to_translate, google_translated_results))
    final_google_texts = []
    for i, text in enumerate(preprocessed_texts):
        if i in google_map:
            final_google_texts.append(google_map[i]) # Dùng text đã dịch
        else:
            final_google_texts.append(text) # Dùng text gốc (chỉ chứa placeholder/rỗng)

    # 5. Hậu xử lý (thay placeholder bằng HTML thuật ngữ)
    final_texts = []
    for text in final_google_texts:
        final_text = postprocess_terms(text, placeholders_map)
        final_texts.append(final_text)

    return jsonify({"translated_texts": final_texts})

# --- Các route web của bạn (giữ nguyên nếu cần) ---
# ... (Bạn có thể thêm lại các route /modules và /terms ở đây) ...

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)

