let pageTexts = ["Hello Test Document\n"];

const pdfParse = jest.fn(async (buffer, options = {}) => {
  const pagerender = options.pagerender;
  const rendered = [];

  if (pagerender) {
    for (const text of pageTexts) {
      rendered.push(
        await pagerender({
          getTextContent: async () => ({
            items: [{ str: text, transform: [1, 0, 0, 1, 0, 0] }],
          }),
        })
      );
    }
  }

  const texts = rendered.length > 0 ? rendered : pageTexts;

  return {
    numpages: texts.length,
    numrender: texts.length,
    info: { title: "Test Document" },
    metadata: null,
    version: "1.10.100",
    text: texts.join("\n\n"),
  };
});

module.exports = pdfParse;
module.exports.default = pdfParse;
module.exports.setPageTexts = (texts) => {
  pageTexts = texts;
};
