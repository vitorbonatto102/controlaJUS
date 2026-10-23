import assert from "node:assert/strict";
import { test } from "node:test";
import { parseContractText } from "../src/lib/contracts/extraction";
import { blankContractForm, prepareContract } from "../src/lib/contracts/registration";
import { validateContractors } from "../src/lib/contracts/parties";
import { summarizeContracts } from "../src/lib/contracts/view";

test("modelo com dois contratantes lê as pessoas, entrada e parcelas sem incluir a contratada", () => {
  const data = parseContractText(`Pelo presente instrumento, de um lado JOÃO CLIENTE TESTE, brasileiro,
    inscrito no CPF sob n° 529.982.247-25; e MARIA CLIENTE TESTE, brasileira, CPF sob n° 111.444.777-35;
    Doravante denominados CONTRATANTE, e, de outro lado, ADVOGADA TESTE, brasileira, CPF: 123.456.789-09.
    CLÁUSULA SEGUNDA – Da remuneração. 2.1 Em contraprestação o CONTRATANTE pagará o valor de R$ 3.000,00,
    com pagamento da seguinte forma: entrada no valor de R$ 400,00 pago no dia 04/06/2026; mais 04 parcelas
    no valor de R$ 650,00 cada, com vencimento da primeira para o dia 10/07/2026 e as demais sucessivamente.
    2.2 Os pagamentos serão feitos por boleto. Cruz Alta, RS, 03 de Julho de 2026.`);
  assert.deepEqual(data.contractors, [{ fullName: "JOÃO CLIENTE TESTE", cpf: "529.982.247-25" },
    { fullName: "MARIA CLIENTE TESTE", cpf: "111.444.777-35" }]);
  assert.equal(data.contractDate, "03/07/2026");
  assert.equal(data.entryValue, "400,00");
  assert.equal(data.entryDueDate, "04/06/2026");
  assert.equal(data.installmentCount, 4);
  assert.equal(data.installmentValue, "650,00");
  assert.equal(data.firstDueDate, "10/07/2026");
});

test("OCR identifica três contratantes e sinaliza CPF ilegível sem inventar seus dígitos", () => {
  const data = parseContractText(`Pelo presente instrumento de prestação, de urn lado JOÃO CLIENTE TESTE, brasileiro,
    CPF sob n. 529.982.247-2A, residente nesta cidade; MARIA CLIENTE TESTE, brasileira, CPF sob n. 111.444.777-35;
    PEDRO CLIENTE TESTE, brasileiro, CPF sob n.o 123.456.789-09, Doravante denominados CONTRATANTES.
    Em contraprestação os CONTRATANTES pagarão o valor de R$ 54.000,00, pago efi 24 parcelas de R-S 2.250,00 cada,
    sendo a primeira prevista para o dia 1O de novembro cie 2O25 e as demais sucessivamente.
    6.2. Os contratantes autorizam boletos. Cruz Alta, RS, 23 de Setembro d.e 2ü25.`);
  assert.equal(data.contractors.length, 3);
  assert.equal(data.contractors[0].cpf, null);
  assert.equal(data.warnings.length, 1);
  assert.equal(data.installmentCount, 24);
  assert.equal(data.firstDueDate, "10/11/2025");
  assert.equal(data.contractDate, "23/09/2025");
});

test("cadastro valida todos os CPFs, recusa duplicação e conta os valores do contrato uma única vez", () => {
  const parties = [{ fullName: "João Teste", cpf: "52998224725" }, { fullName: "Maria Teste", cpf: "11144477735" }];
  validateContractors(parties);
  assert.throws(() => validateContractors([parties[0], parties[0]]), /mesmo CPF/);
  assert.throws(() => validateContractors([parties[0], { ...parties[1], cpf: "" }]), /contratante 2/);
  const preview = prepareContract({ ...blankContractForm, clientName: parties[0].fullName, cpf: parties[0].cpf,
    additionalContractors: [parties[1]], contractDate: "22/10/2026", total: "1.000,00", method: "cash",
    installmentValue: "1.000,00", count: "1", paymentStartType: "fixed_date", firstDue: "10/11/2026",
    origin: "Cliente próprio", percentage: "40" });
  const summary = summarizeContracts([{ id: "contract", client_id: "client-1", client_name: parties[0].fullName,
    client_cpf: parties[0].cpf, contractors: parties.map((party, index) => ({ ...party, clientId: `client-${index + 1}` })),
    origin: "Cliente próprio", contract_date: "2026-10-22", total_contract_value: 1000, commission_percentage: 40,
    payment_method: "cash", contract_file_name: null, contract_file_path: null, installments: preview.rows.map((row) => ({
      ...row, id: "installment", contractual_amount: row.amount_cents / 100, payments: [] })) }], "2026-10-22");
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.totalContractedCents, 100000);
  assert.equal(summary.contractedParticipationCents, 40000);
  assert.equal(summary.rows[0].clientName, "João Teste / Maria Teste");
});
