import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { operationalDocument, parseReportFilters, reportQuery, reportScope, ReportError, type OperationalReportRow } from "../src/lib/reports/model";
import { renderReportPdf } from "../src/lib/reports/pdf";

const id = "11111111-1111-4111-8111-111111111111", colleague = "22222222-2222-4222-8222-222222222222";
const profile = { id, role: "lawyer" as const, office_id: id, active: true, is_office_admin: true };
const row: OperationalReportRow = { row_id: "payment", contract_id: id, lawyer_id: id, lawyer_name: "Advogada teste",
  clients: [{ name: "Cliente principal", cpf: null }, { name: "Cliente adicional", cpf: null }], origin: "Cliente próprio",
  service_name: "Ação revisional", contract_date: "2026-10-01", total_contract_value: 1000, payment_method: "installments",
  event_date: "2026-10-20", payment_id: "payment", installment_label: "Parcela 1", due_date: "2026-10-10",
  contractual_amount: 1000, received_amount: 1080, balance: null, status: null };
const context = { officeName: "Escritório teste", issuedBy: "Usuária teste", issuedAt: "2026-11-03T15:00:00Z", today: "2026-11-03" };

test("filtros validam datas brasileiras, calendário, repetições e escopo individual", () => {
  const filters = parseReportFilters(new URLSearchParams(), "2026-11-03");
  assert.equal(filters.from, "2026-11-01"); assert.equal(filters.to, "2026-11-30");
  assert.equal(parseReportFilters(new URLSearchParams(), "2028-02-02").to, "2028-02-29");
  for (const query of ["de=31/02/2026", "de=05/11/2026&ate=01/11/2026", "tipo=toString", "situacao=constructor", "advogada=x", "cpf=123", "cliente=a&cliente=b"])
    assert.throws(() => parseReportFilters(new URLSearchParams(query), "2026-11-03"), ReportError);
  assert.throws(() => reportScope(profile, colleague), /próprios/);
  assert.equal(reportScope(profile).lawyerId, id);
  assert.equal(reportScope({ ...profile, role: "secretary" }).financial, false);
});

test("várias origens são preservadas na URL, paginação e descrição do relatório", () => {
  const params = new URLSearchParams();
  for (const origin of ["Tráfego HP", "Cliente próprio", "Tráfego HP"]) params.append("origem", origin);
  const filters = parseReportFilters(params, "2026-11-03");
  assert.deepEqual(filters.origins, ["Cliente próprio", "Tráfego HP"]);
  const query = new URLSearchParams(reportQuery(filters));
  assert.deepEqual(query.getAll("origem"), filters.origins);
  assert.deepEqual(parseReportFilters(query, "2026-11-03"), filters);
  const report = operationalDocument([row], filters, reportScope(profile), context);
  assert.ok(report.filters.includes("Origens: Cliente próprio; Tráfego HP"));
  assert.deepEqual(parseReportFilters(new URLSearchParams("origem="), "2026-11-03").origins, []);
  assert.deepEqual(parseReportFilters(new URLSearchParams("origem=Cliente+próprio"), "2026-11-03").origins, ["Cliente próprio"]);
  assert.throws(() => parseReportFilters(new URLSearchParams("origem=Cliente+próprio&origem=invalida"), "2026-11-03"), ReportError);
});

test("recebimentos usam comissões registradas, não estimativas, e o DTO da secretaria omite dados privados", () => {
  const filters = parseReportFilters(new URLSearchParams("de=01/10/2026&ate=31/10/2026"), "2026-11-03");
  const commissions = new Map([["payment", 43200]]);
  const report = operationalDocument([row], filters, reportScope(profile), context, commissions);
  assert.match(report.metrics[0].value, /1.080,00/); assert.match(report.metrics[1].value, /432,00/);
  assert.equal(report.sections[0].rows.length, 1); assert.match(report.sections[0].rows[0].join(" "), /Cliente adicional/);
  const operational = operationalDocument([row], filters, reportScope({ ...profile, role: "secretary" }), context, commissions);
  assert.doesNotMatch(JSON.stringify(operational), /comiss|432,00|percentual|repasse/i);
  const upfront = operationalDocument([row], filters, reportScope(profile), context, new Map([["payment", 50000]]));
  assert.match(upfront.metrics[1].value, /500,00/, "não recalcula a retenção integral como proporcional");
});

test("PDF mantém nomes, valores, acentos e todos os registros em múltiplas páginas", async () => {
  const filters = parseReportFilters(new URLSearchParams("de=01/10/2026&ate=31/10/2026"), "2026-11-03");
  const rows = Array.from({ length: 45 }, (_, index) => ({ ...row, row_id: String(index), payment_id: String(index),
    clients: [{ name: `Contratante ${String(index).padStart(3, "0")} Ágata Gonçalves`, cpf: null }] }));
  const report = operationalDocument(rows, filters, reportScope({ ...profile, role: "secretary" }), context);
  const bytes = await renderReportPdf(report);
  const pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() > 1);
  const task = getDocument({ data: bytes, useSystemFonts: true });
  try {
    const parsed = await task.promise; let text = "";
    for (let page = 1; page <= parsed.numPages; page++) {
      const content = await (await parsed.getPage(page)).getTextContent();
      const pageText = content.items.map(item => "str" in item ? item.str : "").join(" ");
      assert.match(pageText, new RegExp(`${page} / ${parsed.numPages}`)); text += pageText;
    }
    for (let i = 0; i < rows.length; i++) assert.match(text, new RegExp(`Contratante ${String(i).padStart(3, "0")}`));
    assert.match(text, /Ágata Gonçalves/); assert.match(text, /1.080,00/);
    assert.doesNotMatch(text, /Comissão/);
  } finally { await task.destroy(); }
});
