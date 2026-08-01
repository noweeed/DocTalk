const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const WEBP_MAGIC = Buffer.from([0x52, 0x49, 0x46, 0x46]);
const WEBP_MARKER = Buffer.from("WEBP");

const startsWith = (buffer, magic) => {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= magic.length &&
    buffer.subarray(0, magic.length).equals(magic)
  );
};

const isPdfBuffer = (buffer) => startsWith(buffer, PDF_MAGIC);

const isImageBuffer = (buffer) => {
  if (startsWith(buffer, PNG_MAGIC)) return true;
  if (startsWith(buffer, JPEG_MAGIC)) return true;
  return (
    startsWith(buffer, WEBP_MAGIC) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).equals(WEBP_MARKER)
  );
};

module.exports = { isPdfBuffer, isImageBuffer };
