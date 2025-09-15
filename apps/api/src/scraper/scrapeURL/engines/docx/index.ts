import { Meta } from "../..";
import { EngineScrapeResult } from "..";
import { fetchFileToBuffer } from "../utils/downloadFile";

import { DocumentConverter, DocumentType } from "@mendable/firecrawl-rs";
const documentConverter = new DocumentConverter();

function getDocumentTypeFromUrl(url: string): DocumentType {
  const urlLower = url.toLowerCase();
  if (urlLower.includes(".docx")) return DocumentType.Docx;
  if (urlLower.includes(".odt")) return DocumentType.Odt;
  if (urlLower.includes(".rtf")) return DocumentType.Rtf;

  return DocumentType.Docx; // hope for the best
}

function getDocumentTypeFromContentType(
  contentType: string | null,
): DocumentType | null {
  if (!contentType) return null;
  const ctLower = contentType.toLowerCase();

  if (
    ctLower.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
  ) {
    return DocumentType.Docx;
  }
  if (ctLower.includes("application/vnd.oasis.opendocument.text")) {
    return DocumentType.Odt;
  }
  if (ctLower.includes("application/rtf") || ctLower.includes("text/rtf")) {
    return DocumentType.Rtf;
  }

  return null;
}

export async function scrapeDocument(meta: Meta): Promise<EngineScrapeResult> {
  const { response, buffer } = await fetchFileToBuffer(
    meta.rewrittenUrl ?? meta.url,
    {
      headers: meta.options.headers,
      signal: meta.abort.asSignal(),
    },
  );

  const contentType = response.headers.get("Content-Type");
  let documentType = getDocumentTypeFromContentType(contentType);

  if (!documentType) {
    documentType = getDocumentTypeFromUrl(response.url);
  }

  return {
    url: response.url,
    statusCode: response.status,

    html: await documentConverter.convertBufferToHtml(
      new Uint8Array(buffer),
      documentType,
    ),

    proxyUsed: "basic",
  };
}

export function documentMaxReasonableTime(_meta: Meta): number {
  return 15000;
}
