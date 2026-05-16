import os, uuid, json, base64
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
UPLOAD_FOLDER = "uploads"
ALLOWED = {"png", "jpg", "jpeg", "gif", "webp"}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ── VAPID 키 ──────────────────────────────────────────
VAPID_PRIVATE_KEY  = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY_HEX = os.environ.get("VAPID_PUBLIC_KEY_HEX", "")
VAPID_PUBLIC_KEY = ""
if VAPID_PUBLIC_KEY_HEX:
    VAPID_PUBLIC_KEY = base64.urlsafe_b64encode(
        bytes.fromhex(VAPID_PUBLIC_KEY_HEX)
    ).rstrip(b"=").decode()

# ── DB 연결 ───────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL")

if DATABASE_URL:
    import psycopg2, psycopg2.extras

    def get_db():
        return psycopg2.connect(DATABASE_URL)

    def init_db():
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS entries (
                        id SERIAL PRIMARY KEY, title TEXT NOT NULL, content TEXT,
                        location TEXT, photo TEXT, section TEXT NOT NULL DEFAULT 'us',
                        author TEXT NOT NULL DEFAULT '나', created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS comments (
                        id SERIAL PRIMARY KEY, entry_id INTEGER NOT NULL,
                        author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS subscriptions (
                        id SERIAL PRIMARY KEY, author TEXT NOT NULL,
                        endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL
                    )
                """)
            conn.commit()

    def query(sql, params=(), fetch=None):
        with get_db() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                conn.commit()
                if fetch == "all": return cur.fetchall()
                if fetch == "one": return cur.fetchone()

else:
    import sqlite3
    DB = "diary.db"

    def get_db():
        return sqlite3.connect(DB)

    def init_db():
        with get_db() as conn:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(entries)").fetchall()]
            if cols and "section" not in cols:
                conn.execute("DROP TABLE IF EXISTS entries")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, content TEXT,
                    location TEXT, photo TEXT, section TEXT NOT NULL DEFAULT 'us',
                    author TEXT NOT NULL DEFAULT '나', created_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL,
                    author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL,
                    endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL
                )
            """)

    def query(sql, params=(), fetch=None):
        with get_db() as conn:
            cur = conn.execute(sql, params)
            if fetch == "all":
                cols = [d[0] for d in cur.description]
                return [dict(zip(cols, r)) for r in cur.fetchall()]
            if fetch == "one":
                cols = [d[0] for d in cur.description]
                row = cur.fetchone()
                return dict(zip(cols, row)) if row else None

# ── 푸시 알림 발송 ─────────────────────────────────────
def send_push(author, title, body):
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return
    from pywebpush import webpush, WebPushException
    ph = "%s" if DATABASE_URL else "?"
    subs = query(
        f"SELECT endpoint,p256dh,auth FROM subscriptions WHERE author!={ph}",
        (author,), fetch="all"
    ) or []
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}
                },
                data=json.dumps({"title": title, "body": body}),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": "mailto:diary@couple.app"}
            )
        except Exception:
            pass

# ── 라우트 ────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/vapid-public-key")
def vapid_public_key():
    return jsonify({"key": VAPID_PUBLIC_KEY})

@app.route("/subscribe", methods=["POST"])
def subscribe():
    data     = request.json
    author   = data.get("author", "").strip()
    sub      = data.get("subscription", {})
    endpoint = sub.get("endpoint", "")
    keys     = sub.get("keys", {})
    p256dh   = keys.get("p256dh", "")
    auth     = keys.get("auth", "")
    if not all([author, endpoint, p256dh, auth]):
        return jsonify({"ok": False})
    ph = "%s" if DATABASE_URL else "?"
    existing = query(f"SELECT id FROM subscriptions WHERE endpoint={ph}", (endpoint,), fetch="one")
    if existing:
        query(f"UPDATE subscriptions SET author={ph} WHERE endpoint={ph}", (author, endpoint))
    else:
        query(f"INSERT INTO subscriptions (author,endpoint,p256dh,auth) VALUES ({ph},{ph},{ph},{ph})",
              (author, endpoint, p256dh, auth))
    return jsonify({"ok": True})

