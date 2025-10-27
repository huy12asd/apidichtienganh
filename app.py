import regex as re
from deep_translator import GoogleTranslator
from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3, os, time

app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'database1.db')

translator = GoogleTranslator(source='auto', target='vi')
translation_cache = {}

def get_db_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def build_regex_and_dict():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT english, vietnamese, note FROM Terms")
    terms = cursor.fetchall()
    conn.close()

    term_list, term_dict = [], {}
    for term in terms:
        key = term['english'].lower()
        tooltip = f"{term['english']} - {term['note']}" if term['note'] else term['english']
        html = (f"<span style='background:#fff8e1;color:#5d4037;border-radius:3px;padding:0 2px;' "
                f"title='{tooltip}'><b>{term['vietnamese']}</b></span>")
        term_dict[key] = html
        term_list.append(re.escape(key))

    term_list.sort(key=len, reverse=True)
    regex = re.compile(r'\b(' + '|'.join(term_list) + r')\b', re.IGNORECASE)
    print(f"[INIT] Loaded {len(term_list)} terms into regex dictionary.")
    return regex, term_dict

COMPILED_REGEX, TERMS_DICT = build_regex_and_dict()

def replace_callback(match):
    key = match.group(0).lower()
    return f"[[{TERMS_DICT[key]}]]" if key in TERMS_DICT else match.group(0)

def translate_with_cache(texts):
    """
    Hàm này dịch theo batch nhỏ để tránh Google bị timeout.
    Đồng thời cache kết quả đã dịch để tăng tốc.
    """
    BATCH_SIZE = 50
    results = []

    # Lấy những text chưa có trong cache
    uncached = [t for t in texts if t not in translation_cache]

    # Dịch theo từng batch nhỏ
    for i in range(0, len(uncached), BATCH_SIZE):
        batch = uncached[i:i + BATCH_SIZE]
        try:
            translated_batch = translator.translate_batch(batch)
            for k, v in zip(batch, translated_batch):
                translation_cache[k] = v
        except Exception as e:
            print(f"[ERROR] Google Translate batch failed: {e}")
            # Nếu lỗi, lưu lại text gốc để không mất dữ liệu
            for t in batch:
                translation_cache[t] = t

    # Trả về kết quả theo đúng thứ tự
    for t in texts:
        results.append(translation_cache.get(t, t))
    return results

@app.route("/api/translate", methods=["POST"])
def api_translate():
    start = time.time()
    data = request.json
    texts = data.get("texts", [])
    if not texts:
        return jsonify({"translations": []})

    # Bước 1: Thay thế thuật ngữ chuyên ngành bằng placeholder [[...]]
    pre_texts = [COMPILED_REGEX.sub(replace_callback, t) if t.strip() else "" for t in texts]

    # Bước 2: Chọn các đoạn có chứa chữ cần gửi cho Google dịch
    texts_to_google = [(i, t) for i, t in enumerate(pre_texts) if re.search(r'[a-zA-Z]', t)]

    # Bước 3: Gọi Google dịch theo batch nhỏ
    results = {}
    if texts_to_google:
        idxs, contents = zip(*texts_to_google)
        google_trans = translate_with_cache(list(contents))
        results = dict(zip(idxs, google_trans))

    # Bước 4: Hậu xử lý
    final = []
    for i, text in enumerate(pre_texts):
        out = results.get(i, text)
        out = re.sub(r'\[\[(.*?)\]\]', r'\1', out)
        typ = "html" if "<span" in out else "plain"
        final.append({"type": typ, "content": out})

    print(f"[INFO] Processed {len(texts)} texts in {time.time()-start:.2f}s")
    return jsonify({"translations": final})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=5000, debug=False)
