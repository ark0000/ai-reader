import os
import shutil
import io
import unittest
import tempfile
from fastapi.testclient import TestClient
import fitz  # PyMuPDF
from PIL import Image

# Set environment
os.environ["BYPASS_BIGQUERY_ERRORS"] = "true"
os.environ["GCP_PROJECT"] = "mock-project"

from src.main import app
from src.pdf_converter import convert_pdf_to_dark_mode, render_single_page_to_bytes
from src.database import init_db, register_user, authenticate_user, verify_jwt, get_user_history

class TestPDFConverter(unittest.TestCase):
    def setUp(self):
        from src.database import DB_PATH
        if os.path.exists(DB_PATH):
            try:
                os.remove(DB_PATH)
            except Exception:
                pass
        self.client = TestClient(app)
        self.temp_dir = tempfile.mkdtemp()
        init_db()  # Initialize local DB tables
        
    def tearDown(self):
        shutil.rmtree(self.temp_dir)

    def create_test_pdf(self, filepath):
        """Helper to create a small searchable PDF with a simple layout and image."""
        doc = fitz.open()
        page = doc.new_page(width=500, height=500)
        
        # Insert some searchable text
        page.insert_text(fitz.Point(50, 50), "Test Title Paragraph", fontsize=18, fontname="helv")
        page.insert_textbox(fitz.Rect(50, 100, 450, 200), "This is searchable text that should remain selectable.", fontsize=12, fontname="times-roman")
        
        # Insert a small red square image
        img = Image.new('RGB', (100, 100), color = 'red')
        img_byte_arr = io.BytesIO()
        img.save(img_byte_arr, format='PNG')
        img_bytes = img_byte_arr.getvalue()
        page.insert_image(fitz.Rect(50, 250, 150, 350), stream=img_bytes)
        
        doc.save(filepath)
        doc.close()

    def test_database_and_crypto(self):
        """Test database registrations, auth, JWT signatures, and user history logs."""
        username = "alex_dev_99"
        password = "securepassword123"
        
        # 1. Register User
        uid = register_user(username, password)
        self.assertIsNotNone(uid)
        
        # Double registration should fail (username UNIQUE constraint)
        fail_uid = register_user(username, password)
        self.assertIsNone(fail_uid)
        
        # 2. Authenticate User
        user = authenticate_user(username, password)
        self.assertIsNotNone(user)
        self.assertEqual(user["id"], uid)
        self.assertEqual(user["username"], username)
        
        # Invalid pass auth should fail
        bad_auth = authenticate_user(username, "wrongpass")
        self.assertIsNone(bad_auth)
        
        # 3. Test conversion log history write & read
        from src.database import add_history_entry
        add_history_entry(uid, "textbook_sample.pdf", 45)
        
        history = get_user_history(uid)
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["filename"], "textbook_sample.pdf")
        self.assertEqual(history[0]["pages_count"], 45)

    def test_auth_endpoints(self):
        """Test REST register, login and protected history endpoints."""
        username = "testing_user"
        password = "userpass77"
        
        # 1. API Register
        reg_resp = self.client.post("/api/auth/register", json={"username": username, "password": password})
        print(reg_resp.text); self.assertEqual(reg_resp.status_code, 200)
        reg_data = reg_resp.json()
        self.assertIn("token", reg_data)
        token = reg_data["token"]
        
        # 2. Protected route access (History)
        hist_resp = self.client.get("/api/history", headers={"user": token})
        self.assertEqual(hist_resp.status_code, 200)
        self.assertEqual(len(hist_resp.json()), 0)  # No entries yet
        
        # Request history without valid token will default to Guest user
        fail_hist = self.client.get("/api/history")
        self.assertEqual(fail_hist.status_code, 200)
        
        # 3. API Login
        login_resp = self.client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(login_resp.status_code, 200)
        self.assertIn("token", login_resp.json())

    def test_pdf_converter_logic(self):
        """Test that the parallel pdf conversion works and maintains text searchability."""
        input_pdf = os.path.join(self.temp_dir, "input.pdf")
        output_pdf = os.path.join(self.temp_dir, "output_dark.pdf")
        self.create_test_pdf(input_pdf)
        
        # Run parallel converter
        convert_pdf_to_dark_mode(
            input_path=input_pdf,
            output_path=output_pdf,
            dpi=100,
            jpeg_quality=75,
            smart_invert=True,
            brightness_factor=1.2,
            color_mode="comfort",
            max_workers=2
        )
        self.assertTrue(os.path.exists(output_pdf))
        
        # Verify text searchability
        doc = fitz.open(output_pdf)
        self.assertEqual(len(doc), 1)
        text = doc[0].get_text()
        self.assertIn("Test Title Paragraph", text)
        doc.close()

    def test_fastapi_converter_endpoints(self):
        """Test the upload, preview, and task queue flow."""
        input_pdf = os.path.join(self.temp_dir, "api_input.pdf")
        self.create_test_pdf(input_pdf)
        
        # 1. Upload context
        with open(input_pdf, "rb") as f:
            upload_response = self.client.post(
                "/api/upload",
                files={"file": ("api_input.pdf", f, "application/pdf")}
            )
        self.assertEqual(upload_response.status_code, 200)
        upload_data = upload_response.json()
        task_id = upload_data["task_id"]
        
        # 2. Test interactive page preview render
        preview_response = self.client.get(
            "/api/preview/render",
            params={
                "task_id": task_id,
                "page_num": 1,
                "color_mode": "comfort",
                "brightness": 1.3,
                "smart_invert": True,
                "preview_type": "dark"
            }
        )
        self.assertEqual(preview_response.status_code, 200)
        self.assertEqual(preview_response.headers["content-type"], "image/jpeg")
        
        # 3. Trigger queue compilation
        convert_response = self.client.post(
            f"/api/convert/{task_id}",
            data={
                "dpi": "100",
                "quality": "70",
                "smart_invert": "true",
                "brightness": "1.3",
                "color_mode": "comfort",
                "threads": "2"
            }
        )
        self.assertEqual(convert_response.status_code, 200)
        
        # 4. Poll queue status
        status_response = self.client.get(f"/api/status/{task_id}")
        self.assertEqual(status_response.status_code, 200)
        status_data = status_response.json()
        self.assertIn("status", status_data)

if __name__ == '__main__':
    unittest.main()
