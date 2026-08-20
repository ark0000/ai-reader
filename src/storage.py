import os
import shutil
import logging
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)

# Try importing boto3 for S3 storage
try:
    import boto3
    from botocore.exceptions import NoCredentialsError
except ImportError:
    boto3 = None

# Local temp workspace folder
LOCAL_TEMP_DIR = os.path.join(os.path.dirname(__file__), "temp")
os.makedirs(LOCAL_TEMP_DIR, exist_ok=True)

class BaseStorage(ABC):
    @abstractmethod
    def save_file(self, file_bytes: bytes, filename: str) -> str:
        """Saves file bytes and returns a URI or path identifier."""
        pass
        
    @abstractmethod
    def get_file_content_bytes(self, filename: str) -> bytes:
        """Reads file bytes from storage."""
        pass
        
    @abstractmethod
    def get_file_url_or_path(self, filename: str) -> str:
        """Returns a path or a pre-signed URL to access the file."""
        pass
        
    @abstractmethod
    def delete_file(self, filename: str) -> bool:
        """Deletes the file from storage."""
        pass


class LocalStorage(BaseStorage):
    def __init__(self):
        self.directory = LOCAL_TEMP_DIR
        logger.info(f"Initialized LocalStorage path: {self.directory}")
        
    def _full_path(self, filename: str) -> str:
        return os.path.join(self.directory, filename)

    def save_file(self, file_bytes: bytes, filename: str) -> str:
        path = self._full_path(filename)
        # B-09 FIX: atomic write — write to .tmp first, then os.replace() so a
        # crash mid-write never leaves a corrupt/truncated file at the real path
        tmp_path = path + ".tmp"
        try:
            with open(tmp_path, "wb") as f:
                f.write(file_bytes)
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.remove(tmp_path)
            except Exception:
                pass
            raise
        logger.info(f"LocalStorage: Saved {filename}")
        return path

    def get_file_content_bytes(self, filename: str) -> bytes:
        path = self._full_path(filename)
        if not os.path.exists(path):
            raise FileNotFoundError(f"File {filename} not found locally.")
        with open(path, "rb") as f:
            return f.read()

    def get_file_url_or_path(self, filename: str) -> str:
        return self._full_path(filename)

    def delete_file(self, filename: str) -> bool:
        path = self._full_path(filename)
        if os.path.exists(path):
            try:
                os.remove(path)
                logger.info(f"LocalStorage: Deleted {filename}")
                return True
            except Exception as e:
                logger.warning(f"LocalStorage: Error deleting {filename}: {e}")
        return False


class S3Storage(BaseStorage):
    def __init__(self, bucket_name: str, access_key: str, secret_key: str, region: str = "us-east-1"):
        self.bucket = bucket_name
        self.s3 = boto3.client(
            "s3",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region
        )
        logger.info(f"Initialized S3Storage bucket: {self.bucket}")

    def save_file(self, file_bytes: bytes, filename: str) -> str:
        try:
            self.s3.put_object(
                Bucket=self.bucket,
                Key=filename,
                Body=file_bytes
            )
            logger.info(f"S3Storage: Uploaded {filename} to S3 bucket.")
            return f"s3://{self.bucket}/{filename}"
        except Exception as e:
            logger.error(f"S3Storage: Upload failed for {filename}: {e}")
            raise IOError(f"S3 upload error: {e}")

    def get_file_content_bytes(self, filename: str) -> bytes:
        try:
            response = self.s3.get_object(Bucket=self.bucket, Key=filename)
            return response["Body"].read()
        except Exception as e:
            logger.error(f"S3Storage: Download failed for {filename}: {e}")
            raise FileNotFoundError(f"S3 download error: {e}")

    def get_file_url_or_path(self, filename: str) -> str:
        """Generates a secure pre-signed download URL valid for 1 hour."""
        try:
            url = self.s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": filename},
                ExpiresIn=3600
            )
            return url
        except Exception as e:
            logger.error(f"S3Storage: Failed to generate pre-signed URL for {filename}: {e}")
            raise

    def delete_file(self, filename: str) -> bool:
        try:
            self.s3.delete_object(Bucket=self.bucket, Key=filename)
            logger.info(f"S3Storage: Deleted {filename} from S3.")
            return True
        except Exception as e:
            logger.warning(f"S3Storage: Delete failed for {filename}: {e}")
            return False


def get_storage() -> BaseStorage:
    """Factory function returning S3Storage if credentials exist, otherwise LocalStorage."""
    bucket = os.getenv("AWS_S3_BUCKET")
    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    region = os.getenv("AWS_REGION", "us-east-1")
    
    if boto3 and bucket and access_key and secret_key:
        try:
            return S3Storage(bucket, access_key, secret_key, region)
        except Exception as e:
            logger.warning(f"S3 initialization failed, falling back to LocalStorage: {e}")
            
    return LocalStorage()
