import type { ScanReport } from '../types.js';
import { FindingSink, countSeverities, sortFindings } from '../util.js';
import { detectAnnotations, loadAnnotations } from './detectors/annotations.js';
import { detectCoveredText } from './detectors/covered-text.js';
import {
  detectAnnotationAttachments,
  detectAttachments,
  detectJavaScript,
  pageScripts,
} from './detectors/embedded.js';
import { RawStreams, detectPdfImages } from './detectors/images.js';
import { detectRevisions } from './detectors/revisions.js';
import { detectHiddenText } from './detectors/hidden-text.js';
import { detectMetadata } from './detectors/metadata.js';
import { buildPageModel } from './interpret.js';
import { openPdf } from './load.js';

export async function scanPdf(bytes: Uint8Array, file: string): Promise<ScanReport> {
  const started = performance.now();
  const pdf = await openPdf(bytes);
  const sink = new FindingSink();
  const warnings: string[] = [];
  const ocrPages: number[] = [];
  const raw = new RawStreams(pdf.bytes);
  const seenImages = new Set<string>();
  const scripts: { page: number; code: string }[] = [];
  try {
    await detectMetadata(pdf, sink);
    await detectAttachments(pdf.doc, sink, warnings);
    for (let n = 1; n <= pdf.doc.numPages; n++) {
      try {
        const page = await pdf.doc.getPage(n);
        const model = await buildPageModel(pdf, page);
        const annots = await loadAnnotations(page);
        // Redaction marks are reported by the annotations detector, not as covering boxes.
        const redactIds = new Set(
          annots.filter((a) => a.subtype === 'Redact').map((a) => String(a.id)),
        );
        const { coveredRuns } = detectCoveredText(model, sink, redactIds);
        if (detectHiddenText(model, sink, coveredRuns).ocrLayer) ocrPages.push(n);
        detectAnnotations(annots, model, sink);
        await detectAnnotationAttachments(annots, n, sink, warnings);
        scripts.push(...(await pageScripts(page, annots)));
        await detectPdfImages(page, model, raw, seenImages, sink, warnings);
        page.cleanup();
      } catch (err) {
        warnings.push(
          `Page ${n} could not be fully analysed: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }
    await detectJavaScript(pdf.doc, scripts, sink);
    try {
      await detectRevisions(pdf, sink, warnings);
    } catch (err) {
      warnings.push(
        `Earlier versions could not be checked: ${(err as Error)?.message ?? String(err)}`,
      );
    }
    if (ocrPages.length) {
      sink.add({
        rule: 'pdf.hidden-text.ocr-layer',
        detector: 'hidden-text',
        severity: 'info',
        title:
          'Some pages are scans with an invisible text layer (OCR). This is normal, but black boxes drawn on a scan do not remove this text.',
        evidence: `Pages: ${ocrPages.join(', ')}`,
        fix: 'If you blacked out parts of a scan, run `redactguard clean` so the OCR text under the boxes is removed too.',
        details: { pages: ocrPages },
      });
    }
    const findings = sortFindings(sink.findings);
    return {
      file,
      kind: 'pdf',
      pageCount: pdf.doc.numPages,
      findings,
      counts: countSeverities(findings),
      warnings,
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    await pdf.doc.loadingTask.destroy().catch(() => undefined);
  }
}
