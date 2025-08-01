# uploads/

This directory is used to store **user-uploaded files** (e.g., images, documents, or other media).

## Important Notes:
- 🚨 **Do not delete this folder** – It is required for the web server to function correctly.

- 📂 **Server permissions** – Ensure the web server has write access to this directory (e.g., `chmod -R 755 uploads/` on Linux).

## Directory Structure:
- `documents/` - Identity documents and verification files
- `environmentPhotos/` - Work environment photos
- `temp/` - Temporary files during upload process
- `verficationDocument/` - Employer verification documents

## File Upload Flow:
1. Files are initially uploaded to `temp/` directory
2. After validation, they are moved to appropriate subdirectories
3. File metadata is stored in database with references to file paths
4. Presigned URLs are generated for secure access
