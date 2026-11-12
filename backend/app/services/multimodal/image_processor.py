from dataclasses import dataclass
from pathlib import Path
import struct
from typing import Optional
import uuid

from app.core.config import BASE_DIR

SUPPORTED_MEDICAL_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
UNSUPPORTED_VOLUMETRIC_EXTENSIONS = {".dcm", ".dicom", ".nii", ".gz", ".tif", ".tiff"}
SUPPORTED_IMAGE_MODALITIES = {"chest_xray", "xray"}
MAX_MEDICAL_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
UPLOADS_ROOT = BASE_DIR / "uploads" / "assessments"

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_PNG_METADATA_CHUNKS = {b"eXIf", b"tEXt", b"zTXt", b"iTXt", b"tIME"}


class ImageProcessingError(ValueError):
    """Raised when an uploaded medical image is unsupported, corrupt, or oversized."""


@dataclass(frozen=True)
class ProcessedMedicalImage:
    """Result of validating, stripping metadata, and storing a medical image."""

    original_filename: str
    mime_type: str
    size_bytes: int
    storage_path: str
    modality: str
    exif_stripped: bool


def _validate_and_strip_png(raw_bytes: bytes) -> bytes:
    if not raw_bytes.startswith(_PNG_SIGNATURE) or len(raw_bytes) < 33:
        raise ImageProcessingError("Uploaded PNG file is corrupted or invalid.")

    pos = 8
    out = bytearray(_PNG_SIGNATURE)
    found_ihdr = False
    found_iend = False

    while pos + 8 <= len(raw_bytes):
        length = struct.unpack(">I", raw_bytes[pos : pos + 4])[0]
        chunk_type = raw_bytes[pos + 4 : pos + 8]
        chunk_end = pos + 12 + length
        if chunk_end > len(raw_bytes):
            raise ImageProcessingError("Uploaded PNG file appears truncated or corrupted.")

        if chunk_type == b"IHDR":
            if length < 13:
                raise ImageProcessingError("Uploaded PNG IHDR header is invalid.")
            width, height = struct.unpack(">II", raw_bytes[pos + 8 : pos + 16])
            if width == 0 or height == 0:
                raise ImageProcessingError("Uploaded PNG image has invalid zero dimensions.")
            found_ihdr = True

        if chunk_type not in _PNG_METADATA_CHUNKS:
            out.extend(raw_bytes[pos:chunk_end])

        pos = chunk_end
        if chunk_type == b"IEND":
            found_iend = True
            break

    if not found_ihdr or not found_iend:
        raise ImageProcessingError("Uploaded PNG file is missing required image chunks.")
    return bytes(out)


def _validate_and_strip_jpeg(raw_bytes: bytes) -> bytes:
    if len(raw_bytes) < 4 or raw_bytes[:2] != b"\xff\xd8":
        raise ImageProcessingError("Uploaded JPEG file is corrupted or invalid.")

    pos = 2
    out = bytearray(b"\xff\xd8")
    found_sof = False
    found_sos = False

    while pos < len(raw_bytes):
        if raw_bytes[pos] != 0xFF:
            raise ImageProcessingError("Uploaded JPEG structure is invalid.")
        while pos < len(raw_bytes) and raw_bytes[pos] == 0xFF:
            pos += 1
        if pos >= len(raw_bytes):
            break

        marker = raw_bytes[pos]
        pos += 1

        # Standalone markers (EOI, RSTn, TEM)
        if marker == 0xD9:  # EOI
            out.extend(b"\xff\xd9")
            break
        if marker == 0x00 or (0xD0 <= marker <= 0xD7) or marker == 0x01:
            out.extend(bytes([0xFF, marker]))
            continue

        if pos + 2 > len(raw_bytes):
            raise ImageProcessingError("Uploaded JPEG segment is truncated.")
        seg_len = struct.unpack(">H", raw_bytes[pos : pos + 2])[0]
        if seg_len < 2 or pos + seg_len > len(raw_bytes):
            raise ImageProcessingError("Uploaded JPEG segment length is invalid.")

        # SOF markers (baseline/progressive/extended) contain image dimensions
        if marker in {
            0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
            0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
        }:
            if seg_len >= 7:
                height, width = struct.unpack(">HH", raw_bytes[pos + 3 : pos + 7])
                if width == 0 or height == 0:
                    raise ImageProcessingError("Uploaded JPEG image has zero dimensions.")
                found_sof = True

        # Strip APP1..APP15 (EXIF/XMP/IPTC/ICC comments) and COM (0xFE)
        # Keep APP0 (JFIF, 0xE0) and all encoding/quantization/Huffman/SOS segments.
        is_metadata_segment = (0xE1 <= marker <= 0xEF) or (marker == 0xFE)

        if marker == 0xDA:  # Start of Scan -> copy rest of entropy-coded stream
            out.extend(bytes([0xFF, marker]))
            out.extend(raw_bytes[pos:])
            found_sos = True
            break

        if not is_metadata_segment:
            out.extend(bytes([0xFF, marker]))
            out.extend(raw_bytes[pos : pos + seg_len])

        pos += seg_len

    if not found_sof or not found_sos:
        raise ImageProcessingError("Uploaded JPEG file is missing valid image scan data.")
    return bytes(out)


