const pdfParse = require("pdf-parse");

const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;

const pdfParseConfig = {
  timeoutMs: 30 * 1000,
};

const cleanText = (text) => {
  if (!text) return "";
  return text
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const chunkText = (text) => {
  if (!text) return [];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= text.length) break;
  }

  return chunks;
};

const renderPageText = async (pageData) => {
  const renderOptions = {
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  };

  const textContent = await pageData.getTextContent(renderOptions);

  let lastY;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || !lastY) {
      text += item.str;
    } else {
      text += "\n" + item.str;
    }
    lastY = item.transform[5];
  }

  return text;
};

const parsePdfWithTimeout = (buffer, pageTexts) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("PDF processing timed out"));
    }, pdfParseConfig.timeoutMs);

    pdfParse(buffer, {
      pagerender: async (pageData) => {
        const text = await renderPageText(pageData);
        pageTexts.push(text);
        return text;
      },
    }).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
};

const extractPageTexts = async (buffer) => {
  const pageTexts = [];

  const pdfData = await parsePdfWithTimeout(buffer, pageTexts);

  if (pageTexts.length === 0) {
    if (Array.isArray(pdfData.pages)) {
      pageTexts.push(...pdfData.pages.map((p) => p.text ?? p));
    } else {
      pageTexts.push(...pdfData.text.split(/\f/).filter((p) => p.trim()));
    }
  }

  return { numpages: pdfData.numpages, pageTexts };
};

const chunkPages = (pageTexts) => {
  const chunks = [];

  pageTexts.forEach((pageText, i) => {
    const pageNumber = i + 1;
    const cleaned = cleanText(pageText);

    chunkText(cleaned).forEach((content, chunkIndex) => {
      chunks.push({ content, pageNumber, chunkIndex });
    });
  });

  return chunks;
};

module.exports = { cleanText, chunkText, extractPageTexts, chunkPages, pdfParseConfig };
