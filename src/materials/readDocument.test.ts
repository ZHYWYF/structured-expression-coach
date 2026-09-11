import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractRawText: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("mammoth", () => ({ default: { extractRawText: mocks.extractRawText } }));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: { workerSrc: "" }, getDocument: mocks.getDocument }));

import { readDocumentText } from "./readDocument";

describe("readDocumentText", () => {
  beforeEach(() => {
    mocks.extractRawText.mockReset();
    mocks.getDocument.mockReset();
  });

  it("reads plain text formats directly", async () => {
    await expect(readDocumentText(new File(["content"], "notes.md"))).resolves.toBe("content");
  });

  it("extracts and trims DOCX text", async () => {
    mocks.extractRawText.mockResolvedValue({ value: "  document body  " });
    await expect(readDocumentText(new File(["doc"], "resume.docx"))).resolves.toBe("document body");
  });

  it("combines PDF pages and rejects unsupported or empty documents", async () => {
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({
      numPages: 2,
      getPage: vi.fn()
        .mockResolvedValueOnce({ getTextContent: vi.fn().mockResolvedValue({ items: [{ str: "page one" }] }) })
        .mockResolvedValueOnce({ getTextContent: vi.fn().mockResolvedValue({ items: [{ str: "page two" }] }) }),
    }) });
    await expect(readDocumentText(new File(["pdf"], "resume.pdf"))).resolves.toBe("page one\n\npage two");
    await expect(readDocumentText(new File(["x"], "archive.zip"))).rejects.toThrow("暂不支持该文件格式");
  });
});
