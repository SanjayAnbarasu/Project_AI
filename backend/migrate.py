import sqlite3

def upgrade_database():
    # Connect directly to your existing database
    conn = sqlite3.connect('system_logs.db')
    cursor = conn.cursor()

    try:
        # Surgically add the new column and default all old logs to 'manual_highlight'
        cursor.execute("ALTER TABLE system_logs ADD COLUMN tag VARCHAR DEFAULT 'manual_highlight'")
        conn.commit()
        print("✅ Success: 'tag' column added to your database! All old logs preserved.")
    except sqlite3.OperationalError as e:
        # If the column already exists, SQLite will throw a harmless error
        print(f"⚠️ Notice: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    upgrade_database()