import unittest
import fitz
import os
from src.concurrency import ConcurrencyFactory, ThreadPoolStrategy, ProcessPoolStrategy
from src.pdf_converter import convert_pdf_to_dark_mode

class TestFeatures(unittest.TestCase):

    def setUp(self):
        # Create a dummy PDF with text to test
        self.input_pdf = "test_input.pdf"
        self.output_pdf = "test_output.pdf"
        
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 50), "Hello World, Testing PDF Converter!", fontname="helv", fontsize=20)
        page.insert_text((50, 100), "Another line of text.", fontname="times-roman", fontsize=15)
        doc.save(self.input_pdf)
        doc.close()

    def tearDown(self):
        if os.path.exists(self.input_pdf):
            os.remove(self.input_pdf)
        if os.path.exists(self.output_pdf):
            os.remove(self.output_pdf)

    def test_concurrency_factory(self):
        # Test "auto" mode for small docs
        strat_small = ConcurrencyFactory.get_strategy("auto", total_tasks=2)
        self.assertIsInstance(strat_small, ThreadPoolStrategy)
        
        # Test "auto" mode for large docs
        strat_large = ConcurrencyFactory.get_strategy("auto", total_tasks=20)
        self.assertIsInstance(strat_large, ProcessPoolStrategy)
        
        # Test explicit modes
        self.assertIsInstance(ConcurrencyFactory.get_strategy("threads"), ThreadPoolStrategy)
        self.assertIsInstance(ConcurrencyFactory.get_strategy("processes"), ProcessPoolStrategy)

    def test_pdf_converter_font_swap_and_concurrency(self):
        # Test ThreadPool with font family swap
        convert_pdf_to_dark_mode(
            input_path=self.input_pdf,
            output_path=self.output_pdf,
            dpi=72,
            font_family_override="cour",
            font_quality=1,
            concurrency_mode="threads",
            max_workers=2
        )
        self.assertTrue(os.path.exists(self.output_pdf))
        
        # Verify output PDF has text in it
        out_doc = fitz.open(self.output_pdf)
        self.assertEqual(len(out_doc), 1)
        text = out_doc[0].get_text()
        self.assertIn("Hello World", text)
        out_doc.close()

    def test_pdf_converter_processes(self):
        # Test ProcessPool with original font
        convert_pdf_to_dark_mode(
            input_path=self.input_pdf,
            output_path=self.output_pdf,
            dpi=72,
            font_family_override="original",
            font_quality=8,
            concurrency_mode="processes",
            max_workers=2
        )
        self.assertTrue(os.path.exists(self.output_pdf))

    def test_smart_invert_flag(self):
        # Test that smart_invert doesn't crash the converter
        convert_pdf_to_dark_mode(
            input_path=self.input_pdf,
            output_path=self.output_pdf,
            dpi=72,
            smart_invert=True,
            font_family_override="original",
            font_quality=4,
            concurrency_mode="threads",
            max_workers=1
        )
        self.assertTrue(os.path.exists(self.output_pdf))

if __name__ == "__main__":
    unittest.main()