@app.route("/entries")
def get_entries():
    section = request.args.get("section", "us")
    ph = "%s" if DATABASE_URL else "?"
    rows = query(
        f"SELECT id,title,content,location,photo,section,author,created_at FROM entries WHERE section={ph} ORDER BY created_at DESC",
        (section,), fetch="all"
    )
    return jsonify(rows)

@app.route("/entries", methods=["POST"])
def create_entry():
    title      = request.form.get("title","").strip()
    content    = request.form.get("content","").strip()
    location   = request.form.get("location","").strip()
    section    = request.form.get("section","us")
    author     = request.form.get("author","나")
    created_at = request.form.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M")
    if not title:
        return jsonify({"ok":False,"message":"제목을 입력해주세요."}), 400
    photo = _save_photo()
    ph = "%s" if DATABASE_URL else "?"
    query(f"INSERT INTO entries (title,content,location,photo,section,author,created_at) VALUES ({ph},{ph},{ph},{ph},{ph},{ph},{ph})",
          (title,content,location,photo,section,author,created_at))
    send_push(author, f"{author}님의 새 기록 ♡", title)
    return jsonify({"ok":True})

@app.route("/entries/<int:eid>", methods=["PUT"])
def update_entry(eid):
    title      = request.form.get("title","").strip()
    content    = request.form.get("content","").strip()
    location   = request.form.get("location","").strip()
    created_at = request.form.get("created_at") or datetime.now().strftime("%Y-%m-%d %H:%M")
    if not title:
        return jsonify({"ok":False,"message":"제목을 입력해주세요."}), 400
    ph = "%s" if DATABASE_URL else "?"
    row = query(f"SELECT photo FROM entries WHERE id={ph}", (eid,), fetch="one")
    old_photo = row["photo"] if row else None
    new_photo = _save_photo()
    photo = new_photo or old_photo
    if new_photo and old_photo:
        try: os.remove(os.path.join(UPLOAD_FOLDER, old_photo))
        except: pass
    query(f"UPDATE entries SET title={ph},content={ph},location={ph},photo={ph},created_at={ph} WHERE id={ph}",
          (title,content,location,photo,created_at,eid))
    return jsonify({"ok":True})

@app.route("/entries/<int:eid>", methods=["DELETE"])
def delete_entry(eid):
    ph = "%s" if DATABASE_URL else "?"
    row = query(f"SELECT photo FROM entries WHERE id={ph}", (eid,), fetch="one")
    if row and row["photo"]:
        try: os.remove(os.path.join(UPLOAD_FOLDER, row["photo"]))
        except: pass
    query(f"DELETE FROM entries WHERE id={ph}", (eid,))
    query(f"DELETE FROM comments WHERE entry_id={ph}", (eid,))
    return jsonify({"ok":True})

@app.route("/entries/<int:eid>/comments")
def get_comments(eid):
    ph = "%s" if DATABASE_URL else "?"
    rows = query(f"SELECT id,author,content,created_at FROM comments WHERE entry_id={ph} ORDER BY created_at ASC", (eid,), fetch="all")
    return jsonify(rows)

@app.route("/entries/<int:eid>/comments", methods=["POST"])
def add_comment(eid):
    data    = request.json
    author  = data.get("author","").strip()
    content = data.get("content","").strip()
    if not content:
        return jsonify({"ok":False,"message":"댓글을 입력해주세요."}), 400
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    ph = "%s" if DATABASE_URL else "?"
    query(f"INSERT INTO comments (entry_id,author,content,created_at) VALUES ({ph},{ph},{ph},{ph})",
          (eid,author,content,created_at))
    return jsonify({"ok":True})

@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

def _save_photo():
    if "photo" not in request.files: return None
    f = request.files["photo"]
    if not f or not f.filename: return None
    ext = f.filename.rsplit(".",1)[-1].lower()
    if ext not in ALLOWED: return None
    fname = f"{uuid.uuid4().hex}.{ext}"
    f.save(os.path.join(UPLOAD_FOLDER, fname))
    return fname

init_db()

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
