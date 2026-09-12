import mammoth from "mammoth";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function readDocumentText(file: File): Promise<string> {
  if (!file.size) throw new Error("文件为空，请选择包含正文的文件");
  if (file.size > 30 * 1024 * 1024) throw new Error("材料文件超过30MB，请先压缩或粘贴正文");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["txt", "md", "json", "csv"].includes(extension ?? "")) return file.text();
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    if (!result.value.trim()) throw new Error("DOCX 中没有读取到正文");
    return result.value.trim();
  }
  if (extension === "pdf") {
    const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" "));
    }
    const text = pages.join("\n\n").trim();
    if (!text) throw new Error("PDF 中没有读取到可复制文字；扫描版 PDF 请先进行 OCR");
    return text;
    } finally { await document.destroy?.(); }
  }
  throw new Error("暂不支持该文件格式，请使用 PDF、DOCX、TXT、Markdown、JSON 或 CSV");
}