def strip_image_metadata(raw_bytes: bytes, ext: str) -> tuple[bytes, str]:
    """Validate image bytes and strip EXIF/XMP/text metadata chunks."""
    norm_ext = ext.lower()
    if norm_ext == ".png":
        return _validate_and_strip_png(raw_bytes), "image/png"
    if norm_ext in {".jpg", ".jpeg"}:
        return _validate_and_strip_jpeg(raw_bytes), "image/jpeg"
    raise ImageProcessingError(f"Unsupported image extension: {ext}")


def validate_and_store_medical_image(
    *,
    assessment_id: uuid.UUID,
    file_bytes: bytes,
    file_name: str,
    modality: str = "chest_xray",
    uploads_root: Optional[Path] = None,
) -> ProcessedMedicalImage:
    """Validate, strip EXIF/metadata, and store a supported X-ray/clinical image."""
    safe_name = Path(file_name or "medical_image.png").name
    ext = Path(safe_name).suffix.lower()

    if ext in UNSUPPORTED_VOLUMETRIC_EXTENSIONS:
        raise ImageProcessingError(
            f"Format '{ext}' is not supported yet. Currently only 2D JPEG and PNG X-ray "
            "or clinical images are supported (MRI/CT volumetric formats are not yet implemented)."
        )
    if ext not in SUPPORTED_MEDICAL_IMAGE_EXTENSIONS:
        raise ImageProcessingError(
            f"Unsupported medical image format '{ext or 'unknown'}'. "
            "Supported formats: PNG and JPEG (.png, .jpg, .jpeg)."
        )
    if not file_bytes:
        raise ImageProcessingError(f"Uploaded image '{safe_name}' is empty.")
    if len(file_bytes) > MAX_MEDICAL_IMAGE_BYTES:
        raise ImageProcessingError(
            f"Uploaded image '{safe_name}' exceeds the 10 MB size limit."
        )

    cleaned_modality = (modality or "chest_xray").strip().lower()
    if cleaned_modality not in SUPPORTED_IMAGE_MODALITIES:
        raise ImageProcessingError(
            f"Image modality '{cleaned_modality}' is not supported. "
            "Currently supported modalities: chest_xray, xray (MRI and CT are not yet supported)."
        )

    sanitized_bytes, resolved_mime = strip_image_metadata(file_bytes, ext)

    root = (uploads_root or UPLOADS_ROOT).resolve()
    target_dir = (root / str(assessment_id) / "images").resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    stored_file = (target_dir / f"{uuid.uuid4()}{ext}").resolve()
    if root not in stored_file.parents:
        raise ImageProcessingError("Invalid storage path resolved for image.")
    stored_file.write_bytes(sanitized_bytes)

    return ProcessedMedicalImage(
        original_filename=safe_name[:255],
        mime_type=resolved_mime,
        size_bytes=len(sanitized_bytes),
        storage_path=str(stored_file),
        modality=cleaned_modality,
        exif_stripped=True,
    )


def load_sanitized_image_bytes(
    storage_path: str,
    *,
    uploads_root: Optional[Path] = None,
) -> Optional[bytes]:
    """Read stored sanitized image bytes safely if present on disk."""
    try:
        candidate = Path(storage_path).resolve()
    except Exception:
        return None
    if uploads_root is not None:
        root = uploads_root.resolve()
        if root not in candidate.parents:
            return None
    if not candidate.is_file():
        return None
    try:
        return candidate.read_bytes()
    except OSError:
        return None

