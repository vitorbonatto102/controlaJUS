import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportDocument, ReportSection } from "./model";

const ink = rgb(.07, .20, .22), muted = rgb(.38, .47, .47), green = rgb(.11, .46, .36);
const line = rgb(.85, .90, .87), tint = rgb(.94, .97, .95);
const clean = (value: string) => String(value).normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\t/g, " ");
const measurements = new WeakMap<PDFFont, Map<string, number>>();
function measure(font: PDFFont, text: string, size: number) {
  let cache = measurements.get(font);
  if (!cache) { cache = new Map(); measurements.set(font, cache); }
  const key = `${size}:${text}`;
  let width = cache.get(key);
  if (width === undefined) { width = font.widthOfTextAtSize(text, size); cache.set(key, width); }
  return width;
}
export function wrapPdfText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of clean(text).split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(font, candidate, size) <= width) { current = candidate; continue; }
      if (current) { lines.push(current); current = ""; }
      if (measure(font, word, size) <= width) { current = word; continue; }
      for (const letter of Array.from(word)) {
        if (current && measure(font, current + letter, size) > width) { lines.push(current); current = ""; }
        current += letter;
      }
    }
    lines.push(current);
  }
  return lines;
}

export async function renderReportPdf(report: ReportDocument, landscape = false): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [fontBytes, boldBytes, logoBytes] = await Promise.all([
    readFile(path.join(process.cwd(), "src/lib/reports/assets/Inter-Regular.ttf")),
    readFile(path.join(process.cwd(), "src/lib/reports/assets/Inter-Semibold.ttf")),
    readFile(path.join(process.cwd(), "public/branding/repassum/repassum-logo-pdf.png")),
  ]);
  // Full static fonts preserve Inter's composite glyphs across PDF viewers.
  const body = await pdf.embedFont(fontBytes);
  const bold = await pdf.embedFont(boldBytes);
  const logo = await pdf.embedPng(logoBytes);
  const [width, height] = landscape ? [841.89, 595.28] : [595.28, 841.89];
  const margin = 40, area = width - margin * 2, bottom = 54;
  let page: PDFPage = pdf.addPage([width, height]), y = height - 102;
  const issued = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(report.issuedAt));
  function newPage(first = false) {
    if (!first) page = pdf.addPage([width, height]);
    page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: ink });
    page.drawImage(logo, { x: margin, y: height - 65, width: 128, height: 128 * 104 / 455 });
    const top = "RELATÓRIO INTERNO";
    page.drawText(top, { x: width - margin - bold.widthOfTextAtSize(top, 7), y: height - 43, font: bold, size: 7, color: green });
    page.drawText(issued, { x: width - margin - body.widthOfTextAtSize(issued, 8), y: height - 59, font: body, size: 8, color: muted });
    page.drawLine({ start: { x: margin, y: height - 81 }, end: { x: width - margin, y: height - 81 }, thickness: .65, color: line });
    y = height - 102;
  }
  function ensure(space: number) { if (y - space < bottom) newPage(); }
  function paragraph(value: string, size = 8.4, color = ink, font = body, gap = 6) {
    const lines = wrapPdfText(value, font, size, area);
    for (const text of lines) { ensure(size * 1.5); page.drawText(text, { x: margin, y: y - size, font, size, color }); y -= size * 1.5; }
    y -= gap;
  }
  newPage(true);
  paragraph(report.title, 20, ink, bold, 5);
  paragraph(report.subtitle, 9, muted, body, 8);
  paragraph(report.officeName, 12, ink, body, 5);
  paragraph(`${report.audience}  |  Período: ${report.period}`, 9, muted, body, 6);
  paragraph(`Emitido por ${report.issuedBy}`, 8, muted, body, 10);
  for (const filter of report.filters) paragraph(filter, 8, muted, body, 2);
  y -= 12;
  const metricWidth = (area - (report.metrics.length - 1) * 10) / report.metrics.length;
  ensure(86);
  for (const [index, metric] of report.metrics.entries()) {
    const x = margin + index * (metricWidth + 10);
    page.drawRectangle({ x, y: y - 73, width: metricWidth, height: 73, color: tint, borderColor: line, borderWidth: .6 });
    const labels = wrapPdfText(metric.label, body, 7.1, metricWidth - 18).slice(0, 2);
    labels.forEach((text, i) => page.drawText(text, { x: x + 9, y: y - 14 - i * 9, size: 7.1, font: body, color: muted }));
    const valueSize = Math.min(14, (metricWidth - 18) / bold.widthOfTextAtSize(metric.value, 1));
    page.drawText(metric.value, { x: x + 9, y: y - 45, size: valueSize, font: bold, color: ink });
    if (metric.hint) wrapPdfText(metric.hint, body, 6.2, metricWidth - 18).slice(0, 2).forEach((text, i) =>
      page.drawText(text, { x: x + 9, y: y - 59 - i * 8, size: 6.2, font: body, color: muted }));
  }
  y -= 94;
  function table(section: ReportSection) {
    const total = section.columns.reduce((sum, column) => sum + column.weight, 0);
    const widths = section.columns.map(column => column.weight / total * area);
    function heading(continued = false) {
      ensure(68);
      paragraph(section.title + (continued ? " (continuação)" : ""), 10.5, ink, bold, 6);
      const labels = section.columns.map((column, i) => wrapPdfText(column.label, bold, 7, widths[i] - 12));
      const headerHeight = Math.max(...labels.map(lines => lines.length)) * 9 + 14;
      page.drawRectangle({ x: margin, y: y - headerHeight, width: area, height: headerHeight, color: ink });
      let x = margin;
      labels.forEach((lines, i) => {
        lines.forEach((text, j) => page.drawText(text, { x: section.columns[i].align === "right" ? x + widths[i] - 6 - bold.widthOfTextAtSize(text, 7) : x + 6,
          y: y - 13 - j * 9, font: bold, size: 7, color: rgb(1, 1, 1) }));
        x += widths[i];
      });
      y -= headerHeight;
    }
    heading();
    if (!section.rows.length) { y -= 8; paragraph(section.empty || "Nenhum registro encontrado para os filtros selecionados.", 8.4, muted, body, 18); return; }
    for (const [index, row] of section.rows.entries()) {
      const cells = row.map((value, i) => wrapPdfText(value, body, 7.6, widths[i] - 12));
      const count = Math.max(...cells.map(lines => lines.length), 1);
      let offset = 0;
      while (offset < count) {
        let capacity = Math.floor((y - bottom - 11) / 10.5);
        if (capacity < 1 || (offset === 0 && count <= 45 && capacity < count)) { newPage(); heading(true); capacity = Math.floor((y - bottom - 11) / 10.5); }
        const take = Math.min(count - offset, capacity), rowHeight = take * 10.5 + 11;
        if (index % 2 === 0) page.drawRectangle({ x: margin, y: y - rowHeight, width: area, height: rowHeight, color: rgb(.97, .98, .97) });
        let x = margin;
        cells.forEach((lines, column) => {
          lines.slice(offset, offset + take).forEach((text, j) => page.drawText(text, {
            x: section.columns[column].align === "right" ? x + widths[column] - 6 - body.widthOfTextAtSize(text, 7.6) : x + 6,
            y: y - 12 - j * 10.5, size: 7.6, font: body, color: ink }));
          x += widths[column];
        });
        y -= rowHeight;
        page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .4, color: line });
        offset += take;
      }
    }
    y -= 15;
  }
  report.sections.forEach(table);
  ensure(45); paragraph("Sobre este relatório", 10, ink, bold, 7);
  report.notes.forEach(note => paragraph(note, 7.5, muted, body, 5));
  if (report.reference) paragraph(`Referência do fechamento: ${report.reference}`, 7, muted);
  for (const [index, current] of pdf.getPages().entries()) {
    current.drawLine({ start: { x: margin, y: 36 }, end: { x: width - margin, y: 36 }, thickness: .5, color: line });
    current.drawText("Repassum · Uso interno e confidencial", { x: margin, y: 23, font: body, size: 7, color: muted });
    const number = `${index + 1} / ${pdf.getPageCount()}`;
    current.drawText(number, { x: width - margin - body.widthOfTextAtSize(number, 7), y: 23, font: body, size: 7, color: muted });
  }
  pdf.setTitle(report.title); pdf.setAuthor("Repassum"); pdf.setSubject(`${report.officeName} · ${report.period}`);
  pdf.setCreator("Repassum"); pdf.setCreationDate(new Date(report.issuedAt));
  return pdf.save();
}
