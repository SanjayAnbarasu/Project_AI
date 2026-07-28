import sqlite3

def upgrade_database():
    conn = sqlite3.connect('system_logs.db')
    cursor = conn.cursor()
    try:
        cursor.execute("ALTER TABLE system_logs ADD COLUMN developer_name VARCHAR DEFAULT 'Unknown Developer'")
        conn.commit()
        print("✅ Success: 'developer_name' column added!")
    except sqlite3.OperationalError as e:
        print(f"⚠️ Notice: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    upgrade_database()