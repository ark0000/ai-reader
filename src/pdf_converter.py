import fitz  # PyMuPDF
from PIL import Image, ImageChops
import io
import os
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from src.concurrency import ConcurrencyFactory, ConcurrencyStrategy

logger = logging.getLogger(__name__)

def rgb_to_ycbcr_scalar(r, g, b):
    y  = int(16  + 65.481*r/255 + 128.553*g/255 + 24.966*b/255)
    cb = int(128 - 37.797*r/255 - 74.203*g/255 + 112.0  *b/255)
    cr = int(128 + 112.0 *r/255 - 93.786*g/255 - 18.214*b/255)
    return y, cb, cr

def compute_color_tables(
    color_mode: str,
    brightness_factor: float,
    custom_bg_rgb: tuple = None,
    custom_text_rgb: tuple = None,
    custom_sat_factor: float = None
) -> tuple[list, list, list]:
    if color_mode == "comfort":
        target_min, target_max, sat_factor, cb_tint, cr_tint = 25, 225, 0.8, 0, 0
    elif color_mode == "deep_space":
        target_min, target_max, sat_factor, cb_tint, cr_tint = 0, 225, 0.85, 0, 0
    elif color_mode == "monochrome":
        target_min, target_max, sat_factor, cb_tint, cr_tint = 0, 255, 0.0, 0, 0
    elif color_mode == "custom" and custom_bg_rgb and custom_text_rgb:
        bg_y, bg_cb, bg_cr = rgb_to_ycbcr_scalar(*custom_bg_rgb)
        target_min = bg_y
        cb_tint = bg_cb - 128
        cr_tint = bg_cr - 128
        
        text_y, text_cb, text_cr = rgb_to_ycbcr_scalar(*custom_text_rgb)
        target_max = text_y
        sat_factor = custom_sat_factor if custom_sat_factor is not None else 0.8
    else:  # classic
        target_min, target_max, sat_factor, cb_tint, cr_tint = 0, 255, 1.0, 0, 0
        
    y_table = []
    for i in range(256):
        val = target_min + (target_max - target_min) * (1.0 - i / 255.0)
        if brightness_factor != 1.0 and i < 200:
            norm = val / 255.0
            val = (norm ** (1.0 / brightness_factor)) * 255.0
        y_table.append(min(255, max(0, int(val))))
        
    cb_table = [min(255, max(0, int(128 + (i - 128) * sat_factor + cb_tint))) for i in range(256)]
    cr_table = [min(255, max(0, int(128 + (i - 128) * sat_factor + cr_tint))) for i in range(256)]
    
    return y_table, cb_table, cr_table

def process_single_page_task(
    input_path: str,
    page_idx: int,
    dpi: int,
    jpeg_quality: int,
    smart_invert: bool,
    y_table: list,
    cb_table: list,
    cr_table: list,
    font_family_override: str,
    font_quality: int
):
    """Worker task that processes a single PDF page independently."""
    if str(font_quality).lower() != "default":
        try:
            fitz.TOOLS.set_aa_level(int(font_quality))
        except ValueError:
            pass
    doc = fitz.open(input_path)
    try:
        page = doc[page_idx]
        rect = page.rect
        width, height = rect.width, rect.height
        scale = dpi / 72.0
        
        # 1. Extract searchable text elements
        text_dict = page.get_text("dict")
        
        # 2. Get image bounding boxes if smart invert is active
        image_bboxes = []
        if smart_invert:
            try:
                image_infos = page.get_image_info()
                image_bboxes = [info["bbox"] for info in image_infos if "bbox" in info]
            except Exception:
                pass
                
        # 2.5. Redact text if we are swapping fonts to erase it from the image
        if font_family_override != "original":
            for block in text_dict.get("blocks", []):
                if "lines" in block:
                    for line in block["lines"]:
                        for span in line["spans"]:
                            rect = fitz.Rect(span["bbox"])
                            page.add_redact_annot(rect, fill=(1,1,1)) # White out
            page.apply_redactions()

        # 3. Render page to image
        pix = page.get_pixmap(dpi=dpi)
        img_data = pix.tobytes("png")
        orig_img = Image.open(io.BytesIO(img_data)).convert("RGB")
        
        # 4. Apply YCbCr point mappings
        y, cb, cr = orig_img.convert("YCbCr").split()
        inverted_img = Image.merge("YCbCr", (y.point(y_table), cb.point(cb_table), cr.point(cr_table))).convert("RGB")
        
        # 6. Restore original image boxes
        if smart_invert and image_bboxes:
            for bbox in image_bboxes:
                x0, y0, x1, y1 = bbox
                px0 = max(0, int(x0 * scale) - 1)
                py0 = max(0, int(y0 * scale) - 1)
                px1 = min(orig_img.width, int(x1 * scale) + 1)
                py1 = min(orig_img.height, int(y1 * scale) + 1)
                
                if px1 > px0 and py1 > py0:
                    crop_area = (px0, py0, px1, py1)
                    cropped_orig = orig_img.crop(crop_area)
                    inverted_img.paste(cropped_orig, (px0, py0))
                    
        # 7. Compress and save background image to JPEG bytes
        img_byte_arr = io.BytesIO()
        inverted_img.save(img_byte_arr, format='JPEG', quality=jpeg_quality)
        return page_idx, img_byte_arr.getvalue(), text_dict, width, height
    finally:
        doc.close()


