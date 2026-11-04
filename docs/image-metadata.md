# Images: metadata and thumbnails

Applies to JPG, PNG, WebP, HEIC, GIF and TIFF files, and to images inside PDF and DOCX files.

| Rule                                                                                                        | Severity | What it finds                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image.gps`                                                                                                 | **high** | GPS coordinates from EXIF (or XMP), shown as decimal degrees with N/S/E/W, plus altitude. This often reveals a home address.                                  |
| `image.thumbnail-mismatch`                                                                                  | **high** | The hidden EXIF preview thumbnail doesn't match the picture: a different shape (it was cropped) or different content. It may still show what you cropped out. |
| `image.location`                                                                                            | medium   | City, state, country or location names (IPTC / XMP)                                                                                                           |
| `image.author`                                                                                              | medium   | Artist, camera owner, XP author, IPTC by-line, XMP creator                                                                                                    |
| `image.camera-serial`                                                                                       | medium   | Body and lens serial numbers, which can link your photos together                                                                                             |
| `image.ai-prompt`                                                                                           | medium   | AI generation prompt and settings in PNG text chunks (`parameters`, `prompt`, `workflow`)                                                                     |
| `image.computer-name`                                                                                       | medium   | `HostComputer`                                                                                                                                                |
| `image.file-path`                                                                                           | medium   | Local paths anywhere in metadata (names the username)                                                                                                         |
| `image.device` / `.software` / `.dates` / `.description` / `.copyright` / `.edit-history` / `.document-ids` | low      | Camera model, editing software, timestamps (exactly as written in the file), captions and comments, copyright, XMP history and IDs                            |
| `image.thumbnail`                                                                                           | info     | A matching preview thumbnail is embedded                                                                                                                      |

PNG `tEXt` chunks and WebP `EXIF` chunks are read too. Dates are never converted to another time zone.

redactguard looks up nothing: coordinates are shown as numbers and never sent to a map service.

## Fix

Run `redactguard clean`. It re-encodes the image without any metadata or thumbnail. For future photos, turn off location tagging in the camera app.

## Limits

HEIC pixels can't be decoded with permissively licensed code, so HEIC gets metadata checks only (no thumbnail or pixelation checks).