def convert_pdf_to_dark_mode(
    input_path: str,
    output_path: str,
    dpi: int = 150,
    jpeg_quality: int = 80,
    smart_invert: bool = True,
    progress_callback = None,
    brightness_factor: float = 1.0,
    color_mode: str = "comfort",
    preview_original_path: str = None,
    preview_dark_path: str = None,
    custom_bg_rgb: tuple = None,
    custom_text_rgb: tuple = None,
    custom_sat_factor: float = None,
    max_workers: int = 4,
    concurrency_mode: str = "threads",
    font_family_override: str = "original",
    font_quality: int = 8
):
    """
    Converts a searchable PDF to dark mode using injected ConcurrencyStrategy.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")
        
    logger.info(f"Opening input PDF for parallel conversion: {input_path} [workers={max_workers}, mode={color_mode}]")
    src_doc = fitz.open(input_path)
    total_pages = len(src_doc)
    src_doc.close()  # Close the main file so worker threads can open it independently
    
    pages_data = {}
    
    # 1. Compute color tables once
    y_table, cb_table, cr_table = compute_color_tables(
        color_mode, brightness_factor, custom_bg_rgb, custom_text_rgb, custom_sat_factor
    )
    
    # 2. Execute page processing in parallel worker threads
    # Calculate approximate total pixels to inform the Auto concurrency strategy
    try:
        tmp_doc = fitz.open(input_path)
        first_page = tmp_doc[0]
        pixel_w = first_page.rect.width * (dpi / 72.0)
        pixel_h = first_page.rect.height * (dpi / 72.0)
        total_pixel_area = int(pixel_w * pixel_h * total_pages)
        tmp_doc.close()
    except Exception:
        total_pixel_area = 0

    strategy = ConcurrencyFactory.get_strategy(concurrency_mode, total_tasks=total_pages, max_workers=max_workers, total_pixel_area=total_pixel_area)
    tasks = []
    for i in range(total_pages):
        tasks.append({
            "input_path": input_path,
            "page_idx": i,
            "dpi": dpi,
            "jpeg_quality": jpeg_quality,
            "smart_invert": smart_invert,
            "y_table": y_table,
            "cb_table": cb_table,
            "cr_table": cr_table,
            "font_family_override": font_family_override,
            "font_quality": font_quality
        })
        
    results = strategy.execute(process_single_page_task, tasks, max_workers, progress_callback)
    
    for page_idx, img_bytes, text_dict, w, h in results:
        pages_data[page_idx] = (img_bytes, text_dict, w, h)
        if page_idx == 0:
            if preview_original_path or preview_dark_path:
                doc_temp = fitz.open(input_path)
                try:
                    p_pix = doc_temp[0].get_pixmap(dpi=dpi)
                    p_orig = Image.open(io.BytesIO(p_pix.tobytes("png"))).convert("RGB")
                    if preview_original_path:
                        p_orig.save(preview_original_path, format="JPEG", quality=85)
                    if preview_dark_path:
                        p_dark = Image.open(io.BytesIO(img_bytes))
                        p_dark.save(preview_dark_path, format="JPEG", quality=85)
                except Exception as e:
                    logger.error(f"Failed to save page 1 previews in thread: {e}")
                finally:
                    doc_temp.close()
                
    # 2. Assemble the output PDF document sequentially in order of pages
    logger.info(f"Assembling parallel conversion output: {output_path}")
    out_doc = fitz.open()
    try:
        for page_idx in range(total_pages):
            if page_idx not in pages_data:
                raise ValueError(f"Missing page data for index {page_idx}")
                
            img_bytes, text_dict, width, height = pages_data[page_idx]
            new_page = out_doc.new_page(width=width, height=height)
            
            # Draw background image
            new_page.insert_image(new_page.rect, stream=img_bytes)
            
            # Overlay searchable text layer
            is_original_font = (font_family_override == "original")
            target_font = font_family_override if not is_original_font else "helv"
            
            if not is_original_font:
                # Ensure font is embedded
                try:
                    new_page.insert_font(fontname=target_font)
                    new_page.insert_text((0,0), " ", fontname=target_font, render_mode=3)
                except Exception:
                    pass

            for block in text_dict.get("blocks", []):
                if "lines" in block:
                    for line in block["lines"]:
                        for span in line["spans"]:
                            text = span["text"]
                            origin = span["origin"]
                            size = span["size"]
                            bbox = span["bbox"]
                            font = span["font"]
                            
                            if is_original_font:
                                font_lower = font.lower()
                                if "sans" in font_lower or "helv" in font_lower or "arial" in font_lower:
                                    fontname = "helv"
                                elif "serif" in font_lower or "times" in font_lower or "roman" in font_lower:
                                    fontname = "times-roman"
                                elif "mono" in font_lower or "cour" in font_lower or "console" in font_lower:
                                    fontname = "cour"
                                else:
                                    fontname = "helv"
                            else:
                                fontname = target_font
                                
                            try:
                                if is_original_font:
                                    # Invisible text for searchability using true baseline
                                    new_page.insert_text(
                                        origin,
                                        text,
                                        fontsize=size,
                                        fontname=fontname,
                                        render_mode=3,
                                        overlay=True
                                    )
                                else:
                                    # Visible white text for swapped fonts
                                    # Scale fontsize to match original width to prevent overflow
                                    f = fitz.Font(fontname)
                                    text_len_1 = f.text_length(text, fontsize=1)
                                    if text_len_1 > 0:
                                        orig_width = bbox[2] - bbox[0]
                                        scaled_size = orig_width / text_len_1
                                        size = min(size, scaled_size)
                                        
                                    new_page.insert_text(
                                        origin,
                                        text,
                                        fontsize=size,
                                        fontname=fontname,
                                        color=(1,1,1),
                                        render_mode=0,
                                        overlay=True
                                    )
                            except Exception:
                                pass
                                
        if not is_original_font:
            logger.info("Subsetting fonts to minimize file size...")
            try:
                out_doc.subset_fonts()
            except Exception as e:
                logger.warning(f"Font subsetting failed: {e}")

        logger.info(f"Saving compiled document to: {output_path}")
        out_doc.save(output_path)
    finally:
        out_doc.close()
        
    return output_path


def render_single_page_to_bytes(
    input_path, # can be str or bytes
    page_num: int,  # 1-indexed
    dpi: int = 100,
    smart_invert: bool = True,
    brightness_factor: float = 1.0,
    color_mode: str = "comfort",
    custom_bg_rgb: tuple = None,
    custom_text_rgb: tuple = None,
    custom_sat_factor: float = None,
    preview_type: str = "dark"
) -> bytes:
    """
    Renders a single page of the PDF to JPEG bytes with the specified dark-mode settings.
    """
    if isinstance(input_path, bytes):
        doc = fitz.open(stream=input_path, filetype="pdf")
    else:
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input file not found: {input_path}")
        doc = fitz.open(input_path)
    try:
        total_pages = len(doc)
        page_idx = max(0, min(total_pages - 1, page_num - 1))
        page = doc[page_idx]
        
        # Render page
        pix = page.get_pixmap(dpi=dpi)
        img_data = pix.tobytes("png")
        orig_img = Image.open(io.BytesIO(img_data)).convert("RGB")
        
        if preview_type == "original":
            img_byte_arr = io.BytesIO()
            orig_img.save(img_byte_arr, format='JPEG', quality=85)
            return img_byte_arr.getvalue()
            
        # Get image bounding boxes if smart invert is active
        image_bboxes = []
        if smart_invert:
            try:
                image_infos = page.get_image_info()
                image_bboxes = [info["bbox"] for info in image_infos if "bbox" in info]
            except Exception:
                pass
                
        # Resolve target Y values and chroma tables
        y_table, cb_table, cr_table = compute_color_tables(
            color_mode, brightness_factor, custom_bg_rgb, custom_text_rgb, custom_sat_factor
        )
        
        # Apply YCbCr mapping
        ycbcr_img = orig_img.convert("YCbCr")
        y, cb, cr = ycbcr_img.split()
        
        y_mapped = y.point(y_table)
        cb_mapped = cb.point(cb_table)
        cr_mapped = cr.point(cr_table)
        
        inverted_img = Image.merge("YCbCr", (y_mapped, cb_mapped, cr_mapped)).convert("RGB")
        
        # Restore original image areas if smart invert is active
        if smart_invert and image_bboxes:
            scale = dpi / 72.0
            for bbox in image_bboxes:
                x0, y0, x1, y1 = bbox
                px0 = max(0, int(x0 * scale) - 1)
                py0 = max(0, int(y0 * scale) - 1)
                px1 = min(orig_img.width, int(x1 * scale) + 1)
                py1 = min(orig_img.height, int(y1 * scale) + 1)
                
                if px1 > px0 and py1 > py0:
                    crop_area = (px0, py0, px1, py1)
                    cropped_orig = orig_img.crop(crop_area)
                    inverted_img.paste(cropped_orig, (px0, py0))
                    
        # Save to JPEG
        img_byte_arr = io.BytesIO()
        inverted_img.save(img_byte_arr, format='JPEG', quality=85)
        return img_byte_arr.getvalue()
        
    finally:
        doc.close()
